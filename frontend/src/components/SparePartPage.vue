<script setup lang="ts">
import { computed } from "vue";
import { Delete, Edit, Plus } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import type { DataCenter, DictionaryItem, ServerRoom, SparePart, SpareStock, SpareTransaction } from "../types";

const props = defineProps<{ context: Record<string, any> }>();
const {
  loading,
  can,
  spareParts,
  spareStocks,
  spareTransactions,
  sparePartCount,
  spareStockCount,
  spareTransactionCount,
  sparePage,
  sparePageSize,
  spareStockPage,
  spareStockPageSize,
  spareTransactionPage,
  spareTransactionPageSize,
  spareSearch,
  spareType,
  spareActive,
  spareListDataCenter,
  spareListRoom,
  spareDataCenter,
  spareRoom,
  spareSelectedPart,
  spareRooms,
  sparePartForm,
  editingSparePart,
  showSparePartModal,
  openSparePartModal,
  saveSparePart,
  toggleSparePart,
  deleteSparePart,
  selectSparePart,
  searchSpareParts,
  changeSparePage,
  changeSparePageSize,
  changeSpareStockPage,
  changeSpareStockPageSize,
  changeSpareTransactionPage,
  changeSpareTransactionPageSize,
  openSpareOperation,
  spareOperationType,
  spareOperationForm,
  showSpareOperationModal,
  spareOperationSaving,
  saveSpareOperation,
  spareOperationLabel,
  dataCenters,
  brands,
} = props.context;

const partTypes = [
  { value: "hard_disk", label: "备用硬盘" },
  { value: "memory", label: "内存" },
  { value: "power_module", label: "电源模块" },
  { value: "optical_module", label: "光模块" },
  { value: "network_card", label: "网卡" },
  { value: "hba_card", label: "HBA 卡" },
  { value: "fan", label: "风扇" },
  { value: "raid_card", label: "RAID 卡" },
  { value: "other", label: "其他" },
];
const operationTypes = [
  { value: "inbound", label: "入库" },
  { value: "outbound", label: "出库" },
  { value: "transfer", label: "调拨" },
  { value: "adjustment", label: "盘点调整" },
  { value: "scrap", label: "报废" },
];
const activeBrands = computed(() => (brands.value as DictionaryItem[]).filter((item) => item.is_active));
const activeDataCenters = computed(() => (dataCenters.value as DataCenter[]).filter((item) => item.is_active));
const selectedPart = computed(() => spareSelectedPart.value as SparePart | null);
const selectedOperation = computed(() => spareOperationType.value as string);
const showSourceLocation = computed(() => ["outbound", "transfer", "scrap"].includes(selectedOperation.value));
const showTargetLocation = computed(() => ["inbound", "transfer", "adjustment"].includes(selectedOperation.value));
const showQuantity = computed(() => selectedOperation.value !== "adjustment");

function roomsFor(dataCenterId: string) {
  return (spareRooms.value as ServerRoom[]).filter((room) => String(room.data_center) === String(dataCenterId) && room.is_active);
}
function locationLabel(dataCenterName?: string | null, roomName?: string | null) {
  if (!dataCenterName) return "—";
  return roomName ? `${dataCenterName} / ${roomName}` : `${dataCenterName}（中心库存）`;
}
function transactionLocation(row: SpareTransaction) {
  if (row.operation_type === "inbound" || row.operation_type === "adjustment") {
    return locationLabel(row.target_data_center_name, row.target_server_room_name);
  }
  if (row.operation_type === "transfer") {
    return `${locationLabel(row.source_data_center_name, row.source_server_room_name)} → ${locationLabel(row.target_data_center_name, row.target_server_room_name)}`;
  }
  return locationLabel(row.source_data_center_name, row.source_server_room_name);
}
function onStockDataCenterChange() {
  spareRoom.value = "";
}
function onSpareListDataCenterChange() {
  spareListRoom.value = "";
  searchSpareParts();
}
function onOperationSourceCenterChange() {
  spareOperationForm.source_server_room = "";
}
function onOperationTargetCenterChange() {
  spareOperationForm.target_server_room = "";
}
</script>

<template>
  <div class="itam-page spare-page">
    <el-card shadow="never">
      <div class="ep-toolbar">
        <SearchField
          v-model="spareSearch"
          placeholder="搜索备件名称、类型、品牌或型号"
          aria-label="搜索备件"
          @search="searchSpareParts"
        />
        <el-select v-model="spareType" placeholder="全部类型" clearable @change="searchSpareParts">
          <el-option v-for="item in partTypes" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="spareActive" placeholder="全部状态" @change="searchSpareParts">
          <el-option label="启用" value="true" />
          <el-option label="停用" value="false" />
          <el-option label="全部" value="all" />
        </el-select>
        <el-select v-model="spareListDataCenter" placeholder="全部数据中心" clearable @change="onSpareListDataCenterChange">
          <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
        </el-select>
        <el-select v-model="spareListRoom" placeholder="全部机房" clearable @change="searchSpareParts">
          <el-option v-for="room in roomsFor(spareListDataCenter)" :key="room.id" :label="room.name" :value="String(room.id)" />
        </el-select>
        <span class="ep-toolbar-spacer" />
        <div class="ep-toolbar-actions">
          <el-button v-if="can('spares.manage')" type="primary" :icon="Plus" @click="openSparePartModal()">新增备件</el-button>
        </div>
      </div>
      <el-table
        :data="spareParts"
        row-key="id"
        highlight-current-row
        empty-text="暂无备件"
        @row-click="selectSparePart"
      >
        <el-table-column prop="name" label="备件名称" min-width="170" />
        <el-table-column prop="part_type_label" label="类型" width="110" />
        <el-table-column prop="brand_name" label="品牌" min-width="110" />
        <el-table-column prop="model" label="型号" min-width="130" />
        <el-table-column prop="specification" label="规格" min-width="160" show-overflow-tooltip />
        <el-table-column label="总库存" width="100">
          <template #default="{ row }">{{ row.total_quantity || 0 }} {{ row.unit }}</template>
        </el-table-column>
        <el-table-column prop="location_count" label="库存地点" width="100" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? "启用" : "停用" }}</el-tag></template>
        </el-table-column>
        <el-table-column v-if="can('spares.manage')" label="操作" fixed="right" width="270">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <el-button link type="primary" @click.stop="openSpareOperation(row, 'inbound')">库存操作</el-button>
              <el-button link type="primary" :icon="Edit" aria-label="编辑备件" title="编辑备件" @click.stop="openSparePartModal(row)" />
              <el-button link @click.stop="toggleSparePart(row)">{{ row.is_active ? "停用" : "启用" }}</el-button>
              <el-button link type="danger" :icon="Delete" aria-label="删除备件" title="删除备件" @click.stop="deleteSparePart(row)" />
            </div>
          </template>
        </el-table-column>
      </el-table>
      <PagedTable
        v-model:current-page="sparePage"
        v-model:page-size="sparePageSize"
        :total="sparePartCount"
        :loading="loading"
        @update:current-page="changeSparePage"
        @update:page-size="changeSparePageSize"
      />
    </el-card>

    <el-card v-if="selectedPart" class="spare-detail-card" shadow="never">
      <template #header>
        <div class="ep-toolbar">
          <div><strong>{{ selectedPart.name }}</strong><span class="form-hint">{{ selectedPart.part_type_label }} · {{ selectedPart.unit }}</span></div>
          <div class="ep-toolbar-actions" v-if="can('spares.manage')">
            <el-button type="primary" size="small" @click="openSpareOperation(selectedPart, 'inbound')">入库</el-button>
            <el-button size="small" @click="openSpareOperation(selectedPart, 'outbound')">出库</el-button>
            <el-button size="small" @click="openSpareOperation(selectedPart, 'transfer')">调拨</el-button>
            <el-button size="small" @click="openSpareOperation(selectedPart, 'adjustment')">盘点调整</el-button>
            <el-button type="danger" plain size="small" @click="openSpareOperation(selectedPart, 'scrap')">报废</el-button>
          </div>
        </div>
      </template>
      <div class="spare-detail-filters">
        <el-select v-model="spareDataCenter" placeholder="全部数据中心" clearable @change="onStockDataCenterChange(); selectSparePart(selectedPart, false)">
          <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
        </el-select>
        <el-select v-model="spareRoom" placeholder="全部机房" clearable @change="selectSparePart(selectedPart, false)">
          <el-option v-for="room in roomsFor(spareDataCenter)" :key="room.id" :label="room.name" :value="String(room.id)" />
        </el-select>
      </div>
      <h3>库存地点</h3>
      <el-table :data="spareStocks" empty-text="暂无库存地点">
        <el-table-column prop="data_center_name" label="数据中心" />
        <el-table-column prop="server_room_name" label="机房"><template #default="{ row }">{{ row.server_room_name || "中心库存" }}</template></el-table-column>
        <el-table-column label="当前库存"><template #default="{ row }">{{ row.quantity }} {{ selectedPart.unit }}</template></el-table-column>
        <el-table-column prop="updated_at" label="更新时间" />
      </el-table>
      <PagedTable
        v-model:current-page="spareStockPage"
        v-model:page-size="spareStockPageSize"
        :total="spareStockCount"
        :loading="loading"
        @update:current-page="changeSpareStockPage"
        @update:page-size="changeSpareStockPageSize"
      />
      <h3 class="spare-history-title">库存流水</h3>
      <el-table :data="spareTransactions" empty-text="暂无库存流水">
        <el-table-column prop="created_at" label="时间" width="170" />
        <el-table-column prop="operation_type_label" label="操作" width="100" />
        <el-table-column label="数量" width="100"><template #default="{ row }">{{ row.quantity }} {{ row.unit }}</template></el-table-column>
        <el-table-column label="地点" min-width="250"><template #default="{ row }">{{ transactionLocation(row) }}</template></el-table-column>
        <el-table-column prop="operator_name" label="操作人" width="120" />
        <el-table-column prop="reference" label="参考单号/用途" min-width="150" />
        <el-table-column prop="notes" label="备注" min-width="160" show-overflow-tooltip />
      </el-table>
      <PagedTable
        v-model:current-page="spareTransactionPage"
        v-model:page-size="spareTransactionPageSize"
        :total="spareTransactionCount"
        :loading="loading"
        @update:current-page="changeSpareTransactionPage"
        @update:page-size="changeSpareTransactionPageSize"
      />
    </el-card>

    <el-dialog v-model="showSparePartModal" :title="editingSparePart ? '编辑备件' : '新增备件'" width="620px" destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveSparePart">
        <div class="form-grid">
          <el-form-item label="备件名称" required><el-input v-model="sparePartForm.name" /></el-form-item>
          <el-form-item label="备件类型" required><el-select v-model="sparePartForm.part_type"><el-option v-for="item in partTypes" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
          <el-form-item label="品牌"><el-select v-model="sparePartForm.brand" clearable placeholder="未关联品牌"><el-option v-for="brand in activeBrands" :key="brand.id" :label="brand.name" :value="String(brand.id)" /></el-select></el-form-item>
          <el-form-item label="型号"><el-input v-model="sparePartForm.model" /></el-form-item>
          <el-form-item label="规格"><el-input v-model="sparePartForm.specification" /></el-form-item>
          <el-form-item label="计量单位"><el-input v-model="sparePartForm.unit" /></el-form-item>
          <el-form-item label="备注" class="full-width"><el-input v-model="sparePartForm.notes" type="textarea" :rows="2" /></el-form-item>
        </div>
        <el-checkbox v-model="sparePartForm.is_active">启用</el-checkbox>
      </el-form>
      <template #footer><el-button @click="showSparePartModal = false">取消</el-button><el-button type="primary" @click="saveSparePart">保存备件</el-button></template>
    </el-dialog>

    <el-dialog v-model="showSpareOperationModal" :title="`${spareOperationLabel(spareOperationType)}库存`" width="620px" destroy-on-close>
      <el-form label-position="top" @submit.prevent="saveSpareOperation">
        <el-form-item label="备件"><el-input :model-value="selectedPart?.name || '—'" disabled /></el-form-item>
        <el-form-item v-if="showQuantity" label="数量" required><el-input-number v-model="spareOperationForm.quantity" :min="1" :step="1" controls-position="right" /></el-form-item>
        <el-form-item v-else label="调整后库存" required><el-input-number v-model="spareOperationForm.target_quantity" :min="0" :step="1" controls-position="right" /></el-form-item>
        <div v-if="showSourceLocation" class="form-grid">
          <el-form-item label="来源数据中心" required><el-select v-model="spareOperationForm.source_data_center" placeholder="请选择" @change="onOperationSourceCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item label="来源机房"><el-select v-model="spareOperationForm.source_server_room" placeholder="中心库存" clearable><el-option v-for="room in roomsFor(spareOperationForm.source_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
        </div>
        <div v-if="showTargetLocation" class="form-grid">
          <el-form-item label="目标数据中心" required><el-select v-model="spareOperationForm.target_data_center" placeholder="请选择" @change="onOperationTargetCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
          <el-form-item label="目标机房"><el-select v-model="spareOperationForm.target_server_room" placeholder="中心库存" clearable><el-option v-for="room in roomsFor(spareOperationForm.target_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
        </div>
        <div class="form-grid"><el-form-item label="参考单号/用途"><el-input v-model="spareOperationForm.reference" /></el-form-item><el-form-item label="备注"><el-input v-model="spareOperationForm.notes" /></el-form-item></div>
      </el-form>
      <template #footer><el-button @click="showSpareOperationModal = false">取消</el-button><el-button type="primary" :loading="spareOperationSaving" @click="saveSpareOperation">登记流水</el-button></template>
    </el-dialog>
  </div>
</template>
