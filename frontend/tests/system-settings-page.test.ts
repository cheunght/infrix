// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { effectScope, nextTick, ref } from "vue";
import ElementPlus from "element-plus";
import SystemSettingsPage from "../src/components/SystemSettingsPage.vue";
import { useSystemSettings } from "../src/composables/useSystemSettings";
import { ApiError } from "../src/api";
import { i18n } from "../src/i18n";
import type { ActionMessageType } from "../src/error-handling";
import type { SettingsContext, RequestFn } from "../src/page-context";
import type { SystemSettingsTab } from "../src/router";
import type { SystemSettingsSnapshot } from "../src/types";

const snapshot: SystemSettingsSnapshot = {
  schema_version: 2,
  general: {
    default_page_size: 50,
    default_asset_status: "in_stock",
    default_locale: "zh-CN",
    date_format: "YYYY-MM-DD",
    currency: "CNY",
  },
  security: {
    password_min_length: 8,
    password_expiry_days: 0,
    login_max_attempts: 5,
    login_window_seconds: 900,
    login_lock_seconds: 900,
  },
  smtp: {
    enabled: false,
    host: "",
    port: 587,
    security_mode: "starttls",
    username: "",
    from_email: "",
    from_name: "",
    timeout: 10,
    password_configured: false,
  },
  notifications: {
    in_app: {
      notify_maintenance: true,
      maintenance_expiry_days: 30,
      notify_license_expiry: true,
      license_expiry_days: 30,
      notify_open_faults: true,
      notify_overdue_inventory: true,
      notify_low_spare_stock: true,
    },
    email_digest: {
      email_digest_enabled: false,
      email_digest_people: [],
      email_digest_recipients: [],
      application_url: "",
    },
  },
  runtime: { timezone: "Asia/Shanghai" },
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
});

function createPage(tab: SystemSettingsTab = "general", manage = true) {
  let version = 0;
  const request = vi.fn<RequestFn>(
    async <T>() => structuredClone(snapshot) as T,
  );
  const scope = effectScope();
  const can = vi.fn(
    (capability: string) => capability !== "settings.manage" || manage,
  );
  const settings = scope.run(() =>
    useSystemSettings({
      request,
      beginLoad: () => ++version,
      isCurrentLoad: (candidate) => candidate === version,
      can,
      actionMessage: ref(""),
      actionMessageType: ref<ActionMessageType | null>(null),
    }),
  )!;
  cleanups.push(() => scope.stop());
  const context = {
    ...settings,
    request,
    can,
    systemSettingsTab: ref(tab),
    changeSystemSettingsTab: vi.fn(),
  } as unknown as SettingsContext;
  const wrapper = mount(SystemSettingsPage, {
    props: { context },
    global: {
      plugins: [i18n, ElementPlus],
      stubs: { SearchableSelect: true },
    },
  });
  cleanups.push(() => wrapper.unmount());
  return { wrapper, settings, request, context, can };
}

function saveButton(wrapper: VueWrapper) {
  return wrapper.get(".settings-system__actions .el-button--primary");
}

describe("system settings page with the application's plain ref context", () => {
  it("shows the form after a successful response without an error or busy state", async () => {
    const { wrapper, settings } = createPage();
    await settings.loadSystemSettings();
    await flushPromises();

    expect(settings.systemSettingsError.value).toBe("");
    expect(wrapper.find(".el-alert--error").exists()).toBe(false);
    expect(
      wrapper.findAll(".el-loading-mask").every((mask) => !mask.isVisible()),
    ).toBe(true);
    expect(saveButton(wrapper).classes()).not.toContain("is-loading");
    expect(wrapper.findAll(".el-select")).toHaveLength(5);
  });

  it.each(["general", "security", "smtp", "notifications"] as const)(
    "enables %s inputs when idle and disables them only while saving",
    async (tab) => {
      const { wrapper, settings } = createPage(tab);
      await settings.loadSystemSettings();
      await flushPromises();
      const inputs = () => wrapper.findAll(".settings-system__section input");
      expect(inputs().length).toBeGreaterThan(0);
      expect(
        inputs().every(
          (input) => !(input.element as HTMLInputElement).disabled,
        ),
      ).toBe(true);

      settings.systemSettingsSaving.value = true;
      await nextTick();
      // The SMTP test recipient has its own independent busy state.
      const controls = () =>
        inputs().filter((input) => input.attributes("type") !== "email");
      expect(
        controls().every(
          (input) => (input.element as HTMLInputElement).disabled,
        ),
      ).toBe(true);
      settings.systemSettingsSaving.value = false;
      await nextTick();
      expect(
        inputs().every(
          (input) => !(input.element as HTMLInputElement).disabled,
        ),
      ).toBe(true);
    },
  );

  it("shows a real failure and recovers through the retry button", async () => {
    const { wrapper, settings, request } = createPage();
    request.mockRejectedValueOnce(
      new ApiError(503, "Settings temporarily unavailable"),
    );
    await settings.loadSystemSettings();
    await flushPromises();
    expect(settings.systemSettingsError.value).not.toBe("");
    expect(wrapper.get(".el-alert--error").text()).toContain(
      settings.systemSettingsError.value,
    );
    expect(wrapper.get(".el-alert--error .el-button").classes()).not.toContain(
      "is-loading",
    );

    let resolve!: (value: SystemSettingsSnapshot) => void;
    request.mockReturnValueOnce(
      new Promise<SystemSettingsSnapshot>((done) => {
        resolve = done;
      }),
    );
    await wrapper.get(".el-alert--error .el-button").trigger("click");
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      wrapper.findAll(".el-loading-mask").some((mask) => mask.isVisible()),
    ).toBe(true);
    expect(wrapper.find(".el-alert--error").exists()).toBe(false);

    resolve(structuredClone(snapshot));
    await flushPromises();
    expect(
      wrapper.findAll(".el-loading-mask").every((mask) => !mask.isVisible()),
    ).toBe(true);
    expect(wrapper.find(".el-alert--error").exists()).toBe(false);
    expect(wrapper.findAll(".el-select")).toHaveLength(5);
  });

  it("enables save for an edit, restores it, and reflects an actual pending save", async () => {
    const { wrapper, settings, request } = createPage();
    await settings.loadSystemSettings();
    await flushPromises();
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();

    const pageSize = wrapper.findAllComponents({ name: "ElSelect" })[0];
    pageSize.vm.$emit("update:modelValue", 100);
    await nextTick();
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    await wrapper.get(".settings-system__actions .el-button").trigger("click");
    expect(pageSize.props("modelValue")).toBe(50);
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();

    pageSize.vm.$emit("update:modelValue", 100);
    await nextTick();
    let resolve!: (value: SystemSettingsSnapshot) => void;
    request.mockReturnValueOnce(
      new Promise<SystemSettingsSnapshot>((done) => {
        resolve = done;
      }),
    );
    await saveButton(wrapper).trigger("click");
    expect(saveButton(wrapper).classes()).toContain("is-loading");
    expect(pageSize.props("disabled")).toBe(true);
    const [path, options] = request.mock.calls.at(-1)!;
    expect(path).toBe("/system/settings/");
    expect(options?.method).toBe("PATCH");
    expect(JSON.parse(String(options?.body))).toEqual({
      general: { ...snapshot.general, default_page_size: 100 },
    });

    resolve({
      ...structuredClone(snapshot),
      general: { ...snapshot.general, default_page_size: 100 },
    });
    await flushPromises();
    expect(saveButton(wrapper).classes()).not.toContain("is-loading");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    expect(pageSize.props("disabled")).toBe(false);
    expect(pageSize.props("modelValue")).toBe(100);
  });

  it("keeps the SMTP test action beside its recipient field", async () => {
    const { wrapper, settings } = createPage("smtp");
    await settings.loadSystemSettings();
    await flushPromises();

    const actionRow = wrapper.get(".settings-system__smtp-test-row");
    expect(actionRow.find("input[type='email']").exists()).toBe(true);
    expect(actionRow.find(".el-button").text()).toContain(
      String(i18n.global.t("settings.smtpTest")),
    );
    expect(
      wrapper
        .get(".settings-system__smtp-test-controls .settings-system__help")
        .exists(),
    ).toBe(true);
  });

  it.each(["general", "security", "smtp", "notifications"] as const)(
    "preserves read-only access on %s",
    async (tab) => {
      const { wrapper, settings } = createPage(tab, false);
      await settings.loadSystemSettings();
      await flushPromises();
      expect(wrapper.find(".el-alert--error").exists()).toBe(false);
      expect(wrapper.find(".settings-system__readonly-alert").exists()).toBe(
        true,
      );
      expect(
        wrapper.find(".settings-system__actions .el-button--primary").exists(),
      ).toBe(false);
      const inputs = wrapper.findAll(".settings-system__section input");
      expect(inputs.length).toBeGreaterThan(0);
      expect(
        inputs.every((input) => (input.element as HTMLInputElement).disabled),
      ).toBe(true);
    },
  );
});
