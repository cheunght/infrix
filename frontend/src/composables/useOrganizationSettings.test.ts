import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useApiClient } from "./useApiClient";
import { useOrganizationSettings } from "./useOrganizationSettings";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function page(results: unknown[]) {
  return { count: results.length, next: null, previous: null, results };
}

function setupSettings() {
  const client = useApiClient({ csrfToken: ref("test-csrf"), authenticated: ref(true) });
  const actionMessage = ref("");
  const actionMessageType = ref<"success" | "error" | null>(null);
  const settings = useOrganizationSettings({
    request: client.request,
    beginLoad: client.beginLoad,
    isCurrentLoad: client.isCurrentLoad,
    confirmAction: async () => true,
    can: () => true,
    currentUsername: ref("operator"),
    downloadFile: async () => {},
    actionMessage,
    actionMessageType,
  });
  return { client, settings, actionMessage, actionMessageType };
}

afterEach(() => vi.unstubAllGlobals());

describe("Department Import refresh", () => {
  it("keeps both Department and Responsibility Directory data after a successful import", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      requested.push(path);
      if (path.endsWith("/departments/import/preview/")) {
        return jsonResponse({ error: 0, ignored_columns: [], rows: [] });
      }
      if (path.endsWith("/departments/import/")) {
        return jsonResponse({ created: 1, updated: 0, unchanged: 0, total: 1, errors: [] });
      }
      if (path.includes("/departments/?")) {
        return jsonResponse(page([{ id: 7, code: "001", name: "新部门" }]));
      }
      if (path.includes("/people/?")) {
        return jsonResponse(page([{ id: 9, name: "张三", employee_no: "E9", department: 7 }]));
      }
      throw new Error(`Unexpected request: ${path}`);
    }));

    const { settings, actionMessageType } = setupSettings();
    settings.openDepartmentImport();
    expect(await settings.previewDepartmentImport(new File(["xlsx"], "departments.xlsx"))).toBe(true);

    expect(await settings.commitDepartmentImport()).toBe(true);
    expect(requested.some((path) => path.includes("/departments/?"))).toBe(true);
    expect(requested.some((path) => path.includes("/people/?"))).toBe(true);
    expect(settings.departments.value.map((department) => department.code)).toEqual(["001"]);
    expect(settings.departmentOptions.value.map((department) => department.code)).toEqual(["001"]);
    expect(settings.responsibilityDirectorySubjects.value.map((person) => person.employee_no)).toEqual(["E9"]);
    expect(settings.departmentLoading.value).toBe(false);
    expect(settings.responsibilityDirectoryLoading.value).toBe(false);
    expect(actionMessageType.value).toBe("success");
  });

  it("does not let an older Department response replace a newer one", async () => {
    const firstResponses: Array<(response: Response) => void> = [];
    let departmentRequests = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (!path.includes("/departments/?")) throw new Error(`Unexpected request: ${path}`);
      departmentRequests += 1;
      if (departmentRequests <= 2) {
        return new Promise<Response>((resolve) => firstResponses.push(resolve));
      }
      return Promise.resolve(jsonResponse(page([{ id: 8, code: "NEW", name: "新结果" }])));
    }));

    const { settings } = setupSettings();
    const olderLoad = settings.loadDepartments();
    const newerLoad = settings.loadDepartments();

    expect(await newerLoad).toBe(true);
    expect(settings.departments.value.map((department) => department.code)).toEqual(["NEW"]);
    for (const resolve of firstResponses) {
      resolve(jsonResponse(page([{ id: 7, code: "OLD", name: "旧结果" }])));
    }
    expect(await olderLoad).toBe(false);
    expect(settings.departments.value.map((department) => department.code)).toEqual(["NEW"]);
    expect(settings.departmentLoading.value).toBe(false);
  });

  it("reports a refresh failure without treating a successful import as a failed mutation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/departments/import/preview/")) {
        return jsonResponse({ error: 0, ignored_columns: [], rows: [] });
      }
      if (path.endsWith("/departments/import/")) {
        return jsonResponse({ created: 1, updated: 0, unchanged: 0, total: 1, errors: [] });
      }
      if (path.includes("/departments/?")) return jsonResponse({ detail: "refresh unavailable" }, 500);
      if (path.includes("/people/?")) return jsonResponse(page([]));
      throw new Error(`Unexpected request: ${path}`);
    }));

    const { settings, actionMessage, actionMessageType } = setupSettings();
    settings.openDepartmentImport();
    expect(await settings.previewDepartmentImport(new File(["xlsx"], "departments.xlsx"))).toBe(true);

    expect(await settings.commitDepartmentImport()).toBe(true);
    expect(settings.showDepartmentImportModal.value).toBe(false);
    expect(actionMessageType.value).toBe("error");
    expect(actionMessage.value).toContain("Department import completed");
    expect(actionMessage.value).toContain("could not be refreshed");
    expect(settings.departmentLoading.value).toBe(false);
    expect(settings.responsibilityDirectoryLoading.value).toBe(false);
  });
});
