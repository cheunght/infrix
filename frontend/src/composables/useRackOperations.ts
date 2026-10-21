import { computed, onBeforeUnmount, ref, watch, type InjectionKey } from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";
import { ElMessage } from "element-plus";
import type { Asset, AssetDetail, Rack, RackUnitReservation } from "../types";
import type { RackSharedContext } from "../page-context";
import { ApiError, isAbortError, pageItems, pageTotal } from "../api";
import { revisionHeaders } from "../revision";
import { i18n } from "../i18n";

export type RackOperationMode = "mount" | "adjust" | "move" | "unmount";
export type PositionRange = { start_u: number; end_u: number };
export type PlacementOptions = {
  total_u: number;
  data_center_id: number;
  server_room_id: number;
  occupancy_restricted: boolean;
  accepts_assets: boolean;
  available_ranges: PositionRange[] | null;
  gap_ranges: PositionRange[] | null;
  reserved_ranges?: PositionRange[] | null;
};
const tr = (key: string, args?: Record<string, unknown>) =>
  String(args ? i18n.global.t(key, args) : i18n.global.t(key));
export const RackOperationsKey: InjectionKey<RackOperations> =
  Symbol("rack-operations");

export function useRackOperations(
  c: RackSharedContext,
  route: RouteLocationNormalizedLoaded,
  router: Router,
) {
  const findOpen = ref(false),
    dialogOpen = ref(false),
    finding = ref(false),
    busy = ref(false),
    preparing = ref(false);
  const placementRevision = ref(0);
  const reservationId = ref<number | null>(null);
  const search = ref(""),
    searchPage = ref(1),
    searchTotal = ref(0),
    results = ref<Asset[]>([]),
    searchError = ref("");
  const locateError = ref(""),
    locatedAsset = ref<AssetDetail | null>(null);
  const mode = ref<RackOperationMode>("mount"),
    asset = ref<AssetDetail | null>(null),
    targetRack = ref<Rack | null>(null);
  const centerId = ref<number | null>(null),
    roomId = ref<number | null>(null),
    rackId = ref<number | null>(null);
  const startU = ref(1),
    height = ref(1),
    note = ref(""),
    error = ref(""),
    uncertain = ref(false),
    reconciling = ref(false);
  const options = ref<PlacementOptions | null>(null),
    optionsLoading = ref(false);
  const endU = computed(() => startU.value + height.value - 1);
  const selectedReservation = computed(
    () =>
      targetRack.value?.reservations?.find(
        (row) => row.id === reservationId.value && row.status === "active",
      ) || null,
  );
  let alive = true,
    locateVersion = 0,
    searchVersion = 0,
    prepareVersion = 0,
    optionVersion = 0,
    writeVersion = 0,
    cooldown = 0;
  const readers = new Set<AbortController>();
  const message = (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause);
  async function read<T>(path: string): Promise<T> {
    const controller = new AbortController();
    readers.add(controller);
    try {
      return await c.request<T>(path, { signal: controller.signal });
    } finally {
      readers.delete(controller);
    }
  }
  const mountedLocation = (value: Asset | AssetDetail | null) => {
    const position = value?.rack_allocation;
    if (!position && value?.rack_code)
      return `${value.data_center} / ${value.server_room} / ${value.rack_code} · ${value.u_range}`;
    return position
      ? `${position.data_center} / ${position.server_room} / ${position.rack_code} · U${position.start_u}–U${position.end_u}`
      : `${value?.asset_data_center_name || tr("common.notAvailable")} · ${tr("rackOps.unmounted")}`;
  };
  const targetLocation = computed(() =>
    mode.value === "unmount"
      ? `${asset.value?.asset_data_center_name || tr("common.notAvailable")} · ${tr("rackOps.unmounted")}`
      : targetRack.value
        ? `${targetRack.value.data_center_name} / ${targetRack.value.server_room_name} / ${targetRack.value.code} · U${startU.value}–U${endU.value}`
        : tr("rackOps.chooseRack"),
  );
  const positionValid = computed(() => {
    if (mode.value === "unmount") return !!asset.value?.rack_allocation;
    if (
      !asset.value ||
      asset.value.status === "retired" ||
      !targetRack.value ||
      !options.value?.accepts_assets ||
      optionsLoading.value
    )
      return false;
    if (
      !Number.isInteger(startU.value) ||
      !Number.isInteger(height.value) ||
      startU.value < 1 ||
      height.value < 1 ||
      endU.value > options.value.total_u
    )
      return false;
    if (
      reservationId.value &&
      (!c.can("racks.manage") ||
        !selectedReservation.value ||
        startU.value !== selectedReservation.value.start_u ||
        endU.value !== selectedReservation.value.end_u)
    )
      return false;
    return (
      options.value.occupancy_restricted ||
      !!options.value.available_ranges?.some(
        (span) => startU.value >= span.start_u && endU.value <= span.end_u,
      )
    );
  });
  async function searchAssets(page = 1) {
    if (!c.can("assets.view")) return;
    const version = ++searchVersion;
    finding.value = true;
    searchError.value = "";
    searchPage.value = page;
    try {
      const params = new URLSearchParams({
        compact: "true",
        search: search.value.trim(),
        page: String(page),
        page_size: "20",
      });
      const data = await read<
        | Asset[]
        | { count: number; results: Asset[]; next: null; previous: null }
      >(`/assets/?${params}`);
      if (version !== searchVersion || !alive) return;
      results.value = pageItems(data);
      searchTotal.value = pageTotal(data);
    } catch (cause) {
      if (version === searchVersion && !isAbortError(cause))
        searchError.value = message(cause);
    } finally {
      if (version === searchVersion) finding.value = false;
    }
  }
  function openSearch() {
    findOpen.value = true;
    results.value = [];
    searchTotal.value = 0;
    searchError.value = "";
  }
  async function locate(id: number) {
    findOpen.value = false;
    await router.push({
      path: "/racks/view",
      query: { ...route.query, rack_asset: String(id) },
    });
  }
  async function restoreLocation() {
    const version = ++locateVersion;
    if (c.rackListLoading.value) return;
    const raw = route.query.rack_asset;
    if (!raw) {
      locatedAsset.value = null;
      locateError.value = "";
      c.focusRackDetail(null);
      return;
    }
    c.closeAssetDetail();
    locatedAsset.value = null;
    locateError.value = "";
    try {
      if (
        !c.can("assets.view") ||
        typeof raw !== "string" ||
        !/^[1-9]\d*$/.test(raw)
      )
        throw new Error(tr("rackOps.linkUnavailable"));
      const detail = await read<AssetDetail>(`/assets/${raw}/`);
      if (!alive || version !== locateVersion) return;
      if (detail.archived_at) throw new Error(tr("rackOps.linkUnavailable"));
      const placement = detail.rack_allocation;
      if (!placement) {
        locatedAsset.value = detail;
        return;
      }
      const rack = await read<Rack>(`/racks/${placement.rack}/`);
      if (!alive || version !== locateVersion) return;
      const query = {
        compare: route.query.compare,
        data_center: String(placement.data_center_id),
        room: String(rack.room),
        rack: String(rack.id),
        rack_asset: raw,
      };
      if (
        Object.entries(query).some(
          ([key, value]) => route.query[key] !== value,
        ) ||
        route.query.rack_code ||
        route.query.device_type
      ) {
        await router.replace({ path: "/racks/view", query });
        return;
      }
      c.focusRackDetail(rack);
      locatedAsset.value = detail;
      await c.openRackAssetDetail(detail.id, rack.id);
    } catch (cause) {
      if (version === locateVersion && alive && !isAbortError(cause)) {
        c.focusRackDetail(null);
        c.closeAssetDetail();
        locateError.value = tr("rackOps.linkUnavailable");
      }
    }
  }
  watch(
    [() => route.fullPath, c.rackListLoading],
    () => {
      void restoreLocation();
    },
    { immediate: true },
  );
  async function loadOptions() {
    const version = ++optionVersion;
    options.value = null;
    targetRack.value = null;
    optionsLoading.value = false;
    if (rackId.value == null || mode.value === "unmount") return;
    const selected = rackId.value;
    const query = new URLSearchParams();
    if (asset.value) query.set("asset_id", String(asset.value.id));
    if (reservationId.value)
      query.set("reservation_id", String(reservationId.value));
    optionsLoading.value = true;
    try {
      const [rack, data] = await Promise.all([
        read<Rack>(`/racks/${selected}/`),
        read<PlacementOptions>(
          `/racks/${selected}/placement-options/?${query}`,
        ),
      ]);
      if (!alive || version !== optionVersion) return;
      targetRack.value = rack;
      options.value = data;
      centerId.value = data.data_center_id;
      roomId.value = data.server_room_id;
    } catch (cause) {
      if (version === optionVersion && !isAbortError(cause))
        error.value = message(cause);
    } finally {
      if (version === optionVersion) optionsLoading.value = false;
    }
  }
  watch(
    rackId,
    () => {
      reservationId.value = null;
    },
    { flush: "sync" },
  );
  function selectReservation(id: number | null) {
    const row = targetRack.value?.reservations?.find((item) => item.id === id);
    reservationId.value = row?.id || null;
    if (row) {
      startU.value = row.start_u;
      height.value = row.units;
    }
  }
  watch([rackId, reservationId, () => asset.value?.id], () => {
    if (dialogOpen.value) void loadOptions();
  });
  function setCenter(value: number | null) {
    centerId.value = value;
    roomId.value = null;
    rackId.value = null;
  }
  function setRoom(value: number | null) {
    roomId.value = value;
    rackId.value = null;
  }
  async function chooseAsset(id: number) {
    const version = ++prepareVersion;
    preparing.value = true;
    error.value = "";
    asset.value = null;
    try {
      const detail = await read<AssetDetail>(`/assets/${id}/`);
      if (!alive || version !== prepareVersion) return;
      if (
        detail.rack_allocation ||
        detail.status === "retired" ||
        detail.archived_at
      )
        throw new Error(tr("rackOps.assetUnavailable"));
      asset.value = detail;
    } catch (cause) {
      if (version === prepareVersion && !isAbortError(cause))
        error.value = message(cause);
    } finally {
      if (version === prepareVersion) preparing.value = false;
    }
  }
  async function open(
    operation: RackOperationMode,
    source: AssetDetail | null = null,
    rack: Rack | null = c.focusedRack.value,
    u = 1,
    reservation: RackUnitReservation | null = null,
  ) {
    if (!c.can("assets.manage") || busy.value) return;
    const operationVersion = ++prepareVersion;
    preparing.value = false;
    reconciling.value = false;
    mode.value = operation;
    dialogOpen.value = true;
    error.value = "";
    uncertain.value = false;
    note.value = "";
    asset.value = null;
    options.value = null;
    startU.value =
      operation === "adjust" ? source?.rack_allocation?.start_u || 1 : u;
    height.value = source?.rack_allocation?.units || 1;
    centerId.value =
      source?.rack_allocation?.data_center_id || c.selectedDataCenter.value;
    roomId.value = rack?.room || null;
    rackId.value = rack?.id || null;
    reservationId.value = reservation?.id || null;
    if (source) {
      preparing.value = true;
      const version = operationVersion;
      try {
        const detail = await read<AssetDetail>(`/assets/${source.id}/`);
        if (alive && version === prepareVersion) {
          if (
            detail.archived_at ||
            (operation !== "mount" && !detail.rack_allocation) ||
            (operation !== "unmount" && detail.status === "retired")
          )
            throw new Error(tr("rackOps.assetUnavailable"));
          if (operation === "mount" && detail.rack_allocation)
            throw new Error(tr("rackOps.assetUnavailable"));
          asset.value = detail;
          height.value = detail.rack_allocation?.units || 1;
          if (operation === "adjust")
            startU.value = detail.rack_allocation?.start_u || 1;
        }
      } catch (cause) {
        if (version === prepareVersion && !isAbortError(cause))
          error.value = message(cause);
      } finally {
        if (version === prepareVersion) preparing.value = false;
      }
    }
    if (alive && dialogOpen.value && operationVersion === prepareVersion) {
      if (reservation) {
        startU.value = reservation.start_u;
        height.value = reservation.units;
      }
      await loadOptions();
    }
  }
  function close() {
    if (busy.value) return;
    dialogOpen.value = false;
    ++prepareVersion;
    ++optionVersion;
    asset.value = null;
    preparing.value = false;
    reconciling.value = false;
    optionsLoading.value = false;
  }
  async function refreshAfterWrite(
    detail: AssetDetail,
    account: string,
    write: number,
  ) {
    const current = () =>
      alive && write === writeVersion && account === c.currentUsername.value;
    const version = locateVersion;
    c.closeAssetDetail();
    const refreshed = await c.loadRackView();
    if (!current()) return;
    if (detail.rack_allocation) {
      await router.replace({
        path: "/racks/view",
        query: {
          compare: route.query.compare,
          data_center: String(detail.rack_allocation.data_center_id),
          room: String(detail.rack_allocation.server_room_id),
          rack: String(detail.rack_allocation.rack),
          rack_asset: String(detail.id),
        },
      });
      if (current() && version === locateVersion) await restoreLocation();
    } else {
      await router.replace({
        path: "/racks/view",
        query: { ...route.query, rack_asset: undefined },
      });
      if (current()) locatedAsset.value = detail;
    }
    if (refreshed === false) throw new Error(tr("common.refreshFailed"));
  }
  async function save() {
    if (
      !c.can("assets.manage") ||
      busy.value ||
      preparing.value ||
      !positionValid.value ||
      !asset.value ||
      uncertain.value ||
      Date.now() < cooldown
    )
      return;
    busy.value = true;
    error.value = "";
    const source = asset.value,
      account = c.currentUsername.value,
      version = ++writeVersion;
    try {
      const body =
        mode.value === "unmount"
          ? { rack_id: null, note: note.value }
          : {
              rack_id: rackId.value,
              start_u: startU.value,
              end_u: endU.value,
              note: note.value,
              ...(reservationId.value
                ? { reservation_id: reservationId.value }
                : {}),
            };
      const detail = await c.request<AssetDetail>(
        `/assets/${source.id}/placement/`,
        {
          method: "PUT",
          headers: revisionHeaders(source),
          body: JSON.stringify(body),
        },
      );
      if (
        !alive ||
        version !== writeVersion ||
        account !== c.currentUsername.value
      )
        return;
      dialogOpen.value = false;
      placementRevision.value += 1;
      ElMessage.success(tr("rackOps.saved"));
      try {
        await refreshAfterWrite(detail, account, version);
      } catch {
        if (
          alive &&
          version === writeVersion &&
          account === c.currentUsername.value
        )
          ElMessage.warning(tr("rackOps.refreshFailed"));
      }
    } catch (cause) {
      if (
        !alive ||
        version !== writeVersion ||
        account !== c.currentUsername.value
      )
        return;
      error.value = message(cause);
      if (
        !(cause instanceof ApiError) ||
        (cause.status >= 500 && cause.status !== 503)
      ) {
        uncertain.value = true;
        error.value = tr("rackOps.uncertain");
      }
      if (cause instanceof ApiError && cause.status === 503)
        cooldown = Date.now() + Math.max(1000, cause.retryAfterMs);
      if (cause instanceof ApiError && cause.status === 409) {
        uncertain.value = true;
      }
      if (
        !uncertain.value &&
        !(cause instanceof ApiError && cause.status === 503)
      )
        await loadOptions();
    } finally {
      if (version === writeVersion) busy.value = false;
    }
  }
  async function reconcile() {
    if (!asset.value || busy.value || reconciling.value) return;
    reconciling.value = true;
    const version = ++prepareVersion;
    try {
      const detail = await read<AssetDetail>(`/assets/${asset.value.id}/`);
      if (!alive || version !== prepareVersion) return;
      asset.value = detail;
      uncertain.value = false;
      placementRevision.value += 1;
      error.value = tr("rackOps.reconciled");
      await loadOptions();
    } catch (cause) {
      if (alive && version === prepareVersion && !isAbortError(cause))
        error.value = message(cause);
    } finally {
      if (version === prepareVersion) reconciling.value = false;
    }
  }
  function reset() {
    ++locateVersion;
    ++searchVersion;
    ++prepareVersion;
    ++optionVersion;
    ++writeVersion;
    readers.forEach((controller) => controller.abort());
    readers.clear();
    c.closeAssetDetail();
    c.focusRackDetail(null);
    locatedAsset.value = null;
    locateError.value = "";
    dialogOpen.value = false;
    findOpen.value = false;
    asset.value = null;
    targetRack.value = null;
    reservationId.value = null;
    centerId.value = null;
    roomId.value = null;
    rackId.value = null;
    search.value = "";
    searchPage.value = 1;
    searchTotal.value = 0;
    error.value = "";
    searchError.value = "";
    note.value = "";
    results.value = [];
    options.value = null;
    busy.value = false;
    preparing.value = false;
    finding.value = false;
    reconciling.value = false;
    optionsLoading.value = false;
    cooldown = 0;
  }
  watch(c.currentUsername, reset, { flush: "sync" });
  onBeforeUnmount(() => {
    alive = false;
    reset();
  });
  return {
    placementRevision,
    reservationId,
    selectedReservation,
    selectReservation,
    canManage: computed(() => c.can("assets.manage")),
    findOpen,
    dialogOpen,
    finding,
    busy,
    preparing,
    search,
    searchPage,
    searchTotal,
    results,
    searchError,
    locateError,
    locatedAsset,
    mode,
    asset,
    targetRack,
    centerId,
    roomId,
    rackId,
    startU,
    height,
    endU,
    note,
    error,
    uncertain,
    reconciling,
    options,
    optionsLoading,
    positionValid,
    targetLocation,
    mountedLocation,
    openSearch,
    searchAssets,
    locate,
    chooseAsset,
    open,
    close,
    setCenter,
    setRoom,
    save,
    reconcile,
  };
}
export type RackOperations = ReturnType<typeof useRackOperations>;
