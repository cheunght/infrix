import { computed, onBeforeUnmount, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import type {
  InventoryInspector,
  InventoryItem,
  InventoryScopePreview,
  InventoryTask,
  InventoryStatus,
  Rack,
  ServerRoom,
} from "../types";
import type { InventoryContext } from "../types/page-context";

type AuxKey = "rooms" | "inspectors" | "racks";

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
  const taskCompleting = ref(false);
  const taskReopening = ref(false);
  const itemSaving = ref(false);

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
  const inspectors = ref<InventoryInspector[]>([]);
  const racks = ref<Rack[]>([]);
  const showTaskDialog = ref(false);
  const showItemDialog = ref(false);
  const editingItem = ref<InventoryItem | null>(null);
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
  const taskHasFilters = computed(() =>
    Boolean(taskSearch.value.trim() || taskStatus.value || taskDataCenter.value || taskRoom.value),
  );
  const itemHasFilters = computed(() => Boolean(itemSearch.value.trim() || itemStatus.value));
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

  async function loadItems(corrected = false): Promise<boolean> {
    if (!activeTask.value) return false;
    const taskId = activeTask.value.id;
    const requestId = ++itemRequestId;
    itemController?.abort();
    const controller = new AbortController();
    itemController = controller;
    itemListLoading.value = true;
    itemListError.value = "";
    try {
      const params = new URLSearchParams({
        page: String(itemPage.value),
        page_size: String(itemPageSize.value),
      });
      if (itemSearch.value.trim()) params.set("search", itemSearch.value.trim());
      if (itemStatus.value) params.set("status", itemStatus.value);
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
      ElMessage.success("盘点任务已完成");
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
    if (!task) return;
    try {
      await context.downloadFile(
        `/inventory-tasks/${task.id}/export/`,
        `inventory-${task.id}.xlsx`,
      );
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点结果导出失败");
    }
  }

  async function initializeItem(item: InventoryItem) {
    if (!activeTask.value || activeTask.value.status === "completed") return false;
    if (!racks.value.length) await loadRacks();
    if (itemAuxError.value) return false;
    editingItem.value = item;
    itemForm.value = {
      // A pending item must be explicitly assigned a result.  Treating it as
      // normal on open makes an accidental save look like a verified result.
      status: item.status === "pending" ? "" : item.status,
      actual_rack: item.actual_rack ? String(item.actual_rack) : "",
      actual_start_u: item.actual_start_u == null ? "" : String(item.actual_start_u),
      actual_end_u: item.actual_end_u == null ? "" : String(item.actual_end_u),
      notes: item.notes || "",
    };
    showItemDialog.value = true;
    return true;
  }

  async function openItem(item: InventoryItem) {
    await initializeItem(item);
  }

  function changeItemStatus() {
    if (itemForm.value.status === "not_found") {
      itemForm.value.actual_rack = "";
      itemForm.value.actual_start_u = "";
      itemForm.value.actual_end_u = "";
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
    await context.request(`/inventory-items/${itemId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: itemForm.value.status,
        actual_rack: itemForm.value.actual_rack
          ? Number(itemForm.value.actual_rack)
          : null,
        actual_start_u: itemForm.value.actual_start_u
          ? Number(itemForm.value.actual_start_u)
          : null,
        actual_end_u: itemForm.value.actual_end_u
          ? Number(itemForm.value.actual_end_u)
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
    taskCompleting,
    taskReopening,
    itemSaving,
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
    itemHasFilters,
    inspectors,
    racks,
    showTaskDialog,
    showItemDialog,
    editingItem,
    scopePreview,
    scopePreviewLoading,
    scopePreviewError,
    taskForm,
    itemForm,
    activeDataCenters,
    activeRooms,
    taskFilterRooms,
    activeRacks,
    taskStatusOptions,
    itemStatusOptions,
    itemResultOptions,
    taskStatusLabel,
    formatDateTime,
    locationText,
    statusTagType,
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
    completeTask,
    reopenTask,
    exportTask,
    openItem,
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
