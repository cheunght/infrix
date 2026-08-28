import { ref, type Ref } from "vue";
import { buildExportQuery, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type { DataCenter, ServerRoom, SparePart, SparePartCategory, SparePartFormState, SpareStock, SpareTransaction } from "../types";
import type { CapabilityFn, RequestFn } from "../types/page-context";
import {
  businessOptionLabel,
  STOCK_OPERATION_OPTIONS,
  STOCK_SOURCE_OPERATION_VALUES,
  STOCK_TARGET_OPERATION_VALUES,
  type StockOperationType,
} from "../business-enums";

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
  can: CapabilityFn;
}

export function useSpareParts(deps: SparePartsDeps) {
  const spareParts = ref<SparePart[]>([]);
  const spareStocks = ref<SpareStock[]>([]);
  const spareTransactions = ref<SpareTransaction[]>([]);
  const sparePartCount = ref(0);
  const spareStockCount = ref(0);
  const spareTransactionCount = ref(0);
  const sparePage = ref(1);
  const sparePageSize = ref(50);
  const spareStockPage = ref(1);
  const spareStockPageSize = ref(50);
  const spareTransactionPage = ref(1);
  const spareTransactionPageSize = ref(50);
  const spareRooms = ref<ServerRoom[]>([]);
  const spareSearch = ref("");
  const spareCategory = ref("");
  const spareManufacturer = ref("");
  const spareListDataCenter = ref("");
  const spareListRoom = ref("");
  const spareDataCenter = ref("");
  const spareRoom = ref("");
  const spareSelectedPart = ref<SparePart | null>(null);
  const sparePartForm = ref<SparePartFormState>({
    code: "", name: "", category: "", manufacturer: "", model: "", specification: "", unit: "piece",
    initial_quantity: 0, initial_data_center: "", initial_server_room: "", current_quantity: 0,
    safety_stock: 0, storage_location: "", notes: "",
  });
  const showSparePartModal = ref(false);
  const editingSparePart = ref<SparePart | null>(null);
  const spareSaving = ref(false);
  const deletingSparePartId = ref<number | null>(null);
  const spareListLoading = ref(false);
  const spareListError = ref("");
  const exportingSpares = ref(false);
  const spareListRequestId = ref(0);
  let spareListController: AbortController | null = null;
  const selectedDataRequestId = ref(0);
  let selectedDataController: AbortController | null = null;

  const spareOperationType = ref<StockOperationType>("inbound");
  const spareOperationForm = ref({
    part: "", quantity: "1", adjustment_quantity: "", source_data_center: "", source_server_room: "", target_data_center: "", target_server_room: "", reference: "", notes: "",
  });
  const showSpareOperationModal = ref(false);
  const spareOperationSaving = ref(false);
  const spareOperationError = ref("");
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
  // Keep the old name in the public context for pages that have not migrated
  // yet; both refs point at the same per-part state.
  const stockLoading = stockLocationLoadingByPart;

  const transactionRows = ref<SpareTransaction[]>([]);
  const transactionCount = ref(0);
  const transactionPage = ref(1);
  const transactionPageSize = ref(20);
  const transactionLoading = ref(false);
  const transactionError = ref("");
  const transactionRequestId = ref(0);
  const transactionPartId = ref<number | null>(null);
  let transactionController: AbortController | null = null;

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function totalPages(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
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
        deps.request<PageResult<ServerRoom> | ServerRoom[]>("/server-rooms/?page_size=100&is_active=true", { signal: controller.signal }),
        deps.request<PageResult<SparePartCategory> | SparePartCategory[]>(`/spare-part-categories/?page_size=100&is_active=${deps.can("spares.manage") ? "all" : "true"}`, { signal: controller.signal }),
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
      spareRooms.value = pageItems(roomResult);
      deps.spareCategories.value = pageItems(categoryResult);
      if (spareSelectedPart.value) {
        const current = spareParts.value.find((part) => part.id === spareSelectedPart.value?.id);
        if (current) spareSelectedPart.value = current;
        void loadSelectedPartData(spareSelectedPart.value.id);
      }
      return true;
    } catch (error) {
      if (requestId === spareListRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        spareListError.value = errorMessage(error, "备件数据加载失败");
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
    const detail = await deps.request<SparePart>(`/spare-parts/${partId}/`);
    const index = spareParts.value.findIndex((part) => part.id === partId);
    if (index >= 0) spareParts.value.splice(index, 1, detail);
    if (spareSelectedPart.value?.id === partId) spareSelectedPart.value = detail;
    return detail;
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
    if (exportingSpares.value) return;
    exportingSpares.value = true;
    const query = buildExportQuery(listParams(false));
    try {
      await deps.download(`/reports/spare-parts/export/${query ? `?${query}` : ""}`, "备件管理.xlsx");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "导出失败，请稍后重试");
    } finally {
      exportingSpares.value = false;
    }
  }

  async function exportSpareTransactions(partId: number) {
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
      await deps.download(`/reports/spare-transactions/export/${query ? `?${query}` : ""}`, "备件流水.xlsx");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "导出失败，请稍后重试");
    } finally {
      exportingSpares.value = false;
    }
  }

  function selectSparePart(part: SparePart | null, resetFilters = true) {
    spareSelectedPart.value = part;
    if (!part) selectedDataController?.abort();
    if (resetFilters) {
      spareStockPage.value = 1;
      spareTransactionPage.value = 1;
    }
    spareStocks.value = [];
    spareTransactions.value = [];
    spareStockCount.value = 0;
    spareTransactionCount.value = 0;
    if (part) void loadSelectedPartData(part.id);
  }

  async function loadSelectedPartData(partId: number) {
    const requestId = ++selectedDataRequestId.value;
    selectedDataController?.abort();
    const controller = new AbortController();
    selectedDataController = controller;
    const stockParams = new URLSearchParams({ part: String(partId), page: String(spareStockPage.value), page_size: String(spareStockPageSize.value) });
    const transactionParams = new URLSearchParams({ part: String(partId), page: String(spareTransactionPage.value), page_size: String(spareTransactionPageSize.value) });
    if (spareDataCenter.value) stockParams.set("data_center", spareDataCenter.value);
    if (spareRoom.value) stockParams.set("server_room", spareRoom.value);
    if (spareTransactionFilters.value.operation_type) transactionParams.set("operation_type", spareTransactionFilters.value.operation_type);
    if (spareTransactionFilters.value.start) transactionParams.set("start", spareTransactionFilters.value.start);
    if (spareTransactionFilters.value.end) transactionParams.set("end", spareTransactionFilters.value.end);
    try {
      const [stockResult, transactionResult] = await Promise.all([
        deps.request<PageResult<SpareStock> | SpareStock[]>(`/spare-stocks/?${stockParams.toString()}`, { signal: controller.signal }),
        deps.request<PageResult<SpareTransaction> | SpareTransaction[]>(`/spare-transactions/?${transactionParams.toString()}`, { signal: controller.signal }),
      ]);
      if (stockResult == null || transactionResult == null || requestId !== selectedDataRequestId.value || spareSelectedPart.value?.id !== partId) return;
      spareStocks.value = pageItems(stockResult);
      spareStockCount.value = pageTotal(stockResult);
      spareTransactions.value = pageItems(transactionResult);
      spareTransactionCount.value = pageTotal(transactionResult);
    } catch {
      // This legacy selected-part context is not rendered by the current page;
      // its independent requests must never create an unhandled rejection.
    } finally {
      if (requestId === selectedDataRequestId.value && selectedDataController === controller) selectedDataController = null;
    }
  }

  async function loadStockLocations(partId: number) {
    const serial = (stockLocationRequestIds.get(partId) || 0) + 1;
    stockLocationRequestIds.set(partId, serial);
    stockLocationControllers.get(partId)?.abort();
    const controller = new AbortController();
    stockLocationControllers.set(partId, controller);
    stockLocationLoadingByPart.value = { ...stockLocationLoadingByPart.value, [partId]: true };
    stockLocationErrorByPart.value = { ...stockLocationErrorByPart.value, [partId]: "" };
    try {
      const result = await deps.request<PageResult<SpareStock> | SpareStock[]>(
        `/spare-stocks/?part=${partId}&page_size=100`,
        { signal: controller.signal },
      );
      if (result == null || stockLocationRequestIds.get(partId) !== serial) return;
      const items = pageItems(result);
      stockLocations.value = { ...stockLocations.value, [partId]: items };
      stockLocationTotalsByPart.value = { ...stockLocationTotalsByPart.value, [partId]: pageTotal(result) };
      stockLocationLoadedByPart.value = { ...stockLocationLoadedByPart.value, [partId]: true };
    } catch (error) {
      if (stockLocationRequestIds.get(partId) === serial && !isAbortError(error)) {
        stockLocationErrorByPart.value = { ...stockLocationErrorByPart.value, [partId]: errorMessage(error, "库存地点加载失败") };
      }
    } finally {
      if (stockLocationRequestIds.get(partId) === serial) {
        stockLocationLoadingByPart.value = { ...stockLocationLoadingByPart.value, [partId]: false };
        if (stockLocationControllers.get(partId) === controller) stockLocationControllers.delete(partId);
      }
    }
  }

  async function loadTransactions(partId: number) {
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
        transactionError.value = errorMessage(error, "库存流水加载失败");
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
  function changeSpareStockPage(page: number) { spareStockPage.value = Math.max(1, page); if (spareSelectedPart.value) void loadSelectedPartData(spareSelectedPart.value.id); }
  function changeSpareStockPageSize(size: number) { spareStockPageSize.value = size; spareStockPage.value = 1; if (spareSelectedPart.value) void loadSelectedPartData(spareSelectedPart.value.id); }
  function changeSpareTransactionPage(page: number) { spareTransactionPage.value = Math.max(1, page); if (spareSelectedPart.value) void loadSelectedPartData(spareSelectedPart.value.id); }
  function changeSpareTransactionPageSize(size: number) { spareTransactionPageSize.value = size; spareTransactionPage.value = 1; if (spareSelectedPart.value) void loadSelectedPartData(spareSelectedPart.value.id); }

  function openSparePartModal(part?: SparePart) {
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
    if (spareSaving.value) return false;
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
      deps.actionMessage.value = errorMessage(error, "备件保存失败");
      return false;
    } finally {
      spareSaving.value = false;
    }
    showSparePartModal.value = false;
    editingSparePart.value = null;
    deps.actionMessage.value = "备件已保存";
    if (!(await loadSpareData()) && spareListError.value) deps.actionMessage.value = "备件已保存，但列表刷新失败";
    return true;
  }

  async function deleteSparePart(part: SparePart) {
    if (deletingSparePartId.value !== null) return;
    deletingSparePartId.value = part.id;
    try {
      if (!(await deps.confirmAction(`确定删除备件“${part.name}”吗？`))) return;
      await deps.request(`/spare-parts/${part.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "备件已删除";
      if (spareSelectedPart.value?.id === part.id) spareSelectedPart.value = null;
      if (!(await loadSpareData()) && spareListError.value) deps.actionMessage.value = "备件已删除，但列表刷新失败";
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "备件删除失败");
    } finally {
      deletingSparePartId.value = null;
    }
  }

  function openSpareOperation(part: SparePart, operationType: StockOperationType = "inbound", location?: SpareOperationLocation) {
    spareOperationError.value = "";
    spareOperationType.value = operationType;
    let remembered: Partial<SpareOperationLocation> | null = null;
    if (!location) {
      try { remembered = JSON.parse(localStorage.getItem("itam.spare.last_location") || "null") as Partial<SpareOperationLocation> | null; } catch { remembered = null; }
    }
    const rememberedCenter = remembered?.data_center ? deps.dataCenters.value.find((center) => center.is_active && center.id === Number(remembered?.data_center)) : null;
    const rememberedRoom = rememberedCenter && remembered?.server_room ? spareRooms.value.find((room) => room.is_active && room.id === Number(remembered?.server_room) && room.data_center === rememberedCenter.id) : null;
    const preset = location || (rememberedCenter && (!remembered?.server_room || rememberedRoom) ? { data_center: rememberedCenter.id, server_room: rememberedRoom?.id || null, quantity: 0, label: "最近使用地点" } : undefined);
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
    if (spareOperationSaving.value) return false;
    spareOperationError.value = "";
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
      if (locationDataCenter) localStorage.setItem("itam.spare.last_location", JSON.stringify({ data_center: Number(locationDataCenter), server_room: locationServerRoom ? Number(locationServerRoom) : null }));
      showSpareOperationModal.value = false;
      deps.actionMessage.value = "库存流水已登记";
      const refreshed = await loadSpareData();
      if (!refreshed && spareListError.value) deps.actionMessage.value = "库存流水已登记，但备件列表刷新失败，请稍后重试";
      return true;
    } catch (error) {
      spareOperationError.value = errorMessage(error, "库存操作失败");
      deps.actionMessage.value = spareOperationError.value;
      return false;
    } finally {
      spareOperationSaving.value = false;
    }
  }

  function spareOperationLabel(operation: string) {
    return businessOptionLabel(STOCK_OPERATION_OPTIONS, operation);
  }

  return {
    spareParts, spareStocks, spareTransactions, sparePartCount, spareStockCount, spareTransactionCount,
    sparePage, sparePageSize, spareStockPage, spareStockPageSize, spareTransactionPage, spareTransactionPageSize,
    spareRooms, spareSearch, spareCategory, spareManufacturer, spareListDataCenter, spareListRoom, spareDataCenter, spareRoom,
    spareCategories: deps.spareCategories,
    spareSelectedPart, sparePartForm, showSparePartModal, editingSparePart, spareSaving, deletingSparePartId,
    spareListLoading, spareListError, exportingSpares, loadSpareData, refreshSparePart, searchSpareParts, resetSpareFilters, retrySpareList,
    spareOperationType, spareOperationForm, showSpareOperationModal, spareOperationSaving, spareOperationError, spareOperationCurrentQuantity,
    spareOperationLocationLabel, spareOperationLocationLocked, spareTransactionFilters,
    stockLocations, stockLoading, stockLocationLoadingByPart, stockLocationErrorByPart, stockLocationTotalsByPart,
    stockLocationLoadedByPart, loadStockLocations, transactionRows, transactionCount, transactionPage, transactionPageSize,
    transactionLoading, transactionError, loadTransactions, changeTransactionPage, changeTransactionPageSize,
    changeSparePage, changeSparePageSize, selectSparePart, changeSpareStockPage, changeSpareStockPageSize,
    changeSpareTransactionPage, changeSpareTransactionPageSize, openSparePartModal, saveSparePart,
    deleteSparePart, openSpareOperation, saveSpareOperation, spareOperationLabel, exportSpareParts, exportSpareTransactions,
  };
}
