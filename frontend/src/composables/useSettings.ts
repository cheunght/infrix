import { computed, ref, watch, type Ref } from "vue";
import { isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import {
  clearFieldError,
  fieldErrorsToText,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";
import type {
  AuditLog,
  CustomField,
  CustomFieldForm,
  CustomFieldOption,
  DictionaryItem,
  SparePartCategory,
  Tag,
} from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
import { systemSettingsState } from "../system-settings";
import { i18n } from "../i18n";
import { formatSystemDateTime } from "../system-settings";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

export interface SettingsDeps {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  can: CapabilityFn;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
  customFieldSchemaVersion: Ref<number>;
}

type CustomFieldOptionForm = {
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

type FormErrors = Record<string, string>;

function extractFieldErrors(error: unknown, allowedFields: readonly string[]): FormErrors {
  return fieldErrorsToText(normalizeApiError(error).fieldErrors, allowedFields);
}

export function useSettings(deps: SettingsDeps) {
  // Read-only reference options used by business forms. Dictionary CRUD state
  // lives in useDataDictionary, while device-type CRUD stays in asset config.
  const manufacturers = ref<DictionaryItem[]>([]);
  const deviceTypes = ref<DictionaryItem[]>([]);
  const spareCategories = ref<SparePartCategory[]>([]);
  const customFields = ref<CustomField[]>([]);
  const customFieldTotal = ref(0);
  const customFieldPage = ref(1);
  const customFieldPageSize = ref(50);
  const customFieldActive = ref("");
  const customFieldSearch = ref("");
  const customFieldType = ref("");
  const customFieldForm = ref<CustomFieldForm>({
    key: "",
    name: "",
    field_type: "text",
    default_value: "",
    is_active: true,
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

  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function markCustomFieldSchemaChanged() {
    deps.customFieldSchemaVersion.value += 1;
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
    "key", "name", "field_type", "default_value",
    "help_text", "placeholder", "form_visible", "detail_visible", "list_visible", "filterable",
    "validation_config",
  ]);
  watchFormFieldErrors(customFieldOptionForm, customFieldOptionFormErrors, ["value", "label", "sort_order"]);
  watchFormFieldErrors(tagForm, tagFormErrors, ["name"]);

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


  async function loadCustomFields(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("custom_fields.view")) return false;
    const requestId = ++customFieldRequestId.value;
    const params = new URLSearchParams({
      page: String(customFieldPage.value),
      page_size: String(customFieldPageSize.value),
      is_active: customFieldActive.value || "all",
    });
    if (customFieldSearch.value.trim()) params.set("search", customFieldSearch.value.trim());
    if (customFieldType.value) params.set("field_type", customFieldType.value);
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
      const result = await deps.request<PageResult<Tag> | Tag[]>(`/tags/?${params.toString()}`, { signal: controller.signal });
      if (result == null || requestId !== tagRequestId.value || !deps.isCurrentLoad(version) || controller.signal.aborted) return false;
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

  function openCustomFieldModal(field?: CustomField) {
    if (!deps.can("custom_fields.manage")) return;
    editingCustomField.value = field || null;
    customFieldFormErrors.value = {};
    customFieldForm.value = field
      ? {
          key: field.key,
          name: field.name,
          field_type: field.field_type,
          default_value: field.default_value || "",
          is_active: field.is_active,
          help_text: field.help_text || "",
          placeholder: field.placeholder || "",
          form_visible: field.form_visible !== false,
          detail_visible: field.detail_visible !== false,
          list_visible: field.list_visible === true,
          filterable: field.filterable === true,
          validation_config: { ...(field.validation_config || {}) },
        }
      : {
          key: "",
          name: "",
          field_type: "text",
          default_value: "",
          is_active: true,
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
      text: ["format", "pattern", "min_length", "max_length"],
      textarea: ["format", "pattern", "min_length", "max_length"],
      number: [],
      date: [],
      multiselect: ["min_items", "max_items"],
      select: [],
      boolean: [],
    };
    const keys = keysByType[customFieldForm.value.field_type] || [];
    const normalized = Object.fromEntries(
      keys
        .filter((key) => config[key as keyof typeof config] !== undefined && config[key as keyof typeof config] !== null && config[key as keyof typeof config] !== "")
        .map((key) => [key, config[key as keyof typeof config]]),
    );
    if (normalized.format === "any") delete normalized.format;
    if (normalized.format !== "regex") delete normalized.pattern;
    return normalized;
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
      customFieldForm.value.help_text = customFieldForm.value.help_text.trim();
      customFieldForm.value.placeholder = customFieldForm.value.placeholder.trim();
      await deps.request(path, {
        method: editingCustomField.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...customFieldForm.value,
          validation_config: normalizedCustomFieldValidationConfig(),
        }),
      });
      saved = true;
      markCustomFieldSchemaChanged();
    } catch (error) {
      customFieldFormErrors.value = extractFieldErrors(error, [
        "key",
        "name",
        "field_type",
        "default_value",
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
      markCustomFieldSchemaChanged();
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
      markCustomFieldSchemaChanged();
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
      markCustomFieldSchemaChanged();
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
    setActionMessage(tr("customField.optionSaved"));
    editingCustomFieldOption.value = null;
    customFieldOptionFormErrors.value = {};
    customFieldOptionForm.value = { value: "", label: "", sort_order: 0, is_active: true };
    const optionField = editingCustomField.value;
    const optionRefreshed = await loadCustomFieldOptions(optionField);
    const refreshed = await loadCustomFields();
    if (!optionRefreshed && customFieldOptionError.value) setActionMessage(tr("customField.optionSavedRefreshFailed"), "error");
    if (!refreshed && customFieldListError.value) setActionMessage(tr("customField.optionSavedRefreshFailed"), "error");
  }
  async function deleteCustomFieldOption(option: CustomFieldOption) {
    if (!deps.can("custom_fields.manage")) return;
    if (customFieldOptionActionId.value === option.id) return;
    customFieldOptionActionId.value = option.id;
    try {
      if (!(await deps.confirmAction(tr("customField.optionDeleteConfirm", { name: option.label })))) return;
      await deps.request(`/custom-field-options/${option.id}/`, { method: "DELETE" });
      markCustomFieldSchemaChanged();
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

  const customFieldTableItems = computed(() => customFields.value);
  const customFieldCount = computed(() => customFieldTotal.value);
  const tagTableItems = computed(() => tagRows.value);
  const tagCount = computed(() => tagTotal.value);
  function formatDateTime(value: string | null) {
    return value ? formatSystemDateTime(value) || tr("common.notAvailable") : tr("common.notAvailable");
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

  return {
    manufacturers,
    deviceTypes,
    spareCategories,
    customFields,
    customFieldTableItems,
    customFieldCount,
    customFieldPage,
    customFieldPageSize,
    customFieldActive,
    customFieldSearch,
    customFieldType,
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
    auditLogs,
    auditCount,
    auditPage,
    auditPageSize,
    auditFilters,
    auditListLoading,
    auditListError,
    loadAuditLogs,
    retryAuditLogs,
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
    formatDateTime,
    changeAuditPage,
    changeAuditPageSize,
    searchAuditLogs,
  };
}
