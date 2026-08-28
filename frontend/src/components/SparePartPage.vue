<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { Delete, Download, Edit, MoreFilled, Operation, TopRight, Upload } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import ResourceState from "./ResourceState.vue";
import ActionDialogShell from "./ActionDialogShell.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import StatusTag from "./StatusTag.vue";
import type { DataCenter, DictionaryItem, ServerRoom, SparePart, SparePartCategory, SpareStock, SpareTransaction } from "../types";
import type { SpareContext } from "../types/page-context";
import type { StockOperationType } from "../types";
import {
  SPARE_UNIT_OPTIONS,
  STOCK_OPERATION_OPTIONS,
  STOCK_SOURCE_OPERATION_VALUES,
  STOCK_TARGET_OPERATION_VALUES,
  spareUnitLabel,
  stockOperationTone,
} from "../business-enums";

const props = defineProps<{ context: SpareContext }>();
const context = props.context;
const {
  can, spareParts, sparePartCount, sparePage, sparePageSize, spareSearch, spareCategory, spareManufacturer, spareCategories,
  spareListDataCenter, spareListRoom, spareRooms, sparePartForm, editingSparePart, showSparePartModal,
  spareSaving, deletingSparePartId, spareListLoading, spareListError,
  exportingSpares,
  openSparePartModal, saveSparePart, deleteSparePart, searchSpareParts,
  resetSpareFilters, retrySpareList, changeSparePage, changeSparePageSize, exportSpareParts, exportSpareTransactions,
  openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationError, spareOperationCurrentQuantity, spareOperationLocationLabel, spareOperationLocationLocked,
  saveSpareOperation, spareOperationLabel, dataCenters, manufacturers,
  stockLocations, stockLocationLoadingByPart, stockLocationErrorByPart, stockLocationTotalsByPart,
  stockLocationLoadedByPart, loadStockLocations: loadStockLocationsInContext, transactionRows, transactionCount,
  spareTransactionFilters,
  transactionPage, transactionPageSize, transactionLoading, transactionError, loadTransactions: loadTransactionsInContext,
  changeTransactionPage: changeTransactionPageInContext, changeTransactionPageSize: changeTransactionPageSizeInContext,
} = context;

const manufacturerOptions = computed(() => {
  const currentId = String(sparePartForm.value.manufacturer || "");
  return (manufacturers.value as DictionaryItem[]).filter((item) => item.is_active || String(item.id) === currentId);
});
const activeSpareCategories = computed(() => {
  const currentId = String(sparePartForm.value.category || "");
  return (spareCategories.value as SparePartCategory[]).filter((item) => item.is_active || String(item.id) === currentId);
});
const activeSpareCategoryFilters = computed(() => (spareCategories.value as SparePartCategory[]).filter((item) => item.is_active || can("spares.manage")));
const manufacturerFilterOptions = computed(() => (manufacturers.value as DictionaryItem[]));
const activeDataCenters = computed(() => (dataCenters.value as DataCenter[]).filter((item) => item.is_active));
const hasSpareFilters = computed(() => Boolean(
  spareSearch.value.trim() || spareCategory.value || spareManufacturer.value || spareListDataCenter.value || spareListRoom.value,
));
const transactionDateRange = computed<[string, string] | null>({
  get() {
    if (!spareTransactionFilters.value.start && !spareTransactionFilters.value.end) return null;
    return [spareTransactionFilters.value.start, spareTransactionFilters.value.end];
  },
  set(value) {
    spareTransactionFilters.value.start = value?.[0] || "";
    spareTransactionFilters.value.end = value?.[1] || "";
    applyTransactionFilters();
  },
});
const transactionEmpty = computed(() => !transactionLoading.value && !transactionError.value && transactionRows.value.length === 0);

const expandedRows = ref<number[]>([]);
const transactionDrawerOpen = ref(false);
const transactionPart = ref<SparePart | null>(null);
const sparePartFormRef = ref<FormInstance>();
const sparePartRules: FormRules = {
  code: [{ required: true, message: "请输入备件编码", trigger: "submit" }],
  name: [{ required: true, message: "请输入备件名称", trigger: "submit" }],
  category: [{ required: true, message: "请选择备件类型", trigger: "submit" }],
  unit: [{ required: true, message: "请选择计量单位", trigger: "submit" }],
  initial_data_center: [{
    validator: (_rule, value, callback) => {
      if (Number(sparePartForm.value.initial_quantity || 0) > 0 && !value) {
        callback(new Error("有初始库存时必须选择数据中心"));
        return;
      }
      callback();
    },
    trigger: "submit",
  }],
};

const selectedOperation = computed<StockOperationType>(() => spareOperationType.value || "inbound");
const selectedPart = computed(() => transactionPart.value);
const spareUnitLocked = computed(() => Boolean(editingSparePart.value?.has_stock_movements));
const operationPart = computed(() => (spareParts.value as SparePart[]).find((item) => String(item.id) === String(spareOperationForm.value.part)) || null);
const operationCurrentQuantity = computed(() => {
  if (spareOperationCurrentQuantity.value !== null) return Number(spareOperationCurrentQuantity.value);
  return Number(operationPart.value?.total_quantity ?? 0);
});
const operationInventoryLabel = computed(() => {
  const part = operationPart.value;
  if (!part) return "—";
  return `${operationCurrentQuantity.value} ${spareUnitLabel(part.unit)}`;
});
const adjustmentQuantityValue = computed<number | null>({
  get() {
    const raw = spareOperationForm.value.adjustment_quantity;
    if (raw === "" || raw === null || raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  },
  set(value) {
    spareOperationForm.value.adjustment_quantity = value == null ? "" : String(value);
  },
});
const operationQuantityValue = computed<number | null>({
  get() {
    const raw = spareOperationForm.value.quantity;
    if (raw === "" || raw === null || raw === undefined) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  },
  set(value) {
    spareOperationForm.value.quantity = value == null ? "" : String(value);
  },
});
const showSourceLocation = computed(() => STOCK_SOURCE_OPERATION_VALUES.includes(selectedOperation.value));
const showTargetLocation = computed(() => STOCK_TARGET_OPERATION_VALUES.includes(selectedOperation.value) && selectedOperation.value !== "initial");
const showQuantity = computed(() => selectedOperation.value !== "adjustment");
const sourceLocationLocked = computed(() => spareOperationLocationLocked.value && showSourceLocation.value);
const targetLocationLocked = computed(() => spareOperationLocationLocked.value && showTargetLocation.value && selectedOperation.value !== "transfer");
const operationMax = computed(() => {
  if (STOCK_SOURCE_OPERATION_VALUES.includes(selectedOperation.value) && spareOperationCurrentQuantity.value !== null) {
    return Math.max(0, Number(spareOperationCurrentQuantity.value));
  }
  return undefined;
});
const operationQuantityHelp = computed(() => operationMax.value === undefined ? "" : `最多可操作 ${operationMax.value}`);
const adjustmentMin = computed(() => -Math.max(0, operationCurrentQuantity.value));
const adjustmentAfterQuantity = computed(() => operationCurrentQuantity.value + Number(adjustmentQuantityValue.value ?? 0));
const adjustmentQuantityHelp = "正数增加库存，负数减少库存；调整数量不能为 0。";

function formatAdjustmentQuantity(value: string) {
  const normalized = String(value ?? "").replace(/^\+/, "");
  return normalized && Number(normalized) > 0 ? `+${normalized}` : normalized;
}

function parseAdjustmentQuantity(value: string) {
  return value.replace(/^\+/, "");
}

const operationCannotOperate = computed(() => {
  if (STOCK_SOURCE_OPERATION_VALUES.includes(selectedOperation.value)) return operationMax.value === 0;
  if (selectedOperation.value === "adjustment") {
    const delta = adjustmentQuantityValue.value;
    return delta === null || !Number.isInteger(delta) || delta === 0 || adjustmentAfterQuantity.value < 0;
  }
  return false;
});
const operationWarningTitle = computed(() => {
  if (selectedOperation.value === "adjustment") {
    const delta = adjustmentQuantityValue.value;
    if (delta === null) return "请输入调整数量";
    if (!Number.isInteger(delta)) return "调整数量必须为整数";
    if (delta === 0) return "调整数量不能为 0";
    if (adjustmentAfterQuantity.value < 0) return "调整后库存不能小于 0";
  }
  return "当前库存无法执行此操作，请调整地点或数量";
});

function roomsFor(dataCenterId: string) {
  return (spareRooms.value as ServerRoom[]).filter((room) => String(room.data_center) === String(dataCenterId) && room.is_active);
}
function locationLabel(dataCenterName?: string | null, roomName?: string | null) {
  if (!dataCenterName) return "—";
  return roomName ? `${dataCenterName} / ${roomName}` : `${dataCenterName}（中心库存）`;
}
function stockLocationLabel(stock: SpareStock) { return locationLabel(stock.data_center_name, stock.server_room_name); }
function transactionQuantityLabel(row: SpareTransaction) {
  const delta = row.quantity_delta;
  return `${delta > 0 ? "+" : ""}${delta} ${spareUnitLabel(row.unit)}`;
}
function transactionDateTime(value: string) {
  return value ? value.replace("T", " ").replace(/Z$/, "").slice(0, 19) : "—";
}
function applyTransactionFilters() {
  transactionPage.value = 1;
  if (transactionPart.value) void loadTransactions();
}
function resetTransactionFilters() {
  spareTransactionFilters.value.operation_type = "";
  spareTransactionFilters.value.start = "";
  spareTransactionFilters.value.end = "";
  applyTransactionFilters();
}
function stocksFor(part: SparePart) { return stockLocations.value[part.id] || []; }
function stockLocationRetry(partId: number) { void loadStockLocationsInContext(partId); }
async function loadStockLocations(partId: number) { await loadStockLocationsInContext(partId); }
async function handleExpandChange(row: SparePart, rows: SparePart[]) {
  expandedRows.value = rows.map((item) => item.id);
  if (rows.some((item) => item.id === row.id) && !stockLocationLoadedByPart.value[row.id]) await loadStockLocations(row.id);
}
function openLocationOperation(part: SparePart, operation: StockOperationType, stock: SpareStock) {
  openSpareOperation(part, operation, { data_center: stock.data_center, server_room: stock.server_room, quantity: stock.quantity, label: stockLocationLabel(stock) });
}
function handleLocationCommand(command: { part: SparePart; stock: SpareStock; operation: StockOperationType | "transactions" }) {
  if (command.operation === "transactions") openTransactionDrawer(command.part);
  else openLocationOperation(command.part, command.operation, command.stock);
}
function onInitialDataCenterChange() { sparePartForm.value.initial_server_room = ""; }
function onOperationSourceCenterChange() { spareOperationForm.value.source_server_room = ""; }
function onOperationTargetCenterChange() { spareOperationForm.value.target_server_room = ""; }
async function loadTransactions() {
  if (transactionPart.value) await loadTransactionsInContext(transactionPart.value.id);
}
function openTransactionDrawer(part: SparePart) {
  transactionPart.value = part;
  transactionRows.value = [];
  transactionCount.value = 0;
  transactionPage.value = 1;
  spareTransactionFilters.value = { part: String(part.id), operation_type: "", start: "", end: "" };
  transactionDrawerOpen.value = true;
  void loadTransactions();
}
function retryTransactions() { void loadTransactions(); }
function changeTransactionPage(page: number) {
  if (transactionPart.value) changeTransactionPageInContext(page, transactionPart.value.id);
}
function changeTransactionPageSize(size: number) {
  if (transactionPart.value) changeTransactionPageSizeInContext(size, transactionPart.value.id);
}
function refreshExpandedPart() {
  expandedRows.value.forEach((partId) => loadStockLocations(partId));
  if (transactionDrawerOpen.value) void loadTransactions();
}
async function handleSaveSparePart() {
  if (!sparePartFormRef.value) return;
  try {
    const valid = await sparePartFormRef.value.validate();
    if (valid) await saveSparePart();
  } catch {
    // Element Plus renders field errors; no request is sent when invalid.
  }
}
function handleSparePartModalOpened() { nextTick(() => sparePartFormRef.value?.clearValidate()); }
watch(showSpareOperationModal, (open, wasOpen) => { if (!open && wasOpen) refreshExpandedPart(); });
</script>

<template>
  <div class="itam-page spare-page">
    <PageContainer>
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="spareSearch" placeholder="搜索编码、名称、型号或规格" aria-label="搜索备件" :loading="spareListLoading" @search="searchSpareParts" />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select v-model="spareCategory" placeholder="全部类型" clearable @change="searchSpareParts"><el-option v-for="item in activeSpareCategoryFilters" :key="item.id" :label="item.name" :value="String(item.id)" /></el-select>
              <el-select v-model="spareManufacturer" placeholder="全部厂商" clearable filterable @change="searchSpareParts"><el-option v-for="item in manufacturerFilterOptions" :key="item.id" :label="`${item.name}${item.is_active ? '' : '（已停用）'}`" :value="String(item.id)" /></el-select>
            </div>
          </template>
          <template #actions>
            <el-button v-if="can('spares.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingSpares" :disabled="exportingSpares" @click="exportSpareParts">
              导出数据
            </el-button>
          </template>
          <template #primary>
            <el-button v-if="can('spares.manage')" class="page-primary-action" type="primary" @click="openSparePartModal()">新增备件</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface class="spare-list-content">
        <ResourceState :error="spareListError" @retry="retrySpareList">
          <template #error="{ error }">
            <el-alert title="备件数据加载失败" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" :loading="spareListLoading" @click="retrySpareList">重新加载</el-button>
          </template>
          <PagedTable v-model:current-page="sparePage" v-model:page-size="sparePageSize" :total="sparePartCount" @update:current-page="changeSparePage" @update:page-size="changeSparePageSize">
          <el-table class="spare-table" table-layout="fixed" v-loading="spareListLoading" :data="spareParts" row-key="id" @expand-change="handleExpandChange">
            <template #empty>
              <el-empty :image-size="56" :description="hasSpareFilters ? '没有符合当前筛选条件的备件' : '暂无备件'">
                <el-button v-if="hasSpareFilters" link type="primary" @click="resetSpareFilters">清除筛选</el-button>
              </el-empty>
            </template>
            <el-table-column type="expand" width="46">
              <template #default="{ row }">
                <div class="spare-location-panel">
                  <div class="spare-location-header"><strong>库存地点</strong><span class="form-hint">展开后可直接完成库存操作</span></div>
                  <el-skeleton v-if="stockLocationLoadingByPart[row.id]" :rows="2" animated />
                  <div v-else-if="stockLocationErrorByPart[row.id]" class="spare-inline-error" role="alert"><span>库存地点加载失败：{{ stockLocationErrorByPart[row.id] }}</span><el-button link type="primary" @click="stockLocationRetry(row.id)">重新加载</el-button></div>
                  <div v-else-if="stockLocationLoadedByPart[row.id] && stocksFor(row).length" class="spare-location-list">
                    <div v-for="stock in stocksFor(row)" :key="stock.id" class="spare-location-row">
                      <div class="spare-location-main"><strong>{{ stockLocationLabel(stock) }}</strong><span class="form-hint">更新时间：{{ stock.updated_at || "—" }}</span></div>
                      <el-tag :type="stock.quantity > 0 ? 'success' : 'info'" class="spare-location-quantity">{{ stock.quantity }} {{ spareUnitLabel(row.unit) }}</el-tag>
                      <div class="spare-location-actions">
                        <el-button v-if="can('spares.manage')" link type="primary" :icon="Upload" @click.stop="openLocationOperation(row, 'inbound', stock)">入库</el-button>
                        <el-button v-if="can('spares.manage')" link :icon="TopRight" :disabled="stock.quantity <= 0" @click.stop="openLocationOperation(row, 'outbound', stock)">出库</el-button>
                        <el-dropdown trigger="click" @command="handleLocationCommand">
                          <el-button link :icon="MoreFilled" aria-label="更多库存操作" @click.stop />
                          <template #dropdown><el-dropdown-menu><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'transfer' }">调拨</el-dropdown-item><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'adjustment' }">调整库存</el-dropdown-item><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'scrap' }" :disabled="stock.quantity <= 0">报废</el-dropdown-item><el-dropdown-item divided :command="{ part: row, stock, operation: 'transactions' }">查看流水</el-dropdown-item></el-dropdown-menu></template>
                        </el-dropdown>
                      </div>
                    </div>
                    <div v-if="(stockLocationTotalsByPart[row.id] || 0) > stocksFor(row).length" class="spare-location-total-hint">仅显示前 {{ stocksFor(row).length }} 个库存地点，共 {{ stockLocationTotalsByPart[row.id] }} 个</div>
                  </div>
                  <el-empty v-else-if="stockLocationLoadedByPart[row.id]" :image-size="48" description="暂无库存地点"><el-button v-if="can('spares.manage')" type="primary" size="small" @click="openSpareOperation(row, 'inbound')">登记入库</el-button></el-empty>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="名称" min-width="220" />
            <el-table-column label="厂商" min-width="135">
              <template #default="{ row }">{{ row.manufacturer_name || "—" }}</template>
            </el-table-column>
            <el-table-column label="存放位置" min-width="210">
              <template #default="{ row }">{{ row.storage_location || "—" }}</template>
            </el-table-column>
            <el-table-column label="库存数量" width="126" align="center">
              <template #default="{ row }">
                <div class="spare-stock-cell">
                  <span>{{ row.total_quantity ?? 0 }} {{ spareUnitLabel(row.unit) }}</span>
                  <StatusTag v-if="row.is_low_stock" size="small" tone="warning" label="低库存" />
                </div>
              </template>
            </el-table-column>
            <el-table-column label="出库" width="88" align="center">
              <template #default="{ row }">
                <el-button v-if="can('spares.manage')" class="spare-quick-action" link type="primary" size="small" :icon="TopRight" :disabled="deletingSparePartId === row.id" aria-label="出库" @click.stop="openSpareOperation(row, 'outbound')">出库</el-button>
              </template>
            </el-table-column>
            <el-table-column label="操作" fixed="right" width="244" align="center">
              <template #default="{ row }">
                <div v-if="can('spares.manage')" class="ep-table-actions spare-row-actions">
                  <el-button link type="primary" size="small" :icon="Edit" :disabled="deletingSparePartId === row.id" aria-label="编辑" @click.stop="openSparePartModal(row)">编辑</el-button>
                  <el-button link type="primary" size="small" :icon="Operation" :disabled="deletingSparePartId === row.id" aria-label="调整库存" @click.stop="openSpareOperation(row, 'adjustment')">调整库存</el-button>
                  <el-button link type="danger" size="small" :icon="Delete" :loading="deletingSparePartId === row.id" :disabled="deletingSparePartId === row.id" aria-label="删除" @click.stop="deleteSparePart(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          </PagedTable>
        </ResourceState>
      </PageContent>
    </PageContainer>

    <FormDialogShell
      v-model="showSparePartModal"
      :title="editingSparePart ? '编辑备件' : '新增备件'"
      description="维护备件基础信息和计量单位"
      size="medium"
      :saving="spareSaving"
      :close-on-click-modal="!spareSaving"
      :close-on-press-escape="!spareSaving"
      :show-close="!spareSaving"
      :close-disabled="spareSaving"
      @open="handleSparePartModalOpened"
    >
      <el-form ref="sparePartFormRef" class="horizontal-form" :model="sparePartForm" :rules="sparePartRules" label-position="right" @submit.prevent="handleSaveSparePart">
        <section class="form-dialog__section">
          <h3 class="form-dialog__section-title">基本信息</h3>
          <div class="horizontal-form__rows">
            <el-form-item label="备件编码" prop="code"><el-input v-model="sparePartForm.code" :disabled="Boolean(editingSparePart)" placeholder="请输入备件编码" /></el-form-item>
            <el-form-item label="备件名称" prop="name"><el-input v-model="sparePartForm.name" /></el-form-item>
            <el-form-item label="备件类型" prop="category"><el-select v-model="sparePartForm.category" filterable placeholder="请选择备件类型"><el-option v-for="item in activeSpareCategories" :key="item.id" :label="`${item.name}${item.is_active ? '' : '（已停用）'}`" :value="String(item.id)" /></el-select></el-form-item>
            <el-form-item label="厂商"><el-select v-model="sparePartForm.manufacturer" filterable clearable placeholder="未关联厂商"><el-option v-for="manufacturer in manufacturerOptions" :key="manufacturer.id" :label="`${manufacturer.name}${manufacturer.is_active ? '' : '（已停用）'}`" :value="String(manufacturer.id)" /></el-select></el-form-item>
            <el-form-item label="型号"><el-input v-model="sparePartForm.model" /></el-form-item>
            <el-form-item label="规格"><el-input v-model="sparePartForm.specification" /></el-form-item>
            <el-form-item label="计量单位" prop="unit">
              <el-select v-model="sparePartForm.unit" placeholder="请选择计量单位" :disabled="spareUnitLocked">
                <el-option v-for="unit in SPARE_UNIT_OPTIONS" :key="unit.value" :label="unit.label" :value="unit.value" />
              </el-select>
              <FieldHelp v-if="spareUnitLocked" text="该备件已有库存流水，计量单位不可修改。" />
            </el-form-item>
          </div>
        </section>
        <section class="form-dialog__section">
          <h3 class="form-dialog__section-title">库存信息</h3>
          <div class="horizontal-form__rows">
            <el-form-item v-if="!editingSparePart" label="初始库存"><el-input-number v-model="sparePartForm.initial_quantity" :min="0" :step="1" :value-on-clear="null" aria-label="初始库存"><template #suffix>{{ spareUnitLabel(sparePartForm.unit) }}</template></el-input-number><FieldHelp text="新增时可登记初始库存；后续库存请通过库存流水调整。" /></el-form-item>
            <el-form-item v-else label="当前库存"><el-input :model-value="`${sparePartForm.current_quantity} ${spareUnitLabel(sparePartForm.unit)}`" disabled /></el-form-item>
            <el-form-item v-if="!editingSparePart && Number(sparePartForm.initial_quantity || 0) > 0" label="初始数据中心" prop="initial_data_center" required><el-select v-model="sparePartForm.initial_data_center" placeholder="请选择数据中心" @change="onInitialDataCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
            <el-form-item v-if="!editingSparePart && Number(sparePartForm.initial_quantity || 0) > 0" label="初始机房"><el-select v-model="sparePartForm.initial_server_room" placeholder="中心库存" clearable><el-option v-for="room in roomsFor(sparePartForm.initial_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
            <el-form-item label="安全库存"><el-input-number v-model="sparePartForm.safety_stock" :min="0" :step="1" :value-on-clear="null" aria-label="安全库存"><template #suffix>{{ spareUnitLabel(sparePartForm.unit) }}</template></el-input-number><FieldHelp text="当前库存小于或等于安全库存时标记为低库存。" /></el-form-item>
            <el-form-item label="存放位置"><el-input v-model="sparePartForm.storage_location" placeholder="例如：备件库 A 区" /></el-form-item>
          </div>
        </section>
        <section class="form-dialog__section">
          <h3 class="form-dialog__section-title">其它信息</h3>
          <div class="horizontal-form__rows">
            <el-form-item label="备注"><el-input v-model="sparePartForm.notes" type="textarea" :rows="2" /></el-form-item>
          </div>
        </section>
      </el-form>
      <template #footer>
        <el-button :disabled="spareSaving" @click="showSparePartModal = false">取消</el-button>
        <el-button type="primary" :loading="spareSaving" :disabled="spareSaving" @click="handleSaveSparePart">保存备件</el-button>
      </template>
    </FormDialogShell>

    <ActionDialogShell
      v-model="showSpareOperationModal"
      :title="`${spareOperationLabel(spareOperationType)}库存`"
      description="登记备件库存地点和数量变更"
      size="medium"
      :pending="spareOperationSaving"
      :error="spareOperationError"
      :close-disabled="spareOperationSaving"
    >
      <el-form label-position="top" @submit.prevent="saveSpareOperation">
        <el-alert v-if="operationPart && selectedOperation !== 'adjustment'" class="spare-operation-context" type="info" :closable="false">当前库存：<strong>{{ operationInventoryLabel }}</strong><span v-if="spareOperationLocationLabel"> · 当前库存地点：<strong>{{ spareOperationLocationLabel }}</strong></span></el-alert>
        <el-form-item label="备件"><el-input :model-value="operationPart?.name || '—'" disabled /></el-form-item>
        <el-form-item v-if="selectedOperation === 'adjustment'" label="当前库存">
          <el-input :model-value="operationInventoryLabel" disabled />
        </el-form-item>
        <el-form-item v-if="selectedOperation === 'adjustment'" label="调整数量" required>
          <el-input-number v-model="adjustmentQuantityValue" :min="adjustmentMin" :step="1" :precision="0" :value-on-clear="null" :formatter="formatAdjustmentQuantity" :parser="parseAdjustmentQuantity" aria-label="调整数量">
            <template #suffix>{{ operationPart ? spareUnitLabel(operationPart.unit) : '' }}</template>
          </el-input-number>
          <FieldHelp :text="adjustmentQuantityHelp" />
        </el-form-item>
        <el-form-item v-if="selectedOperation === 'adjustment'" label="调整后库存">
          <el-input :model-value="`${adjustmentAfterQuantity} ${operationPart ? spareUnitLabel(operationPart.unit) : ''}`" disabled />
        </el-form-item>
        <el-form-item v-if="showQuantity" label="数量" required>
          <el-input-number
            v-model="operationQuantityValue"
            :min="1"
            :max="operationMax"
            :step="1"
            :precision="0"
            :value-on-clear="null"
            aria-label="数量"
          >
            <template #suffix>{{ operationPart ? spareUnitLabel(operationPart.unit) : '' }}</template>
          </el-input-number>
          <FieldHelp v-if="operationQuantityHelp" :text="operationQuantityHelp" />
        </el-form-item>
        <div v-if="showSourceLocation" class="form-grid"><el-form-item label="来源数据中心" required><el-select v-model="spareOperationForm.source_data_center" :disabled="sourceLocationLocked" placeholder="请选择" @change="onOperationSourceCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item><el-form-item label="来源机房"><el-select v-model="spareOperationForm.source_server_room" :disabled="sourceLocationLocked" placeholder="中心库存" clearable><el-option v-for="room in roomsFor(spareOperationForm.source_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item></div>
        <div v-if="showTargetLocation" class="form-grid"><el-form-item :label="selectedOperation === 'adjustment' ? '库存地点数据中心' : '目标数据中心'" required><el-select v-model="spareOperationForm.target_data_center" :disabled="targetLocationLocked" placeholder="请选择" @change="onOperationTargetCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item><el-form-item :label="selectedOperation === 'adjustment' ? '库存地点机房' : '目标机房'"><el-select v-model="spareOperationForm.target_server_room" :disabled="targetLocationLocked" placeholder="中心库存" clearable><el-option v-for="room in roomsFor(spareOperationForm.target_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item></div>
        <el-alert v-if="operationCannotOperate" class="spare-operation-context" type="warning" :closable="false" :title="operationWarningTitle" /><div class="form-grid"><el-form-item label="参考单号/用途"><el-input v-model="spareOperationForm.reference" /></el-form-item><el-form-item label="备注"><el-input v-model="spareOperationForm.notes" /></el-form-item></div>
      </el-form>
      <template #footer><el-button :disabled="spareOperationSaving" @click="showSpareOperationModal = false">取消</el-button><el-button type="primary" :disabled="operationCannotOperate || spareOperationSaving" :loading="spareOperationSaving" @click="saveSpareOperation">登记流水</el-button></template>
    </ActionDialogShell>

    <el-drawer v-model="transactionDrawerOpen" title="库存流水" size="620px" destroy-on-close>
      <div v-if="selectedPart" class="spare-transaction-drawer-title"><div><strong>{{ selectedPart.name }}</strong><span class="form-hint">{{ selectedPart.category_name }} · {{ spareUnitLabel(selectedPart.unit) }}</span></div><el-button v-if="can('spares.export')" class="toolbar-secondary-action" :icon="Download" :loading="exportingSpares" :disabled="exportingSpares" @click="exportSpareTransactions(selectedPart.id)">导出流水</el-button></div>
      <div v-if="selectedPart" class="spare-detail-summary">
        <div><span>备件编码</span><strong>{{ selectedPart.code }}</strong></div>
        <div><span>备件类型</span><strong>{{ selectedPart.category_name }}</strong></div>
        <div><span>厂商</span><strong>{{ selectedPart.manufacturer_name || "未关联" }}</strong></div>
        <div><span>型号</span><strong>{{ selectedPart.model || "—" }}</strong></div>
        <div><span>规格</span><strong>{{ selectedPart.specification || "—" }}</strong></div>
        <div><span>当前库存</span><strong>{{ selectedPart.total_quantity }} {{ spareUnitLabel(selectedPart.unit) }}</strong></div>
        <div><span>安全库存</span><strong>{{ selectedPart.safety_stock }} {{ spareUnitLabel(selectedPart.unit) }}</strong></div>
        <div><span>存放位置</span><strong>{{ selectedPart.storage_location || "—" }}</strong></div>
        <div class="spare-detail-summary__notes"><span>备注</span><strong>{{ selectedPart.notes || "—" }}</strong></div>
      </div>
      <div class="spare-transaction-filters">
        <el-select v-model="spareTransactionFilters.operation_type" class="spare-transaction-type-filter" placeholder="全部类型" clearable @change="applyTransactionFilters">
          <el-option label="全部类型" value="" />
          <el-option v-for="option in STOCK_OPERATION_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-date-picker v-model="transactionDateRange" class="spare-transaction-date-filter" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" range-separator="至" clearable />
        <el-button v-if="spareTransactionFilters.operation_type || spareTransactionFilters.start || spareTransactionFilters.end" link type="primary" @click="resetTransactionFilters">重置</el-button>
      </div>
      <ResourceState :loading="transactionLoading" :error="transactionError" :empty="transactionEmpty" empty-text="暂无库存流水" @retry="retryTransactions">
        <template #error="{ error }">
          <div class="spare-inline-error spare-transaction-error" role="alert"><span>库存流水加载失败：{{ error }}</span><el-button link type="primary" :loading="transactionLoading" @click="retryTransactions">重新加载</el-button></div>
        </template>
        <el-table :data="transactionRows">
          <el-table-column label="时间" width="145"><template #default="{ row }">{{ transactionDateTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="类型" width="86" align="center"><template #default="{ row }"><StatusTag size="small" :tone="stockOperationTone(row.operation_type)" :label="row.operation_type_label" /></template></el-table-column>
          <el-table-column label="变化数量" width="92" align="right"><template #default="{ row }"><span class="spare-ledger-delta" :class="{ 'is-positive': row.quantity_delta > 0, 'is-negative': row.quantity_delta < 0 }">{{ transactionQuantityLabel(row) }}</span></template></el-table-column>
          <el-table-column label="变更前" width="82" align="right"><template #default="{ row }">{{ row.before_quantity }} {{ spareUnitLabel(row.unit) }}</template></el-table-column>
          <el-table-column label="变更后" width="82" align="right"><template #default="{ row }">{{ row.after_quantity }} {{ spareUnitLabel(row.unit) }}</template></el-table-column>
          <el-table-column prop="operator_name" label="操作人" width="100" />
          <el-table-column label="原因" min-width="140">
            <template #default="{ row }">
              <span class="spare-ledger-reason">{{ row.reference || (row.notes ? "有备注" : "—") }}</span>
            </template>
          </el-table-column>
        </el-table>
        <PagedTable v-model:current-page="transactionPage" v-model:page-size="transactionPageSize" :total="transactionCount" @update:current-page="changeTransactionPage" @update:page-size="changeTransactionPageSize" />
      </ResourceState>
    </el-drawer>
  </div>
</template>

<style scoped>
.spare-list-content { min-width: 0; }
.spare-inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--el-border-radius-base);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: 13px;
}
.spare-quick-action { white-space: nowrap; }
.spare-stock-cell { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.spare-row-actions { display: inline-flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap; }
.spare-row-actions .el-button + .el-button { margin-left: 0; }
.spare-location-total-hint { padding-top: 2px; color: var(--el-text-color-secondary); font-size: 12px; }
.spare-inline-error { justify-content: flex-start; margin: 8px 0 0; padding: 8px 10px; }
.spare-inline-error .el-button { margin-left: auto; }
.spare-transaction-error { margin-bottom: 12px; }
.spare-transaction-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 14px 0 12px; }
.spare-transaction-type-filter { width: 128px; }
.spare-transaction-date-filter { width: 252px; }
.spare-ledger-delta { font-variant-numeric: tabular-nums; font-weight: 600; }
.spare-ledger-delta.is-positive { color: var(--el-color-success); }
.spare-ledger-delta.is-negative { color: var(--el-color-warning); }
.spare-ledger-reason { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spare-transaction-drawer-title > div { display: grid; min-width: 0; gap: 2px; }
.spare-transaction-drawer-title > .el-button { margin-left: auto; }
.spare-detail-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 16px 0;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-extra-light);
}
.spare-detail-summary > div { display: grid; gap: 2px; min-width: 0; }
.spare-detail-summary span { color: var(--el-text-color-secondary); font-size: 12px; }
.spare-detail-summary strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spare-detail-summary__notes { grid-column: 1 / -1; }
.spare-detail-summary__notes strong { white-space: normal; overflow-wrap: anywhere; }

@media (max-width: 640px) {
  .spare-inline-error { align-items: flex-start; flex-direction: column; }
  .spare-inline-error .el-button { margin-left: 0; }
  .spare-transaction-date-filter { width: 100%; }
}
</style>
