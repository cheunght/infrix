import { computed, ref, watch, type Ref } from "vue";
import { isAbortError } from "../api";
import {
  clearFieldError,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";
import { i18n } from "../i18n";
import { applySystemSettings as applySystemSettingsSnapshot } from "../system-settings";
import type {
  SystemSettings,
  SystemSettingsForm,
  SystemSettingsPatch,
  SystemSettingsSnapshot,
} from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

type FormErrors = Record<string, string>;

export interface SystemSettingsDeps {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  can: CapabilityFn;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
}

export type SystemSettingsGroup =
  "general" | "security" | "smtp" | "notifications";

const DEFAULT_SYSTEM_SETTINGS_FORM: SystemSettingsForm = {
  email_digest_enabled: false,
  email_digest_people: [],
  email_digest_recipients: [],
  application_url: "",
  default_page_size: 50,
  default_asset_status: "in_stock",
  default_locale: "zh-CN",
  date_format: "YYYY-MM-DD",
  currency: "CNY",
  password_min_length: 8,
  password_expiry_days: 0,
  login_max_attempts: 5,
  login_window_seconds: 900,
  login_lock_seconds: 900,
  smtp_enabled: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_security_mode: "starttls",
  smtp_username: "",
  smtp_password: "",
  smtp_from_email: "",
  smtp_from_name: "",
  smtp_timeout: 10,
  notify_maintenance: true,
  maintenance_expiry_days: 30,
  notify_license_expiry: true,
  license_expiry_days: 30,
  notify_open_faults: true,
  notify_overdue_inventory: true,
  notify_low_spare_stock: true,
};

const GROUP_FIELDS: Record<
  SystemSettingsGroup,
  readonly (keyof SystemSettingsForm)[]
> = {
  general: [
    "default_page_size",
    "default_asset_status",
    "default_locale",
    "date_format",
    "currency",
  ],
  security: [
    "password_min_length",
    "password_expiry_days",
    "login_max_attempts",
    "login_window_seconds",
    "login_lock_seconds",
  ],
  smtp: [
    "smtp_enabled",
    "smtp_host",
    "smtp_port",
    "smtp_security_mode",
    "smtp_username",
    "smtp_password",
    "smtp_from_email",
    "smtp_from_name",
    "smtp_timeout",
  ],
  notifications: [
    "notify_maintenance",
    "maintenance_expiry_days",
    "notify_license_expiry",
    "license_expiry_days",
    "notify_open_faults",
    "notify_overdue_inventory",
    "notify_low_spare_stock",
    "email_digest_enabled",
    "email_digest_people",
    "email_digest_recipients",
    "application_url",
  ],
};

const SMTP_PATCH_FIELDS: Record<string, string> = {
  smtp_enabled: "enabled",
  smtp_host: "host",
  smtp_port: "port",
  smtp_security_mode: "security_mode",
  smtp_username: "username",
  smtp_from_email: "from_email",
  smtp_from_name: "from_name",
  smtp_timeout: "timeout",
};

function cloneFormValue(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value;
}

function flattenSnapshot(snapshot: SystemSettingsSnapshot): SystemSettings {
  return {
    ...snapshot.general,
    ...snapshot.security,
    smtp_enabled: snapshot.smtp.enabled,
    smtp_host: snapshot.smtp.host,
    smtp_port: snapshot.smtp.port,
    smtp_security_mode: snapshot.smtp.security_mode,
    smtp_username: snapshot.smtp.username,
    smtp_from_email: snapshot.smtp.from_email,
    smtp_from_name: snapshot.smtp.from_name,
    smtp_timeout: snapshot.smtp.timeout,
    smtp_password_configured: snapshot.smtp.password_configured,
    ...snapshot.notifications.in_app,
    ...snapshot.notifications.email_digest,
    timezone: snapshot.runtime.timezone,
  };
}

function pathToLegacyField(path: string): keyof SystemSettingsForm | null {
  const direct = new Set<string>([
    "default_page_size",
    "default_asset_status",
    "default_locale",
    "date_format",
    "currency",
    "password_min_length",
    "password_expiry_days",
    "login_max_attempts",
    "login_window_seconds",
    "login_lock_seconds",
    "notify_maintenance",
    "maintenance_expiry_days",
    "notify_license_expiry",
    "license_expiry_days",
    "notify_open_faults",
    "notify_overdue_inventory",
    "notify_low_spare_stock",
    "email_digest_enabled",
    "email_digest_people",
    "email_digest_recipients",
    "application_url",
  ]);
  if (direct.has(path)) return path as keyof SystemSettingsForm;
  if (path.startsWith("smtp.")) {
    const key = path.slice("smtp.".length);
    if (key === "password" || key === "password_configured")
      return key === "password" ? "smtp_password" : null;
    const legacy = Object.entries(SMTP_PATCH_FIELDS).find(
      ([, value]) => value === key,
    )?.[0];
    return (legacy as keyof SystemSettingsForm | undefined) || null;
  }
  if (path.startsWith("notifications.in_app.")) {
    const key = path.slice("notifications.in_app.".length);
    return direct.has(key) ? (key as keyof SystemSettingsForm) : null;
  }
  if (path.startsWith("notifications.email_digest.")) {
    const key = path.slice("notifications.email_digest.".length);
    return direct.has(key) ? (key as keyof SystemSettingsForm) : null;
  }
  return null;
}

function settingsFieldErrors(error: unknown): FormErrors {
  const normalized = normalizeApiError(error);
  const result: FormErrors = {};
  for (const [path, messages] of Object.entries(normalized.fieldErrors)) {
    const field = pathToLegacyField(path);
    if (field) result[field] = messages.join("；");
  }
  return result;
}

function cloneSystemSettingsForm(value: SystemSettings): SystemSettingsForm {
  const form = { ...value } as unknown as SystemSettingsForm;
  form.smtp_password = "";
  for (const key of Object.keys(form) as Array<keyof SystemSettingsForm>) {
    form[key] = cloneFormValue(form[key]) as never;
  }
  return form;
}

function patchFromForm(
  form: SystemSettingsForm,
  keys: readonly (keyof SystemSettingsForm)[],
): SystemSettingsPatch {
  const payload: Record<string, Record<string, unknown>> = {};
  const put = (group: string, key: string, value: unknown) => {
    payload[group] ||= {};
    payload[group][key] = cloneFormValue(value);
  };
  const general = new Set(GROUP_FIELDS.general);
  const security = new Set(GROUP_FIELDS.security);
  const notifications = new Set(GROUP_FIELDS.notifications);
  const digestFields = new Set([
    "email_digest_enabled",
    "email_digest_people",
    "email_digest_recipients",
    "application_url",
  ]);
  const notificationPatch = {
    in_app: {} as Record<string, unknown>,
    email_digest: {} as Record<string, unknown>,
  };
  for (const key of keys) {
    if (key === "smtp_password") {
      if (form.smtp_password) {
        payload.smtp ||= {};
        payload.smtp.password = form.smtp_password;
      }
    } else if (general.has(key)) {
      put("general", key, form[key]);
    } else if (security.has(key)) {
      put("security", key, form[key]);
    } else if (notifications.has(key)) {
      const group = digestFields.has(key) ? "email_digest" : "in_app";
      notificationPatch[group][key] = cloneFormValue(form[key]);
    } else if (key in SMTP_PATCH_FIELDS) {
      put("smtp", SMTP_PATCH_FIELDS[key], form[key]);
    }
  }
  if (
    Object.keys(notificationPatch.in_app).length ||
    Object.keys(notificationPatch.email_digest).length
  ) {
    payload.notifications = notificationPatch;
  }
  return payload as unknown as SystemSettingsPatch;
}

export function useSystemSettings(deps: SystemSettingsDeps) {
  const systemSettingsSnapshot = ref<SystemSettingsSnapshot | null>(null);
  const systemSettings = ref<SystemSettings | null>(null);
  const systemSettingsForm = ref<SystemSettingsForm>({
    ...DEFAULT_SYSTEM_SETTINGS_FORM,
  });
  const systemSettingsLoading = ref(false);
  const systemSettingsSaving = ref(false);
  const systemSettingsError = ref("");
  const systemSettingsFormErrors = ref<FormErrors>({});
  const systemSettingsRequestId = ref(0);
  const systemSmtpTesting = ref(false);
  const systemSmtpTestRecipient = ref("");
  let systemSettingsLoadController: AbortController | null = null;

  const systemSettingsGroupDirty = computed<
    Record<SystemSettingsGroup, boolean>
  >(() => {
    const result = {
      general: false,
      security: false,
      smtp: false,
      notifications: false,
    } as Record<SystemSettingsGroup, boolean>;
    if (!systemSettings.value) return result;
    const baseline = systemSettings.value as unknown as Record<string, unknown>;
    for (const group of Object.keys(GROUP_FIELDS) as SystemSettingsGroup[]) {
      result[group] = GROUP_FIELDS[group].some((key) =>
        key === "smtp_password"
          ? Boolean(systemSettingsForm.value.smtp_password)
          : JSON.stringify(systemSettingsForm.value[key]) !==
            JSON.stringify(baseline[key]),
      );
    }
    return result;
  });
  const systemSettingsDirty = computed(() =>
    Object.values(systemSettingsGroupDirty.value).some(Boolean),
  );

  function setActionMessage(
    message: string,
    type: ActionMessageType = "success",
  ) {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function syncFormFields(
    value: SystemSettings,
    keys: readonly (keyof SystemSettingsForm)[],
  ) {
    for (const key of keys) {
      systemSettingsForm.value[key] = (
        key === "smtp_password" ? "" : cloneFormValue(value[key])
      ) as never;
    }
  }

  function clearSystemSettingsFormErrors(
    keys: readonly (keyof SystemSettingsForm)[],
  ) {
    const cleared = new Set(keys);
    systemSettingsFormErrors.value = Object.fromEntries(
      Object.entries(systemSettingsFormErrors.value).filter(
        ([key]) => !cleared.has(key as keyof SystemSettingsForm),
      ),
    );
  }

  for (const key of Object.keys(DEFAULT_SYSTEM_SETTINGS_FORM) as Array<
    keyof SystemSettingsForm
  >) {
    watch(
      () => systemSettingsForm.value[key],
      () => {
        if (systemSettingsFormErrors.value[key]) {
          systemSettingsFormErrors.value = clearFieldError(
            systemSettingsFormErrors.value,
            key,
          );
        }
      },
      { deep: true },
    );
  }

  async function loadSystemSettings(
    version = deps.beginLoad(),
  ): Promise<boolean> {
    if (!deps.can("settings.view")) return false;
    const requestId = ++systemSettingsRequestId.value;
    systemSettingsLoadController?.abort();
    const controller = new AbortController();
    systemSettingsLoadController = controller;
    systemSettingsLoading.value = true;
    systemSettingsError.value = "";
    try {
      const result = await deps.request<SystemSettingsSnapshot>(
        "/system/settings/",
        {
          signal: controller.signal,
        },
      );
      if (
        result == null ||
        requestId !== systemSettingsRequestId.value ||
        !deps.isCurrentLoad(version)
      )
        return false;
      systemSettingsSnapshot.value = result;
      const flat = flattenSnapshot(result);
      systemSettings.value = flat;
      systemSettingsForm.value = cloneSystemSettingsForm(flat);
      applySystemSettingsSnapshot(result);
      return true;
    } catch (error) {
      if (
        requestId === systemSettingsRequestId.value &&
        deps.isCurrentLoad(version) &&
        !controller.signal.aborted &&
        !isAbortError(error)
      ) {
        systemSettingsError.value =
          normalizeApiError(error).message ||
          tr("settings.systemSettingsLoadFailed");
      }
      return false;
    } finally {
      if (
        requestId === systemSettingsRequestId.value &&
        systemSettingsLoadController === controller
      ) {
        systemSettingsLoadController = null;
        systemSettingsLoading.value = false;
      }
    }
  }

  function resetSystemSettingsForm(
    keys: readonly (keyof SystemSettingsForm)[] = Object.keys(
      DEFAULT_SYSTEM_SETTINGS_FORM,
    ) as Array<keyof SystemSettingsForm>,
  ) {
    if (systemSettings.value) syncFormFields(systemSettings.value, keys);
    clearSystemSettingsFormErrors(keys);
  }

  async function saveSystemSettings(
    keys: readonly (keyof SystemSettingsForm)[] = Object.keys(
      DEFAULT_SYSTEM_SETTINGS_FORM,
    ) as Array<keyof SystemSettingsForm>,
  ): Promise<void> {
    if (systemSettingsSaving.value) return;
    if (!deps.can("settings.manage")) {
      setActionMessage(tr("settings.settingsPermissionDenied"), "error");
      return;
    }
    const submittedKeys = [...new Set(keys)];
    if (!submittedKeys.length) return;
    systemSettingsSaving.value = true;
    clearSystemSettingsFormErrors(submittedKeys);
    try {
      const result = await deps.request<SystemSettingsSnapshot>(
        "/system/settings/",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            patchFromForm(systemSettingsForm.value, submittedKeys),
          ),
        },
      );
      systemSettingsSnapshot.value = result;
      const flat = flattenSnapshot(result);
      systemSettings.value = flat;
      syncFormFields(flat, submittedKeys);
      applySystemSettingsSnapshot(result);
      setActionMessage(tr("settings.settingsSaved"));
    } catch (error) {
      systemSettingsFormErrors.value = {
        ...systemSettingsFormErrors.value,
        ...settingsFieldErrors(error),
      };
      setActionMessage(
        normalizeApiError(error).message || tr("settings.settingsSaveFailed"),
        "error",
      );
    } finally {
      systemSettingsSaving.value = false;
    }
  }

  function retrySystemSettings(): Promise<boolean> {
    return loadSystemSettings();
  }

  async function testSystemSmtp(): Promise<void> {
    if (systemSmtpTesting.value) return;
    if (!deps.can("settings.manage")) {
      setActionMessage(tr("settings.settingsPermissionDenied"), "error");
      return;
    }
    const recipient = systemSmtpTestRecipient.value.trim();
    if (!recipient) {
      setActionMessage(tr("settings.smtpTestRecipientRequired"), "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setActionMessage(tr("validation.invalidEmail"), "error");
      return;
    }
    systemSmtpTesting.value = true;
    try {
      await deps.request("/system/settings/smtp/test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient }),
      });
      setActionMessage(tr("settings.smtpTestSent"));
    } catch (error) {
      setActionMessage(
        normalizeApiError(error).message || tr("settings.smtpTestFailed"),
        "error",
      );
    } finally {
      systemSmtpTesting.value = false;
    }
  }

  return {
    systemSettingsSnapshot,
    systemSettings,
    systemSettingsForm,
    systemSettingsLoading,
    systemSettingsSaving,
    systemSettingsError,
    systemSettingsFormErrors,
    systemSettingsGroupDirty,
    systemSettingsDirty,
    systemSmtpTesting,
    systemSmtpTestRecipient,
    loadSystemSettings,
    retrySystemSettings,
    resetSystemSettingsForm,
    saveSystemSettings,
    testSystemSmtp,
  };
}
