import { ref, type Ref } from "vue";
import type { LocationQuery } from "vue-router";
import { pageItems, pageTotal, type PageResult } from "../api";
import type { Asset, FaultEvent } from "../types";
import type { RequestFn } from "../types/page-context";

export interface RepairsDeps {
  request: RequestFn;
  download: (path: string, filename: string) => Promise<void>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction?: (message: string) => Promise<boolean>;
  assets: Ref<Asset[]>;
  selectedAssetIds: Ref<number[]>;
  actionMessage: Ref<string>;
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

export function useRepairs(deps: RepairsDeps) {
  const repairRows = ref<FaultEvent[]>([]);
  const repairCount = ref(0);
  const repairPage = ref(1);
  const repairPageSize = ref(50);
  const repairKeyword = ref("");
  const repairStatus = ref("");
  const repairStart = ref("");
  const repairEnd = ref("");
  const showFaultModal = ref(false);
  const showRepairModal = ref(false);
  const selectedFault = ref<FaultEvent | null>(null);
  const faultForm = ref({ asset: "", occurred_at: "", reason: "", description: "" });
  const faultAssetSearch = ref("");
  const faultAssetOptions = ref<Asset[]>([]);
  const faultAssetLoading = ref(false);
  const faultAssetRequestId = ref(0);
  const repairForm = ref({ provider: "", started_at: "", finished_at: "", notes: "" });
  const repairListLoading = ref(false);
  const repairListError = ref("");
  const repairRequestId = ref(0);
  const faultSaving = ref(false);
  const repairSaving = ref(false);
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
    if (assetId instanceof Event) assetId = undefined;
    faultAssetRequestId.value += 1;
    faultAssetLoading.value = false;
    const selected = typeof assetId === "number" ? deps.assets.value.find((item) => item.id === assetId) : undefined;
    faultForm.value = {
      asset: selected ? String(selected.id) : "",
      occurred_at: nowDateTimeLocal(),
      reason: "",
      description: "",
    };
    faultAssetSearch.value = selected ? `${selected.asset_no} · ${selected.name}` : "";
    faultAssetOptions.value = selected ? [selected] : [];
    showFaultModal.value = true;
  }
  async function searchFaultAssets() {
    const keyword = faultAssetSearch.value.trim();
    const requestId = ++faultAssetRequestId.value;
    if (!keyword) {
      faultAssetOptions.value = [];
      faultAssetLoading.value = false;
      return;
    }
    faultAssetLoading.value = true;
    try {
      const payload = await deps.request<PageResult<Asset> | Asset[]>(`/assets/?search=${encodeURIComponent(keyword)}&page_size=20&compact=1`);
      if (requestId !== faultAssetRequestId.value) return;
      faultAssetOptions.value = pageItems(payload);
      if (faultAssetOptions.value.length === 1) faultForm.value.asset = String(faultAssetOptions.value[0].id);
    } catch (error) {
      if (requestId !== faultAssetRequestId.value) return;
      deps.actionMessage.value = error instanceof Error ? error.message : "资产搜索失败";
    } finally {
      if (requestId === faultAssetRequestId.value) faultAssetLoading.value = false;
    }
  }
  function registerFaultFromSelection() {
    if (deps.selectedAssetIds.value.length !== 1) {
      deps.actionMessage.value = "请先选择一项资产再登记故障";
      return;
    }
    openFaultModal(deps.selectedAssetIds.value[0]);
  }
  function openRepairModal(fault: FaultEvent) {
    selectedFault.value = fault;
    repairForm.value = {
      provider: fault.repair?.provider || "",
      started_at: toDateTimeLocal(fault.repair?.started_at || null),
      finished_at: toDateTimeLocal(fault.repair?.finished_at || null),
      notes: fault.repair?.notes || "",
    };
    showRepairModal.value = true;
  }

  function repairTimeError() {
    const startedAt = repairForm.value.started_at.trim();
    const finishedAt = repairForm.value.finished_at.trim();
    return startedAt && finishedAt && startedAt > finishedAt
      ? "维修开始时间不能晚于维修完成时间"
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

  async function loadRepairs(version = deps.beginLoad()): Promise<boolean> {
    const requestId = ++repairRequestId.value;
    const filters = currentRepairFilters();
    const requestedPage = repairPage.value;
    repairListLoading.value = true;
    repairListError.value = "";

    try {
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
      if (requestId === repairRequestId.value && deps.isCurrentLoad(version)) {
        repairListError.value = errorMessage(error, "故障数据加载失败");
      }
      return false;
    } finally {
      if (requestId === repairRequestId.value) repairListLoading.value = false;
    }
  }
  function searchRepairs() {
    repairPage.value = 1;
    void loadRepairs();
  }

  function queryValue(query: LocationQuery, key: string): string {
    const value = query[key];
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  }

  function syncFiltersFromQuery(query: LocationQuery) {
    const status = queryValue(query, "is_closed");
    repairKeyword.value = queryValue(query, "search");
    repairStatus.value = status === "true" || status === "false" ? status : "";
    repairStart.value = "";
    repairEnd.value = "";
    repairPage.value = 1;
  }

  function onRepairStatusChange() {
    repairPage.value = 1;
    void loadRepairs();
  }
  function onRepairDateChange() {
    repairPage.value = 1;
    if (repairStart.value && repairEnd.value && repairStart.value > repairEnd.value) {
      repairListError.value = "开始日期不能晚于结束日期";
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
    repairKeyword.value = "";
    repairStatus.value = "";
    repairStart.value = "";
    repairEnd.value = "";
    repairPage.value = 1;
    if (deps.clearRouteQuery?.(["is_closed", "search", "start", "end"])) return;
    void loadRepairs();
  }
  function retryRepairList() {
    void loadRepairs();
  }
  async function createFault(): Promise<boolean> {
    if (faultSaving.value) return false;
    faultSaving.value = true;
    try {
      await deps.request("/fault-events/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...faultForm.value, asset: Number(faultForm.value.asset) }),
      });
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "故障登记失败";
      return false;
    } finally {
      faultSaving.value = false;
    }
    showFaultModal.value = false;
    deps.actionMessage.value = "故障已登记";
    if (!(await loadRepairs())) deps.actionMessage.value = "故障已登记，但列表刷新失败";
    return true;
  }
  async function saveRepair(): Promise<boolean> {
    if (!selectedFault.value || repairSaving.value) return false;
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
      deps.actionMessage.value = error instanceof Error ? error.message : "维修记录保存失败";
      return false;
    } finally {
      repairSaving.value = false;
    }
    showRepairModal.value = false;
    const successMessage = repairForm.value.finished_at ? "维修已完成，故障已关闭" : "维修记录已保存";
    const listRefreshed = await loadRepairs();
    const detailRefresh = deps.refreshOpenAssetDetail
      ? await deps.refreshOpenAssetDetail(repairedAssetId)
      : null;
    const followUpMessages: string[] = [];
    if (!listRefreshed) followUpMessages.push("列表刷新失败");
    if (detailRefresh === false) followUpMessages.push("资产详情刷新失败，请稍后重试");
    deps.actionMessage.value = followUpMessages.length
      ? `${successMessage}，${followUpMessages.join("；")}`
      : successMessage;
    return true;
  }
  async function exportRepairs() {
    const params = new URLSearchParams();
    if (appliedRepairFilters.value.keyword) params.set("search", appliedRepairFilters.value.keyword);
    if (appliedRepairFilters.value.status) params.set("is_closed", appliedRepairFilters.value.status);
    if (appliedRepairFilters.value.start) params.set("start", appliedRepairFilters.value.start);
    if (appliedRepairFilters.value.end) params.set("end", appliedRepairFilters.value.end);
    try {
      await deps.download(`/reports/repairs/export/?${params.toString()}`, "repairs.xlsx");
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "维修记录导出失败";
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
    showFaultModal, showRepairModal, selectedFault, faultForm, faultAssetSearch, faultAssetOptions, faultAssetLoading,
    repairListLoading, repairListError, faultSaving, repairSaving,
    repairForm, repairTimeError, openFaultModal, searchFaultAssets, registerFaultFromSelection, openRepairModal, loadRepairs,
    searchRepairs, onRepairStatusChange, onRepairDateChange, resetRepairFilters, retryRepairList,
    syncFiltersFromQuery,
    createFault, saveRepair, exportRepairs, changeRepairPage, changeRepairPageSize,
  };
}
