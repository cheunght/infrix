import { ref, watch, type Ref } from "vue";
import { buildExportQuery, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type { DataCenter, ServerRoom, SparePart, SparePartCategory, SparePartFormState, SpareStock, SpareTransaction } from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
import {
  businessOptionLabel,
  STOCK_OPERATION_OPTIONS,
  STOCK_SOURCE_OPERATION_VALUES,
  STOCK_TARGET_OPERATION_VALUES,
  type StockOperationType,
} from "../business-enums";
import { i18n } from "../i18n";
import {
  clearFieldError,
  fieldErrorsToText,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

const SPARE_PART_FORM_FIELDS = [
  "code",
  "name",
  "category",
  "manufacturer",
  "model",
  "specification",
  "unit",
  "initial_quantity",
  "initial_data_center",
  "initial_server_room",
  "safety_stock",
  "storage_location",
  "notes",
] as const;

const SPARE_OPERATION_FORM_FIELDS = [
  "part",
  "quantity",
  "adjustment_quantity",
  "source_data_center",
  "source_server_room",
  "target_data_center",
  "target_server_room",
  "reference",
  "notes",
] as const;

export type SpareOperationLocation = {
  data_center: number;
  server_room: number | null;
  quantity: number;
  label: string;
};

export interface SparePartsDeps {
  request: RequestFn;
  download: (path: string, filename?: string) => Promise<void>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  dataCenters: Ref<DataCenter[]>;
  spareCategories: Ref<SparePartCategory[]>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
  can: CapabilityFn;
}

export function useSpareParts(deps: SparePartsDeps) {
  const spareParts = ref<SparePart[]>([]);
  const sparePartCount = ref(0);
  const sparePage = ref(1);
  const sparePageSize = ref(50);
  const spareRooms = ref<ServerRoom[]>([]);
  const spareSearch = ref("");
  const spareCategory = ref("");
  const spareManufacturer = ref("");
  const spareListDataCenter = ref("");
  const spareListRoom = ref("");
  const sparePartForm = ref<SparePartFormState>({
    code: "", name: "", category: "", manufacturer: "", model: "", specification: "", unit: "piece",
    initial_quantity: 0, initial_data_center: "", initial_server_room: "", current_quantity: 0,
    safety_stock: 0, storage_location: "", notes: "",
  });
  const sparePartFormError = ref("");
  const sparePartFormErrors = ref<Record<string, string>>({});
  const showSparePartModal = ref(false);
  const editingSparePart = ref<SparePart | null>(null);
  const spareSaving = ref(false);
  const deletingSparePartId = ref<number | null>(null);
  const spareListLoading = ref(false);
  const spareListError = ref("");
  const exportingSpares = ref(false);
  const spareListRequestId = ref(0);
  let spareListController: AbortController | null = null;

  const spareOperationType = ref<StockOperationType>("inbound");
  const spareOperationForm = ref({
    part: "", quantity: "1", adjustment_quantity: "", source_data_center: "", source_server_room: "", target_data_center: "", target_server_room: "", reference: "", notes: "",
  });
  const showSpareOperationModal = ref(false);
  const spareOperationSaving = ref(false);
  const spareOperationError = ref("");
  const spareOperationFormErrors = ref<Record<string, string>>({});
  const spareOperationCurrentQuantity = ref<number | null>(null);
  const spareOperationLocationLabel = ref("");
  const spareOperationLocationLocked = ref(false);
  const spareTransactionFilters = ref<{
    part: string;
    operation_type: StockOperationType | "";
    start: string;
    end: string;
  }>({ part: "", operation_type: "", start: "", end: "" });

  const stockLocations = ref<Record<number, SpareStock[]>>({});
  const stockLocationLoadingByPart = ref<Record<number, boolean>>({});
  const stockLocationErrorByPart = ref<Record<number, string>>({});
  const stockLocationTotalsByPart = ref<Record<number, number>>({});
  const stockLocationLoadedByPart = ref<Record<number, boolean>>({});
  const stockLocationRequestIds = new Map<number, number>();
  const stockLocationControllers = new Map<number, AbortController>();
  const transactionRows = ref<SpareTransaction[]>([]);
  const transactionCount = ref(0);
  const transactionPage = ref(1);
  const transactionPageSize = ref(20);
  const transactionLoading = ref(false);
  const transactionError = ref("");
  const transactionRequestId = ref(0);
  const transactionPartId = ref<number | null>(null);
  let transactionController: AbortController | null = null;

  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function safeErrorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }

  function extractFormError(
    error: unknown,
    allowedFields: readonly string[],
    fallback: string,
  ): { fields: Record<string, string>; message: string } {
    const normalized = normalizeApiError(error);
    const fields = fieldErrorsToText(normalized.fieldErrors, allowedFields);
    const hasUnknownField = Object.keys(normalized.fieldErrors).some(
      (field) => !allowedFields.includes(field),
    );
    const message = normalized.kind === "field-validation" && !hasUnknownField
      ? ""
      : normalized.kind === "unknown"
        ? fallback
        : normalized.message;
    return { fields, message };
  }

  function watchFormFieldErrors(
    form: Ref<Record<string, unknown>>,
    errors: Ref<Record<string, string>>,
    fields: readonly string[],
  ) {
    for (const field of fields) {
      watch(
        () => form.value[field],
        () => {
          if (errors.value[field]) errors.value = clearFieldError(errors.value, field);
        },
      );
    }
  }

  watchFormFieldErrors(
    sparePartForm as unknown as Ref<Record<string, unknown>>,
    sparePartFormErrors,
    SPARE_PART_FORM_FIELDS,
  );
  watchFormFieldErrors(
    spareOperationForm,
    spareOperationFormErrors,
    SPARE_OPERATION_FORM_FIELDS,
  );

  function totalPages(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  }

  async function loadAllPages<T>(
    basePath: string,
    signal: AbortSignal,
    shouldContinue: () => boolean,
  ): Promise<{ rows: T[]; total: number } | null> {
    const rows: T[] = [];
    let page = 1;
    let total: number | null = null;
    while (shouldContinue() && !signal.aborted) {
      const separator = basePath.includes("?") ? "&" : "?";
      const result = await deps.request<PageResult<T> | T[]>(
        `${basePath}${separator}page=${page}`,
        { signal },
      );
      if (!shouldContinue() || signal.aborted) return null;
      if (Array.isArray(result)) {
        rows.push(...result);
        return { rows, total: rows.length };
      }
      const pageRows = result.results || [];
      rows.push(...pageRows);
      total = typeof result.count === "number" ? result.count : total;
      const hasMore = result.next !== undefined
        ? Boolean(result.next)
        : total !== null
          ? rows.length < total
          : pageRows.length >= 50;
      if (!pageRows.length || !hasMore) return { rows, total: total ?? rows.length };
      page += 1;
    }
    return null;
  }

  function listParams(includePagination = true) {
    const params = new URLSearchParams();
    if (includePagination) {
      params.set("page", String(sparePage.value));
      params.set("page_size", String(sparePageSize.value));
    }
    if (spareSearch.value.trim()) params.set("search", spareSearch.value.trim());
    if (spareCategory.value) params.set("category", spareCategory.value);
    if (spareManufacturer.value) params.set("manufacturer", spareManufacturer.value);
    if (spareListDataCenter.value) params.set("data_center", spareListDataCenter.value);
    if (spareListRoom.value) params.set("server_room", spareListRoom.value);
    return params;
  }

  async function loadSpareData(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("spares.view")) return false;
    const requestId = ++spareListRequestId.value;
    spareListController?.abort();
    const controller = new AbortController();
    spareListController = controller;
    const requestedPage = sparePage.value;
    spareListLoading.value = true;
    spareListError.value = "";

    try {
      const [partResult, roomResult, categoryResult] = await Promise.all([
        deps.request<PageResult<SparePart> | SparePart[]>(`/spare-parts/?${listParams().toString()}`, { signal: controller.signal }),
        loadAllPages<ServerRoom>(
          "/server-rooms/?page_size=50&is_active=true",
          controller.signal,
          () => requestId === spareListRequestId.value && deps.isCurrentLoad(version),
        ),
        loadAllPages<SparePartCategory>(
          `/spare-part-categories/?page_size=50&is_active=${deps.can("spares.manage") ? "all" : "true"}`,
          controller.signal,
          () => requestId === spareListRequestId.value && deps.isCurrentLoad(version),
        ),
      ]);
      if (partResult == null || roomResult == null || categoryResult == null) return false;
      if (requestId !== spareListRequestId.value || !deps.isCurrentLoad(version)) return false;

      const nextCount = pageTotal(partResult);
      const maxPage = totalPages(nextCount, sparePageSize.value);
      if (requestedPage > maxPage) {
        sparePage.value = maxPage;
        // Re-fetch exactly once with the corrected page. The request id and
        // controller make the stale response unable to mutate the list.
        return await loadSpareData(version);
      }

      spareParts.value = pageItems(partResult);
      sparePartCount.value = nextCount;
      spareRooms.value = roomResult.rows;
      deps.spareCategories.value = categoryResult.rows;
      return true;
    } catch (error) {
      if (requestId === spareListRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        spareListError.value = safeErrorMessage(error, tr("spare.dataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === spareListRequestId.value) {
        spareListLoading.value = false;
        if (spareListController === controller) spareListController = null;
      }
    }
  }

  async function refreshSparePart(partId: number) {
    if (!deps.can("spares.view")) return null;
    try {
      const detail = await deps.request<SparePart>(`/spare-parts/${partId}/`);
      const index = spareParts.value.findIndex((part) => part.id === partId);
      if (index >= 0) spareParts.value.splice(index, 1, detail);
      return detail;
    } catch (error) {
      spareListError.value = safeErrorMessage(error, tr("spare.dataLoadFailed"));
      return null;
    }
  }

  function searchSpareParts() {
    sparePage.value = 1;
    void loadSpareData();
  }

  function resetSpareFilters() {
    spareSearch.value = "";
    spareCategory.value = "";
    spareManufacturer.value = "";
    spareListDataCenter.value = "";
    spareListRoom.value = "";
    sparePage.value = 1;
    void loadSpareData();
  }

  function retrySpareList() { void loadSpareData(); }
  function changeSparePage(page: number) { sparePage.value = Math.max(1, page); void loadSpareData(); }
  function changeSparePageSize(size: number) { sparePageSize.value = size; sparePage.value = 1; void loadSpareData(); }

  async function exportSpareParts() {
    if (!deps.can("spares.export")) return;
    if (exportingSpares.value) return;
    exportingSpares.value = true;
    const query = buildExportQuery(listParams(false));
    try {
      await deps.download(`/reports/spare-parts/export/${query ? `?${query}` : ""}`, "spare-parts.xlsx");
    } catch (error) {
      const normalized = normalizeApiError(error);
      deps.actionMessageType.value = "error";
      deps.actionMessage.value = normalized.kind === "unknown" ? tr("spare.exportFailed") : normalized.message;
    } finally {
      exportingSpares.value = false;
    }
  }

  async function exportSpareTransactions(partId: number) {
    if (!deps.can("spares.export")) return;
    if (exportingSpares.value) return;
    exportingSpares.value = true;
    const params = new URLSearchParams({ part: String(partId) });
    if (spareTransactionFilters.value.operation_type) {
      params.set("operation_type", spareTransactionFilters.value.operation_type);
    }
    if (spareTransactionFilters.value.start) params.set("start", spareTransactionFilters.value.start);
    if (spareTransactionFilters.value.end) params.set("end", spareTransactionFilters.value.end);
    const query = buildExportQuery(params);
    try {
      await deps.download(`/reports/spare-transactions/export/${query ? `?${query}` : ""}`, "spare-transactions.xlsx");
    } catch (error) {
      const normalized = normalizeApiError(error);
      deps.actionMessageType.value = "error";
      deps.actionMessage.value = normalized.kind === "unknown" ? tr("spare.exportFailed") : normalized.message;
    } finally {
      exportingSpares.value = false;
    }
  }

  async function loadStockLocations(partId: number) {
    if (!deps.can("spares.view")) return;
    const serial = (stockLocationRequestIds.get(partId) || 0) + 1;
    stockLocationRequestIds.set(partId, serial);
    stockLocationControllers.get(partId)?.abort();
    const controller = new AbortController();
    stockLocationControllers.set(partId, controller);
    stockLocationLoadingByPart.value = { ...stockLocationLoadingByPart.value, [partId]: true };
    stockLocationErrorByPart.value = { ...stockLocationErrorByPart.value, [partId]: "" };
    try {
      const result = await loadAllPages<SpareStock>(
        `/spare-stocks/?part=${partId}&page_size=50`,
        controller.signal,
        () => stockLocationRequestIds.get(partId) === serial,
      );
      if (result == null || stockLocationRequestIds.get(partId) !== serial) return;
      stockLocations.value = { ...stockLocations.value, [partId]: result.rows };
      stockLocationTotalsByPart.value = { ...stockLocationTotalsByPart.value, [partId]: result.total };
      stockLocationLoadedByPart.value = { ...stockLocationLoadedByPart.value, [partId]: true };
    } catch (error) {
      if (stockLocationRequestIds.get(partId) === serial && !isAbortError(error)) {
        stockLocationErrorByPart.value = { ...stockLocationErrorByPart.value, [partId]: safeErrorMessage(error, tr("spare.stockLocationLoadFailed")) };
      }
    } finally {
      if (stockLocationRequestIds.get(partId) === serial) {
        stockLocationLoadingByPart.value = { ...stockLocationLoadingByPart.value, [partId]: false };
        if (stockLocationControllers.get(partId) === controller) stockLocationControllers.delete(partId);
      }
    }
  }

  async function loadTransactions(partId: number) {
    if (!deps.can("spares.view")) return;
    const requestId = ++transactionRequestId.value;
    transactionController?.abort();
    const controller = new AbortController();
    transactionController = controller;
    if (transactionPartId.value !== partId) {
      transactionRows.value = [];
      transactionCount.value = 0;
    }
    transactionPartId.value = partId;
    transactionLoading.value = true;
    transactionError.value = "";
    try {
      const params = new URLSearchParams({
        part: String(partId),
        page: String(transactionPage.value),
        page_size: String(transactionPageSize.value),
      });
      if (spareTransactionFilters.value.operation_type) params.set("operation_type", spareTransactionFilters.value.operation_type);
      if (spareTransactionFilters.value.start) params.set("start", spareTransactionFilters.value.start);
      if (spareTransactionFilters.value.end) params.set("end", spareTransactionFilters.value.end);
      const result = await deps.request<PageResult<SpareTransaction> | SpareTransaction[]>(
        `/spare-transactions/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (result == null || requestId !== transactionRequestId.value) return;
      const nextCount = pageTotal(result);
      const maxPage = totalPages(nextCount, transactionPageSize.value);
      if (transactionPage.value > maxPage) {
        transactionPage.value = maxPage;
        return await loadTransactions(partId);
      }
      transactionRows.value = pageItems(result);
      transactionCount.value = nextCount;
    } catch (error) {
      if (requestId === transactionRequestId.value && !isAbortError(error)) {
        transactionError.value = safeErrorMessage(error, tr("spare.transactionLoadFailed"));
      }
    } finally {
      if (requestId === transactionRequestId.value) {
        transactionLoading.value = false;
        if (transactionController === controller) transactionController = null;
      }
    }
  }

  function changeTransactionPage(page: number, partId: number) {
    transactionPage.value = Math.max(1, page);
    void loadTransactions(partId);
  }
  function changeTransactionPageSize(size: number, partId: number) {
    transactionPageSize.value = size;
    transactionPage.value = 1;
    void loadTransactions(partId);
  }
  function openSparePartModal(part?: SparePart) {
    if (!deps.can("spares.manage")) return;
    sparePartFormError.value = "";
    sparePartFormErrors.value = {};
    editingSparePart.value = part || null;
    const defaultCategory = deps.spareCategories.value.find((item) => item.is_active)?.id;
    sparePartForm.value = part
      ? {
        code: part.code,
        name: part.name,
        category: String(part.category),
        manufacturer: part.manufacturer ? String(part.manufacturer) : "",
        model: part.model || "",
        specification: part.specification || "",
        unit: part.unit || "piece",
        initial_quantity: 0,
        initial_data_center: "",
        initial_server_room: "",
        current_quantity: part.total_quantity || 0,
        safety_stock: part.safety_stock || 0,
        storage_location: part.storage_location || "",
        notes: part.notes || "",
      }
      : {
        code: "",
        name: "",
        category: defaultCategory ? String(defaultCategory) : "",
        manufacturer: "",
        model: "",
        specification: "",
        unit: "piece",
        initial_quantity: 0,
        initial_data_center: "",
        initial_server_room: "",
        current_quantity: 0,
        safety_stock: 0,
        storage_location: "",
        notes: "",
      };
    showSparePartModal.value = true;
  }

  async function saveSparePart(): Promise<boolean> {
    if (!deps.can("spares.manage")) return false;
    if (spareSaving.value) return false;
    sparePartFormError.value = "";
    sparePartFormErrors.value = {};
    spareSaving.value = true;
    try {
      const path = editingSparePart.value ? `/spare-parts/${editingSparePart.value.id}/` : "/spare-parts/";
      const payload: Record<string, unknown> = {
        code: sparePartForm.value.code.trim(),
        name: sparePartForm.value.name.trim(),
        category: sparePartForm.value.category ? Number(sparePartForm.value.category) : null,
        manufacturer: sparePartForm.value.manufacturer ? Number(sparePartForm.value.manufacturer) : null,
        model: sparePartForm.value.model.trim(),
        specification: sparePartForm.value.specification.trim(),
        unit: sparePartForm.value.unit,
        safety_stock: Number(sparePartForm.value.safety_stock || 0),
        storage_location: sparePartForm.value.storage_location.trim(),
        notes: sparePartForm.value.notes.trim(),
      };
      if (!editingSparePart.value) {
        payload.initial_quantity = Number(sparePartForm.value.initial_quantity || 0);
        payload.initial_data_center = sparePartForm.value.initial_data_center ? Number(sparePartForm.value.initial_data_center) : null;
        payload.initial_server_room = sparePartForm.value.initial_server_room ? Number(sparePartForm.value.initial_server_room) : null;
      }
      await deps.request(path, { method: editingSparePart.value ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch (error) {
      const parsed = extractFormError(error, SPARE_PART_FORM_FIELDS, tr("spare.saveFailed"));
      sparePartFormErrors.value = parsed.fields;
      sparePartFormError.value = parsed.message;
      return false;
    } finally {
      spareSaving.value = false;
    }
    showSparePartModal.value = false;
    editingSparePart.value = null;
    setActionMessage(tr("spare.saved"));
    if (!(await loadSpareData()) && spareListError.value) setActionMessage(tr("spare.savedRefreshFailed"), "error");
    return true;
  }

  async function deleteSparePart(part: SparePart) {
    if (!deps.can("spares.manage")) return;
    if (deletingSparePartId.value !== null) return;
    deletingSparePartId.value = part.id;
    try {
      if (!(await deps.confirmAction(tr("spare.deleteConfirm", { name: part.name })))) return;
      await deps.request(`/spare-parts/${part.id}/`, { method: "DELETE" });
      setActionMessage(tr("spare.deleted"));
      if (!(await loadSpareData()) && spareListError.value) setActionMessage(tr("spare.deletedRefreshFailed"), "error");
    } catch (error) {
      setActionMessage(safeErrorMessage(error, tr("spare.deleteFailed")), "error");
    } finally {
      deletingSparePartId.value = null;
    }
  }

  function openSpareOperation(part: SparePart, operationType: StockOperationType = "inbound", location?: SpareOperationLocation) {
    if (!deps.can("spares.manage")) return;
    spareOperationError.value = "";
    spareOperationFormErrors.value = {};
    spareOperationType.value = operationType;
    let remembered: Partial<SpareOperationLocation> | null = null;
    if (!location) {
      try { remembered = JSON.parse(localStorage.getItem("infrix.spare.last_location") || "null") as Partial<SpareOperationLocation> | null; } catch { remembered = null; }
    }
    const rememberedCenter = remembered?.data_center ? deps.dataCenters.value.find((center) => center.is_active && center.id === Number(remembered?.data_center)) : null;
    const rememberedRoom = rememberedCenter && remembered?.server_room ? spareRooms.value.find((room) => room.is_active && room.id === Number(remembered?.server_room) && room.data_center === rememberedCenter.id) : null;
    const preset = location || (rememberedCenter && (!remembered?.server_room || rememberedRoom) ? { data_center: rememberedCenter.id, server_room: rememberedRoom?.id || null, quantity: 0, label: tr("spare.recentLocation") } : undefined);
    spareOperationForm.value = {
      part: String(part.id), quantity: "1", adjustment_quantity: "",
      source_data_center: preset && STOCK_SOURCE_OPERATION_VALUES.includes(operationType) ? String(preset.data_center) : "",
      source_server_room: preset && STOCK_SOURCE_OPERATION_VALUES.includes(operationType) && preset.server_room ? String(preset.server_room) : "",
      target_data_center: preset && STOCK_TARGET_OPERATION_VALUES.includes(operationType) ? String(preset.data_center) : "",
      target_server_room: preset && STOCK_TARGET_OPERATION_VALUES.includes(operationType) && preset.server_room ? String(preset.server_room) : "",
      reference: "", notes: "",
    };
    spareOperationCurrentQuantity.value = location ? location.quantity : null;
    spareOperationLocationLabel.value = location?.label || "";
    spareOperationLocationLocked.value = Boolean(location);
    showSpareOperationModal.value = true;
  }

  async function saveSpareOperation(): Promise<boolean> {
    if (!deps.can("spares.manage")) return false;
    if (spareOperationSaving.value) return false;
    spareOperationError.value = "";
    spareOperationFormErrors.value = {};
    spareOperationSaving.value = true;
    try {
      const operation = spareOperationType.value;
      const form = spareOperationForm.value;
      const payload: Record<string, unknown> = { part: Number(form.part), operation_type: operation, reference: form.reference, notes: form.notes };
      if (operation === "adjustment") payload.adjustment_quantity = Number(form.adjustment_quantity || 0);
      else payload.quantity = Number(form.quantity || 0);
      if (STOCK_TARGET_OPERATION_VALUES.includes(operation)) { payload.target_data_center = Number(form.target_data_center); payload.target_server_room = form.target_server_room ? Number(form.target_server_room) : null; }
      if (STOCK_SOURCE_OPERATION_VALUES.includes(operation)) { payload.source_data_center = Number(form.source_data_center); payload.source_server_room = form.source_server_room ? Number(form.source_server_room) : null; }
      await deps.request("/spare-transactions/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const locationDataCenter = STOCK_SOURCE_OPERATION_VALUES.includes(operation) ? form.source_data_center : form.target_data_center;
      const locationServerRoom = STOCK_SOURCE_OPERATION_VALUES.includes(operation) ? form.source_server_room : form.target_server_room;
      if (locationDataCenter) localStorage.setItem("infrix.spare.last_location", JSON.stringify({ data_center: Number(locationDataCenter), server_room: locationServerRoom ? Number(locationServerRoom) : null }));
      showSpareOperationModal.value = false;
      setActionMessage(tr("spare.transactionSaved"));
      const refreshed = await loadSpareData();
      if (!refreshed && spareListError.value) setActionMessage(tr("spare.transactionSavedRefreshFailed"), "error");
      return true;
    } catch (error) {
      const parsed = extractFormError(error, SPARE_OPERATION_FORM_FIELDS, tr("spare.operationFailed"));
      spareOperationFormErrors.value = parsed.fields;
      spareOperationError.value = parsed.message;
      return false;
    } finally {
      spareOperationSaving.value = false;
    }
  }

  function spareOperationLabel(operation: string) {
    return businessOptionLabel(STOCK_OPERATION_OPTIONS, operation);
  }

  return {
    spareParts, sparePartCount,
    sparePage, sparePageSize,
    spareRooms, spareSearch, spareCategory, spareManufacturer, spareListDataCenter, spareListRoom,
    spareCategories: deps.spareCategories,
    sparePartForm, showSparePartModal, editingSparePart, spareSaving, deletingSparePartId,
    sparePartFormError, sparePartFormErrors,
    spareListLoading, spareListError, exportingSpares, loadSpareData, refreshSparePart, searchSpareParts, resetSpareFilters, retrySpareList,
    spareOperationType, spareOperationForm, showSpareOperationModal, spareOperationSaving, spareOperationError, spareOperationFormErrors, spareOperationCurrentQuantity,
    spareOperationLocationLabel, spareOperationLocationLocked, spareTransactionFilters,
    stockLocations, stockLocationLoadingByPart, stockLocationErrorByPart, stockLocationTotalsByPart,
    stockLocationLoadedByPart, loadStockLocations, transactionRows, transactionCount, transactionPage, transactionPageSize,
    transactionLoading, transactionError, loadTransactions, changeTransactionPage, changeTransactionPageSize,
    changeSparePage, changeSparePageSize, openSparePartModal, saveSparePart,
    deleteSparePart, openSpareOperation, saveSpareOperation, spareOperationLabel, exportSpareParts, exportSpareTransactions,
  };
}
