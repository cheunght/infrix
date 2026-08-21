import { computed, ref, type ComputedRef, type Ref } from "vue";
import type {
  AssetDetail,
  DataCenter,
  DictionaryItem,
  FacilitySummary,
  Page,
  Rack,
  RackFormState,
  RackStatus,
  ServerRoom,
} from "../types";
import type { RackSection } from "../router";
import type { RequestFn } from "../types/page-context";

export interface FacilitiesApi {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  download: (path: string, filename?: string) => Promise<void>;
}

export interface FacilitiesDeps extends FacilitiesApi {
  page: Ref<Page>;
  rackSection: Ref<RackSection>;
  showAssetDetail: Ref<boolean>;
  detailAsset: Ref<AssetDetail | null>;
  viewportHeight: Ref<number>;
  actionMessage: Ref<string>;
  closeAssetDetail: () => void;
  openRackAssetDetail: (assetId: number, rackId: number) => void | Promise<void>;
  refreshDictionaries: () => void | Promise<void>;
  reload: () => void | Promise<void>;
  confirmAction: (message: string) => Promise<boolean>;
}

export function useFacilities(deps: FacilitiesDeps) {
  const dataCenters = ref<DataCenter[]>([]);
  const serverRooms = ref<ServerRoom[]>([]);
  const racks = ref<Rack[]>([]);
  const facilitySummary = ref<FacilitySummary | null>(null);
  const rackListLoading = ref(false);
  const rackCanvasLoading = ref(false);
  const rackListError = ref("");
  const rackCanvasError = ref("");
  const rackViewRequestId = ref(0);
  const selectedDataCenter = ref("");
  const selectedRoom = ref("");
  const selectedRack = ref("");
  const selectedRackDeviceType = ref("");
  const focusedRackId = ref<number | null>(null);
  const rackCount = ref(0);
  const rackPage = ref(1);
  const rackPageSize = ref(5);

  const showDataCenterModal = ref(false);
  const editingDataCenter = ref<DataCenter | null>(null);
  const dataCenterForm = ref({ name: "", address: "", is_active: true });
  const showRoomModal = ref(false);
  const editingRoom = ref<ServerRoom | null>(null);
  const roomForm = ref({
    data_center: "",
    name: "",
    owner_name: "",
    contact_phone: "",
    notes: "",
    is_active: true,
  });
  const showRackModal = ref(false);
  const editingRack = ref<Rack | null>(null);
  const rackForm = ref<RackFormState>({
    room: "",
    code: "",
    name: "",
    rack_type: "标准机柜",
    owner_name: "",
    notes: "",
    total_u: 45,
    status: "in_use",
  });
  const rackFormFieldErrors = ref<Record<string, string>>({});
  const rackSaving = ref(false);
  const deletingRackId = ref<number | null>(null);
  const updatingRackId = ref<number | null>(null);

  async function loadDataCenters(version = deps.beginLoad()) {
    const result = await deps.request<{ results?: DataCenter[]; count?: number } | DataCenter[]>(
      "/data-centers/?page_size=100",
    );
    if (deps.isCurrentLoad(version)) {
      dataCenters.value = Array.isArray(result) ? result : result?.results || [];
    }
  }

  async function loadRackManagement(version = deps.beginLoad()) {
    const [dataCenterResult, roomsResult, racksResult, summaryResult] = await Promise.all([
      deps.request<{ results?: DataCenter[] } | DataCenter[]>("/data-centers/?page_size=100&is_active=all"),
      deps.request<{ results?: ServerRoom[] } | ServerRoom[]>("/server-rooms/?page_size=100&is_active=all"),
      deps.request<{ results?: Rack[] } | Rack[]>("/racks/?page_size=100&is_active=all"),
      deps.request<FacilitySummary>("/facilities/summary/"),
    ]);
    if (!deps.isCurrentLoad(version)) return;
    dataCenters.value = Array.isArray(dataCenterResult) ? dataCenterResult : dataCenterResult?.results || [];
    serverRooms.value = Array.isArray(roomsResult) ? roomsResult : roomsResult?.results || [];
    racks.value = Array.isArray(racksResult) ? racksResult : racksResult?.results || [];
    facilitySummary.value = summaryResult;
  }

  async function loadServerRooms(version = deps.beginLoad()) {
    const params = new URLSearchParams({ page_size: "100", is_active: "true" });
    if (selectedDataCenter.value) params.set("data_center", selectedDataCenter.value);
    const result = await deps.request<{ results?: ServerRoom[] } | ServerRoom[]>(
      `/server-rooms/?${params.toString()}`,
    );
    if (deps.isCurrentLoad(version)) {
      serverRooms.value = Array.isArray(result) ? result : result?.results || [];
    }
  }

  async function loadRackView(version = deps.beginLoad()) {
    const requestId = ++rackViewRequestId.value;
    if (deps.isCurrentLoad(version)) {
      rackListLoading.value = true;
      rackCanvasLoading.value = true;
      rackListError.value = "";
      rackCanvasError.value = "";
    }
    try {
      await loadServerRooms(version);
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value) return;
      const params = new URLSearchParams({
        page: String(rackPage.value),
        page_size: String(rackPageSize.value),
      });
      if (selectedDataCenter.value) params.set("room__data_center", selectedDataCenter.value);
      if (selectedRoom.value) params.set("room", selectedRoom.value);
      if (selectedRack.value) params.set("code", selectedRack.value);
      if (selectedRackDeviceType.value) params.set("device_type", selectedRackDeviceType.value);
      const result = await deps.request<{ results?: Rack[]; count?: number } | Rack[]>(
        `/racks/?${params.toString()}`,
      );
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value) return;
      racks.value = Array.isArray(result) ? result : result?.results || [];
      rackCount.value = Array.isArray(result) ? result.length : Number(result?.count || 0);
    } catch (error) {
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value || isAbortError(error)) return;
      const message = error instanceof Error && error.message
        ? error.message
        : "机柜数据加载失败，请稍后重试";
      rackListError.value = message;
      rackCanvasError.value = message;
    } finally {
      if (deps.isCurrentLoad(version) && requestId === rackViewRequestId.value) {
        rackListLoading.value = false;
        rackCanvasLoading.value = false;
      }
    }
  }

  function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError"
      || error instanceof Error && error.name === "AbortError";
  }

  function retryRackView() {
    void deps.reload();
  }

  function openDataCenterModal(dataCenter?: DataCenter) {
    editingDataCenter.value = dataCenter || null;
    dataCenterForm.value = dataCenter
      ? {
          name: dataCenter.name,
          address: dataCenter.address || "",
          is_active: dataCenter.is_active !== false,
        }
      : { name: "", address: "", is_active: true };
    showDataCenterModal.value = true;
  }

  async function saveDataCenter() {
    try {
      const path = editingDataCenter.value
        ? `/data-centers/${editingDataCenter.value.id}/`
        : "/data-centers/";
      await deps.request(path, {
        method: editingDataCenter.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataCenterForm.value),
      });
      showDataCenterModal.value = false;
      deps.actionMessage.value = "数据中心已保存";
      await deps.refreshDictionaries();
      await loadRackManagement();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "数据中心保存失败";
    }
  }

  function openRoomModal(room?: ServerRoom) {
    editingRoom.value = room || null;
    roomForm.value = room
      ? {
          data_center: String(room.data_center),
          name: room.name,
          owner_name: room.owner_name || "",
          contact_phone: room.contact_phone || "",
          notes: room.notes || "",
          is_active: room.is_active,
        }
      : {
          data_center: "",
          name: "",
          owner_name: "",
          contact_phone: "",
          notes: "",
          is_active: true,
        };
    showRoomModal.value = true;
  }

  async function saveRoom() {
    try {
      const path = editingRoom.value
        ? `/server-rooms/${editingRoom.value.id}/`
        : "/server-rooms/";
      await deps.request(path, {
        method: editingRoom.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roomForm.value),
      });
      showRoomModal.value = false;
      deps.actionMessage.value = "机房已保存";
      await loadRackManagement();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "机房保存失败";
    }
  }

  async function deleteRoom(room: ServerRoom) {
    if (!(await deps.confirmAction(`确定删除机房“${room.name}”吗？`))) return;
    try {
      await deps.request(`/server-rooms/${room.id}/`, { method: "DELETE" });
      await loadRackManagement();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "删除失败";
    }
  }

  function clearRackFormErrors() {
    rackFormFieldErrors.value = {};
  }

  function rackFormDefaults(room?: ServerRoom): RackFormState {
    return {
      room: room ? String(room.id) : "",
      code: "",
      name: "",
      rack_type: "标准机柜",
      owner_name: "",
      notes: "",
      total_u: 45,
      status: "in_use",
    };
  }

  function openRackModal(rack?: Rack, room?: ServerRoom) {
    editingRack.value = rack || null;
    clearRackFormErrors();
    if (rack) {
      rackForm.value = {
        room: String(rack.room),
        code: rack.code || "",
        name: rack.name || "",
        rack_type: rack.rack_type || "标准机柜",
        owner_name: rack.owner_name || "",
        notes: rack.notes || "",
        total_u: Number(rack.total_u) || 45,
        status: (rack.status === "reserved" || rack.status === "disabled" ? rack.status : "in_use"),
      };
    } else {
      const currentRoom = room || serverRooms.value.find((item) => String(item.id) === selectedRoom.value);
      rackForm.value = rackFormDefaults(currentRoom);
    }
    showRackModal.value = true;
  }

  function errorText(value: unknown): string {
    if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join("；");
    if (value && typeof value === "object") return Object.values(value).map(errorText).filter(Boolean).join("；");
    return String(value ?? "");
  }

  function extractRackFormErrors(error: unknown) {
    const candidate = error && typeof error === "object"
      ? error as { details?: unknown; message?: string }
      : {};
    const details = candidate.details;
    const source = details && typeof details === "object" && !Array.isArray(details)
      ? details as Record<string, unknown>
      : {};
    const fields: Record<string, string> = {};
    const general: string[] = [];
    for (const [field, value] of Object.entries(source)) {
      const message = errorText(value);
      if (!message) continue;
      if (["room", "code", "name", "rack_type", "owner_name", "notes", "total_u", "status"].includes(field)) {
        fields[field] = message;
      } else if (field === "detail" || field === "non_field_errors") {
        general.push(message);
      } else {
        general.push(`${field}：${message}`);
      }
    }
    return { fields, message: general.join("；") || candidate.message || "机柜保存失败" };
  }

  async function refreshRackDataAfterMutation() {
    if (deps.page.value === "racks" && deps.rackSection.value === "view") {
      await loadRackView();
      return;
    }
    await loadRackManagement();
  }

  async function saveRack() {
    if (rackSaving.value) return;
    rackSaving.value = true;
    clearRackFormErrors();
    const form = rackForm.value;
    const payload = {
      room: Number(form.room),
      code: form.code.trim(),
      name: form.name.trim(),
      rack_type: form.rack_type.trim(),
      owner_name: form.owner_name.trim(),
      notes: form.notes.trim(),
      total_u: Number(form.total_u),
      status: form.status,
    };
    try {
      const path = editingRack.value ? `/racks/${editingRack.value.id}/` : "/racks/";
      await deps.request(path, {
        method: editingRack.value ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showRackModal.value = false;
      editingRack.value = null;
      deps.actionMessage.value = "机柜已保存";
      try {
        await refreshRackDataAfterMutation();
      } catch (refreshError) {
        deps.actionMessage.value = `机柜已保存，但页面刷新失败：${refreshError instanceof Error ? refreshError.message : "请稍后重试"}`;
      }
    } catch (error) {
      const parsed = extractRackFormErrors(error);
      rackFormFieldErrors.value = parsed.fields;
      deps.actionMessage.value = parsed.message;
    } finally {
      rackSaving.value = false;
    }
  }

  async function updateRackStatus(rack: Rack, status: RackStatus) {
    if (updatingRackId.value === rack.id || rack.status === status) return;
    if (status !== "in_use" && rack.allocations.length) {
      const statusLabel = status === "reserved" ? "预留" : "停用";
      if (!(await deps.confirmAction(`机柜“${rack.code}”已有 ${rack.allocations.length} 台设备，确定设为${statusLabel}吗？`))) return;
    }
    updatingRackId.value = rack.id;
    try {
      await deps.request(`/racks/${rack.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      deps.actionMessage.value = "机柜状态已更新";
      try {
        await refreshRackDataAfterMutation();
      } catch (refreshError) {
        deps.actionMessage.value = `机柜状态已更新，但页面刷新失败：${refreshError instanceof Error ? refreshError.message : "请稍后重试"}`;
      }
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "机柜状态更新失败";
    } finally {
      updatingRackId.value = null;
    }
  }

  async function deleteRack(rack: Rack) {
    if (deletingRackId.value === rack.id) return;
    const roomLabel = `${rack.data_center_name || "未知数据中心"} / ${rack.server_room_name || "未知机房"}`;
    if (!(await deps.confirmAction(`确定删除机柜“${rack.code}”吗？\n位置：${roomLabel}`))) return;
    deletingRackId.value = rack.id;
    try {
      await deps.request(`/racks/${rack.id}/`, { method: "DELETE" });
      if (focusedRackId.value === rack.id) clearRackSelection();
      if (selectedRack.value === rack.code) selectedRack.value = "";
      deps.actionMessage.value = "机柜已删除";
      try {
        await refreshRackDataAfterMutation();
      } catch (refreshError) {
        deps.actionMessage.value = `机柜已删除，但页面刷新失败：${refreshError instanceof Error ? refreshError.message : "请稍后重试"}`;
      }
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "机柜删除失败";
    } finally {
      deletingRackId.value = null;
    }
  }

  async function exportRackLayout() {
    try {
      await deps.download("/reports/racks/export/", "rack-layout.xlsx");
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "机柜放置图导出失败";
    }
  }

  const visibleRacks = computed(() =>
    racks.value.filter(
      (rack) =>
        (!selectedRoom.value || String(rack.room) === selectedRoom.value) &&
        (!selectedRack.value || rack.code === selectedRack.value) &&
        (!selectedRackDeviceType.value ||
          rack.allocations.some((item) => item.device_type_name === selectedRackDeviceType.value)),
    ),
  );
  const roomOptions = computed(() =>
    serverRooms.value
      .filter(
        (room) =>
          room.is_active &&
          (!selectedDataCenter.value || String(room.data_center) === selectedDataCenter.value),
      )
      .map((room) => ({ id: String(room.id), name: room.name })),
  );
  const rackOptions = computed(() =>
    racks.value
      .map((rack) => rack.code)
      .filter((code, index, all) => all.indexOf(code) === index)
      .sort(),
  );
  const hasRackFilters = computed(() => Boolean(
    selectedDataCenter.value || selectedRoom.value || selectedRack.value || selectedRackDeviceType.value,
  ));
  const focusedRack = computed(
    () =>
      visibleRacks.value.find((rack) => rack.id === focusedRackId.value) ||
      visibleRacks.value[0] ||
      null,
  );
  const rackDetailOpen = computed(
    () => deps.page.value === "racks" && deps.showAssetDetail.value,
  );
  const displayedRacks = computed(() =>
    rackDetailOpen.value && focusedRack.value ? [focusedRack.value] : visibleRacks.value,
  );
  const rackViewTitle = computed(() =>
    focusedRack.value
      ? `${focusedRack.value.server_room_name || focusedRack.value.data_center_name || "机柜"} · 机柜 U 位视图`
      : "机柜 U 位视图",
  );
  const rackViewStyle = computed(() => {
    const maximumUnits = Math.max(1, ...displayedRacks.value.map((rack) => rack.total_u));
    if (window.innerWidth <= 1000) return { "--rack-unit-height": "14px" };
    const availableHeight = Math.max(495, deps.viewportHeight.value - 307);
    return {
      "--rack-unit-height": `${Math.max(11, Math.min(19, Math.floor((availableHeight - 4) / maximumUnits)))}px`,
    };
  });

  function rackUnitHeight(rack: Rack) {
    if (window.innerWidth <= 1000) return 14;
    const availableHeight = Math.max(495, deps.viewportHeight.value - 307);
    return Math.max(11, Math.min(19, Math.floor((availableHeight - 4) / Math.max(rack.total_u, 1))));
  }
  function rackBodyHeight(rack: Rack) {
    return rack.total_u * rackUnitHeight(rack) + 4;
  }
  function rackBodyStyle(rack: Rack) {
    return { height: `${rackBodyHeight(rack)}px`, "--rack-unit-height": `${rackUnitHeight(rack)}px` };
  }
  function rackAllocationStyle(rack: Rack, allocation: Rack["allocations"][number]) {
    const unitHeight = rackUnitHeight(rack);
    return {
      top: `${(rack.total_u - allocation.end_u) * unitHeight + 2}px`,
      height: `${Math.max(unitHeight - 3, allocation.units * unitHeight - 3)}px`,
      background: allocation.device_type_color || "#1677EF",
    };
  }
  function rackUsedU(rack: Rack) {
    const allocations = [...rack.allocations].sort(
      (a, b) => a.start_u - b.start_u || a.end_u - b.end_u,
    );
    const occupied = allocations.reduce((sum, allocation) => sum + allocation.units, 0);
    const singleUnitGaps = allocations.slice(1).reduce((sum, allocation, index) => {
      const previous = allocations[index];
      return sum + (allocation.start_u - previous.end_u - 1 === 1 ? 1 : 0);
    }, 0);
    return Math.min(rack.total_u, occupied + singleUnitGaps);
  }
  function rackGapUnavailable(rack: Rack, u: number) {
    const allocations = [...rack.allocations].sort(
      (a, b) => a.start_u - b.start_u || a.end_u - b.end_u,
    );
    return allocations.slice(1).some((allocation, index) => {
      const previous = allocations[index];
      return allocation.start_u - previous.end_u - 1 === 1 && previous.end_u + 1 === u;
    });
  }
  function rackUtilization(rack: Rack) {
    return rack.total_u > 0 ? Math.round((rackUsedU(rack) / rack.total_u) * 100) : 0;
  }
  function rackUtilizationColor(rack: Rack) {
    const utilization = rackUtilization(rack);
    return utilization >= 90 ? "#DC2626" : utilization >= 80 ? "#D97706" : "#2864EB";
  }
  function focusRack(rack: Rack) {
    focusedRackId.value = rack.id;
    window.requestAnimationFrame(() => {
      document.getElementById(`rack-view-${rack.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });
  }
  function selectRack(rack: Rack) {
    if (rackDetailOpen.value && focusedRackId.value !== rack.id) deps.closeAssetDetail();
    focusRack(rack);
  }
  function clearRackSelection() {
    focusedRackId.value = null;
    deps.closeAssetDetail();
  }
  function changeDataCenter() {
    selectedRoom.value = "";
    selectedRack.value = "";
    clearRackSelection();
    rackPage.value = 1;
    void deps.reload();
  }
  function changeRoom() {
    selectedRack.value = "";
    clearRackSelection();
    rackPage.value = 1;
    void deps.reload();
  }
  function changeRackFilter() {
    clearRackSelection();
    rackPage.value = 1;
    void deps.reload();
  }
  function resetRackFilters() {
    selectedDataCenter.value = "";
    selectedRoom.value = "";
    selectedRack.value = "";
    selectedRackDeviceType.value = "";
    clearRackSelection();
    rackPage.value = 1;
    void deps.reload();
  }
  function changeRackPage(pageNumber: number) {
    const nextPage = Math.min(Math.max(pageNumber, 1), Math.max(1, Math.ceil(rackCount.value / rackPageSize.value)));
    if (nextPage === rackPage.value) return;
    clearRackSelection();
    rackPage.value = nextPage;
    void deps.reload();
  }

  return {
    dataCenters,
    serverRooms,
    racks,
    facilitySummary,
    rackListLoading,
    rackCanvasLoading,
    rackListError,
    rackCanvasError,
    selectedDataCenter,
    selectedRoom,
    selectedRack,
    selectedRackDeviceType,
    focusedRackId,
    rackCount,
    rackPage,
    rackPageSize,
    showDataCenterModal,
    editingDataCenter,
    dataCenterForm,
    showRoomModal,
    editingRoom,
    roomForm,
    showRackModal,
    editingRack,
    rackForm,
    rackFormFieldErrors,
    rackSaving,
    deletingRackId,
    updatingRackId,
    loadDataCenters,
    loadRackManagement,
    loadServerRooms,
    loadRackView,
    openDataCenterModal,
    saveDataCenter,
    openRoomModal,
    saveRoom,
    deleteRoom,
    openRackModal,
    saveRack,
    deleteRack,
    updateRackStatus,
    clearRackFormErrors,
    exportRackLayout,
    visibleRacks,
    roomOptions,
    rackOptions,
    hasRackFilters,
    focusedRack,
    rackDetailOpen,
    displayedRacks,
    rackViewTitle,
    rackViewStyle,
    rackUnitHeight,
    rackBodyHeight,
    rackBodyStyle,
    rackAllocationStyle,
    rackUsedU,
    rackGapUnavailable,
    rackUtilization,
    rackUtilizationColor,
    selectRack,
    clearRackSelection,
    retryRackView,
    changeDataCenter,
    changeRoom,
    changeRackFilter,
    resetRackFilters,
    changeRackPage,
  };
}
