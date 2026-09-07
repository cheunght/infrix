<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowDown,
  CircleCheck,
  Delete,
  Download,
  Edit,
  Grid,
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
import AssetQrScanner from "./AssetQrScanner.vue";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import type { FormInstance, FormRules } from "element-plus";
import type { InventoryItem } from "../types";
import type { InventoryContext } from "../page-context";
import { systemDatePickerFormat } from "../system-settings";
import { useInventory } from "../composables/useInventory";
import { businessOptionLabel, INVENTORY_ITEM_STATUS_OPTIONS } from "../business-enums";

const props = defineProps<{ context: InventoryContext }>();
const { t } = useI18n();
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
const inventoryItemsTable = ref<HTMLElement | null>(null);
const scannerRef = ref<{ focus: () => void; clearInput: () => void } | null>(null);
const scanPopoverVisible = ref(false);
const scanReadyForNext = ref(false);
const selectionSyncing = ref(false);
const taskRules = computed<FormRules>(() => ({
  name: [{ required: true, message: t("validation.required", { field: t("inventory.taskName") }), trigger: "blur" }],
  data_center: [{ required: true, message: t("validation.selectRequired", { field: t("common.dataCenter") }), trigger: "change" }],
  start_at: [{ required: true, message: t("validation.selectRequired", { field: t("inventory.startTime") }), trigger: "change" }],
  end_at: [{ required: true, message: t("validation.selectRequired", { field: t("inventory.endTime") }), trigger: "change" }],
}));
const itemRules = computed<FormRules>(() => ({
  status: [{ required: true, message: t("validation.selectRequired", { field: t("inventory.result") }), trigger: "change" }],
}));
const taskRoomHelp = computed(() => t("inventory.wholeDataCenterHelp"));

const {
  taskListLoading, taskListError, itemListLoading, itemListError, taskDetailLoading, taskDetailError,
  auxLoading, taskAuxError, itemAuxError, taskCreating, taskDeletingId, taskCompleting, taskReopening, itemSaving, resolutionSaving,
  scannedNormalSaving,
  bulkResolutionSaving, bulkNormalSaving,
  taskDialogError, itemDialogError, resolutionDialogError, bulkResolutionDialogError, bulkNormalDialogError,
  taskFormErrors, itemFormErrors, resolutionFormErrors, bulkResolutionFormErrors,
  tasks, taskCount, taskPage, taskPageSize, taskSearch, taskStatus,
  activeTask, items, itemCount, itemPage, itemPageSize,
  itemSearch, itemStatus, itemResolutionStatus, inspectors, racks, showTaskDialog, showItemDialog,
  scannedItemId, scanError,
  showResolutionDialog, showBulkResolutionDialog, showBulkNormalDialog, editingItem, resolutionItem,
  scopePreview, scopePreviewLoading, scopePreviewError,
  taskForm, itemForm, resolutionForm, bulkResolutionAction, bulkResolutionCount, bulkResolutionForm, bulkResolutionResult,
  bulkNormalCount, bulkNormalResult,
  activeDataCenters, activeRooms, activeRacks,
  taskHasFilters, itemHasFilters,
  taskStatusOptions, itemStatusOptions, itemResultOptions, itemResolutionStatusOptions, taskStatusLabel,
  formatDateTime, locationText, statusTagType, isExceptionStatus, resolutionStatusLabel,
  resolutionStatusTagType, resolutionActionLabel, hasCompleteActualLocation, resolutionActionOptions,
  canRecordInventory, canResolveInventoryAnomaly,
  selectedBatchItems, batchSelectionMode, isBatchSelectable, onBatchSelectionChange, batchSelectionModeFor,
  isBatchSelectableForMode, batchResolutionActionOptions, clearBatchSelection,
  taskScope, loadInitialData, loadTasks, loadItems, retryActiveTask, openTask, closeTask,
  openNewTask, changeTaskDataCenter, saveTask, deleteTask, completeTask, reopenTask, exportTask, exportingTaskId,
  changeTaskServerRoom, retryScopePreview, closeTaskDialog,
  openItem, changeItemStatus, saveItem, saveItemAndNext, changeTaskPage, changeTaskPageSize,
  changeItemPage, changeItemPageSize, resetTaskFilters, resetItemFilters,
  locateScannedAsset, clearScannedAsset: clearScannedAssetState, confirmItemNormal,
  retryTaskAuxData, retryRackAuxData, openResolution, closeResolutionDialog, saveResolution,
  openBulkResolution, closeBulkResolutionDialog, saveBulkResolution, openBulkNormal, closeBulkNormalDialog, saveBulkNormal,
} = useInventory(context);

const scannedAssetLabel = computed(() => {
  const item = items.value.find((candidate) => candidate.id === scannedItemId.value);
  if (item && scanReadyForNext.value) {
    return t("inventory.scannedNormalReadyForNext", { asset: item.asset_no });
  }
  return item ? t("inventory.scannedAssetLocated", { asset: item.asset_no }) : "";
});
const scannedItem = computed(() => items.value.find((item) => item.id === scannedItemId.value) || null);
const scannedItemHint = computed(() => {
  const item = scannedItem.value;
  if (!item) return "";
  return item.status === "pending"
    ? t("inventory.scanPendingHint")
    : t("inventory.scanAlreadyCheckedHint");
});

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
    canRecordInventory(editingItem.value) &&
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
    canResolveInventoryAnomaly(resolutionItem.value) &&
    resolutionForm.value.action &&
    !resolutionSaving.value,
));
const showBatchSelectionColumn = computed(() => Boolean(
  can("inventory.manage") &&
  (canRecordInventory() || items.value.some((item) => canResolveInventoryAnomaly(item))),
));
const resolutionRules = computed<FormRules>(() => ({
  action: [{ required: true, message: t("validation.selectRequired", { field: t("inventory.processMethod") }), trigger: "change" }],
  note: resolutionForm.value.action === "ignore"
    ? [{ required: true, message: t("inventory.ignoreNoteRequired"), trigger: "blur" }]
    : [],
}));
const batchResolutionOptions = computed(() => batchResolutionActionOptions());
const bulkResolutionFailures = computed(() =>
  (bulkResolutionResult.value?.results || []).filter((result) => !result.success),
);
const bulkResolutionNotice = computed(() => ({
  keep_asset: t("inventory.keepAssetNotice"),
  ignore: t("inventory.ignoreNotice"),
  confirm_missing: t("inventory.confirmMissingNotice"),
} as Record<string, string>)[bulkResolutionAction.value] || "");
const bulkResolutionRules = computed<FormRules>(() => ({
  note: bulkResolutionAction.value === "ignore"
    ? [{ required: true, message: t("inventory.ignoreNoteRequired"), trigger: "blur" }]
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
    warnings.push(t("inventory.retiredWarning", { count: preview.retired }));
  }
  return Array.from(new Set(warnings));
});

function handleActiveTaskAction(command: string) {
  if (command === "reopen") void reopenTask();
}

function itemPrimaryAction(item: InventoryItem) {
  if (canRecordInventory(item)) {
    if (item.status === "pending") return "confirm";
    if (isExceptionStatus(item.status) && item.resolution_status === "pending") return "resolve";
    if (isExceptionStatus(item.status) && item.resolution_status === "resolved" && can("inventory.view")) return "view";
    return "edit";
  }
  if (canResolveInventoryAnomaly(item)) return "resolve";
  if (isExceptionStatus(item.status) && item.resolution_status === "resolved" && can("inventory.view")) {
    return "view";
  }
  return "";
}

function itemCanEditException(item: InventoryItem) {
  return Boolean(
    canRecordInventory(item) &&
    isExceptionStatus(item.status) &&
    item.resolution_status === "pending",
  );
}

function itemPrimaryActionLabel(item: InventoryItem) {
  switch (itemPrimaryAction(item)) {
    case "confirm": return t("inventory.confirmInventory");
    case "resolve": return t("inventory.process");
    case "view": return t("inventory.viewResolution");
    case "edit": return t("inventory.editResult");
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

async function handleAssetScan(value: string) {
  scanReadyForNext.value = false;
  const found = await locateScannedAsset(value);
  if (!found) return;
  scannerRef.value?.clearInput();
  await nextTick();
  inventoryItemsTable.value
    ?.querySelector<HTMLElement>("tr.inventory-item-row--scanned")
    ?.scrollIntoView({ block: "nearest" });
}

async function confirmScannedItemNormal() {
  const item = scannedItem.value;
  if (!item || item.status !== "pending") return;
  const confirmed = await ElMessageBox.confirm(
    t("inventory.scanConfirmNormalMessage", { asset: item.asset_no }),
    t("inventory.scanConfirmNormalTitle"),
    {
      type: "success",
      confirmButtonText: t("inventory.confirmScannedNormal"),
      cancelButtonText: t("common.cancel"),
    },
  ).catch(() => false);
  if (!confirmed) return;
  const saved = await confirmItemNormal(item);
  if (!saved) return;

  scanReadyForNext.value = true;
  scannerRef.value?.clearInput();
  await nextTick();
  scannerRef.value?.focus();
}

function openScannedItemResult() {
  const item = scannedItem.value;
  if (!item) return;
  scanReadyForNext.value = false;
  scanPopoverVisible.value = false;
  void openItem(item);
}

function openScannedItemAction() {
  const item = scannedItem.value;
  if (!item) return;
  scanReadyForNext.value = false;
  scanPopoverVisible.value = false;
  void openPrimaryItemAction(item);
}

function focusAssetScanner() {
  void nextTick(() => scannerRef.value?.focus());
}

function clearScannedAsset() {
  scanReadyForNext.value = false;
  clearScannedAssetState();
}

function inventoryRowClassName({ row }: { row: InventoryItem }) {
  return row.id === scannedItemId.value ? "inventory-item-row--scanned" : "";
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
  <div class="infrix-page">
    <PageContainer v-if="!activeTask">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="taskSearch" :placeholder="t('inventory.searchTasks')" :aria-label="t('inventory.title')" @search="() => { taskPage = 1; loadTasks(); }" />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select v-model="taskStatus" :placeholder="t('inventory.allTaskStatuses')" clearable @change="() => { taskPage = 1; loadTasks(); }">
                <el-option v-for="item in taskStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </div>
          </template>
          <template #primary>
            <el-button v-if="can('inventory.manage')" class="page-primary-action" type="primary" :loading="taskCreating" :disabled="taskCreating" @click="openNewTask">
              {{ t('inventory.addTask') }}
            </el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <ResourceState
          :loading="taskListLoading && !tasks.length"
          :error="taskListError && !tasks.length ? taskListError : ''"
          :empty="!taskListLoading && !taskListError && !tasks.length"
          :empty-text="taskHasFilters ? t('inventory.noMatchingTasks') : t('inventory.noTasks')"
          @retry="() => loadTasks()"
        >
          <template #empty>
            <el-empty :image-size="56" :description="taskHasFilters ? t('inventory.noMatchingTasks') : t('inventory.noTasks')">
              <el-button v-if="taskHasFilters" link type="primary" @click="resetTaskFilters">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
          </template>
          <template #error="{ error }">
            <el-alert :title="t('inventory.taskLoadFailed')" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" @click="loadTasks">{{ t('inventory.retryTasks') }}</el-button>
          </template>
          <el-alert v-if="taskListError" :title="taskListError" type="error" show-icon :closable="false" class="inventory-alert" />
          <div v-if="taskListError" class="inventory-retry-row">
            <el-button link type="primary" @click="() => loadTasks()">{{ t('inventory.retryTasks') }}</el-button>
          </div>
          <el-table v-loading="taskListLoading" :data="tasks" table-layout="fixed">
            <template #empty>
              <el-empty :image-size="56" :description="taskHasFilters ? t('inventory.noMatchingTasks') : t('inventory.noTasks')">
                <el-button v-if="taskHasFilters" link type="primary" @click="resetTaskFilters">{{ t('common.clearFilters') }}</el-button>
              </el-empty>
            </template>
            <el-table-column prop="name" :label="t('inventory.taskName')" min-width="240">
              <template #default="{ row }">
                <el-button link type="primary" class="inventory-task-name" @click.stop="openTask(row)">
                  {{ row.name }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column :label="t('inventory.scope')" min-width="220">
              <template #default="{ row }">{{ taskScope(row) }}</template>
            </el-table-column>
            <el-table-column :label="t('common.status')" width="100">
              <template #default="{ row }">
                <StatusTag :tone="statusTone(row.status)" :label="taskStatusLabel(row.status)" />
              </template>
            </el-table-column>
            <el-table-column :label="t('inventory.progress')" width="150">
              <template #default="{ row }">
                <div class="inventory-progress-cell" :aria-label="`${t('inventory.checked')} ${row.summary.checked} / ${row.summary.total}`">
                  <span>{{ row.summary.checked }} / {{ row.summary.total }}</span>
                  <el-progress :percentage="row.summary.completion_rate" :stroke-width="6" :show-text="false" />
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="t('inventory.exception')" width="80">
              <template #default="{ row }">
                <StatusTag :tone="row.summary.exceptions > 0 ? 'warning' : 'info'" :label="String(row.summary.exceptions)" />
              </template>
            </el-table-column>
            <el-table-column :label="t('inventory.createdAt')" width="170">
              <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column :label="t('common.operation')" fixed="right" width="132">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton
                    v-if="row.status === 'in_progress' && can('inventory.manage')"
                    :icon="VideoPlay"
                    :label="t('inventory.continue')"
                    type="primary"
                    @click="openTask(row)"
                  />
                  <TableIconButton
                    v-else-if="row.status === 'completed' && can('inventory.view')"
                    :icon="View"
                    :label="t('inventory.resultView')"
                    type="primary"
                    @click="openTask(row)"
                  />
                  <TableIconButton
                    v-if="can('inventory.export')"
                    :icon="Download"
                    :label="t('common.export')"
                    :loading="exportingTaskId === row.id"
                    :disabled="exportingTaskId !== null && exportingTaskId !== row.id"
                    @click="exportTask(row)"
                  />
                  <TableIconButton
                    v-if="can('inventory.manage') && row.can_delete"
                    :icon="Delete"
                    :label="t('common.delete')"
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
            :description="taskScope(activeTask) + ' · ' + t('inventory.inspector') + ': ' + activeTask.inspector_name + (activeTask.completed_at ? ' · ' + t('inventory.completedAt') + ' ' + formatDateTime(activeTask.completed_at) : '')"
        >
          <template #leading>
            <el-button link @click="closeTask">{{ t('common.back') }}</el-button>
          </template>
          <template #actions>
            <StatusTag :tone="statusTone(activeTask.status)" :label="taskStatusLabel(activeTask.status)" />
            <el-button v-if="can('inventory.export')" :icon="Download" :loading="exportingTaskId === activeTask.id" :disabled="exportingTaskId !== null" @click="exportTask()">
              {{ t('common.export') }}
            </el-button>
            <el-button
              v-if="can('inventory.manage') && activeTask.status === 'in_progress'"
              type="primary"
              :loading="taskCompleting"
              :disabled="taskCompleting || activeTask.summary.pending > 0"
              :title="activeTask.summary.pending > 0 ? t('inventory.pendingCannotComplete', { count: activeTask.summary.pending }) : undefined"
              @click="completeTask"
            >
              {{ t('inventory.completeTask') }}
            </el-button>
            <el-dropdown
              v-if="can('inventory.manage') && activeTask.status === 'completed'"
              trigger="click"
              @command="handleActiveTaskAction"
            >
              <el-button class="inventory-more-action">
                {{ t('common.more') }}<el-icon class="el-icon--right"><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="reopen" :disabled="taskReopening">{{ t('inventory.reopenTask') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </PageHeader>
      </template>
      <PageContent v-loading="taskDetailLoading">
        <el-alert v-if="taskDetailError" :title="taskDetailError" type="error" show-icon :closable="false" class="inventory-alert" />
        <div v-if="taskDetailError" class="inventory-retry-row">
          <el-button link type="primary" @click="retryActiveTask">{{ t('inventory.retryTask') }}</el-button>
        </div>
        <PageSection :title="t('inventory.taskSummary')">
          <section class="inventory-summary-strip" :aria-label="t('inventory.taskSummary')">
            <div class="inventory-summary-metric">
              <span>{{ t('inventory.totalAssets') }}</span>
              <strong>{{ activeTask.summary.total }}</strong>
            </div>
            <div class="inventory-summary-metric">
              <span>{{ t('inventory.checked') }}</span>
              <strong>{{ activeTask.summary.checked }}</strong>
            </div>
            <div class="inventory-summary-metric">
              <span>{{ t('status.normal') }}</span>
              <strong>{{ activeTask.summary.normal }}</strong>
            </div>
            <div class="inventory-summary-metric inventory-summary-metric--warning">
              <span>{{ t('inventory.exception') }}</span>
              <strong>{{ activeTask.summary.exceptions }}</strong>
            </div>
            <div class="inventory-summary-metric">
              <span>{{ t('inventory.notCheckedShort') }}</span>
              <strong>{{ activeTask.summary.pending }}</strong>
            </div>
            <div class="inventory-summary-progress">
              <div class="inventory-summary-progress__header">
                <span>{{ t('inventory.completion') }}</span>
                <strong>{{ activeTask.summary.checked }} / {{ activeTask.summary.total }}</strong>
              </div>
              <small>{{ t('inventory.unresolvedExceptions', { count: activeTask.summary.resolution_pending }) }}</small>
              <el-progress :percentage="activeTask.summary.completion_rate" :stroke-width="6" :show-text="false" />
            </div>
          </section>
        </PageSection>
        <PageSection :title="t('inventory.inventoryDevices')">
          <PageToolbar>
            <template #search>
              <SearchField v-model="itemSearch" :placeholder="t('inventory.searchItems')" :aria-label="t('inventory.inventoryDevices')" @search="() => { itemPage = 1; loadItems(); }" />
            </template>
            <template #filters>
              <div class="page-toolbar__filter-group">
                <el-select v-model="itemStatus" :placeholder="t('inventory.allInventoryResults')" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
                <el-select v-model="itemResolutionStatus" :placeholder="t('inventory.allResolutionStatuses')" clearable @change="() => { itemPage = 1; loadItems(); }"><el-option v-for="item in itemResolutionStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
              </div>
            </template>
            <template #actions>
              <el-popover v-if="activeTask.status === 'in_progress'" v-model:visible="scanPopoverVisible" placement="bottom-end" :width="380" trigger="click" @show="focusAssetScanner">
                <template #reference>
                  <el-button :icon="Grid">{{ t('inventory.scanAsset') }}</el-button>
                </template>
                <AssetQrScanner
                  ref="scannerRef"
                  compact
                  :loading="itemListLoading"
                  :result="scannedAssetLabel"
                  :error="scanError"
                  @scan="handleAssetScan"
                  @clear="clearScannedAsset"
                >
                  <template #actions>
                    <div v-if="scannedItem" class="inventory-scan-actions">
                      <div class="inventory-scan-actions__summary">
                        <StatusTag :tone="statusTagType(scannedItem.status)" :label="businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, scannedItem.status)" />
                        <span class="inventory-scan-actions__asset">{{ scannedItem.asset_no }}</span>
                        <span class="inventory-scan-actions__hint">{{ scannedItemHint }}</span>
                      </div>
                      <div class="inventory-scan-actions__buttons">
                        <el-button
                          v-if="canRecordInventory(scannedItem) && scannedItem.status === 'pending'"
                          type="primary"
                          :loading="scannedNormalSaving"
                          :disabled="scannedNormalSaving"
                          @click="confirmScannedItemNormal"
                        >
                          {{ t('inventory.confirmScannedNormal') }}
                        </el-button>
                        <el-button
                          v-if="canRecordInventory(scannedItem) && scannedItem.status === 'pending'"
                          :disabled="scannedNormalSaving"
                          @click="openScannedItemResult"
                        >
                          {{ t('inventory.recordResult') }}
                        </el-button>
                        <el-button
                          v-else-if="itemPrimaryAction(scannedItem)"
                          :type="itemPrimaryActionType(scannedItem)"
                          @click="openScannedItemAction"
                        >
                          {{ itemPrimaryActionLabel(scannedItem) }}
                        </el-button>
                      </div>
                    </div>
                  </template>
                </AssetQrScanner>
              </el-popover>
            </template>
          </PageToolbar>
          <div v-if="selectedBatchItems.length" class="inventory-batch-bar" role="status" aria-live="polite">
            <span>{{ t('common.selectedItems', { count: selectedBatchItems.length }) }}</span>
            <el-button
              v-if="batchSelectionMode === 'inventory'"
              type="primary"
              plain
              :loading="bulkNormalSaving"
              :disabled="bulkNormalSaving"
              @click="openBulkNormal"
            >
              {{ t('inventory.markNormal') }}
            </el-button>
            <el-dropdown v-else trigger="click" @command="openBulkResolution">
              <el-button type="primary" plain :loading="bulkResolutionSaving" :disabled="bulkResolutionSaving">
                {{ t('inventory.bulkProcess') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
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
            :empty-text="itemHasFilters ? t('inventory.noMatchingItems') : t('inventory.noItems')"
            @retry="() => loadItems()"
          >
            <template #empty>
              <el-empty :image-size="56" :description="itemHasFilters ? t('inventory.noMatchingItems') : t('inventory.noItems')">
                <el-button v-if="itemHasFilters" link type="primary" @click="resetItemFilters">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
            </template>
            <template #error="{ error }">
              <el-alert :title="t('inventory.itemLoadFailed')" :description="error" type="error" show-icon :closable="false" />
              <el-button link type="primary" @click="loadItems">{{ t('inventory.retryItems') }}</el-button>
            </template>
            <el-alert v-if="itemListError" :title="itemListError" type="error" show-icon :closable="false" class="inventory-alert" />
            <div v-if="itemListError" class="inventory-retry-row">
              <el-button link type="primary" @click="() => loadItems()">{{ t('inventory.retryItems') }}</el-button>
            </div>
            <div ref="inventoryItemsTable" class="inventory-items-table">
            <PagedTable v-model:current-page="itemPage" v-model:page-size="itemPageSize" :total="itemCount" :page-sizes="[20, 50, 100]" @update:current-page="changeItemPage" @update:page-size="changeItemPageSize">
            <el-table
              ref="itemTableRef"
              v-loading="itemListLoading"
              :data="items"
              row-key="id"
              table-layout="fixed"
              :row-class-name="inventoryRowClassName"
              @selection-change="handleBatchSelectionChange"
              @select-all="handleBatchSelectAll"
            >
            <template #empty>
              <el-empty :image-size="56" :description="itemHasFilters ? t('inventory.noMatchingItems') : t('inventory.noItems')">
                <el-button v-if="itemHasFilters" link type="primary" @click="resetItemFilters">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
            </template>
          <el-table-column v-if="showBatchSelectionColumn" type="selection" width="48" :selectable="isBatchSelectable" />
          <el-table-column :label="t('asset.title')" min-width="240">
            <template #default="{ row }">
              <el-button link type="primary" class="inventory-asset-cell" @click.stop="openAssetDetail(row.asset)">
                {{ row.asset_no }} · {{ row.asset_name }}
              </el-button>
            </template>
          </el-table-column>
          <el-table-column :label="t('inventory.accountLocation')" min-width="250">
            <template #default="{ row }">{{ locationText(row) }}</template>
          </el-table-column>
          <el-table-column :label="t('inventory.result')" width="130">
            <template #default="{ row }"><StatusTag :tone="statusTagType(row.status)" :label="businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, row.status)" /></template>
          </el-table-column>
          <el-table-column :label="t('inventory.exception')" width="105">
            <template #default="{ row }">
              <StatusTag
                v-if="isExceptionStatus(row.status)"
                :tone="resolutionStatusTagType(row.resolution_status)"
                :label="resolutionStatusLabel(row.resolution_status)"
              />
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('inventory.processResult')" width="140">
            <template #default="{ row }">
              {{ row.resolution_status === 'resolved' ? resolutionActionLabel(row.resolution_action) : '—' }}
            </template>
          </el-table-column>
          <el-table-column :label="t('common.operation')" fixed="right" width="132">
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
                  :label="t('inventory.editResult')"
                  type="primary"
                  @click="openItem(row)"
                />
                <span v-if="!itemPrimaryAction(row) && !itemCanEditException(row)">—</span>
              </div>
            </template>
          </el-table-column>
            </el-table>
            </PagedTable>
            </div>
          </ResourceState>
        </PageSection>
      </PageContent>
    </PageContainer>

    <FormDialogShell
      v-model="showTaskDialog"
      :title="t('inventory.addTask')"
      :description="t('inventory.taskDialogDescription')"
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
          <el-button link type="primary" @click="retryTaskAuxData">{{ t('common.retry') }}</el-button>
        </template>
      </el-alert>
      <el-form ref="taskFormRef" class="horizontal-form inventory-task-form" :model="taskForm" :rules="taskRules" :validate-on-rule-change="false" label-position="right" @submit.prevent="submitTask">
        <div class="horizontal-form__rows">
          <el-form-item :label="t('inventory.taskName')" prop="name" :error="taskFormErrors.name"><el-input v-model="taskForm.name" :placeholder="t('inventory.taskNamePlaceholder')" /></el-form-item>
          <el-form-item :label="t('common.dataCenter')" prop="data_center" :error="taskFormErrors.data_center"><el-select v-model="taskForm.data_center" :loading="auxLoading" @change="changeTaskDataCenter"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item :label="t('common.room')" :error="taskFormErrors.server_room">
            <el-select v-model="taskForm.server_room" clearable :disabled="Boolean(taskAuxError)" :placeholder="t('inventory.wholeDataCenter')" @change="changeTaskServerRoom"><el-option v-for="room in activeRooms" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select>
            <FieldHelp :text="taskRoomHelp" />
          </el-form-item>
        </div>
        <section class="inventory-scope-preview" aria-live="polite">
          <div class="inventory-scope-preview__header">
            <strong>{{ t('inventory.taskRange') }}</strong>
            <el-button v-if="scopePreviewError" link type="primary" @click="retryScopePreview">{{ t('common.retry') }}</el-button>
          </div>
          <template v-if="scopePreviewLoading">
            <div class="inventory-scope-preview__state">{{ t('inventory.rangeLoading') }}</div>
          </template>
          <template v-else-if="scopePreviewError">
            <div class="inventory-scope-preview__state inventory-scope-preview__state--error">{{ t('inventory.rangeLoadFailed') }}</div>
          </template>
          <template v-else-if="scopePreview">
            <div class="inventory-scope-preview__scope">{{ scopePreview.scope_label }}</div>
            <div class="inventory-scope-preview__total"><strong>{{ scopePreview.total }}</strong><span>{{ t('inventory.rangeAssets') }}</span></div>
            <div class="inventory-scope-preview__stats">
              <span>{{ t('inventory.mounted') }}<strong>{{ scopePreview.racked }}</strong></span>
              <span>{{ t('inventory.unmounted') }}<strong>{{ scopePreview.unracked }}</strong></span>
              <span>{{ t('status.retired') }}<strong>{{ scopePreview.retired }}</strong></span>
            </div>
            <div v-if="scopePreview.total === 0" class="inventory-scope-preview__state inventory-scope-preview__state--warning">{{ t('inventory.noInventoryAssets') }}</div>
            <ul v-if="scopePreviewWarnings.length" class="inventory-scope-preview__warnings">
              <li v-for="warning in scopePreviewWarnings" :key="warning">{{ warning }}</li>
            </ul>
            <p class="inventory-scope-preview__help">
              {{ scopePreview.includes_unracked ? t('inventory.wholeCenterIncludesUnmounted') : t('inventory.roomIncludesMounted') }}
            </p>
            <p class="inventory-scope-preview__help">{{ t('inventory.inactiveExcluded') }}</p>
            <p class="inventory-scope-preview__help">{{ t('inventory.snapshotNotice') }}</p>
          </template>
          <div v-else class="inventory-scope-preview__state">{{ t('inventory.selectDataCenterHint') }}</div>
        </section>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('inventory.inspector')" :error="taskFormErrors.inspector"><el-select v-model="taskForm.inspector" clearable :loading="auxLoading" :disabled="Boolean(taskAuxError)" :placeholder="t('inventory.defaultCurrentUser')"><el-option v-for="person in inspectors" :key="person.id" :label="person.display_name" :value="String(person.id)" /></el-select></el-form-item>
          <el-form-item :label="t('inventory.startTime')" prop="start_at" :error="taskFormErrors.start_at"><el-date-picker v-model="taskForm.start_at" type="datetime" :format="systemDatePickerFormat(true, true)" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item :label="t('inventory.endTime')" prop="end_at" :error="taskFormErrors.end_at"><el-date-picker v-model="taskForm.end_at" type="datetime" :format="systemDatePickerFormat(true, true)" value-format="YYYY-MM-DDTHH:mm:ss" /></el-form-item>
          <el-form-item :label="t('common.notes')" :error="taskFormErrors.notes"><el-input v-model="taskForm.notes" type="textarea" :rows="3" /></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button :disabled="taskCreating" @click="closeTaskDialog">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="taskCreating" :disabled="taskCreating || scopePreviewLoading || Boolean(scopePreviewError) || !scopePreview || scopePreview.total <= 0" @click="submitTask">{{ t('inventory.saveTask') }}</el-button></template>
    </FormDialogShell>

    <ActionDialogShell
      v-model="showItemDialog"
      :title="t('inventory.confirmInventory')"
      :description="t('inventory.confirmInventoryDescription')"
      size="medium"
      :pending="itemSaving"
      :error="itemDialogError"
      :close-disabled="itemSaving"
    >
      <el-alert v-if="itemAuxError" :title="itemAuxError" type="error" show-icon :closable="false" class="inventory-alert">
        <template #default>
          <el-button link type="primary" @click="retryRackAuxData">{{ t('inventory.retryRacks') }}</el-button>
        </template>
      </el-alert>
      <AssetSummary v-if="editingItem" :asset="editingItem" compact :show-status="false" />
      <el-form :key="editingItem?.id ?? 'inventory-item-form'" ref="itemFormRef" :model="itemForm" :rules="itemRules" :validate-on-rule-change="false" label-position="top" class="inventory-item-form">
          <el-form-item :label="t('inventory.result')" prop="status" :error="itemFormErrors.status"><el-select v-model="itemForm.status" :placeholder="t('inventory.selectInventoryResult')" @change="changeItemStatus"><el-option v-for="item in itemResultOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-alert v-if="itemForm.status === 'normal'" :title="t('inventory.resultNormalHint')" type="success" :closable="false" show-icon />
          <div v-if="itemForm.status && itemForm.status !== 'not_found'" class="form-grid">
          <el-form-item :label="t('inventory.actualRack')" :error="itemFormErrors.actual_rack"><el-select v-model="itemForm.actual_rack" clearable :disabled="Boolean(itemAuxError) || itemForm.status === 'normal'" :placeholder="t('inventory.notMountedPlaceholder')"><el-option v-for="rack in activeRacks" :key="rack.id" :label="`${rack.data_center_name} / ${rack.server_room_name} / ${rack.code}`" :value="String(rack.id)" /></el-select></el-form-item>
          <el-form-item :label="t('inventory.actualStartU')" :error="itemFormErrors.actual_start_u"><el-input-number v-model="actualStartUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('inventory.actualStartU')" :disabled="itemForm.status === 'normal'"><template #suffix>U</template></el-input-number></el-form-item>
          <el-form-item :label="t('inventory.actualEndU')" :error="itemFormErrors.actual_end_u"><el-input-number v-model="actualEndUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('inventory.actualEndU')" :disabled="itemForm.status === 'normal'"><template #suffix>U</template></el-input-number></el-form-item>
          </div>
        <el-form-item :label="t('common.notes')" :error="itemFormErrors.notes"><el-input v-model="itemForm.notes" type="textarea" :rows="3" :placeholder="t('inventory.mismatchNotePlaceholder')" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="itemSaving" @click="showItemDialog = false">{{ t('common.cancel') }}</el-button><el-button :disabled="!itemCanSave" @click="submitItem">{{ t('common.save') }}</el-button><el-button type="primary" :loading="itemSaving" :disabled="!itemCanSave" @click="submitItemAndNext">{{ t('inventory.saveAndNext') }}</el-button></template>
    </ActionDialogShell>

    <ActionDialogShell
      v-model="showResolutionDialog"
      :title="t('inventory.processException')"
      :description="t('inventory.processExceptionDescription')"
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
            <el-button link type="primary" @click="openAssetDetail(resolutionItem.asset)">{{ t('inventory.viewAssetDetails') }}</el-button>
          </div>
          <div class="inventory-resolution-summary__facts">
            <div>
              <span>{{ t('inventory.result') }}</span>
              <StatusTag :tone="statusTagType(resolutionItem.status)" :label="businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, resolutionItem.status)" />
            </div>
            <div>
              <span>{{ t('inventory.accountLocation') }}</span>
              <strong>{{ locationText(resolutionItem) }}</strong>
            </div>
            <div v-if="resolutionItem.status !== 'not_found'">
              <span>{{ t('inventory.actualLocation') }}</span>
              <strong>{{ locationText(resolutionItem, true) }}</strong>
            </div>
            <div class="inventory-resolution-summary__note">
              <span>{{ t('inventory.inventoryNote') }}</span>
              <strong>{{ resolutionItem.notes || t('inventory.noInventoryNote') }}</strong>
            </div>
          </div>
        </section>

        <template v-if="resolutionReadOnly">
          <section class="inventory-resolution-section inventory-resolution-readonly">
            <div class="inventory-resolution-section__title">{{ t('inventory.processResult') }}</div>
            <div class="inventory-resolution-readonly__grid">
              <div><span>{{ t('inventory.processStatus') }}</span><StatusTag :tone="resolutionStatusTagType(resolutionItem.resolution_status)" :label="resolutionStatusLabel(resolutionItem.resolution_status)" /></div>
              <div><span>{{ t('inventory.processMethod') }}</span><strong>{{ resolutionActionLabel(resolutionItem.resolution_action) }}</strong></div>
              <div><span>{{ t('inventory.processor') }}</span><strong>{{ resolutionItem.resolved_by_name || '—' }}</strong></div>
              <div><span>{{ t('inventory.processTime') }}</span><strong>{{ formatDateTime(resolutionItem.resolved_at) }}</strong></div>
            </div>
            <div class="inventory-resolution-readonly__note"><span>{{ t('inventory.processNote') }}</span><p>{{ resolutionItem.resolution_note || '—' }}</p></div>
            <el-alert v-if="resolutionItem.resolution_action === 'update_asset'" type="success" :closable="false" :title="t('inventory.assetLocationUpdated')" />
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
          <el-form-item :label="t('inventory.processMethod')" prop="action" :error="resolutionFormErrors.action">
            <el-select v-model="resolutionForm.action" :placeholder="t('validation.selectRequired', { field: t('inventory.processMethod') })" :disabled="resolutionSaving">
              <el-option v-for="option in resolutionOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-alert v-if="resolutionLocationIncomplete" type="info" :closable="false" :title="t('inventory.resolutionMissingLocation')" />
          <el-alert v-if="resolutionUpdateSelected" type="warning" :closable="false" :title="t('inventory.resolutionUpdateWarning')">
            <div class="inventory-resolution-change">
              <div><span>{{ t('inventory.updateBefore') }}</span><strong>{{ locationText(resolutionItem) }}</strong></div>
              <div><span>{{ t('inventory.updateAfter') }}</span><strong>{{ locationText(resolutionItem, true) }}</strong></div>
            </div>
          </el-alert>
          <el-form-item :label="t('inventory.processNote')" prop="note" :error="resolutionFormErrors.note">
            <el-input v-model="resolutionForm.note" type="textarea" :rows="3" :disabled="resolutionSaving" :placeholder="t('inventory.processNotePlaceholder')" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button :disabled="resolutionSaving" @click="closeResolutionDialog">{{ resolutionReadOnly ? t('common.close') : t('common.cancel') }}</el-button>
        <el-button v-if="!resolutionReadOnly" type="primary" :loading="resolutionSaving" :disabled="!resolutionCanSave" @click="submitResolution">{{ t('inventory.confirmProcess') }}</el-button>
      </template>
    </ActionDialogShell>

    <ActionDialogShell
      v-model="showBulkResolutionDialog"
      :title="t('inventory.bulkProcess')"
      :description="t('inventory.bulkProcessDescription')"
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
            :title="t('inventory.bulkProcessSummary', { succeeded: bulkResolutionResult.succeeded, failed: bulkResolutionResult.failed })"
          />
          <section v-if="bulkResolutionFailures.length" class="inventory-bulk-resolution-failures">
            <div class="inventory-resolution-section__title">{{ t('common.failedDetails') }}</div>
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
          <span>{{ t('inventory.processedCount') }}</span>
          <strong>{{ bulkResolutionCount }}</strong>
          <span>{{ t('inventory.processMethod') }}</span>
          <strong>{{ resolutionActionLabel(bulkResolutionAction) }}</strong>
        </div>
        <el-alert v-if="bulkResolutionNotice" type="info" :closable="false" :title="bulkResolutionNotice" />
        <el-form-item :label="t('inventory.processNote')" prop="note" :error="bulkResolutionFormErrors.note">
          <el-input
            v-model="bulkResolutionForm.note"
            type="textarea"
            :rows="3"
            :disabled="bulkResolutionSaving"
            :placeholder="bulkResolutionAction === 'ignore' ? t('inventory.bulkIgnorePlaceholder') : t('inventory.bulkProcessPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="bulkResolutionSaving" @click="closeBulkResolutionDialog">
          {{ bulkResolutionResult ? t('common.close') : t('common.cancel') }}
        </el-button>
        <el-button v-if="!bulkResolutionResult" type="primary" :loading="bulkResolutionSaving" :disabled="bulkResolutionSaving" @click="submitBulkResolution">
          {{ t('inventory.confirmProcess') }}
        </el-button>
      </template>
    </ActionDialogShell>

    <ActionDialogShell
      v-model="showBulkNormalDialog"
      :title="t('inventory.markNormal')"
      :description="t('inventory.markNormalDescription')"
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
            :title="t('inventory.markNormalSummary', { succeeded: bulkNormalResult.succeeded, failed: bulkNormalResult.failed })"
          />
          <section v-if="bulkNormalFailures.length" class="inventory-bulk-resolution-failures">
            <div class="inventory-resolution-section__title">{{ t('common.failedDetails') }}</div>
            <div v-for="failure in bulkNormalFailures" :key="failure.item_id" class="inventory-bulk-resolution-failure">
              <strong>{{ failure.asset_no }}</strong>
              <span>{{ failure.reason }}</span>
            </div>
          </section>
        </section>
      </template>
      <template v-else>
        <div class="action-dialog__summary inventory-bulk-normal-summary">
          <span>{{ t('inventory.selectedDevices') }}</span>
          <strong>{{ t('units.device', bulkNormalCount) }}</strong>
          <span>{{ t('inventory.processMethod') }}</span>
          <strong>{{ t('inventory.markNormalAction') }}</strong>
        </div>
        <el-alert
          type="info"
          :closable="false"
          :title="t('inventory.markNormalConfirm')"
        />
        <p class="inventory-bulk-normal-help">{{ t('inventory.markNormalHelp') }}</p>
      </template>
      <template #footer>
        <el-button :disabled="bulkNormalSaving" @click="closeBulkNormalDialog">
          {{ bulkNormalResult ? t('common.close') : t('common.cancel') }}
        </el-button>
        <el-button v-if="!bulkNormalResult" type="primary" :loading="bulkNormalSaving" :disabled="bulkNormalSaving" @click="saveBulkNormal">
          {{ t('inventory.confirmMarkNormal') }}
        </el-button>
      </template>
    </ActionDialogShell>
  </div>
</template>

<style scoped>
:deep(.inventory-item-row--scanned > td) {
  background: var(--el-color-primary-light-9) !important;
}

:deep(.inventory-item-row--scanned > td:first-child) {
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}

.inventory-items-table {
  margin-top: var(--space-md);
}

:deep(.inventory-scan-actions) {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--el-border-color-lighter);
}

:deep(.inventory-scan-actions__summary),
:deep(.inventory-scan-actions__buttons) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-sm);
}

:deep(.inventory-scan-actions__summary) {
  flex: 1 1 auto;
}

:deep(.inventory-scan-actions__asset) {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.inventory-scan-actions__hint) {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.inventory-scan-actions__buttons) {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
</style>
