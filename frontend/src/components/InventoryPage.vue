<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowDown,
  CircleCheck,
  Clock,
  DataAnalysis,
  Delete,
  Download,
  Filter,
  Refresh,
  Warning,
} from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import StatisticCard from "./StatisticCard.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageHeader from "./page/PageHeader.vue";
import PageToolbar from "./page/PageToolbar.vue";
import PageSection from "./page/PageSection.vue";
import StatusTag from "./StatusTag.vue";
import type { FormInstance, FormRules } from "element-plus";
import type { InventoryContext } from "../types/page-context";
import { useInventory } from "../composables/useInventory";

const props = defineProps<{ context: InventoryContext }>();
const context = props.context;
const can = context.can;
const openAssetDetail = context.openAssetDetail;
const taskFormRef = ref<FormInstance>();
const itemFormRef = ref<FormInstance>();
const resolutionFormRef = ref<FormInstance>();
const bulkResolutionFormRef = ref<FormInstance>();
const itemTableRef = ref<{
  clearSelection: () => void;
  toggleRowSelection: (row: unknown, selected?: boolean) => void;
} | null>(null);
const selectionSyncing = ref(false);
const taskRules: FormRules = {
  name: [{ required: true, message: "请输入盘点名称", trigger: "blur" }],
  data_center: [{ required: true, message: "请选择数据中心", trigger: "change" }],
  start_at: [{ required: true, message: "请选择开始时间", trigger: "change" }],
  end_at: [{ required: true, message: "请选择结束时间", trigger: "change" }],
};
const itemRules: FormRules = {
  status: [{ required: true, message: "请选择盘点结果", trigger: "change" }],
};

const {
  taskListLoading, taskListError, itemListLoading, itemListError, taskDetailLoading, taskDetailError,
  auxLoading, taskAuxError, itemAuxError, taskCreating, taskDeletingId, taskCompleting, taskReopening, itemSaving, resolutionSaving,
  bulkResolutionSaving, bulkNormalSaving,
  tasks, taskCount, taskPage, taskPageSize, taskSearch, taskStatus,
  taskDataCenter, taskRoom, activeTask, items, itemCount, itemPage, itemPageSize,
  itemSearch, itemStatus, itemResolutionStatus, inspectors, racks, showTaskDialog, showItemDialog,
  showResolutionDialog, showBulkResolutionDialog, showBulkNormalDialog, editingItem, resolutionItem,
  scopePreview, scopePreviewLoading, scopePreviewError,
  taskForm, itemForm, resolutionForm, bulkResolutionAction, bulkResolutionCount, bulkResolutionForm, bulkResolutionResult,
  bulkNormalCount, bulkNormalResult,
  activeDataCenters, activeRooms, taskFilterRooms, activeRacks,
  taskHasFilters, itemHasFilters,
  taskStatusOptions, itemStatusOptions, itemResultOptions, itemResolutionStatusOptions, taskStatusLabel,
  formatDateTime, locationText, statusTagType, isExceptionStatus, resolutionStatusLabel,
  resolutionStatusTagType, resolutionActionLabel, hasCompleteActualLocation, resolutionActionOptions,
  selectedBatchItems, batchSelectionMode, isBatchSelectable, onBatchSelectionChange, batchSelectionModeFor,
  isBatchSelectableForMode, batchResolutionActionOptions, clearBatchSelection,
  taskScope, loadInitialData, loadTasks, loadItems, retryActiveTask, openTask, closeTask,
  openNewTask, changeTaskDataCenter, saveTask, deleteTask, completeTask, reopenTask, exportTask, exportingTaskId,
  changeTaskServerRoom, retryScopePreview, closeTaskDialog,
  openItem, changeItemStatus, saveItem, saveItemAndNext, filterPendingItems, changeTaskPage, changeTaskPageSize,
  changeItemPage, changeItemPageSize, resetTaskFilters, resetItemFilters,
  retryTaskAuxData, retryRackAuxData, openResolution, closeResolutionDialog, saveResolution,
  openBulkResolution, closeBulkResolutionDialog, saveBulkResolution, openBulkNormal, closeBulkNormalDialog, saveBulkNormal,
} = useInventory(context);

const itemCanSave = computed(
  () => Boolean(
    activeTask.value?.status === "in_progress" &&
      can("inventory.manage") &&
      itemForm.value.status &&
      !itemSaving.value,
  ),
);

const resolutionOptions = computed(() => resolutionActionOptions(resolutionItem.value));
const resolutionReadOnly = computed(() => resolutionItem.value?.resolution_status === "resolved");
const resolutionUpdateSelected = computed(() => resolutionForm.value.action === "update_asset");
const resolutionLocationIncomplete = computed(() => Boolean(
  resolutionItem.value?.status === "location_mismatch" &&
  !hasCompleteActualLocation(resolutionItem.value),
));
const resolutionCanSave = computed(() => Boolean(
  resolutionItem.value?.resolution_status === "pending" &&
    can("inventory.manage") &&
    resolutionForm.value.action &&
    !resolutionSaving.value,
));
const resolutionRules = computed<FormRules>(() => ({
  action: [{ required: true, message: "请选择处理方式", trigger: "change" }],
  note: resolutionForm.value.action === "ignore"
    ? [{ required: true, message: "忽略异常时必须填写处理备注", trigger: "blur" }]
    : [],
}));
const batchResolutionOptions = computed(() => batchResolutionActionOptions());
const bulkResolutionFailures = computed(() =>
  (bulkResolutionResult.value?.results || []).filter((result) => !result.success),
);
const bulkResolutionNotice = computed(() => ({
  keep_asset: "该操作不会修改资产主数据，仅记录本次处理结论。",
  ignore: "请确认这些异常属于忽略 / 误报；处理备注将作为统一处理说明保存。",
  confirm_missing: "该操作不会删除或报废资产，只确认盘点时未找到这些已知资产。",
} as Record<string, string>)[bulkResolutionAction.value] || "");
const bulkResolutionRules = computed<FormRules>(() => ({
  note: bulkResolutionAction.value === "ignore"
    ? [{ required: true, message: "忽略异常时必须填写处理备注", trigger: "blur" }]
    : [],
}));
const bulkNormalFailures = computed(() =>
  (bulkNormalResult.value?.results || []).filter((result) => !result.success),
);

const scopePreviewWarnings = computed(() => {
  const preview = scopePreview.value;
  if (!preview) return [];
  const warnings = [...(preview.warnings || [])];
  if (preview.retired > 0) {
    warnings.push(`当前范围包含 ${preview.retired} 台已报废资产`);
  }
  return Array.from(new Set(warnings));
});

async function submitTask() {
  const valid = await taskFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveTask();
}

async function submitItem() {
  const valid = await itemFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveItem();
}

async function submitItemAndNext() {
  const valid = await itemFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveItemAndNext();
}

async function submitResolution() {
  const valid = await resolutionFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveResolution();
}
async function submitBulkResolution() {
  const valid = await bulkResolutionFormRef.value?.validate().catch(() => false);
  if (valid === false) return;
  await saveBulkResolution();
}
function handleBatchSelectionChange(rows: unknown[]) {
  if (selectionSyncing.value) return;
  onBatchSelectionChange(rows as typeof selectedBatchItems.value);
}
function handleBatchSelectAll(rows: unknown[]) {
  if (selectionSyncing.value) return;
  const typedRows = rows as typeof selectedBatchItems.value;
  const mode = batchSelectionMode.value || typedRows.map(batchSelectionModeFor).find(Boolean) || null;
  if (!mode) {
    onBatchSelectionChange([]);
    return;
  }
  const allowedRows = typedRows.filter((item) => isBatchSelectableForMode(item, mode));
  onBatchSelectionChange(allowedRows);
  if (allowedRows.length === typedRows.length) return;

  selectionSyncing.value = true;
  itemTableRef.value?.clearSelection();
  void nextTick(() => {
    allowedRows.forEach((item) => itemTableRef.value?.toggleRowSelection(item, true));
    selectionSyncing.value = false;
  });
}
watch(items, () => {
  itemTableRef.value?.clearSelection();
  clearBatchSelection();
});
onMounted(async () => {
  await loadInitialData();
});
</script>

<template>
  <div class="itam-page">
    <PageContainer v-if="!activeTask">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="taskSearch" placeholder="搜索盘点任务、数据中心或盘点人" aria-label="搜索盘点任务" @search="() => { taskPage = 1; loadTasks(); }" />
          </template>
          <template #primary-filter>
            <el-select v-model="taskStatus" placeholder="全部状态" clearable @change="() => { taskPage = 1; loadTasks(); }">
              <el-option v-for="item in taskStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </template>
          <template #secondary-filter>
            <el-select v-model="taskDataCenter" placeholder="全部数据中心" clearable @change="() => { taskRoom = ''; taskPage = 1; loadTasks(); }">
              <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
            </el-select>
          </template>
          <template #extra-filter>
            <div class="toolbar-extra-group">
              <el-popover placement="bottom-start" :width="320" trigger="click">
                <template #reference><el-button class="toolbar-extra-action" :icon="Filter">更多筛选</el-button></template>
                <div class="toolbar-extra-panel">
                  <el-select v-model="taskRoom" placeholder="全部机房" clearable @change="() => { taskPage = 1; loadTasks(); }">
                    <el-option v-for="room in taskFilterRooms" :key="room.id" :label="room.name" :value="String(room.id)" />
                  </el-select>
                  <div class="toolbar-extra-popover-actions">
                    <el-button class="toolbar-secondary-action" :icon="Refresh" @click="resetTaskFilters">重置</el-button>
                  </div>
                </div>
              </el-popover>
            </div>
          </template>
          <template #actions>
            <el-button v-if="can('inventory.manage')" class="page-primary-action" type="primary" :loading="taskCreating" :disabled="taskCreating" @click="openNewTask">
              新增盘点
            </el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <el-alert v-if="taskListError" :title="taskListError" type="error" show-icon :closable="false" class="inventory-alert" />
        <div v-if="taskListError" class="inventory-retry-row">
          <el-button link type="primary" @click="() => loadTasks()">重新加载</el-button>
        </div>
        <el-table v-loading="taskListLoading" :data="tasks" table-layout="fixed" @row-click="openTask">
        <template #empty>
          <div v-if="!taskListError" class="inventory-list-empty">
            <span>{{ taskHasFilters ? "没有符合当前筛选条件的盘点任务" : "暂无盘点任务" }}</span>
            <el-button v-if="taskHasFilters" link type="primary" @click="resetTaskFilters">清除筛选</el-button>
          </div>
        </template>
        <el-table-column prop="name" label="盘点名称" min-width="220" show-overflow-tooltip />
        <el-table-column label="盘点范围" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ taskScope(row) }}</template></el-table-column>
        <el-table-column prop="inspector_name" label="盘点人" width="120" show-overflow-tooltip />
        <el-table-column label="时间范围" min-width="300" show-overflow-tooltip><template #default="{ row }">{{ formatDateTime(row.start_at) }} - {{ formatDateTime(row.end_at) }}</template></el-table-column>
        <el-table-column label="完成率" width="150"><template #default="{ row }"><el-progress :percentage="row.summary.completion_rate" :stroke-width="8" /></template></el-table-column>
        <el-table-column label="异常" width="90"><template #default="{ row }">{{ row.summary.exceptions }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag :status="row.status" :label="taskStatusLabel(row.status)" /></template></el-table-column>
        <el-table-column label="操作" fixed="right" width="220"><template #default="{ row }"><div class="inventory-task-actions"><el-button link type="primary" @click.stop="openTask(row)">查看</el-button><el-button v-if="can('inventory.export')" link :icon="Download" :loading="exportingTaskId === row.id" :disabled="exportingTaskId !== null" @click.stop="exportTask(row)">导出</el-button><el-button v-if="can('inventory.manage') && row.can_delete" link type="danger" :icon="Delete" :loading="taskDeletingId === row.id" :disabled="taskDeletingId !== null" @click.stop="deleteTask(row)">删除</el-button></div></template></el-table-column>
        </el-table>
        <PagedTable v-model:current-page="taskPage" v-model:page-size="taskPageSize" :total="taskCount" :page-sizes="[20, 50, 100]" :loading="taskListLoading" @update:current-page="changeTaskPage" @update:page-size="changeTaskPageSize" />
      </PageContent>
    </PageContainer>

    <PageContainer v-else>
      <template #header>
        <PageHeader
          :title="activeTask.name"
          :description="taskScope(activeTask) + ' · 盘点人：' + activeTask.inspector_name"
        >
          <template #leading>
            <el-button link @click="closeTask">返回任务列表</el-button>
          </template>
          <template #actions>
            <el-button v-if="can('inventory.export')" :icon="Download" :loading="exportingTaskId === activeTask.id" :disabled="exportingTaskId !== null" @click="exportTask()">
              导出结果
            </el-button>
            <el-button
              v-if="can('inventory.manage') && activeTask.status === 'in_progress'"
              type="primary"
              :loading="taskCompleting"
              :disabled="taskCompleting || activeTask.summary.pending > 0"
              :title="activeTask.summary.pending > 0 ? `仍有 ${activeTask.summary.pending} 项未盘点` : undefined"
              @click="completeTask"
            >
              完成盘点
            </el-button>
            <el-button
              v-if="can('inventory.manage') && activeTask.status === 'completed'"
              type="primary"
              :loading="taskReopening"
              :disabled="taskReopening"
              @click="reopenTask"
            >
              重新打开
            </el-button>
          </template>
        </PageHeader>
      </template>
      <PageContent v-loading="taskDetailLoading">
        <el-alert v-if="taskDetailError" :title="taskDetailError" type="error" show-icon :closable="false" class="inventory-alert" />
        <div v-if="taskDetailError" class="inventory-retry-row">
          <el-button link type="primary" @click="retryActiveTask">重新加载任务</el-button>
        </div>
        <PageSection title="盘点进度">
          <section class="inventory-summary-grid">
            <StatisticCard label="总设备" :value="activeTask.summary.total" tone="blue" :icon="DataAnalysis" />
            <StatisticCard label="已盘点" :value="activeTask.summary.checked" tone="green" :icon="CircleCheck" />
            <StatisticCard label="正常" :value="activeTask.summary.normal" tone="green" :icon="CircleCheck" />
            <StatisticCard label="异常" :value="activeTask.summary.exceptions" tone="red" :icon="Warning" />
            <StatisticCard label="待处理" :value="activeTask.summary.resolution_pending" tone="orange" :icon="Clock" />
            <StatisticCard label="已处理" :value="activeTask.summary.resolution_resolved" tone="purple" :icon="CircleCheck" />
          </section>
        </PageSection>
        <PageSection title="盘点设备">
          <PageToolbar>
            <template #search>
              <SearchField v-model="itemSearch" placeholder="搜索资产编号、SN、IP或名称" aria-label="搜索盘点设备" @search="() => { itemPage = 1; loadItems(); }" />
            </template>
            <template #primary-filter>
              <el-select v-model="itemStatus" placeholder="全部盘点结果" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
            </template>
            <template #secondary-filter>
              <el-select v-model="itemResolutionStatus" placeholder="全部处理状态" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemResolutionStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
            </template>
            <template #extra-filter>
              <div class="toolbar-extra-group">
                <el-button class="toolbar-secondary-action" :type="itemStatus === 'pending' ? 'primary' : 'default'" :plain="itemStatus !== 'pending'" @click="filterPendingItems">仅看未盘点</el-button>
                <el-button class="toolbar-secondary-action" :icon="Refresh" @click="resetItemFilters">重置</el-button>
              </div>
            </template>
          </PageToolbar>
          <div v-if="selectedBatchItems.length" class="inventory-batch-bar">
            <span>已选择 {{ selectedBatchItems.length }} 项</span>
            <el-button
              v-if="batchSelectionMode === 'inventory'"
              type="primary"
              plain
              :loading="bulkNormalSaving"
              :disabled="bulkNormalSaving"
              @click="openBulkNormal"
            >
              标记为正常
            </el-button>
            <el-dropdown v-else trigger="click" @command="openBulkResolution">
              <el-button type="primary" plain :loading="bulkResolutionSaving" :disabled="bulkResolutionSaving">
                批量处理<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="option in batchResolutionOptions" :key="option.value" :command="option.value">
                    {{ option.label }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <el-alert v-if="itemListError" :title="itemListError" type="error" show-icon :closable="false" class="inventory-alert" />
          <div v-if="itemListError" class="inventory-retry-row">
            <el-button link type="primary" @click="() => loadItems()">重新加载设备</el-button>
          </div>
          <PagedTable v-model:current-page="itemPage" v-model:page-size="itemPageSize" :total="itemCount" :page-sizes="[20, 50, 100]" :loading="itemListLoading" @update:current-page="changeItemPage" @update:page-size="changeItemPageSize">
            <el-table
              ref="itemTableRef"
              v-loading="itemListLoading"
              :data="items"
              row-key="id"
              table-layout="fixed"
              @selection-change="handleBatchSelectionChange"
              @select-all="handleBatchSelectAll"
            >
            <template #empty>
              <div v-if="!itemListError" class="inventory-list-empty">
                <span>{{ itemHasFilters ? "没有符合当前筛选条件的盘点设备" : "当前任务没有盘点设备" }}</span>
                <el-button v-if="itemHasFilters" link type="primary" @click="resetItemFilters">清除筛选</el-button>
              </div>
            </template>
          <el-table-column v-if="can('inventory.manage')" type="selection" width="48" :selectable="isBatchSelectable" />
          <el-table-column label="资产编号" min-width="150"><template #default="{ row }"><el-button link type="primary" @click.stop="openAssetDetail(row.asset)">{{ row.asset_no }}</el-button></template></el-table-column>
          <el-table-column prop="asset_name" label="设备名称" min-width="180" show-overflow-tooltip />
          <el-table-column prop="serial_number" label="序列号" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.serial_number || "—" }}</template></el-table-column>
          <el-table-column label="系统位置" min-width="250" show-overflow-tooltip><template #default="{ row }">{{ locationText(row) }}</template></el-table-column>
          <el-table-column label="盘点结果" width="130"><template #default="{ row }"><StatusTag :status="row.status" :type="statusTagType(row.status)" :label="row.status_label" /></template></el-table-column>
          <el-table-column label="处理状态" width="105"><template #default="{ row }"><span v-if="row.resolution_status === 'not_required'">—</span><StatusTag v-else :status="row.resolution_status" :type="resolutionStatusTagType(row.resolution_status)" :label="resolutionStatusLabel(row.resolution_status)" /></template></el-table-column>
          <el-table-column label="实际位置" min-width="250" show-overflow-tooltip><template #default="{ row }">{{ row.status === 'pending' ? '—' : locationText(row, true) }}</template></el-table-column>
          <el-table-column label="盘点时间" width="170"><template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template></el-table-column>
          <el-table-column label="操作" fixed="right" width="190"><template #default="{ row }"><div class="inventory-row-actions"><el-button v-if="can('inventory.manage') && activeTask.status === 'in_progress'" link type="primary" @click="openItem(row)">{{ row.status === 'pending' ? '确认盘点' : '修改结果' }}</el-button><el-button v-if="isExceptionStatus(row.status) && row.resolution_status === 'pending' && can('inventory.manage')" link type="warning" @click="openResolution(row)">处理</el-button><el-button v-else-if="isExceptionStatus(row.status) && row.resolution_status === 'resolved' && can('inventory.view')" link type="primary" @click="openResolution(row)">查看处理结果</el-button><span v-if="!(can('inventory.manage') && activeTask.status === 'in_progress') && !(isExceptionStatus(row.status) && row.resolution_status === 'pending' && can('inventory.manage')) && !(isExceptionStatus(row.status) && row.resolution_status === 'resolved' && can('inventory.view'))">—</span></div></template></el-table-column>
            </el-table>
          </PagedTable>
        </PageSection>
      </PageContent>
    </PageContainer>

    <el-dialog v-model="showTaskDialog" title="新建盘点任务" width="620px" destroy-on-close @close="closeTaskDialog">
      <el-alert v-if="taskAuxError" :title="taskAuxError" type="error" show-icon :closable="false" class="inventory-alert">
        <template #default>
          <el-button link type="primary" @click="retryTaskAuxData">重新加载辅助数据</el-button>
        </template>
      </el-alert>
      <el-form ref="taskFormRef" :model="taskForm" :rules="taskRules" :validate-on-rule-change="false" label-position="top">
        <el-form-item label="盘点名称" prop="name"><el-input v-model="taskForm.name" placeholder="例如：2026年沈阳数据中心年度盘点" /></el-form-item>
        <div class="form-grid">
          <el-form-item label="数据中心" prop="data_center"><el-select v-model="taskForm.data_center" :loading="auxLoading" @change="changeTaskDataCenter"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item label="机房（不选表示整个数据中心）"><el-select v-model="taskForm.server_room" clearable :disabled="Boolean(taskAuxError)" placeholder="整个数据中心" @change="changeTaskServerRoom"><el-option v-for="room in activeRooms" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
        </div>
        <section class="inventory-scope-preview" aria-live="polite">
          <div class="inventory-scope-preview__header">
            <strong>盘点范围</strong>
            <el-button v-if="scopePreviewError" link type="primary" @click="retryScopePreview">重新加载</el-button>
          </div>
          <template v-if="scopePreviewLoading">
            <div class="inventory-scope-preview__state">正在计算盘点范围...</div>
          </template>
          <template v-else-if="scopePreviewError">
            <div class="inventory-scope-preview__state inventory-scope-preview__state--error">盘点范围加载失败</div>
          </template>
          <template v-else-if="scopePreview">
            <div class="inventory-scope-preview__scope">{{ scopePreview.scope_label }}</div>
            <div class="inventory-scope-preview__total"><strong>{{ scopePreview.total }}</strong><span>台资产</span></div>
            <div class="inventory-scope-preview__stats">
              <span>已上架<strong>{{ scopePreview.racked }}</strong></span>
              <span>未上架<strong>{{ scopePreview.unracked }}</strong></span>
              <span>已报废<strong>{{ scopePreview.retired }}</strong></span>
            </div>
            <div v-if="scopePreview.total === 0" class="inventory-scope-preview__state inventory-scope-preview__state--warning">当前范围内没有可盘点资产</div>
            <ul v-if="scopePreviewWarnings.length" class="inventory-scope-preview__warnings">
              <li v-for="warning in scopePreviewWarnings" :key="warning">{{ warning }}</li>
            </ul>
            <p class="inventory-scope-preview__help">
              {{ scopePreview.includes_unracked ? "选择整个数据中心时，会包含属于该数据中心的未上架资产。" : "选择具体机房时，仅包含该机房内已上架资产。" }}
            </p>
            <p class="inventory-scope-preview__help">停用机房和停用机柜不纳入盘点范围。</p>
            <p class="inventory-scope-preview__help">任务创建后会固定当前资产清单，后续资产变化不会自动加入本次盘点。</p>
          </template>
          <div v-else class="inventory-scope-preview__state">请选择数据中心以计算盘点范围</div>
        </section>
        <div class="form-grid">
          <el-form-item label="盘点人"><el-select v-model="taskForm.inspector" clearable :loading="auxLoading" :disabled="Boolean(taskAuxError)" placeholder="默认当前用户"><el-option v-for="person in inspectors" :key="person.id" :label="person.display_name" :value="String(person.id)" /></el-select></el-form-item>
          <el-form-item label="开始时间" prop="start_at"><el-date-picker v-model="taskForm.start_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item label="结束时间" prop="end_at"><el-date-picker v-model="taskForm.end_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="taskForm.notes" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="closeTaskDialog">取消</el-button><el-button type="primary" :loading="taskCreating" :disabled="taskCreating || scopePreviewLoading || Boolean(scopePreviewError) || !scopePreview || scopePreview.total <= 0" @click="submitTask">创建并生成清单</el-button></template>
    </el-dialog>

    <el-dialog v-model="showItemDialog" title="确认盘点" width="560px" destroy-on-close>
      <el-alert v-if="itemAuxError" :title="itemAuxError" type="error" show-icon :closable="false" class="inventory-alert">
        <template #default>
          <el-button link type="primary" @click="retryRackAuxData">重新加载机柜</el-button>
        </template>
      </el-alert>
      <el-alert v-if="editingItem" :title="`${editingItem.asset_no} · ${editingItem.asset_name}`" type="info" :closable="false" />
      <el-form :key="editingItem?.id ?? 'inventory-item-form'" ref="itemFormRef" :model="itemForm" :rules="itemRules" :validate-on-rule-change="false" label-position="top" class="inventory-item-form">
          <el-form-item label="盘点结果" prop="status"><el-select v-model="itemForm.status" placeholder="请选择盘点结果" @change="changeItemStatus"><el-option v-for="item in itemResultOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-alert v-if="itemForm.status === 'normal'" title="正常表示与任务创建时的系统位置一致，位置已自动带入且不可修改。" type="success" :closable="false" show-icon />
          <div v-if="itemForm.status && itemForm.status !== 'not_found'" class="form-grid">
          <el-form-item label="实际机柜"><el-select v-model="itemForm.actual_rack" clearable :disabled="Boolean(itemAuxError) || itemForm.status === 'normal'" placeholder="未上架"><el-option v-for="rack in activeRacks" :key="rack.id" :label="`${rack.data_center_name} / ${rack.server_room_name} / ${rack.code}`" :value="String(rack.id)" /></el-select></el-form-item>
          <el-form-item label="实际起始 U"><el-input-number v-model="itemForm.actual_start_u" :min="1" controls-position="right" :disabled="itemForm.status === 'normal'" /></el-form-item>
          <el-form-item label="实际结束 U"><el-input-number v-model="itemForm.actual_end_u" :min="1" controls-position="right" :disabled="itemForm.status === 'normal'" /></el-form-item>
          </div>
        <el-form-item label="备注"><el-input v-model="itemForm.notes" type="textarea" :rows="3" placeholder="设备信息不符时请记录具体差异" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="showItemDialog = false">取消</el-button><el-button :disabled="!itemCanSave" @click="submitItem">保存</el-button><el-button type="primary" :loading="itemSaving" :disabled="!itemCanSave" @click="submitItemAndNext">保存并下一项</el-button></template>
    </el-dialog>

    <el-dialog
      v-model="showResolutionDialog"
      title="处理盘点异常"
      width="620px"
      class="inventory-resolution-dialog"
      destroy-on-close
      :show-close="!resolutionSaving"
      :close-on-click-modal="!resolutionSaving"
      :close-on-press-escape="!resolutionSaving"
      @close="closeResolutionDialog"
    >
      <template v-if="resolutionItem">
        <section class="inventory-resolution-asset">
          <div class="inventory-resolution-asset__main">
            <strong>{{ resolutionItem.asset_no }} · {{ resolutionItem.asset_name }}</strong>
            <span>{{ resolutionItem.asset_type || "未标注设备类型" }}<template v-if="resolutionItem.serial_number"> · SN：{{ resolutionItem.serial_number }}</template></span>
          </div>
          <el-button link type="primary" @click="openAssetDetail(resolutionItem.asset)">查看资产详情</el-button>
        </section>

        <section class="inventory-resolution-section">
          <div class="inventory-resolution-section__title">异常信息</div>
          <div class="inventory-resolution-exception">
            <StatusTag :status="resolutionItem.status" :type="statusTagType(resolutionItem.status)" :label="resolutionItem.status_label" />
            <span v-if="resolutionItem.notes">盘点备注：{{ resolutionItem.notes }}</span>
            <span v-else class="inventory-resolution-muted">未填写盘点备注</span>
          </div>
        </section>

        <section class="inventory-resolution-section">
          <div class="inventory-resolution-section__title">位置对比</div>
          <div class="inventory-resolution-location-grid">
            <div class="inventory-resolution-location-card">
              <span>账面位置</span>
              <strong>{{ locationText(resolutionItem) }}</strong>
            </div>
            <div class="inventory-resolution-location-card">
              <span>实际位置</span>
              <strong>{{ resolutionItem.status === 'not_found' ? '未找到' : locationText(resolutionItem, true) }}</strong>
            </div>
          </div>
        </section>

        <template v-if="resolutionReadOnly">
          <section class="inventory-resolution-section inventory-resolution-readonly">
            <div class="inventory-resolution-section__title">处理结果</div>
            <div class="inventory-resolution-readonly__grid">
              <div><span>处理状态</span><StatusTag :status="resolutionItem.resolution_status" :type="resolutionStatusTagType(resolutionItem.resolution_status)" :label="resolutionStatusLabel(resolutionItem.resolution_status)" /></div>
              <div><span>处理方式</span><strong>{{ resolutionActionLabel(resolutionItem.resolution_action) }}</strong></div>
              <div><span>处理人</span><strong>{{ resolutionItem.resolved_by_name || '—' }}</strong></div>
              <div><span>处理时间</span><strong>{{ formatDateTime(resolutionItem.resolved_at) }}</strong></div>
            </div>
            <div class="inventory-resolution-readonly__note"><span>处理备注</span><p>{{ resolutionItem.resolution_note || '—' }}</p></div>
            <el-alert v-if="resolutionItem.resolution_action === 'update_asset'" type="success" :closable="false" title="已执行资产台账位置更新" />
          </section>
        </template>

        <el-form
          v-else
          ref="resolutionFormRef"
          :model="resolutionForm"
          :rules="resolutionRules"
          :validate-on-rule-change="false"
          label-position="top"
          class="inventory-resolution-form"
        >
          <el-form-item label="处理方式" prop="action">
            <el-select v-model="resolutionForm.action" placeholder="请选择处理方式" :disabled="resolutionSaving">
              <el-option v-for="option in resolutionOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-alert v-if="resolutionLocationIncomplete" type="info" :closable="false" title="当前盘点结果缺少完整机柜/U位信息，无法更新资产位置。" />
          <el-alert v-if="resolutionUpdateSelected" type="warning" :closable="false" title="确认后将修改资产台账中的位置，请核对更新前后信息。">
            <div class="inventory-resolution-change">
              <div><span>更新前</span><strong>{{ locationText(resolutionItem) }}</strong></div>
              <div><span>更新后</span><strong>{{ locationText(resolutionItem, true) }}</strong></div>
            </div>
          </el-alert>
          <el-form-item label="处理备注" prop="note">
            <el-input v-model="resolutionForm.note" type="textarea" :rows="3" :disabled="resolutionSaving" placeholder="记录本次异常处理说明" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button :disabled="resolutionSaving" @click="closeResolutionDialog">{{ resolutionReadOnly ? '关闭' : '取消' }}</el-button>
        <el-button v-if="!resolutionReadOnly" type="primary" :loading="resolutionSaving" :disabled="!resolutionCanSave" @click="submitResolution">确认处理</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showBulkResolutionDialog"
      title="批量处理盘点异常"
      width="520px"
      class="inventory-bulk-resolution-dialog"
      destroy-on-close
      :show-close="!bulkResolutionSaving"
      :close-on-click-modal="!bulkResolutionSaving"
      :close-on-press-escape="!bulkResolutionSaving"
      @close="closeBulkResolutionDialog"
    >
      <template v-if="bulkResolutionResult">
        <el-alert
          :type="bulkResolutionResult.failed ? 'warning' : 'success'"
          :closable="false"
          :title="`成功处理 ${bulkResolutionResult.succeeded} 条，${bulkResolutionResult.failed} 条失败`"
        />
        <section v-if="bulkResolutionFailures.length" class="inventory-bulk-resolution-failures">
          <div class="inventory-resolution-section__title">失败明细</div>
          <div v-for="failure in bulkResolutionFailures" :key="failure.item_id" class="inventory-bulk-resolution-failure">
            <strong>{{ failure.asset_no }}</strong>
            <span>{{ failure.reason }}</span>
          </div>
        </section>
      </template>
      <el-form
        v-else
        ref="bulkResolutionFormRef"
        :model="bulkResolutionForm"
        :rules="bulkResolutionRules"
        :validate-on-rule-change="false"
        label-position="top"
        class="inventory-bulk-resolution-form"
      >
        <div class="inventory-bulk-resolution-meta">
          <span>处理条数</span>
          <strong>{{ bulkResolutionCount }} 条</strong>
          <span>处理方式</span>
          <strong>{{ resolutionActionLabel(bulkResolutionAction) }}</strong>
        </div>
        <el-alert v-if="bulkResolutionNotice" type="info" :closable="false" :title="bulkResolutionNotice" />
        <el-form-item label="处理备注" prop="note">
          <el-input
            v-model="bulkResolutionForm.note"
            type="textarea"
            :rows="3"
            :disabled="bulkResolutionSaving"
            :placeholder="bulkResolutionAction === 'ignore' ? '请填写统一的忽略原因' : '可填写本次批量处理说明'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="bulkResolutionSaving" @click="closeBulkResolutionDialog">
          {{ bulkResolutionResult ? '关闭' : '取消' }}
        </el-button>
        <el-button v-if="!bulkResolutionResult" type="primary" :loading="bulkResolutionSaving" :disabled="bulkResolutionSaving" @click="submitBulkResolution">
          确认处理
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showBulkNormalDialog"
      title="批量标记为正常"
      width="520px"
      class="inventory-bulk-normal-dialog"
      destroy-on-close
      :show-close="!bulkNormalSaving"
      :close-on-click-modal="!bulkNormalSaving"
      :close-on-press-escape="!bulkNormalSaving"
      @close="closeBulkNormalDialog"
    >
      <template v-if="bulkNormalResult">
        <el-alert
          :type="bulkNormalResult.failed ? 'warning' : 'success'"
          :closable="false"
          :title="`已将 ${bulkNormalResult.succeeded} 条资产标记为盘点正常，${bulkNormalResult.failed} 条失败`"
        />
        <section v-if="bulkNormalFailures.length" class="inventory-bulk-resolution-failures">
          <div class="inventory-resolution-section__title">失败明细</div>
          <div v-for="failure in bulkNormalFailures" :key="failure.item_id" class="inventory-bulk-resolution-failure">
            <strong>{{ failure.asset_no }}</strong>
            <span>{{ failure.reason }}</span>
          </div>
        </section>
      </template>
      <template v-else>
        <p class="inventory-bulk-normal-summary">将 {{ bulkNormalCount }} 台资产标记为盘点正常</p>
        <el-alert
          type="info"
          :closable="false"
          title="系统将确认这些资产与任务创建时的账面信息一致，并自动记录盘点时间和盘点人。"
        />
        <p class="inventory-bulk-normal-help">如果设备实际存在位置或信息差异，请取消并逐项盘点。</p>
      </template>
      <template #footer>
        <el-button :disabled="bulkNormalSaving" @click="closeBulkNormalDialog">
          {{ bulkNormalResult ? '关闭' : '取消' }}
        </el-button>
        <el-button v-if="!bulkNormalResult" type="primary" :loading="bulkNormalSaving" :disabled="bulkNormalSaving" @click="saveBulkNormal">
          确认标记
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
