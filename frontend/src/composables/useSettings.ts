import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import { type FormInstance, type FormRules } from "element-plus";
import { flattenError, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type {
  AuditLog,
  CustomField,
  CustomFieldForm,
  CustomFieldOption,
  DataCenter,
  DictionaryItem,
  ManagedUser,
  Role,
  Tag,
} from "../types";
import type { SettingsSection } from "../router";
import type { CapabilityFn, RequestFn } from "../types/page-context";

export interface SettingsDeps {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  can: CapabilityFn;
  isAdmin: Ref<boolean>;
  currentUsername: Ref<string>;
  settingsSection: Ref<SettingsSection>;
  dataCenters: Ref<DataCenter[]>;
  actionMessage: Ref<string>;
}

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
  const customFields = ref<CustomField[]>([]);
  const customFieldDeviceType = ref("");
  const customFieldActive = ref("all");
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
  const tagSearch = ref("");
  const tagActive = ref("all");
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
  const showUserModal = ref(false);
  const editingUser = ref<ManagedUser | null>(null);
  const showUserResetModal = ref(false);
  const resettingUser = ref<ManagedUser | null>(null);
  const userResetForm = ref({ new_password: "", confirm_password: "" });
  const userResetSaving = ref(false);
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
  const userFormRules: FormRules = {
    username: [{ required: true, message: "请输入用户名", trigger: "blur" }],
    last_name: [{ required: true, message: "请输入姓", trigger: "blur" }],
    first_name: [{ required: true, message: "请输入名", trigger: "blur" }],
    email: [{ type: "email", message: "请输入有效邮箱", trigger: ["blur", "change"] }],
    role_code: [{ required: true, message: "请选择角色", trigger: "change" }],
    password: [
      {
        validator: (_rule, value, callback) => {
          const password = String(value || "");
          if (!editingUser.value && !password) callback(new Error("请输入密码"));
          else if (password && password.length < 8) callback(new Error("密码至少需要 8 位"));
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
          else if (!confirmation) callback(new Error("请确认密码"));
          else if (confirmation !== password) callback(new Error("两次输入的密码不一致"));
          else callback();
        },
        trigger: ["blur", "change"],
      },
    ],
  };
  const userResetFormRules: FormRules = {
    new_password: [
      { required: true, message: "请输入新密码", trigger: "blur" },
      { min: 8, message: "密码至少需要 8 位", trigger: ["blur", "change"] },
    ],
    confirm_password: [
      { required: true, message: "请确认新密码", trigger: "blur" },
      {
        validator: (_rule, value, callback) => {
          if (String(value || "") !== String(userResetForm.value.new_password || "")) {
            callback(new Error("两次输入的密码不一致"));
          } else {
            callback();
          }
        },
        trigger: ["blur", "change"],
      },
    ],
  };
  const dictionarySection = ref<"manufacturers" | "device-types" | "data-centers">("manufacturers");
  const dictionarySearch = ref("");
  const showDictionaryModal = ref(false);
  const editingDictionary = ref<DictionaryItem | DataCenter | null>(null);
  const dictionaryForm = ref({ name: "", code: "", address: "", color: "#1677EF", is_active: true });
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

  const organizationError = computed(() => userListError.value || roleListError.value);

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function dictionaryCapability(kind = dictionarySection.value) {
    return kind === "data-centers" ? "racks.manage" : "settings.manage";
  }

  function canManageDictionary(kind = dictionarySection.value) {
    return deps.can(dictionaryCapability(kind));
  }

  function totalPages(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / pageSize));
  }

  async function loadDictionaries(version = deps.beginLoad()): Promise<boolean> {
    const requestId = ++dictionaryRequestId.value;
    const params = new URLSearchParams({ page_size: "100", is_active: "all" });
    if (dictionarySearch.value.trim()) params.set("search", dictionarySearch.value.trim());
    const dataCenterParams = new URLSearchParams({ page_size: "100", is_active: "all" });
    if (dictionarySearch.value.trim()) dataCenterParams.set("search", dictionarySearch.value.trim());
    dictionaryLoading.value = true;
    dictionaryError.value = "";
    try {
      const dataCenterRequest = deps.can("racks.view")
        ? deps.request<PageResult<DataCenter> | DataCenter[]>(`/data-centers/?${dataCenterParams.toString()}`)
        : Promise.resolve<DataCenter[]>([]);
      const [manufacturerResult, deviceTypeResult, dataCenterResult] = await Promise.all([
        deps.request<PageResult<DictionaryItem> | DictionaryItem[]>(`/manufacturers/?${params.toString()}`),
        deps.request<PageResult<DictionaryItem> | DictionaryItem[]>(`/device-types/?${params.toString()}`),
        dataCenterRequest,
      ]);
      if (manufacturerResult == null || deviceTypeResult == null || dataCenterResult == null) return false;
      if (requestId !== dictionaryRequestId.value || !deps.isCurrentLoad(version)) return false;
      manufacturers.value = pageItems(manufacturerResult);
      deviceTypes.value = pageItems(deviceTypeResult);
      deps.dataCenters.value = pageItems(dataCenterResult);
      return true;
    } catch (error) {
      if (requestId === dictionaryRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        dictionaryError.value = errorMessage(error, "字典数据加载失败");
      }
      return false;
    } finally {
      if (requestId === dictionaryRequestId.value) dictionaryLoading.value = false;
    }
  }

  async function loadCustomFields(version = deps.beginLoad()): Promise<boolean> {
    const requestId = ++customFieldRequestId.value;
    const params = new URLSearchParams({ page_size: "100", is_active: customFieldActive.value || "all" });
    if (customFieldDeviceType.value) params.set("device_type", customFieldDeviceType.value);
    customFieldListLoading.value = true;
    customFieldListError.value = "";
    try {
      const result = await deps.request<PageResult<CustomField> | CustomField[]>(`/custom-fields/?${params.toString()}`);
      if (result == null || requestId !== customFieldRequestId.value || !deps.isCurrentLoad(version)) return false;
      customFields.value = pageItems(result);
      return true;
    } catch (error) {
      if (requestId === customFieldRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        customFieldListError.value = errorMessage(error, "自定义字段数据加载失败");
      }
      return false;
    } finally {
      if (requestId === customFieldRequestId.value) customFieldListLoading.value = false;
    }
  }

  async function loadCustomFieldOptions(field = editingCustomField.value, version = deps.beginLoad()): Promise<boolean> {
    if (!field) return false;
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
        customFieldOptionError.value = errorMessage(error, "字段选项加载失败");
      }
      return false;
    } finally {
      if (requestId === customFieldOptionRequestId.value) customFieldOptionLoading.value = false;
    }
  }

  async function loadTags(version = deps.beginLoad()): Promise<boolean> {
    const requestId = ++tagRequestId.value;
    const params = new URLSearchParams({ page_size: "100", is_active: tagActive.value });
    if (tagSearch.value.trim()) params.set("search", tagSearch.value.trim());
    tagListLoading.value = true;
    tagListError.value = "";
    try {
      const result = await deps.request<PageResult<Tag> | Tag[]>(`/tags/?${params.toString()}`);
      if (result == null || requestId !== tagRequestId.value || !deps.isCurrentLoad(version)) return false;
      tags.value = pageItems(result);
      return true;
    } catch (error) {
      if (requestId === tagRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        tagListError.value = errorMessage(error, "标签数据加载失败");
      }
      return false;
    } finally {
      if (requestId === tagRequestId.value) tagListLoading.value = false;
    }
  }

  async function loadOrganization(version = deps.beginLoad()): Promise<boolean> {
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
            ? errorMessage(userResult.reason, "用户数据加载失败")
            : "用户数据加载失败";
        }
      }
      if (roleResult.status === "fulfilled" && roleResult.value != null) {
        roles.value = pageItems(roleResult.value);
      } else {
        refreshed = false;
        const roleError = roleResult.status === "rejected" ? roleResult.reason : undefined;
        if (!isAbortError(roleError)) {
          roleListError.value = roleResult.status === "rejected"
            ? errorMessage(roleResult.reason, "角色数据加载失败")
            : "角色数据加载失败";
        }
      }
      return refreshed;
    } catch (error) {
      if (requestId === organizationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        userListError.value = errorMessage(error, "用户数据加载失败");
        roleListError.value = errorMessage(error, "角色数据加载失败");
      }
      return false;
    } finally {
      if (requestId === organizationRequestId.value) organizationLoading.value = false;
    }
  }

  async function loadUsers(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
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
      userCount.value = nextCount;
      return true;
    } catch (error) {
      if (requestId === userRequestId.value && organizationRequest === organizationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        userListError.value = errorMessage(error, "用户数据加载失败");
      }
      return false;
    } finally {
      if (organizationRequest === organizationRequestId.value) organizationLoading.value = false;
    }
  }

  async function loadAuditLogs(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    const requestId = ++auditRequestId.value;
    const params = new URLSearchParams({ page: String(auditPage.value), page_size: String(auditPageSize.value) });
    Object.entries(auditFilters.value).forEach(([key, value]) => {
      const normalizedValue = String(value || "").trim();
      if (normalizedValue) params.set(key, normalizedValue);
    });
    auditListLoading.value = true;
    auditListError.value = "";
    if (auditFilters.value.start && auditFilters.value.end && auditFilters.value.start > auditFilters.value.end) {
      auditListError.value = "开始日期不能晚于结束日期";
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
        auditListError.value = errorMessage(error, "操作日志数据加载失败");
      }
      return false;
    } finally {
      if (requestId === auditRequestId.value) auditListLoading.value = false;
    }
  }

  function openUserModal(user?: ManagedUser) {
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
          role_code: user.assigned_role_code || "auditor",
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
    if (user.is_superuser) return "超级管理员账号受保护，不能停用或删除";
    if (user.username === deps.currentUsername.value) return "不能停用或删除当前登录账号";
    return "";
  }

  function canChangeUserRole(user: ManagedUser): boolean {
    return !user.is_superuser && user.username !== deps.currentUsername.value;
  }

  function openUserResetModal(user: ManagedUser) {
    resettingUser.value = user;
    userResetForm.value = { new_password: "", confirm_password: "" };
    userResetFormErrors.value = {};
    showUserResetModal.value = true;
    nextTick(() => userResetFormRef.value?.clearValidate());
  }

  async function saveUser() {
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
      deps.actionMessage.value = errorMessage(error, "用户保存失败");
    } finally {
      userSaving.value = false;
    }
    if (!saved) return;
    showUserModal.value = false;
    deps.actionMessage.value = "用户账号已保存";
    const refreshed = await loadUsers();
    if (!refreshed && userListError.value) deps.actionMessage.value = "用户账号已保存，但用户列表刷新失败，请重试";
  }

  async function resetUserPassword() {
    const user = resettingUser.value;
    if (!user || userPendingId.value === user.id || userResetSaving.value) return;
    userPendingId.value = user.id;
    userResetSaving.value = true;
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
      deps.actionMessage.value = errorMessage(error, "密码重置失败");
    } finally {
      userResetSaving.value = false;
      userPendingId.value = null;
    }
    if (!saved) return;
    showUserResetModal.value = false;
    resettingUser.value = null;
    userResetForm.value = { new_password: "", confirm_password: "" };
    deps.actionMessage.value = "用户密码已重置";
  }

  async function toggleUser(user: ManagedUser) {
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
      deps.actionMessage.value = user.is_active ? "用户已停用" : "用户已启用";
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) deps.actionMessage.value = "用户状态已更新，但用户列表刷新失败，请重试";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "用户状态更新失败");
    } finally {
      userPendingId.value = null;
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (userProtectionReason(user)) {
      deps.actionMessage.value = userProtectionReason(user);
      return;
    }
    if (userPendingId.value === user.id) return;
    userPendingId.value = user.id;
    try {
      if (!(await deps.confirmAction(`确定删除用户“${user.username}”吗？`))) return;
      await deps.request(`/users/${user.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "用户已删除";
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) deps.actionMessage.value = "用户已删除，但用户列表刷新失败，请重试";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "用户删除失败");
    } finally {
      userPendingId.value = null;
    }
  }


  function openCustomFieldModal(field?: CustomField) {
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
      deps.actionMessage.value = errorMessage(error, "自定义字段保存失败");
    } finally {
      customFieldSaving.value = false;
    }
    if (!saved) return;
    showCustomFieldModal.value = false;
    deps.actionMessage.value = "自定义字段已保存";
    const refreshed = await loadCustomFields();
    if (!refreshed && customFieldListError.value) deps.actionMessage.value = "自定义字段已保存，但列表刷新失败，请重试";
  }
  async function toggleCustomField(field: CustomField) {
    if (customFieldActionId.value === field.id) return;
    customFieldActionId.value = field.id;
    try {
      await deps.request(`/custom-fields/${field.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !field.is_active }),
      });
      deps.actionMessage.value = field.is_active ? "自定义字段已停用" : "自定义字段已启用";
      const refreshed = await loadCustomFields();
      if (!refreshed && customFieldListError.value) deps.actionMessage.value = "自定义字段状态已更新，但列表刷新失败，请重试";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "自定义字段状态更新失败");
    } finally {
      customFieldActionId.value = null;
    }
  }
  async function deleteCustomField(field: CustomField) {
    if ((field.assets_count || 0) > 0) {
      deps.actionMessage.value = "字段已有资产值，不能删除，请先停用";
      return;
    }
    if (customFieldActionId.value === field.id) return;
    customFieldActionId.value = field.id;
    try {
      if (!(await deps.confirmAction(`确定删除字段“${field.name}”吗？`))) return;
      await deps.request(`/custom-fields/${field.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "自定义字段已删除";
      const refreshed = await loadCustomFields();
      if (!refreshed && customFieldListError.value) deps.actionMessage.value = "自定义字段已删除，但列表刷新失败，请重试";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "自定义字段删除失败");
    } finally {
      customFieldActionId.value = null;
    }
  }
  function openCustomFieldOptionModal(field?: CustomField | null, option?: CustomFieldOption) {
    if (!field) return;
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
      deps.actionMessage.value = errorMessage(error, "字段选项保存失败");
    } finally {
      customFieldOptionSaving.value = false;
    }
    if (!saved) return;
    showCustomFieldOptionModal.value = false;
    deps.actionMessage.value = "字段选项已保存";
    const refreshed = await loadCustomFields();
    if (!refreshed && customFieldListError.value) deps.actionMessage.value = "字段选项已保存，但字段列表刷新失败，请重试";
  }
  async function deleteCustomFieldOption(option: CustomFieldOption) {
    if (customFieldOptionActionId.value === option.id) return;
    customFieldOptionActionId.value = option.id;
    try {
      if (!(await deps.confirmAction(`确定删除选项“${option.label}”吗？`))) return;
      await deps.request(`/custom-field-options/${option.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "字段选项已删除";
      const refreshed = await loadCustomFieldOptions(editingCustomField.value);
      if (!refreshed && customFieldOptionError.value) deps.actionMessage.value = "字段选项已删除，但选项列表刷新失败，请重试";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "字段选项删除失败");
    } finally {
      customFieldOptionActionId.value = null;
    }
  }

  function openTagModal(tag?: Tag) {
    editingTag.value = tag || null;
    tagFormErrors.value = {};
    tagForm.value = tag ? { name: tag.name, is_active: tag.is_active } : { name: "", is_active: true };
    showTagModal.value = true;
  }
  async function saveTag() {
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
      deps.actionMessage.value = errorMessage(error, "标签保存失败");
    } finally {
      tagSaving.value = false;
    }
    if (!saved) return;
    showTagModal.value = false;
    deps.actionMessage.value = "标签已保存";
    const refreshed = await loadTags();
    if (!refreshed && tagListError.value) deps.actionMessage.value = "标签已保存，但列表刷新失败，请重试";
  }
  async function toggleTag(tag: Tag) {
    if (tagActionId.value === tag.id) return;
    tagActionId.value = tag.id;
    try {
      await deps.request(`/tags/${tag.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !tag.is_active }),
      });
      deps.actionMessage.value = tag.is_active ? "标签已停用" : "标签已启用";
      const refreshed = await loadTags();
      if (!refreshed && tagListError.value) deps.actionMessage.value = "标签状态已更新，但列表刷新失败，请重试";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "标签状态更新失败");
    } finally {
      tagActionId.value = null;
    }
  }
  async function deleteTag(tag: Tag) {
    if ((tag.assets_count || 0) > 0) {
      deps.actionMessage.value = "标签正在被资产使用，不能删除，请先停用";
      return;
    }
    if (tagActionId.value === tag.id) return;
    tagActionId.value = tag.id;
    try {
      if (!(await deps.confirmAction(`确定删除标签“${tag.name}”吗？`))) return;
      await deps.request(`/tags/${tag.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "标签已删除";
      const refreshed = await loadTags();
      if (!refreshed && tagListError.value) deps.actionMessage.value = "标签已删除，但列表刷新失败，请重试";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "标签删除失败");
    } finally {
      tagActionId.value = null;
    }
  }

  const currentDictionaryItems = computed<Array<DictionaryItem | DataCenter>>(() =>
    dictionarySection.value === "manufacturers"
      ? manufacturers.value
      : dictionarySection.value === "device-types"
        ? deviceTypes.value
        : deps.dataCenters.value,
  );
  const currentDictionaryLabel = computed(() =>
    dictionarySection.value === "manufacturers" ? "厂商" : dictionarySection.value === "device-types" ? "设备类型" : "数据中心",
  );
  function dictionaryItemUsed(item: DictionaryItem | DataCenter) {
    return (
      (item.assets_count || 0) > 0 ||
      (dictionarySection.value === "manufacturers" && ((item as DictionaryItem).licenses_count || 0) > 0) ||
      (dictionarySection.value === "data-centers" && ((item as DataCenter).rooms_count || 0) > 0)
    );
  }
  function openDictionaryModal(item?: DictionaryItem | DataCenter) {
    editingDictionary.value = item || null;
    dictionaryFormErrors.value = {};
    dictionaryForm.value = item
      ? {
          name: item.name,
          code: "code" in item ? item.code || "" : "",
          address: "address" in item ? item.address || "" : "",
          color: "color" in item ? item.color || "#1677EF" : "#1677EF",
          is_active: item.is_active,
        }
      : { name: "", code: "", address: "", color: "#1677EF", is_active: true };
    showDictionaryModal.value = true;
  }
  function retryDictionaries() {
    return loadDictionaries();
  }
  async function saveDictionary() {
    if (dictionarySaving.value) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      deps.actionMessage.value = "当前账号没有管理该数据字典的权限";
      return;
    }
    dictionarySaving.value = true;
    dictionaryFormErrors.value = {};
    let saved = false;
    try {
      const base = section === "manufacturers" ? "manufacturers" : section === "device-types" ? "device-types" : "data-centers";
      const method = editingDictionary.value ? "PATCH" : "POST";
      const path = editingDictionary.value ? `/${base}/${editingDictionary.value.id}/` : `/${base}/`;
      dictionaryForm.value.name = dictionaryForm.value.name.trim();
      dictionaryForm.value.code = dictionaryForm.value.code.trim();
      dictionaryForm.value.address = dictionaryForm.value.address.trim();
      dictionaryForm.value.color = dictionaryForm.value.color.trim().toUpperCase();
      const payload = section === "device-types"
        ? {
            name: dictionaryForm.value.name,
            color: dictionaryForm.value.color,
            is_active: dictionaryForm.value.is_active,
          }
        : section === "data-centers"
          ? {
              name: dictionaryForm.value.name,
              address: dictionaryForm.value.address,
              is_active: dictionaryForm.value.is_active,
            }
          : section === "manufacturers"
            ? { name: dictionaryForm.value.name, code: dictionaryForm.value.code || null, is_active: dictionaryForm.value.is_active }
            : { name: dictionaryForm.value.name, is_active: dictionaryForm.value.is_active };
      await deps.request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      saved = true;
    } catch (error) {
      dictionaryFormErrors.value = extractFieldErrors(error, ["name", "code", "address", "color"]);
      deps.actionMessage.value = errorMessage(error, `${label}保存失败`);
    } finally {
      dictionarySaving.value = false;
    }
    if (!saved) return;
    showDictionaryModal.value = false;
    deps.actionMessage.value = `${label}已保存`;
    const refreshed = await loadDictionaries();
    if (!refreshed && dictionaryError.value) deps.actionMessage.value = `${label}已保存，但列表刷新失败，请重试`;
  }
  async function toggleDictionary(item: DictionaryItem) {
    if (dictionaryActionId.value === item.id) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      deps.actionMessage.value = "当前账号没有管理该数据字典的权限";
      return;
    }
    dictionaryActionId.value = item.id;
    try {
      const base = section === "manufacturers" ? "manufacturers" : section === "device-types" ? "device-types" : "data-centers";
      await deps.request(`/${base}/${item.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) });
      deps.actionMessage.value = item.is_active ? `${label}已停用` : `${label}已启用`;
      const refreshed = await loadDictionaries();
      if (!refreshed && dictionaryError.value) deps.actionMessage.value = `${label}状态已更新，但列表刷新失败，请重试`;
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, `${label}状态更新失败`);
    } finally {
      dictionaryActionId.value = null;
    }
  }
  async function deleteDictionary(item: DictionaryItem) {
    if (dictionaryItemUsed(item)) {
      deps.actionMessage.value = dictionarySection.value === "data-centers"
        ? "数据中心仍包含机房或资产，不能删除，请先停用"
        : dictionarySection.value === "manufacturers"
          ? "厂商正在被资产或软件许可使用，不能删除，请先停用"
          : "字典项正在被资产使用，请先停用";
      return;
    }
    if (dictionaryActionId.value === item.id) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    if (!canManageDictionary(section)) {
      deps.actionMessage.value = "当前账号没有管理该数据字典的权限";
      return;
    }
    dictionaryActionId.value = item.id;
    try {
      if (!(await deps.confirmAction(`确定删除${label}“${item.name}”吗？`))) return;
      const base = section === "manufacturers" ? "manufacturers" : section === "device-types" ? "device-types" : "data-centers";
      await deps.request(`/${base}/${item.id}/`, { method: "DELETE" });
      deps.actionMessage.value = `${label}已删除`;
      const refreshed = await loadDictionaries();
      if (!refreshed && dictionaryError.value) deps.actionMessage.value = `${label}已删除，但列表刷新失败，请重试`;
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, `${label}删除失败`);
    } finally {
      dictionaryActionId.value = null;
    }
  }
  function formatDateTime(value: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN") : "—";
  }
  function retryOrganization() {
    return loadOrganization();
  }

  function retryUserList() {
    return loadUsers();
  }

  async function changeUserPage(page: number) {
    userPage.value = Math.max(1, page);
    await loadUsers();
  }

  async function changeUserPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    userPageSize.value = size;
    userPage.value = 1;
    await loadUsers();
  }

  async function searchUsers() {
    userPage.value = 1;
    await loadUsers();
  }

  function retryCustomFieldList() {
    return loadCustomFields();
  }

  function retryTagList() {
    return loadTags();
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

  return {
    manufacturers,
    deviceTypes,
    customFields,
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
    userResetFormErrors,
    organizationLoading,
    organizationError,
    userListError,
    roleListError,
    userSaving,
    userPendingId,
    userFormErrors,
    dictionarySection,
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
    loadCustomFields,
    retryCustomFieldList,
    loadCustomFieldOptions,
    retryCustomFieldOptions,
    loadTags,
    retryTagList,
    loadOrganization,
    retryOrganization,
    loadUsers,
    retryUserList,
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
  };
}
