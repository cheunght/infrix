<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Delete, Edit, List, MoreFilled, Plus } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import { pageItems, pageTotal, type PageResult } from "../api";
import type { DataCenter, DictionaryItem, ServerRoom, SparePart, SpareStock, SpareTransaction } from "../types";

const props = defineProps<{ context: Record<string, any> }>();
const {
  loading, can, spareParts, sparePartCount, sparePage, sparePageSize, spareSearch, spareType, spareActive,
  spareListDataCenter, spareListRoom, spareRooms, sparePartForm, editingSparePart, showSparePartModal,
  openSparePartModal, saveSparePart, toggleSparePart, deleteSparePart, searchSpareParts, changeSparePage,
  changeSparePageSize, openSpareOperation, spareOperationType, spareOperationForm, showSpareOperationModal,
  spareOperationSaving, spareOperationCurrentQuantity, spareOperationLocationLabel, spareOperationLocationLocked,
  saveSpareOperation, spareOperationLabel, dataCenters, brands, request: contextRequest,
} = props.context;

const request = contextRequest as <T>(path: string, options?: RequestInit) => Promise<T>;

const partTypes = [
  { value: "hard_disk", label: "备用硬盘" }, { value: "memory", label: "内存" },
  { value: "power_module", label: "电源模块" }, { value: "optical_module", label: "光模块" },
  { value: "network_card", label: "网卡" }, { value: "hba_card", label: "HBA 卡" },
  { value: "fan", label: "风扇" }, { value: "raid_card", label: "RAID 卡" }, { value: "other", label: "其他" },
];
const activeBrands = computed(() => (brands.value as DictionaryItem[]).filter((item) => item.is_active));
const activeDataCenters = computed(() => (dataCenters.value as DataCenter[]).filter((item) => item.is_active));
const expandedRows = ref<number[]>([]);
const stockLocations = ref<Record<number, SpareStock[]>>({});
const stockLoading = ref<Record<number, boolean>>({});
const stockRequestSerial = ref(0);
const transactionDrawerOpen = ref(false);
const transactionPart = ref<SparePart | null>(null);
const transactionRows = ref<SpareTransaction[]>([]);
const transactionCount = ref(0);
const transactionPage = ref(1);
const transactionPageSize = ref(20);
const transactionLoading = ref(false);
const transactionError = ref("");

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
    return Number(spareOperationForm.target_quantity || 0) === Number(spareOperationCurrentQuantity.value);
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
async function loadStockLocations(partId: number) {
  const serial = ++stockRequestSerial.value;
  stockLoading.value = { ...stockLoading.value, [partId]: true };
  try {
    const result = await request<PageResult<SpareStock> | SpareStock[]>(`/spare-stocks/?part=${partId}&page_size=100`);
    if (serial !== stockRequestSerial.value) return;
    stockLocations.value = { ...stockLocations.value, [partId]: pageItems(result) };
  } catch {
    if (serial === stockRequestSerial.value) stockLocations.value = { ...stockLocations.value, [partId]: [] };
  } finally {
    if (serial === stockRequestSerial.value) stockLoading.value = { ...stockLoading.value, [partId]: false };
  }
}
function stocksFor(part: SparePart) { return stockLocations.value[part.id] || []; }
async function handleExpandChange(row: SparePart, rows: SparePart[]) {
  expandedRows.value = rows.map((item) => item.id);
  if (rows.some((item) => item.id === row.id) && !stockLocations.value[row.id]) await loadStockLocations(row.id);
}
function openLocationOperation(part: SparePart, operation: string, stock: SpareStock) {
  openSpareOperation(part, operation, { data_center: stock.data_center, server_room: stock.server_room, quantity: stock.quantity, label: stockLocationLabel(stock) });
}
function handleLocationCommand(command: { part: SparePart; stock: SpareStock; operation: string }) {
  openLocationOperation(command.part, command.operation, command.stock);
}
function onSpareListDataCenterChange() { spareListRoom.value = ""; searchSpareParts(); }
function onOperationSourceCenterChange() { spareOperationForm.source_server_room = ""; }
function onOperationTargetCenterChange() { spareOperationForm.target_server_room = ""; }
async function loadTransactions() {
  if (!transactionPart.value) return;
  transactionLoading.value = true; transactionError.value = "";
  try {
    const params = new URLSearchParams({ part: String(transactionPart.value.id), page: String(transactionPage.value), page_size: String(transactionPageSize.value) });
    const result = await request<PageResult<SpareTransaction> | SpareTransaction[]>(`/spare-transactions/?${params.toString()}`);
    transactionRows.value = pageItems(result); transactionCount.value = pageTotal(result);
  } catch (error) {
    transactionError.value = error instanceof Error ? error.message : "库存流水加载失败";
    transactionRows.value = []; transactionCount.value = 0;
  } finally { transactionLoading.value = false; }
}
function openTransactionDrawer(part: SparePart) { transactionPart.value = part; transactionPage.value = 1; transactionDrawerOpen.value = true; loadTransactions(); }
function changeTransactionPage(page: number) { transactionPage.value = page; loadTransactions(); }
function changeTransactionPageSize(size: number) { transactionPageSize.value = size; transactionPage.value = 1; loadTransactions(); }
function refreshExpandedPart() {
  expandedRows.value.forEach((partId) => loadStockLocations(partId));
  if (transactionDrawerOpen.value) loadTransactions();
}
watch(showSpareOperationModal, (open, wasOpen) => { if (!open && wasOpen) refreshExpandedPart(); });
</script>

<template>
  <div class="itam-page spare-page">
    <el-card shadow="never">
      <div class="ep-toolbar spare-toolbar">
        <SearchField class="itam-filter-search" v-model="spareSearch" placeholder="搜索备件名称、类型、品牌或型号" aria-label="搜索备件" @search="searchSpareParts" />
        <el-select class="itam-filter-select" v-model="spareType" placeholder="全部类型" clearable @change="searchSpareParts"><el-option v-for="item in partTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select>
        <el-select class="itam-filter-select" v-model="spareActive" placeholder="全部状态" @change="searchSpareParts"><el-option label="启用" value="true" /><el-option label="停用" value="false" /><el-option label="全部" value="all" /></el-select>
        <el-select class="itam-filter-select" v-model="spareListDataCenter" placeholder="全部数据中心" clearable @change="onSpareListDataCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select>
        <el-select class="itam-filter-select" v-model="spareListRoom" placeholder="全部机房" clearable @change="searchSpareParts"><el-option v-for="room in roomsFor(spareListDataCenter)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select>
        <span class="ep-toolbar-spacer" />
        <div class="ep-toolbar-actions"><el-button v-if="can('spares.manage')" type="primary" :icon="Plus" @click="openSparePartModal()">新增备件</el-button></div>
      </div>
      <el-table :data="spareParts" row-key="id" empty-text="暂无备件" @expand-change="handleExpandChange">
        <el-table-column type="expand" width="46">
          <template #default="{ row }">
            <div class="spare-location-panel">
              <div class="spare-location-header"><strong>库存地点</strong><span class="form-hint">展开后可直接完成库存操作</span></div>
              <el-skeleton v-if="stockLoading[row.id]" :rows="2" animated />
              <div v-else-if="stocksFor(row).length" class="spare-location-list">
                <div v-for="stock in stocksFor(row)" :key="stock.id" class="spare-location-row">
                  <div class="spare-location-main"><strong>{{ stockLocationLabel(stock) }}</strong><span class="form-hint">更新时间：{{ stock.updated_at || "—" }}</span></div>
                  <el-tag :type="stock.quantity > 0 ? 'success' : 'info'" class="spare-location-quantity">{{ stock.quantity }} {{ row.unit }}</el-tag>
                  <div class="spare-location-actions">
                    <el-button v-if="can('spares.manage')" link type="primary" @click.stop="openLocationOperation(row, 'inbound', stock)">入库</el-button>
                    <el-button v-if="can('spares.manage')" link :disabled="stock.quantity <= 0" @click.stop="openLocationOperation(row, 'outbound', stock)">出库</el-button>
                    <el-dropdown trigger="click" @command="handleLocationCommand">
                      <el-button link :icon="MoreFilled" aria-label="更多库存操作" title="更多库存操作" />
                      <template #dropdown><el-dropdown-menu><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'transfer' }">调拨</el-dropdown-item><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'adjustment' }">盘点调整</el-dropdown-item><el-dropdown-item v-if="can('spares.manage')" :command="{ part: row, stock, operation: 'scrap' }" :disabled="stock.quantity <= 0">报废</el-dropdown-item><el-dropdown-item divided @click="openTransactionDrawer(row)">查看流水</el-dropdown-item></el-dropdown-menu></template>
                    </el-dropdown>
                  </div>
                </div>
              </div>
              <el-empty v-else :image-size="48" description="暂无库存地点"><el-button v-if="can('spares.manage')" type="primary" size="small" @click="openSpareOperation(row, 'inbound')">登记入库</el-button></el-empty>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="备件名称" min-width="170" show-overflow-tooltip /><el-table-column prop="part_type_label" label="类型" width="110" /><el-table-column prop="brand_name" label="品牌" min-width="110" show-overflow-tooltip /><el-table-column prop="model" label="型号" min-width="130" show-overflow-tooltip /><el-table-column prop="specification" label="规格" min-width="160" show-overflow-tooltip />
        <el-table-column label="总库存" width="100"><template #default="{ row }">{{ row.total_quantity || 0 }} {{ row.unit }}</template></el-table-column><el-table-column prop="location_count" label="地点数" width="84" />
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? "启用" : "停用" }}</el-tag></template></el-table-column>
        <el-table-column label="操作" fixed="right" width="250"><template #default="{ row }"><div class="ep-table-actions"><el-button v-if="can('spares.manage')" link type="primary" @click.stop="openSpareOperation(row, 'inbound')">入库</el-button><el-button link type="primary" :icon="List" aria-label="查看库存流水" title="查看库存流水" @click.stop="openTransactionDrawer(row)" /><el-button v-if="can('spares.manage')" link type="primary" :icon="Edit" aria-label="编辑备件" title="编辑备件" @click.stop="openSparePartModal(row)" /><el-button v-if="can('spares.manage')" link @click.stop="toggleSparePart(row)">{{ row.is_active ? "停用" : "启用" }}</el-button><el-button v-if="can('spares.manage')" link type="danger" :icon="Delete" aria-label="删除备件" title="删除备件" @click.stop="deleteSparePart(row)" /></div></template></el-table-column>
      </el-table>
      <PagedTable v-model:current-page="sparePage" v-model:page-size="sparePageSize" :total="sparePartCount" :loading="loading" @update:current-page="changeSparePage" @update:page-size="changeSparePageSize" />
    </el-card>

    <el-dialog v-model="showSparePartModal" :title="editingSparePart ? '编辑备件' : '新增备件'" width="620px" destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveSparePart"><div class="form-grid"><el-form-item label="备件名称" required><el-input v-model="sparePartForm.name" /></el-form-item><el-form-item label="备件类型" required><el-select v-model="sparePartForm.part_type"><el-option v-for="item in partTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="品牌"><el-select v-model="sparePartForm.brand" clearable placeholder="未关联品牌"><el-option v-for="brand in activeBrands" :key="brand.id" :label="brand.name" :value="String(brand.id)" /></el-select></el-form-item><el-form-item label="型号"><el-input v-model="sparePartForm.model" /></el-form-item><el-form-item label="规格"><el-input v-model="sparePartForm.specification" /></el-form-item><el-form-item label="计量单位"><el-input v-model="sparePartForm.unit" /></el-form-item><el-form-item label="备注" class="full-width"><el-input v-model="sparePartForm.notes" type="textarea" :rows="2" /></el-form-item></div><el-checkbox v-model="sparePartForm.is_active">启用</el-checkbox></el-form>
      <template #footer><el-button @click="showSparePartModal = false">取消</el-button><el-button type="primary" @click="saveSparePart">保存备件</el-button></template>
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
      <el-alert v-if="transactionError" type="error" :closable="false" :title="transactionError" />
      <el-table v-loading="transactionLoading" :data="transactionRows" empty-text="暂无库存流水"><el-table-column prop="created_at" label="时间" width="165" show-overflow-tooltip /><el-table-column prop="operation_type_label" label="操作" width="90" /><el-table-column label="数量" width="85"><template #default="{ row }">{{ row.quantity }} {{ row.unit }}</template></el-table-column><el-table-column label="地点" min-width="210" show-overflow-tooltip><template #default="{ row }">{{ transactionLocation(row) }}</template></el-table-column><el-table-column prop="operator_name" label="操作人" width="105" show-overflow-tooltip /><el-table-column prop="reference" label="用途" min-width="120" show-overflow-tooltip /><el-table-column prop="notes" label="备注" min-width="130" show-overflow-tooltip /></el-table>
      <PagedTable v-model:current-page="transactionPage" v-model:page-size="transactionPageSize" :total="transactionCount" :loading="transactionLoading" @update:current-page="changeTransactionPage" @update:page-size="changeTransactionPageSize" />
    </el-drawer>
  </div>
</template>
