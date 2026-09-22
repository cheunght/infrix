import { computed, getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import {
  clearFieldError,
  fieldErrorsToText,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";
import { i18n } from "../i18n";
import type { CapabilityFn, RequestFn } from "../page-context";
import type { DictionaryItem, SparePartCategory } from "../types";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

export type DataDictionarySection = "manufacturers" | "spare-categories";
export type DataDictionaryRow = DictionaryItem | SparePartCategory;

export interface DataDictionaryDependencies {
  request: RequestFn;
  confirmAction: (message: string) => Promise<boolean>;
  can: CapabilityFn;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
}

type PagePayload = PageResult<DataDictionaryRow> | DataDictionaryRow[];

function extractFieldErrors(error: unknown): Record<string, string> {
  return fieldErrorsToText(normalizeApiError(error).fieldErrors, ["name", "code"]);
}

export function useDataDictionary(deps: DataDictionaryDependencies) {
  const dictionarySection = ref<DataDictionarySection>("manufacturers");
  const dictionaryPage = ref(1);
  const dictionaryPageSize = ref(50);
  const dictionarySearch = ref("");
  const dictionaryRows = ref<DataDictionaryRow[]>([]);
  const dictionaryTotal = ref(0);
  const dictionaryLoading = ref(false);
  const dictionaryError = ref("");
  const dictionarySaving = ref(false);
  const dictionaryActionId = ref<number | null>(null);
  const dictionaryFormErrors = ref<Record<string, string>>({});
  const showDictionaryModal = ref(false);
  const editingDictionary = ref<DataDictionaryRow | null>(null);
  const dictionaryForm = ref({ name: "", code: "", is_active: true });
  const dictionaryRequestId = ref(0);
  let dictionaryController: AbortController | null = null;

  const currentDictionaryItems = computed(() => dictionaryRows.value);
  const dictionaryCount = computed(() => dictionaryTotal.value);
  const currentDictionaryLabel = computed(() =>
    dictionarySection.value === "manufacturers"
      ? tr("settings.manufacturers")
      : tr("settings.spareCategories"),
  );

  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function errorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }

  function setActionError(error: unknown, fallback: string) {
    setActionMessage(errorMessage(error, fallback), "error");
  }

  function canView(section = dictionarySection.value) {
    if (section === "manufacturers") {
      return [
        "settings.view", "settings.manage", "assets.view", "assets.manage",
        "licenses.view", "licenses.manage", "spares.view", "spares.manage",
      ].some((capability) => deps.can(capability));
    }
    return deps.can("spares.view") || deps.can("spares.manage") || deps.can("settings.manage");
  }

  function canManage(section = dictionarySection.value) {
    return section === dictionarySection.value && deps.can("settings.manage");
  }

  function dictionaryPath(section = dictionarySection.value) {
    return section === "manufacturers" ? "manufacturers" : "spare-part-categories";
  }

  function totalPages(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / pageSize));
  }

  function watchFieldErrors() {
    for (const field of ["name", "code"] as const) {
      watch(
        () => dictionaryForm.value[field],
        () => {
          if (dictionaryFormErrors.value[field]) {
            dictionaryFormErrors.value = clearFieldError(dictionaryFormErrors.value, field);
          }
        },
      );
    }
  }

  watchFieldErrors();

  async function loadDictionaries(allowPageClamp = true): Promise<boolean> {
    if (!canView()) {
      dictionaryRows.value = [];
      dictionaryTotal.value = 0;
      return false;
    }
    const requestId = ++dictionaryRequestId.value;
    dictionaryController?.abort();
    const controller = new AbortController();
    dictionaryController = controller;
    const params = new URLSearchParams({
      page: String(dictionaryPage.value),
      page_size: String(dictionaryPageSize.value),
      is_active: "all",
    });
    if (dictionarySearch.value.trim()) params.set("search", dictionarySearch.value.trim());
    dictionaryLoading.value = true;
    dictionaryError.value = "";
    try {
      const result = await deps.request<PagePayload>(
        `/${dictionaryPath()}/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (requestId !== dictionaryRequestId.value || controller.signal.aborted) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, dictionaryPageSize.value);
      if (dictionaryPage.value > maxPage && allowPageClamp) {
        dictionaryPage.value = maxPage;
        return await loadDictionaries(false);
      }
      dictionaryRows.value = pageItems(result);
      dictionaryTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId !== dictionaryRequestId.value || isAbortError(error)) return false;
      dictionaryError.value = errorMessage(error, tr("settings.dictionaryDataLoadFailed"));
      return false;
    } finally {
      if (requestId === dictionaryRequestId.value) {
        dictionaryLoading.value = false;
        if (dictionaryController === controller) dictionaryController = null;
      }
    }
  }

  function retryDictionaries() {
    return loadDictionaries();
  }

  async function changeDictionarySection(value: string) {
    if (value !== "manufacturers" && value !== "spare-categories") return;
    dictionarySection.value = value;
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

  function dictionaryItemUsed(item: DataDictionaryRow) {
    return dictionarySection.value === "manufacturers"
      ? Boolean(
          (item.assets_count || 0) > 0
          || (item as DictionaryItem).licenses_count
          || (item as DictionaryItem).spare_parts_count,
        )
      : (item as SparePartCategory).spare_parts_count > 0;
  }

  function openDictionaryModal(item?: DataDictionaryRow) {
    if (!canManage()) return;
    editingDictionary.value = item || null;
    dictionaryFormErrors.value = {};
    dictionaryForm.value = item
      ? {
          name: item.name,
          code: item.code || "",
          is_active: item.is_active,
        }
      : { name: "", code: "", is_active: true };
    showDictionaryModal.value = true;
  }

  function closeDictionaryModal() {
    if (!dictionarySaving.value) showDictionaryModal.value = false;
  }

  async function saveDictionary() {
    if (dictionarySaving.value || !canManage()) return;
    const section = dictionarySection.value;
    const label = currentDictionaryLabel.value;
    dictionarySaving.value = true;
    dictionaryFormErrors.value = {};
    const base = dictionaryPath(section);
    const method = editingDictionary.value ? "PATCH" : "POST";
    const path = editingDictionary.value ? `/${base}/${editingDictionary.value.id}/` : `/${base}/`;
    const payload = {
      name: dictionaryForm.value.name.trim(),
      code: section === "manufacturers"
        ? dictionaryForm.value.code.trim() || null
        : dictionaryForm.value.code.trim(),
      is_active: dictionaryForm.value.is_active,
    };
    try {
      await deps.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showDictionaryModal.value = false;
      setActionMessage(tr("settings.dictionarySaved", { item: label }));
      await loadDictionaries();
    } catch (error) {
      dictionaryFormErrors.value = extractFieldErrors(error);
      setActionError(error, tr("settings.dictionarySaveFailed", { item: label }));
    } finally {
      dictionarySaving.value = false;
    }
  }

  async function toggleDictionary(item: DataDictionaryRow) {
    if (dictionaryActionId.value === item.id || !canManage()) return;
    const label = currentDictionaryLabel.value;
    dictionaryActionId.value = item.id;
    try {
      await deps.request(`/${dictionaryPath()}/${item.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      setActionMessage(item.is_active
        ? tr("settings.dictionaryDisabled", { item: label })
        : tr("settings.dictionaryEnabled", { item: label }));
      await loadDictionaries();
    } catch (error) {
      setActionError(error, tr("settings.dictionaryStatusFailed", { item: label }));
    } finally {
      dictionaryActionId.value = null;
    }
  }

  async function deleteDictionary(item: DataDictionaryRow) {
    if (!canManage() || dictionaryActionId.value === item.id) return;
    const label = currentDictionaryLabel.value;
    if (dictionaryItemUsed(item)) {
      setActionMessage(
        sectionIsManufacturer() ? tr("settings.manufacturerInUse") : tr("settings.spareCategoryInUse"),
        "error",
      );
      return;
    }
    if (!(await deps.confirmAction(tr("settings.dictionaryDeleteConfirm", { item: label, name: item.name })))) return;
    dictionaryActionId.value = item.id;
    try {
      await deps.request(`/${dictionaryPath()}/${item.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.dictionaryDeleted", { item: label }));
      await loadDictionaries();
    } catch (error) {
      setActionError(error, tr("settings.dictionaryDeleteFailed", { item: label }));
    } finally {
      dictionaryActionId.value = null;
    }
  }

  function sectionIsManufacturer() {
    return dictionarySection.value === "manufacturers";
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      dictionaryRequestId.value += 1;
      dictionaryController?.abort();
    });
  }

  return {
    dictionarySection,
    dictionaryPage,
    dictionaryPageSize,
    dictionarySearch,
    dictionaryCount,
    dictionaryLoading,
    dictionaryError,
    dictionarySaving,
    dictionaryActionId,
    dictionaryFormErrors,
    showDictionaryModal,
    editingDictionary,
    dictionaryForm,
    currentDictionaryItems,
    currentDictionaryLabel,
    canView,
    canManage,
    loadDictionaries,
    retryDictionaries,
    changeDictionarySection,
    searchDictionaries,
    changeDictionaryPage,
    changeDictionaryPageSize,
    dictionaryItemUsed,
    openDictionaryModal,
    closeDictionaryModal,
    saveDictionary,
    toggleDictionary,
    deleteDictionary,
  };
}

export type DataDictionaryController = ReturnType<typeof useDataDictionary>;
