import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import { i18n } from "../i18n";
import { normalizeApiError } from "../error-handling";
import type { InventoryContext } from "../page-context";
import type {
  InventoryItem,
  InventoryLocationSummary,
  InventoryResolutionStatus,
  InventoryStatus,
} from "../types";
import { INVENTORY_FIELD_QUERY_KEYS, type useInventory } from "./useInventory";

export function useInventoryFieldwork(
  context: InventoryContext,
  inventory: ReturnType<typeof useInventory>,
  route: RouteLocationNormalizedLoaded,
) {
  const fieldMode = ref(false);
  const selectedItem = ref<InventoryItem | null>(null);
  const summary = ref<InventoryLocationSummary | null>(null);
  const summaryLoading = ref(false);
  const summaryError = ref("");
  const navigationLoading = ref(false);
  const navigationError = ref("");
  const notice = ref("");
  let summaryController: AbortController | null = null;
  let restoreVersion = 0;
  let lastWrittenKey = "";
  const tr = (key: string) => String(i18n.global.t(key));
  const {
    activeTask,
    items,
    itemPage,
    itemPageSize,
    itemCount,
    itemSearch,
    itemStatus,
    itemResolutionStatus,
    itemDataCenter,
    itemRoom,
    itemRack,
    itemPlacement,
  } = inventory;
  const busy = computed(
    () =>
      navigationLoading.value ||
      inventory.itemListLoading.value ||
      inventory.itemSaving.value ||
      inventory.scannedNormalSaving.value,
  );
  const onlyPending = computed({
    get: () => itemStatus.value === "pending",
    set: (value: boolean) => {
      itemStatus.value = value ? "pending" : "";
    },
  });

  function queryText(key: string) {
    const value = route.query[key];
    return typeof value === "string" ? value : "";
  }
  function positive(value: string, fallback = "") {
    return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
      ? value
      : fallback;
  }
  function routeKey(values: Record<string, unknown>) {
    return JSON.stringify(
      INVENTORY_FIELD_QUERY_KEYS.map((key) => values[key] || ""),
    );
  }
  async function syncRoute() {
    const taskId = activeTask.value?.id;
    await nextTick();
    if (!taskId || activeTask.value?.id !== taskId) return;
    const values: Record<string, string | undefined> = {
      mode: fieldMode.value ? "field" : undefined,
      inv_center: itemDataCenter.value || undefined,
      inv_room: itemRoom.value || undefined,
      inv_rack: itemRack.value || undefined,
      inv_placement: itemPlacement.value || undefined,
      inv_status: itemStatus.value || undefined,
      inv_resolution: itemResolutionStatus.value || undefined,
      inv_search: itemSearch.value || undefined,
      inv_page: String(itemPage.value),
      inv_size: String(itemPageSize.value),
      inv_item: selectedItem.value ? String(selectedItem.value.id) : undefined,
    };
    lastWrittenKey = routeKey(values);
    context.updateRouteQuery?.({
      task: String(activeTask.value.id),
      ...values,
    });
  }
  function selectItem(item: InventoryItem | null) {
    selectedItem.value = item;
    navigationError.value = "";
    notice.value = "";
    void syncRoute();
  }
  async function loadSummary() {
    const taskId = activeTask.value?.id;
    if (!fieldMode.value || !taskId) return;
    summaryController?.abort();
    const controller = new AbortController();
    summaryController = controller;
    summaryLoading.value = true;
    summaryError.value = "";
    try {
      const result = await context.request<InventoryLocationSummary>(
        `/inventory-tasks/${taskId}/location-summary/`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted && activeTask.value?.id === taskId)
        summary.value = result;
    } catch (error) {
      if (!controller.signal.aborted && activeTask.value?.id === taskId) {
        summary.value = null;
        summaryError.value =
          normalizeApiError(error).message || tr("inventory.fieldLoadFailed");
        if ([403, 404].includes(normalizeApiError(error).status || 0)) {
          selectedItem.value = null;
          items.value = [];
          itemCount.value = 0;
        }
      }
    } finally {
      if (summaryController === controller) summaryLoading.value = false;
    }
  }
  const matchingLocations = computed(() =>
    (summary.value?.locations || []).filter(
      (row) =>
        (!itemDataCenter.value ||
          String(row.data_center_id) === itemDataCenter.value) &&
        (!itemRoom.value || String(row.server_room_id) === itemRoom.value) &&
        (!itemRack.value || String(row.rack_id) === itemRack.value) &&
        (!itemPlacement.value ||
          (itemPlacement.value === "mounted"
            ? row.rack_id != null
            : itemPlacement.value === "unmounted"
              ? row.rack_id == null && row.data_center_id != null
              : row.rack_id == null && row.data_center_id == null)),
    ),
  );
  const rangeSummary = computed(() =>
    matchingLocations.value.reduce(
      (total, row) => ({
        total: total.total + row.total,
        checked: total.checked + row.checked,
        pending: total.pending + row.pending,
        resolution_pending: total.resolution_pending + row.resolution_pending,
      }),
      { total: 0, checked: 0, pending: 0, resolution_pending: 0 },
    ),
  );
  function options(field: "data_center" | "server_room" | "rack") {
    const result = new Map<string, string>();
    for (const row of summary.value?.locations || []) {
      if (
        field !== "data_center" &&
        itemDataCenter.value &&
        String(row.data_center_id) !== itemDataCenter.value
      )
        continue;
      if (
        field === "rack" &&
        itemRoom.value &&
        String(row.server_room_id) !== itemRoom.value
      )
        continue;
      const id = row[`${field}_id`];
      const label = field === "rack" ? row.rack_code : row[field];
      const parents =
        field === "data_center"
          ? []
          : [
              !itemDataCenter.value ? row.data_center : "",
              field === "rack" && !itemRoom.value ? row.server_room : "",
            ];
      if (id != null)
        result.set(
          String(id),
          [...parents, label || id].filter(Boolean).join(" / "),
        );
    }
    return Array.from(result, ([value, label]) => ({ value, label }));
  }
  const centers = computed(() => options("data_center"));
  const rooms = computed(() => options("server_room"));
  const racks = computed(() => options("rack"));
  const position = computed(() => {
    const index = items.value.findIndex(
      (row) => row.id === selectedItem.value?.id,
    );
    return index < 0
      ? 0
      : (itemPage.value - 1) * itemPageSize.value + index + 1;
  });

  async function applyFilters(changed?: "center" | "room" | "placement") {
    const version = ++restoreVersion;
    if (changed === "center") {
      itemRoom.value = "";
      itemRack.value = "";
    }
    if (changed === "room" || changed === "placement") itemRack.value = "";
    if (
      changed === "placement" &&
      itemPlacement.value &&
      itemPlacement.value !== "mounted"
    )
      itemRoom.value = "";
    if (changed === "placement" && itemPlacement.value === "unlocated")
      itemDataCenter.value = "";
    itemPage.value = 1;
    selectedItem.value = null;
    navigationError.value = "";
    notice.value = "";
    const loaded = await inventory.loadItems();
    if (version !== restoreVersion) return;
    if (loaded) selectItem(items.value[0] || null);
    else navigationError.value = tr("inventory.fieldLoadFailed");
    void syncRoute();
  }
  async function setMode(value: boolean) {
    if (busy.value) return;
    fieldMode.value = value;
    if (value) {
      const version = ++restoreVersion;
      await loadSummary();
      if (version !== restoreVersion) return;
      if (!selectedItem.value) selectItem(items.value[0] || null);
    } else if (
      itemDataCenter.value ||
      itemRoom.value ||
      itemRack.value ||
      itemPlacement.value
    ) {
      itemDataCenter.value = "";
      itemRoom.value = "";
      itemRack.value = "";
      itemPlacement.value = "";
      await applyFilters();
      return;
    }
    void syncRoute();
  }
  async function clearFilters() {
    itemDataCenter.value = "";
    itemRoom.value = "";
    itemRack.value = "";
    itemPlacement.value = "";
    itemSearch.value = "";
    itemStatus.value = "";
    itemResolutionStatus.value = "";
    await applyFilters();
  }
  async function move(step: number) {
    if (busy.value) return;
    const index = items.value.findIndex(
      (row) => row.id === selectedItem.value?.id,
    );
    const next = index + step;
    if (next >= 0 && next < items.value.length)
      return selectItem(items.value[next]);
    const page = itemPage.value + (step > 0 ? 1 : -1);
    if (page < 1 || page > Math.ceil(itemCount.value / itemPageSize.value))
      return;
    const version = ++restoreVersion;
    navigationLoading.value = true;
    try {
      itemPage.value = page;
      const loaded = await inventory.loadItems();
      if (version !== restoreVersion) return;
      if (loaded)
        selectItem(
          (step > 0 ? items.value[0] : items.value[items.value.length - 1]) ||
            null,
        );
      else {
        selectedItem.value = null;
        navigationError.value = tr("inventory.fieldLoadFailed");
      }
    } finally {
      if (version === restoreVersion) {
        navigationLoading.value = false;
        void syncRoute();
      }
    }
  }
  function capturePosition() {
    return {
      id: selectedItem.value?.id,
      index: items.value.findIndex((row) => row.id === selectedItem.value?.id),
      page: itemPage.value,
    };
  }
  async function afterSave(
    before: ReturnType<typeof capturePosition>,
    advance = false,
  ) {
    if (inventory.itemListError.value) {
      selectedItem.value = null;
      navigationError.value = tr("inventory.fieldLoadFailed");
      return;
    }
    const index = items.value.findIndex((row) => row.id === before.id);
    if (!advance && index >= 0) return selectItem(items.value[index]);
    const next =
      itemPage.value < before.page
        ? undefined
        : items.value[index >= 0 ? index + 1 : Math.max(0, before.index)];
    if (next) return selectItem(next);
    if (itemCount.value > itemPage.value * itemPageSize.value) {
      selectedItem.value = items.value[items.value.length - 1] || null;
      await move(1);
      return;
    }
    selectedItem.value = null;
    notice.value = tr("inventory.fieldEnd");
    void syncRoute();
  }
  async function confirmAndNext() {
    const item = selectedItem.value;
    if (!item || busy.value || summaryError.value) return;
    const before = capturePosition();
    if (await inventory.confirmItemNormal(item)) await afterSave(before, true);
    else {
      // Re-read before allowing another explicit write after an uncertain result.
      selectedItem.value = null;
      if (await inventory.loadItems())
        selectItem(items.value.find((row) => row.id === item.id) || null);
      else navigationError.value = tr("inventory.fieldLoadFailed");
    }
  }
  async function restoreRoute() {
    if (!activeTask.value || Number(queryText("task")) !== activeTask.value.id)
      return;
    const key = routeKey(route.query);
    if (key === lastWrittenKey) return;
    const field = queryText("mode") === "field";
    if (!field && !fieldMode.value) return;
    fieldMode.value = field;
    const version = ++restoreVersion;
    itemDataCenter.value = positive(queryText("inv_center"));
    itemRoom.value = positive(queryText("inv_room"));
    itemRack.value = positive(queryText("inv_rack"));
    itemPlacement.value = ["mounted", "unmounted", "unlocated"].includes(
      queryText("inv_placement"),
    )
      ? (queryText("inv_placement") as typeof itemPlacement.value)
      : "";
    itemStatus.value = inventory.itemStatusOptions.value.some(
      (row) => row.value === queryText("inv_status"),
    )
      ? (queryText("inv_status") as InventoryStatus)
      : "";
    itemResolutionStatus.value = ["pending", "resolved"].includes(
      queryText("inv_resolution"),
    )
      ? (queryText("inv_resolution") as InventoryResolutionStatus)
      : "";
    itemSearch.value = queryText("inv_search");
    itemPage.value = Number(positive(queryText("inv_page"), "1"));
    itemPageSize.value = [20, 50, 100].includes(Number(queryText("inv_size")))
      ? Number(queryText("inv_size"))
      : 50;
    selectedItem.value = null;
    navigationError.value = "";
    notice.value = "";
    navigationLoading.value = true;
    try {
      const [loaded] = await Promise.all([
        inventory.loadItems(),
        loadSummary(),
      ]);
      if (version !== restoreVersion) return;
      if (!loaded) {
        navigationError.value = tr("inventory.fieldLoadFailed");
        return;
      }
      const requested = positive(queryText("inv_item"));
      if (route.query.inv_item != null && !requested) {
        navigationError.value = tr("inventory.fieldItemUnavailable");
        return;
      }
      const item = requested
        ? items.value.find((row) => row.id === Number(requested))
        : items.value[0];
      selectedItem.value = item || null;
      if (requested && !item)
        navigationError.value = tr("inventory.fieldItemUnavailable");
      else void syncRoute();
    } finally {
      if (version === restoreVersion) navigationLoading.value = false;
    }
  }
  watch(
    () => route.query,
    () => {
      void restoreRoute();
    },
    { deep: true },
  );
  watch(
    () => activeTask.value?.id,
    (id) => {
      restoreVersion++;
      navigationLoading.value = false;
      summaryController?.abort();
      summary.value = null;
      selectedItem.value = null;
      summaryError.value = "";
      navigationError.value = "";
      if (id) {
        lastWrittenKey = "";
        void restoreRoute();
      }
    },
    { flush: "post" },
  );
  watch(
    () => activeTask.value?.summary,
    () => {
      if (fieldMode.value) void loadSummary();
    },
  );
  watch(items, (rows) => {
    const latest = rows.find((row) => row.id === selectedItem.value?.id);
    if (latest) selectedItem.value = latest;
  });
  onBeforeUnmount(() => {
    restoreVersion++;
    summaryController?.abort();
    selectedItem.value = null;
  });
  return {
    fieldMode,
    selectedItem,
    summary,
    summaryLoading,
    summaryError,
    navigationError,
    notice,
    busy,
    onlyPending,
    rangeSummary,
    centers,
    rooms,
    racks,
    position,
    loadSummary,
    setMode,
    applyFilters,
    clearFilters,
    selectItem,
    move,
    capturePosition,
    afterSave,
    confirmAndNext,
  };
}
