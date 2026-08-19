import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { pageItems, pageTotal, type PageResult } from "../api";
import type {
  InventoryInspector,
  InventoryItem,
  InventoryTask,
  Rack,
  ServerRoom,
} from "../types";
import type { InventoryContext } from "../types/page-context";

export function useInventory(context: InventoryContext) {
  const loading = ref(false);
  const taskError = ref("");
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
  const taskForm = ref({
    name: "",
    data_center: "",
    server_room: "",
    inspector: "",
    start_at: "",
    end_at: "",
    notes: "",
  });
  const itemForm = ref({
    status: "normal",
    actual_rack: "",
    actual_start_u: "",
    actual_end_u: "",
    notes: "",
  });

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

  async function loadRooms() {
    const result = await context.request<PageResult<ServerRoom> | ServerRoom[]>(
      "/server-rooms/?page_size=100&is_active=true",
    );
    context.serverRooms.value = pageItems(result);
  }

  async function loadInspectors() {
    if (!context.can("inventory.manage")) return;
    inspectors.value = await context.request<InventoryInspector[]>(
      "/inventory-inspectors/",
    );
  }

  async function loadRacks() {
    const result = await context.request<PageResult<Rack> | Rack[]>(
      "/racks/?page_size=100&is_active=true",
    );
    racks.value = pageItems(result);
  }

  async function loadTasks() {
    loading.value = true;
    taskError.value = "";
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
      );
      tasks.value = pageItems(result);
      taskCount.value = pageTotal(result);
      if (activeTask.value) {
        activeTask.value = await context.request<InventoryTask>(
          `/inventory-tasks/${activeTask.value.id}/`,
        );
      }
    } catch (error) {
      taskError.value = error instanceof Error ? error.message : "盘点任务加载失败";
    } finally {
      loading.value = false;
    }
  }

  async function loadItems() {
    if (!activeTask.value) return;
    loading.value = true;
    taskError.value = "";
    try {
      const params = new URLSearchParams({
        page: String(itemPage.value),
        page_size: String(itemPageSize.value),
      });
      if (itemSearch.value.trim()) params.set("search", itemSearch.value.trim());
      if (itemStatus.value) params.set("status", itemStatus.value);
      const result = await context.request<PageResult<InventoryItem> | InventoryItem[]>(
        `/inventory-tasks/${activeTask.value.id}/items/?${params}`,
      );
      items.value = pageItems(result);
      itemCount.value = pageTotal(result);
    } catch (error) {
      taskError.value = error instanceof Error ? error.message : "盘点设备加载失败";
    } finally {
      loading.value = false;
    }
  }

  async function openTask(task: InventoryTask) {
    try {
      activeTask.value = await context.request<InventoryTask>(
        `/inventory-tasks/${task.id}/`,
      );
      itemPage.value = 1;
      itemSearch.value = "";
      itemStatus.value = "";
      await loadItems();
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务加载失败");
    }
  }

  function closeTask() {
    activeTask.value = null;
    items.value = [];
    itemCount.value = 0;
  }

  function resetTaskForm() {
    taskForm.value = {
      name: "",
      data_center: activeDataCenters.value[0]
        ? String(activeDataCenters.value[0].id)
        : "",
      server_room: "",
      inspector: inspectors.value[0] ? String(inspectors.value[0].id) : "",
      start_at: "",
      end_at: "",
      notes: "",
    };
  }

  async function openNewTask() {
    await Promise.all([loadRooms(), loadInspectors()]);
    resetTaskForm();
    showTaskDialog.value = true;
  }

  function changeTaskDataCenter() {
    taskForm.value.server_room = "";
  }

  async function saveTask() {
    if (
      !taskForm.value.name.trim() ||
      !taskForm.value.data_center ||
      !taskForm.value.start_at ||
      !taskForm.value.end_at
    ) {
      ElMessage.warning("请填写盘点名称、数据中心和起止时间");
      return;
    }
    try {
      await context.request("/inventory-tasks/", {
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
      showTaskDialog.value = false;
      ElMessage.success("盘点任务已创建并生成设备清单");
      taskPage.value = 1;
      await loadTasks();
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务创建失败");
    }
  }

  async function completeTask() {
    if (!activeTask.value) return;
    const ok = await ElMessageBox.confirm(
      "完成后盘点结果将锁定，确定完成此任务吗？",
      "完成盘点任务",
      { type: "warning" },
    ).catch(() => false);
    if (!ok) return;
    try {
      activeTask.value = await context.request<InventoryTask>(
        `/inventory-tasks/${activeTask.value.id}/complete/`,
        { method: "POST" },
      );
      await Promise.all([loadItems(), loadTasks()]);
      ElMessage.success("盘点任务已完成");
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务无法完成");
    }
  }

  async function reopenTask() {
    if (!activeTask.value) return;
    try {
      activeTask.value = await context.request<InventoryTask>(
        `/inventory-tasks/${activeTask.value.id}/reopen/`,
        { method: "POST" },
      );
      await Promise.all([loadItems(), loadTasks()]);
      ElMessage.success("盘点任务已重新打开");
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点任务重新打开失败");
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

  async function openItem(item: InventoryItem) {
    if (!activeTask.value || activeTask.value.status === "completed") return;
    if (!racks.value.length) await loadRacks();
    editingItem.value = item;
    itemForm.value = {
      status: item.status === "pending" ? "normal" : item.status,
      actual_rack: item.actual_rack ? String(item.actual_rack) : "",
      actual_start_u: item.actual_start_u == null ? "" : String(item.actual_start_u),
      actual_end_u: item.actual_end_u == null ? "" : String(item.actual_end_u),
      notes: item.notes || "",
    };
    showItemDialog.value = true;
  }

  function changeItemStatus() {
    if (itemForm.value.status === "not_found") {
      itemForm.value.actual_rack = "";
      itemForm.value.actual_start_u = "";
      itemForm.value.actual_end_u = "";
    }
  }

  async function saveItem() {
    if (!editingItem.value) return;
    try {
      await context.request(`/inventory-items/${editingItem.value.id}/`, {
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
      showItemDialog.value = false;
      await Promise.all([loadItems(), loadTasks()]);
      if (activeTask.value) {
        activeTask.value = await context.request<InventoryTask>(
          `/inventory-tasks/${activeTask.value.id}/`,
        );
      }
      ElMessage.success("盘点结果已保存");
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "盘点结果保存失败");
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

  async function loadInitialData() {
    await Promise.all([loadTasks(), loadRooms(), loadInspectors()]);
  }

  return {
    loading,
    taskError,
    tasks,
    taskCount,
    taskPage,
    taskPageSize,
    taskSearch,
    taskStatus,
    taskDataCenter,
    taskRoom,
    activeTask,
    items,
    itemCount,
    itemPage,
    itemPageSize,
    itemSearch,
    itemStatus,
    inspectors,
    racks,
    showTaskDialog,
    showItemDialog,
    editingItem,
    taskForm,
    itemForm,
    activeDataCenters,
    activeRooms,
    taskFilterRooms,
    activeRacks,
    taskStatusOptions,
    itemStatusOptions,
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
    openTask,
    closeTask,
    openNewTask,
    changeTaskDataCenter,
    saveTask,
    completeTask,
    reopenTask,
    exportTask,
    openItem,
    changeItemStatus,
    saveItem,
    changeTaskPage,
    changeTaskPageSize,
    changeItemPage,
    changeItemPageSize,
    resetTaskFilters,
    resetItemFilters,
    loadInitialData,
  };
}
