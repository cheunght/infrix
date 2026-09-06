import { computed, onBeforeUnmount, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { currentLocale, i18n } from "../i18n";
import { ApiError, buildExportQuery, pageItems, pageTotal, type PageResult } from "../api";
import type {
  Asset,
  InventoryBulkNormalResponse,
  InventoryBulkResolutionResponse,
  InventoryInspector,
  InventoryItem,
  InventoryResolutionAction,
  InventoryResolutionStatus,
  InventoryScopePreview,
  InventoryTask,
  InventoryTaskStatus,
  InventoryStatus,
  Rack,
  ServerRoom,
} from "../types";
import { parseAssetQrValue } from "../asset-qr";
import type { InventoryContext } from "../page-context";
import { normalizeApiError } from "../error-handling";
import {
  businessOptionLabel,
  businessOptionTone,
  INVENTORY_EXCEPTION_STATUS_VALUES,
  INVENTORY_ITEM_STATUS_OPTIONS,
  INVENTORY_RESOLUTION_ACTION_OPTIONS,
  INVENTORY_RESOLUTION_STATUS_OPTIONS,
  INVENTORY_TASK_STATUS_OPTIONS,
  type StatusTone,
} from "../business-enums";

type AuxKey = "rooms" | "inspectors" | "racks";
type BatchSelectionMode = "inventory" | "resolution";

export function useInventory(context: InventoryContext) {
  const taskListLoading = ref(false);
  const taskListError = ref("");
  const itemListLoading = ref(false);
  const itemListError = ref("");
  const taskDetailLoading = ref(false);
  const taskDetailError = ref("");
  const auxLoading = ref(false);
  const auxErrors = ref<Record<AuxKey, string>>({ rooms: "", inspectors: "", racks: "" });
  const taskCreating = ref(false);
  const taskDeletingId = ref<number | null>(null);
  const taskCompleting = ref(false);
  const taskReopening = ref(false);
  const itemSaving = ref(false);
  const scannedNormalSaving = ref(false);
  const resolutionSaving = ref(false);
  const bulkResolutionSaving = ref(false);
  const bulkNormalSaving = ref(false);
  const taskDialogError = ref("");
  const itemDialogError = ref("");
  const resolutionDialogError = ref("");
  const bulkResolutionDialogError = ref("");
  const bulkNormalDialogError = ref("");
  const exportingTaskId = ref<number | null>(null);

  const tasks = ref<InventoryTask[]>([]);
  const taskCount = ref(0);
  const taskPage = ref(1);
  const taskPageSize = ref(20);
  const taskSearch = ref("");
  const taskStatus = ref<InventoryTaskStatus | "">("");
  const taskDataCenter = ref("");
  const taskRoom = ref("");
  const activeTask = ref<InventoryTask | null>(null);
  const items = ref<InventoryItem[]>([]);
  const itemCount = ref(0);
  const itemPage = ref(1);
  const itemPageSize = ref(50);
  const itemSearch = ref("");
  const itemStatus = ref<InventoryStatus | "">("");
  const itemResolutionStatus = ref<InventoryResolutionStatus | "">("");
  const scannedItemId = ref<number | null>(null);
  const scanError = ref("");
  const selectedBatchItems = ref<InventoryItem[]>([]);
  const batchSelectionMode = ref<BatchSelectionMode | null>(null);
  const inspectors = ref<InventoryInspector[]>([]);
  const racks = ref<Rack[]>([]);
  const showTaskDialog = ref(false);
  const showItemDialog = ref(false);
  const showResolutionDialog = ref(false);
  const showBulkResolutionDialog = ref(false);
  const showBulkNormalDialog = ref(false);
  const editingItem = ref<InventoryItem | null>(null);
  const resolutionItem = ref<InventoryItem | null>(null);
  const scopePreview = ref<InventoryScopePreview | null>(null);
  const scopePreviewLoading = ref(false);
  const scopePreviewError = ref("");
  const taskForm = ref({
    name: "",
    data_center: "",
    server_room: "",
    inspector: "",
    start_at: "",
    end_at: "",
    notes: "",
  });
  const itemForm = ref<{
    status: InventoryStatus | "";
    actual_rack: string;
    actual_start_u: string;
    actual_end_u: string;
    notes: string;
  }>({
    status: "",
    actual_rack: "",
    actual_start_u: "",
    actual_end_u: "",
    notes: "",
  });
  const resolutionForm = ref<{
    action: InventoryResolutionAction | "";
    note: string;
  }>({
    action: "",
    note: "",
  });
  const bulkResolutionAction = ref<InventoryResolutionAction | "">("");
  const bulkResolutionCount = ref(0);
  const bulkResolutionForm = ref({ note: "" });
  const bulkResolutionResult = ref<InventoryBulkResolutionResponse | null>(null);
  const bulkNormalCount = ref(0);
  const bulkNormalResult = ref<InventoryBulkNormalResponse | null>(null);

  let taskRequestId = 0;
  let itemRequestId = 0;
  let taskDetailRequestId = 0;
  let taskController: AbortController | null = null;
  let itemController: AbortController | null = null;
  let taskDetailController: AbortController | null = null;
  let scopePreviewRequestId = 0;
  let scopePreviewController: AbortController | null = null;
  let auxPending = 0;
  const auxRequestIds: Record<AuxKey, number> = { rooms: 0, inspectors: 0, racks: 0 };
  const auxControllers: Partial<Record<AuxKey, AbortController>> = {};
  let scanFilterSnapshot: {
    search: string;
    status: InventoryStatus | "";
    resolutionStatus: InventoryResolutionStatus | "";
    page: number;
  } | null = null;

  const activeDataCenters = computed(() =>
    context.dataCenters.value.filter((item) => item.is_active !== false),
  );
  const activeRooms = computed(() =>
    context.serverRooms.value.filter(
      (item) =>
        item.is_active !== false &&
        (!taskForm.value.data_center || String(item.data_center) === taskForm.value.data_center),
    ),
  );
  const taskFilterRooms = computed(() =>
    context.serverRooms.value.filter(
      (item) =>
        item.is_active !== false &&
        (!taskDataCenter.value || String(item.data_center) === taskDataCenter.value),
    ),
  );
  const activeRacks = computed(() => racks.value.filter((item) => item.is_active !== false));
  const taskStatusOptions = computed(() => INVENTORY_TASK_STATUS_OPTIONS.map((item) => ({ ...item, label: businessOptionLabel(INVENTORY_TASK_STATUS_OPTIONS, item.value) })));
  const itemStatusOptions = computed(() => INVENTORY_ITEM_STATUS_OPTIONS.map((item) => ({ ...item, label: businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, item.value) })));
  const itemResultOptions = computed(() => itemStatusOptions.value.filter((item) => item.value !== "pending"));
  const itemResolutionStatusOptions = computed(() => INVENTORY_RESOLUTION_STATUS_OPTIONS.filter((item) => item.value !== "not_required").map((item) => ({ ...item, label: businessOptionLabel(INVENTORY_RESOLUTION_STATUS_OPTIONS, item.value) })));
  const taskHasFilters = computed(() =>
    Boolean(taskSearch.value.trim() || taskStatus.value || taskDataCenter.value || taskRoom.value),
  );
  const itemHasFilters = computed(() => Boolean(
    itemSearch.value.trim() || itemStatus.value || itemResolutionStatus.value,
  ));
  const taskAuxError = computed(() => auxErrors.value.rooms || auxErrors.value.inspectors || "");
  const itemAuxError = computed(() => auxErrors.value.racks || "");
  const auxError = computed(() =>
    Object.values(auxErrors.value).find((message) => Boolean(message)) || "",
  );
  function taskStatusLabel(status: string) {
    return businessOptionLabel(INVENTORY_TASK_STATUS_OPTIONS, status);
  }
  function formatDateTime(value?: string | null) {
    return value ? new Date(value).toLocaleString(currentLocale.value) : "—";
  }
  function locationText(item: InventoryItem, actual = false) {
    const dc = actual ? item.actual_data_center : item.system_data_center;
    const room = actual ? item.actual_server_room : item.system_server_room;
    const rack = actual ? item.actual_rack_code : item.system_rack_code;
    const start = actual ? item.actual_start_u : item.system_start_u;
    const end = actual ? item.actual_end_u : item.system_end_u;
    const location = [dc, room, rack].filter(Boolean).join(" / ");
    const u = start != null ? `U${start}–U${end}` : i18n.global.t("inventory.unmounted");
    return location ? `${location} · ${u}` : u;
  }
  function statusTagType(status: string): StatusTone {
    return businessOptionTone(INVENTORY_ITEM_STATUS_OPTIONS, status, "info");
  }
  function isExceptionStatus(status: string) {
    return INVENTORY_EXCEPTION_STATUS_VALUES.some((value) => value === status);
  }
  function canRecordInventory(item?: InventoryItem | null) {
    return Boolean(
      activeTask.value?.status === "in_progress" &&
      context.can("inventory.manage") &&
      (!item || activeTask.value.id === item.task),
    );
  }
  function canResolveInventoryAnomaly(item?: InventoryItem | null) {
    return Boolean(
      item &&
      activeTask.value &&
      activeTask.value.id === item.task &&
      (activeTask.value.status === "in_progress" || activeTask.value.status === "completed") &&
      context.can("inventory.manage") &&
      isExceptionStatus(item.status) &&
      item.resolution_status === "pending",
    );
  }
  function isInventoryBatchSelectable(item: InventoryItem) {
    return canRecordInventory(item) && item.status === "pending";
  }
  function isResolutionBatchSelectable(item: InventoryItem) {
    return canResolveInventoryAnomaly(item);
  }
  function batchSelectionModeFor(item: InventoryItem): BatchSelectionMode | null {
    if (isInventoryBatchSelectable(item)) return "inventory";
    if (isResolutionBatchSelectable(item)) return "resolution";
    return null;
  }
  function isBatchSelectableForMode(item: InventoryItem, mode: BatchSelectionMode) {
    return mode === "inventory"
      ? isInventoryBatchSelectable(item)
      : isResolutionBatchSelectable(item);
  }
  function isBatchSelectable(item: InventoryItem) {
    if (batchSelectionMode.value) {
      return isBatchSelectableForMode(item, batchSelectionMode.value);
    }
    return Boolean(batchSelectionModeFor(item));
  }
  function onBatchSelectionChange(rows: InventoryItem[]) {
    if (!rows.length) {
      clearBatchSelection();
      return;
    }
    const mode = batchSelectionMode.value || rows.map(batchSelectionModeFor).find(Boolean) || null;
    if (!mode) {
      clearBatchSelection();
      return;
    }
    batchSelectionMode.value = mode;
    selectedBatchItems.value = rows.filter((item) => isBatchSelectableForMode(item, mode));
  }
  function clearBatchSelection() {
    selectedBatchItems.value = [];
    batchSelectionMode.value = null;
  }
  function resolutionStatusLabel(status: string) {
    if (status === "not_required") return "—";
    return businessOptionLabel(INVENTORY_RESOLUTION_STATUS_OPTIONS, status) || "—";
  }
  function resolutionStatusTagType(status: string): StatusTone {
    return businessOptionTone(INVENTORY_RESOLUTION_STATUS_OPTIONS, status, "info");
  }
  function resolutionActionLabel(action: string | null | undefined) {
    return action ? businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, action) : "—";
  }
  function batchResolutionActionOptions(items = selectedBatchItems.value) {
    if (
      batchSelectionMode.value !== "resolution" ||
      !items.length ||
      items.some((item) => !isBatchSelectableForMode(item, "resolution"))
    ) return [];
    const options: Array<{ label: string; value: InventoryResolutionAction }> = [
      { label: businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, "keep_asset"), value: "keep_asset" },
      { label: businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, "ignore"), value: "ignore" },
    ];
    if (items.every((item) => item.status === "not_found")) {
      options.unshift({ label: businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, "confirm_missing"), value: "confirm_missing" });
    }
    return options;
  }
  function hasCompleteActualLocation(item: InventoryItem | null | undefined) {
    return Boolean(
      item &&
      item.status === "location_mismatch" &&
      item.actual_rack &&
      item.actual_data_center &&
      item.actual_server_room &&
      item.actual_rack_code &&
      item.actual_start_u != null &&
      item.actual_end_u != null,
    );
  }
  function resolutionActionOptions(item: InventoryItem | null | undefined) {
    if (!item || !isExceptionStatus(item.status) || item.resolution_status !== "pending") return [];
    const options: Array<{ label: string; value: InventoryResolutionAction }> = [];
    if (
      item.status === "location_mismatch" &&
      context.can("inventory.manage") &&
      context.can("assets.manage") &&
      hasCompleteActualLocation(item)
    ) {
      options.push({ label: businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, "update_asset"), value: "update_asset" });
    }
    if (item.status === "not_found") {
      options.push({ label: businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, "confirm_missing"), value: "confirm_missing" });
    }
    options.push({ label: businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, "keep_asset"), value: "keep_asset" });
    options.push({ label: businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, "ignore"), value: "ignore" });
    return options;
  }
  function taskScope(task: InventoryTask) {
    return task.server_room_name
      ? `${task.data_center_name} / ${task.server_room_name}`
      : `${task.data_center_name} / ${i18n.global.t("inventory.wholeDataCenter")}`;
  }

  function clearScopePreview() {
    scopePreviewRequestId += 1;
    scopePreviewController?.abort();
    scopePreviewController = null;
    scopePreview.value = null;
    scopePreviewError.value = "";
    scopePreviewLoading.value = false;
  }

  async function loadScopePreview() {
    if (!context.can("inventory.manage")) {
      clearScopePreview();
      return false;
    }
    const dataCenter = taskForm.value.data_center;
    if (!dataCenter) {
      clearScopePreview();
      return false;
    }
    const serverRoom = taskForm.value.server_room;
    const requestId = ++scopePreviewRequestId;
    scopePreviewController?.abort();
    const controller = new AbortController();
    scopePreviewController = controller;
    scopePreviewLoading.value = true;
    scopePreviewError.value = "";
    const params = new URLSearchParams({ data_center: dataCenter });
    if (serverRoom) params.set("server_room", serverRoom);
    try {
      const result = await context.request<InventoryScopePreview>(
        `/inventory-tasks/scope-preview/?${params}`,
        { signal: controller.signal },
      );
      if (
        requestId !== scopePreviewRequestId ||
        controller.signal.aborted ||
        !result ||
        taskForm.value.data_center !== dataCenter ||
        taskForm.value.server_room !== serverRoom
      ) return false;
      scopePreview.value = result;
      return true;
    } catch (error) {
      if (requestId === scopePreviewRequestId && !controller.signal.aborted) {
        scopePreviewError.value = error instanceof Error ? error.message : i18n.global.t("inventory.rangeLoadFailed");
      }
      return false;
    } finally {
      if (requestId === scopePreviewRequestId) {
        scopePreviewLoading.value = false;
        if (scopePreviewController === controller) scopePreviewController = null;
      }
    }
  }

  function retryScopePreview() {
    void loadScopePreview();
  }

  function beginAuxRequest(key: AuxKey) {
    auxControllers[key]?.abort();
    const controller = new AbortController();
    auxControllers[key] = controller;
    auxRequestIds[key] += 1;
    auxPending += 1;
    auxLoading.value = true;
    auxErrors.value[key] = "";
    return { id: auxRequestIds[key], controller };
  }
  function finishAuxRequest() {
    auxPending = Math.max(0, auxPending - 1);
    auxLoading.value = auxPending > 0;
  }

  async function loadAllPages<T>(
    basePath: string,
    controller: AbortController,
    shouldContinue: () => boolean,
  ): Promise<T[] | null> {
    const rows: T[] = [];
    let page = 1;
    while (shouldContinue() && !controller.signal.aborted) {
      const separator = basePath.includes("?") ? "&" : "?";
      const result = await context.request<PageResult<T> | T[]>(
        `${basePath}${separator}page=${page}`,
        { signal: controller.signal },
      );
      if (!shouldContinue() || controller.signal.aborted) return null;
      if (Array.isArray(result)) {
        rows.push(...result);
        return rows;
      }
      rows.push(...(result.results || []));
      const hasMore = result.next !== undefined
        ? Boolean(result.next)
        : typeof result.count === "number"
          ? rows.length < result.count
          : (result.results || []).length >= 50;
      if (!(result.results || []).length || !hasMore) return rows;
      page += 1;
    }
    return null;
  }

  async function loadRooms() {
    if (!context.can("racks.view")) return;
    const { id, controller } = beginAuxRequest("rooms");
    try {
      const result = await loadAllPages<ServerRoom>(
        "/server-rooms/?page_size=50&is_active=true",
        controller,
        () => id === auxRequestIds.rooms,
      );
      if (id !== auxRequestIds.rooms || controller.signal.aborted || !result) return;
      context.serverRooms.value = result;
    } catch (error) {
      if (id === auxRequestIds.rooms && !controller.signal.aborted) {
        auxErrors.value.rooms = error instanceof Error ? error.message : i18n.global.t("inventory.roomsLoadFailed");
      }
    } finally {
      finishAuxRequest();
    }
  }

  async function loadInspectors() {
    if (!context.can("inventory.manage")) return;
    const { id, controller } = beginAuxRequest("inspectors");
    try {
      const result = await context.request<InventoryInspector[]>(
        "/inventory-inspectors/",
        { signal: controller.signal },
      );
      if (id !== auxRequestIds.inspectors || controller.signal.aborted || !result) return;
      inspectors.value = result;
    } catch (error) {
      if (id === auxRequestIds.inspectors && !controller.signal.aborted) {
        auxErrors.value.inspectors = error instanceof Error ? error.message : i18n.global.t("inventory.inspectorsLoadFailed");
      }
    } finally {
      finishAuxRequest();
    }
  }

  async function loadRacks() {
    if (!context.can("racks.view")) return;
    const { id, controller } = beginAuxRequest("racks");
    try {
      const result = await loadAllPages<Rack>(
        "/racks/?page_size=50&is_active=true",
        controller,
        () => id === auxRequestIds.racks,
      );
      if (id !== auxRequestIds.racks || controller.signal.aborted || !result) return;
      racks.value = result;
    } catch (error) {
      if (id === auxRequestIds.racks && !controller.signal.aborted) {
        auxErrors.value.racks = error instanceof Error ? error.message : i18n.global.t("inventory.racksLoadFailed");
      }
    } finally {
      finishAuxRequest();
    }
  }

  async function loadTasks(corrected = false) {
    if (!context.can("inventory.view")) {
      tasks.value = [];
      taskCount.value = 0;
      return;
    }
    const requestId = ++taskRequestId;
    taskController?.abort();
    const controller = new AbortController();
    taskController = controller;
    taskListLoading.value = true;
    taskListError.value = "";
    try {
      const params = new URLSearchParams({
        page: String(taskPage.value),
        page_size: String(taskPageSize.value),
      });
      if (taskSearch.value.trim()) params.set("search", taskSearch.value.trim());
      if (taskStatus.value) params.set("status", taskStatus.value);
      if (taskDataCenter.value) params.set("data_center", taskDataCenter.value);
      if (taskRoom.value) params.set("server_room", taskRoom.value);
      const result = await context.request<PageResult<InventoryTask> | InventoryTask[]>(
        `/inventory-tasks/?${params}`,
        { signal: controller.signal },
      );
      if (requestId !== taskRequestId || controller.signal.aborted || !result) return;
      const total = pageTotal(result);
      const maxPage = Math.max(1, Math.ceil(total / taskPageSize.value));
      if (taskPage.value > maxPage && !corrected) {
        taskPage.value = maxPage;
        await loadTasks(true);
        return;
      }
      tasks.value = pageItems(result);
      taskCount.value = total;
    } catch (error) {
      if (requestId === taskRequestId && !controller.signal.aborted) {
        taskListError.value = error instanceof Error ? error.message : i18n.global.t("inventory.taskLoadFailed");
      }
    } finally {
      if (requestId === taskRequestId) {
        taskListLoading.value = false;
        if (taskController === controller) taskController = null;
      }
    }
  }

  function itemQueryParams(includePagination = true) {
    const params = new URLSearchParams();
    if (includePagination) {
      params.set("page", String(itemPage.value));
      params.set("page_size", String(itemPageSize.value));
    }
    if (itemSearch.value.trim()) params.set("search", itemSearch.value.trim());
    if (itemStatus.value) params.set("status", itemStatus.value);
    if (itemResolutionStatus.value) params.set("resolution_status", itemResolutionStatus.value);
    return params;
  }

  async function loadItems(corrected = false): Promise<boolean> {
    if (!context.can("inventory.view") || !activeTask.value) return false;
    clearBatchSelection();
    const taskId = activeTask.value.id;
    const requestId = ++itemRequestId;
    itemController?.abort();
    const controller = new AbortController();
    itemController = controller;
    itemListLoading.value = true;
    itemListError.value = "";
    try {
      const params = itemQueryParams();
      const result = await context.request<PageResult<InventoryItem> | InventoryItem[]>(
        `/inventory-tasks/${taskId}/items/?${params}`,
        { signal: controller.signal },
      );
      if (
        requestId !== itemRequestId ||
        controller.signal.aborted ||
        !result ||
        activeTask.value?.id !== taskId
      ) return false;
      const total = pageTotal(result);
      const maxPage = Math.max(1, Math.ceil(total / itemPageSize.value));
      if (itemPage.value > maxPage && !corrected) {
        itemPage.value = maxPage;
        return await loadItems(true);
      }
      items.value = pageItems(result);
      itemCount.value = total;
      return true;
    } catch (error) {
      if (requestId === itemRequestId && !controller.signal.aborted) {
        itemListError.value = error instanceof Error ? error.message : i18n.global.t("inventory.itemLoadFailed");
      }
      return false;
    } finally {
      if (requestId === itemRequestId) {
        itemListLoading.value = false;
        if (itemController === controller) itemController = null;
      }
    }
  }

  async function refreshActiveTask(taskId = activeTask.value?.id) {
    if (!context.can("inventory.view") || !taskId || activeTask.value?.id !== taskId) return false;
    clearBatchSelection();
    const requestId = ++taskDetailRequestId;
    taskDetailController?.abort();
    const controller = new AbortController();
    taskDetailController = controller;
    taskDetailLoading.value = true;
    taskDetailError.value = "";
    try {
      const result = await context.request<InventoryTask>(
        `/inventory-tasks/${taskId}/`,
        { signal: controller.signal },
      );
      if (
        requestId !== taskDetailRequestId ||
        controller.signal.aborted ||
        !result ||
        activeTask.value?.id !== taskId
      ) return false;
      activeTask.value = result;
      return true;
    } catch (error) {
      if (requestId === taskDetailRequestId && !controller.signal.aborted) {
        taskDetailError.value = error instanceof Error ? error.message : i18n.global.t("inventory.taskDetailLoadFailed");
      }
      return false;
    } finally {
      if (requestId === taskDetailRequestId) {
        taskDetailLoading.value = false;
        if (taskDetailController === controller) taskDetailController = null;
      }
    }
  }

  async function openTask(task: InventoryTask) {
    if (!context.can("inventory.view")) return;
    resetScanState();
    clearBatchSelection();
    const requestId = ++taskDetailRequestId;
    taskDetailController?.abort();
    itemController?.abort();
    itemRequestId += 1;
    const controller = new AbortController();
    taskDetailController = controller;
    taskDetailLoading.value = true;
    taskDetailError.value = "";
    try {
      const result = await context.request<InventoryTask>(
        `/inventory-tasks/${task.id}/`,
        { signal: controller.signal },
      );
      if (requestId !== taskDetailRequestId || controller.signal.aborted || !result) return;
      activeTask.value = result;
      itemPage.value = 1;
      itemSearch.value = "";
      itemStatus.value = "";
      itemResolutionStatus.value = "";
      await loadItems();
    } catch (error) {
      if (requestId === taskDetailRequestId && !controller.signal.aborted) {
        taskDetailError.value = error instanceof Error ? error.message : i18n.global.t("inventory.taskLoadFailed");
        ElMessage.error(taskDetailError.value);
      }
    } finally {
      if (requestId === taskDetailRequestId) {
        taskDetailLoading.value = false;
        if (taskDetailController === controller) taskDetailController = null;
      }
    }
  }

  function closeTask() {
    resetScanState();
    taskDetailRequestId += 1;
    taskDetailController?.abort();
    itemRequestId += 1;
    itemController?.abort();
    activeTask.value = null;
    clearBatchSelection();
    items.value = [];
    itemCount.value = 0;
    itemListError.value = "";
    taskDetailError.value = "";
  }

  function resetScanState() {
    scannedItemId.value = null;
    scanError.value = "";
    scanFilterSnapshot = null;
  }

  async function locateScannedAsset(rawValue: string): Promise<InventoryItem | null> {
    if (!context.can("inventory.view")) return null;
    scanError.value = "";
    scannedItemId.value = null;
    if (!activeTask.value) {
      scanError.value = i18n.global.t("inventory.scanTaskRequired");
      return null;
    }
    if (activeTask.value.status !== "in_progress") {
      scanError.value = i18n.global.t("inventory.completedTaskReadOnly");
      return null;
    }
    const parsed = parseAssetQrValue(rawValue);
    if (!parsed) {
      scanError.value = i18n.global.t("inventory.invalidQr");
      return null;
    }

    let assetNo = parsed.assetNo;
    if (!assetNo && parsed.assetId) {
      try {
        const asset = await context.request<Pick<Asset, "asset_no">>(`/assets/${parsed.assetId}/`);
        assetNo = asset.asset_no?.trim() || "";
      } catch {
        scanError.value = i18n.global.t("inventory.invalidQr");
        return null;
      }
    }
    if (!assetNo) {
      scanError.value = i18n.global.t("inventory.invalidQr");
      return null;
    }

    if (!scanFilterSnapshot) {
      scanFilterSnapshot = {
        search: itemSearch.value,
        status: itemStatus.value,
        resolutionStatus: itemResolutionStatus.value,
        page: itemPage.value,
      };
    }
    itemSearch.value = assetNo;
    itemStatus.value = "";
    itemResolutionStatus.value = "";
    itemPage.value = 1;
    const loaded = await loadItems();
    if (!loaded || itemListError.value) {
      scanError.value = i18n.global.t("inventory.scanLoadFailed");
      return null;
    }
    const found = items.value.find((item) => (
      (parsed.assetId != null && item.asset === parsed.assetId) || item.asset_no === assetNo
    ));
    if (!found) {
      scanError.value = i18n.global.t("inventory.scanNotInTask");
      return null;
    }
    scannedItemId.value = found.id;
    return found;
  }

  function clearScannedAsset() {
    const snapshot = scanFilterSnapshot;
    resetScanState();
    if (!snapshot) return;
    itemSearch.value = snapshot.search;
    itemStatus.value = snapshot.status;
    itemResolutionStatus.value = snapshot.resolutionStatus;
    itemPage.value = snapshot.page;
    void loadItems();
  }

  async function confirmItemNormal(item: InventoryItem): Promise<boolean> {
    if (scannedNormalSaving.value) return false;
    if (!activeTask.value || activeTask.value.id !== item.task || activeTask.value.status !== "in_progress") {
      ElMessage.warning(i18n.global.t("inventory.completedTaskReadOnly"));
      return false;
    }
    if (!context.can("inventory.manage")) {
      ElMessage.error(i18n.global.t("inventory.inventoryPermissionDenied"));
      return false;
    }
    if (item.status !== "pending") {
      ElMessage.warning(i18n.global.t("inventory.selectedItemsChanged"));
      return false;
    }

    const taskId = activeTask.value.id;
    scannedNormalSaving.value = true;
    try {
      await context.request<InventoryItem>(`/inventory-items/${item.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "normal" }),
      });
      const [itemsLoaded, taskDetailLoaded] = await Promise.all([
        loadItems(),
        refreshActiveTask(taskId),
        loadTasks(),
      ]);
      ElMessage.success(i18n.global.t("inventory.scannedNormalCompleted", { asset: item.asset_no }));
      if (!itemsLoaded || !taskDetailLoaded || itemListError.value || taskDetailError.value || taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.scannedNormalRefreshFailed"));
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : i18n.global.t("inventory.scannedNormalFailed"));
      return false;
    } finally {
      scannedNormalSaving.value = false;
    }
  }

  function resetTaskForm() {
    const currentInspector = inspectors.value.find(
      (person) => person.username === context.currentUsername.value,
    );
    taskForm.value = {
      name: "",
      data_center: activeDataCenters.value[0]
        ? String(activeDataCenters.value[0].id)
        : "",
      server_room: "",
      inspector: currentInspector ? String(currentInspector.id) : "",
      start_at: "",
      end_at: "",
      notes: "",
    };
  }

  async function openNewTask() {
    if (!context.can("inventory.manage")) return;
    taskDialogError.value = "";
    clearScopePreview();
    resetTaskForm();
    showTaskDialog.value = true;
    await Promise.allSettled([loadRooms(), loadInspectors()]);
    if (!taskForm.value.inspector) {
      const currentInspector = inspectors.value.find(
        (person) => person.username === context.currentUsername.value,
      );
      if (currentInspector) taskForm.value.inspector = String(currentInspector.id);
    }
    if (showTaskDialog.value && taskForm.value.data_center) void loadScopePreview();
  }

  function changeTaskDataCenter() {
    taskForm.value.server_room = "";
    clearScopePreview();
    if (taskForm.value.data_center) void loadScopePreview();
  }

  function changeTaskServerRoom() {
    clearScopePreview();
    if (taskForm.value.data_center) void loadScopePreview();
  }

  function closeTaskDialog() {
    showTaskDialog.value = false;
    taskDialogError.value = "";
    clearScopePreview();
  }

  async function saveTask() {
    if (!context.can("inventory.manage") || taskCreating.value) return false;
    taskDialogError.value = "";
    if (
      !taskForm.value.name.trim() ||
      !taskForm.value.data_center ||
      !taskForm.value.start_at ||
      !taskForm.value.end_at
    ) {
      taskDialogError.value = i18n.global.t("inventory.taskCreateInvalid");
      ElMessage.warning(taskDialogError.value);
      return false;
    }
    const startAt = new Date(taskForm.value.start_at).getTime();
    const endAt = new Date(taskForm.value.end_at).getTime();
    if (Number.isNaN(startAt) || Number.isNaN(endAt) || startAt > endAt) {
      taskDialogError.value = i18n.global.t("inventory.startAfterEnd");
      ElMessage.warning(taskDialogError.value);
      return false;
    }
    if (scopePreviewLoading.value) {
      taskDialogError.value = i18n.global.t("inventory.rangeCalculating");
      ElMessage.warning(taskDialogError.value);
      return false;
    }
    if (scopePreviewError.value || !scopePreview.value) {
      taskDialogError.value = i18n.global.t("inventory.rangeReloadFirst");
      ElMessage.warning(taskDialogError.value);
      return false;
    }
    if (scopePreview.value.total <= 0) {
      taskDialogError.value = i18n.global.t("inventory.noInventoryAssetsCreate");
      ElMessage.warning(taskDialogError.value);
      return false;
    }
    taskCreating.value = true;
    try {
      const createdTask = await context.request<InventoryTask>("/inventory-tasks/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...taskForm.value,
          data_center: Number(taskForm.value.data_center),
          server_room: taskForm.value.server_room
            ? Number(taskForm.value.server_room)
            : null,
          inspector: taskForm.value.inspector
            ? Number(taskForm.value.inspector)
            : undefined,
        }),
      });
      closeTaskDialog();
      ElMessage.success(i18n.global.t("inventory.taskCreated", { count: createdTask.summary.total }));
      taskPage.value = 1;
      await loadTasks();
      if (taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.taskCreatedRefreshFailed"));
      }
      return true;
    } catch (error) {
      taskDialogError.value = error instanceof Error ? error.message : i18n.global.t("inventory.taskCreateFailed");
      ElMessage.error(taskDialogError.value);
      return false;
    } finally {
      taskCreating.value = false;
    }
  }

  async function deleteTask(task: InventoryTask) {
    if (!context.can("inventory.manage") || !task.can_delete || taskDeletingId.value !== null) {
      return false;
    }
    const ok = await ElMessageBox.confirm(
      i18n.global.t("inventory.deleteTaskConfirm", { name: task.name }),
      i18n.global.t("inventory.deleteTaskTitle"),
      {
        type: "error",
        confirmButtonText: i18n.global.t("common.delete"),
        cancelButtonText: i18n.global.t("common.cancel"),
        confirmButtonClass: "el-button--danger",
      },
    ).catch(() => false);
    if (!ok || taskDeletingId.value !== null) return false;

    taskDeletingId.value = task.id;
    try {
      await context.request(`/inventory-tasks/${task.id}/`, { method: "DELETE" });
      await loadTasks();
      ElMessage.success(i18n.global.t("inventory.taskDeleted"));
      if (taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.taskDeletedRefreshFailed"));
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : i18n.global.t("inventory.taskDeleteFailed"));
      return false;
    } finally {
      taskDeletingId.value = null;
    }
  }

  async function completeTask() {
    if (!context.can("inventory.manage") || !activeTask.value || taskCompleting.value) return;
    if (activeTask.value.summary.pending > 0) {
      ElMessage.warning(i18n.global.t("inventory.pendingCannotComplete", { count: activeTask.value.summary.pending }));
      return;
    }
    const summary = activeTask.value.summary;
    const ok = await ElMessageBox.confirm(
      [
        i18n.global.t("inventory.completeSummaryTotal", { count: summary.total }),
        i18n.global.t("inventory.completeSummaryNormal", { count: summary.normal, exceptions: summary.exceptions }),
        i18n.global.t("inventory.completeSummaryPending", { pending: summary.pending, unresolved: summary.resolution_pending }),
        "",
        i18n.global.t("inventory.completeConfirmWarning"),
      ].join("\n"),
      i18n.global.t("inventory.completeTaskTitle"),
      {
        type: "warning",
        confirmButtonText: i18n.global.t("inventory.completeTask"),
        cancelButtonText: i18n.global.t("common.cancel"),
      },
    ).catch(() => false);
    if (!ok || !activeTask.value || taskCompleting.value) return;
    const taskId = activeTask.value.id;
    taskCompleting.value = true;
    try {
      const result = await context.request<InventoryTask>(
        `/inventory-tasks/${taskId}/complete/`,
        { method: "POST" },
      );
      if (activeTask.value?.id === taskId) activeTask.value = result;
      await Promise.all([loadItems(), loadTasks()]);
      const resolutionPending = result.summary.resolution_pending || 0;
      ElMessage.success(
        resolutionPending > 0
          ? i18n.global.t("inventory.taskCompletedWithPending", { count: resolutionPending })
          : i18n.global.t("inventory.taskCompleted"),
      );
      if (itemListError.value || taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.taskCompleteRefreshFailed"));
      }
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : i18n.global.t("inventory.taskCompleteFailed"));
    } finally {
      taskCompleting.value = false;
    }
  }

  async function reopenTask() {
    if (!context.can("inventory.manage") || !activeTask.value || taskReopening.value) return;
    const taskId = activeTask.value.id;
    taskReopening.value = true;
    try {
      const result = await context.request<InventoryTask>(
        `/inventory-tasks/${taskId}/reopen/`,
        { method: "POST" },
      );
      if (activeTask.value?.id === taskId) activeTask.value = result;
      await Promise.all([loadItems(), loadTasks()]);
      ElMessage.success(i18n.global.t("inventory.taskReopened"));
      if (itemListError.value || taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.taskReopenRefreshFailed"));
      }
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : i18n.global.t("inventory.taskReopenFailed"));
    } finally {
      taskReopening.value = false;
    }
  }

  async function exportTask(task = activeTask.value) {
    if (!context.can("inventory.export") || !task || exportingTaskId.value !== null) return;
    exportingTaskId.value = task.id;
    const params = activeTask.value?.id === task.id ? itemQueryParams(false) : new URLSearchParams();
    const query = buildExportQuery(params);
    try {
      await context.downloadFile(
        `/inventory-tasks/${task.id}/export/${query ? `?${query}` : ""}`,
        String(i18n.global.t("inventory.exportFilename")),
      );
    } catch (error) {
      const normalized = normalizeApiError(error);
      ElMessage.error(normalized.kind === "unknown" ? i18n.global.t("inventory.exportFailed") : normalized.message);
    } finally {
      if (exportingTaskId.value === task.id) exportingTaskId.value = null;
    }
  }

  function emptyItemLocation() {
    return { actual_rack: "", actual_start_u: "", actual_end_u: "" };
  }

  function systemLocationFor(item: InventoryItem | null | undefined) {
    if (
      !item?.system_rack_code ||
      item.system_start_u == null ||
      item.system_end_u == null
    ) {
      return emptyItemLocation();
    }

    const candidates = activeRacks.value.filter((rack) => rack.code === item.system_rack_code);
    const rack = candidates.find(
      (candidate) =>
        candidate.server_room_name === item.system_server_room &&
        candidate.data_center_name === item.system_data_center,
    ) || (candidates.length === 1 ? candidates[0] : null);
    if (!rack) return emptyItemLocation();

    return {
      actual_rack: String(rack.id),
      actual_start_u: String(item.system_start_u),
      actual_end_u: String(item.system_end_u),
    };
  }

  function clearItemLocation() {
    Object.assign(itemForm.value, emptyItemLocation());
  }

  function applySystemLocation(item: InventoryItem | null | undefined = editingItem.value) {
    Object.assign(itemForm.value, systemLocationFor(item));
  }

  async function initializeItem(item: InventoryItem) {
    if (!canRecordInventory(item)) return false;
    if (!racks.value.length) await loadRacks();
    if (itemAuxError.value) return false;
    editingItem.value = item;
    const initialLocation =
      item.status === "normal"
        ? systemLocationFor(item)
        : item.status === "pending" || item.status === "not_found"
          ? emptyItemLocation()
          : {
              actual_rack: item.actual_rack ? String(item.actual_rack) : "",
              actual_start_u: item.actual_start_u == null ? "" : String(item.actual_start_u),
              actual_end_u: item.actual_end_u == null ? "" : String(item.actual_end_u),
            };
    itemForm.value = {
      // A pending item must be explicitly assigned a result.  Treating it as
      // normal on open makes an accidental save look like a verified result.
      status: item.status === "pending" ? "" : item.status,
      ...initialLocation,
      notes: item.notes || "",
    };
    itemDialogError.value = "";
    showItemDialog.value = true;
    return true;
  }

  async function openItem(item: InventoryItem) {
    await initializeItem(item);
  }

  function openResolution(item: InventoryItem) {
    if (!isExceptionStatus(item.status)) return;
    if (activeTask.value?.id !== item.task) return;
    if (item.resolution_status === "pending" && !canResolveInventoryAnomaly(item)) return;
    if (item.resolution_status === "resolved" && !context.can("inventory.view")) return;
    if (!["pending", "resolved"].includes(item.resolution_status)) return;
    resolutionItem.value = item;
    resolutionForm.value = {
      action: item.resolution_action || "",
      note: item.resolution_note || "",
    };
    resolutionDialogError.value = "";
    showResolutionDialog.value = true;
  }

  function closeResolutionDialog() {
    if (resolutionSaving.value) return;
    showResolutionDialog.value = false;
    resolutionDialogError.value = "";
    resolutionItem.value = null;
    resolutionForm.value = { action: "", note: "" };
  }

  async function saveResolution() {
    const item = resolutionItem.value;
    const action = resolutionForm.value.action;
    if (!item || resolutionSaving.value) return false;
    resolutionDialogError.value = "";
    if (!context.can("inventory.manage")) {
      ElMessage.error(i18n.global.t("inventory.resolutionPermissionDenied"));
      return false;
    }
    if (!canResolveInventoryAnomaly(item)) {
      ElMessage.warning(i18n.global.t("inventory.invalidResolutionAction"));
      return false;
    }
    const allowedActions = resolutionActionOptions(item).map((option) => option.value);
    if (item.resolution_status !== "pending" || !action || !allowedActions.includes(action)) {
      ElMessage.warning(i18n.global.t("inventory.invalidResolutionAction"));
      return false;
    }
    if (action === "ignore" && !resolutionForm.value.note.trim()) {
      ElMessage.warning(i18n.global.t("inventory.ignoreNoteRequired"));
      return false;
    }

    const taskId = item.task;
    const assetId = item.asset;
    resolutionSaving.value = true;
    try {
      await context.request<InventoryItem>(`/inventory-items/${item.id}/resolve/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: resolutionForm.value.note }),
      });
      showResolutionDialog.value = false;
      resolutionItem.value = null;
      resolutionForm.value = { action: "", note: "" };
      const [itemsLoaded, taskLoaded] = await Promise.all([
        loadItems(),
        refreshActiveTask(taskId),
        loadTasks(),
      ]);
      let detailRefresh: boolean | null = null;
      if (action === "update_asset" && context.refreshOpenAssetDetail) {
        try {
          detailRefresh = await context.refreshOpenAssetDetail(assetId);
        } catch {
          detailRefresh = false;
        }
      }
      ElMessage.success(i18n.global.t("inventory.exceptionProcessed"));
      if (!itemsLoaded || !taskLoaded || itemListError.value || taskDetailError.value || taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.exceptionProcessRefreshFailed"));
      }
      if (detailRefresh === false) {
        ElMessage.warning(i18n.global.t("inventory.exceptionDetailRefreshFailed"));
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const errorCode = error instanceof ApiError && error.details && typeof error.details === "object"
        ? String((error.details as { code?: unknown }).code || "")
        : "";
      if (errorCode === "inventory_item_already_resolved") {
        const [itemsLoaded, taskLoaded] = await Promise.all([
          loadItems(),
          refreshActiveTask(taskId),
          loadTasks(),
        ]);
        showResolutionDialog.value = false;
        resolutionItem.value = null;
        resolutionForm.value = { action: "", note: "" };
        ElMessage.warning(
          itemsLoaded && taskLoaded
            ? i18n.global.t("inventory.exceptionAlreadyProcessed")
            : i18n.global.t("inventory.exceptionAlreadyProcessedRefreshFailed"),
        );
        return false;
      }
      resolutionDialogError.value = message || i18n.global.t("inventory.exceptionProcessFailed");
      ElMessage.error(resolutionDialogError.value);
      return false;
    } finally {
      resolutionSaving.value = false;
    }
  }

  function resetBulkResolutionDialog() {
    showBulkResolutionDialog.value = false;
    bulkResolutionAction.value = "";
    bulkResolutionCount.value = 0;
    bulkResolutionForm.value = { note: "" };
    bulkResolutionResult.value = null;
    bulkResolutionDialogError.value = "";
  }

  function openBulkResolution(action: InventoryResolutionAction) {
    if (!context.can("inventory.manage") || batchSelectionMode.value !== "resolution" || !selectedBatchItems.value.length) return;
    if (!batchResolutionActionOptions().some((option) => option.value === action)) {
      ElMessage.warning(i18n.global.t("inventory.unsupportedBulkAction"));
      return;
    }
    bulkResolutionAction.value = action;
    bulkResolutionCount.value = selectedBatchItems.value.length;
    bulkResolutionForm.value = { note: "" };
    bulkResolutionResult.value = null;
    bulkResolutionDialogError.value = "";
    showBulkResolutionDialog.value = true;
  }

  function closeBulkResolutionDialog() {
    if (bulkResolutionSaving.value) return;
    resetBulkResolutionDialog();
  }

  async function saveBulkResolution() {
    const action = bulkResolutionAction.value;
    const selectedItems = selectedBatchItems.value;
    if (!action || !selectedItems.length || bulkResolutionSaving.value) return false;
    bulkResolutionDialogError.value = "";
    if (!context.can("inventory.manage")) {
      ElMessage.error(i18n.global.t("inventory.resolutionPermissionDenied"));
      return false;
    }
    if (!batchResolutionActionOptions(selectedItems).some((option) => option.value === action)) {
      ElMessage.warning(i18n.global.t("inventory.unsupportedBulkAction"));
      return false;
    }
    if (action === "ignore" && !bulkResolutionForm.value.note.trim()) {
      ElMessage.warning(i18n.global.t("inventory.ignoreNoteRequired"));
      return false;
    }

    const taskId = activeTask.value?.id;
    if (!taskId) return false;
    const itemIds = selectedItems.map((item) => item.id);
    bulkResolutionSaving.value = true;
    try {
      const result = await context.request<InventoryBulkResolutionResponse>(
        "/inventory-items/bulk-resolve/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_ids: itemIds,
            action,
            note: bulkResolutionForm.value.note,
          }),
        },
      );
      bulkResolutionResult.value = result;
      clearBatchSelection();
      const [itemsLoaded, taskDetailLoaded] = await Promise.all([
        loadItems(),
        refreshActiveTask(taskId),
        loadTasks(),
      ]);
      const refreshFailed = !itemsLoaded || !taskDetailLoaded ||
        Boolean(itemListError.value || taskDetailError.value || taskListError.value);
      if (result.failed === 0) {
        if (refreshFailed) {
          ElMessage.warning(i18n.global.t("inventory.bulkProcessRefreshFailed"));
        } else {
          ElMessage.success(i18n.global.t("inventory.bulkProcessed", { count: result.succeeded }));
        }
      } else {
        ElMessage.warning(
          refreshFailed
            ? i18n.global.t("inventory.bulkProcessedPartialRefreshFailed", { succeeded: result.succeeded, failed: result.failed })
            : i18n.global.t("inventory.bulkProcessedPartial", { succeeded: result.succeeded, failed: result.failed }),
        );
      }
      return true;
    } catch (error) {
      bulkResolutionDialogError.value = error instanceof Error ? error.message : i18n.global.t("inventory.bulkProcessFailed");
      ElMessage.error(bulkResolutionDialogError.value);
      return false;
    } finally {
      bulkResolutionSaving.value = false;
    }
  }

  function resetBulkNormalDialog() {
    showBulkNormalDialog.value = false;
    bulkNormalCount.value = 0;
    bulkNormalResult.value = null;
    bulkNormalDialogError.value = "";
  }

  function openBulkNormal() {
    if (!context.can("inventory.manage") || batchSelectionMode.value !== "inventory" || !selectedBatchItems.value.length) return;
    if (activeTask.value?.status !== "in_progress") {
      ElMessage.warning(i18n.global.t("inventory.completedTaskCannotMark"));
      return;
    }
    if (selectedBatchItems.value.some((item) => !isInventoryBatchSelectable(item))) {
      ElMessage.warning(i18n.global.t("inventory.selectedItemsChanged"));
      clearBatchSelection();
      return;
    }
    bulkNormalCount.value = selectedBatchItems.value.length;
    bulkNormalResult.value = null;
    bulkNormalDialogError.value = "";
    showBulkNormalDialog.value = true;
  }

  function closeBulkNormalDialog() {
    if (bulkNormalSaving.value) return;
    resetBulkNormalDialog();
  }

  async function saveBulkNormal() {
    const selectedItems = selectedBatchItems.value;
    if (
      batchSelectionMode.value !== "inventory" ||
      !selectedItems.length ||
      bulkNormalSaving.value
    ) return false;
    bulkNormalDialogError.value = "";
    if (!context.can("inventory.manage")) {
      ElMessage.error(i18n.global.t("inventory.inventoryPermissionDenied"));
      return false;
    }
    if (
      activeTask.value?.status !== "in_progress" ||
      selectedItems.some((item) => !isInventoryBatchSelectable(item))
    ) {
      ElMessage.warning(i18n.global.t("inventory.selectedItemsChanged"));
      clearBatchSelection();
      return false;
    }

    const taskId = activeTask.value.id;
    bulkNormalSaving.value = true;
    try {
      const result = await context.request<InventoryBulkNormalResponse>(
        "/inventory-items/bulk-confirm-normal/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_ids: selectedItems.map((item) => item.id) }),
        },
      );
      bulkNormalResult.value = result;
      clearBatchSelection();
      const [itemsLoaded, taskDetailLoaded] = await Promise.all([
        loadItems(),
        refreshActiveTask(taskId),
        loadTasks(),
      ]);
      const refreshFailed = !itemsLoaded || !taskDetailLoaded ||
        Boolean(itemListError.value || taskDetailError.value || taskListError.value);
      if (result.failed === 0) {
        if (refreshFailed) {
          ElMessage.warning(i18n.global.t("inventory.bulkNormalRefreshFailed"));
        } else {
          ElMessage.success(i18n.global.t("inventory.bulkNormalCompleted", { count: result.succeeded }));
        }
      } else {
        ElMessage.warning(
          refreshFailed
            ? i18n.global.t("inventory.bulkNormalPartialRefreshFailed", { succeeded: result.succeeded, failed: result.failed })
            : i18n.global.t("inventory.bulkNormalPartial", { succeeded: result.succeeded, failed: result.failed }),
        );
      }
      return true;
    } catch (error) {
      bulkNormalDialogError.value = error instanceof Error ? error.message : i18n.global.t("inventory.bulkNormalFailed");
      ElMessage.error(bulkNormalDialogError.value);
      return false;
    } finally {
      bulkNormalSaving.value = false;
    }
  }

  function changeItemStatus() {
    if (itemForm.value.status === "normal" || itemForm.value.status === "info_mismatch") {
      applySystemLocation();
    } else if (
      itemForm.value.status === "not_found" ||
      itemForm.value.status === "location_mismatch" ||
      !itemForm.value.status
    ) {
      clearItemLocation();
    }
  }

  type ItemSaveContext = {
    taskId: number;
    itemId: number;
    itemIndex: number;
    page: number;
    pageSize: number;
    search: string;
    status: string;
    total: number;
  };

  function captureItemSaveContext(): ItemSaveContext | null {
    if (!activeTask.value || !editingItem.value) return null;
    return {
      taskId: activeTask.value.id,
      itemId: editingItem.value.id,
      itemIndex: Math.max(0, items.value.findIndex((item) => item.id === editingItem.value?.id)),
      page: itemPage.value,
      pageSize: itemPageSize.value,
      search: itemSearch.value,
      status: itemStatus.value,
      total: itemCount.value,
    };
  }

  async function persistInventoryItem() {
    if (!context.can("inventory.manage")) {
      throw new Error(i18n.global.t("inventory.inventoryPermissionDenied"));
    }
    if (!editingItem.value || !activeTask.value || !itemForm.value.status) {
      throw new Error(i18n.global.t("inventory.itemResultRequired"));
    }
    if (!canRecordInventory(editingItem.value)) {
      throw new Error(i18n.global.t("inventory.completedTaskReadOnly"));
    }
    const taskId = activeTask.value.id;
    const itemId = editingItem.value.id;
    const location =
      itemForm.value.status === "normal"
        ? systemLocationFor(editingItem.value)
        : itemForm.value.status === "not_found"
          ? emptyItemLocation()
          : itemForm.value;
    await context.request(`/inventory-items/${itemId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: itemForm.value.status,
        actual_rack: location.actual_rack
          ? Number(location.actual_rack)
          : null,
        actual_start_u: location.actual_start_u
          ? Number(location.actual_start_u)
          : null,
        actual_end_u: location.actual_end_u
          ? Number(location.actual_end_u)
          : null,
        notes: itemForm.value.notes,
      }),
    });
    return { taskId, itemId };
  }

  async function saveItem() {
    if (!context.can("inventory.manage") || !editingItem.value || itemSaving.value) return false;
    itemDialogError.value = "";
    itemSaving.value = true;
    try {
      const saved = await persistInventoryItem();
      showItemDialog.value = false;
      const [itemsLoaded] = await Promise.all([
        loadItems(),
        loadTasks(),
        refreshActiveTask(saved.taskId),
      ]);
      ElMessage.success(i18n.global.t("inventory.itemSaved"));
      if (!itemsLoaded || itemListError.value || taskListError.value || taskDetailError.value) {
        ElMessage.warning(i18n.global.t("inventory.itemSavedRefreshFailed"));
      }
      return true;
    } catch (error) {
      itemDialogError.value = error instanceof Error ? error.message : i18n.global.t("inventory.itemSaveFailed");
      ElMessage.error(itemDialogError.value);
      return false;
    } finally {
      itemSaving.value = false;
    }
  }

  async function saveItemAndNext() {
    if (!context.can("inventory.manage") || !editingItem.value || itemSaving.value) return false;
    const savedContext = captureItemSaveContext();
    if (!savedContext) return false;
    itemDialogError.value = "";
    itemSaving.value = true;
    try {
      const saved = await persistInventoryItem();
      const itemsLoaded = await loadItems();
      // Summary refresh is useful, but it must not block the next item.  Its
      // own error state remains visible in the task shell if it fails.
      void Promise.allSettled([loadTasks(), refreshActiveTask(saved.taskId)]);
      if (!itemsLoaded || itemListError.value || activeTask.value?.id !== savedContext.taskId) {
        showItemDialog.value = false;
        ElMessage.warning(i18n.global.t("inventory.itemSavedNextFailed"));
        return true;
      }

      const currentIndex = items.value.findIndex((item) => item.id === savedContext.itemId);
      let nextItem = currentIndex >= 0
        ? items.value[currentIndex + 1]
        : items.value[savedContext.itemIndex];

      // When the current item remains on the page and is the last row, the
      // successor is the first row of the next server page.  loadItems keeps
      // the existing page correction and request cancellation semantics.
      if (!nextItem && itemCount.value > itemPage.value * itemPageSize.value) {
        itemPage.value += 1;
        const nextPageLoaded = await loadItems();
        if (!nextPageLoaded || itemListError.value) {
          showItemDialog.value = false;
          ElMessage.warning(i18n.global.t("inventory.itemSavedNextFailed"));
          return true;
        }
        nextItem = items.value[0];
      }

      if (!nextItem) {
        showItemDialog.value = false;
        ElMessage.success(i18n.global.t("inventory.itemSavedAll"));
        return true;
      }

      const initialized = await initializeItem(nextItem);
      if (!initialized) {
        showItemDialog.value = false;
        ElMessage.warning(i18n.global.t("inventory.itemSavedNextFailed"));
        return true;
      }
      return true;
    } catch (error) {
      itemDialogError.value = error instanceof Error ? error.message : i18n.global.t("inventory.itemSaveFailed");
      ElMessage.error(itemDialogError.value);
      return false;
    } finally {
      itemSaving.value = false;
    }
  }

  function changeTaskPage(page: number) {
    taskPage.value = page;
    void loadTasks();
  }
  function changeTaskPageSize(size: number) {
    taskPageSize.value = size;
    taskPage.value = 1;
    void loadTasks();
  }
  function changeItemPage(page: number) {
    itemPage.value = page;
    void loadItems();
  }
  function changeItemPageSize(size: number) {
    itemPageSize.value = size;
    itemPage.value = 1;
    void loadItems();
  }
  function resetTaskFilters() {
    taskSearch.value = "";
    taskStatus.value = "";
    taskDataCenter.value = "";
    taskRoom.value = "";
    taskPage.value = 1;
    void loadTasks();
  }
  function resetItemFilters() {
    itemSearch.value = "";
    itemStatus.value = "";
    itemResolutionStatus.value = "";
    itemPage.value = 1;
    void loadItems();
  }
  function retryTaskAuxData() {
    void Promise.allSettled([loadRooms(), loadInspectors()]);
  }
  function retryRackAuxData() {
    void loadRacks();
  }
  function retryActiveTask() {
    void refreshActiveTask();
  }
  async function loadInitialData() {
    await Promise.allSettled([loadTasks(), loadRooms(), loadInspectors()]);
  }

  onBeforeUnmount(clearScopePreview);

  return {
    taskListLoading,
    taskListError,
    itemListLoading,
    itemListError,
    taskDetailLoading,
    taskDetailError,
    auxLoading,
    auxError,
    taskAuxError,
    itemAuxError,
    taskCreating,
    taskDeletingId,
    taskCompleting,
    taskReopening,
    itemSaving,
    scannedNormalSaving,
    resolutionSaving,
    bulkResolutionSaving,
    bulkNormalSaving,
    taskDialogError,
    itemDialogError,
    resolutionDialogError,
    bulkResolutionDialogError,
    bulkNormalDialogError,
    exportingTaskId,
    tasks,
    taskCount,
    taskPage,
    taskPageSize,
    taskSearch,
    taskStatus,
    taskDataCenter,
    taskRoom,
    taskHasFilters,
    activeTask,
    items,
    itemCount,
    itemPage,
    itemPageSize,
    itemSearch,
    itemStatus,
    itemResolutionStatus,
    scannedItemId,
    scanError,
    selectedBatchItems,
    batchSelectionMode,
    itemHasFilters,
    inspectors,
    racks,
    showTaskDialog,
    showItemDialog,
    showResolutionDialog,
    showBulkResolutionDialog,
    showBulkNormalDialog,
    editingItem,
    resolutionItem,
    scopePreview,
    scopePreviewLoading,
    scopePreviewError,
    taskForm,
    itemForm,
    resolutionForm,
    bulkResolutionAction,
    bulkResolutionCount,
    bulkResolutionForm,
    bulkResolutionResult,
    bulkNormalCount,
    bulkNormalResult,
    activeDataCenters,
    activeRooms,
    taskFilterRooms,
    activeRacks,
    taskStatusOptions,
    itemStatusOptions,
    itemResultOptions,
    itemResolutionStatusOptions,
    taskStatusLabel,
    formatDateTime,
    locationText,
    statusTagType,
    isExceptionStatus,
    canRecordInventory,
    canResolveInventoryAnomaly,
    isBatchSelectable,
    onBatchSelectionChange,
    batchSelectionModeFor,
    isBatchSelectableForMode,
    clearBatchSelection,
    resolutionStatusLabel,
    resolutionStatusTagType,
    resolutionActionLabel,
    hasCompleteActualLocation,
    resolutionActionOptions,
    batchResolutionActionOptions,
    taskScope,
    loadRooms,
    loadInspectors,
    loadRacks,
    loadTasks,
    loadItems,
    locateScannedAsset,
    clearScannedAsset,
    confirmItemNormal,
    refreshActiveTask,
    retryActiveTask,
    openTask,
    closeTask,
    openNewTask,
    changeTaskDataCenter,
    changeTaskServerRoom,
    loadScopePreview,
    retryScopePreview,
    clearScopePreview,
    closeTaskDialog,
    saveTask,
    deleteTask,
    completeTask,
    reopenTask,
    exportTask,
    openItem,
    openResolution,
    closeResolutionDialog,
    saveResolution,
    openBulkResolution,
    closeBulkResolutionDialog,
    saveBulkResolution,
    openBulkNormal,
    closeBulkNormalDialog,
    saveBulkNormal,
    changeItemStatus,
    saveItem,
    saveItemAndNext,
    changeTaskPage,
    changeTaskPageSize,
    changeItemPage,
    changeItemPageSize,
    resetTaskFilters,
    resetItemFilters,
    retryTaskAuxData,
    retryRackAuxData,
    loadInitialData,
  };
}
