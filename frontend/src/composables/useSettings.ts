import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import { type FormInstance, type FormRules } from "element-plus";
import { flattenError, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type {
  AuditLog,
  CustomField,
  CustomFieldForm,
  CustomFieldOption,
  DictionaryItem,
  ManagedUser,
  Role,
  SparePartCategory,
  SystemSettingDefinition,
  SystemSettings,
  SystemSettingsForm,
  Tag,
  UserBatchStatusResponse,
} from "../types";
import type { SettingsSection } from "../router";
import type { CapabilityFn, RequestFn } from "../page-context";
import { applySystemSettings as applySystemSettingsSnapshot } from "../system-settings";
import { currentLocale, i18n } from "../i18n";

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
}

export const SYSTEM_RESET_CONFIRMATION = "RESET INFRIX";

type CustomFieldOptionForm = {
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

type FormErrors = Record<string, string>;

function extractFieldErrors(error: unknown, allowedFields: readonly string[]): FormErrors {
  const details = error && typeof error === "object" && "details" in error
    ? (error as { details?: unknown }).details
    : undefined;
  const source = details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown>
    : {};
  return Object.fromEntries(
    allowedFields
      .map((field) => [field, flattenError(source[field])] as const)
      .filter(([, message]) => Boolean(message)),
  );
}

export function useSettings(deps: SettingsDeps) {
  const manufacturers = ref<DictionaryItem[]>([]);
  const deviceTypes = ref<DictionaryItem[]>([]);
  const spareCategories = ref<SparePartCategory[]>([]);
  const customFields = ref<CustomField[]>([]);
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
  const customFieldRequestId = ref(0);
  const customFieldOptionRequestId = ref(0);
  const customFieldSaving = ref(false);
  const customFieldOptionSaving = ref(false);
  const customFieldActionId = ref<number | null>(null);
  const customFieldOptionActionId = ref<number | null>(null);
  const customFieldFormErrors = ref<FormErrors>({});
  const customFieldOptionFormErrors = ref<FormErrors>({});

  const tags = ref<Tag[]>([]);
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
          else if (password && password.length < 8) callback(new Error(tr("validation.passwordMin")));
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
      { min: 8, message: tr("validation.passwordMin"), trigger: ["blur", "change"] },
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
  const dictionarySaving = ref(false);
  const dictionaryActionId = ref<number | null>(null);
  const dictionaryFormErrors = ref<FormErrors>({});

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
  const systemSettingsForm = ref<SystemSettingsForm>({
    default_page_size: 50,
    default_asset_status: "in_stock",
  });
  const systemSettingsLoading = ref(false);
  const systemSettingsSaving = ref(false);
  const systemSettingsError = ref("");
  const systemSettingsFormErrors = ref<FormErrors>({});
  const systemSettingsRequestId = ref(0);
  const systemSettingsDefinitions = computed<SystemSettingDefinition[]>(
    () => systemSettings.value?.definitions || [],
  );
  const systemSettingsDirty = computed(() => {
    if (!systemSettings.value) return false;
    return (
      systemSettingsForm.value.default_page_size !== systemSettings.value.default_page_size
      || systemSettingsForm.value.default_asset_status !== systemSettings.value.default_asset_status
    );
  });
  const showSystemResetDialog = ref(false);
  const systemResetConfirmation = ref("");
  const systemResetConfirmationToken = ref(SYSTEM_RESET_CONFIRMATION);
  const systemResetSaving = ref(false);
  const systemResetError = ref("");

  const organizationError = computed(() => userListError.value || roleListError.value);

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function dictionaryCapability(_kind = dictionarySection.value) {
    return "settings.manage";
  }

  function canManageDictionary(kind = dictionarySection.value) {
    return deps.can(dictionaryCapability(kind));
  }

  function totalPages(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / pageSize));
  }

  function pageSlice<T>(items: T[], page: number, pageSize: number): T[] {
    const size = Math.max(1, pageSize);
    const start = (Math.max(1, page) - 1) * size;
    return items.slice(start, start + size);
  }

  function syncSystemSettingsForm(value: SystemSettings): void {
    systemSettingsForm.value = {
      default_page_size: value.default_page_size,
      default_asset_status: value.default_asset_status,
    };
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

  async function loadDictionaries(version = deps.beginLoad()): Promise<boolean> {
    if (!(
      deps.can("settings.view") ||
      deps.can("assets.view") ||
      deps.can("licenses.view") ||
      deps.can("spares.view")
    )) return false;
    const requestId = ++dictionaryRequestId.value;
    const params = new URLSearchParams({ page_size: "100", is_active: "all" });
    if (dictionarySearch.value.trim()) params.set("search", dictionarySearch.value.trim());
    dictionaryLoading.value = true;
    dictionaryError.value = "";
    try {
      const spareCategoryRequest = deps.can("spares.view") || deps.can("spares.manage") || deps.can("settings.manage")
        ? deps.request<PageResult<SparePartCategory> | SparePartCategory[]>(`/spare-part-categories/?${params.toString()}`)
        : Promise.resolve<SparePartCategory[]>([]);
      const manufacturerRequest = (
        deps.can("settings.view") || deps.can("assets.view") || deps.can("licenses.view") || deps.can("spares.view")
      )
        ? deps.request<PageResult<DictionaryItem> | DictionaryItem[]>(`/manufacturers/?${params.toString()}`)
        : Promise.resolve<DictionaryItem[]>([]);
      const deviceTypeRequest = deps.can("settings.view")
        ? deps.request<PageResult<DictionaryItem> | DictionaryItem[]>(`/device-types/?${params.toString()}`)
        : Promise.resolve<DictionaryItem[]>([]);
      const [manufacturerResult, deviceTypeResult, spareCategoryResult] = await Promise.all([
        manufacturerRequest,
        deviceTypeRequest,
        spareCategoryRequest,
      ]);
      if (manufacturerResult == null || deviceTypeResult == null || spareCategoryResult == null) return false;
      if (requestId !== dictionaryRequestId.value || !deps.isCurrentLoad(version)) return false;
      manufacturers.value = pageItems(manufacturerResult);
      deviceTypes.value = pageItems(deviceTypeResult);
      spareCategories.value = pageItems(spareCategoryResult);
      dictionaryPage.value = Math.min(dictionaryPage.value, totalPages(currentDictionaryAllItems().length, dictionaryPageSize.value));
      return true;
    } catch (error) {
      if (requestId === dictionaryRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        dictionaryError.value = errorMessage(error, tr("settings.dictionaryDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === dictionaryRequestId.value) dictionaryLoading.value = false;
    }
  }

  async function loadCustomFields(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("custom_fields.view")) return false;
    const requestId = ++customFieldRequestId.value;
    const params = new URLSearchParams({ page_size: "100", is_active: customFieldActive.value || "all" });
    if (customFieldDeviceType.value) params.set("device_type", customFieldDeviceType.value);
    customFieldListLoading.value = true;
    customFieldListError.value = "";
    try {
      const result = await deps.request<PageResult<CustomField> | CustomField[]>(`/custom-fields/?${params.toString()}`);
      if (result == null || requestId !== customFieldRequestId.value || !deps.isCurrentLoad(version)) return false;
      customFields.value = pageItems(result);
      customFieldPage.value = Math.min(customFieldPage.value, totalPages(customFields.value.length, customFieldPageSize.value));
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
    field.options = [];
    try {
      const params = new URLSearchParams({ page_size: "100", field: String(field.id) });
      const result = await deps.request<PageResult<CustomFieldOption> | CustomFieldOption[]>(`/custom-field-options/?${params.toString()}`);
      if (result == null || requestId !== customFieldOptionRequestId.value || !deps.isCurrentLoad(version)) return false;
      field.options = pageItems(result);
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

  async function loadTags(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("tags.view")) return false;
    const requestId = ++tagRequestId.value;
    const params = new URLSearchParams({ page_size: "100", is_active: tagActive.value || "all" });
    if (tagSearch.value.trim()) params.set("search", tagSearch.value.trim());
    tagListLoading.value = true;
    tagListError.value = "";
    try {
      const result = await deps.request<PageResult<Tag> | Tag[]>(`/tags/?${params.toString()}`);
      if (result == null || requestId !== tagRequestId.value || !deps.isCurrentLoad(version)) return false;
      tags.value = pageItems(result);
      tagPage.value = Math.min(tagPage.value, totalPages(tags.value.length, tagPageSize.value));
      return true;
    } catch (error) {
      if (requestId === tagRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        tagListError.value = errorMessage(error, tr("settings.tagDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === tagRequestId.value) tagListLoading.value = false;
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
        };
    showUserModal.value = true;
    nextTick(() => userFormRef.value?.clearValidate());
  }

  function userProtectionReason(user: ManagedUser): string {
    if (user.is_superuser) return tr("settings.superuserProtected");
    if (user.username === deps.currentUsername.value) return tr("settings.currentUserProtected");
    return "";
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
        "password",
      ]);
      deps.actionMessage.value = errorMessage(error, tr("settings.userSaveFailed"));
    } finally {
      userSaving.value = false;
    }
    if (!saved) return;
    showUserModal.value = false;
    deps.actionMessage.value = tr("settings.userSaved");
    const refreshed = await loadUsers();
    if (!refreshed && userListError.value) deps.actionMessage.value = tr("settings.userSavedRefreshFailed");
  }

  async function resetUserPassword() {
    if (!deps.can("organization.manage")) return;
    const user = resettingUser.value;
    if (!user || userPendingId.value === user.id || userResetSaving.value) return;
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
      deps.actionMessage.value = userResetError.value;
    } finally {
      userResetSaving.value = false;
      userPendingId.value = null;
    }
    if (!saved) return;
    showUserResetModal.value = false;
    resettingUser.value = null;
    userResetError.value = "";
    userResetForm.value = { new_password: "", confirm_password: "" };
    deps.actionMessage.value = tr("settings.passwordReset");
  }

  async function toggleUser(user: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    if (userProtectionReason(user)) {
      deps.actionMessage.value = userProtectionReason(user);
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
      deps.actionMessage.value = user.is_active ? tr("settings.userDisabled") : tr("settings.userEnabled");
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) deps.actionMessage.value = tr("settings.userStatusRefreshFailed");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("settings.userStatusFailed"));
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
      deps.actionMessage.value = mutationMessage;
      const refreshed = await loadUsers();
      if (!refreshed) {
        deps.actionMessage.value = `${mutationMessage}; ${tr("common.refreshFailed")}. ${tr("common.retry")}.`;
      }
      if (result.failed) showUserBatchResult.value = true;
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("settings.batchUserStatusFailed", { action: actionLabel }));
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
    if (userProtectionReason(user)) {
      deps.actionMessage.value = userProtectionReason(user);
      return;
    }
    if (userPendingId.value === user.id) return;
    userPendingId.value = user.id;
    try {
      if (!(await deps.confirmAction(tr("settings.userDeleteConfirm", { username: user.username })))) return;
      await deps.request(`/users/${user.id}/`, { method: "DELETE" });
      deps.actionMessage.value = tr("settings.userDeleted");
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) deps.actionMessage.value = tr("settings.userDeletedRefreshFailed");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("settings.userDeleteFailed"));
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
      deps.actionMessage.value = errorMessage(error, tr("customField.saveFailed"));
    } finally {
      customFieldSaving.value = false;
    }
    if (!saved) return;
    showCustomFieldModal.value = false;
    deps.actionMessage.value = tr("customField.saved");
    const refreshed = await loadCustomFields();
    if (!refreshed && customFieldListError.value) deps.actionMessage.value = tr("customField.savedRefreshFailed");
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
      deps.actionMessage.value = field.is_active ? tr("customField.disabled") : tr("customField.enabled");
      const refreshed = await loadCustomFields();
      if (!refreshed && customFieldListError.value) deps.actionMessage.value = tr("customField.statusRefreshFailed");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("customField.statusFailed"));
    } finally {
      customFieldActionId.value = null;
    }
  }
  async function deleteCustomField(field: CustomField) {
    if (!deps.can("custom_fields.manage")) return;
    if ((field.assets_count || 0) > 0) {
      deps.actionMessage.value = tr("customField.inUse");
      return;
    }
    if (customFieldActionId.value === field.id) return;
    customFieldActionId.value = field.id;
    try {
      if (!(await deps.confirmAction(tr("customField.deleteConfirm", { name: field.name })))) return;
      await deps.request(`/custom-fields/${field.id}/`, { method: "DELETE" });
      deps.actionMessage.value = tr("customField.deleted");
      const refreshed = await loadCustomFields();
      if (!refreshed && customFieldListError.value) deps.actionMessage.value = tr("customField.deletedRefreshFailed");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("customField.deleteFailed"));
    } finally {
      customFieldActionId.value = null;
    }
  }
  function openCustomFieldOptionModal(field?: CustomField | null, option?: CustomFieldOption) {
    if (!field || !deps.can("custom_fields.manage")) return;
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
      deps.actionMessage.value = errorMessage(error, tr("customField.optionSaveFailed"));
    } finally {
      customFieldOptionSaving.value = false;
    }
    if (!saved) return;
    showCustomFieldOptionModal.value = false;
    deps.actionMessage.value = tr("customField.optionSaved");
    const refreshed = await loadCustomFields();
    if (!refreshed && customFieldListError.value) deps.actionMessage.value = tr("customField.optionSavedRefreshFailed");
  }
  async function deleteCustomFieldOption(option: CustomFieldOption) {
    if (!deps.can("custom_fields.manage")) return;
    if (customFieldOptionActionId.value === option.id) return;
    customFieldOptionActionId.value = option.id;
    try {
      if (!(await deps.confirmAction(tr("customField.optionDeleteConfirm", { name: option.label })))) return;
      await deps.request(`/custom-field-options/${option.id}/`, { method: "DELETE" });
      deps.actionMessage.value = tr("customField.optionDeleted");
      const refreshed = await loadCustomFieldOptions(editingCustomField.value);
      if (!refreshed && customFieldOptionError.value) deps.actionMessage.value = tr("customField.optionDeletedRefreshFailed");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("customField.optionDeleteFailed"));
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
      deps.actionMessage.value = errorMessage(error, tr("tag.saveFailed"));
    } finally {
      tagSaving.value = false;
    }
    if (!saved) return;
    showTagModal.value = false;
    deps.actionMessage.value = tr("tag.saved");
    const refreshed = await loadTags();
    if (!refreshed && tagListError.value) deps.actionMessage.value = tr("tag.savedRefreshFailed");
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
      deps.actionMessage.value = tag.is_active ? tr("tag.disabled") : tr("tag.enabled");
      const refreshed = await loadTags();
      if (!refreshed && tagListError.value) deps.actionMessage.value = tr("tag.statusRefreshFailed");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("tag.statusFailed"));
    } finally {
      tagActionId.value = null;
    }
  }
  async function deleteTag(tag: Tag) {
    if (!deps.can("tags.manage")) return;
    if ((tag.assets_count || 0) > 0) {
      deps.actionMessage.value = tr("tag.inUse");
      return;
    }
    if (tagActionId.value === tag.id) return;
    tagActionId.value = tag.id;
    try {
      if (!(await deps.confirmAction(tr("tag.deleteConfirm", { name: tag.name })))) return;
      await deps.request(`/tags/${tag.id}/`, { method: "DELETE" });
      deps.actionMessage.value = tr("tag.deleted");
      const refreshed = await loadTags();
      if (!refreshed && tagListError.value) deps.actionMessage.value = tr("tag.deletedRefreshFailed");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("tag.deleteFailed"));
    } finally {
      tagActionId.value = null;
    }
  }

  function currentDictionaryAllItems(): Array<DictionaryItem | SparePartCategory> {
    return dictionarySection.value === "manufacturers"
      ? manufacturers.value
      : dictionarySection.value === "device-types"
        ? deviceTypes.value
        : spareCategories.value;
  }

  const currentDictionaryItems = computed<Array<DictionaryItem | SparePartCategory>>(() =>
    pageSlice(currentDictionaryAllItems(), dictionaryPage.value, dictionaryPageSize.value),
  );
  const dictionaryCount = computed(() => currentDictionaryAllItems().length);
  const customFieldTableItems = computed(() =>
    pageSlice(customFields.value, customFieldPage.value, customFieldPageSize.value),
  );
  const customFieldCount = computed(() => customFields.value.length);
  const tagTableItems = computed(() => pageSlice(tags.value, tagPage.value, tagPageSize.value));
  const tagCount = computed(() => tags.value.length);
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

  function changeDictionaryPage(page: number) {
    dictionaryPage.value = Math.min(
      Math.max(page, 1),
      totalPages(dictionaryCount.value, dictionaryPageSize.value),
    );
  }

  function changeDictionaryPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    dictionaryPageSize.value = size;
    dictionaryPage.value = 1;
  }
  async function saveDictionary() {
    if (dictionarySaving.value) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      deps.actionMessage.value = tr("settings.dictionaryPermissionDenied");
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
      deps.actionMessage.value = errorMessage(error, tr("settings.dictionarySaveFailed", { item: label }));
    } finally {
      dictionarySaving.value = false;
    }
    if (!saved) return;
    showDictionaryModal.value = false;
    deps.actionMessage.value = tr("settings.dictionarySaved", { item: label });
    const refreshed = await loadDictionaries();
    if (!refreshed && dictionaryError.value) deps.actionMessage.value = tr("settings.dictionarySavedRefreshFailed", { item: label });
  }
  async function toggleDictionary(item: DictionaryItem) {
    if (dictionaryActionId.value === item.id) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      deps.actionMessage.value = tr("settings.dictionaryPermissionDenied");
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
      deps.actionMessage.value = item.is_active
        ? tr("settings.dictionaryDisabled", { item: label })
        : tr("settings.dictionaryEnabled", { item: label });
      const refreshed = await loadDictionaries();
      if (!refreshed && dictionaryError.value) deps.actionMessage.value = tr("settings.dictionaryStatusRefreshFailed", { item: label });
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("settings.dictionaryStatusFailed", { item: label }));
    } finally {
      dictionaryActionId.value = null;
    }
  }
  async function deleteDictionary(item: DictionaryItem) {
    if (dictionaryItemUsed(item)) {
      deps.actionMessage.value = dictionarySection.value === "manufacturers"
        ? tr("settings.manufacturerInUse")
        : dictionarySection.value === "spare-categories"
          ? tr("settings.spareCategoryInUse")
          : tr("settings.dictionaryItemInUse");
      return;
    }
    if (dictionaryActionId.value === item.id) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      deps.actionMessage.value = tr("settings.dictionaryPermissionDenied");
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
      deps.actionMessage.value = tr("settings.dictionaryDeleted", { item: label });
      const refreshed = await loadDictionaries();
      if (!refreshed && dictionaryError.value) deps.actionMessage.value = tr("settings.dictionaryDeletedRefreshFailed", { item: label });
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, tr("settings.dictionaryDeleteFailed", { item: label }));
    } finally {
      dictionaryActionId.value = null;
    }
  }
  function formatDateTime(value: string | null) {
    return value ? new Date(value).toLocaleString(currentLocale.value) : tr("common.notAvailable");
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

  function changeCustomFieldPage(page: number) {
    customFieldPage.value = Math.min(
      Math.max(page, 1),
      totalPages(customFieldCount.value, customFieldPageSize.value),
    );
  }

  function changeCustomFieldPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    customFieldPageSize.value = size;
    customFieldPage.value = 1;
  }

  function retryTagList() {
    return loadTags();
  }

  async function refreshTagList() {
    tagPage.value = 1;
    await loadTags();
  }

  function changeTagPage(page: number) {
    tagPage.value = Math.min(
      Math.max(page, 1),
      totalPages(tagCount.value, tagPageSize.value),
    );
  }

  function changeTagPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    tagPageSize.value = size;
    tagPage.value = 1;
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
      deps.actionMessage.value = tr("settings.settingsPermissionDenied");
      return;
    }
    systemSettingsSaving.value = true;
    systemSettingsFormErrors.value = {};
    try {
      const result = await deps.request<SystemSettings>("/system/settings/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_page_size: systemSettingsForm.value.default_page_size,
          default_asset_status: systemSettingsForm.value.default_asset_status,
        }),
      });
      systemSettings.value = result;
      syncSystemSettingsForm(result);
      applySystemSettingsSnapshot(result);
      deps.actionMessage.value = tr("settings.settingsSaved");
    } catch (error) {
      systemSettingsFormErrors.value = extractFieldErrors(
        error,
        ["default_page_size", "default_asset_status"],
      );
      deps.actionMessage.value = errorMessage(error, tr("settings.settingsSaveFailed"));
    } finally {
      systemSettingsSaving.value = false;
    }
  }

  function retrySystemSettings(): Promise<boolean> {
    return loadSystemSettings();
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
    auditLogs,
    auditCount,
    auditPage,
    auditPageSize,
    auditFilters,
    auditListLoading,
    auditListError,
    loadDictionaries,
    loadSystemSettings,
    retrySystemSettings,
    loadCustomFields,
    retryCustomFieldList,
    refreshCustomFieldList,
    changeCustomFieldPage,
    changeCustomFieldPageSize,
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
