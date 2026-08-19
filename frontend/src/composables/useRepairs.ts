import { ref, type Ref } from "vue";
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
  const repairForm = ref({ finished_at: "" });

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
    repairForm.value = { finished_at: toDateTimeLocal(fault.repair?.finished_at || null) };
    showRepairModal.value = true;
  }
  async function loadRepairs(version = deps.beginLoad()) {
    const params = new URLSearchParams({ ordering: "-occurred_at", page: String(repairPage.value), page_size: String(repairPageSize.value) });
    if (repairKeyword.value) params.set("search", repairKeyword.value);
    if (repairStatus.value) params.set("is_closed", repairStatus.value);
    if (repairStart.value) params.set("start", repairStart.value);
    if (repairEnd.value) params.set("end", repairEnd.value);
    const payload = await deps.request<PageResult<FaultEvent> | FaultEvent[]>(`/fault-events/?${params.toString()}`);
    if (!deps.isCurrentLoad(version)) return;
    repairRows.value = pageItems(payload);
    repairCount.value = pageTotal(payload);
  }
  function searchRepairs() {
    repairPage.value = 1;
    void loadRepairs();
  }
  async function createFault() {
    try {
      await deps.request("/fault-events/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...faultForm.value, asset: Number(faultForm.value.asset) }),
      });
      showFaultModal.value = false;
      deps.actionMessage.value = "故障已登记";
      await loadRepairs();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "故障登记失败";
    }
  }
  async function saveRepair() {
    if (!selectedFault.value) return;
    try {
      const payload = { finished_at: repairForm.value.finished_at || null, fault: selectedFault.value.id };
      if (selectedFault.value.repair) {
        await deps.request(`/repair-records/${selectedFault.value.repair.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        await deps.request("/repair-records/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      showRepairModal.value = false;
      deps.actionMessage.value = repairForm.value.finished_at ? "维修已完成，故障已关闭" : "维修记录已保存";
      await loadRepairs();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "维修记录保存失败";
    }
  }
  async function exportRepairs() {
    const params = new URLSearchParams();
    if (repairKeyword.value) params.set("search", repairKeyword.value);
    if (repairStatus.value) params.set("is_closed", repairStatus.value);
    if (repairStart.value) params.set("start", repairStart.value);
    if (repairEnd.value) params.set("end", repairEnd.value);
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
    repairForm, openFaultModal, searchFaultAssets, registerFaultFromSelection, openRepairModal, loadRepairs,
    searchRepairs, createFault, saveRepair, exportRepairs, changeRepairPage, changeRepairPageSize,
  };
}
