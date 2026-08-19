import { ref, type Ref } from "vue";
import { pageItems, pageTotal, type PageResult } from "../api";
import type { DataCenter, ServerRoom, SparePart, SpareStock, SpareTransaction } from "../types";
import type { RequestFn } from "../types/page-context";

export type SpareOperationLocation = {
  data_center: number;
  server_room: number | null;
  quantity: number;
  label: string;
};

export interface SparePartsDeps {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  dataCenters: Ref<DataCenter[]>;
  actionMessage: Ref<string>;
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
  const spareType = ref("");
  const spareActive = ref("true");
  const spareListDataCenter = ref("");
  const spareListRoom = ref("");
  const spareDataCenter = ref("");
  const spareRoom = ref("");
  const spareSelectedPart = ref<SparePart | null>(null);
  const sparePartForm = ref({
    name: "", part_type: "other", brand: "", model: "", specification: "", unit: "件", is_active: true, notes: "",
  });
  const showSparePartModal = ref(false);
  const editingSparePart = ref<SparePart | null>(null);
  const spareOperationType = ref("inbound");
  const spareOperationForm = ref({
    part: "", quantity: "1", target_quantity: "", source_data_center: "", source_server_room: "", target_data_center: "", target_server_room: "", reference: "", notes: "",
  });
  const showSpareOperationModal = ref(false);
  const spareOperationSaving = ref(false);
  const spareOperationCurrentQuantity = ref<number | null>(null);
  const spareOperationLocationLabel = ref("");
  const spareOperationLocationLocked = ref(false);
  const spareTransactionFilters = ref({ part: "", operation_type: "" });
  const stockLocations = ref<Record<number, SpareStock[]>>({});
  const stockLoading = ref<Record<number, boolean>>({});
  const stockRequestSerial = ref(0);
  const transactionRows = ref<SpareTransaction[]>([]);
  const transactionCount = ref(0);
  const transactionPage = ref(1);
  const transactionPageSize = ref(20);
  const transactionLoading = ref(false);
  const transactionError = ref("");

  async function loadSpareData(version = deps.beginLoad()) {
    const partParams = new URLSearchParams({ page: String(sparePage.value), page_size: String(sparePageSize.value) });
    if (spareSearch.value.trim()) partParams.set("search", spareSearch.value.trim());
    if (spareType.value) partParams.set("part_type", spareType.value);
    if (spareActive.value) partParams.set("is_active", spareActive.value);
    if (spareListDataCenter.value) partParams.set("data_center", spareListDataCenter.value);
    if (spareListRoom.value) partParams.set("server_room", spareListRoom.value);
    const stockParams = new URLSearchParams({ page: String(spareStockPage.value), page_size: String(spareStockPageSize.value) });
    const transactionParams = new URLSearchParams({ page: String(spareTransactionPage.value), page_size: String(spareTransactionPageSize.value) });
    if (spareSelectedPart.value) {
      stockParams.set("part", String(spareSelectedPart.value.id));
      transactionParams.set("part", String(spareSelectedPart.value.id));
      if (spareDataCenter.value) stockParams.set("data_center", spareDataCenter.value);
      if (spareRoom.value) stockParams.set("server_room", spareRoom.value);
    }
    const requests: Promise<unknown>[] = [
      deps.request<PageResult<SparePart> | SparePart[]>(`/spare-parts/?${partParams}`),
      deps.request<PageResult<ServerRoom> | ServerRoom[]>("/server-rooms/?page_size=100&is_active=true"),
    ];
    if (spareSelectedPart.value) {
      requests.push(
        deps.request<PageResult<SpareStock> | SpareStock[]>(`/spare-stocks/?${stockParams}`),
        deps.request<PageResult<SpareTransaction> | SpareTransaction[]>(`/spare-transactions/?${transactionParams}`),
      );
    }
    const results = await Promise.all(requests);
    if (!deps.isCurrentLoad(version)) return;
    const partResult = results[0] as PageResult<SparePart> | SparePart[];
    spareParts.value = pageItems(partResult);
    sparePartCount.value = pageTotal(partResult);
    spareRooms.value = pageItems(results[1] as PageResult<ServerRoom> | ServerRoom[]);
    if (spareSelectedPart.value) {
      const current = spareParts.value.find((part) => part.id === spareSelectedPart.value?.id);
      if (current) spareSelectedPart.value = current;
      const stockResult = results[2] as PageResult<SpareStock> | SpareStock[];
      const transactionResult = results[3] as PageResult<SpareTransaction> | SpareTransaction[];
      spareStocks.value = pageItems(stockResult);
      spareStockCount.value = pageTotal(stockResult);
      spareTransactions.value = pageItems(transactionResult);
      spareTransactionCount.value = pageTotal(transactionResult);
    } else {
      spareStocks.value = [];
      spareStockCount.value = 0;
      spareTransactions.value = [];
      spareTransactionCount.value = 0;
    }
  }
  async function refreshSparePart(partId: number) {
    const detail = await deps.request<SparePart>(`/spare-parts/${partId}/`);
    const index = spareParts.value.findIndex((part) => part.id === partId);
    if (index >= 0) spareParts.value.splice(index, 1, detail);
    if (spareSelectedPart.value?.id === partId) spareSelectedPart.value = detail;
  }
  function searchSpareParts() { sparePage.value = 1; void loadSpareData(); }
  function changeSparePage(page: number) { sparePage.value = Math.max(1, page); void loadSpareData(); }
  function changeSparePageSize(size: number) { sparePageSize.value = size; sparePage.value = 1; void loadSpareData(); }
  function selectSparePart(part: SparePart | null, resetFilters = true) {
    spareSelectedPart.value = part;
    if (resetFilters) {
      spareStockPage.value = 1;
      spareTransactionPage.value = 1;
    }
    void loadSpareData();
  }
  async function loadStockLocations(partId: number) {
    const serial = ++stockRequestSerial.value;
    stockLoading.value = { ...stockLoading.value, [partId]: true };
    try {
      const result = await deps.request<PageResult<SpareStock> | SpareStock[]>(
        `/spare-stocks/?part=${partId}&page_size=100`,
      );
      if (serial !== stockRequestSerial.value) return;
      stockLocations.value = { ...stockLocations.value, [partId]: pageItems(result) };
    } catch {
      if (serial === stockRequestSerial.value) {
        stockLocations.value = { ...stockLocations.value, [partId]: [] };
      }
    } finally {
      if (serial === stockRequestSerial.value) {
        stockLoading.value = { ...stockLoading.value, [partId]: false };
      }
    }
  }
  async function loadTransactions(partId: number) {
    transactionLoading.value = true;
    transactionError.value = "";
    try {
      const params = new URLSearchParams({
        part: String(partId),
        page: String(transactionPage.value),
        page_size: String(transactionPageSize.value),
      });
      const result = await deps.request<PageResult<SpareTransaction> | SpareTransaction[]>(
        `/spare-transactions/?${params.toString()}`,
      );
      transactionRows.value = pageItems(result);
      transactionCount.value = pageTotal(result);
    } catch (error) {
      transactionError.value = error instanceof Error ? error.message : "库存流水加载失败";
      transactionRows.value = [];
      transactionCount.value = 0;
    } finally {
      transactionLoading.value = false;
    }
  }
  function changeTransactionPage(page: number, partId: number) {
    transactionPage.value = page;
    void loadTransactions(partId);
  }
  function changeTransactionPageSize(size: number, partId: number) {
    transactionPageSize.value = size;
    transactionPage.value = 1;
    void loadTransactions(partId);
  }
  function changeSpareStockPage(page: number) { spareStockPage.value = Math.max(1, page); void loadSpareData(); }
  function changeSpareStockPageSize(size: number) { spareStockPageSize.value = size; spareStockPage.value = 1; void loadSpareData(); }
  function changeSpareTransactionPage(page: number) { spareTransactionPage.value = Math.max(1, page); void loadSpareData(); }
  function changeSpareTransactionPageSize(size: number) { spareTransactionPageSize.value = size; spareTransactionPage.value = 1; void loadSpareData(); }
  function openSparePartModal(part?: SparePart) {
    editingSparePart.value = part || null;
    sparePartForm.value = part
      ? { name: part.name, part_type: part.part_type, brand: part.brand ? String(part.brand) : "", model: part.model || "", specification: part.specification || "", unit: part.unit || "件", is_active: part.is_active, notes: part.notes || "" }
      : { name: "", part_type: "other", brand: "", model: "", specification: "", unit: "件", is_active: true, notes: "" };
    showSparePartModal.value = true;
  }
  async function saveSparePart() {
    try {
      const path = editingSparePart.value ? `/spare-parts/${editingSparePart.value.id}/` : "/spare-parts/";
      await deps.request(path, { method: editingSparePart.value ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...sparePartForm.value, brand: sparePartForm.value.brand ? Number(sparePartForm.value.brand) : null }) });
      showSparePartModal.value = false;
      deps.actionMessage.value = "备件已保存";
      await loadSpareData();
    } catch (error) { deps.actionMessage.value = error instanceof Error ? error.message : "备件保存失败"; }
  }
  async function toggleSparePart(part: SparePart) {
    try {
      await deps.request(`/spare-parts/${part.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !part.is_active }) });
      deps.actionMessage.value = part.is_active ? "备件已停用" : "备件已启用";
      await loadSpareData();
    } catch (error) { deps.actionMessage.value = error instanceof Error ? error.message : "备件状态更新失败"; }
  }
  async function deleteSparePart(part: SparePart) {
    if (!(await deps.confirmAction(`确定删除备件“${part.name}”吗？`))) return;
    try {
      await deps.request(`/spare-parts/${part.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "备件已删除";
      if (spareSelectedPart.value?.id === part.id) spareSelectedPart.value = null;
      await loadSpareData();
    } catch (error) { deps.actionMessage.value = error instanceof Error ? error.message : "备件删除失败"; }
  }
  function openSpareOperation(part: SparePart, operationType = "inbound", location?: SpareOperationLocation) {
    spareOperationType.value = operationType;
    let remembered: Partial<SpareOperationLocation> | null = null;
    if (!location) {
      try { remembered = JSON.parse(localStorage.getItem("itam.spare.last_location") || "null") as Partial<SpareOperationLocation> | null; } catch { remembered = null; }
    }
    const rememberedCenter = remembered?.data_center ? deps.dataCenters.value.find((center) => center.is_active && center.id === Number(remembered?.data_center)) : null;
    const rememberedRoom = rememberedCenter && remembered?.server_room ? spareRooms.value.find((room) => room.is_active && room.id === Number(remembered?.server_room) && room.data_center === rememberedCenter.id) : null;
    const preset = location || (rememberedCenter && (!remembered?.server_room || rememberedRoom) ? { data_center: rememberedCenter.id, server_room: rememberedRoom?.id || null, quantity: 0, label: "最近使用地点" } : undefined);
    spareOperationForm.value = {
      part: String(part.id), quantity: "1", target_quantity: "",
      source_data_center: preset && ["outbound", "transfer", "scrap"].includes(operationType) ? String(preset.data_center) : "",
      source_server_room: preset && ["outbound", "transfer", "scrap"].includes(operationType) && preset.server_room ? String(preset.server_room) : "",
      target_data_center: preset && ["inbound", "transfer", "adjustment"].includes(operationType) ? String(preset.data_center) : "",
      target_server_room: preset && ["inbound", "transfer", "adjustment"].includes(operationType) && preset.server_room ? String(preset.server_room) : "",
      reference: "", notes: "",
    };
    spareOperationCurrentQuantity.value = location ? location.quantity : null;
    spareOperationLocationLabel.value = location?.label || "";
    spareOperationLocationLocked.value = Boolean(location);
    showSpareOperationModal.value = true;
  }
  async function saveSpareOperation(): Promise<boolean> {
    spareOperationSaving.value = true;
    try {
      const operation = spareOperationType.value;
      const form = spareOperationForm.value;
      const payload: Record<string, unknown> = { part: Number(form.part), operation_type: operation, quantity: Number(form.quantity || 0), reference: form.reference, notes: form.notes };
      if (["inbound", "transfer", "adjustment"].includes(operation)) { payload.target_data_center = Number(form.target_data_center); payload.target_server_room = form.target_server_room ? Number(form.target_server_room) : null; }
      if (["outbound", "transfer", "scrap"].includes(operation)) { payload.source_data_center = Number(form.source_data_center); payload.source_server_room = form.source_server_room ? Number(form.source_server_room) : null; }
      if (operation === "adjustment") payload.target_quantity = Number(form.target_quantity || 0);
      await deps.request("/spare-transactions/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const locationDataCenter = ["outbound", "transfer", "scrap"].includes(operation) ? form.source_data_center : form.target_data_center;
      const locationServerRoom = ["outbound", "transfer", "scrap"].includes(operation) ? form.source_server_room : form.target_server_room;
      if (locationDataCenter) localStorage.setItem("itam.spare.last_location", JSON.stringify({ data_center: Number(locationDataCenter), server_room: locationServerRoom ? Number(locationServerRoom) : null }));
      showSpareOperationModal.value = false;
      deps.actionMessage.value = "库存流水已登记";
      try { await refreshSparePart(Number(form.part)); } catch { deps.actionMessage.value = "库存流水已登记，但备件余额刷新失败，请重新加载页面"; }
      return true;
    } catch (error) { deps.actionMessage.value = error instanceof Error ? error.message : "库存操作失败"; return false; }
    finally { spareOperationSaving.value = false; }
  }
  function spareOperationLabel(operation: string) {
    return ({ inbound: "入库", outbound: "出库", transfer: "调拨", adjustment: "盘点调整", scrap: "报废" } as Record<string, string>)[operation] || operation;
  }
  return {
    spareParts, spareStocks, spareTransactions, sparePartCount, spareStockCount, spareTransactionCount,
    sparePage, sparePageSize, spareStockPage, spareStockPageSize, spareTransactionPage, spareTransactionPageSize,
    spareRooms, spareSearch, spareType, spareActive, spareListDataCenter, spareListRoom, spareDataCenter, spareRoom,
    spareSelectedPart, sparePartForm, showSparePartModal, editingSparePart, spareOperationType, spareOperationForm,
    showSpareOperationModal, spareOperationSaving, spareOperationCurrentQuantity, spareOperationLocationLabel,
    spareOperationLocationLocked, spareTransactionFilters, loadSpareData, refreshSparePart, searchSpareParts,
    stockLocations, stockLoading, loadStockLocations, transactionRows, transactionCount,
    transactionPage, transactionPageSize, transactionLoading, transactionError, loadTransactions,
    changeTransactionPage, changeTransactionPageSize,
    changeSparePage, changeSparePageSize, selectSparePart, changeSpareStockPage, changeSpareStockPageSize,
    changeSpareTransactionPage, changeSpareTransactionPageSize, openSparePartModal, saveSparePart, toggleSparePart,
    deleteSparePart, openSpareOperation, saveSpareOperation, spareOperationLabel,
  };
}
