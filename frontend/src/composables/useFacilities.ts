import { computed, ref, type ComputedRef, type Ref } from "vue";
import type {
  AssetDetail,
  DataCenter,
  DictionaryItem,
  FacilitySummary,
  Page,
  Rack,
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
    await loadServerRooms(version);
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
    if (!deps.isCurrentLoad(version)) return;
    racks.value = Array.isArray(result) ? result : result?.results || [];
    rackCount.value = Array.isArray(result) ? result.length : Number(result?.count || 0);
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
  function changeDataCenter() {
    selectedRoom.value = "";
    selectedRack.value = "";
    focusedRackId.value = null;
    deps.closeAssetDetail();
    rackPage.value = 1;
    void deps.reload();
  }
  function changeRoom() {
    selectedRack.value = "";
    focusedRackId.value = null;
    deps.closeAssetDetail();
    rackPage.value = 1;
    void deps.reload();
  }
  function changeRackFilter() {
    focusedRackId.value = null;
    deps.closeAssetDetail();
    rackPage.value = 1;
    void deps.reload();
  }
  function resetRackFilters() {
    selectedDataCenter.value = "";
    selectedRoom.value = "";
    selectedRack.value = "";
    selectedRackDeviceType.value = "";
    focusedRackId.value = null;
    deps.closeAssetDetail();
    rackPage.value = 1;
    void deps.reload();
  }
  function changeRackPage(pageNumber: number) {
    rackPage.value = Math.min(Math.max(pageNumber, 1), Math.max(1, Math.ceil(rackCount.value / rackPageSize.value)));
    void deps.reload();
  }

  return {
    dataCenters,
    serverRooms,
    racks,
    facilitySummary,
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
    loadDataCenters,
    loadRackManagement,
    loadServerRooms,
    loadRackView,
    openDataCenterModal,
    saveDataCenter,
    openRoomModal,
    saveRoom,
    deleteRoom,
    exportRackLayout,
    visibleRacks,
    roomOptions,
    rackOptions,
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
    changeDataCenter,
    changeRoom,
    changeRackFilter,
    resetRackFilters,
    changeRackPage,
  };
}
