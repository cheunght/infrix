<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ArrowDown,
  CircleCheck,
  Delete,
  Download,
  Edit,
  MoreFilled,
  Tools,
  VideoPlay,
  View,
} from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageHeader from "./page/PageHeader.vue";
import PageToolbar from "./page/PageToolbar.vue";
import PageSection from "./page/PageSection.vue";
import StatusTag from "./StatusTag.vue";
import { statusTone } from "../status";
import ResourceState from "./ResourceState.vue";
import AssetSummary from "./AssetSummary.vue";
import ActionDialogShell from "./ActionDialogShell.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import type { FormInstance, FormRules } from "element-plus";
import type { InventoryItem } from "../types";
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
const taskRoomHelp = "不选择表示整个数据中心。";

const {
  taskListLoading, taskListError, itemListLoading, itemListError, taskDetailLoading, taskDetailError,
  auxLoading, taskAuxError, itemAuxError, taskCreating, taskDeletingId, taskCompleting, taskReopening, itemSaving, resolutionSaving,
  bulkResolutionSaving, bulkNormalSaving,
  taskDialogError, itemDialogError, resolutionDialogError, bulkResolutionDialogError, bulkNormalDialogError,
  tasks, taskCount, taskPage, taskPageSize, taskSearch, taskStatus,
  activeTask, items, itemCount, itemPage, itemPageSize,
  itemSearch, itemStatus, itemResolutionStatus, inspectors, racks, showTaskDialog, showItemDialog,
  showResolutionDialog, showBulkResolutionDialog, showBulkNormalDialog, editingItem, resolutionItem,
  scopePreview, scopePreviewLoading, scopePreviewError,
  taskForm, itemForm, resolutionForm, bulkResolutionAction, bulkResolutionCount, bulkResolutionForm, bulkResolutionResult,
  bulkNormalCount, bulkNormalResult,
  activeDataCenters, activeRooms, activeRacks,
  taskHasFilters, itemHasFilters,
  taskStatusOptions, itemStatusOptions, itemResultOptions, itemResolutionStatusOptions, taskStatusLabel,
  formatDateTime, locationText, statusTagType, isExceptionStatus, resolutionStatusLabel,
  resolutionStatusTagType, resolutionActionLabel, hasCompleteActualLocation, resolutionActionOptions,
  selectedBatchItems, batchSelectionMode, isBatchSelectable, onBatchSelectionChange, batchSelectionModeFor,
  isBatchSelectableForMode, batchResolutionActionOptions, clearBatchSelection,
  taskScope, loadInitialData, loadTasks, loadItems, retryActiveTask, openTask, closeTask,
  openNewTask, changeTaskDataCenter, saveTask, deleteTask, completeTask, reopenTask, exportTask, exportingTaskId,
  changeTaskServerRoom, retryScopePreview, closeTaskDialog,
  openItem, changeItemStatus, saveItem, saveItemAndNext, changeTaskPage, changeTaskPageSize,
  changeItemPage, changeItemPageSize, resetTaskFilters, resetItemFilters,
  retryTaskAuxData, retryRackAuxData, openResolution, closeResolutionDialog, saveResolution,
  openBulkResolution, closeBulkResolutionDialog, saveBulkResolution, openBulkNormal, closeBulkNormalDialog, saveBulkNormal,
} = useInventory(context);

const actualStartUValue = computed<number | null>({
  get: () => {
    const value = Number(itemForm.value.actual_start_u);
    return itemForm.value.actual_start_u && Number.isFinite(value) ? value : null;
  },
  set: (value) => {
    itemForm.value.actual_start_u = value == null ? "" : String(value);
  },
});
const actualEndUValue = computed<number | null>({
  get: () => {
    const value = Number(itemForm.value.actual_end_u);
    return itemForm.value.actual_end_u && Number.isFinite(value) ? value : null;
  },
  set: (value) => {
    itemForm.value.actual_end_u = value == null ? "" : String(value);
  },
});

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
    activeTask.value?.status === "in_progress" &&
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

function handleActiveTaskAction(command: string) {
  if (command === "reopen") void reopenTask();
}

function itemPrimaryAction(item: InventoryItem) {
  if (activeTask.value?.status === "in_progress" && can("inventory.manage")) {
    if (item.status === "pending") return "confirm";
    if (isExceptionStatus(item.status) && item.resolution_status === "pending") return "resolve";
    if (isExceptionStatus(item.status) && item.resolution_status === "resolved" && can("inventory.view")) return "view";
    return "edit";
  }
  if (isExceptionStatus(item.status) && item.resolution_status === "resolved" && can("inventory.view")) {
    return "view";
  }
  return "";
}

function itemCanEditException(item: InventoryItem) {
  return Boolean(
    activeTask.value?.status === "in_progress" &&
    can("inventory.manage") &&
    isExceptionStatus(item.status) &&
    item.resolution_status === "pending",
  );
}

function itemPrimaryActionLabel(item: InventoryItem) {
  switch (itemPrimaryAction(item)) {
    case "confirm": return "确认盘点";
    case "resolve": return "处理";
    case "view": return "查看处理结果";
    case "edit": return "修改结果";
    default: return "";
  }
}

function itemPrimaryActionIcon(item: InventoryItem) {
  switch (itemPrimaryAction(item)) {
    case "confirm": return CircleCheck;
    case "resolve": return Tools;
    case "view": return View;
    case "edit": return Edit;
    default: return View;
  }
}

function itemPrimaryActionType(item: InventoryItem) {
  return itemPrimaryAction(item) === "resolve" ? "warning" : "primary";
}

function openPrimaryItemAction(item: InventoryItem) {
  if (itemPrimaryAction(item) === "resolve" || itemPrimaryAction(item) === "view") {
    return openResolution(item);
  }
  return openItem(item);
}

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
            <SearchField v-model="taskSearch" placeholder="搜索任务名称、数据中心或盘点人" aria-label="搜索盘点任务" @search="() => { taskPage = 1; loadTasks(); }" />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select v-model="taskStatus" placeholder="全部状态" clearable @change="() => { taskPage = 1; loadTasks(); }">
                <el-option v-for="item in taskStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </div>
          </template>
          <template #primary>
            <el-button v-if="can('inventory.manage')" class="page-primary-action" type="primary" :loading="taskCreating" :disabled="taskCreating" @click="openNewTask">
              新增盘点
            </el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <ResourceState
          :loading="taskListLoading && !tasks.length"
          :error="taskListError && !tasks.length ? taskListError : ''"
          :empty="!taskListLoading && !taskListError && !tasks.length"
          :empty-text="taskHasFilters ? '没有符合当前筛选条件的盘点任务' : '暂无盘点任务'"
          @retry="() => loadTasks()"
        >
          <template #empty>
            <el-empty :image-size="56" :description="taskHasFilters ? '没有符合当前筛选条件的盘点任务' : '暂无盘点任务'">
              <el-button v-if="taskHasFilters" link type="primary" @click="resetTaskFilters">清除筛选</el-button>
            </el-empty>
          </template>
          <template #error="{ error }">
            <el-alert title="盘点任务加载失败" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" @click="loadTasks">重新加载</el-button>
          </template>
          <el-alert v-if="taskListError" :title="taskListError" type="error" show-icon :closable="false" class="inventory-alert" />
          <div v-if="taskListError" class="inventory-retry-row">
            <el-button link type="primary" @click="() => loadTasks()">重新加载</el-button>
          </div>
          <el-table v-loading="taskListLoading" :data="tasks" table-layout="fixed">
            <template #empty>
              <el-empty :image-size="56" :description="taskHasFilters ? '没有符合当前筛选条件的盘点任务' : '暂无盘点任务'">
                <el-button v-if="taskHasFilters" link type="primary" @click="resetTaskFilters">清除筛选</el-button>
              </el-empty>
            </template>
            <el-table-column prop="name" label="任务名称" min-width="240">
              <template #default="{ row }">
                <el-button link type="primary" class="inventory-task-name" @click.stop="openTask(row)">
                  {{ row.name }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="盘点范围" min-width="220">
              <template #default="{ row }">{{ taskScope(row) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <StatusTag :tone="statusTone(row.status)" :label="taskStatusLabel(row.status)" />
              </template>
            </el-table-column>
            <el-table-column label="进度" width="150">
              <template #default="{ row }">
                <div class="inventory-progress-cell" :aria-label="`已盘 ${row.summary.checked} / ${row.summary.total}`">
                  <span>{{ row.summary.checked }} / {{ row.summary.total }}</span>
                  <el-progress :percentage="row.summary.completion_rate" :stroke-width="6" :show-text="false" />
                </div>
              </template>
            </el-table-column>
            <el-table-column label="异常" width="80">
              <template #default="{ row }">
                <StatusTag :tone="row.summary.exceptions > 0 ? 'warning' : 'info'" :label="String(row.summary.exceptions)" />
              </template>
            </el-table-column>
            <el-table-column label="创建时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="操作" fixed="right" width="210">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton
                    v-if="row.status === 'in_progress' && can('inventory.manage')"
                    :icon="VideoPlay"
                    label="继续盘点"
                    type="primary"
                    @click="openTask(row)"
                  />
                  <TableIconButton
                    v-else-if="row.status === 'completed' && can('inventory.view')"
                    :icon="View"
                    label="查看结果"
                    type="primary"
                    @click="openTask(row)"
                  />
                  <TableIconButton
                    v-if="can('inventory.export')"
                    :icon="Download"
                    label="导出结果"
                    :loading="exportingTaskId === row.id"
                    :disabled="exportingTaskId !== null && exportingTaskId !== row.id"
                    @click="exportTask(row)"
                  />
                  <TableIconButton
                    v-if="can('inventory.manage') && row.can_delete"
                    :icon="Delete"
                    label="删除任务"
                    type="danger"
                    :loading="taskDeletingId === row.id"
                    :disabled="taskDeletingId !== null && taskDeletingId !== row.id"
                    @click="deleteTask(row)"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
          <PagedTable v-model:current-page="taskPage" v-model:page-size="taskPageSize" :total="taskCount" :page-sizes="[20, 50, 100]" @update:current-page="changeTaskPage" @update:page-size="changeTaskPageSize" />
        </ResourceState>
      </PageContent>
    </PageContainer>

    <PageContainer v-else>
      <template #header>
        <PageHeader
          :title="activeTask.name"
          :description="taskScope(activeTask) + ' · 盘点人：' + activeTask.inspector_name + (activeTask.completed_at ? ' · 完成于 ' + formatDateTime(activeTask.completed_at) : '')"
        >
          <template #leading>
            <el-button link @click="closeTask">返回任务列表</el-button>
          </template>
          <template #actions>
            <StatusTag :tone="statusTone(activeTask.status)" :label="taskStatusLabel(activeTask.status)" />
            <el-button v-if="can('inventory.export')" :icon="Download" :loading="exportingTaskId === activeTask.id" :disabled="exportingTaskId !== null" @click="exportTask()">
              导出结果
            </el-button>
            <el-button
              v-if="can('inventory.manage') && activeTask.status === 'in_progress'"
              type="primary"
              :loading="taskCompleting"
              :disabled="taskCompleting || activeTask.summary.pending > 0"
              :title="activeTask.summary.pending > 0 ? `仍有 ${activeTask.summary.pending} 项未盘点，无法完成盘点` : undefined"
              @click="completeTask"
            >
              完成盘点
            </el-button>
            <el-dropdown
              v-if="can('inventory.manage') && activeTask.status === 'completed'"
              trigger="click"
              @command="handleActiveTaskAction"
            >
              <el-button class="inventory-more-action">
                更多<el-icon class="el-icon--right"><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="reopen" :disabled="taskReopening">重新打开任务</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </PageHeader>
      </template>
      <PageContent v-loading="taskDetailLoading">
        <el-alert v-if="taskDetailError" :title="taskDetailError" type="error" show-icon :closable="false" class="inventory-alert" />
        <div v-if="taskDetailError" class="inventory-retry-row">
          <el-button link type="primary" @click="retryActiveTask">重新加载任务</el-button>
        </div>
        <PageSection title="任务摘要">
          <section class="inventory-summary-strip" aria-label="盘点摘要">
            <div class="inventory-summary-metric">
              <span>总资产</span>
              <strong>{{ activeTask.summary.total }}</strong>
            </div>
            <div class="inventory-summary-metric">
              <span>已盘</span>
              <strong>{{ activeTask.summary.checked }}</strong>
            </div>
            <div class="inventory-summary-metric">
              <span>正常</span>
              <strong>{{ activeTask.summary.normal }}</strong>
            </div>
            <div class="inventory-summary-metric inventory-summary-metric--warning">
              <span>异常</span>
              <strong>{{ activeTask.summary.exceptions }}</strong>
            </div>
            <div class="inventory-summary-metric">
              <span>未盘</span>
              <strong>{{ activeTask.summary.pending }}</strong>
            </div>
            <div class="inventory-summary-progress">
              <div class="inventory-summary-progress__header">
                <span>完成进度</span>
                <strong>{{ activeTask.summary.checked }} / {{ activeTask.summary.total }}</strong>
              </div>
              <small>未处理异常 {{ activeTask.summary.resolution_pending }}</small>
              <el-progress :percentage="activeTask.summary.completion_rate" :stroke-width="6" :show-text="false" />
            </div>
          </section>
        </PageSection>
        <PageSection title="盘点设备">
          <PageToolbar>
            <template #search>
              <SearchField v-model="itemSearch" placeholder="搜索资产编号、名称、序列号或 IP" aria-label="搜索盘点设备" @search="() => { itemPage = 1; loadItems(); }" />
            </template>
            <template #filters>
              <div class="page-toolbar__filter-group">
                <el-select v-model="itemStatus" placeholder="全部盘点结果" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
                <el-select v-model="itemResolutionStatus" placeholder="全部处理状态" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemResolutionStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
              </div>
            </template>
          </PageToolbar>
          <div v-if="selectedBatchItems.length" class="inventory-batch-bar" role="status" aria-live="polite">
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
          <ResourceState
            :loading="itemListLoading && !items.length"
            :error="itemListError && !items.length ? itemListError : ''"
            :empty="!itemListLoading && !itemListError && !items.length"
            :empty-text="itemHasFilters ? '没有符合当前筛选条件的盘点设备' : '当前任务没有盘点设备'"
            @retry="() => loadItems()"
          >
            <template #empty>
              <el-empty :image-size="56" :description="itemHasFilters ? '没有符合当前筛选条件的盘点设备' : '当前任务没有盘点设备'">
                <el-button v-if="itemHasFilters" link type="primary" @click="resetItemFilters">清除筛选</el-button>
            </el-empty>
            </template>
            <template #error="{ error }">
              <el-alert title="盘点设备加载失败" :description="error" type="error" show-icon :closable="false" />
              <el-button link type="primary" @click="loadItems">重新加载设备</el-button>
            </template>
            <el-alert v-if="itemListError" :title="itemListError" type="error" show-icon :closable="false" class="inventory-alert" />
            <div v-if="itemListError" class="inventory-retry-row">
              <el-button link type="primary" @click="() => loadItems()">重新加载设备</el-button>
            </div>
            <PagedTable v-model:current-page="itemPage" v-model:page-size="itemPageSize" :total="itemCount" :page-sizes="[20, 50, 100]" @update:current-page="changeItemPage" @update:page-size="changeItemPageSize">
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
              <el-empty :image-size="56" :description="itemHasFilters ? '没有符合当前筛选条件的盘点设备' : '当前任务没有盘点设备'">
                <el-button v-if="itemHasFilters" link type="primary" @click="resetItemFilters">清除筛选</el-button>
            </el-empty>
            </template>
          <el-table-column v-if="can('inventory.manage') && activeTask.status === 'in_progress'" type="selection" width="48" :selectable="isBatchSelectable" />
          <el-table-column label="资产" min-width="240">
            <template #default="{ row }">
              <el-button link type="primary" class="inventory-asset-cell" @click.stop="openAssetDetail(row.asset)">
                {{ row.asset_no }} · {{ row.asset_name }}
              </el-button>
            </template>
          </el-table-column>
          <el-table-column label="账面位置" min-width="250">
            <template #default="{ row }">{{ locationText(row) }}</template>
          </el-table-column>
          <el-table-column label="盘点结果" width="130">
            <template #default="{ row }"><StatusTag :tone="statusTagType(row.status)" :label="row.status_label" /></template>
          </el-table-column>
          <el-table-column label="异常状态" width="105">
            <template #default="{ row }">
              <StatusTag
                v-if="isExceptionStatus(row.status)"
                :tone="resolutionStatusTagType(row.resolution_status)"
                :label="resolutionStatusLabel(row.resolution_status)"
              />
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="处理结果" width="140">
            <template #default="{ row }">
              {{ row.resolution_status === 'resolved' ? resolutionActionLabel(row.resolution_action) : '—' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" fixed="right" width="190">
            <template #default="{ row }">
              <div class="ep-table-actions">
                <TableIconButton
                  v-if="itemPrimaryAction(row)"
                  :icon="itemPrimaryActionIcon(row)"
                  :label="itemPrimaryActionLabel(row)"
                  :type="itemPrimaryActionType(row)"
                  @click="openPrimaryItemAction(row)"
                />
                <TableIconButton
                  v-if="itemCanEditException(row)"
                  :icon="Edit"
                  label="修改盘点结果"
                  type="primary"
                  @click="openItem(row)"
                />
                <span v-if="!itemPrimaryAction(row) && !itemCanEditException(row)">—</span>
              </div>
            </template>
          </el-table-column>
            </el-table>
            </PagedTable>
          </ResourceState>
        </PageSection>
      </PageContent>
    </PageContainer>

    <FormDialogShell
      v-model="showTaskDialog"
      title="新增盘点任务"
      description="设置盘点范围、时间和盘点备注"
      size="medium"
      :loading="auxLoading || scopePreviewLoading"
      :saving="taskCreating"
      :error="taskDialogError"
      :show-close="!taskCreating"
      :close-on-click-modal="!taskCreating"
      :close-on-press-escape="!taskCreating"
      :close-disabled="taskCreating"
      @close="closeTaskDialog"
    >
      <el-alert v-if="taskAuxError" :title="taskAuxError" type="error" show-icon :closable="false" class="inventory-alert">
        <template #default>
          <el-button link type="primary" @click="retryTaskAuxData">重新加载辅助数据</el-button>
        </template>
      </el-alert>
      <el-form ref="taskFormRef" class="horizontal-form inventory-task-form" :model="taskForm" :rules="taskRules" :validate-on-rule-change="false" label-position="right" @submit.prevent="submitTask">
        <div class="horizontal-form__rows">
          <el-form-item label="任务名称" prop="name"><el-input v-model="taskForm.name" placeholder="例如：2026年沈阳数据中心年度盘点" /></el-form-item>
          <el-form-item label="数据中心" prop="data_center"><el-select v-model="taskForm.data_center" :loading="auxLoading" @change="changeTaskDataCenter"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item label="机房">
            <el-select v-model="taskForm.server_room" clearable :disabled="Boolean(taskAuxError)" placeholder="整个数据中心" @change="changeTaskServerRoom"><el-option v-for="room in activeRooms" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select>
            <FieldHelp :text="taskRoomHelp" />
          </el-form-item>
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
        <div class="horizontal-form__rows">
          <el-form-item label="盘点人"><el-select v-model="taskForm.inspector" clearable :loading="auxLoading" :disabled="Boolean(taskAuxError)" placeholder="默认当前用户"><el-option v-for="person in inspectors" :key="person.id" :label="person.display_name" :value="String(person.id)" /></el-select></el-form-item>
          <el-form-item label="开始时间" prop="start_at"><el-date-picker v-model="taskForm.start_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item label="结束时间" prop="end_at"><el-date-picker v-model="taskForm.end_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="taskForm.notes" type="textarea" :rows="3" /></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button :disabled="taskCreating" @click="closeTaskDialog">取消</el-button><el-button type="primary" :loading="taskCreating" :disabled="taskCreating || scopePreviewLoading || Boolean(scopePreviewError) || !scopePreview || scopePreview.total <= 0" @click="submitTask">保存任务</el-button></template>
    </FormDialogShell>

    <ActionDialogShell
      v-model="showItemDialog"
      title="确认盘点"
      description="记录当前设备的盘点结果与实际位置"
      size="medium"
      :pending="itemSaving"
      :error="itemDialogError"
      :close-disabled="itemSaving"
    >
      <el-alert v-if="itemAuxError" :title="itemAuxError" type="error" show-icon :closable="false" class="inventory-alert">
        <template #default>
          <el-button link type="primary" @click="retryRackAuxData">重新加载机柜</el-button>
        </template>
      </el-alert>
      <AssetSummary v-if="editingItem" :asset="editingItem" compact :show-status="false" />
      <el-form :key="editingItem?.id ?? 'inventory-item-form'" ref="itemFormRef" :model="itemForm" :rules="itemRules" :validate-on-rule-change="false" label-position="top" class="inventory-item-form">
          <el-form-item label="盘点结果" prop="status"><el-select v-model="itemForm.status" placeholder="请选择盘点结果" @change="changeItemStatus"><el-option v-for="item in itemResultOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-alert v-if="itemForm.status === 'normal'" title="正常表示与任务创建时的系统位置一致，位置已自动带入且不可修改。" type="success" :closable="false" show-icon />
          <div v-if="itemForm.status && itemForm.status !== 'not_found'" class="form-grid">
          <el-form-item label="实际机柜"><el-select v-model="itemForm.actual_rack" clearable :disabled="Boolean(itemAuxError) || itemForm.status === 'normal'" placeholder="未上架"><el-option v-for="rack in activeRacks" :key="rack.id" :label="`${rack.data_center_name} / ${rack.server_room_name} / ${rack.code}`" :value="String(rack.id)" /></el-select></el-form-item>
          <el-form-item label="实际起始 U"><el-input-number v-model="actualStartUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" aria-label="实际起始 U" :disabled="itemForm.status === 'normal'"><template #suffix>U</template></el-input-number></el-form-item>
          <el-form-item label="实际结束 U"><el-input-number v-model="actualEndUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" aria-label="实际结束 U" :disabled="itemForm.status === 'normal'"><template #suffix>U</template></el-input-number></el-form-item>
          </div>
        <el-form-item label="备注"><el-input v-model="itemForm.notes" type="textarea" :rows="3" placeholder="设备信息不符时请记录具体差异" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="itemSaving" @click="showItemDialog = false">取消</el-button><el-button :disabled="!itemCanSave" @click="submitItem">保存</el-button><el-button type="primary" :loading="itemSaving" :disabled="!itemCanSave" @click="submitItemAndNext">保存并下一项</el-button></template>
    </ActionDialogShell>

    <ActionDialogShell
      v-model="showResolutionDialog"
      title="处理盘点异常"
      description="选择处理方式并保留本次盘点的处理记录"
      class="inventory-resolution-dialog"
      size="medium"
      :pending="resolutionSaving"
      :error="resolutionDialogError"
      :close-disabled="resolutionSaving"
      @close="closeResolutionDialog"
    >
      <template v-if="resolutionItem">
        <section class="action-dialog__summary inventory-resolution-summary">
          <div class="inventory-resolution-summary__header">
            <AssetSummary class="inventory-resolution-asset__main" :asset="resolutionItem" compact :show-status="false" />
            <el-button link type="primary" @click="openAssetDetail(resolutionItem.asset)">查看资产详情</el-button>
          </div>
          <div class="inventory-resolution-summary__facts">
            <div>
              <span>盘点结果</span>
              <StatusTag :tone="statusTagType(resolutionItem.status)" :label="resolutionItem.status_label" />
            </div>
            <div>
              <span>账面位置</span>
              <strong>{{ locationText(resolutionItem) }}</strong>
            </div>
            <div v-if="resolutionItem.status !== 'not_found'">
              <span>实际位置</span>
              <strong>{{ locationText(resolutionItem, true) }}</strong>
            </div>
            <div class="inventory-resolution-summary__note">
              <span>盘点备注</span>
              <strong>{{ resolutionItem.notes || '未填写盘点备注' }}</strong>
            </div>
          </div>
        </section>

        <template v-if="resolutionReadOnly">
          <section class="inventory-resolution-section inventory-resolution-readonly">
            <div class="inventory-resolution-section__title">处理结果</div>
            <div class="inventory-resolution-readonly__grid">
              <div><span>处理状态</span><StatusTag :tone="resolutionStatusTagType(resolutionItem.resolution_status)" :label="resolutionStatusLabel(resolutionItem.resolution_status)" /></div>
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
    </ActionDialogShell>

    <ActionDialogShell
      v-model="showBulkResolutionDialog"
      title="批量处理盘点异常"
      description="对选中的异常项统一记录处理结论"
      class="inventory-bulk-resolution-dialog"
      size="medium"
      :pending="bulkResolutionSaving"
      :error="bulkResolutionDialogError"
      :close-disabled="bulkResolutionSaving"
      @close="closeBulkResolutionDialog"
    >
      <template v-if="bulkResolutionResult">
        <section class="action-dialog__result">
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
        <div class="action-dialog__summary inventory-bulk-resolution-meta">
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
    </ActionDialogShell>

    <ActionDialogShell
      v-model="showBulkNormalDialog"
      title="批量标记为正常"
      description="确认选中的设备与任务创建时的账面信息一致"
      class="inventory-bulk-normal-dialog"
      size="medium"
      :pending="bulkNormalSaving"
      :error="bulkNormalDialogError"
      :close-disabled="bulkNormalSaving"
      @close="closeBulkNormalDialog"
    >
      <template v-if="bulkNormalResult">
        <section class="action-dialog__result">
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
        </section>
      </template>
      <template v-else>
        <div class="action-dialog__summary inventory-bulk-normal-summary">
          <span>选中设备</span>
          <strong>{{ bulkNormalCount }} 台</strong>
          <span>处理方式</span>
          <strong>标记为盘点正常</strong>
        </div>
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
    </ActionDialogShell>
  </div>
</template>
