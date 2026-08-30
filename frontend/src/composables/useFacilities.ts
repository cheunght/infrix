import { computed, ref, type Ref } from "vue";
import { flattenError, isAbortError } from "../api";
import type {
  AssetDetail,
  DataCenter,
  FacilitySummary,
  Page,
  Rack,
  RackFormState,
  RackStatus,
  ServerRoom,
} from "../types";
import type {
  LocationStatusFilter,
  LocationTypeFilter,
  RackSection,
} from "../router";
import type { CapabilityFn, RequestFn } from "../types/page-context";
import { i18n } from "../i18n";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

export interface FacilitiesApi {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  download: (path: string, filename?: string) => Promise<void>;
}

export interface FacilitiesDeps extends FacilitiesApi {
  can: CapabilityFn;
  page: Ref<Page>;
  rackSection: Ref<RackSection>;
  showAssetDetail: Ref<boolean>;
  detailAsset: Ref<AssetDetail | null>;
  viewportHeight: Ref<number>;
  actionMessage: Ref<string>;
  closeAssetDetail: () => void;
  openRackAssetDetail: (assetId: number, rackId: number) => void | Promise<void>;
  reload: () => void | Promise<void>;
  confirmAction: (message: string) => Promise<boolean>;
  clearRouteQuery?: (keys: string[]) => boolean;
  updateRouteQuery?: (updates: Record<string, string | undefined>) => boolean;
}

export function useFacilities(deps: FacilitiesDeps) {
  const dataCenters = ref<DataCenter[]>([]);
  const serverRooms = ref<ServerRoom[]>([]);
  const racks = ref<Rack[]>([]);
  const facilitySummary = ref<FacilitySummary | null>(null);
  const locationManagementLoading = ref(false);
  const locationManagementError = ref("");
  const locationManagementRequestId = ref(0);
  const locationSearch = ref("");
  const locationType = ref<LocationTypeFilter>("");
  const locationStatus = ref<LocationStatusFilter>("");
  const locationDataCenter = ref("");
  const dataCenterActionId = ref<number | null>(null);
  const rackListLoading = ref(false);
  const rackCanvasLoading = ref(false);
  const rackListError = ref("");
  const rackCanvasError = ref("");
  const rackViewRequestId = ref(0);
  const selectedDataCenter = ref("");
  const selectedRoom = ref("");
  const selectedRack = ref("");
  const selectedRackDeviceTypeId = ref("");
  const focusedRackId = ref<number | null>(null);
  const rackCount = ref(0);
  const rackPage = ref(1);
  const rackPageSize = ref(8);

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

  async function loadDataCenters(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("racks.view")) return false;
    try {
      const result = await deps.request<{ results?: DataCenter[]; count?: number } | DataCenter[]>(
        "/data-centers/?page_size=100",
      );
      if (deps.isCurrentLoad(version)) {
        dataCenters.value = Array.isArray(result) ? result : result?.results || [];
      }
      return deps.isCurrentLoad(version);
    } catch (error) {
      if (!isAbortError(error)) throw error;
      return false;
    }
  }

  type PagedPayload<T> = {
    results?: T[];
    count?: number;
    next?: string | null;
  } | T[];

  async function loadAllPages<T>(basePath: string, version: number): Promise<T[]> {
    const rows: T[] = [];
    let pageNumber = 1;
    while (deps.isCurrentLoad(version)) {
      const separator = basePath.includes("?") ? "&" : "?";
      const result = await deps.request<PagedPayload<T>>(
        `${basePath}${separator}page=${pageNumber}`,
      );
      if (!deps.isCurrentLoad(version)) return rows;
      if (Array.isArray(result)) {
        rows.push(...result);
        return rows;
      }
      const pageRows = result.results || [];
      rows.push(...pageRows);
      const total = typeof result.count === "number" ? result.count : null;
      const hasMore = result.next !== undefined
        ? Boolean(result.next)
        : total !== null && rows.length < total;
      if (!pageRows.length || !hasMore) return rows;
      pageNumber += 1;
    }
    return rows;
  }

  async function loadLocationManagement(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("racks.view")) return false;
    const requestId = ++locationManagementRequestId.value;
    if (deps.isCurrentLoad(version)) {
      locationManagementLoading.value = true;
      locationManagementError.value = "";
    }
    const [dataCentersResult, roomsResult, summaryResult] = await Promise.allSettled([
      loadAllPages<DataCenter>("/data-centers/?page_size=100&is_active=all", version),
      loadAllPages<ServerRoom>("/server-rooms/?page_size=100&is_active=all", version),
      deps.request<FacilitySummary>("/facilities/summary/"),
    ]);
    if (!deps.isCurrentLoad(version) || requestId !== locationManagementRequestId.value) return true;

    const dataCenterError = dataCentersResult.status === "rejected"
      ? requestErrorMessage(dataCentersResult.reason, tr("facility.dataCenterLoadFailed"))
      : "";
    const roomError = roomsResult.status === "rejected"
      ? requestErrorMessage(roomsResult.reason, tr("facility.roomLoadFailed"))
      : "";
    if (dataCentersResult.status === "fulfilled") dataCenters.value = dataCentersResult.value;
    if (roomsResult.status === "fulfilled") serverRooms.value = roomsResult.value;
    if (summaryResult.status === "fulfilled") facilitySummary.value = summaryResult.value;
    // Capacity is optional enrichment: a summary failure must not hide the
    // real DataCenter/Room rows or turn a successful list load into an error.
    locationManagementError.value = dataCenterError || roomError;
    locationManagementLoading.value = false;
    return !locationManagementError.value;
  }

  function requestErrorMessage(error: unknown, fallback: string) {
    if (isAbortError(error)) return "";
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function loadServerRooms(version = deps.beginLoad()) {
    if (!deps.can("racks.view")) return false;
    try {
      const params = new URLSearchParams({ page_size: "100", is_active: "true" });
      if (selectedDataCenter.value) params.set("data_center", selectedDataCenter.value);
      const result = await deps.request<{ results?: ServerRoom[] } | ServerRoom[]>(
        `/server-rooms/?${params.toString()}`,
      );
      if (deps.isCurrentLoad(version)) {
        serverRooms.value = Array.isArray(result) ? result : result?.results || [];
      }
    } catch (error) {
      if (!isAbortError(error)) throw error;
    }
  }

  // Asset forms still need the active room/rack relations. Keep this focused
  // auxiliary loader separate from the locations page so opening an asset form
  // does not couple it to the locations tree's presentation filters.
  async function loadRackManagement(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("racks.view")) return false;
    const [roomsResult, racksResult] = await Promise.allSettled([
      loadServerRooms(version),
      deps.request<{ results?: Rack[] } | Rack[]>("/racks/?page_size=100&is_active=true"),
    ]);
    if (!deps.isCurrentLoad(version)) return true;
    if (roomsResult.status === "rejected" && !isAbortError(roomsResult.reason)) {
      throw roomsResult.reason;
    }
    if (racksResult.status === "rejected") {
      if (isAbortError(racksResult.reason)) return false;
      throw racksResult.reason;
    }
    racks.value = Array.isArray(racksResult.value)
      ? racksResult.value
      : racksResult.value?.results || [];
    return true;
  }

  function rackListPath(pageNumber: number) {
    const params = new URLSearchParams({
      page: String(pageNumber),
      page_size: String(rackPageSize.value),
    });
    if (selectedDataCenter.value) params.set("room__data_center", selectedDataCenter.value);
    if (selectedRoom.value) params.set("room", selectedRoom.value);
    if (selectedRack.value) params.set("search", selectedRack.value);
    if (selectedRackDeviceTypeId.value) params.set("device_type", selectedRackDeviceTypeId.value);
    return `/racks/?${params.toString()}`;
  }

  async function requestRackPage(pageNumber: number) {
    const result = await deps.request<{ results?: Rack[]; count?: number } | Rack[]>(
      rackListPath(pageNumber),
    );
    return {
      rows: Array.isArray(result) ? result : result?.results || [],
      count: Array.isArray(result) ? result.length : Number(result?.count || 0),
    };
  }

  async function loadRackView(version = deps.beginLoad()) {
    if (!deps.can("racks.view")) return false;
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
      const result = await requestRackPage(rackPage.value);
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value) return;
      racks.value = result.rows;
      rackCount.value = result.count;
      const lastPage = Math.max(1, Math.ceil(rackCount.value / rackPageSize.value));
      if (rackPage.value > lastPage) {
        rackPage.value = lastPage;
        return loadRackView(version);
      }
      focusedRackId.value = racks.value.find((rack) => rack.id === requestedFocusedRackId)?.id
        || racks.value[0]?.id
        || null;
    } catch (error) {
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value || isAbortError(error)) return;
      const message = error instanceof Error && error.message
        ? error.message
        : tr("facility.rackLoadFailed");
      rackListError.value = message;
      rackCanvasError.value = message;
    } finally {
      if (deps.isCurrentLoad(version) && requestId === rackViewRequestId.value) {
        rackListLoading.value = false;
        rackCanvasLoading.value = false;
      }
    }
  }

  async function loadRackPage(pageNumber: number) {
    if (!deps.can("racks.view")) return;
    const nextPage = Math.min(
      Math.max(pageNumber, 1),
      Math.max(1, Math.ceil(rackCount.value / rackPageSize.value)),
    );
    if (nextPage === rackPage.value) return;

    rackPage.value = nextPage;
    const version = deps.beginLoad();
    const requestId = ++rackViewRequestId.value;
    rackListLoading.value = true;
    rackListError.value = "";
    let pageToLoad = nextPage;

    try {
      while (true) {
        const result = await requestRackPage(pageToLoad);
        if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value) return;
        const lastPage = Math.max(1, Math.ceil(result.count / rackPageSize.value));
        if (pageToLoad > lastPage) {
          pageToLoad = lastPage;
          rackPage.value = pageToLoad;
          continue;
        }
        rackPage.value = pageToLoad;
        racks.value = result.rows;
        rackCount.value = result.count;
        return;
      }
    } catch (error) {
      if (!deps.isCurrentLoad(version) || requestId !== rackViewRequestId.value || isAbortError(error)) return;
      rackListError.value = error instanceof Error && error.message
        ? error.message
        : tr("facility.rackLoadFailed");
    } finally {
      if (deps.isCurrentLoad(version) && requestId === rackViewRequestId.value) {
        rackListLoading.value = false;
      }
    }
  }

  function retryRackView() {
    void deps.reload();
  }

  function openDataCenterModal(dataCenter?: DataCenter) {
    if (!deps.can("racks.manage")) return;
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

  async function refreshLocationManagement(): Promise<boolean> {
    const version = deps.beginLoad();
    return loadLocationManagement(version);
  }

  async function saveDataCenter() {
    if (!deps.can("racks.manage")) return;
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
      deps.actionMessage.value = tr("facility.dataCenterSaved");
      try {
        if (!(await refreshLocationManagement())) throw new Error(tr("common.retryLater"));
      } catch (refreshError) {
        deps.actionMessage.value = `${tr("facility.dataCenterSavedRefreshFailed")}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
      }
    } catch (error) {
      dataCenterFormErrors.value = extractFormErrors(error, ["name", "address", "is_active"]);
      deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.dataCenterSaveFailed");
    } finally {
      dataCenterSaving.value = false;
    }
  }

  function dataCenterHasAssociations(dataCenter: DataCenter) {
    return Boolean(dataCenter.rooms_count || dataCenter.assets_count);
  }

  async function updateDataCenterStatus(dataCenter: DataCenter, isActive: boolean) {
    if (!deps.can("racks.manage")) return;
    if (dataCenterActionId.value === dataCenter.id || dataCenter.is_active === isActive) return;
    dataCenterActionId.value = dataCenter.id;
    try {
      try {
        await deps.request(`/data-centers/${dataCenter.id}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: isActive }),
        });
      } catch (error) {
        deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.dataCenterStatusFailed");
        return;
      }
      const successMessage = isActive ? tr("facility.dataCenterEnabled") : tr("facility.dataCenterDisabled");
      deps.actionMessage.value = successMessage;
      try {
        if (!(await refreshLocationManagement())) throw new Error(tr("common.retryLater"));
      } catch (refreshError) {
        deps.actionMessage.value = `${successMessage}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
      }
    } finally {
      dataCenterActionId.value = null;
    }
  }

  async function deleteDataCenter(dataCenter: DataCenter) {
    if (!deps.can("racks.manage")) return;
    if (dataCenterHasAssociations(dataCenter)) {
      deps.actionMessage.value = tr("facility.dataCenterHasAssociations");
      return;
    }
    if (dataCenterActionId.value === dataCenter.id) return;
    if (!(await deps.confirmAction(tr("facility.dataCenterDeleteConfirm", { name: dataCenter.name })))) return;
    dataCenterActionId.value = dataCenter.id;
    try {
      try {
        await deps.request(`/data-centers/${dataCenter.id}/`, { method: "DELETE" });
      } catch (error) {
        deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.dataCenterDeleteFailed");
        return;
      }
      const successMessage = tr("facility.dataCenterDeleted");
      deps.actionMessage.value = successMessage;
      try {
        if (!(await refreshLocationManagement())) throw new Error(tr("common.retryLater"));
      } catch (refreshError) {
        deps.actionMessage.value = `${successMessage}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
      }
    } finally {
      dataCenterActionId.value = null;
    }
  }

  function openRoomModal(room?: ServerRoom, dataCenterId?: number) {
    if (!deps.can("racks.manage")) return;
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
          data_center: dataCenterId ? String(dataCenterId) : "",
          name: "",
          owner_name: "",
          contact_phone: "",
          notes: "",
          is_active: true,
        };
    showRoomModal.value = true;
  }

  async function saveRoom() {
    if (!deps.can("racks.manage")) return;
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
      deps.actionMessage.value = tr("facility.roomSaved");
      try {
        if (!(await refreshLocationManagement())) throw new Error(tr("facility.resourceRefreshFailed"));
      } catch (refreshError) {
        deps.actionMessage.value = `${tr("facility.roomSavedRefreshFailed")}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
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
      deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.roomSaveFailed");
    } finally {
      roomSaving.value = false;
    }
  }

  async function updateRoomStatus(room: ServerRoom, isActive: boolean) {
    if (!deps.can("racks.manage")) return;
    if (updatingRoomId.value === room.id || room.is_active === isActive) return;
    updatingRoomId.value = room.id;
    try {
      await deps.request(`/server-rooms/${room.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: isActive }),
      });
      deps.actionMessage.value = isActive ? tr("facility.roomEnabled") : tr("facility.roomDisabled");
      try {
        if (!(await refreshLocationManagement())) throw new Error(tr("facility.resourceRefreshFailed"));
      } catch (refreshError) {
        deps.actionMessage.value = `${isActive ? tr("facility.roomEnabled") : tr("facility.roomDisabled")}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
      }
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.roomStatusFailed");
    } finally {
      updatingRoomId.value = null;
    }
  }

  async function deleteRoom(room: ServerRoom) {
    if (!deps.can("racks.manage")) return;
    if (room.racks_count || room.assets_count) {
      deps.actionMessage.value = tr("facility.roomHasAssociations");
      return;
    }
    if (!(await deps.confirmAction(tr("facility.roomDeleteConfirm", { name: room.name })))) return;
    try {
      await deps.request(`/server-rooms/${room.id}/`, { method: "DELETE" });
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.roomDeleteFailed");
      return;
    }
    const successMessage = tr("facility.roomDeleted");
    deps.actionMessage.value = successMessage;
    try {
      if (!(await refreshLocationManagement())) throw new Error(tr("common.retryLater"));
    } catch (refreshError) {
      deps.actionMessage.value = `${successMessage}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
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
    if (!deps.can("racks.manage")) return;
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
        general.push(`${field}: ${message}`);
      }
    }
    return { fields, message: general.join("；") || candidate.message || tr("facility.rackSaveFailed") };
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
    if (!(await refreshLocationManagement())) throw new Error(tr("facility.resourceRefreshFailed"));
  }

  async function saveRack() {
    if (!deps.can("racks.manage")) return;
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
      deps.actionMessage.value = tr("facility.rackSaved");
      try {
        await refreshRackDataAfterMutation();
      } catch (refreshError) {
        deps.actionMessage.value = `${tr("facility.rackSavedRefreshFailed")}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
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
    if (!deps.can("racks.manage")) return;
    if (updatingRackId.value === rack.id || rack.status === status) return;
    if (status !== "in_use" && rack.allocations.length) {
      const statusLabel = status === "reserved" ? tr("status.reserved") : tr("status.disabled");
      if (!(await deps.confirmAction(tr("facility.rackStatusConfirm", { code: rack.code, count: rack.allocations.length, status: statusLabel })))) return;
    }
    updatingRackId.value = rack.id;
    try {
      await deps.request(`/racks/${rack.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      deps.actionMessage.value = tr("facility.rackStatusUpdated");
      try {
        await refreshRackDataAfterMutation();
      } catch (refreshError) {
        deps.actionMessage.value = `${tr("facility.rackStatusRefreshFailed")}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
      }
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.rackStatusFailed");
    } finally {
      updatingRackId.value = null;
    }
  }

  async function deleteRack(rack: Rack) {
    if (!deps.can("racks.manage")) return;
    if (deletingRackId.value === rack.id) return;
    const roomLabel = `${rack.data_center_name || tr("common.unknownDataCenter")} / ${rack.server_room_name || tr("common.unknownRoom")}`;
    if (!(await deps.confirmAction(tr("facility.rackDeleteConfirm", { code: rack.code, location: roomLabel })))) return;
    deletingRackId.value = rack.id;
    try {
      await deps.request(`/racks/${rack.id}/`, { method: "DELETE" });
      if (focusedRackId.value === rack.id) clearRackSelection();
      if (selectedRack.value === rack.code) selectedRack.value = "";
      deps.actionMessage.value = tr("facility.rackDeleted");
      try {
        await refreshRackDataAfterMutation();
      } catch (refreshError) {
        deps.actionMessage.value = `${tr("facility.rackDeletedRefreshFailed")}: ${refreshError instanceof Error ? refreshError.message : tr("common.retryLater")}`;
      }
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.rackDeleteFailed");
    } finally {
      deletingRackId.value = null;
    }
  }

  async function exportRackLayout() {
    if (!deps.can("racks.export")) return;
    try {
      await deps.download("/reports/racks/export/", "rack-layout.xlsx");
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : tr("facility.rackLayoutExportFailed");
    }
  }

  function changeLocationSearch() {
    if (deps.updateRouteQuery?.({ search: locationSearch.value.trim() || undefined })) return;
    void deps.reload();
  }

  function changeLocationType(value: string) {
    if (!(value === "" || value === "data-center" || value === "room")) return;
    locationType.value = value;
    if (deps.updateRouteQuery?.({ type: value || undefined })) return;
    void deps.reload();
  }

  function changeLocationStatus(value: string) {
    if (!(value === "" || value === "active" || value === "inactive")) return;
    locationStatus.value = value;
    if (deps.updateRouteQuery?.({ status: value || undefined })) return;
    void deps.reload();
  }

  function changeLocationDataCenter() {
    if (deps.updateRouteQuery?.({ data_center: locationDataCenter.value || undefined })) return;
    void deps.reload();
  }

  function resetLocationFilters() {
    locationSearch.value = "";
    locationType.value = "";
    locationStatus.value = "";
    locationDataCenter.value = "";
    if (deps.clearRouteQuery?.(["search", "type", "status", "data_center"])) return;
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
  const hasRackFilters = computed(() => Boolean(
    selectedDataCenter.value || selectedRoom.value || selectedRack.value || selectedRackDeviceTypeId.value,
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

  function rackUnitHeight(_rack: Rack) {
    return deps.viewportHeight.value < 720 ? 18 : 20;
  }
  function rackBodyStyle(rack: Rack) {
    const unitHeight = rackUnitHeight(rack);
    return {
      height: `${rack.total_u * unitHeight}px`,
      "--rack-total-u": String(rack.total_u),
      "--rack-u-height": `${unitHeight}px`,
    };
  }
  function rackAllocationStyle(rack: Rack, allocation: Rack["allocations"][number]) {
    return {
      "grid-row": `${rack.total_u - allocation.end_u + 1} / span ${allocation.units}`,
      "--rack-device-color": allocation.device_type_color || "#64748b",
    };
  }
  function rackUsedU(rack: Rack) {
    if (rack.used_u != null) return rack.used_u;
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
    selectedRackDeviceTypeId.value = "";
    clearRackSelection();
    rackPage.value = 1;
    if (deps.updateRouteQuery?.({
      data_center: selectedDataCenter.value || undefined,
      room: undefined,
      rack: undefined,
      rack_code: undefined,
      device_type: undefined,
    })) return;
    void deps.reload();
  }
  function changeRackFilter() {
    clearRackSelection();
    rackPage.value = 1;
    if (deps.updateRouteQuery?.({
      data_center: selectedDataCenter.value || undefined,
      room: selectedRoom.value || undefined,
      rack: undefined,
      rack_code: selectedRack.value.trim() || undefined,
      device_type: selectedRackDeviceTypeId.value || undefined,
    })) return;
    void deps.reload();
  }
  function resetRackFilters() {
    selectedDataCenter.value = "";
    selectedRoom.value = "";
    selectedRack.value = "";
    selectedRackDeviceTypeId.value = "";
    clearRackSelection();
    rackPage.value = 1;
    if (deps.clearRouteQuery?.(["data_center", "room", "rack", "rack_code", "device_type"])) return;
    void deps.reload();
  }
  function changeRackPage(pageNumber: number) {
    const nextPage = Math.min(Math.max(pageNumber, 1), Math.max(1, Math.ceil(rackCount.value / rackPageSize.value)));
    if (nextPage === rackPage.value) return;
    void loadRackPage(nextPage);
  }

  return {
    dataCenters,
    serverRooms,
    racks,
    facilitySummary,
    locationSearch,
    locationType,
    locationStatus,
    locationDataCenter,
    locationManagementLoading,
    locationManagementError,
    dataCenterActionId,
    loadLocationManagement,
    retryLocationManagement: () => void deps.reload(),
    changeLocationSearch,
    changeLocationType,
    changeLocationStatus,
    changeLocationDataCenter,
    resetLocationFilters,
    rackListLoading,
    rackCanvasLoading,
    rackListError,
    rackCanvasError,
    selectedDataCenter,
    selectedRoom,
    selectedRack,
    selectedRackDeviceTypeId,
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
    loadRackView,
    openDataCenterModal,
    saveDataCenter,
    updateDataCenterStatus,
    deleteDataCenter,
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
    hasRackFilters,
    focusedRack,
    rackDetailOpen,
    displayedRacks,
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
    changeRackFilter,
    resetRackFilters,
    changeRackPage,
  };
}
