import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import { type FormInstance, type FormRules } from "element-plus";
import { ApiError, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import {
  clearFieldError,
  fieldErrorsToText,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";
import type {
  AuditLog,
  Person,
  CustomField,
  CustomFieldForm,
  CustomFieldOption,
  Department,
  DictionaryItem,
  LdapDiagnosticCheck,
  LdapDiagnosticResult,
  LdapConfiguration,
  LdapConfigurationForm,
  LdapStatus,
  ManagedUser,
  Role,
  SparePartCategory,
  SystemSettingDefinition,
  SystemSettings,
  SystemSettingsForm,
  Tag,
  UserBatchStatusResponse,
  PersonFormState,
} from "../types";
import type { SettingsSection } from "../router";
import type { CapabilityFn, RequestFn } from "../page-context";
import {
  applySystemSettings as applySystemSettingsSnapshot,
  systemSettingsState,
} from "../system-settings";
import { i18n } from "../i18n";
import { formatSystemDateTime } from "../system-settings";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

export interface SettingsDeps {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  reload: () => void;
  can: CapabilityFn;
  currentUsername: Ref<string>;
  settingsSection: Ref<SettingsSection>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
}

export const SYSTEM_RESET_CONFIRMATION = "RESET INFRIX";

type CustomFieldOptionForm = {
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

type FormErrors = Record<string, string>;

const DEFAULT_SYSTEM_SETTINGS_FORM: SystemSettingsForm = {
  email_digest_enabled: false,
  email_digest_recipients: [],
  application_url: "",
  default_page_size: 50,
  default_asset_status: "in_stock",
  default_locale: "zh-CN",
  timezone: "Asia/Shanghai",
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

const SYSTEM_SETTINGS_VALUE_KEYS: Array<keyof Omit<SystemSettingsForm, "smtp_password">> = [
  "email_digest_enabled", "email_digest_recipients", "application_url",
  "default_page_size",
  "default_asset_status",
  "default_locale",
  "timezone",
  "date_format",
  "currency",
  "password_min_length",
  "password_expiry_days",
  "login_max_attempts",
  "login_window_seconds",
  "login_lock_seconds",
  "smtp_enabled",
  "smtp_host",
  "smtp_port",
  "smtp_security_mode",
  "smtp_username",
  "smtp_from_email",
  "smtp_from_name",
  "smtp_timeout",
  "notify_maintenance",
  "maintenance_expiry_days",
  "notify_license_expiry",
  "license_expiry_days",
  "notify_open_faults",
  "notify_overdue_inventory",
  "notify_low_spare_stock",
];

const LDAP_CONFIGURATION_FIELDS = [
  "enabled", "directory_type", "primary_host", "primary_port", "secondary_host", "secondary_port",
  "base_dn", "bind_dn", "bind_password", "security_mode", "tls_server_name", "ca_cert_file",
  "user_search_base", "user_login_attribute", "user_filter", "external_id_attribute",
  "email_attribute", "first_name_attribute", "last_name_attribute", "account_control_attribute",
  "connect_timeout", "operation_timeout",
] as const;

function extractFieldErrors(error: unknown, allowedFields: readonly string[]): FormErrors {
  return fieldErrorsToText(normalizeApiError(error).fieldErrors, allowedFields);
}

export function useSettings(deps: SettingsDeps) {
  const manufacturers = ref<DictionaryItem[]>([]);
  const deviceTypes = ref<DictionaryItem[]>([]);
  const spareCategories = ref<SparePartCategory[]>([]);
  const dictionaryRows = ref<Array<DictionaryItem | SparePartCategory>>([]);
  const dictionaryTotal = ref(0);
  const dictionaryReferencesLoaded = ref(false);
  const customFields = ref<CustomField[]>([]);
  const customFieldTotal = ref(0);
  const customFieldPage = ref(1);
  const customFieldPageSize = ref(50);
  const customFieldDeviceType = ref("");
  const customFieldActive = ref("");
  const customFieldForm = ref<CustomFieldForm>({
    device_type: "",
    key: "",
    name: "",
    field_type: "text",
    required: false,
    default_value: "",
    sort_order: 0,
    is_active: true,
    group: "",
    help_text: "",
    placeholder: "",
    form_visible: true,
    detail_visible: true,
    list_visible: false,
    filterable: false,
    validation_config: {},
  });
  const customFieldOptionForm = ref<CustomFieldOptionForm>({
    value: "",
    label: "",
    sort_order: 0,
    is_active: true,
  });
  const editingCustomField = ref<CustomField | null>(null);
  const editingCustomFieldOption = ref<CustomFieldOption | null>(null);
  const showCustomFieldModal = ref(false);
  const showCustomFieldOptionModal = ref(false);
  const customFieldListLoading = ref(false);
  const customFieldListError = ref("");
  const customFieldOptionLoading = ref(false);
  const customFieldOptionError = ref("");
  const customFieldOptionPage = ref(1);
  const customFieldOptionPageSize = ref(20);
  const customFieldOptionTotal = ref(0);
  const customFieldRequestId = ref(0);
  const customFieldOptionRequestId = ref(0);
  const customFieldSaving = ref(false);
  const customFieldOptionSaving = ref(false);
  const customFieldActionId = ref<number | null>(null);
  const customFieldOptionActionId = ref<number | null>(null);
  const customFieldFormErrors = ref<FormErrors>({});
  const customFieldOptionFormErrors = ref<FormErrors>({});

  const tags = ref<Tag[]>([]);
  const tagRows = ref<Tag[]>([]);
  const tagTotal = ref(0);
  const tagReferencesLoaded = ref(false);
  const tagPage = ref(1);
  const tagPageSize = ref(50);
  const tagSearch = ref("");
  const tagActive = ref("");
  const tagForm = ref({ name: "", is_active: true });
  const editingTag = ref<Tag | null>(null);
  const showTagModal = ref(false);
  const tagListLoading = ref(false);
  const tagListError = ref("");
  const tagRequestId = ref(0);
  let tagController: AbortController | null = null;
  const tagSaving = ref(false);
  const tagActionId = ref<number | null>(null);
  const tagFormErrors = ref<FormErrors>({});

  const users = ref<ManagedUser[]>([]);
  const roles = ref<Role[]>([]);
  const userSearch = ref("");
  const userPage = ref(1);
  const userPageSize = ref(20);
  const userCount = ref(0);
  const selectedUserIds = ref<number[]>([]);
  const userBatchSaving = ref(false);
  const userBatchResult = ref<UserBatchStatusResponse | null>(null);
  const showUserBatchResult = ref(false);
  const showUserModal = ref(false);
  const editingUser = ref<ManagedUser | null>(null);
  const showUserResetModal = ref(false);
  const resettingUser = ref<ManagedUser | null>(null);
  const userResetForm = ref({ new_password: "", confirm_password: "" });
  const userResetSaving = ref(false);
  const userResetError = ref("");
  const userResetFormErrors = ref<FormErrors>({});
  const userForm = ref({
    username: "",
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm_password: "",
    is_active: true,
    role_code: "auditor",
    person_id: "",
  });
  const userFormRef = ref<FormInstance>();
  const userResetFormRef = ref<FormInstance>();
  const organizationLoading = ref(false);
  const userListError = ref("");
  const roleListError = ref("");
  const organizationRequestId = ref(0);
  const userRequestId = ref(0);
  const userSaving = ref(false);
  const userPendingId = ref<number | null>(null);
  const userFormErrors = ref<FormErrors>({});
  const unlinkedPeople = ref<Person[]>([]);
  const unlinkedPeopleLoading = ref(false);
  const unlinkedPeopleError = ref("");
  const unlinkedPeopleRequestId = ref(0);
  const userFormRules = computed<FormRules>(() => ({
    username: [{ required: true, message: tr("settings.usernameRequired"), trigger: "blur" }],
    last_name: [{ required: true, message: tr("settings.lastNameRequired"), trigger: "blur" }],
    first_name: [{ required: true, message: tr("settings.firstNameRequired"), trigger: "blur" }],
    email: [{ type: "email", message: tr("validation.invalidEmail"), trigger: ["blur", "change"] }],
    role_code: [{ required: true, message: tr("settings.roleRequired"), trigger: "change" }],
    password: [
      {
        validator: (_rule, value, callback) => {
          const password = String(value || "");
          if (!editingUser.value && !password) callback(new Error(tr("settings.passwordRequired")));
          else if (password && password.length < systemSettingsState.passwordMinLength) {
            callback(new Error(tr("validation.passwordMin", { min: systemSettingsState.passwordMinLength })));
          }
          else callback();
        },
        trigger: ["blur", "change"],
      },
    ],
    confirm_password: [
      {
        validator: (_rule, value, callback) => {
          const password = String(userForm.value.password || "");
          const confirmation = String(value || "");
          if (editingUser.value && !password && !confirmation) callback();
          else if (!confirmation) callback(new Error(tr("settings.confirmPasswordRequired")));
          else if (confirmation !== password) callback(new Error(tr("validation.passwordMismatch")));
          else callback();
        },
        trigger: ["blur", "change"],
      },
    ],
  }));
  const userResetFormRules = computed<FormRules>(() => ({
    new_password: [
      { required: true, message: tr("settings.newPasswordRequired"), trigger: "blur" },
      {
        validator: (_rule, value, callback) => {
          const password = String(value || "");
          if (password && password.length < systemSettingsState.passwordMinLength) {
            callback(new Error(tr("validation.passwordMin", { min: systemSettingsState.passwordMinLength })));
          } else {
            callback();
          }
        },
        trigger: ["blur", "change"],
      },
    ],
    confirm_password: [
      { required: true, message: tr("settings.confirmNewPasswordRequired"), trigger: "blur" },
      {
        validator: (_rule, value, callback) => {
          if (String(value || "") !== String(userResetForm.value.new_password || "")) {
            callback(new Error(tr("validation.passwordMismatch")));
          } else {
            callback();
          }
        },
        trigger: ["blur", "change"],
      },
    ],
  }));
  const dictionarySection = ref<"manufacturers" | "device-types" | "spare-categories">("manufacturers");
  const dictionaryPage = ref(1);
  const dictionaryPageSize = ref(50);
  const dictionarySearch = ref("");
  const showDictionaryModal = ref(false);
  const editingDictionary = ref<DictionaryItem | null>(null);
  const dictionaryForm = ref({ name: "", code: "", color: "#1677EF", is_active: true });
  const dictionaryLoading = ref(false);
  const dictionaryError = ref("");
  const dictionaryRequestId = ref(0);
  let dictionaryController: AbortController | null = null;
  const dictionarySaving = ref(false);
  const dictionaryActionId = ref<number | null>(null);
  const dictionaryFormErrors = ref<FormErrors>({});

  const departments = ref<Department[]>([]);
  const departmentOptions = ref<Department[]>([]);
  const departmentTotal = ref(0);
  const departmentPage = ref(1);
  const departmentPageSize = ref(50);
  const departmentSearch = ref("");
  const departmentLoading = ref(false);
  const departmentError = ref("");
  const departmentRequestId = ref(0);
  let departmentController: AbortController | null = null;
  const departmentSaving = ref(false);
  const departmentActionId = ref<number | null>(null);
  const departmentFormErrors = ref<FormErrors>({});
  const showDepartmentModal = ref(false);
  const editingDepartment = ref<Department | null>(null);
  const departmentForm = ref({ name: "", code: "", parent: "" });

  const responsibilityDirectorySubjects = ref<Person[]>([]);
  const responsibilityDirectoryTotal = ref(0);
  const responsibilityDirectoryPage = ref(1);
  const responsibilityDirectoryPageSize = ref(20);
  const responsibilityDirectorySearch = ref("");
  const responsibilityDirectoryType = ref("");
  const responsibilityDirectoryActive = ref("true");
  const responsibilityDirectoryLoading = ref(false);
  const responsibilityDirectoryError = ref("");
  const responsibilityDirectorySaving = ref(false);
  const responsibilityDirectoryActionId = ref<number | null>(null);
  const responsibilityDirectoryFormErrors = ref<FormErrors>({});
  const responsibilityDirectoryForm = ref<PersonFormState>({
    name: "",
    employee_no: "",
    department: "",
    organization: "",
    contact: "",
    is_active: true,
  });
  const editingResponsibilitySubject = ref<Person | null>(null);
  const showResponsibilitySubjectModal = ref(false);
  const responsibilityDirectoryRequestId = ref(0);
  let responsibilityDirectoryController: AbortController | null = null;

  const auditLogs = ref<AuditLog[]>([]);
  const auditCount = ref(0);
  const auditPage = ref(1);
  const auditPageSize = ref(50);
  const auditFilters = ref({
    search: "",
    actor: "",
    resource_type: "",
    action: "",
    start: "",
    end: "",
  });
  const auditListLoading = ref(false);
  const auditListError = ref("");
  const auditRequestId = ref(0);
  const systemSettings = ref<SystemSettings | null>(null);
  const systemSettingsForm = ref<SystemSettingsForm>({ ...DEFAULT_SYSTEM_SETTINGS_FORM });
  const systemSettingsLoading = ref(false);
  const systemSettingsSaving = ref(false);
  const systemSettingsError = ref("");
  const systemSettingsFormErrors = ref<FormErrors>({});
  const systemSettingsRequestId = ref(0);
  const systemSmtpTesting = ref(false);
  const systemSmtpTestRecipient = ref("");
  const ldapStatus = ref<LdapStatus | null>(null);
  const ldapConfiguration = ref<LdapConfiguration | null>(null);
  const ldapConfigurationForm = ref<LdapConfigurationForm>({
    enabled: false,
    directory_type: "generic_ldap",
    primary_host: "",
    primary_port: 636,
    secondary_host: "",
    secondary_port: null,
    base_dn: "",
    bind_dn: "",
    bind_password: "",
    security_mode: "ldaps",
    tls_server_name: "",
    ca_cert_file: "",
    user_search_base: "",
    user_login_attribute: "uid",
    user_filter: "(&(objectClass=inetOrgPerson)(uid={username}))",
    external_id_attribute: "entryUUID",
    email_attribute: "mail",
    first_name_attribute: "givenName",
    last_name_attribute: "sn",
    account_control_attribute: "",
    connect_timeout: 5,
    operation_timeout: 5,
  });
  const ldapConfigurationLoading = ref(false);
  const ldapConfigurationSaving = ref(false);
  const ldapConfigurationError = ref("");
  const ldapConfigurationFormErrors = ref<FormErrors>({});
  const ldapConfigurationRequestId = ref(0);
  const ldapStatusLoading = ref(false);
  const ldapStatusError = ref("");
  const ldapStatusRequestId = ref(0);
  const ldapDiagnosticLoading = ref(false);
  const ldapDiagnosticResult = ref<LdapDiagnosticResult | null>(null);
  const ldapDiagnosticError = ref("");
  const systemSettingsDefinitions = computed<SystemSettingDefinition[]>(
    () => systemSettings.value?.definitions || [],
  );
  const systemSettingsDirty = computed(() => {
    if (!systemSettings.value) return false;
    return SYSTEM_SETTINGS_VALUE_KEYS.some((key) =>
      JSON.stringify(systemSettingsForm.value[key]) !== JSON.stringify(systemSettings.value?.[key])
    ) || Boolean(systemSettingsForm.value.smtp_password);
  });
  const showSystemResetDialog = ref(false);
  const systemResetConfirmation = ref("");
  const systemResetConfirmationToken = ref(SYSTEM_RESET_CONFIRMATION);
  const systemResetSaving = ref(false);
  const systemResetError = ref("");

  const organizationError = computed(() => userListError.value || roleListError.value);

  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function errorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }

  function setActionError(error: unknown, fallback: string): string {
    const message = errorMessage(error, fallback);
    setActionMessage(message, "error");
    return message;
  }

  function watchFormFieldErrors<T extends object>(
    form: Ref<T>,
    errors: Ref<FormErrors>,
    fields: readonly string[],
  ) {
    for (const field of fields) {
      watch(
        () => (form.value as Record<string, unknown>)[field],
        () => {
          if (errors.value[field]) errors.value = clearFieldError(errors.value, field);
        },
      );
    }
  }

  watchFormFieldErrors(customFieldForm, customFieldFormErrors, [
    "device_type", "key", "name", "field_type", "default_value", "sort_order", "group",
    "help_text", "placeholder", "form_visible", "detail_visible", "list_visible", "filterable",
    "validation_config",
  ]);
  watchFormFieldErrors(customFieldOptionForm, customFieldOptionFormErrors, ["value", "label", "sort_order"]);
  watchFormFieldErrors(tagForm, tagFormErrors, ["name"]);
  watchFormFieldErrors(userForm, userFormErrors, [
    "username", "first_name", "last_name", "email", "password", "confirm_password", "role_code", "person_id",
  ]);
  watchFormFieldErrors(userResetForm, userResetFormErrors, ["new_password", "confirm_password"]);
  watchFormFieldErrors(dictionaryForm, dictionaryFormErrors, ["name", "code", "color"]);
  watchFormFieldErrors(departmentForm, departmentFormErrors, ["name", "code", "parent"]);
  watchFormFieldErrors(responsibilityDirectoryForm, responsibilityDirectoryFormErrors, ["name", "employee_no", "department", "organization", "contact", "is_active"]);
  watchFormFieldErrors(systemSettingsForm, systemSettingsFormErrors, [
    ...SYSTEM_SETTINGS_VALUE_KEYS,
    "smtp_password",
  ]);

  function dictionaryCapability(_kind = dictionarySection.value) {
    return "settings.manage";
  }

  function canManageDictionary(kind = dictionarySection.value) {
    return deps.can(dictionaryCapability(kind));
  }

  function canViewDictionarySection(kind = dictionarySection.value) {
    if (kind === "manufacturers") {
      return (
        deps.can("settings.view") ||
        deps.can("settings.manage") ||
        deps.can("assets.view") ||
        deps.can("assets.manage") ||
        deps.can("licenses.view") ||
        deps.can("licenses.manage") ||
        deps.can("spares.view") ||
        deps.can("spares.manage")
      );
    }
    if (kind === "device-types") return deps.can("settings.view");
    return deps.can("spares.view") || deps.can("spares.manage") || deps.can("settings.manage");
  }

  function invalidateDictionaryReferences() {
    dictionaryReferencesLoaded.value = false;
  }

  function invalidateTagReferences() {
    tagReferencesLoaded.value = false;
  }

  function totalPages(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / pageSize));
  }

  type PagedPayload<T> = PageResult<T> | T[];
  const referencePageSize = 50;

  async function loadAllPages<T>(
    basePath: string,
    version: number,
    isCurrentRequest: () => boolean,
    signal: AbortSignal,
  ): Promise<T[] | null> {
    const rows: T[] = [];
    let page = 1;
    while (deps.isCurrentLoad(version) && isCurrentRequest() && !signal.aborted) {
      const separator = basePath.includes("?") ? "&" : "?";
      const result = await deps.request<PagedPayload<T>>(
        `${basePath}${separator}page=${page}`,
        { signal },
      );
      if (!deps.isCurrentLoad(version) || !isCurrentRequest() || signal.aborted) return null;
      if (Array.isArray(result)) {
        rows.push(...result);
        return rows;
      }
      const pageRows = result.results || [];
      rows.push(...pageRows);
      const hasMore = result.next !== undefined
        ? Boolean(result.next)
        : typeof result.count === "number"
          ? rows.length < result.count
          : pageRows.length >= referencePageSize;
      if (!pageRows.length || !hasMore) return rows;
      page += 1;
    }
    return null;
  }

  async function loadDictionaryReferences(
    version: number,
    requestId: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (dictionaryReferencesLoaded.value) return true;
    const isCurrentRequest = () => requestId === dictionaryRequestId.value;
    const [manufacturerResult, deviceTypeResult, spareCategoryResult] = await Promise.all([
      canViewDictionarySection("manufacturers")
        ? loadAllPages<DictionaryItem>(
            `/manufacturers/?page_size=${referencePageSize}&is_active=all`,
            version,
            isCurrentRequest,
            signal,
          )
        : Promise.resolve<DictionaryItem[]>([]),
      deps.can("settings.view")
        ? loadAllPages<DictionaryItem>(
            `/device-types/?page_size=${referencePageSize}&is_active=all`,
            version,
            isCurrentRequest,
            signal,
          )
        : Promise.resolve<DictionaryItem[]>([]),
      deps.can("spares.view") || deps.can("spares.manage") || deps.can("settings.manage")
        ? loadAllPages<SparePartCategory>(
            `/spare-part-categories/?page_size=${referencePageSize}&is_active=all`,
            version,
            isCurrentRequest,
            signal,
          )
        : Promise.resolve<SparePartCategory[]>([]),
    ]);
    if (
      manufacturerResult == null ||
      deviceTypeResult == null ||
      spareCategoryResult == null ||
      !deps.isCurrentLoad(version) ||
      !isCurrentRequest() ||
      signal.aborted
    ) return false;
    manufacturers.value = manufacturerResult;
    deviceTypes.value = deviceTypeResult;
    spareCategories.value = spareCategoryResult;
    dictionaryReferencesLoaded.value = true;
    return true;
  }

  function syncSystemSettingsForm(value: SystemSettings): void {
    systemSettingsForm.value = {
      default_page_size: value.default_page_size,
      default_asset_status: value.default_asset_status,
      default_locale: value.default_locale,
      timezone: value.timezone,
      date_format: value.date_format,
      currency: value.currency,
      password_min_length: value.password_min_length,
      password_expiry_days: value.password_expiry_days,
      login_max_attempts: value.login_max_attempts,
      login_window_seconds: value.login_window_seconds,
      login_lock_seconds: value.login_lock_seconds,
      smtp_enabled: value.smtp_enabled,
      smtp_host: value.smtp_host,
      smtp_port: value.smtp_port,
      smtp_security_mode: value.smtp_security_mode,
      smtp_username: value.smtp_username,
      smtp_password: "",
      smtp_from_email: value.smtp_from_email,
      smtp_from_name: value.smtp_from_name,
      smtp_timeout: value.smtp_timeout,
      notify_maintenance: value.notify_maintenance,
      maintenance_expiry_days: value.maintenance_expiry_days,
      notify_license_expiry: value.notify_license_expiry,
      license_expiry_days: value.license_expiry_days,
      notify_open_faults: value.notify_open_faults,
      notify_overdue_inventory: value.notify_overdue_inventory,
      notify_low_spare_stock: value.notify_low_spare_stock,
      email_digest_enabled: value.email_digest_enabled,
      email_digest_recipients: [...value.email_digest_recipients],
      application_url: value.application_url,
    };
  }

  function syncLdapConfigurationForm(value: LdapConfiguration): void {
    ldapConfigurationForm.value = {
      enabled: value.enabled,
      directory_type: value.directory_type,
      primary_host: value.primary_host,
      primary_port: value.primary_port,
      secondary_host: value.secondary_host,
      secondary_port: value.secondary_port,
      base_dn: value.base_dn,
      bind_dn: value.bind_dn,
      bind_password: "",
      security_mode: value.security_mode,
      tls_server_name: value.tls_server_name,
      ca_cert_file: value.ca_cert_file,
      user_search_base: value.user_search_base,
      user_login_attribute: value.user_login_attribute,
      user_filter: value.user_filter,
      external_id_attribute: value.external_id_attribute,
      email_attribute: value.email_attribute,
      first_name_attribute: value.first_name_attribute,
      last_name_attribute: value.last_name_attribute,
      account_control_attribute: value.account_control_attribute,
      connect_timeout: value.connect_timeout,
      operation_timeout: value.operation_timeout,
    };
  }

  const ldapConfigurationDirty = computed(() => {
    if (!ldapConfiguration.value) return Boolean(ldapConfigurationForm.value.bind_password);
    const form = ldapConfigurationForm.value;
    const value = ldapConfiguration.value;
    return Boolean(form.bind_password) || Object.entries(form).some(([key, current]) => {
      if (key === "bind_password") return false;
      return current !== value[key as keyof LdapConfiguration] as unknown;
    });
  });

  function ldapConfigurationPayload() {
    const form = ldapConfigurationForm.value;
    const payload: Record<string, unknown> = {
      enabled: form.enabled,
      directory_type: form.directory_type,
      primary_host: form.primary_host,
      primary_port: form.primary_port,
      secondary_host: form.secondary_host,
      secondary_port: form.secondary_port,
      base_dn: form.base_dn,
      bind_dn: form.bind_dn,
      security_mode: form.security_mode,
      tls_server_name: form.tls_server_name,
      ca_cert_file: form.ca_cert_file,
      user_search_base: form.user_search_base,
      user_login_attribute: form.user_login_attribute,
      user_filter: form.user_filter,
      external_id_attribute: form.external_id_attribute,
      email_attribute: form.email_attribute,
      first_name_attribute: form.first_name_attribute,
      last_name_attribute: form.last_name_attribute,
      account_control_attribute: form.account_control_attribute,
      connect_timeout: form.connect_timeout,
      operation_timeout: form.operation_timeout,
    };
    if (form.bind_password) payload.bind_password = form.bind_password;
    return payload;
  }

  function normalizeLdapDiagnosticResult(value: unknown): LdapDiagnosticResult | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const stages = ["configuration", "connection", "tls", "service_bind", "search"] as const;
    const stage = stages.includes(source.stage as typeof stages[number])
      ? source.stage as LdapDiagnosticResult["stage"]
      : "configuration";
    const checks = Array.isArray(source.checks)
      ? source.checks.flatMap((check): LdapDiagnosticCheck[] => {
          if (!check || typeof check !== "object" || Array.isArray(check)) return [];
          const item = check as Record<string, unknown>;
          const names = ["configuration", "connection", "tls", "service_bind", "search"] as const;
          const statuses = ["success", "error", "disabled"] as const;
          if (!names.includes(item.name as typeof names[number]) || !statuses.includes(item.status as typeof statuses[number])) return [];
          return [{
            name: item.name as LdapDiagnosticCheck["name"],
            status: item.status as LdapDiagnosticCheck["status"],
          }];
        })
      : [];
    const code = typeof source.code === "string" ? source.code : undefined;
    const message = typeof source.message === "string" ? source.message : undefined;
    return {
      success: Boolean(source.success),
      stage,
      checks,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
    };
  }

  async function loadLdapStatus(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("organization.manage")) {
      ldapStatus.value = null;
      ldapStatusError.value = "";
      return false;
    }
    const requestId = ++ldapStatusRequestId.value;
    ldapStatusLoading.value = true;
    ldapStatusError.value = "";
    try {
      const result = await deps.request<LdapStatus>("/auth/ldap/status/");
      if (result == null || requestId !== ldapStatusRequestId.value || !deps.isCurrentLoad(version)) return false;
      ldapStatus.value = result;
      return true;
    } catch (error) {
      if (requestId === ldapStatusRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        ldapStatusError.value = tr("settings.ldapStatusLoadFailed");
      }
      return false;
    } finally {
      if (requestId === ldapStatusRequestId.value) ldapStatusLoading.value = false;
    }
  }

  async function loadLdapConfiguration(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("organization.manage")) {
      ldapConfiguration.value = null;
      ldapConfigurationError.value = "";
      return false;
    }
    const requestId = ++ldapConfigurationRequestId.value;
    ldapConfigurationLoading.value = true;
    ldapConfigurationError.value = "";
    try {
      const result = await deps.request<LdapConfiguration>("/auth/ldap/config/");
      if (result == null || requestId !== ldapConfigurationRequestId.value || !deps.isCurrentLoad(version)) return false;
      ldapConfiguration.value = result;
      syncLdapConfigurationForm(result);
      return true;
    } catch (error) {
      if (requestId === ldapConfigurationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        ldapConfigurationError.value = errorMessage(error, tr("settings.ldapConfigurationLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === ldapConfigurationRequestId.value) ldapConfigurationLoading.value = false;
    }
  }

  function resetLdapConfigurationForm(): void {
    if (ldapConfiguration.value) syncLdapConfigurationForm(ldapConfiguration.value);
    ldapConfigurationFormErrors.value = {};
  }

  async function saveLdapConfiguration(): Promise<boolean> {
    if (ldapConfigurationSaving.value || !deps.can("organization.manage")) return false;
    ldapConfigurationSaving.value = true;
    ldapConfigurationError.value = "";
    ldapConfigurationFormErrors.value = {};
    try {
      const result = await deps.request<LdapConfiguration>("/auth/ldap/config/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ldapConfigurationPayload()),
      });
      ldapConfiguration.value = result;
      syncLdapConfigurationForm(result);
      await loadLdapStatus();
      setActionMessage(tr("settings.ldapConfigurationSaved"));
      return true;
    } catch (error) {
      const fieldErrors = extractFieldErrors(error, LDAP_CONFIGURATION_FIELDS);
      ldapConfigurationFormErrors.value = fieldErrors;
      const status = error instanceof ApiError ? error.status : undefined;
      const hasFieldErrors = Object.keys(fieldErrors).length > 0;
      if (status === 403) {
        setActionMessage(tr("settings.ldapConfigurationPermissionDenied"), "error");
      } else if (status === 400 || (status === undefined && hasFieldErrors)) {
        setActionMessage(tr("settings.ldapConfigurationValidationFailed"), "error");
      } else {
        setActionMessage(tr("settings.ldapConfigurationSaveFailed"), "error");
      }
      return false;
    } finally {
      ldapConfigurationSaving.value = false;
    }
  }

  async function runLdapDiagnostics(): Promise<boolean> {
    if (!deps.can("organization.manage") || ldapDiagnosticLoading.value) return false;
    ldapDiagnosticLoading.value = true;
    ldapDiagnosticError.value = "";
    ldapDiagnosticResult.value = null;
    try {
      const result = await deps.request<LdapDiagnosticResult>("/auth/ldap/diagnostics/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ldapConfigurationPayload()),
      });
      const normalized = normalizeLdapDiagnosticResult(result);
      if (!normalized) {
        ldapDiagnosticError.value = tr("settings.ldapDiagnosticRequestFailed");
        return false;
      }
      ldapDiagnosticResult.value = normalized;
      return normalized.success;
    } catch (error) {
      const details = error && typeof error === "object" && "details" in error
        ? (error as { details?: unknown }).details
        : undefined;
      const normalized = normalizeLdapDiagnosticResult(details);
      if (normalized) {
        ldapDiagnosticResult.value = normalized;
      } else if (!isAbortError(error)) {
        ldapDiagnosticError.value = tr("settings.ldapDiagnosticRequestFailed");
      }
      return false;
    } finally {
      ldapDiagnosticLoading.value = false;
    }
  }

  async function loadSystemSettings(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("settings.view")) return false;
    const requestId = ++systemSettingsRequestId.value;
    systemSettingsLoading.value = true;
    systemSettingsError.value = "";
    try {
      const result = await deps.request<SystemSettings>("/system/settings/");
      if (result == null || requestId !== systemSettingsRequestId.value || !deps.isCurrentLoad(version)) return false;
      systemSettings.value = result;
      syncSystemSettingsForm(result);
      applySystemSettingsSnapshot(result);
      return true;
    } catch (error) {
      if (requestId === systemSettingsRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        systemSettingsError.value = errorMessage(error, tr("settings.systemSettingsLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === systemSettingsRequestId.value) systemSettingsLoading.value = false;
    }
  }

  async function loadDictionaries(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!(
      canViewDictionarySection("manufacturers") ||
      canViewDictionarySection("device-types") ||
      canViewDictionarySection("spare-categories")
    )) return false;
    const requestId = ++dictionaryRequestId.value;
    dictionaryController?.abort();
    const controller = new AbortController();
    dictionaryController = controller;
    const base = dictionarySection.value === "manufacturers"
      ? "manufacturers"
      : dictionarySection.value === "device-types"
        ? "device-types"
        : "spare-part-categories";
    if (!canViewDictionarySection(dictionarySection.value)) {
      dictionaryRows.value = [];
      dictionaryTotal.value = 0;
      return false;
    }
    const params = new URLSearchParams({
      page: String(dictionaryPage.value),
      page_size: String(dictionaryPageSize.value),
      is_active: "all",
    });
    if (dictionarySearch.value.trim()) params.set("search", dictionarySearch.value.trim());
    dictionaryLoading.value = true;
    dictionaryError.value = "";
    try {
      const [result, referencesLoaded] = await Promise.all([
        deps.request<PageResult<DictionaryItem | SparePartCategory> | Array<DictionaryItem | SparePartCategory>>(
          `/${base}/?${params.toString()}`,
          { signal: controller.signal },
        ),
        loadDictionaryReferences(version, requestId, controller.signal),
      ]);
      if (
        result == null ||
        !referencesLoaded ||
        requestId !== dictionaryRequestId.value ||
        !deps.isCurrentLoad(version) ||
        controller.signal.aborted
      ) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, dictionaryPageSize.value);
      if (dictionaryPage.value > maxPage && allowPageClamp) {
        dictionaryPage.value = maxPage;
        return await loadDictionaries(version, false);
      }
      dictionaryRows.value = pageItems(result);
      dictionaryTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === dictionaryRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        dictionaryError.value = errorMessage(error, tr("settings.dictionaryDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === dictionaryRequestId.value) {
        dictionaryLoading.value = false;
        if (dictionaryController === controller) dictionaryController = null;
      }
    }
  }

  async function loadDepartments(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("settings.view") && !deps.can("settings.manage")) return false;
    const requestId = ++departmentRequestId.value;
    departmentController?.abort();
    const controller = new AbortController();
    departmentController = controller;
    const params = new URLSearchParams({
      page: String(departmentPage.value),
      page_size: String(departmentPageSize.value),
      ordering: "name",
    });
    if (departmentSearch.value.trim()) params.set("search", departmentSearch.value.trim());
    departmentLoading.value = true;
    departmentError.value = "";
    try {
      const [result, options] = await Promise.all([
        deps.request<PageResult<Department> | Department[]>(`/departments/?${params.toString()}`, { signal: controller.signal }),
        loadAllPages<Department>(
          "/departments/?page_size=100&ordering=name",
          version,
          () => requestId === departmentRequestId.value,
          controller.signal,
        ),
      ]);
      if (
        result == null ||
        options == null ||
        requestId !== departmentRequestId.value ||
        !deps.isCurrentLoad(version) ||
        controller.signal.aborted
      ) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, departmentPageSize.value);
      if (departmentPage.value > maxPage && allowPageClamp) {
        departmentPage.value = maxPage;
        return await loadDepartments(version, false);
      }
      departments.value = pageItems(result);
      departmentOptions.value = options;
      departmentTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === departmentRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        departmentError.value = errorMessage(error, tr("settings.departmentDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === departmentRequestId.value) {
        departmentLoading.value = false;
        if (departmentController === controller) departmentController = null;
      }
    }
  }

  function retryDepartments() {
    return loadDepartments();
  }

  async function searchDepartments() {
    departmentPage.value = 1;
    await loadDepartments();
  }

  async function changeDepartmentPage(page: number) {
    departmentPage.value = Math.min(
      Math.max(page, 1),
      totalPages(departmentTotal.value, departmentPageSize.value),
    );
    await loadDepartments();
  }

  async function changeDepartmentPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    departmentPageSize.value = size;
    departmentPage.value = 1;
    await loadDepartments();
  }

  async function loadResponsibilityDirectory(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("settings.manage") && !deps.can("settings.view")) return false;
    responsibilityDirectoryController?.abort();
    const controller = new AbortController();
    responsibilityDirectoryController = controller;
    const requestId = ++responsibilityDirectoryRequestId.value;
    responsibilityDirectoryLoading.value = true;
    responsibilityDirectoryError.value = "";
    const params = new URLSearchParams({
      page: String(responsibilityDirectoryPage.value),
      page_size: String(responsibilityDirectoryPageSize.value),
    });
    if (responsibilityDirectorySearch.value.trim()) params.set("search", responsibilityDirectorySearch.value.trim());
    if (responsibilityDirectoryType.value) params.set("department", responsibilityDirectoryType.value);
    if (responsibilityDirectoryActive.value && responsibilityDirectoryActive.value !== "all") {
      params.set("is_active", responsibilityDirectoryActive.value);
    }
    try {
      const result = await deps.request<PageResult<Person> | Person[]>(
        `/people/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (result == null || requestId !== responsibilityDirectoryRequestId.value || controller.signal.aborted || !deps.isCurrentLoad(version)) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, responsibilityDirectoryPageSize.value);
      if (responsibilityDirectoryPage.value > maxPage && allowPageClamp) {
        responsibilityDirectoryPage.value = maxPage;
        return await loadResponsibilityDirectory(version, false);
      }
      responsibilityDirectorySubjects.value = pageItems(result);
      responsibilityDirectoryTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === responsibilityDirectoryRequestId.value && !isAbortError(error) && deps.isCurrentLoad(version)) {
        responsibilityDirectoryError.value = errorMessage(error, tr("settings.peopleDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === responsibilityDirectoryRequestId.value) {
        responsibilityDirectoryLoading.value = false;
        if (responsibilityDirectoryController === controller) responsibilityDirectoryController = null;
      }
    }
  }

  function retryResponsibilityDirectory() {
    return loadResponsibilityDirectory();
  }

  async function searchResponsibilityDirectory() {
    responsibilityDirectoryPage.value = 1;
    await loadResponsibilityDirectory();
  }

  async function changeResponsibilityDirectoryPage(page: number) {
    responsibilityDirectoryPage.value = Math.max(1, page);
    await loadResponsibilityDirectory();
  }

  async function changeResponsibilityDirectoryPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    responsibilityDirectoryPageSize.value = size;
    responsibilityDirectoryPage.value = 1;
    await loadResponsibilityDirectory();
  }

  function openResponsibilitySubjectModal(subject?: Person) {
    if (!deps.can("settings.manage")) return;
    if (departmentOptions.value.length === 0 && !departmentLoading.value) {
      void loadDepartments();
    }
    editingResponsibilitySubject.value = subject || null;
    responsibilityDirectoryFormErrors.value = {};
    responsibilityDirectoryForm.value = subject
      ? {
          name: subject.name || subject.display_name || "",
          employee_no: subject.employee_no || "",
          department: subject.department ? String(subject.department) : "",
          organization: subject.organization || "",
          contact: subject.contact || "",
          is_active: subject.is_active,
        }
      : { name: "", employee_no: "", department: "", organization: "", contact: "", is_active: true };
    showResponsibilitySubjectModal.value = true;
  }

  async function saveResponsibilitySubject() {
    if (!deps.can("settings.manage") || responsibilityDirectorySaving.value) return;
    const name = responsibilityDirectoryForm.value.name.trim();
    if (!name) {
      responsibilityDirectoryFormErrors.value = { name: tr("settings.personNameRequired") };
      return;
    }
    responsibilityDirectorySaving.value = true;
    responsibilityDirectoryFormErrors.value = {};
    const editingId = editingResponsibilitySubject.value?.id;
    try {
      await deps.request(editingId ? `/people/${editingId}/` : "/people/", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          employee_no: responsibilityDirectoryForm.value.employee_no.trim() || null,
          department: responsibilityDirectoryForm.value.department ? Number(responsibilityDirectoryForm.value.department) : null,
          organization: responsibilityDirectoryForm.value.organization.trim(),
          contact: responsibilityDirectoryForm.value.contact.trim(),
          is_active: responsibilityDirectoryForm.value.is_active,
        }),
      });
      showResponsibilitySubjectModal.value = false;
      editingResponsibilitySubject.value = null;
      setActionMessage(tr("settings.personSaved"));
      await loadResponsibilityDirectory();
    } catch (error) {
      responsibilityDirectoryFormErrors.value = extractFieldErrors(error, ["name", "employee_no", "department", "organization", "contact", "is_active"]);
      setActionError(error, tr("settings.personSaveFailed"));
    } finally {
      responsibilityDirectorySaving.value = false;
    }
  }

  async function toggleResponsibilitySubject(subject: Person) {
    if (!deps.can("settings.manage") || responsibilityDirectoryActionId.value === subject.id) return;
    responsibilityDirectoryActionId.value = subject.id;
    try {
      await deps.request(`/people/${subject.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !subject.is_active }),
      });
      setActionMessage(subject.is_active ? tr("settings.personDisabled") : tr("settings.personEnabled"));
      await loadResponsibilityDirectory();
    } catch (error) {
      setActionError(error, tr("settings.personStatusFailed"));
    } finally {
      responsibilityDirectoryActionId.value = null;
    }
  }

  async function deleteResponsibilitySubject(subject: Person) {
    if (!deps.can("settings.manage") || responsibilityDirectoryActionId.value === subject.id) return;
    if ((subject.asset_count || 0) > 0) {
      setActionMessage(tr("settings.personInUse"), "error");
      return;
    }
    if (!(await deps.confirmAction(tr("settings.personDeleteConfirm", { name: subject.display_name || subject.name })))) return;
    responsibilityDirectoryActionId.value = subject.id;
    try {
      await deps.request(`/people/${subject.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.personDeleted"));
      await loadResponsibilityDirectory();
    } catch (error) {
      setActionError(error, tr("settings.personDeleteFailed"));
    } finally {
      responsibilityDirectoryActionId.value = null;
    }
  }

  function openDepartmentModal(department?: Department) {
    if (!deps.can("settings.manage")) return;
    editingDepartment.value = department || null;
    departmentFormErrors.value = {};
    departmentForm.value = department
      ? {
          name: department.name,
          code: department.code,
          parent: department.parent ? String(department.parent) : "",
        }
      : { name: "", code: "", parent: "" };
    showDepartmentModal.value = true;
  }

  async function saveDepartment() {
    if (!deps.can("settings.manage") || departmentSaving.value) return;
    departmentSaving.value = true;
    departmentFormErrors.value = {};
    const editingId = editingDepartment.value?.id;
    try {
      const payload = {
        name: departmentForm.value.name.trim(),
        code: departmentForm.value.code.trim(),
        parent: departmentForm.value.parent ? Number(departmentForm.value.parent) : null,
      };
      await deps.request(editingId ? `/departments/${editingId}/` : "/departments/", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showDepartmentModal.value = false;
      editingDepartment.value = null;
      setActionMessage(tr("settings.departmentSaved"));
      await loadDepartments();
    } catch (error) {
      departmentFormErrors.value = extractFieldErrors(error, ["name", "code", "parent"]);
      setActionError(error, tr("settings.departmentSaveFailed"));
    } finally {
      departmentSaving.value = false;
    }
  }

  async function deleteDepartment(department: Department) {
    if (!deps.can("settings.manage") || departmentActionId.value === department.id) return;
    if ((department.people_count || 0) > 0) {
      setActionMessage(tr("settings.departmentInUse"), "error");
      return;
    }
    if (!(await deps.confirmAction(tr("settings.departmentDeleteConfirm", { name: department.name })))) return;
    departmentActionId.value = department.id;
    try {
      await deps.request(`/departments/${department.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.departmentDeleted"));
      await loadDepartments();
    } catch (error) {
      setActionError(error, tr("settings.departmentDeleteFailed"));
    } finally {
      departmentActionId.value = null;
    }
  }

  async function loadCustomFields(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("custom_fields.view")) return false;
    const requestId = ++customFieldRequestId.value;
    const params = new URLSearchParams({
      page: String(customFieldPage.value),
      page_size: String(customFieldPageSize.value),
      is_active: customFieldActive.value || "all",
    });
    if (customFieldDeviceType.value) params.set("device_type", customFieldDeviceType.value);
    customFieldListLoading.value = true;
    customFieldListError.value = "";
    try {
      const result = await deps.request<PageResult<CustomField> | CustomField[]>(`/custom-fields/?${params.toString()}`);
      if (result == null || requestId !== customFieldRequestId.value || !deps.isCurrentLoad(version)) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, customFieldPageSize.value);
      if (customFieldPage.value > maxPage && allowPageClamp) {
        customFieldPage.value = maxPage;
        return await loadCustomFields(version, false);
      }
      customFields.value = pageItems(result);
      customFieldTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === customFieldRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        customFieldListError.value = errorMessage(error, tr("settings.customFieldDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === customFieldRequestId.value) customFieldListLoading.value = false;
    }
  }

  async function loadCustomFieldOptions(field = editingCustomField.value, version = deps.beginLoad()): Promise<boolean> {
    if (!field || !deps.can("custom_fields.view")) return false;
    const requestId = ++customFieldOptionRequestId.value;
    customFieldOptionLoading.value = true;
    customFieldOptionError.value = "";
    try {
      const params = new URLSearchParams({
        page: String(customFieldOptionPage.value),
        page_size: String(customFieldOptionPageSize.value),
        field: String(field.id),
      });
      const result = await deps.request<PageResult<CustomFieldOption> | CustomFieldOption[]>(`/custom-field-options/?${params.toString()}`);
      if (result == null || requestId !== customFieldOptionRequestId.value || !deps.isCurrentLoad(version)) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, customFieldOptionPageSize.value);
      if (customFieldOptionPage.value > maxPage) {
        customFieldOptionPage.value = maxPage;
        return await loadCustomFieldOptions(field, version);
      }
      field.options = pageItems(result);
      customFieldOptionTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === customFieldOptionRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        customFieldOptionError.value = errorMessage(error, tr("settings.fieldOptionDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === customFieldOptionRequestId.value) customFieldOptionLoading.value = false;
    }
  }

  async function loadTagReferences(
    version: number,
    requestId: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (tagReferencesLoaded.value) return true;
    const rows = await loadAllPages<Tag>(
      `/tags/?page_size=${referencePageSize}&is_active=all`,
      version,
      () => requestId === tagRequestId.value,
      signal,
    );
    if (rows == null || requestId !== tagRequestId.value || !deps.isCurrentLoad(version) || signal.aborted) return false;
    tags.value = rows;
    tagReferencesLoaded.value = true;
    return true;
  }

  async function loadTags(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!(deps.can("tags.view") || deps.can("assets.view") || deps.can("assets.manage"))) return false;
    const requestId = ++tagRequestId.value;
    tagController?.abort();
    const controller = new AbortController();
    tagController = controller;
    const params = new URLSearchParams({
      page: String(tagPage.value),
      page_size: String(tagPageSize.value),
      is_active: tagActive.value || "all",
    });
    if (tagSearch.value.trim()) params.set("search", tagSearch.value.trim());
    tagListLoading.value = true;
    tagListError.value = "";
    try {
      const [result, referencesLoaded] = await Promise.all([
        deps.request<PageResult<Tag> | Tag[]>(`/tags/?${params.toString()}`, { signal: controller.signal }),
        loadTagReferences(version, requestId, controller.signal),
      ]);
      if (result == null || !referencesLoaded || requestId !== tagRequestId.value || !deps.isCurrentLoad(version) || controller.signal.aborted) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, tagPageSize.value);
      if (tagPage.value > maxPage && allowPageClamp) {
        tagPage.value = maxPage;
        return await loadTags(version, false);
      }
      tagRows.value = pageItems(result);
      tagTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === tagRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        tagListError.value = errorMessage(error, tr("settings.tagDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === tagRequestId.value) {
        tagListLoading.value = false;
        if (tagController === controller) tagController = null;
      }
    }
  }

  async function loadOrganization(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("organization.manage")) return false;
    clearUserSelection();
    const requestId = ++organizationRequestId.value;
    const userRequestIdAtStart = ++userRequestId.value;
    organizationLoading.value = true;
    userListError.value = "";
    roleListError.value = "";
    const userParams = new URLSearchParams({
      page: String(userPage.value),
      page_size: String(userPageSize.value),
    });
    if (userSearch.value.trim()) userParams.set("search", userSearch.value.trim());
    try {
      const [userResult, roleResult] = await Promise.allSettled([
        deps.request<PageResult<ManagedUser> | ManagedUser[]>("/users/?" + userParams.toString()),
        deps.request<PageResult<Role> | Role[]>("/roles/?page_size=100"),
      ]);
      if (requestId !== organizationRequestId.value || !deps.isCurrentLoad(version)) return false;
      let refreshed = true;
      if (userResult.status === "fulfilled" && userResult.value != null && userRequestIdAtStart === userRequestId.value) {
        const nextCount = pageTotal(userResult.value);
        const maxPage = totalPages(nextCount, userPageSize.value);
        userCount.value = nextCount;
        if (userPage.value > maxPage) {
          userPage.value = maxPage;
          if (roleResult.status === "fulfilled" && roleResult.value != null) {
            roles.value = pageItems(roleResult.value);
          }
          return await loadUsers(version, false);
        }
        users.value = pageItems(userResult.value);
      } else {
        refreshed = false;
        const userError = userResult.status === "rejected" ? userResult.reason : undefined;
        if (!isAbortError(userError) && userRequestIdAtStart === userRequestId.value) {
          userListError.value = userResult.status === "rejected"
            ? errorMessage(userResult.reason, tr("settings.userDataLoadFailed"))
            : tr("settings.userDataLoadFailed");
        }
      }
      if (roleResult.status === "fulfilled" && roleResult.value != null) {
        roles.value = pageItems(roleResult.value);
      } else {
        refreshed = false;
        const roleError = roleResult.status === "rejected" ? roleResult.reason : undefined;
        if (!isAbortError(roleError)) {
          roleListError.value = roleResult.status === "rejected"
            ? errorMessage(roleResult.reason, tr("settings.roleDataLoadFailed"))
            : tr("settings.roleDataLoadFailed");
        }
      }
      return refreshed;
    } catch (error) {
      if (requestId === organizationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        userListError.value = errorMessage(error, tr("settings.userDataLoadFailed"));
        roleListError.value = errorMessage(error, tr("settings.roleDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === organizationRequestId.value) organizationLoading.value = false;
    }
  }

  async function loadUsers(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("organization.manage")) return false;
    clearUserSelection();
    const organizationRequest = ++organizationRequestId.value;
    const requestId = ++userRequestId.value;
    organizationLoading.value = true;
    userListError.value = "";
    const params = new URLSearchParams({
      page: String(userPage.value),
      page_size: String(userPageSize.value),
    });
    if (userSearch.value.trim()) params.set("search", userSearch.value.trim());
    try {
      const result = await deps.request<PageResult<ManagedUser> | ManagedUser[]>(
        "/users/?" + params.toString(),
      );
      if (result == null || requestId !== userRequestId.value || organizationRequest !== organizationRequestId.value || !deps.isCurrentLoad(version)) {
        return false;
      }
      const nextCount = pageTotal(result);
      const maxPage = totalPages(nextCount, userPageSize.value);
      if (userPage.value > maxPage && allowPageClamp) {
        userPage.value = maxPage;
        return await loadUsers(version, false);
      }
      users.value = pageItems(result);
      clearUserSelection();
      userCount.value = nextCount;
      return true;
    } catch (error) {
      if (requestId === userRequestId.value && organizationRequest === organizationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        userListError.value = errorMessage(error, tr("settings.userDataLoadFailed"));
      }
      return false;
    } finally {
      if (organizationRequest === organizationRequestId.value) organizationLoading.value = false;
    }
  }

  async function loadAuditLogs(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("audit.view")) return false;
    const requestId = ++auditRequestId.value;
    const params = new URLSearchParams({ page: String(auditPage.value), page_size: String(auditPageSize.value) });
    Object.entries(auditFilters.value).forEach(([key, value]) => {
      const normalizedValue = String(value || "").trim();
      if (normalizedValue) params.set(key, normalizedValue);
    });
    auditListLoading.value = true;
    auditListError.value = "";
    if (auditFilters.value.start && auditFilters.value.end && auditFilters.value.start > auditFilters.value.end) {
      auditListError.value = tr("settings.auditInvalidDateRange");
      auditListLoading.value = false;
      return false;
    }
    try {
      const result = await deps.request<PageResult<AuditLog> | AuditLog[]>(`/audit-logs/?${params.toString()}`);
      if (result == null || requestId !== auditRequestId.value || !deps.isCurrentLoad(version)) return false;
      const nextCount = pageTotal(result);
      const maxPage = totalPages(nextCount, auditPageSize.value);
      if (auditPage.value > maxPage) {
        auditPage.value = maxPage;
        if (allowPageClamp) return await loadAuditLogs(version, false);
      }
      auditLogs.value = pageItems(result);
      auditCount.value = nextCount;
      return true;
    } catch (error) {
      if (requestId === auditRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        auditListError.value = errorMessage(error, tr("settings.auditDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === auditRequestId.value) auditListLoading.value = false;
    }
  }

  function openUserModal(user?: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    editingUser.value = user || null;
    userFormErrors.value = {};
    userForm.value = user
      ? {
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          password: "",
          confirm_password: "",
          is_active: user.is_active,
          role_code: user.assigned_role_code || "",
          person_id: user.person?.id ? String(user.person.id) : "",
        }
      : {
          username: "",
          first_name: "",
          last_name: "",
          email: "",
          password: "",
          confirm_password: "",
          is_active: true,
          role_code: "auditor",
          person_id: "",
        };
    if (!user) void loadUnlinkedPeople();
    showUserModal.value = true;
    nextTick(() => userFormRef.value?.clearValidate());
  }

  async function loadUnlinkedPeople(): Promise<boolean> {
    if (!deps.can("organization.manage")) return false;
    const requestId = ++unlinkedPeopleRequestId.value;
    unlinkedPeopleLoading.value = true;
    unlinkedPeopleError.value = "";
    try {
      const result = await deps.request<PageResult<Person> | Person[]>(
        "/people/?page=1&page_size=100&is_active=true&account=unlinked",
      );
      if (requestId !== unlinkedPeopleRequestId.value || result == null) return false;
      unlinkedPeople.value = pageItems(result);
      return true;
    } catch (error) {
      if (requestId === unlinkedPeopleRequestId.value) {
        unlinkedPeopleError.value = errorMessage(error, tr("settings.peopleDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === unlinkedPeopleRequestId.value) unlinkedPeopleLoading.value = false;
    }
  }

  function userProtectionReason(user: ManagedUser): string {
    if (user.is_superuser) return tr("settings.superuserProtected");
    if (user.username === deps.currentUsername.value) return tr("settings.currentUserProtected");
    return "";
  }

  function userDeleteProtectionReason(user: ManagedUser): string {
    if (user.auth_source === "ldap") return tr("settings.directoryUserProtected");
    return userProtectionReason(user);
  }

  function handleUserSelection(rows: ManagedUser[]) {
    selectedUserIds.value = rows.map((user) => user.id);
  }

  function clearUserSelection() {
    selectedUserIds.value = [];
  }

  function canChangeUserRole(user: ManagedUser): boolean {
    return !user.is_superuser && user.username !== deps.currentUsername.value;
  }

  function openUserResetModal(user: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    if (user.auth_source === "ldap") {
      setActionMessage(tr("settings.directoryPasswordManaged"), "error");
      return;
    }
    resettingUser.value = user;
    userResetError.value = "";
    userResetForm.value = { new_password: "", confirm_password: "" };
    userResetFormErrors.value = {};
    showUserResetModal.value = true;
    nextTick(() => userResetFormRef.value?.clearValidate());
  }

  async function saveUser() {
    if (!deps.can("organization.manage")) return;
    if (userSaving.value) return;
    userSaving.value = true;
    let saved = false;
    try {
      const valid = await userFormRef.value?.validate().then(() => true).catch(() => false);
      if (!valid) return;
      const method = editingUser.value ? "PATCH" : "POST";
      const path = editingUser.value ? `/users/${editingUser.value.id}/` : "/users/";
      await deps.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(!editingUser.value ? { username: userForm.value.username } : {}),
          first_name: userForm.value.first_name,
          last_name: userForm.value.last_name,
          email: userForm.value.email,
          is_active: userForm.value.is_active,
          role_code: userForm.value.role_code,
          ...(!editingUser.value && userForm.value.person_id
            ? { person_id: Number(userForm.value.person_id) }
            : {}),
          ...(!editingUser.value && userForm.value.password ? { password: userForm.value.password } : {}),
        }),
      });
      saved = true;
    } catch (error) {
      userFormErrors.value = extractFieldErrors(error, [
        "username",
        "first_name",
        "last_name",
        "email",
        "role_code",
        "person_id",
        "password",
      ]);
      setActionError(error, tr("settings.userSaveFailed"));
    } finally {
      userSaving.value = false;
    }
    if (!saved) return;
    showUserModal.value = false;
    setActionMessage(tr("settings.userSaved"));
    const refreshed = await loadUsers();
    if (!refreshed && userListError.value) setActionMessage(tr("settings.userSavedRefreshFailed"), "error");
  }

  async function resetUserPassword() {
    if (!deps.can("organization.manage")) return;
    const user = resettingUser.value;
    if (!user || userPendingId.value === user.id || userResetSaving.value) return;
    if (user.auth_source === "ldap") {
      setActionMessage(tr("settings.directoryPasswordManaged"), "error");
      return;
    }
    userPendingId.value = user.id;
    userResetSaving.value = true;
    userResetError.value = "";
    userResetFormErrors.value = {};
    let saved = false;
    try {
      await deps.request(`/users/${user.id}/reset-password/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userResetForm.value),
      });
      saved = true;
    } catch (error) {
      userResetFormErrors.value = extractFieldErrors(error, ["new_password", "confirm_password"]);
      userResetError.value = errorMessage(error, tr("settings.passwordResetFailed"));
    } finally {
      userResetSaving.value = false;
      userPendingId.value = null;
    }
    if (!saved) return;
    showUserResetModal.value = false;
    resettingUser.value = null;
    userResetError.value = "";
    userResetForm.value = { new_password: "", confirm_password: "" };
    setActionMessage(tr("settings.passwordReset"));
  }

  async function toggleUser(user: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    if (userProtectionReason(user)) {
      setActionMessage(userProtectionReason(user), "error");
      return;
    }
    if (userPendingId.value === user.id) return;
    userPendingId.value = user.id;
    try {
      await deps.request(`/users/${user.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      setActionMessage(user.is_active ? tr("settings.userDisabled") : tr("settings.userEnabled"));
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) setActionMessage(tr("settings.userStatusRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("settings.userStatusFailed"));
    } finally {
      userPendingId.value = null;
    }
  }

  async function batchUpdateUserStatus(isActive: boolean) {
    if (!deps.can("organization.manage")) return;
    const ids = [...selectedUserIds.value];
    if (!ids.length || userBatchSaving.value) return;
    const actionLabel = isActive ? tr("status.enabled") : tr("status.disabled");
    if (!(await deps.confirmAction(tr("settings.batchUserStatusConfirm", { action: actionLabel, count: ids.length })))) return;
    userBatchSaving.value = true;
    userBatchResult.value = null;
    showUserBatchResult.value = false;
    clearUserSelection();
    try {
      const result = await deps.request<UserBatchStatusResponse>("/users/batch-status/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, is_active: isActive }),
      });
      userBatchResult.value = result;
      const mutationMessage = result.failed
        ? tr("settings.batchUserStatusSummary", { action: actionLabel, succeeded: result.succeeded, failed: result.failed })
        : tr("settings.batchUserStatusSuccess", { action: actionLabel, count: result.succeeded });
      setActionMessage(mutationMessage, result.failed ? "error" : "success");
      const refreshed = await loadUsers();
      if (!refreshed) {
        setActionMessage(`${mutationMessage}; ${tr("common.refreshFailed")}. ${tr("common.retry")}.`, "error");
      }
      if (result.failed) showUserBatchResult.value = true;
    } catch (error) {
      setActionError(error, tr("settings.batchUserStatusFailed", { action: actionLabel }));
    } finally {
      userBatchSaving.value = false;
    }
  }

  function closeUserBatchResult() {
    if (userBatchSaving.value) return;
    showUserBatchResult.value = false;
    userBatchResult.value = null;
  }

  async function deleteUser(user: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    if (user.auth_source === "ldap") {
      setActionMessage(tr("settings.directoryUserProtected"), "error");
      return;
    }
    if (userProtectionReason(user)) {
      setActionMessage(userProtectionReason(user), "error");
      return;
    }
    if (userPendingId.value === user.id) return;
    userPendingId.value = user.id;
    try {
      if (!(await deps.confirmAction(tr("settings.userDeleteConfirm", { username: user.username })))) return;
      await deps.request(`/users/${user.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.userDeleted"));
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) setActionMessage(tr("settings.userDeletedRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("settings.userDeleteFailed"));
    } finally {
      userPendingId.value = null;
    }
  }


  function openCustomFieldModal(field?: CustomField) {
    if (!deps.can("custom_fields.manage")) return;
    editingCustomField.value = field || null;
    customFieldFormErrors.value = {};
    customFieldForm.value = field
      ? {
          device_type: field.device_type == null ? "" : String(field.device_type),
          key: field.key,
          name: field.name,
          field_type: field.field_type,
          required: field.required,
          default_value: field.default_value || "",
          sort_order: field.sort_order || 0,
          is_active: field.is_active,
          group: field.group || "",
          help_text: field.help_text || "",
          placeholder: field.placeholder || "",
          form_visible: field.form_visible !== false,
          detail_visible: field.detail_visible !== false,
          list_visible: field.list_visible === true,
          filterable: field.filterable === true,
          validation_config: { ...(field.validation_config || {}) },
        }
      : {
          device_type: customFieldDeviceType.value,
          key: "",
          name: "",
          field_type: "text",
          required: false,
          default_value: "",
          sort_order: 0,
          is_active: true,
          group: "",
          help_text: "",
          placeholder: "",
          form_visible: true,
          detail_visible: true,
          list_visible: false,
          filterable: false,
          validation_config: {},
        };
    showCustomFieldModal.value = true;
  }

  function normalizedCustomFieldValidationConfig() {
    const config = customFieldForm.value.validation_config || {};
    const keysByType: Record<string, string[]> = {
      text: ["min_length", "max_length"],
      textarea: ["min_length", "max_length"],
      number: ["min", "max", "precision"],
      date: ["min_date", "max_date"],
      multiselect: ["min_items", "max_items"],
      select: [],
      boolean: [],
    };
    const keys = keysByType[customFieldForm.value.field_type] || [];
    return Object.fromEntries(
      keys
        .filter((key) => config[key as keyof typeof config] !== undefined && config[key as keyof typeof config] !== null && config[key as keyof typeof config] !== "")
        .map((key) => [key, config[key as keyof typeof config]]),
    );
  }

  async function saveCustomField() {
    if (!deps.can("custom_fields.manage")) return;
    if (customFieldSaving.value) return;
    customFieldSaving.value = true;
    customFieldFormErrors.value = {};
    let saved = false;
    try {
      const path = editingCustomField.value ? `/custom-fields/${editingCustomField.value.id}/` : "/custom-fields/";
      customFieldForm.value.key = customFieldForm.value.key.trim().toLowerCase();
      customFieldForm.value.name = customFieldForm.value.name.trim();
      customFieldForm.value.default_value = customFieldForm.value.default_value.trim();
      customFieldForm.value.group = customFieldForm.value.group.trim();
      customFieldForm.value.help_text = customFieldForm.value.help_text.trim();
      customFieldForm.value.placeholder = customFieldForm.value.placeholder.trim();
      await deps.request(path, {
        method: editingCustomField.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...customFieldForm.value,
          device_type: customFieldForm.value.device_type ? Number(customFieldForm.value.device_type) : null,
          sort_order: Number(customFieldForm.value.sort_order),
          validation_config: normalizedCustomFieldValidationConfig(),
        }),
      });
      saved = true;
    } catch (error) {
      customFieldFormErrors.value = extractFieldErrors(error, [
        "device_type",
        "key",
        "name",
        "field_type",
        "default_value",
        "sort_order",
        "group",
        "help_text",
        "placeholder",
        "form_visible",
        "detail_visible",
        "list_visible",
        "filterable",
        "validation_config",
      ]);
      setActionError(error, tr("customField.saveFailed"));
    } finally {
      customFieldSaving.value = false;
    }
    if (!saved) return;
    showCustomFieldModal.value = false;
    setActionMessage(tr("customField.saved"));
    const refreshed = await loadCustomFields();
    if (!refreshed && customFieldListError.value) setActionMessage(tr("customField.savedRefreshFailed"), "error");
  }
  async function toggleCustomField(field: CustomField) {
    if (!deps.can("custom_fields.manage")) return;
    if (customFieldActionId.value === field.id) return;
    customFieldActionId.value = field.id;
    try {
      await deps.request(`/custom-fields/${field.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !field.is_active }),
      });
      setActionMessage(field.is_active ? tr("customField.disabled") : tr("customField.enabled"));
      const refreshed = await loadCustomFields();
      if (!refreshed && customFieldListError.value) setActionMessage(tr("customField.statusRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("customField.statusFailed"));
    } finally {
      customFieldActionId.value = null;
    }
  }
  async function deleteCustomField(field: CustomField) {
    if (!deps.can("custom_fields.manage")) return;
    if ((field.assets_count || 0) > 0) {
      setActionMessage(tr("customField.inUse"), "error");
      return;
    }
    if (customFieldActionId.value === field.id) return;
    customFieldActionId.value = field.id;
    try {
      if (!(await deps.confirmAction(tr("customField.deleteConfirm", { name: field.name })))) return;
      await deps.request(`/custom-fields/${field.id}/`, { method: "DELETE" });
      setActionMessage(tr("customField.deleted"));
      const refreshed = await loadCustomFields();
      if (!refreshed && customFieldListError.value) setActionMessage(tr("customField.deletedRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("customField.deleteFailed"));
    } finally {
      customFieldActionId.value = null;
    }
  }
  function openCustomFieldOptionModal(field?: CustomField | null, option?: CustomFieldOption) {
    if (!field || !deps.can("custom_fields.manage")) return;
    const sameField = editingCustomField.value?.id === field.id;
    if (!sameField) {
      customFieldOptionPage.value = 1;
      customFieldOptionTotal.value = 0;
    }
    editingCustomField.value = field || null;
    editingCustomFieldOption.value = option || null;
    customFieldOptionFormErrors.value = {};
    customFieldOptionForm.value = option
      ? { value: option.value, label: option.label, sort_order: option.sort_order, is_active: option.is_active }
      : { value: "", label: "", sort_order: 0, is_active: true };
    showCustomFieldOptionModal.value = true;
    void loadCustomFieldOptions(field);
  }
  function retryCustomFieldOptions() {
    return loadCustomFieldOptions(editingCustomField.value);
  }
  async function saveCustomFieldOption() {
    if (!deps.can("custom_fields.manage")) return;
    if (!editingCustomField.value || customFieldOptionSaving.value) return;
    customFieldOptionSaving.value = true;
    customFieldOptionFormErrors.value = {};
    let saved = false;
    try {
      const path = editingCustomFieldOption.value
        ? `/custom-field-options/${editingCustomFieldOption.value.id}/`
        : "/custom-field-options/";
      customFieldOptionForm.value.value = customFieldOptionForm.value.value.trim();
      customFieldOptionForm.value.label = customFieldOptionForm.value.label.trim();
      await deps.request(path, {
        method: editingCustomFieldOption.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customFieldOptionForm.value, field: editingCustomField.value.id }),
      });
      saved = true;
    } catch (error) {
      customFieldOptionFormErrors.value = extractFieldErrors(error, [
        "field",
        "value",
        "label",
        "sort_order",
      ]);
      setActionError(error, tr("customField.optionSaveFailed"));
    } finally {
      customFieldOptionSaving.value = false;
    }
    if (!saved) return;
    showCustomFieldOptionModal.value = false;
    setActionMessage(tr("customField.optionSaved"));
    const refreshed = await loadCustomFields();
    if (!refreshed && customFieldListError.value) setActionMessage(tr("customField.optionSavedRefreshFailed"), "error");
  }
  async function deleteCustomFieldOption(option: CustomFieldOption) {
    if (!deps.can("custom_fields.manage")) return;
    if (customFieldOptionActionId.value === option.id) return;
    customFieldOptionActionId.value = option.id;
    try {
      if (!(await deps.confirmAction(tr("customField.optionDeleteConfirm", { name: option.label })))) return;
      await deps.request(`/custom-field-options/${option.id}/`, { method: "DELETE" });
      setActionMessage(tr("customField.optionDeleted"));
      const refreshed = await loadCustomFieldOptions(editingCustomField.value);
      if (!refreshed && customFieldOptionError.value) setActionMessage(tr("customField.optionDeletedRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("customField.optionDeleteFailed"));
    } finally {
      customFieldOptionActionId.value = null;
    }
  }

  function openTagModal(tag?: Tag) {
    if (!deps.can("tags.manage")) return;
    editingTag.value = tag || null;
    tagFormErrors.value = {};
    tagForm.value = tag ? { name: tag.name, is_active: tag.is_active } : { name: "", is_active: true };
    showTagModal.value = true;
  }
  async function saveTag() {
    if (!deps.can("tags.manage")) return;
    if (tagSaving.value) return;
    tagSaving.value = true;
    tagFormErrors.value = {};
    let saved = false;
    try {
      const path = editingTag.value ? `/tags/${editingTag.value.id}/` : "/tags/";
      tagForm.value.name = tagForm.value.name.trim();
      await deps.request(path, {
        method: editingTag.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tagForm.value),
      });
      saved = true;
    } catch (error) {
      tagFormErrors.value = extractFieldErrors(error, ["name"]);
      setActionError(error, tr("tag.saveFailed"));
    } finally {
      tagSaving.value = false;
    }
    if (!saved) return;
    showTagModal.value = false;
    setActionMessage(tr("tag.saved"));
    invalidateTagReferences();
    const refreshed = await loadTags();
    if (!refreshed && tagListError.value) setActionMessage(tr("tag.savedRefreshFailed"), "error");
  }
  async function toggleTag(tag: Tag) {
    if (!deps.can("tags.manage")) return;
    if (tagActionId.value === tag.id) return;
    tagActionId.value = tag.id;
    try {
      await deps.request(`/tags/${tag.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !tag.is_active }),
      });
      setActionMessage(tag.is_active ? tr("tag.disabled") : tr("tag.enabled"));
      invalidateTagReferences();
      const refreshed = await loadTags();
      if (!refreshed && tagListError.value) setActionMessage(tr("tag.statusRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("tag.statusFailed"));
    } finally {
      tagActionId.value = null;
    }
  }
  async function deleteTag(tag: Tag) {
    if (!deps.can("tags.manage")) return;
    if ((tag.assets_count || 0) > 0) {
      setActionMessage(tr("tag.inUse"), "error");
      return;
    }
    if (tagActionId.value === tag.id) return;
    tagActionId.value = tag.id;
    try {
      if (!(await deps.confirmAction(tr("tag.deleteConfirm", { name: tag.name })))) return;
      await deps.request(`/tags/${tag.id}/`, { method: "DELETE" });
      setActionMessage(tr("tag.deleted"));
      invalidateTagReferences();
      const refreshed = await loadTags();
      if (!refreshed && tagListError.value) setActionMessage(tr("tag.deletedRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("tag.deleteFailed"));
    } finally {
      tagActionId.value = null;
    }
  }

  const currentDictionaryItems = computed<Array<DictionaryItem | SparePartCategory>>(() => dictionaryRows.value);
  const dictionaryCount = computed(() => dictionaryTotal.value);
  const customFieldTableItems = computed(() => customFields.value);
  const customFieldCount = computed(() => customFieldTotal.value);
  const tagTableItems = computed(() => tagRows.value);
  const tagCount = computed(() => tagTotal.value);
  const currentDictionaryLabel = computed(() =>
    dictionarySection.value === "manufacturers"
      ? tr("settings.manufacturers")
      : dictionarySection.value === "device-types"
        ? tr("settings.deviceTypes")
        : tr("settings.spareCategories"),
  );
  function dictionaryItemUsed(item: DictionaryItem) {
    return (
      (item.assets_count || 0) > 0 ||
      (dictionarySection.value === "manufacturers" && (
        ((item as DictionaryItem).licenses_count || 0) > 0 ||
        ((item as DictionaryItem).spare_parts_count || 0) > 0
      )) ||
      (dictionarySection.value === "device-types" && ((item as DictionaryItem).custom_fields_count || 0) > 0) ||
      (dictionarySection.value === "spare-categories" && ((item as SparePartCategory).spare_parts_count || 0) > 0)
    );
  }
  function openDictionaryModal(item?: DictionaryItem) {
    if (!canManageDictionary()) return;
    editingDictionary.value = item || null;
    dictionaryFormErrors.value = {};
    dictionaryForm.value = item
      ? {
          name: item.name,
          code: "code" in item ? item.code || "" : "",
          color: "color" in item ? item.color || "#1677EF" : "#1677EF",
          is_active: item.is_active,
        }
      : { name: "", code: "", color: "#1677EF", is_active: true };
    showDictionaryModal.value = true;
  }
  function retryDictionaries() {
    return loadDictionaries();
  }

  async function changeDictionarySection() {
    dictionaryPage.value = 1;
    await loadDictionaries();
  }

  async function searchDictionaries() {
    dictionaryPage.value = 1;
    await loadDictionaries();
  }

  async function changeDictionaryPage(page: number) {
    dictionaryPage.value = Math.min(
      Math.max(page, 1),
      totalPages(dictionaryCount.value, dictionaryPageSize.value),
    );
    await loadDictionaries();
  }

  async function changeDictionaryPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    dictionaryPageSize.value = size;
    dictionaryPage.value = 1;
    await loadDictionaries();
  }
  async function saveDictionary() {
    if (dictionarySaving.value) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      setActionMessage(tr("settings.dictionaryPermissionDenied"), "error");
      return;
    }
    dictionarySaving.value = true;
    dictionaryFormErrors.value = {};
    let saved = false;
    try {
      const base = section === "manufacturers"
        ? "manufacturers"
        : section === "device-types"
          ? "device-types"
          : "spare-part-categories";
      const method = editingDictionary.value ? "PATCH" : "POST";
      const path = editingDictionary.value ? `/${base}/${editingDictionary.value.id}/` : `/${base}/`;
      dictionaryForm.value.name = dictionaryForm.value.name.trim();
      dictionaryForm.value.code = dictionaryForm.value.code.trim();
      dictionaryForm.value.color = dictionaryForm.value.color.trim().toUpperCase();
      const payload = section === "device-types"
        ? {
            name: dictionaryForm.value.name,
            color: dictionaryForm.value.color,
            is_active: dictionaryForm.value.is_active,
          }
        : section === "manufacturers"
          ? { name: dictionaryForm.value.name, code: dictionaryForm.value.code || null, is_active: dictionaryForm.value.is_active }
          : { name: dictionaryForm.value.name, code: dictionaryForm.value.code, is_active: dictionaryForm.value.is_active };
      await deps.request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      saved = true;
    } catch (error) {
      dictionaryFormErrors.value = extractFieldErrors(error, ["name", "code", "color"]);
      setActionError(error, tr("settings.dictionarySaveFailed", { item: label }));
    } finally {
      dictionarySaving.value = false;
    }
    if (!saved) return;
    showDictionaryModal.value = false;
    setActionMessage(tr("settings.dictionarySaved", { item: label }));
    invalidateDictionaryReferences();
    const refreshed = await loadDictionaries();
    if (!refreshed && dictionaryError.value) setActionMessage(tr("settings.dictionarySavedRefreshFailed", { item: label }), "error");
  }
  async function toggleDictionary(item: DictionaryItem) {
    if (dictionaryActionId.value === item.id) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      setActionMessage(tr("settings.dictionaryPermissionDenied"), "error");
      return;
    }
    dictionaryActionId.value = item.id;
    try {
      const base = section === "manufacturers"
        ? "manufacturers"
        : section === "device-types"
          ? "device-types"
          : "spare-part-categories";
      await deps.request(`/${base}/${item.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) });
      setActionMessage(item.is_active
        ? tr("settings.dictionaryDisabled", { item: label })
        : tr("settings.dictionaryEnabled", { item: label }));
      invalidateDictionaryReferences();
      const refreshed = await loadDictionaries();
      if (!refreshed && dictionaryError.value) setActionMessage(tr("settings.dictionaryStatusRefreshFailed", { item: label }), "error");
    } catch (error) {
      setActionError(error, tr("settings.dictionaryStatusFailed", { item: label }));
    } finally {
      dictionaryActionId.value = null;
    }
  }
  async function deleteDictionary(item: DictionaryItem) {
    if (dictionaryItemUsed(item)) {
      setActionMessage(dictionarySection.value === "manufacturers"
        ? tr("settings.manufacturerInUse")
        : dictionarySection.value === "device-types"
          ? tr("settings.deviceTypeInUse")
        : dictionarySection.value === "spare-categories"
          ? tr("settings.spareCategoryInUse")
          : tr("settings.dictionaryItemInUse"), "error");
      return;
    }
    if (dictionaryActionId.value === item.id) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      setActionMessage(tr("settings.dictionaryPermissionDenied"), "error");
      return;
    }
    dictionaryActionId.value = item.id;
    try {
      if (!(await deps.confirmAction(tr("settings.dictionaryDeleteConfirm", { item: label, name: item.name })))) return;
      const base = section === "manufacturers"
        ? "manufacturers"
        : section === "device-types"
          ? "device-types"
          : "spare-part-categories";
      await deps.request(`/${base}/${item.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.dictionaryDeleted", { item: label }));
      invalidateDictionaryReferences();
      const refreshed = await loadDictionaries();
      if (!refreshed && dictionaryError.value) setActionMessage(tr("settings.dictionaryDeletedRefreshFailed", { item: label }), "error");
    } catch (error) {
      setActionError(error, tr("settings.dictionaryDeleteFailed", { item: label }));
    } finally {
      dictionaryActionId.value = null;
    }
  }
  function formatDateTime(value: string | null) {
    return value ? formatSystemDateTime(value) || tr("common.notAvailable") : tr("common.notAvailable");
  }
  function retryOrganization() {
    return loadOrganization();
  }

  function retryUserList() {
    return loadUsers();
  }

  async function changeUserPage(page: number) {
    clearUserSelection();
    userPage.value = Math.max(1, page);
    await loadUsers();
  }

  async function changeUserPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    clearUserSelection();
    userPageSize.value = size;
    userPage.value = 1;
    await loadUsers();
  }

  async function searchUsers() {
    clearUserSelection();
    userPage.value = 1;
    await loadUsers();
  }

  function retryCustomFieldList() {
    return loadCustomFields();
  }

  async function refreshCustomFieldList() {
    customFieldPage.value = 1;
    await loadCustomFields();
  }

  async function changeCustomFieldPage(page: number) {
    customFieldPage.value = Math.min(
      Math.max(page, 1),
      totalPages(customFieldCount.value, customFieldPageSize.value),
    );
    await loadCustomFields();
  }

  async function changeCustomFieldPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    customFieldPageSize.value = size;
    customFieldPage.value = 1;
    await loadCustomFields();
  }

  async function changeCustomFieldOptionPage(page: number) {
    customFieldOptionPage.value = Math.min(
      Math.max(page, 1),
      totalPages(customFieldOptionTotal.value, customFieldOptionPageSize.value),
    );
    await loadCustomFieldOptions(editingCustomField.value);
  }

  async function changeCustomFieldOptionPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    customFieldOptionPageSize.value = size;
    customFieldOptionPage.value = 1;
    await loadCustomFieldOptions(editingCustomField.value);
  }

  function retryTagList() {
    return loadTags();
  }

  async function refreshTagList() {
    tagPage.value = 1;
    await loadTags();
  }

  async function changeTagPage(page: number) {
    tagPage.value = Math.min(
      Math.max(page, 1),
      totalPages(tagCount.value, tagPageSize.value),
    );
    await loadTags();
  }

  async function changeTagPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    tagPageSize.value = size;
    tagPage.value = 1;
    await loadTags();
  }

  function retryAuditLogs() {
    return loadAuditLogs();
  }

  async function changeAuditPage(page: number) {
    auditPage.value = Math.max(1, page);
    await loadAuditLogs();
  }
  async function changeAuditPageSize(size: number) {
    auditPageSize.value = size;
    auditPage.value = 1;
    await loadAuditLogs();
  }
  async function searchAuditLogs() {
    auditPage.value = 1;
    await loadAuditLogs();
  }

  function resetSystemSettingsForm(): void {
    if (systemSettings.value) syncSystemSettingsForm(systemSettings.value);
    systemSettingsFormErrors.value = {};
  }

  async function saveSystemSettings(): Promise<void> {
    if (systemSettingsSaving.value) return;
    if (!deps.can("settings.manage")) {
      setActionMessage(tr("settings.settingsPermissionDenied"), "error");
      return;
    }
    systemSettingsSaving.value = true;
    systemSettingsFormErrors.value = {};
    try {
      const smtp_password = systemSettingsForm.value.smtp_password;
      const settingsPayload: Record<string, unknown> = { ...systemSettingsForm.value };
      delete settingsPayload.smtp_password;
      if (smtp_password) settingsPayload.smtp_password = smtp_password;
      const result = await deps.request<SystemSettings>("/system/settings/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsPayload),
      });
      systemSettings.value = result;
      syncSystemSettingsForm(result);
      applySystemSettingsSnapshot(result);
      setActionMessage(tr("settings.settingsSaved"));
    } catch (error) {
      systemSettingsFormErrors.value = extractFieldErrors(
        error,
        [...SYSTEM_SETTINGS_VALUE_KEYS, "smtp_password"],
      );
      setActionError(error, tr("settings.settingsSaveFailed"));
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
      setActionError(error, tr("settings.smtpTestFailed"));
    } finally {
      systemSmtpTesting.value = false;
    }
  }

  function openSystemResetDialog() {
    if (!deps.can("system.reset")) return;
    systemResetConfirmation.value = "";
    systemResetError.value = "";
    showSystemResetDialog.value = true;
  }

  function closeSystemResetDialog() {
    if (systemResetSaving.value) return;
    showSystemResetDialog.value = false;
    systemResetConfirmation.value = "";
    systemResetError.value = "";
  }

  async function resetSystem() {
    if (!deps.can("system.reset")) return;
    if (systemResetSaving.value) return;
    systemResetError.value = "";
    if (systemResetConfirmation.value !== systemResetConfirmationToken.value) {
      systemResetError.value = tr("settings.resetConfirmationError", { token: systemResetConfirmationToken.value });
      return;
    }
    systemResetSaving.value = true;
    try {
      await deps.request("/system/reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: systemResetConfirmation.value }),
      });
      showSystemResetDialog.value = false;
      systemResetConfirmation.value = "";
      systemResetError.value = "";
      deps.reload();
    } catch (error) {
      systemResetError.value = errorMessage(error, tr("settings.resetFailed"));
    } finally {
      systemResetSaving.value = false;
    }
  }

  return {
    systemSettings,
    systemSettingsForm,
    systemSettingsLoading,
    systemSettingsSaving,
    systemSettingsError,
    systemSettingsFormErrors,
    systemSettingsDefinitions,
    systemSmtpTesting,
    systemSmtpTestRecipient,
    ldapStatus,
    ldapConfiguration,
    ldapConfigurationForm,
    ldapConfigurationLoading,
    ldapConfigurationSaving,
    ldapConfigurationError,
    ldapConfigurationFormErrors,
    ldapConfigurationDirty,
    ldapStatusLoading,
    ldapStatusError,
    ldapDiagnosticLoading,
    ldapDiagnosticResult,
    ldapDiagnosticError,
    systemSettingsDirty,
    manufacturers,
    deviceTypes,
    spareCategories,
    customFields,
    customFieldTableItems,
    customFieldCount,
    customFieldPage,
    customFieldPageSize,
    customFieldDeviceType,
    customFieldActive,
    customFieldForm,
    customFieldOptionForm,
    editingCustomField,
    editingCustomFieldOption,
    showCustomFieldModal,
    showCustomFieldOptionModal,
    customFieldListLoading,
    customFieldListError,
    customFieldOptionLoading,
    customFieldOptionError,
    customFieldOptionPage,
    customFieldOptionPageSize,
    customFieldOptionTotal,
    customFieldSaving,
    customFieldOptionSaving,
    customFieldActionId,
    customFieldOptionActionId,
    customFieldFormErrors,
    customFieldOptionFormErrors,
    tags,
    tagTableItems,
    tagCount,
    tagPage,
    tagPageSize,
    tagSearch,
    tagActive,
    tagForm,
    editingTag,
    showTagModal,
    tagListLoading,
    tagListError,
    tagSaving,
    tagActionId,
    tagFormErrors,
    users,
    roles,
    userSearch,
    userPage,
    userPageSize,
    userCount,
    selectedUserIds,
    userBatchSaving,
    userBatchResult,
    showUserBatchResult,
    showUserModal,
    editingUser,
    userForm,
    userFormRef,
    userFormRules,
    showUserResetModal,
    resettingUser,
    userResetForm,
    userResetFormRef,
    userResetFormRules,
    userResetSaving,
    userResetError,
    userResetFormErrors,
    organizationLoading,
    organizationError,
    userListError,
    roleListError,
    userSaving,
    userPendingId,
    userFormErrors,
    unlinkedPeople,
    unlinkedPeopleLoading,
    unlinkedPeopleError,
    loadUnlinkedPeople,
    dictionarySection,
    dictionaryPage,
    dictionaryPageSize,
    dictionaryCount,
    dictionarySearch,
    showDictionaryModal,
    editingDictionary,
    dictionaryForm,
    dictionaryLoading,
    dictionaryError,
    dictionarySaving,
    dictionaryActionId,
    dictionaryFormErrors,
    departments,
    departmentOptions,
    departmentCount: departmentTotal,
    departmentPage,
    departmentPageSize,
    departmentSearch,
    departmentLoading,
    departmentError,
    departmentSaving,
    departmentActionId,
    departmentFormErrors,
    departmentForm,
    editingDepartment,
    showDepartmentModal,
    responsibilityDirectorySubjects,
    responsibilityDirectoryTotal,
    responsibilityDirectoryPage,
    responsibilityDirectoryPageSize,
    responsibilityDirectorySearch,
    responsibilityDirectoryType,
    responsibilityDirectoryActive,
    responsibilityDirectoryLoading,
    responsibilityDirectoryError,
    responsibilityDirectorySaving,
    responsibilityDirectoryActionId,
    responsibilityDirectoryFormErrors,
    responsibilityDirectoryForm,
    editingResponsibilitySubject,
    showResponsibilitySubjectModal,
    loadResponsibilityDirectory,
    searchResponsibilityDirectory,
    retryResponsibilityDirectory,
    changeResponsibilityDirectoryPage,
    changeResponsibilityDirectoryPageSize,
    openResponsibilitySubjectModal,
    saveResponsibilitySubject,
    toggleResponsibilitySubject,
    deleteResponsibilitySubject,
    loadDepartments,
    searchDepartments,
    changeDepartmentPage,
    changeDepartmentPageSize,
    retryDepartments,
    openDepartmentModal,
    saveDepartment,
    deleteDepartment,
    auditLogs,
    auditCount,
    auditPage,
    auditPageSize,
    auditFilters,
    auditListLoading,
    auditListError,
    loadDictionaries,
    loadSystemSettings,
    loadLdapStatus,
    retryLdapStatus: () => loadLdapStatus(),
    loadLdapConfiguration,
    retryLdapConfiguration: () => loadLdapConfiguration(),
    saveLdapConfiguration,
    resetLdapConfigurationForm,
    runLdapDiagnostics,
    retrySystemSettings,
    loadCustomFields,
    retryCustomFieldList,
    refreshCustomFieldList,
    changeCustomFieldPage,
    changeCustomFieldPageSize,
    changeCustomFieldOptionPage,
    changeCustomFieldOptionPageSize,
    loadCustomFieldOptions,
    retryCustomFieldOptions,
    loadTags,
    retryTagList,
    refreshTagList,
    changeTagPage,
    changeTagPageSize,
    loadOrganization,
    retryOrganization,
    loadUsers,
    retryUserList,
    handleUserSelection,
    clearUserSelection,
    batchUpdateUserStatus,
    closeUserBatchResult,
    searchUsers,
    changeUserPage,
    changeUserPageSize,
    loadAuditLogs,
    retryAuditLogs,
    openUserModal,
    saveUser,
    openUserResetModal,
    resetUserPassword,
    userProtectionReason,
    userDeleteProtectionReason,
    canChangeUserRole,
    toggleUser,
    deleteUser,
    openCustomFieldModal,
    saveCustomField,
    toggleCustomField,
    deleteCustomField,
    openCustomFieldOptionModal,
    saveCustomFieldOption,
    deleteCustomFieldOption,
    openTagModal,
    saveTag,
    toggleTag,
    deleteTag,
    currentDictionaryItems,
    changeDictionarySection,
    searchDictionaries,
    changeDictionaryPage,
    changeDictionaryPageSize,
    currentDictionaryLabel,
    dictionaryItemUsed,
    openDictionaryModal,
    retryDictionaries,
    saveDictionary,
    toggleDictionary,
    deleteDictionary,
    formatDateTime,
    changeAuditPage,
    changeAuditPageSize,
    searchAuditLogs,
    resetSystemSettingsForm,
    saveSystemSettings,
    testSystemSmtp,
    showSystemResetDialog,
    systemResetConfirmation,
    systemResetConfirmationToken,
    systemResetSaving,
    systemResetError,
    openSystemResetDialog,
    closeSystemResetDialog,
    resetSystem,
  };
}
