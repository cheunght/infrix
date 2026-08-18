<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  CircleCheck,
  Clock,
  DataAnalysis,
  Download,
  Plus,
  Refresh,
  Warning,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import StatisticCard from "./StatisticCard.vue";
import { pageItems, pageTotal, type PageResult } from "../api";
import type {
  DataCenter,
  InventoryInspector,
  InventoryItem,
  InventoryTask,
  Rack,
  ServerRoom,
} from "../types";

const props = defineProps<{ context: Record<string, any> }>();
const context = props.context;
const request = context.request as <T>(path: string, options?: RequestInit) => Promise<T>;
const api = context.api as string;
const can = context.can as (capability: string) => boolean;
const openAssetDetail = context.openAssetDetail as (assetId: number) => void;
const dataCenters = context.dataCenters as { value: DataCenter[] };
const serverRooms = context.serverRooms as { value: ServerRoom[] };

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
  dataCenters.value.filter((item) => item.is_active !== false),
);
const activeRooms = computed(() =>
  serverRooms.value.filter(
    (item) =>
      item.is_active !== false &&
      (!taskForm.value.data_center || String(item.data_center) === taskForm.value.data_center),
  ),
);
const taskFilterRooms = computed(() =>
  serverRooms.value.filter(
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
  return task.server_room_name ? `${task.data_center_name} / ${task.server_room_name}` : `${task.data_center_name} / 整个数据中心`;
}
async function loadRooms() {
  const result = await request<PageResult<ServerRoom> | ServerRoom[]>("/server-rooms/?page_size=100&is_active=true");
  serverRooms.value = pageItems(result);
}
async function loadInspectors() {
  if (!can("inventory.manage")) return;
  inspectors.value = await request<InventoryInspector[]>("/inventory-inspectors/");
}
async function loadRacks() {
  const result = await request<PageResult<Rack> | Rack[]>("/racks/?page_size=100&is_active=true");
  racks.value = pageItems(result);
}
async function loadTasks() {
  loading.value = true;
  taskError.value = "";
  try {
    const params = new URLSearchParams({ page: String(taskPage.value), page_size: String(taskPageSize.value) });
    if (taskSearch.value.trim()) params.set("search", taskSearch.value.trim());
    if (taskStatus.value) params.set("status", taskStatus.value);
    if (taskDataCenter.value) params.set("data_center", taskDataCenter.value);
    if (taskRoom.value) params.set("server_room", taskRoom.value);
    const result = await request<PageResult<InventoryTask> | InventoryTask[]>(`/inventory-tasks/?${params}`);
    tasks.value = pageItems(result);
    taskCount.value = pageTotal(result);
    if (activeTask.value) {
      const current = await request<InventoryTask>(`/inventory-tasks/${activeTask.value.id}/`);
      activeTask.value = current;
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
    const params = new URLSearchParams({ page: String(itemPage.value), page_size: String(itemPageSize.value) });
    if (itemSearch.value.trim()) params.set("search", itemSearch.value.trim());
    if (itemStatus.value) params.set("status", itemStatus.value);
    const result = await request<PageResult<InventoryItem> | InventoryItem[]>(`/inventory-tasks/${activeTask.value.id}/items/?${params}`);
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
    activeTask.value = await request<InventoryTask>(`/inventory-tasks/${task.id}/`);
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
    data_center: activeDataCenters.value[0] ? String(activeDataCenters.value[0].id) : "",
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
  if (!taskForm.value.name.trim() || !taskForm.value.data_center || !taskForm.value.start_at || !taskForm.value.end_at) {
    ElMessage.warning("请填写盘点名称、数据中心和起止时间");
    return;
  }
  try {
    await request("/inventory-tasks/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...taskForm.value,
        data_center: Number(taskForm.value.data_center),
        server_room: taskForm.value.server_room ? Number(taskForm.value.server_room) : null,
        inspector: taskForm.value.inspector ? Number(taskForm.value.inspector) : undefined,
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
  const ok = await ElMessageBox.confirm("完成后盘点结果将锁定，确定完成此任务吗？", "完成盘点任务", { type: "warning" }).catch(() => false);
  if (!ok) return;
  try {
    activeTask.value = await request<InventoryTask>(`/inventory-tasks/${activeTask.value.id}/complete/`, { method: "POST" });
    await Promise.all([loadItems(), loadTasks()]);
    ElMessage.success("盘点任务已完成");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "盘点任务无法完成");
  }
}
async function reopenTask() {
  if (!activeTask.value) return;
  try {
    activeTask.value = await request<InventoryTask>(`/inventory-tasks/${activeTask.value.id}/reopen/`, { method: "POST" });
    await Promise.all([loadItems(), loadTasks()]);
    ElMessage.success("盘点任务已重新打开");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "盘点任务重新打开失败");
  }
}
async function exportTask(task = activeTask.value) {
  if (!task) return;
  window.open(`${api}/inventory-tasks/${task.id}/export/`, "_blank");
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
    await request(`/inventory-items/${editingItem.value.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: itemForm.value.status,
        actual_rack: itemForm.value.actual_rack ? Number(itemForm.value.actual_rack) : null,
        actual_start_u: itemForm.value.actual_start_u ? Number(itemForm.value.actual_start_u) : null,
        actual_end_u: itemForm.value.actual_end_u ? Number(itemForm.value.actual_end_u) : null,
        notes: itemForm.value.notes,
      }),
    });
    showItemDialog.value = false;
    await Promise.all([loadItems(), loadTasks()]);
    if (activeTask.value) activeTask.value = await request<InventoryTask>(`/inventory-tasks/${activeTask.value.id}/`);
    ElMessage.success("盘点结果已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "盘点结果保存失败");
  }
}
function changeTaskPage(page: number) {
  taskPage.value = page;
  loadTasks();
}
function changeTaskPageSize(size: number) {
  taskPageSize.value = size;
  taskPage.value = 1;
  loadTasks();
}
function changeItemPage(page: number) {
  itemPage.value = page;
  loadItems();
}
function changeItemPageSize(size: number) {
  itemPageSize.value = size;
  itemPage.value = 1;
  loadItems();
}
function resetTaskFilters() {
  taskSearch.value = "";
  taskStatus.value = "";
  taskDataCenter.value = "";
  taskRoom.value = "";
  taskPage.value = 1;
  loadTasks();
}
function resetItemFilters() {
  itemSearch.value = "";
  itemStatus.value = "";
  itemPage.value = 1;
  loadItems();
}
onMounted(async () => {
  await Promise.all([loadTasks(), loadRooms(), loadInspectors()]);
});
</script>

<template>
  <div class="itam-page inventory-page">
    <el-card v-if="!activeTask" shadow="never">
      <template #header>
        <div class="ep-toolbar inventory-toolbar">
          <SearchField class="itam-filter-search" v-model="taskSearch" placeholder="搜索盘点任务、数据中心或盘点人" aria-label="搜索盘点任务" @search="() => { taskPage = 1; loadTasks(); }" />
          <el-select class="itam-filter-select" v-model="taskStatus" placeholder="全部状态" clearable @change="() => { taskPage = 1; loadTasks(); }">
            <el-option v-for="item in taskStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-select class="itam-filter-select" v-model="taskDataCenter" placeholder="全部数据中心" clearable @change="() => { taskRoom = ''; taskPage = 1; loadTasks(); }">
            <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
          </el-select>
          <el-select class="itam-filter-select" v-model="taskRoom" placeholder="全部机房" clearable @change="() => { taskPage = 1; loadTasks(); }">
            <el-option v-for="room in taskFilterRooms" :key="room.id" :label="room.name" :value="String(room.id)" />
          </el-select>
          <el-button :icon="Refresh" @click="resetTaskFilters">重置</el-button>
          <span class="ep-toolbar-spacer"></span>
          <el-button v-if="can('inventory.manage')" type="primary" :icon="Plus" @click="openNewTask">新建盘点任务</el-button>
        </div>
      </template>
      <el-alert v-if="taskError" :title="taskError" type="error" show-icon :closable="false" class="inventory-alert" />
      <el-table v-loading="loading" :data="tasks" empty-text="暂无盘点任务" @row-click="openTask">
        <el-table-column prop="name" label="盘点名称" min-width="220" />
        <el-table-column label="盘点范围" min-width="220"><template #default="{ row }">{{ taskScope(row) }}</template></el-table-column>
        <el-table-column prop="inspector_name" label="盘点人" width="120" />
        <el-table-column label="时间范围" min-width="300"><template #default="{ row }">{{ formatDateTime(row.start_at) }} - {{ formatDateTime(row.end_at) }}</template></el-table-column>
        <el-table-column label="完成率" width="150"><template #default="{ row }"><el-progress :percentage="row.summary.completion_rate" :stroke-width="8" /></template></el-table-column>
        <el-table-column label="异常" width="90"><template #default="{ row }">{{ row.summary.total - row.summary.pending - row.summary.normal }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'completed' ? 'success' : 'warning'">{{ taskStatusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" fixed="right" width="150"><template #default="{ row }"><el-button link type="primary" @click.stop="openTask(row)">查看</el-button><el-button v-if="can('inventory.export')" link :icon="Download" @click.stop="exportTask(row)">导出</el-button></template></el-table-column>
      </el-table>
      <PagedTable v-model:current-page="taskPage" v-model:page-size="taskPageSize" :total="taskCount" :page-sizes="[20, 50, 100]" :loading="loading" @update:current-page="changeTaskPage" @update:page-size="changeTaskPageSize" />
    </el-card>

    <template v-else>
      <div class="inventory-detail-heading">
        <div><el-button link @click="closeTask">返回任务列表</el-button><h2>{{ activeTask.name }}</h2><p>{{ taskScope(activeTask) }} · 盘点人：{{ activeTask.inspector_name }}</p></div>
        <div class="ep-toolbar-actions"><el-button v-if="can('inventory.export')" :icon="Download" @click="exportTask()">导出结果</el-button><el-button v-if="can('inventory.manage') && activeTask.status === 'in_progress'" type="primary" @click="completeTask">完成盘点</el-button><el-button v-if="can('inventory.manage') && activeTask.status === 'completed'" type="primary" @click="reopenTask">重新打开</el-button></div>
      </div>
      <section class="inventory-summary-grid">
        <StatisticCard label="总设备" :value="activeTask.summary.total" tone="blue" :icon="DataAnalysis" />
        <StatisticCard label="已盘点" :value="activeTask.summary.checked" tone="green" :icon="CircleCheck" />
        <StatisticCard label="未盘点" :value="activeTask.summary.pending" tone="gray" :icon="Clock" />
        <StatisticCard label="正常" :value="activeTask.summary.normal" tone="green" :icon="CircleCheck" />
        <StatisticCard label="异常" :value="activeTask.summary.total - activeTask.summary.pending - activeTask.summary.normal" tone="red" :icon="Warning" />
        <StatisticCard label="完成率" :value="`${activeTask.summary.completion_rate}%`" tone="purple" :icon="DataAnalysis" />
      </section>
      <el-card shadow="never">
        <div class="ep-toolbar inventory-toolbar">
          <SearchField class="itam-filter-search" v-model="itemSearch" placeholder="搜索资产编号、SN、IP或名称" aria-label="搜索盘点设备" @search="() => { itemPage = 1; loadItems(); }" />
          <el-select class="itam-filter-select" v-model="itemStatus" placeholder="全部盘点结果" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          <el-button :icon="Refresh" @click="resetItemFilters">重置</el-button>
        </div>
        <el-alert v-if="taskError" :title="taskError" type="error" show-icon :closable="false" class="inventory-alert" />
        <el-table v-loading="loading" :data="items" empty-text="暂无盘点设备">
          <el-table-column label="资产编号" min-width="150"><template #default="{ row }"><el-button link type="primary" @click.stop="openAssetDetail(row.asset)">{{ row.asset_no }}</el-button></template></el-table-column>
          <el-table-column prop="asset_name" label="设备名称" min-width="180" />
          <el-table-column prop="serial_number" label="序列号" min-width="150"><template #default="{ row }">{{ row.serial_number || "—" }}</template></el-table-column>
          <el-table-column label="系统位置" min-width="250"><template #default="{ row }">{{ locationText(row) }}</template></el-table-column>
          <el-table-column label="盘点结果" width="130"><template #default="{ row }"><el-tag :type="statusTagType(row.status)">{{ row.status_label }}</el-tag></template></el-table-column>
          <el-table-column label="实际位置" min-width="250"><template #default="{ row }">{{ row.status === 'pending' ? '—' : locationText(row, true) }}</template></el-table-column>
          <el-table-column label="盘点时间" width="170"><template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template></el-table-column>
          <el-table-column label="操作" fixed="right" width="120"><template #default="{ row }"><el-button v-if="can('inventory.manage') && activeTask.status === 'in_progress'" link type="primary" @click="openItem(row)">{{ row.status === 'pending' ? '确认盘点' : '修改结果' }}</el-button><span v-else>—</span></template></el-table-column>
        </el-table>
        <PagedTable v-model:current-page="itemPage" v-model:page-size="itemPageSize" :total="itemCount" :page-sizes="[20, 50, 100]" :loading="loading" @update:current-page="changeItemPage" @update:page-size="changeItemPageSize" />
      </el-card>
    </template>

    <el-dialog v-model="showTaskDialog" title="新建盘点任务" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="盘点名称" required><el-input v-model="taskForm.name" placeholder="例如：2026年沈阳数据中心年度盘点" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="数据中心" required><el-select v-model="taskForm.data_center" @change="changeTaskDataCenter"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item label="机房（不选表示整个数据中心）"><el-select v-model="taskForm.server_room" clearable placeholder="整个数据中心"><el-option v-for="room in activeRooms" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
          <el-form-item label="盘点人"><el-select v-model="taskForm.inspector" clearable placeholder="默认当前用户"><el-option v-for="person in inspectors" :key="person.id" :label="person.display_name" :value="String(person.id)" /></el-select></el-form-item>
          <el-form-item label="开始时间" required><el-date-picker v-model="taskForm.start_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item label="结束时间" required><el-date-picker v-model="taskForm.end_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="taskForm.notes" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showTaskDialog = false">取消</el-button><el-button type="primary" @click="saveTask">创建并生成清单</el-button></template>
    </el-dialog>

    <el-dialog v-model="showItemDialog" title="确认盘点" width="560px" destroy-on-close>
      <el-alert v-if="editingItem" :title="`${editingItem.asset_no} · ${editingItem.asset_name}`" type="info" :closable="false" />
      <el-form label-position="top" class="inventory-item-form">
        <el-form-item label="盘点结果" required><el-select v-model="itemForm.status" @change="changeItemStatus"><el-option v-for="item in itemStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <div v-if="itemForm.status !== 'not_found'" class="form-grid">
          <el-form-item label="实际机柜"><el-select v-model="itemForm.actual_rack" clearable placeholder="未上架"><el-option v-for="rack in activeRacks" :key="rack.id" :label="`${rack.data_center_name} / ${rack.server_room_name} / ${rack.code}`" :value="String(rack.id)" /></el-select></el-form-item>
          <el-form-item label="实际起始 U"><el-input-number v-model="itemForm.actual_start_u" :min="1" controls-position="right" /></el-form-item>
          <el-form-item label="实际结束 U"><el-input-number v-model="itemForm.actual_end_u" :min="1" controls-position="right" /></el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="itemForm.notes" type="textarea" :rows="3" placeholder="设备信息不符时请记录具体差异" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showItemDialog = false">取消</el-button><el-button type="primary" @click="saveItem">保存盘点结果</el-button></template>
    </el-dialog>
  </div>
</template>
