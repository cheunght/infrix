import { ref, type Ref } from "vue";
import type { LocationQuery } from "vue-router";
import { buildExportQuery, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type {
  Asset,
  FaultEvent,
  RepairPartUsage,
  RepairPartUsageFormState,
  SparePart,
  SpareStock,
} from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
import { REPAIR_PART_USAGE_SOURCE_OPTIONS, type RepairPartUsageSource } from "../business-enums";
import { i18n } from "../i18n";
import { normalizeApiError, type ActionMessageType } from "../error-handling";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

export interface RepairsDeps {
  can: CapabilityFn;
  request: RequestFn;
  download: (path: string, filename: string) => Promise<void>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction?: (message: string) => Promise<boolean>;
  assets: Ref<Asset[]>;
  selectedAssetIds: Ref<number[]>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
  refreshOpenAssetDetail?: (assetId: number) => Promise<boolean | null>;
  clearRouteQuery?: (keys: string[]) => boolean;
}

function nowDateTimeLocal() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function emptyRepairPartUsageForm(): RepairPartUsageFormState {
  return {
    source: "internal_stock",
    spare_part_id: "",
    spare_stock_id: "",
    part_code: "",
    part_name: "",
    part_model: "",
    vendor_name: "",
    quantity: null,
    notes: "",
  };
}

export function useRepairs(deps: RepairsDeps) {
  const repairRows = ref<FaultEvent[]>([]);
  const repairCount = ref(0);
  const repairPage = ref(1);
  const repairPageSize = ref(50);
  const repairKeyword = ref("");
  const repairStatus = ref("");
  const repairStart = ref("");
  const repairEnd = ref("");
  const focusedFaultId = ref<number | null>(null);
  const showFaultModal = ref(false);
  const showRepairModal = ref(false);
  const selectedFault = ref<FaultEvent | null>(null);
  const faultForm = ref({ asset: "", occurred_at: "", reason: "", description: "" });
  const repairForm = ref({ provider: "", started_at: "", finished_at: "", notes: "" });
  const showRepairPartUsageModal = ref(false);
  const repairPartUsageForm = ref<RepairPartUsageFormState>({
    source: "internal_stock",
    spare_part_id: "",
    spare_stock_id: "",
    part_code: "",
    part_name: "",
    part_model: "",
    vendor_name: "",
    quantity: null,
    notes: "",
  });
  const repairPartUsageItems = ref<RepairPartUsage[]>([]);
  const repairPartUsagePage = ref(1);
  const repairPartUsagePageSize = ref(20);
  const repairPartUsageTotal = ref(0);
  const repairPartUsageLoading = ref(false);
  const repairPartUsageError = ref("");
  const repairPartUsageSaving = ref(false);
  const repairPartUsageOptions = ref<SparePart[]>([]);
  const repairPartUsageOptionsLoading = ref(false);
  const repairPartUsageOptionsError = ref("");
  const repairPartUsageStocks = ref<SpareStock[]>([]);
  const repairPartUsageStocksLoading = ref(false);
  const repairPartUsageStocksError = ref("");
  const repairPartUsageHistoryRequestId = ref(0);
  const repairPartUsageOptionsRequestId = ref(0);
  const repairPartUsageStocksRequestId = ref(0);
  let repairPartUsageHistoryController: AbortController | null = null;
  let repairPartUsageOptionsController: AbortController | null = null;
  let repairPartUsageStocksController: AbortController | null = null;
  let repairPartUsageSearchTimer: ReturnType<typeof setTimeout> | null = null;
  const repairListLoading = ref(false);
  const repairListError = ref("");
  const exportingRepairs = ref(false);
  const repairRequestId = ref(0);
  const faultSaving = ref(false);
  const repairSaving = ref(false);
  const faultError = ref("");
  const repairError = ref("");
  const appliedRepairFilters = ref({
    keyword: "",
    status: "",
    start: "",
    end: "",
  });

  function totalPages(total: number, size: number) {
    return Math.max(1, Math.ceil(total / size));
  }
  function openFaultModal(assetId?: number | Event) {
    if (!deps.can("faults.manage")) return;
    if (assetId instanceof Event) assetId = undefined;
    faultError.value = "";
    const selected = typeof assetId === "number" ? deps.assets.value.find((item) => item.id === assetId) : undefined;
    faultForm.value = {
      asset: selected ? String(selected.id) : "",
      occurred_at: nowDateTimeLocal(),
      reason: "",
      description: "",
    };
    showFaultModal.value = true;
  }
  function registerFaultFromSelection() {
    if (!deps.can("faults.manage")) return;
    if (deps.selectedAssetIds.value.length !== 1) {
      deps.actionMessage.value = tr("repair.selectAssetFirst");
      return;
    }
    openFaultModal(deps.selectedAssetIds.value[0]);
  }
  function openRepairModal(fault: FaultEvent) {
    if (!deps.can("faults.view")) return;
    repairError.value = "";
    selectedFault.value = fault;
    repairForm.value = {
      provider: fault.repair?.provider || "",
      started_at: toDateTimeLocal(fault.repair?.started_at || null),
      finished_at: toDateTimeLocal(fault.repair?.finished_at || null),
      notes: fault.repair?.notes || "",
    };
    repairPartUsageItems.value = [];
    repairPartUsageTotal.value = 0;
    repairPartUsagePage.value = 1;
    repairPartUsageError.value = "";
    showRepairModal.value = true;
    void loadRepairPartUsageHistory(fault.id, 1);
  }

  function repairTimeError() {
    const startedAt = repairForm.value.started_at.trim();
    const finishedAt = repairForm.value.finished_at.trim();
    return startedAt && finishedAt && startedAt > finishedAt
      ? tr("repair.invalidTimeRange")
      : "";
  }
  function currentRepairFilters() {
    return {
      keyword: repairKeyword.value.trim(),
      status: repairStatus.value,
      start: repairStart.value,
      end: repairEnd.value,
    };
  }

  function repairParams(filters: ReturnType<typeof currentRepairFilters>) {
    const params = new URLSearchParams({
      ordering: "-occurred_at",
      page: String(repairPage.value),
      page_size: String(repairPageSize.value),
    });
    if (filters.keyword) params.set("search", filters.keyword);
    if (filters.status) params.set("is_closed", filters.status);
    if (filters.start) params.set("start", filters.start);
    if (filters.end) params.set("end", filters.end);
    return params;
  }

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function loadAllPages<T>(
    basePath: string,
    signal: AbortSignal,
    shouldContinue: () => boolean,
  ): Promise<T[] | null> {
    const rows: T[] = [];
    let page = 1;
    while (shouldContinue() && !signal.aborted) {
      const separator = basePath.includes("?") ? "&" : "?";
      const result = await deps.request<PageResult<T> | T[]>(
        `${basePath}${separator}page=${page}`,
        { signal },
      );
      if (!shouldContinue() || signal.aborted) return null;
      if (Array.isArray(result)) return [...rows, ...result];
      rows.push(...(result.results || []));
      if (!result.next || !result.results.length) return rows;
      page += 1;
    }
    return null;
  }

  async function loadRepairPartUsageHistory(faultId: number, page = repairPartUsagePage.value): Promise<boolean> {
    const requestId = ++repairPartUsageHistoryRequestId.value;
    repairPartUsageHistoryController?.abort();
    const controller = new AbortController();
    repairPartUsageHistoryController = controller;
    const requestedPage = Math.max(1, page);
    repairPartUsagePage.value = requestedPage;
    repairPartUsageLoading.value = true;
    repairPartUsageError.value = "";
    try {
      const params = new URLSearchParams({
        page: String(requestedPage),
        page_size: String(repairPartUsagePageSize.value),
      });
      const payload = await deps.request<PageResult<RepairPartUsage> | RepairPartUsage[]>(
        `/fault-events/${faultId}/part-usages/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (
        requestId !== repairPartUsageHistoryRequestId.value
        || selectedFault.value?.id !== faultId
      ) return false;
      const nextCount = pageTotal(payload);
      const maxPage = totalPages(nextCount, repairPartUsagePageSize.value);
      if (requestedPage > maxPage) {
        repairPartUsagePage.value = maxPage;
        return await loadRepairPartUsageHistory(faultId, maxPage);
      }
      repairPartUsageItems.value = pageItems(payload);
      repairPartUsageTotal.value = nextCount;
      return true;
    } catch (error) {
      if (
        requestId === repairPartUsageHistoryRequestId.value
        && selectedFault.value?.id === faultId
        && !isAbortError(error)
      ) {
        repairPartUsageError.value = errorMessage(error, tr("repair.partUsageHistoryLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === repairPartUsageHistoryRequestId.value) {
        repairPartUsageLoading.value = false;
        if (repairPartUsageHistoryController === controller) repairPartUsageHistoryController = null;
      }
    }
  }

  async function loadRepairPartUsageOptions(search = ""): Promise<boolean> {
    if (
      repairPartUsageForm.value.source !== "internal_stock"
      || !deps.can("spares.view")
      || !deps.can("spares.manage")
    ) return false;
    const requestId = ++repairPartUsageOptionsRequestId.value;
    repairPartUsageOptionsController?.abort();
    const controller = new AbortController();
    repairPartUsageOptionsController = controller;
    repairPartUsageOptionsLoading.value = true;
    repairPartUsageOptionsError.value = "";
    try {
      const params = new URLSearchParams({ page: "1", page_size: "20" });
      if (search.trim()) params.set("search", search.trim());
      const payload = await deps.request<PageResult<SparePart> | SparePart[]>(
        `/spare-parts/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (requestId !== repairPartUsageOptionsRequestId.value) return false;
      const options = pageItems(payload);
      const selectedPartId = Number(repairPartUsageForm.value.spare_part_id);
      const previousSelected = repairPartUsageOptions.value.find((part) => part.id === selectedPartId);
      if (previousSelected && !options.some((part) => part.id === previousSelected.id)) {
        options.unshift(previousSelected);
      }
      repairPartUsageOptions.value = options;
      return true;
    } catch (error) {
      if (requestId === repairPartUsageOptionsRequestId.value && !isAbortError(error)) {
        repairPartUsageOptionsError.value = errorMessage(error, tr("repair.partUsageOptionsLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === repairPartUsageOptionsRequestId.value) {
        repairPartUsageOptionsLoading.value = false;
        if (repairPartUsageOptionsController === controller) repairPartUsageOptionsController = null;
      }
    }
  }

  function scheduleRepairPartUsagePartSearch(search: string) {
    if (repairPartUsageForm.value.source !== "internal_stock") return;
    if (repairPartUsageSearchTimer) clearTimeout(repairPartUsageSearchTimer);
    repairPartUsageSearchTimer = setTimeout(() => {
      repairPartUsageSearchTimer = null;
      void loadRepairPartUsageOptions(search);
    }, search.trim() ? 250 : 0);
  }

  async function loadRepairPartUsageStocks(partId = repairPartUsageForm.value.spare_part_id): Promise<boolean> {
    if (repairPartUsageForm.value.source !== "internal_stock") {
      repairPartUsageStocksRequestId.value += 1;
      repairPartUsageStocksController?.abort();
      repairPartUsageStocksController = null;
      repairPartUsageStocks.value = [];
      repairPartUsageStocksError.value = "";
      repairPartUsageStocksLoading.value = false;
      return true;
    }
    if (!deps.can("spares.view") || !deps.can("spares.manage")) return false;
    const requestId = ++repairPartUsageStocksRequestId.value;
    repairPartUsageStocksController?.abort();
    if (!partId) {
      repairPartUsageStocks.value = [];
      repairPartUsageStocksError.value = "";
      repairPartUsageStocksLoading.value = false;
      return true;
    }
    const controller = new AbortController();
    repairPartUsageStocksController = controller;
    repairPartUsageStocksLoading.value = true;
    repairPartUsageStocksError.value = "";
    try {
      const rows = await loadAllPages<SpareStock>(
        `/spare-stocks/?part=${encodeURIComponent(partId)}&page_size=50`,
        controller.signal,
        () => requestId === repairPartUsageStocksRequestId.value,
      );
      if (rows == null || requestId !== repairPartUsageStocksRequestId.value) return false;
      repairPartUsageStocks.value = rows;
      return true;
    } catch (error) {
      if (requestId === repairPartUsageStocksRequestId.value && !isAbortError(error)) {
        repairPartUsageStocksError.value = errorMessage(error, tr("repair.partUsageStocksLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === repairPartUsageStocksRequestId.value) {
        repairPartUsageStocksLoading.value = false;
        if (repairPartUsageStocksController === controller) repairPartUsageStocksController = null;
      }
    }
  }

  function openRepairPartUsageModal() {
    if (!deps.can("faults.manage") || !selectedFault.value || selectedFault.value.is_closed) return;
    repairPartUsageForm.value = emptyRepairPartUsageForm();
    if (!deps.can("spares.manage")) repairPartUsageForm.value.source = "vendor_provided";
    repairPartUsageError.value = "";
    repairPartUsageOptionsError.value = "";
    repairPartUsageStocksError.value = "";
    showRepairPartUsageModal.value = true;
    if (repairPartUsageForm.value.source === "internal_stock") {
      void loadRepairPartUsageStocks("");
      void loadRepairPartUsageOptions();
    }
  }

  function changeRepairPartUsageSource(source: RepairPartUsageSource) {
    const nextSource = source === "internal_stock" && !deps.can("spares.manage")
      ? "vendor_provided"
      : source;
    repairPartUsageForm.value.source = nextSource;
    repairPartUsageForm.value.spare_part_id = "";
    repairPartUsageForm.value.spare_stock_id = "";
    repairPartUsageForm.value.part_code = "";
    repairPartUsageForm.value.part_name = "";
    repairPartUsageForm.value.part_model = "";
    repairPartUsageForm.value.vendor_name = "";
    repairPartUsageStocks.value = [];
    repairPartUsageStocksError.value = "";
    void loadRepairPartUsageStocks("");
    if (nextSource === "internal_stock") {
      void loadRepairPartUsageOptions();
    } else {
      repairPartUsageOptionsRequestId.value += 1;
      repairPartUsageOptionsController?.abort();
      repairPartUsageOptionsController = null;
      repairPartUsageOptions.value = [];
      repairPartUsageOptionsLoading.value = false;
      repairPartUsageOptionsError.value = "";
    }
  }

  function changeRepairPartUsagePart(partId: string | number | null | undefined) {
    const normalizedPartId = partId == null ? "" : String(partId);
    repairPartUsageForm.value.spare_part_id = normalizedPartId;
    repairPartUsageForm.value.spare_stock_id = "";
    repairPartUsageStocks.value = [];
    repairPartUsageStocksError.value = "";
    if (repairPartUsageForm.value.source === "internal_stock") {
      void loadRepairPartUsageStocks(normalizedPartId);
    } else {
      void loadRepairPartUsageStocks("");
    }
  }

  async function saveRepairPartUsage(): Promise<boolean> {
    if (!deps.can("faults.manage") || !selectedFault.value || repairPartUsageSaving.value) return false;
    if (selectedFault.value.is_closed) {
      deps.actionMessage.value = tr("repair.completedViewOnly");
      return false;
    }
    const form = repairPartUsageForm.value;
    const internalStock = form.source === "internal_stock";
    const partId = Number(form.spare_part_id);
    const quantity = Number(form.quantity);
    if (
      (internalStock && (!Number.isInteger(partId) || partId <= 0))
      || (!internalStock && !form.part_name.trim())
      || !Number.isInteger(quantity)
      || quantity <= 0
    ) {
      repairPartUsageError.value = tr("repair.partUsageFormIncomplete");
      return false;
    }
    if (internalStock && !form.spare_stock_id) {
      repairPartUsageError.value = tr("repair.partUsageStockRequired");
      return false;
    }
    repairPartUsageSaving.value = true;
    repairPartUsageError.value = "";
    const faultId = selectedFault.value.id;
    const requestedPartId = internalStock ? form.spare_part_id : "";
    try {
      const payload: Record<string, unknown> = {
        source: form.source,
        quantity,
        notes: form.notes.trim(),
      };
      if (internalStock) {
        payload.spare_part_id = partId;
        payload.spare_stock_id = Number(form.spare_stock_id);
      } else {
        payload.part_name = form.part_name.trim();
        if (form.part_code.trim()) payload.part_code = form.part_code.trim();
        if (form.part_model.trim()) payload.part_model = form.part_model.trim();
        payload.vendor_name = form.vendor_name.trim();
      }
      await deps.request(`/fault-events/${faultId}/part-usages/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      repairPartUsageError.value = errorMessage(error, tr("repair.partUsageSaveFailed"));
      deps.actionMessage.value = repairPartUsageError.value;
      return false;
    } finally {
      repairPartUsageSaving.value = false;
    }

    showRepairPartUsageModal.value = false;
    repairPartUsageForm.value = emptyRepairPartUsageForm();
    const historyRefreshed = await loadRepairPartUsageHistory(faultId, 1);
    const stockRefreshed = form.source === "internal_stock"
      ? await loadRepairPartUsageStocks(requestedPartId)
      : true;
    const refreshErrors: string[] = [];
    if (!historyRefreshed) refreshErrors.push(tr("repair.partUsageHistoryRefreshFailed"));
    if (!stockRefreshed) refreshErrors.push(tr("repair.partUsageStocksRefreshFailed"));
    deps.actionMessage.value = refreshErrors.length
      ? `${tr("repair.partUsageSaved")}，${refreshErrors.join("；")}`
      : tr("repair.partUsageSaved");
    return true;
  }

  function retryRepairPartUsageHistory() {
    if (selectedFault.value) void loadRepairPartUsageHistory(selectedFault.value.id, repairPartUsagePage.value);
  }

  function changeRepairPartUsagePage(page: number) {
    if (!selectedFault.value) return;
    repairPartUsagePage.value = Math.max(1, page);
    void loadRepairPartUsageHistory(selectedFault.value.id, repairPartUsagePage.value);
  }

  async function loadRepairs(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("faults.view")) return false;
    const requestId = ++repairRequestId.value;
    const filters = currentRepairFilters();
    const requestedPage = repairPage.value;
    repairListLoading.value = true;
    repairListError.value = "";

    try {
      if (focusedFaultId.value) {
        const focusedFault = await deps.request<FaultEvent>(`/fault-events/${focusedFaultId.value}/`);
        if (requestId !== repairRequestId.value || !deps.isCurrentLoad(version)) return false;
        repairRows.value = [focusedFault];
        repairCount.value = 1;
        repairPage.value = 1;
        appliedRepairFilters.value = filters;
        return true;
      }

      const payload = await deps.request<PageResult<FaultEvent> | FaultEvent[]>(
        `/fault-events/?${repairParams(filters).toString()}`,
      );
      if (requestId !== repairRequestId.value || !deps.isCurrentLoad(version)) return false;

      const nextCount = pageTotal(payload);
      const maxPage = totalPages(nextCount, repairPageSize.value);
      if (requestedPage > maxPage) {
        repairPage.value = maxPage;
        // Re-request once with the corrected page. The new request id makes
        // the first response stale, so this cannot loop on the same page.
        return await loadRepairs(version);
      }

      repairRows.value = pageItems(payload);
      repairCount.value = nextCount;
      appliedRepairFilters.value = filters;
      return true;
    } catch (error) {
      if (requestId === repairRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        repairListError.value = errorMessage(error, tr("repair.dataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === repairRequestId.value) repairListLoading.value = false;
    }
  }
  function searchRepairs() {
    focusedFaultId.value = null;
    repairPage.value = 1;
    void loadRepairs();
  }

  function queryValue(query: LocationQuery, key: string): string {
    const value = query[key];
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  }

  function syncFiltersFromQuery(query: LocationQuery) {
    const status = queryValue(query, "is_closed");
    const fault = queryValue(query, "fault");
    repairKeyword.value = queryValue(query, "search");
    repairStatus.value = status === "true" || status === "false" ? status : "";
    focusedFaultId.value = /^\d+$/.test(fault) && Number(fault) > 0 ? Number(fault) : null;
    repairStart.value = queryValue(query, "start");
    repairEnd.value = queryValue(query, "end");
    repairPage.value = 1;
  }

  function onRepairStatusChange() {
    focusedFaultId.value = null;
    repairPage.value = 1;
    void loadRepairs();
  }
  function onRepairDateChange() {
    focusedFaultId.value = null;
    repairPage.value = 1;
    if (repairStart.value && repairEnd.value && repairStart.value > repairEnd.value) {
      repairListError.value = tr("repair.invalidDateRange");
      return;
    }
    // Wait for the other half of a date range; SearchField/Reset can still
    // explicitly apply a single-sided date filter.
    if ((repairStart.value && !repairEnd.value) || (!repairStart.value && repairEnd.value)) {
      repairListError.value = "";
      return;
    }
    void loadRepairs();
  }
  function resetRepairFilters() {
    focusedFaultId.value = null;
    repairKeyword.value = "";
    repairStatus.value = "";
    repairStart.value = "";
    repairEnd.value = "";
    repairPage.value = 1;
    if (deps.clearRouteQuery?.(["fault", "is_closed", "search", "start", "end"])) return;
    void loadRepairs();
  }
  function retryRepairList() {
    void loadRepairs();
  }
  async function createFault(): Promise<boolean> {
    if (!deps.can("faults.manage")) return false;
    if (faultSaving.value) return false;
    faultError.value = "";
    faultSaving.value = true;
    try {
      await deps.request("/fault-events/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...faultForm.value, asset: Number(faultForm.value.asset) }),
      });
    } catch (error) {
      faultError.value = error instanceof Error ? error.message : tr("repair.faultSaveFailed");
      deps.actionMessage.value = faultError.value;
      return false;
    } finally {
      faultSaving.value = false;
    }
    showFaultModal.value = false;
    deps.actionMessage.value = tr("repair.faultRegistered");
    if (!(await loadRepairs())) deps.actionMessage.value = tr("repair.faultRegisteredRefreshFailed");
    return true;
  }
  async function saveRepair(): Promise<boolean> {
    if (!deps.can("faults.manage")) return false;
    if (!selectedFault.value || repairSaving.value) return false;
    if (selectedFault.value.is_closed) {
      deps.actionMessage.value = tr("repair.completedViewOnly");
      return false;
    }
    repairError.value = "";
    const timeError = repairTimeError();
    if (timeError) {
      deps.actionMessage.value = timeError;
      return false;
    }
    repairSaving.value = true;
    const repairedAssetId = selectedFault.value.asset;
    try {
      const payload = {
        fault: selectedFault.value.id,
        provider: repairForm.value.provider.trim(),
        started_at: repairForm.value.started_at || null,
        finished_at: repairForm.value.finished_at || null,
        notes: repairForm.value.notes,
      };
      if (selectedFault.value.repair) {
        await deps.request(`/repair-records/${selectedFault.value.repair.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        await deps.request("/repair-records/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
    } catch (error) {
      repairError.value = error instanceof Error ? error.message : tr("repair.recordSaveFailed");
      deps.actionMessage.value = repairError.value;
      return false;
    } finally {
      repairSaving.value = false;
    }
    showRepairModal.value = false;
    const successMessage = repairForm.value.finished_at ? tr("repair.completed") : tr("repair.recordSaved");
    const listRefreshed = await loadRepairs();
    const detailRefresh = deps.refreshOpenAssetDetail
      ? await deps.refreshOpenAssetDetail(repairedAssetId)
      : null;
    const followUpMessages: string[] = [];
    if (!listRefreshed) followUpMessages.push(tr("common.refreshFailed"));
    if (detailRefresh === false) followUpMessages.push(tr("asset.assetDetailLoadFailed"));
    deps.actionMessage.value = followUpMessages.length
      ? `${successMessage}，${followUpMessages.join("；")}`
      : successMessage;
    return true;
  }
  async function reopenRepair(): Promise<boolean> {
    if (
      !deps.can("faults.manage")
      || !selectedFault.value?.is_closed
      || !selectedFault.value.repair
      || repairSaving.value
    ) return false;
    repairError.value = "";
    repairSaving.value = true;
    const repairedAssetId = selectedFault.value.asset;
    const repairId = selectedFault.value.repair.id;
    try {
      if (!deps.confirmAction || !(await deps.confirmAction(tr("repair.reopenConfirm")))) return false;
      await deps.request(`/repair-records/${repairId}/reopen/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      repairError.value = errorMessage(error, tr("repair.reopenFailed"));
      deps.actionMessage.value = repairError.value;
      return false;
    } finally {
      repairSaving.value = false;
    }

    showRepairModal.value = false;
    const listRefreshed = await loadRepairs();
    const detailRefresh = deps.refreshOpenAssetDetail
      ? await deps.refreshOpenAssetDetail(repairedAssetId)
      : null;
    const followUpMessages: string[] = [];
    if (!listRefreshed) followUpMessages.push(tr("repair.reopenedRefreshFailed"));
    if (detailRefresh === false) followUpMessages.push(tr("asset.assetDetailLoadFailed"));
    deps.actionMessage.value = followUpMessages.length
      ? `${tr("repair.reopened")}，${followUpMessages.join("；")}`
      : tr("repair.reopened");
    return true;
  }
  async function exportRepairs() {
    if (!deps.can("faults.export")) return;
    if (exportingRepairs.value) return;
    exportingRepairs.value = true;
    const params = new URLSearchParams();
    if (appliedRepairFilters.value.keyword) params.set("search", appliedRepairFilters.value.keyword);
    if (appliedRepairFilters.value.status) params.set("is_closed", appliedRepairFilters.value.status);
    if (appliedRepairFilters.value.start) params.set("start", appliedRepairFilters.value.start);
    if (appliedRepairFilters.value.end) params.set("end", appliedRepairFilters.value.end);
    try {
      const query = buildExportQuery(params);
      await deps.download(`/reports/repairs/export/${query ? `?${query}` : ""}`, "maintenance-records.xlsx");
    } catch (error) {
      const normalized = normalizeApiError(error);
      deps.actionMessageType.value = "error";
      deps.actionMessage.value = normalized.kind === "unknown" ? tr("repair.exportFailed") : normalized.message;
    } finally {
      exportingRepairs.value = false;
    }
  }
  function changeRepairPage(page: number) {
    repairPage.value = Math.min(Math.max(page, 1), totalPages(repairCount.value, repairPageSize.value));
    void loadRepairs();
  }
  function changeRepairPageSize(size: number) {
    repairPageSize.value = size;
    repairPage.value = 1;
    void loadRepairs();
  }

  return {
    repairRows, repairCount, repairPage, repairPageSize, repairKeyword, repairStatus, repairStart, repairEnd,
    showFaultModal, showRepairModal, selectedFault, faultForm,
    repairListLoading, repairListError, exportingRepairs, faultSaving, repairSaving, faultError, repairError,
    repairForm, repairTimeError, openFaultModal, registerFaultFromSelection, openRepairModal, loadRepairs,
    searchRepairs, onRepairStatusChange, onRepairDateChange, resetRepairFilters, retryRepairList,
    syncFiltersFromQuery,
    createFault, saveRepair, reopenRepair, exportRepairs, changeRepairPage, changeRepairPageSize,
    showRepairPartUsageModal, repairPartUsageForm, repairPartUsageItems, repairPartUsagePage,
    repairPartUsagePageSize, repairPartUsageTotal, repairPartUsageLoading, repairPartUsageError,
    repairPartUsageSaving, repairPartUsageOptions, repairPartUsageOptionsLoading, repairPartUsageOptionsError,
    repairPartUsageStocks, repairPartUsageStocksLoading, repairPartUsageStocksError,
    repairPartUsageSourceOptions: REPAIR_PART_USAGE_SOURCE_OPTIONS,
    openRepairPartUsageModal, loadRepairPartUsageHistory, loadRepairPartUsageOptions,
    scheduleRepairPartUsagePartSearch, loadRepairPartUsageStocks, changeRepairPartUsageSource,
    changeRepairPartUsagePart, saveRepairPartUsage, retryRepairPartUsageHistory, changeRepairPartUsagePage,
  };
}
