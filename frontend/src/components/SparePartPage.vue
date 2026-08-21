<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { List, Loading, MoreFilled, Plus } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageHeader from "./page/PageHeader.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import type { DataCenter, DictionaryItem, ServerRoom, SparePart, SpareStock, SpareTransaction } from "../types";
import type { SpareContext } from "../types/page-context";

const props = defineProps<{ context: SpareContext }>();
const context = props.context;
const {
  can, spareParts, sparePartCount, sparePage, sparePageSize, spareSearch, spareType, spareActive,
  spareListDataCenter, spareListRoom, spareRooms, sparePartForm, editingSparePart, showSparePartModal,
  spareSaving, deletingSparePartId, updatingSparePartId, spareListLoading, spareListError,
  openSparePartModal, saveSparePart, toggleSparePart, deleteSparePart, searchSpareParts,
  resetSpareFilters, retrySpareList, changeSparePage, changeSparePageSize,
  openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationCurrentQuantity, spareOperationLocationLabel, spareOperationLocationLocked,
  saveSpareOperation, spareOperationLabel, dataCenters, brands,
  stockLocations, stockLocationLoadingByPart, stockLocationErrorByPart, stockLocationTotalsByPart,
  stockLocationLoadedByPart, loadStockLocations: loadStockLocationsInContext, transactionRows, transactionCount,
  transactionPage, transactionPageSize, transactionLoading, transactionError, loadTransactions: loadTransactionsInContext,
  changeTransactionPage: changeTransactionPageInContext, changeTransactionPageSize: changeTransactionPageSizeInContext,
} = context;

const partTypes = [
  { value: "hard_disk", label: "备用硬盘" }, { value: "memory", label: "内存" },
  { value: "power_module", label: "电源模块" }, { value: "optical_module", label: "光模块" },
  { value: "network_card", label: "网卡" }, { value: "hba_card", label: "HBA 卡" },
  { value: "fan", label: "风扇" }, { value: "raid_card", label: "RAID 卡" }, { value: "other", label: "其他" },
];
const activeBrands = computed(() => (brands.value as DictionaryItem[]).filter((item) => item.is_active));
const activeDataCenters = computed(() => (dataCenters.value as DataCenter[]).filter((item) => item.is_active));
const spareStatusOptions = computed(() => can("spares.manage")
  ? [{ value: "true", label: "启用" }, { value: "false", label: "停用" }, { value: "all", label: "全部" }]
  : [{ value: "true", label: "启用" }]);
const hasSpareFilters = computed(() => Boolean(
  spareSearch.value.trim() || spareType.value || spareListDataCenter.value || spareListRoom.value
    || (spareActive.value && spareActive.value !== "true" && spareActive.value !== "all"),
));

const expandedRows = ref<number[]>([]);
const transactionDrawerOpen = ref(false);
const transactionPart = ref<SparePart | null>(null);
const sparePartFormRef = ref<FormInstance>();
const sparePartRules: FormRules = {
  name: [{ required: true, message: "请输入备件名称", trigger: "submit" }],
  part_type: [{ required: true, message: "请选择备件类型", trigger: "submit" }],
  unit: [{ required: true, message: "请输入计量单位", trigger: "submit" }],
};

const selectedOperation = computed(() => String(spareOperationType.value || "inbound"));
const selectedPart = computed(() => transactionPart.value);
const operationPart = computed(() => (spareParts.value as SparePart[]).find((item) => String(item.id) === String(spareOperationForm.value.part)) || null);
const showSourceLocation = computed(() => ["outbound", "transfer", "scrap"].includes(selectedOperation.value));
const showTargetLocation = computed(() => ["inbound", "transfer", "adjustment"].includes(selectedOperation.value));
const showQuantity = computed(() => selectedOperation.value !== "adjustment");
const sourceLocationLocked = computed(() => spareOperationLocationLocked.value && showSourceLocation.value);
const targetLocationLocked = computed(() => spareOperationLocationLocked.value && showTargetLocation.value && selectedOperation.value !== "transfer");
const operationMax = computed(() => {
  if (["outbound", "transfer", "scrap"].includes(selectedOperation.value) && spareOperationCurrentQuantity.value !== null) {
    return Math.max(0, Number(spareOperationCurrentQuantity.value));
  }
  return undefined;
});
const operationCannotOperate = computed(() => {
  if (["outbound", "transfer", "scrap"].includes(selectedOperation.value)) return operationMax.value === 0;
  if (selectedOperation.value === "adjustment" && spareOperationCurrentQuantity.value !== null) {
    return Number(spareOperationForm.value.target_quantity || 0) === Number(spareOperationCurrentQuantity.value);
  }
  return false;
});

function roomsFor(dataCenterId: string) {
  return (spareRooms.value as ServerRoom[]).filter((room) => String(room.data_center) === String(dataCenterId) && room.is_active);
}
function locationLabel(dataCenterName?: string | null, roomName?: string | null) {
  if (!dataCenterName) return "—";
  return roomName ? `${dataCenterName} / ${roomName}` : `${dataCenterName}（中心库存）`;
}
function stockLocationLabel(stock: SpareStock) { return locationLabel(stock.data_center_name, stock.server_room_name); }
function transactionLocation(row: SpareTransaction) {
  const label = (dc?: string | null, room?: string | null) => locationLabel(dc, room);
  if (row.operation_type === "inbound" || row.operation_type === "adjustment") return label(row.target_data_center_name, row.target_server_room_name);
  if (row.operation_type === "transfer") return `${label(row.source_data_center_name, row.source_server_room_name)} → ${label(row.target_data_center_name, row.target_server_room_name)}`;
  return label(row.source_data_center_name, row.source_server_room_name);
}
function stocksFor(part: SparePart) { return stockLocations.value[part.id] || []; }
function stockLocationRetry(partId: number) { void loadStockLocationsInContext(partId); }
async function loadStockLocations(partId: number) { await loadStockLocationsInContext(partId); }
async function handleExpandChange(row: SparePart, rows: SparePart[]) {
  expandedRows.value = rows.map((item) => item.id);
  if (rows.some((item) => item.id === row.id) && !stockLocationLoadedByPart.value[row.id]) await loadStockLocations(row.id);
}
function openLocationOperation(part: SparePart, operation: string, stock: SpareStock) {
  openSpareOperation(part, operation, { data_center: stock.data_center, server_room: stock.server_room, quantity: stock.quantity, label: stockLocationLabel(stock) });
}
function handleLocationCommand(command: { part: SparePart; stock: SpareStock; operation: string }) {
  if (command.operation === "transactions") openTransactionDrawer(command.part);
  else openLocationOperation(command.part, command.operation, command.stock);
}
function handlePartCommand(command: { part: SparePart; operation: string }) {
  if (command.operation === "edit") openSparePartModal(command.part);
  else if (command.operation === "toggle") void toggleSparePart(command.part);
  else if (command.operation === "delete") void deleteSparePart(command.part);
}
function onSpareListDataCenterChange() { spareListRoom.value = ""; searchSpareParts(); }
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
      <template #header>
        <PageHeader description="按数量管理备件库存、地点和库存流水">
          <template #actions>
            <el-button v-if="can('spares.manage')" type="primary" :icon="Plus" @click="openSparePartModal()">新增备件</el-button>
          </template>
        </PageHeader>
      </template>
      <template #toolbar>
        <PageToolbar class="spare-page-toolbar">
          <SearchField class="itam-filter-search" v-model="spareSearch" placeholder="搜索备件名称、类型、品牌或型号" aria-label="搜索备件" :loading="spareListLoading" @search="searchSpareParts" />
          <el-select class="itam-filter-select" v-model="spareType" placeholder="全部类型" clearable @change="searchSpareParts"><el-option v-for="item in partTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          <el-select class="itam-filter-select" v-model="spareActive" placeholder="全部状态" :clearable="can('spares.manage')" @change="searchSpareParts"><el-option v-for="item in spareStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          <el-select class="itam-filter-select" v-model="spareListDataCenter" placeholder="全部数据中心" clearable @change="onSpareListDataCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select>
          <el-select class="itam-filter-select" v-model="spareListRoom" placeholder="全部机房" clearable @change="searchSpareParts"><el-option v-for="room in roomsFor(spareListDataCenter)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select>
          <template #actions><el-button :disabled="spareListLoading" @click="resetSpareFilters">重置</el-button></template>
        </PageToolbar>
      </template>
      <PageContent surface class="spare-list-content">
        <div v-if="spareListError" class="spare-list-error" role="alert">
          <div><strong>备件数据加载失败</strong><span>{{ spareListError }}</span></div>
          <el-button link type="primary" :loading="spareListLoading" @click="retrySpareList">重新加载</el-button>
        </div>
        <PagedTable v-model:current-page="sparePage" v-model:page-size="sparePageSize" :total="sparePartCount" :loading="spareListLoading" @update:current-page="changeSparePage" @update:page-size="changeSparePageSize">
          <el-table class="spare-table" table-layout="fixed" v-loading="spareListLoading" :data="spareParts" row-key="id" @expand-change="handleExpandChange">
            <template #empty>
              <div class="spare-empty-state">
                <span v-if="spareListError">备件数据加载失败，请重新加载</span>
                <template v-else><span>{{ hasSpareFilters ? "没有符合当前筛选条件的备件" : "暂无备件" }}</span><el-button v-if="hasSpareFilters" link type="primary" @click="resetSpareFilters">清除筛选</el-button></template>
              </div>
            </template>
            <el-table-column type="expand" width="46">
              <template #default="{ row }">
                <div class="spare-location-panel">
                  <div class="spare-location-header"><strong>库存地点</strong><span class="form-hint">展开后可直接完成库存操作</span></div>
                  <el-skeleton v-if="stockLocationLoadingByPart[row.id]" :rows="2" animated />
                  <div v-else-if="stockLocationErrorByPart[row.id]" class="spare-inline-error" role="alert"><span>库存地点加载失败：{{ stockLocationErrorByPart[row.id] }}</span><el-button link type="primary" @click="stockLocationRetry(row.id)">重新加载</el-button></div>
                  <div v-else-if="stockLocationLoadedByPart[row.id] && stocksFor(row).length" class="spare-location-list">
                    <div v-for="stock in stocksFor(row)" :key="stock.id" class="spare-location-row">
                      <div class="spare-location-main"><strong :title="stockLocationLabel(stock)">{{ stockLocationLabel(stock) }}</strong><span class="form-hint">更新时间：{{ stock.updated_at || "—" }}</span></div>
                      <el-tag :type="stock.quantity > 0 ? 'success' : 'info'" class="spare-location-quantity">{{ stock.quantity }} {{ row.unit }}</el-tag>
                      <div class="spare-location-actions">
                        <el-button v-if="can('spares.manage')" link type="primary" @click.stop="openLocationOperation(row, 'inbound', stock)">入库</el-button>
                        <el-button v-if="can('spares.manage')" link :disabled="stock.quantity <= 0" @click.stop="openLocationOperation(row, 'outbound', stock)">出库</el-button>
                        <el-dropdown trigger="click" @command="handleLocationCommand">
                          <el-button link :icon="MoreFilled" aria-label="更多库存操作" title="更多库存操作" @click.stop />
                          <template #dropdown><el-dropdown-menu><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'transfer' }">调拨</el-dropdown-item><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'adjustment' }">盘点调整</el-dropdown-item><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'scrap' }" :disabled="stock.quantity <= 0">报废</el-dropdown-item><el-dropdown-item divided :command="{ part: row, stock, operation: 'transactions' }">查看流水</el-dropdown-item></el-dropdown-menu></template>
                        </el-dropdown>
                      </div>
                    </div>
                    <div v-if="(stockLocationTotalsByPart[row.id] || 0) > stocksFor(row).length" class="spare-location-total-hint">仅显示前 {{ stocksFor(row).length }} 个库存地点，共 {{ stockLocationTotalsByPart[row.id] }} 个</div>
                  </div>
                  <el-empty v-else-if="stockLocationLoadedByPart[row.id]" :image-size="48" description="暂无库存地点"><el-button v-if="can('spares.manage')" type="primary" size="small" @click="openSpareOperation(row, 'inbound')">登记入库</el-button></el-empty>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="备件" min-width="220">
              <template #default="{ row }"><div class="spare-part-cell"><strong class="spare-part-cell__name" :title="row.name">{{ row.name }}</strong><span class="spare-part-cell__meta" :title="`${row.part_type_label || row.part_type}${row.specification ? ` · ${row.specification}` : ''}`">{{ row.part_type_label || row.part_type }}<template v-if="row.specification"> · {{ row.specification }}</template></span></div></template>
            </el-table-column>
            <el-table-column prop="brand_name" label="品牌" min-width="120" show-overflow-tooltip />
            <el-table-column prop="model" label="型号" min-width="130" show-overflow-tooltip />
            <el-table-column label="库存" width="120"><template #default="{ row }"><div class="spare-stock-summary"><strong>{{ row.total_quantity || 0 }} {{ row.unit }}</strong><span>{{ row.location_count || 0 }} 个库存地点</span></div></template></el-table-column>
            <el-table-column label="状态" width="90"><template #default="{ row }"><StatusTag :type="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template></el-table-column>
            <el-table-column label="操作" fixed="right" width="178"><template #default="{ row }"><div class="ep-table-actions spare-row-actions"><el-button v-if="can('spares.manage')" link type="primary" :disabled="updatingSparePartId === row.id || deletingSparePartId === row.id" @click.stop="openSpareOperation(row, 'inbound')">入库</el-button><el-button link type="primary" :icon="List" aria-label="查看库存流水" title="查看库存流水" @click.stop="openTransactionDrawer(row)" /><el-dropdown v-if="can('spares.manage')" trigger="click" @command="handlePartCommand"><el-button link :icon="MoreFilled" :disabled="updatingSparePartId === row.id || deletingSparePartId === row.id" aria-label="更多备件操作" title="更多备件操作" @click.stop /><template #dropdown><el-dropdown-menu><el-dropdown-item :command="{ part: row, operation: 'edit' }">编辑</el-dropdown-item><el-dropdown-item :command="{ part: row, operation: 'toggle' }">{{ row.is_active ? "停用" : "启用" }}</el-dropdown-item><el-dropdown-item divided :command="{ part: row, operation: 'delete' }">删除</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-icon v-if="updatingSparePartId === row.id || deletingSparePartId === row.id" class="spare-row-action-loading"><Loading /></el-icon></div></template></el-table-column>
          </el-table>
        </PagedTable>
      </PageContent>
    </PageContainer>

    <el-dialog v-model="showSparePartModal" :title="editingSparePart ? '编辑备件' : '新增备件'" width="620px" destroy-on-close @open="handleSparePartModalOpened">
      <el-form ref="sparePartFormRef" :model="sparePartForm" :rules="sparePartRules" label-position="top" @submit.prevent="handleSaveSparePart">
        <div class="form-grid"><el-form-item label="备件名称" prop="name"><el-input v-model="sparePartForm.name" /></el-form-item><el-form-item label="备件类型" prop="part_type"><el-select v-model="sparePartForm.part_type"><el-option v-for="item in partTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="品牌"><el-select v-model="sparePartForm.brand" clearable placeholder="未关联品牌"><el-option v-for="brand in activeBrands" :key="brand.id" :label="brand.name" :value="String(brand.id)" /></el-select></el-form-item><el-form-item label="型号"><el-input v-model="sparePartForm.model" /></el-form-item><el-form-item label="规格"><el-input v-model="sparePartForm.specification" /></el-form-item><el-form-item label="计量单位" prop="unit"><el-input v-model="sparePartForm.unit" /></el-form-item><el-form-item label="备注" class="full-width"><el-input v-model="sparePartForm.notes" type="textarea" :rows="2" /></el-form-item></div><el-checkbox v-model="sparePartForm.is_active">启用</el-checkbox>
      </el-form>
      <template #footer><el-button @click="showSparePartModal = false">取消</el-button><el-button type="primary" :loading="spareSaving" @click="handleSaveSparePart">保存备件</el-button></template>
    </el-dialog>

    <el-dialog v-model="showSpareOperationModal" :title="`${spareOperationLabel(spareOperationType)}库存`" width="620px" destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveSpareOperation">
        <el-alert v-if="spareOperationLocationLabel" class="spare-operation-context" type="info" :closable="false">当前库存地点：<strong>{{ spareOperationLocationLabel }}</strong><span v-if="spareOperationCurrentQuantity !== null">，现有 {{ spareOperationCurrentQuantity }} {{ operationPart?.unit || "件" }}</span></el-alert>
        <el-form-item label="备件"><el-input :model-value="operationPart?.name || '—'" disabled /></el-form-item>
        <el-form-item v-if="showQuantity" label="数量" required><el-input-number v-model="spareOperationForm.quantity" :min="1" :max="operationMax" :step="1" controls-position="right" /><div v-if="operationMax !== undefined" class="spare-operation-hint">最多可操作 {{ operationMax }}</div></el-form-item>
        <el-form-item v-else label="调整后数量" required><el-input-number v-model="spareOperationForm.target_quantity" :min="0" :step="1" controls-position="right" /><div v-if="spareOperationCurrentQuantity !== null" class="spare-operation-hint">当前数量：{{ spareOperationCurrentQuantity }}</div></el-form-item>
        <div v-if="showSourceLocation" class="form-grid"><el-form-item label="来源数据中心" required><el-select v-model="spareOperationForm.source_data_center" :disabled="sourceLocationLocked" placeholder="请选择" @change="onOperationSourceCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item><el-form-item label="来源机房"><el-select v-model="spareOperationForm.source_server_room" :disabled="sourceLocationLocked" placeholder="中心库存" clearable><el-option v-for="room in roomsFor(spareOperationForm.source_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item></div>
        <div v-if="showTargetLocation" class="form-grid"><el-form-item :label="selectedOperation === 'adjustment' ? '库存地点数据中心' : '目标数据中心'" required><el-select v-model="spareOperationForm.target_data_center" :disabled="targetLocationLocked" placeholder="请选择" @change="onOperationTargetCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item><el-form-item :label="selectedOperation === 'adjustment' ? '库存地点机房' : '目标机房'"><el-select v-model="spareOperationForm.target_server_room" :disabled="targetLocationLocked" placeholder="中心库存" clearable><el-option v-for="room in roomsFor(spareOperationForm.target_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item></div>
        <el-alert v-if="operationCannotOperate" class="spare-operation-context" type="warning" :closable="false" title="当前库存无法执行此操作，请调整地点或数量" /><div class="form-grid"><el-form-item label="参考单号/用途"><el-input v-model="spareOperationForm.reference" /></el-form-item><el-form-item label="备注"><el-input v-model="spareOperationForm.notes" /></el-form-item></div>
      </el-form>
      <template #footer><el-button @click="showSpareOperationModal = false">取消</el-button><el-button type="primary" :disabled="operationCannotOperate" :loading="spareOperationSaving" @click="saveSpareOperation">登记流水</el-button></template>
    </el-dialog>

    <el-drawer v-model="transactionDrawerOpen" title="库存流水" size="620px" destroy-on-close>
      <div v-if="selectedPart" class="spare-transaction-drawer-title"><strong>{{ selectedPart.name }}</strong><span class="form-hint">{{ selectedPart.part_type_label }} · {{ selectedPart.unit }}</span></div>
      <div v-if="transactionError" class="spare-inline-error spare-transaction-error" role="alert"><span>库存流水加载失败：{{ transactionError }}</span><el-button link type="primary" :loading="transactionLoading" @click="retryTransactions">重新加载</el-button></div>
      <el-table v-loading="transactionLoading" :data="transactionRows"><template #empty><span v-if="!transactionError">暂无库存流水</span></template><el-table-column prop="created_at" label="时间" width="165" show-overflow-tooltip /><el-table-column prop="operation_type_label" label="操作" width="90" /><el-table-column label="数量" width="85"><template #default="{ row }">{{ row.quantity }} {{ row.unit }}</template></el-table-column><el-table-column label="地点" min-width="210" show-overflow-tooltip><template #default="{ row }">{{ transactionLocation(row) }}</template></el-table-column><el-table-column prop="operator_name" label="操作人" width="105" show-overflow-tooltip /><el-table-column prop="reference" label="用途" min-width="120" show-overflow-tooltip /><el-table-column prop="notes" label="备注" min-width="130" show-overflow-tooltip /></el-table>
      <PagedTable v-model:current-page="transactionPage" v-model:page-size="transactionPageSize" :total="transactionCount" :loading="transactionLoading" @update:current-page="changeTransactionPage" @update:page-size="changeTransactionPageSize" />
    </el-drawer>
  </div>
</template>

<style scoped>
.spare-list-content { min-width: 0; }
.spare-page-toolbar { flex-wrap: wrap; }
.spare-list-error,
.spare-inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius-md);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: 13px;
}
.spare-list-error > div { display: grid; gap: 2px; min-width: 0; }
.spare-list-error span { color: var(--el-text-color-regular); overflow-wrap: anywhere; }
.spare-empty-state { display: inline-flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; min-height: 84px; color: var(--el-text-color-secondary); }
.spare-part-cell { display: grid; gap: 2px; min-width: 0; }
.spare-part-cell__name,
.spare-part-cell__meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spare-part-cell__name { color: var(--el-text-color-primary); }
.spare-part-cell__meta { color: var(--el-text-color-secondary); font-size: 12px; }
.spare-stock-summary { display: grid; gap: 2px; line-height: 18px; }
.spare-stock-summary strong { font-variant-numeric: tabular-nums; }
.spare-stock-summary span { color: var(--el-text-color-secondary); font-size: 12px; }
.spare-row-actions { gap: 2px; white-space: nowrap; }
.spare-row-action-loading { color: var(--el-color-primary); margin-left: 2px; }
.spare-location-total-hint { padding-top: 2px; color: var(--el-text-color-secondary); font-size: 12px; }
.spare-inline-error { justify-content: flex-start; margin: 8px 0 0; padding: 8px 10px; }
.spare-inline-error .el-button { margin-left: auto; }
.spare-transaction-error { margin-bottom: 12px; }

@media (min-width: 1101px) and (max-width: 1450px) {
  .spare-page-toolbar { row-gap: 8px; }
  .spare-page-toolbar :deep(.itam-filter-search) { flex-basis: 320px !important; width: 320px !important; max-width: 320px !important; }
}

@media (max-width: 640px) {
  .spare-list-error, .spare-inline-error { align-items: flex-start; flex-direction: column; }
  .spare-inline-error .el-button { margin-left: 0; }
}
</style>
