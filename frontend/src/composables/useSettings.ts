import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import { type FormInstance, type FormRules } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import type {
  AuditLog,
  CustomField,
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
  settingsSection: Ref<SettingsSection>;
  dataCenters: Ref<DataCenter[]>;
  actionMessage: Ref<string>;
}

type CustomFieldForm = {
  device_type: string;
  key: string;
  name: string;
  field_type: string;
  required: boolean;
  default_value: string;
  sort_order: number;
  is_active: boolean;
};

type CustomFieldOptionForm = {
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export function useSettings(deps: SettingsDeps) {
  const brands = ref<DictionaryItem[]>([]);
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

  const tags = ref<Tag[]>([]);
  const tagSearch = ref("");
  const tagActive = ref("all");
  const tagForm = ref({ name: "", is_active: true });
  const editingTag = ref<Tag | null>(null);
  const showTagModal = ref(false);

  const users = ref<ManagedUser[]>([]);
  const roles = ref<Role[]>([]);
  const showUserModal = ref(false);
  const editingUser = ref<ManagedUser | null>(null);
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
  const roleForm = ref({ name: "" });
  const editingRole = ref<Role | null>(null);
  const showRoleModal = ref(false);

  const dictionarySection = ref<"brands" | "device-types" | "data-centers">("brands");
  const dictionarySearch = ref("");
  const showDictionaryModal = ref(false);
  const editingDictionary = ref<DictionaryItem | null>(null);
  const dictionaryForm = ref({ name: "", color: "#1677EF", is_active: true });

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

  async function loadDictionaries(version = deps.beginLoad()) {
    const params = new URLSearchParams({ page_size: "100", is_active: "all" });
    if (dictionarySearch.value.trim()) params.set("search", dictionarySearch.value.trim());
    const dataCenterParams = new URLSearchParams({ page_size: "100", is_active: "all" });
    const [brandResult, deviceTypeResult, dataCenterResult] = await Promise.all([
      deps.request<PageResult<DictionaryItem> | DictionaryItem[]>(`/brands/?${params.toString()}`),
      deps.request<PageResult<DictionaryItem> | DictionaryItem[]>(`/device-types/?${params.toString()}`),
      deps.request<PageResult<DataCenter> | DataCenter[]>(`/data-centers/?${dataCenterParams.toString()}`),
    ]);
    if (!deps.isCurrentLoad(version)) return;
    brands.value = pageItems(brandResult);
    deviceTypes.value = pageItems(deviceTypeResult);
    deps.dataCenters.value = pageItems(dataCenterResult);
  }

  async function loadCustomFields(version = deps.beginLoad()) {
    const params = new URLSearchParams({ page_size: "100", is_active: customFieldActive.value });
    if (customFieldDeviceType.value) params.set("device_type", customFieldDeviceType.value);
    const result = await deps.request<PageResult<CustomField> | CustomField[]>(`/custom-fields/?${params.toString()}`);
    if (deps.isCurrentLoad(version)) customFields.value = pageItems(result);
  }

  async function loadTags(version = deps.beginLoad()) {
    const params = new URLSearchParams({ page_size: "100", is_active: tagActive.value });
    if (tagSearch.value.trim()) params.set("search", tagSearch.value.trim());
    const result = await deps.request<PageResult<Tag> | Tag[]>(`/tags/?${params.toString()}`);
    if (deps.isCurrentLoad(version)) tags.value = pageItems(result);
  }

  async function loadOrganization(version = deps.beginLoad()) {
    const [userResult, roleResult] = await Promise.all([
      deps.request<PageResult<ManagedUser> | ManagedUser[]>("/users/?page_size=100"),
      deps.request<PageResult<Role> | Role[]>("/roles/?page_size=100"),
    ]);
    if (!deps.isCurrentLoad(version)) return;
    users.value = pageItems(userResult);
    roles.value = pageItems(roleResult);
  }

  async function loadAuditLogs(version = deps.beginLoad()) {
    const params = new URLSearchParams({ page: String(auditPage.value), page_size: String(auditPageSize.value) });
    Object.entries(auditFilters.value).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });
    const result = await deps.request<PageResult<AuditLog> | AuditLog[]>(`/audit-logs/?${params.toString()}`);
    if (!deps.isCurrentLoad(version)) return;
    auditLogs.value = pageItems(result);
    auditCount.value = pageTotal(result);
  }

  function openUserModal(user?: ManagedUser) {
    editingUser.value = user || null;
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

  async function saveUser() {
    const valid = await userFormRef.value?.validate().then(() => true).catch(() => false);
    if (!valid) return;
    try {
      const method = editingUser.value ? "PATCH" : "POST";
      const path = editingUser.value ? `/users/${editingUser.value.id}/` : "/users/";
      await deps.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: userForm.value.username,
          first_name: userForm.value.first_name,
          last_name: userForm.value.last_name,
          email: userForm.value.email,
          is_active: userForm.value.is_active,
          role_code: userForm.value.role_code,
          ...(userForm.value.password ? { password: userForm.value.password } : {}),
        }),
      });
      showUserModal.value = false;
      deps.actionMessage.value = "用户账号已保存";
      await loadOrganization();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "用户保存失败";
    }
  }

  async function toggleUser(user: ManagedUser) {
    try {
      await deps.request(`/users/${user.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      deps.actionMessage.value = user.is_active ? "用户已停用" : "用户已启用";
      await loadOrganization();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "状态更新失败";
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (!(await deps.confirmAction(`确定删除用户“${user.username}”吗？`))) return;
    try {
      await deps.request(`/users/${user.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "用户已删除";
      await loadOrganization();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "用户删除失败";
    }
  }

  function openRoleModal(role?: Role) {
    editingRole.value = role || null;
    roleForm.value = { name: role?.name || "" };
    showRoleModal.value = true;
  }
  async function saveRole() {
    try {
      const method = editingRole.value ? "PATCH" : "POST";
      const path = editingRole.value ? `/roles/${editingRole.value.id}/` : "/roles/";
      await deps.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roleForm.value),
      });
      showRoleModal.value = false;
      deps.actionMessage.value = "角色已保存";
      await loadOrganization();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "角色保存失败";
    }
  }
  async function deleteRole(role: Role) {
    if ((role.user_count || 0) > 0) {
      deps.actionMessage.value = "角色仍被用户使用，不能删除";
      return;
    }
    if (!(await deps.confirmAction(`确定删除角色“${role.name}”吗？`))) return;
    try {
      await deps.request(`/roles/${role.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "角色已删除";
      await loadOrganization();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "角色删除失败";
    }
  }

  function openCustomFieldModal(field?: CustomField) {
    editingCustomField.value = field || null;
    customFieldForm.value = field
      ? {
          device_type: String(field.device_type),
          key: field.key,
          name: field.name,
          field_type: field.field_type,
          required: field.required,
          default_value: field.default_value || "",
          sort_order: field.sort_order || 0,
          is_active: field.is_active,
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
        };
    showCustomFieldModal.value = true;
  }
  async function saveCustomField() {
    try {
      const path = editingCustomField.value ? `/custom-fields/${editingCustomField.value.id}/` : "/custom-fields/";
      await deps.request(path, {
        method: editingCustomField.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...customFieldForm.value,
          device_type: Number(customFieldForm.value.device_type),
          sort_order: Number(customFieldForm.value.sort_order),
        }),
      });
      showCustomFieldModal.value = false;
      deps.actionMessage.value = "自定义字段已保存";
      await loadCustomFields();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "自定义字段保存失败";
    }
  }
  async function toggleCustomField(field: CustomField) {
    try {
      await deps.request(`/custom-fields/${field.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !field.is_active }),
      });
      deps.actionMessage.value = field.is_active ? "自定义字段已停用" : "自定义字段已启用";
      await loadCustomFields();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "状态更新失败";
    }
  }
  async function deleteCustomField(field: CustomField) {
    if ((field.assets_count || 0) > 0) {
      deps.actionMessage.value = "字段已有资产值，不能删除，请先停用";
      return;
    }
    if (!(await deps.confirmAction(`确定删除字段“${field.name}”吗？`))) return;
    try {
      await deps.request(`/custom-fields/${field.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "自定义字段已删除";
      await loadCustomFields();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "自定义字段删除失败";
    }
  }
  function openCustomFieldOptionModal(field?: CustomField | null, option?: CustomFieldOption) {
    editingCustomField.value = field || null;
    editingCustomFieldOption.value = option || null;
    customFieldOptionForm.value = option
      ? { value: option.value, label: option.label, sort_order: option.sort_order, is_active: option.is_active }
      : { value: "", label: "", sort_order: 0, is_active: true };
    showCustomFieldOptionModal.value = true;
  }
  async function saveCustomFieldOption() {
    if (!editingCustomField.value) return;
    try {
      const path = editingCustomFieldOption.value
        ? `/custom-field-options/${editingCustomFieldOption.value.id}/`
        : "/custom-field-options/";
      await deps.request(path, {
        method: editingCustomFieldOption.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customFieldOptionForm.value, field: editingCustomField.value.id }),
      });
      showCustomFieldOptionModal.value = false;
      deps.actionMessage.value = "字段选项已保存";
      await loadCustomFields();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "字段选项保存失败";
    }
  }
  async function deleteCustomFieldOption(option: CustomFieldOption) {
    if (!(await deps.confirmAction(`确定删除选项“${option.label}”吗？`))) return;
    try {
      await deps.request(`/custom-field-options/${option.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "字段选项已删除";
      await loadCustomFields();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "字段选项删除失败";
    }
  }

  function openTagModal(tag?: Tag) {
    editingTag.value = tag || null;
    tagForm.value = tag ? { name: tag.name, is_active: tag.is_active } : { name: "", is_active: true };
    showTagModal.value = true;
  }
  async function saveTag() {
    try {
      const path = editingTag.value ? `/tags/${editingTag.value.id}/` : "/tags/";
      await deps.request(path, {
        method: editingTag.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tagForm.value),
      });
      showTagModal.value = false;
      deps.actionMessage.value = "标签已保存";
      await loadTags();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "标签保存失败";
    }
  }
  async function toggleTag(tag: Tag) {
    try {
      await deps.request(`/tags/${tag.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !tag.is_active }),
      });
      deps.actionMessage.value = tag.is_active ? "标签已停用" : "标签已启用";
      await loadTags();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "状态更新失败";
    }
  }
  async function deleteTag(tag: Tag) {
    if ((tag.assets_count || 0) > 0) {
      deps.actionMessage.value = "标签正在被资产使用，不能删除，请先停用";
      return;
    }
    if (!(await deps.confirmAction(`确定删除标签“${tag.name}”吗？`))) return;
    try {
      await deps.request(`/tags/${tag.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "标签已删除";
      await loadTags();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "标签删除失败";
    }
  }

  const currentDictionaryItems = computed<Array<DictionaryItem | DataCenter>>(() =>
    dictionarySection.value === "brands"
      ? brands.value
      : dictionarySection.value === "device-types"
        ? deviceTypes.value
        : deps.dataCenters.value,
  );
  const currentDictionaryLabel = computed(() =>
    dictionarySection.value === "brands" ? "品牌" : dictionarySection.value === "device-types" ? "设备类型" : "数据中心",
  );
  function dictionaryItemUsed(item: DictionaryItem | DataCenter) {
    return (
      (item.assets_count || 0) > 0 ||
      (dictionarySection.value === "data-centers" && ((item as DataCenter).rooms_count || 0) > 0)
    );
  }
  function openDictionaryModal(item?: DictionaryItem) {
    editingDictionary.value = item || null;
    dictionaryForm.value = item
      ? { name: item.name, color: item.color || "#1677EF", is_active: item.is_active }
      : { name: "", color: "#1677EF", is_active: true };
    showDictionaryModal.value = true;
  }
  async function saveDictionary() {
    try {
      const base = dictionarySection.value === "brands" ? "brands" : dictionarySection.value === "device-types" ? "device-types" : "data-centers";
      const method = editingDictionary.value ? "PATCH" : "POST";
      const path = editingDictionary.value ? `/${base}/${editingDictionary.value.id}/` : `/${base}/`;
      const payload = dictionarySection.value === "device-types"
        ? dictionaryForm.value
        : { name: dictionaryForm.value.name, is_active: dictionaryForm.value.is_active };
      await deps.request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      showDictionaryModal.value = false;
      deps.actionMessage.value = `${currentDictionaryLabel.value}已保存`;
      await loadDictionaries();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : `${currentDictionaryLabel.value}保存失败`;
    }
  }
  async function toggleDictionary(item: DictionaryItem) {
    try {
      const base = dictionarySection.value === "brands" ? "brands" : dictionarySection.value === "device-types" ? "device-types" : "data-centers";
      await deps.request(`/${base}/${item.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) });
      deps.actionMessage.value = item.is_active ? `${currentDictionaryLabel.value}已停用` : `${currentDictionaryLabel.value}已启用`;
      await loadDictionaries();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "状态更新失败";
    }
  }
  async function deleteDictionary(item: DictionaryItem) {
    if (dictionaryItemUsed(item)) {
      deps.actionMessage.value = dictionarySection.value === "data-centers" ? "数据中心仍包含机房或资产，不能删除，请先停用" : "字典项正在被资产使用，请先停用";
      return;
    }
    if (!(await deps.confirmAction(`确定删除${currentDictionaryLabel.value}“${item.name}”吗？`))) return;
    try {
      const base = dictionarySection.value === "brands" ? "brands" : dictionarySection.value === "device-types" ? "device-types" : "data-centers";
      await deps.request(`/${base}/${item.id}/`, { method: "DELETE" });
      deps.actionMessage.value = `${currentDictionaryLabel.value}已删除`;
      await loadDictionaries();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : `${currentDictionaryLabel.value}删除失败`;
    }
  }
  function formatDateTime(value: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN") : "—";
  }
  function changeAuditPage(page: number) {
    auditPage.value = page;
    void loadAuditLogs();
  }
  function changeAuditPageSize(size: number) {
    auditPageSize.value = size;
    auditPage.value = 1;
    void loadAuditLogs();
  }
  function searchAuditLogs() {
    auditPage.value = 1;
    void loadAuditLogs();
  }

  return {
    brands,
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
    tags,
    tagSearch,
    tagActive,
    tagForm,
    editingTag,
    showTagModal,
    users,
    roles,
    showUserModal,
    editingUser,
    userForm,
    userFormRef,
    userFormRules,
    roleForm,
    editingRole,
    showRoleModal,
    dictionarySection,
    dictionarySearch,
    showDictionaryModal,
    editingDictionary,
    dictionaryForm,
    auditLogs,
    auditCount,
    auditPage,
    auditPageSize,
    auditFilters,
    loadDictionaries,
    loadCustomFields,
    loadTags,
    loadOrganization,
    loadAuditLogs,
    openUserModal,
    saveUser,
    toggleUser,
    deleteUser,
    openRoleModal,
    saveRole,
    deleteRole,
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
    saveDictionary,
    toggleDictionary,
    deleteDictionary,
    formatDateTime,
    changeAuditPage,
    changeAuditPageSize,
    searchAuditLogs,
  };
}
