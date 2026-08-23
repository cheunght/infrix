import { computed, ref, type ComputedRef, type Ref } from "vue";
import { flattenError } from "../api";
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
  refreshDictionaries: () => void | Promise<boolean | void>;
  reload: () => void | Promise<void>;
  confirmAction: (message: string) => Promise<boolean>;
}

export function useFacilities(deps: FacilitiesDeps) {
  const dataCenters = ref<DataCenter[]>([]);
  const serverRooms = ref<ServerRoom[]>([]);
  const racks = ref<Rack[]>([]);
  const facilitySummary = ref<FacilitySummary | null>(null);
  const rackManagementLoading = ref(false);
  const dataCenterManagementError = ref("");
  const roomManagementError = ref("");
  const rackManagementError = ref("");
  const rackManagementRequestId = ref(0);
  const roomManagementSearch = ref("");
  const roomManagementDataCenter = ref("");
  const roomManagementPage = ref(1);
  const roomManagementPageSize = ref(12);
  const roomManagementCount = ref(0);
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
  const dataCenterSaving = ref(false);
  const dataCenterFormErrors = ref<Record<string, string>>({});
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
  const roomSaving = ref(false);
  const roomFormErrors = ref<Record<string, string>>({});
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
  const updatingRoomId = ref<number | null>(null);

  function extractFormErrors(error: unknown, fields: readonly string[]) {
    const details = error && typeof error === "object" && "details" in error
      ? (error as { details?: unknown }).details
      : undefined;
    const source = details && typeof details === "object" && !Array.isArray(details)
      ? details as Record<string, unknown>
      : {};
    return Object.fromEntries(
      fields
        .map((field) => [field, flattenError(source[field])] as const)
        .filter(([, message]) => Boolean(message)),
    );
  }

  async function loadDataCenters(version = deps.beginLoad()) {
    const result = await deps.request<{ results?: DataCenter[]; count?: number } | DataCenter[]>(
      "/data-centers/?page_size=100",
    );
    if (deps.isCurrentLoad(version)) {
      dataCenters.value = Array.isArray(result) ? result : result?.results || [];
    }
  }

  async function loadRackManagement(version = deps.beginLoad()): Promise<boolean> {
    const requestId = ++rackManagementRequestId.value;
    if (deps.isCurrentLoad(version)) {
      rackManagementLoading.value = true;
      dataCenterManagementError.value = "";
      roomManagementError.value = "";
      rackManagementError.value = "";
    }
    const roomParams = new URLSearchParams({
      page: String(roomManagementPage.value),
      page_size: String(roomManagementPageSize.value),
      is_active: "all",
    });
    if (roomManagementSearch.value.trim()) roomParams.set("search", roomManagementSearch.value.trim());
    if (roomManagementDataCenter.value) roomParams.set("data_center", roomManagementDataCenter.value);
    const [dataCenterResult, roomsResult, racksResult, summaryResult] = await Promise.allSettled([
      deps.request<{ results?: DataCenter[] } | DataCenter[]>("/data-centers/?page_size=100&is_active=all"),
      deps.request<{ results?: ServerRoom[]; count?: number } | ServerRoom[]>(`/server-rooms/?${roomParams.toString()}`),
      deps.request<{ results?: Rack[] } | Rack[]>("/racks/?page_size=100&is_active=all"),
      deps.request<FacilitySummary>("/facilities/summary/"),
    ]);
    if (!deps.isCurrentLoad(version) || requestId !== rackManagementRequestId.value) return true;

    if (dataCenterResult.status === "fulfilled") {
      dataCenters.value = Array.isArray(dataCenterResult.value)
        ? dataCenterResult.value
        : dataCenterResult.value?.results || [];
    } else {
      dataCenterManagementError.value = requestErrorMessage(dataCenterResult.reason, "数据中心加载失败，请稍后重试");
    }
    if (roomsResult.status === "fulfilled") {
      serverRooms.value = Array.isArray(roomsResult.value)
        ? roomsResult.value
        : roomsResult.value?.results || [];
      roomManagementCount.value = Array.isArray(roomsResult.value)
        ? roomsResult.value.length
        : Number(roomsResult.value?.count || 0);
      const lastRoomPage = Math.max(1, Math.ceil(roomManagementCount.value / roomManagementPageSize.value));
      if (roomManagementPage.value > lastRoomPage) {
        roomManagementPage.value = lastRoomPage;
        return loadRackManagement(version);
      }
    } else {
      roomManagementError.value = requestErrorMessage(roomsResult.reason, "机房加载失败，请稍后重试");
    }
    if (racksResult.status === "fulfilled") {
      racks.value = Array.isArray(racksResult.value)
        ? racksResult.value
        : racksResult.value?.results || [];
    } else {
      rackManagementError.value = requestErrorMessage(racksResult.reason, "机柜加载失败，请稍后重试");
    }
    if (summaryResult.status === "fulfilled") facilitySummary.value = summaryResult.value;
    rackManagementLoading.value = false;
    return !dataCenterManagementError.value && !roomManagementError.value && !rackManagementError.value;
  }

  function requestErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
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
    const requestedFocusedRackId = focusedRackId.value;
    if (deps.isCurrentLoad(version)) {
      rackListLoading.value = true;
      rackCanvasLoading.value = true;
      rackListError.value = "";
      rackCanvasError.value = "";
      racks.value = [];
      rackCount.value = 0;
      clearRackSelection();
    }
    try {
      await loadServerRooms(version);
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value) return;
      const selectedRoomExists = serverRooms.value.some((room) => String(room.id) === selectedRoom.value && room.is_active);
      if (selectedRoom.value && !selectedRoomExists) selectedRoom.value = "";
      const params = new URLSearchParams({
        page: String(rackPage.value),
        page_size: String(rackPageSize.value),
      });
      if (selectedRoom.value) params.set("room", selectedRoom.value);
      if (selectedRack.value) params.set("search", selectedRack.value);
      if (selectedRackDeviceType.value) params.set("device_type", selectedRackDeviceType.value);
      const result = await deps.request<{ results?: Rack[]; count?: number } | Rack[]>(
        `/racks/?${params.toString()}`,
      );
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value) return;
      racks.value = Array.isArray(result) ? result : result?.results || [];
      rackCount.value = Array.isArray(result) ? result.length : Number(result?.count || 0);
      focusedRackId.value = racks.value.find((rack) => rack.id === requestedFocusedRackId)?.id
        || racks.value[0]?.id
        || null;
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

  function retryRackManagement() {
    void deps.reload();
  }

  function openDataCenterModal(dataCenter?: DataCenter) {
    editingDataCenter.value = dataCenter || null;
    dataCenterFormErrors.value = {};
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
    if (dataCenterSaving.value) return;
    dataCenterSaving.value = true;
    dataCenterFormErrors.value = {};
    dataCenterForm.value.name = dataCenterForm.value.name.trim();
    dataCenterForm.value.address = dataCenterForm.value.address.trim();
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
      try {
        const dictionariesRefreshed = await deps.refreshDictionaries();
        if (dictionariesRefreshed === false) throw new Error("字典数据刷新失败");
        if (!(await loadRackManagement())) throw new Error("资源数据刷新失败");
      } catch (refreshError) {
        deps.actionMessage.value = "数据中心已保存，但页面刷新失败：" + (refreshError instanceof Error ? refreshError.message : "请稍后重试");
      }
    } catch (error) {
      dataCenterFormErrors.value = extractFormErrors(error, ["name", "address", "is_active"]);
      deps.actionMessage.value = error instanceof Error ? error.message : "数据中心保存失败";
    } finally {
      dataCenterSaving.value = false;
    }
  }

  function openRoomModal(room?: ServerRoom) {
    editingRoom.value = room || null;
    roomFormErrors.value = {};
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
    if (roomSaving.value) return;
    roomSaving.value = true;
    roomFormErrors.value = {};
    roomForm.value.data_center = roomForm.value.data_center.trim();
    roomForm.value.name = roomForm.value.name.trim();
    roomForm.value.owner_name = roomForm.value.owner_name.trim();
    roomForm.value.contact_phone = roomForm.value.contact_phone.trim();
    roomForm.value.notes = roomForm.value.notes.trim();
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
      try {
        if (!(await loadRackManagement())) throw new Error("资源数据刷新失败");
      } catch (refreshError) {
        deps.actionMessage.value = "机房已保存，但页面刷新失败：" + (refreshError instanceof Error ? refreshError.message : "请稍后重试");
      }
    } catch (error) {
      roomFormErrors.value = extractFormErrors(error, [
        "data_center",
        "name",
        "owner_name",
        "contact_phone",
        "notes",
        "is_active",
      ]);
      deps.actionMessage.value = error instanceof Error ? error.message : "机房保存失败";
    } finally {
      roomSaving.value = false;
    }
  }

  async function updateRoomStatus(room: ServerRoom, isActive: boolean) {
    if (updatingRoomId.value === room.id || room.is_active === isActive) return;
    updatingRoomId.value = room.id;
    try {
      await deps.request(`/server-rooms/${room.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: isActive }),
      });
      deps.actionMessage.value = isActive ? "机房已启用" : "机房已停用";
      try {
        if (!(await loadRackManagement())) throw new Error("资源数据刷新失败");
      } catch (refreshError) {
        deps.actionMessage.value = `${isActive ? "机房已启用" : "机房已停用"}，但页面刷新失败：${refreshError instanceof Error ? refreshError.message : "请稍后重试"}`;
      }
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "机房状态更新失败";
    } finally {
      updatingRoomId.value = null;
    }
  }

  async function deleteRoom(room: ServerRoom) {
    if (room.racks_count || room.assets_count) {
      deps.actionMessage.value = "请先迁移/移除关联资源后再删除";
      return;
    }
    if (!(await deps.confirmAction(`确定删除机房“${room.name}”吗？`))) return;
    try {
      await deps.request(`/server-rooms/${room.id}/`, { method: "DELETE" });
      if (!(await loadRackManagement())) throw new Error("资源数据刷新失败");
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
      const previousFocusedRackId = focusedRackId.value;
      await loadRackView();
      if (previousFocusedRackId && racks.value.some((rack) => rack.id === previousFocusedRackId)) {
        focusedRackId.value = previousFocusedRackId;
      }
      return;
    }
    if (!(await loadRackManagement())) throw new Error("资源数据刷新失败");
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

  function changeRoomManagementSearch() {
    roomManagementPage.value = 1;
    void deps.reload();
  }

  function changeRoomManagementDataCenter() {
    roomManagementPage.value = 1;
    void deps.reload();
  }

  function changeRoomManagementPage(pageNumber: number) {
    const nextPage = Math.min(
      Math.max(pageNumber, 1),
      Math.max(1, Math.ceil(roomManagementCount.value / roomManagementPageSize.value)),
    );
    if (nextPage === roomManagementPage.value) return;
    roomManagementPage.value = nextPage;
    void deps.reload();
  }

  function resetRoomManagementFilters() {
    roomManagementSearch.value = "";
    roomManagementDataCenter.value = "";
    roomManagementPage.value = 1;
    void deps.reload();
  }

  const visibleRacks = computed(() =>
    racks.value.filter(
      (rack) =>
        !selectedRoom.value || String(rack.room) === selectedRoom.value,
    ),
  );
  const roomOptions = computed(() =>
    serverRooms.value
      .filter(
        (room) =>
          room.is_active &&
          (!selectedDataCenter.value || String(room.data_center) === selectedDataCenter.value),
      )
      .map((room) => ({ id: String(room.id), name: room.name, data_center_name: room.data_center_name })),
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
    focusedRack.value ? [focusedRack.value] : [],
  );
  const rackViewTitle = computed(() =>
    focusedRack.value
      ? `${focusedRack.value.server_room_name || focusedRack.value.data_center_name || "机柜"} · 机柜 U 位视图`
      : "机柜 U 位视图",
  );
  const rackViewStyle = computed(() => {
    const unitHeight = deps.viewportHeight.value < 720 ? 13 : 14;
    return {
      "--rack-unit-height": `${unitHeight}px`,
    };
  });

  function rackUnitHeight(_rack: Rack) {
    return deps.viewportHeight.value < 720 ? 13 : 14;
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
    rackManagementLoading,
    dataCenterManagementError,
    roomManagementError,
    rackManagementError,
    roomManagementSearch,
    roomManagementDataCenter,
    roomManagementPage,
    roomManagementPageSize,
    roomManagementCount,
    changeRoomManagementSearch,
    changeRoomManagementDataCenter,
    changeRoomManagementPage,
    resetRoomManagementFilters,
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
    dataCenterSaving,
    dataCenterFormErrors,
    showRoomModal,
    editingRoom,
    roomForm,
    roomSaving,
    roomFormErrors,
    showRackModal,
    editingRack,
    rackForm,
    rackFormFieldErrors,
    rackSaving,
    deletingRackId,
    updatingRackId,
    updatingRoomId,
    loadDataCenters,
    loadRackManagement,
    loadServerRooms,
    loadRackView,
    openDataCenterModal,
    saveDataCenter,
    openRoomModal,
    saveRoom,
    deleteRoom,
    updateRoomStatus,
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
    retryRackManagement,
    changeDataCenter,
    changeRoom,
    changeRackFilter,
    resetRackFilters,
    changeRackPage,
  };
}
