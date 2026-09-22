// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useSystemMaintenance } from "../src/composables/useSystemMaintenance";
import { i18n, loadLocaleMessages } from "../src/i18n";
import type { RequestFn, SystemMaintenanceDependencies } from "../src/page-context";
import type { BackupEntry } from "../src/types";

const backup: BackupEntry = {
  id: "backup-1",
  filename: "infrix-backup-20260921-090000.tar.gz",
  backup_type: "manual",
  created_at: "2026-09-21T09:00:00+08:00",
  size: 1024,
  database_engine: "mariadb",
  database_name: "infrix",
  media_included: true,
  format_version: 1,
  application_version: "0.2.0",
  git_revision: "abc123",
  migration_state: ["assets.0001_initial"],
  checksum: "checksum",
  valid: true,
  validation_error: "",
};

const cleanups: Array<() => void> = [];

beforeAll(async () => {
  await loadLocaleMessages("en-US");
  i18n.global.locale.value = "en-US";
});

afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
});

function createController(request: RequestFn) {
  const scope = effectScope();
  const deps: SystemMaintenanceDependencies = {
    request,
    downloadFile: vi.fn(async () => undefined),
    confirmAction: vi.fn(async () => true),
    can: vi.fn((capability: string) => capability === "system.reset"),
    formatDateTime: (value) => value || "—",
    reload: vi.fn(),
  };
  const controller = scope.run(() => useSystemMaintenance(deps))!;
  cleanups.push(() => scope.stop());
  return { controller, deps };
}

describe("system maintenance controller", () => {
  it("loads status and backup lists through independent reads", async () => {
    const request = vi.fn<RequestFn>(async <T>(path: string) => {
      if (path === "/system/operations/") {
        return {
          application: { product: "infrix", version: "test", environment: "test", runtime: "test", time: "", timezone: "" },
          database: { status: "healthy", engine: "sqlite", version: "3", migrations: "healthy", pending: 0 },
        } as T;
      }
      return { results: [backup] } as T;
    });
    const { controller } = createController(request);

    await expect(controller.loadStatus()).resolves.toBe(true);
    await expect(controller.loadBackups()).resolves.toBe(true);

    expect(controller.status.value?.database.status).toBe("healthy");
    expect(controller.backups.value).toEqual([backup]);
    expect(request).toHaveBeenNthCalledWith(1, "/system/operations/", expect.any(Object));
    expect(request).toHaveBeenNthCalledWith(2, "/system/backups/", expect.any(Object));
  });

  it("serializes a create action and refreshes the list", async () => {
    const request = vi.fn<RequestFn>();
    request
      .mockResolvedValueOnce(backup)
      .mockResolvedValueOnce({ results: [backup] });
    const { controller } = createController(request);

    await controller.createBackup();

    expect(request).toHaveBeenNthCalledWith(1, "/system/backups/", expect.objectContaining({ method: "POST" }));
    expect(request).toHaveBeenNthCalledWith(2, "/system/backups/", expect.any(Object));
    expect(controller.backupCreating.value).toBe(false);
    expect(controller.backups.value).toEqual([backup]);
  });

  it("marks a network write failure as an unconfirmed result without retrying", async () => {
    const request = vi.fn<RequestFn>().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { controller } = createController(request);
    controller.openRestore(backup);
    controller.restoreConfirmation.value = "RESTORE INFRIX";

    await controller.restore();

    expect(controller.uncertainOperation.value).toBe(true);
    expect(controller.backupError.value).toBe(
      String(i18n.global.t("settings.maintenanceOperationUnknown")),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("resets through the maintenance action and reloads after success", async () => {
    const request = vi.fn<RequestFn>().mockResolvedValueOnce({ detail: "系统已恢复初始状态" });
    const { controller, deps } = createController(request);
    controller.openSystemResetDialog();
    controller.resetConfirmation.value = controller.systemResetConfirmationToken.value;

    await controller.resetSystem();

    expect(request).toHaveBeenCalledWith("/system/reset/", expect.objectContaining({ method: "POST" }));
    expect(deps.reload).toHaveBeenCalledOnce();
    expect(controller.systemResetSaving.value).toBe(false);
  });
});
