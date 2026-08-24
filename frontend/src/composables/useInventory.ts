import { computed, onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { buildExportQuery, pageItems, pageTotal, type PageResult } from "../api";
import type {
  InventoryBulkNormalResponse,
  InventoryBulkResolutionResponse,
  InventoryInspector,
  InventoryItem,
  InventoryResolutionAction,
  InventoryResolutionStatus,
  InventoryScopePreview,
  InventoryTask,
  InventoryStatus,
  Rack,
  ServerRoom,
} from "../types";
import type { InventoryContext } from "../types/page-context";

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
  const resolutionSaving = ref(false);
  const bulkResolutionSaving = ref(false);
  const bulkNormalSaving = ref(false);
  const exportingTaskId = ref<number | null>(null);

  const tasks = ref<InventoryTask[]>([]);
  const taskCount = ref(0);
  const taskPage = ref(1);
  const taskPageSize = ref(20);
  const taskSearch = ref("");
  const taskStatus = ref("");
  const taskDataCenter = ref("");
  const taskRoom = ref("");
  const activeTask = ref<InventoryTask | null>(null);
  const items = ref<InventoryItem[]>([]);
  const itemCount = ref(0);
  const itemPage = ref(1);
  const itemPageSize = ref(50);
  const itemSearch = ref("");
  const itemStatus = ref("");
  const itemResolutionStatus = ref<InventoryResolutionStatus | "">("");
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
  const taskStatusOptions = [
    { label: "进行中", value: "in_progress" },
    { label: "已完成", value: "completed" },
  ];
  const itemStatusOptions = [
    { label: "未盘点", value: "pending" },
    { label: "正常", value: "normal" },
    { label: "位置不符", value: "location_mismatch" },
    { label: "未找到", value: "not_found" },
    { label: "设备信息不符", value: "info_mismatch" },
    { label: "其他异常", value: "other" },
  ];
  const itemResultOptions = itemStatusOptions.filter((item) => item.value !== "pending");
  const itemResolutionStatusOptions = [
    { label: "待处理", value: "pending" as const },
    { label: "已处理", value: "resolved" as const },
  ];
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
  // Kept as a compatibility aggregate for any page-level consumers. Tables use
  // their own loading state so opening a dialog never hides a list.
  const loading = computed(
    () =>
      taskListLoading.value ||
      itemListLoading.value ||
      taskDetailLoading.value ||
      auxLoading.value,
  );

  function taskStatusLabel(status: string) {
    return taskStatusOptions.find((item) => item.value === status)?.label || status;
  }
  function formatDateTime(value?: string | null) {
    return value ? new Date(value).toLocaleString("zh-CN") : "—";
  }
  function locationText(item: InventoryItem, actual = false) {
    const dc = actual ? item.actual_data_center : item.system_data_center;
    const room = actual ? item.actual_server_room : item.system_server_room;
    const rack = actual ? item.actual_rack_code : item.system_rack_code;
    const start = actual ? item.actual_start_u : item.system_start_u;
    const end = actual ? item.actual_end_u : item.system_end_u;
    const location = [dc, room, rack].filter(Boolean).join(" / ");
    const u = start != null ? `U${start}–U${end}` : "未上架";
    return location ? `${location} · ${u}` : u;
  }
  function statusTagType(status: string) {
    return ({
      pending: "info",
      normal: "success",
      location_mismatch: "warning",
      not_found: "danger",
      info_mismatch: "danger",
      other: "warning",
    } as Record<string, "success" | "warning" | "danger" | "info">)[status] || "info";
  }
  function isExceptionStatus(status: string) {
    return !["pending", "normal"].includes(status);
  }
  function isInventoryBatchSelectable(item: InventoryItem) {
    return context.can("inventory.manage") &&
      activeTask.value?.status === "in_progress" &&
      item.status === "pending";
  }
  function isResolutionBatchSelectable(item: InventoryItem) {
    return context.can("inventory.manage") &&
      isExceptionStatus(item.status) &&
      item.resolution_status === "pending";
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
    return ({
      not_required: "—",
      pending: "待处理",
      resolved: "已处理",
    } as Record<string, string>)[status] || status || "—";
  }
  function resolutionStatusTagType(status: string) {
    return ({
      not_required: "info",
      pending: "warning",
      resolved: "success",
    } as Record<string, "success" | "warning" | "danger" | "info">)[status] || "info";
  }
  function resolutionActionLabel(action: string | null | undefined) {
    return ({
      update_asset: "更新资产台账",
      keep_asset: "保持资产台账",
      confirm_missing: "确认设备缺失",
      ignore: "忽略 / 误报",
    } as Record<string, string>)[action || ""] || "—";
  }
  function batchResolutionActionOptions(items = selectedBatchItems.value) {
    if (
      batchSelectionMode.value !== "resolution" ||
      !items.length ||
      items.some((item) => !isBatchSelectableForMode(item, "resolution"))
    ) return [];
    const options: Array<{ label: string; value: InventoryResolutionAction }> = [
      { label: "保持当前台账", value: "keep_asset" },
      { label: "忽略 / 误报", value: "ignore" },
    ];
    if (items.every((item) => item.status === "not_found")) {
      options.unshift({ label: "确认设备缺失", value: "confirm_missing" });
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
      options.push({ label: "更新资产台账", value: "update_asset" });
    }
    if (item.status === "not_found") {
      options.push({ label: "确认设备缺失", value: "confirm_missing" });
    }
    options.push({ label: "保持当前台账", value: "keep_asset" });
    options.push({ label: "忽略 / 误报", value: "ignore" });
    return options;
  }
  function taskScope(task: InventoryTask) {
    return task.server_room_name
      ? `${task.data_center_name} / ${task.server_room_name}`
      : `${task.data_center_name} / 整个数据中心`;
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
        scopePreviewError.value = error instanceof Error ? error.message : "盘点范围加载失败";
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

  async function loadRooms() {
    const { id, controller } = beginAuxRequest("rooms");
    try {
      const result = await context.request<PageResult<ServerRoom> | ServerRoom[]>(
        "/server-rooms/?page_size=100&is_active=true",
        { signal: controller.signal },
      );
      if (id !== auxRequestIds.rooms || controller.signal.aborted || !result) return;
      context.serverRooms.value = pageItems(result);
    } catch (error) {
      if (id === auxRequestIds.rooms && !controller.signal.aborted) {
        auxErrors.value.rooms = error instanceof Error ? error.message : "机房数据加载失败";
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
        auxErrors.value.inspectors = error instanceof Error ? error.message : "盘点人数据加载失败";
      }
    } finally {
      finishAuxRequest();
    }
  }

  async function loadRacks() {
    const { id, controller } = beginAuxRequest("racks");
    try {
      const result = await context.request<PageResult<Rack> | Rack[]>(
        "/racks/?page_size=100&is_active=true",
        { signal: controller.signal },
      );
      if (id !== auxRequestIds.racks || controller.signal.aborted || !result) return;
      racks.value = pageItems(result);
    } catch (error) {
      if (id === auxRequestIds.racks && !controller.signal.aborted) {
        auxErrors.value.racks = error instanceof Error ? error.message : "机柜数据加载失败";
      }
    } finally {
      finishAuxRequest();
    }
  }

  async function loadTasks(corrected = false) {
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
        taskListError.value = error instanceof Error ? error.message : "盘点任务加载失败";
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
    if (!activeTask.value) return false;
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
        itemListError.value = error instanceof Error ? error.message : "盘点设备加载失败";
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
    if (!taskId || activeTask.value?.id !== taskId) return false;
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
        taskDetailError.value = error instanceof Error ? error.message : "盘点任务详情加载失败";
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
        taskDetailError.value = error instanceof Error ? error.message : "盘点任务加载失败";
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
    clearScopePreview();
  }

  async function saveTask() {
    if (taskCreating.value) return false;
    if (
      !taskForm.value.name.trim() ||
      !taskForm.value.data_center ||
      !taskForm.value.start_at ||
      !taskForm.value.end_at
    ) {
      ElMessage.warning("请填写盘点名称、数据中心和起止时间");
      return false;
    }
    const startAt = new Date(taskForm.value.start_at).getTime();
    const endAt = new Date(taskForm.value.end_at).getTime();
    if (Number.isNaN(startAt) || Number.isNaN(endAt) || startAt > endAt) {
      ElMessage.warning("开始时间不能晚于结束时间");
      return false;
    }
    if (scopePreviewLoading.value) {
      ElMessage.warning("正在计算盘点范围，请稍候");
      return false;
    }
    if (scopePreviewError.value || !scopePreview.value) {
      ElMessage.warning("盘点范围加载失败，请先重新加载范围");
      return false;
    }
    if (scopePreview.value.total <= 0) {
      ElMessage.warning("当前范围内没有可盘点资产，无法创建任务");
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
      ElMessage.success(`盘点任务已创建，共 ${createdTask.summary.total} 台资产`);
      taskPage.value = 1;
      await loadTasks();
      if (taskListError.value) {
        ElMessage.warning("盘点任务已创建，但列表刷新失败，请稍后重试");
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务创建失败");
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
      `删除后会同时删除尚未填写盘点结果的明细，且无法恢复。确定删除任务“${task.name}”吗？`,
      "删除盘点任务",
      { type: "warning" },
    ).catch(() => false);
    if (!ok || taskDeletingId.value !== null) return false;

    taskDeletingId.value = task.id;
    try {
      await context.request(`/inventory-tasks/${task.id}/`, { method: "DELETE" });
      await loadTasks();
      ElMessage.success("盘点任务已删除");
      if (taskListError.value) {
        ElMessage.warning("盘点任务已删除，但列表刷新失败，请稍后重试");
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务删除失败");
      return false;
    } finally {
      taskDeletingId.value = null;
    }
  }

  async function completeTask() {
    if (!activeTask.value || taskCompleting.value) return;
    if (activeTask.value.summary.pending > 0) {
      ElMessage.warning(`仍有 ${activeTask.value.summary.pending} 项未盘点，暂时不能完成任务`);
      return;
    }
    const ok = await ElMessageBox.confirm(
      "完成后盘点结果将锁定，确定完成此任务吗？",
      "完成盘点任务",
      { type: "warning" },
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
          ? `盘点任务已完成，仍有 ${resolutionPending} 条异常待处理`
          : "盘点任务已完成",
      );
      if (itemListError.value || taskListError.value) {
        ElMessage.warning("盘点任务已完成，但部分数据刷新失败，请稍后重试");
      }
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务无法完成");
    } finally {
      taskCompleting.value = false;
    }
  }

  async function reopenTask() {
    if (!activeTask.value || taskReopening.value) return;
    const taskId = activeTask.value.id;
    taskReopening.value = true;
    try {
      const result = await context.request<InventoryTask>(
        `/inventory-tasks/${taskId}/reopen/`,
        { method: "POST" },
      );
      if (activeTask.value?.id === taskId) activeTask.value = result;
      await Promise.all([loadItems(), loadTasks()]);
      ElMessage.success("盘点任务已重新打开");
      if (itemListError.value || taskListError.value) {
        ElMessage.warning("盘点任务已重新打开，但部分数据刷新失败，请稍后重试");
      }
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务重新打开失败");
    } finally {
      taskReopening.value = false;
    }
  }

  async function exportTask(task = activeTask.value) {
    if (!task || exportingTaskId.value !== null) return;
    exportingTaskId.value = task.id;
    const params = activeTask.value?.id === task.id ? itemQueryParams(false) : new URLSearchParams();
    const query = buildExportQuery(params);
    try {
      await context.downloadFile(
        `/inventory-tasks/${task.id}/export/${query ? `?${query}` : ""}`,
        "盘点结果.xlsx",
      );
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "导出失败，请稍后重试");
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
    if (!activeTask.value || activeTask.value.status === "completed") return false;
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
    showItemDialog.value = true;
    return true;
  }

  async function openItem(item: InventoryItem) {
    await initializeItem(item);
  }

  function openResolution(item: InventoryItem) {
    if (!isExceptionStatus(item.status)) return;
    if (item.resolution_status === "pending" && !context.can("inventory.manage")) return;
    if (item.resolution_status === "resolved" && !context.can("inventory.view")) return;
    if (!["pending", "resolved"].includes(item.resolution_status)) return;
    resolutionItem.value = item;
    resolutionForm.value = {
      action: item.resolution_action || "",
      note: item.resolution_note || "",
    };
    showResolutionDialog.value = true;
  }

  function closeResolutionDialog() {
    if (resolutionSaving.value) return;
    showResolutionDialog.value = false;
    resolutionItem.value = null;
    resolutionForm.value = { action: "", note: "" };
  }

  async function saveResolution() {
    const item = resolutionItem.value;
    const action = resolutionForm.value.action;
    if (!item || resolutionSaving.value) return false;
    if (!context.can("inventory.manage")) {
      ElMessage.error("当前账号没有处理盘点异常的权限");
      return false;
    }
    const allowedActions = resolutionActionOptions(item).map((option) => option.value);
    if (item.resolution_status !== "pending" || !action || !allowedActions.includes(action)) {
      ElMessage.warning("请选择有效的异常处理方式");
      return false;
    }
    if (action === "ignore" && !resolutionForm.value.note.trim()) {
      ElMessage.warning("忽略异常时必须填写处理备注");
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
      ElMessage.success("盘点异常已处理");
      if (!itemsLoaded || !taskLoaded || itemListError.value || taskDetailError.value || taskListError.value) {
        ElMessage.warning("异常已处理，但页面数据刷新失败，请重新加载");
      }
      if (detailRefresh === false) {
        ElMessage.warning("异常已处理，但资产详情刷新失败");
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("已被处理")) {
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
            ? "该异常已被处理，已刷新最新状态"
            : "该异常已被处理，但当前页面刷新失败，请重新加载",
        );
        return false;
      }
      ElMessage.error(message || "盘点异常处理失败");
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
  }

  function openBulkResolution(action: InventoryResolutionAction) {
    if (batchSelectionMode.value !== "resolution" || !selectedBatchItems.value.length) return;
    if (!batchResolutionActionOptions().some((option) => option.value === action)) {
      ElMessage.warning("当前选中的盘点异常不支持该批量处理方式");
      return;
    }
    bulkResolutionAction.value = action;
    bulkResolutionCount.value = selectedBatchItems.value.length;
    bulkResolutionForm.value = { note: "" };
    bulkResolutionResult.value = null;
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
    if (!context.can("inventory.manage")) {
      ElMessage.error("当前账号没有处理盘点异常的权限");
      return false;
    }
    if (!batchResolutionActionOptions(selectedItems).some((option) => option.value === action)) {
      ElMessage.warning("当前选中的盘点异常不支持该批量处理方式");
      return false;
    }
    if (action === "ignore" && !bulkResolutionForm.value.note.trim()) {
      ElMessage.warning("忽略异常时必须填写处理备注");
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
        resetBulkResolutionDialog();
        if (refreshFailed) {
          ElMessage.warning("批量处理已完成，但页面数据刷新失败，请重新加载");
        } else {
          ElMessage.success(`已处理 ${result.succeeded} 条盘点异常`);
        }
      } else {
        ElMessage.warning(
          refreshFailed
            ? `成功处理 ${result.succeeded} 条，${result.failed} 条失败；页面数据刷新失败，请重新加载`
            : `成功处理 ${result.succeeded} 条，${result.failed} 条失败`,
        );
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "批量盘点异常处理失败");
      return false;
    } finally {
      bulkResolutionSaving.value = false;
    }
  }

  function resetBulkNormalDialog() {
    showBulkNormalDialog.value = false;
    bulkNormalCount.value = 0;
    bulkNormalResult.value = null;
  }

  function openBulkNormal() {
    if (batchSelectionMode.value !== "inventory" || !selectedBatchItems.value.length) return;
    if (activeTask.value?.status !== "in_progress") {
      ElMessage.warning("已完成的盘点任务不能批量标记为正常");
      return;
    }
    if (selectedBatchItems.value.some((item) => !isInventoryBatchSelectable(item))) {
      ElMessage.warning("当前选中的盘点项已发生变化，请重新选择");
      clearBatchSelection();
      return;
    }
    bulkNormalCount.value = selectedBatchItems.value.length;
    bulkNormalResult.value = null;
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
    if (!context.can("inventory.manage")) {
      ElMessage.error("当前账号没有管理盘点的权限");
      return false;
    }
    if (
      activeTask.value?.status !== "in_progress" ||
      selectedItems.some((item) => !isInventoryBatchSelectable(item))
    ) {
      ElMessage.warning("当前选中的盘点项已发生变化，请重新选择");
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
        resetBulkNormalDialog();
        if (refreshFailed) {
          ElMessage.warning("批量标记正常已完成，但页面数据刷新失败，请重新加载");
        } else {
          ElMessage.success(`已将 ${result.succeeded} 条资产标记为盘点正常`);
        }
      } else {
        ElMessage.warning(
          refreshFailed
            ? `已将 ${result.succeeded} 条资产标记为盘点正常，${result.failed} 条失败；页面数据刷新失败，请重新加载`
            : `已将 ${result.succeeded} 条资产标记为盘点正常，${result.failed} 条失败`,
        );
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "批量标记正常失败");
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
    if (!editingItem.value || !activeTask.value || !itemForm.value.status) {
      throw new Error("请选择盘点结果");
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
    if (!editingItem.value || itemSaving.value) return false;
    itemSaving.value = true;
    try {
      const saved = await persistInventoryItem();
      showItemDialog.value = false;
      const [itemsLoaded] = await Promise.all([
        loadItems(),
        loadTasks(),
        refreshActiveTask(saved.taskId),
      ]);
      ElMessage.success("盘点结果已保存");
      if (!itemsLoaded || itemListError.value || taskListError.value || taskDetailError.value) {
        ElMessage.warning("盘点结果已保存，但部分数据刷新失败，请稍后重试");
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点结果保存失败");
      return false;
    } finally {
      itemSaving.value = false;
    }
  }

  async function saveItemAndNext() {
    if (!editingItem.value || itemSaving.value) return false;
    const savedContext = captureItemSaveContext();
    if (!savedContext) return false;
    itemSaving.value = true;
    try {
      const saved = await persistInventoryItem();
      const itemsLoaded = await loadItems();
      // Summary refresh is useful, but it must not block the next item.  Its
      // own error state remains visible in the task shell if it fails.
      void Promise.allSettled([loadTasks(), refreshActiveTask(saved.taskId)]);
      if (!itemsLoaded || itemListError.value || activeTask.value?.id !== savedContext.taskId) {
        showItemDialog.value = false;
        ElMessage.warning("盘点结果已保存，但下一项加载失败，请重试");
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
          ElMessage.warning("盘点结果已保存，但下一项加载失败，请重试");
          return true;
        }
        nextItem = items.value[0];
      }

      if (!nextItem) {
        showItemDialog.value = false;
        ElMessage.success("盘点结果已保存，当前筛选范围已全部处理");
        return true;
      }

      const initialized = await initializeItem(nextItem);
      if (!initialized) {
        showItemDialog.value = false;
        ElMessage.warning("盘点结果已保存，但下一项加载失败，请重试");
        return true;
      }
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点结果保存失败");
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
  function filterPendingItems() {
    itemStatus.value = "pending";
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
    loading,
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
    resolutionSaving,
    bulkResolutionSaving,
    bulkNormalSaving,
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
    filterPendingItems,
    retryTaskAuxData,
    retryRackAuxData,
    loadInitialData,
  };
}
