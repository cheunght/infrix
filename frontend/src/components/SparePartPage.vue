<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { FormInstance, FormRules } from "element-plus";
import { Delete, Download, Edit, Operation, Switch, Tickets, TopRight, Upload } from "@element-plus/icons-vue";
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
import TableIconButton from "./TableIconButton.vue";
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
const { t, locale } = useI18n();
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
const sparePartRules = computed<FormRules>(() => ({
  code: [{ required: true, message: t("validation.required", { field: t("spare.spareCode") }), trigger: "submit" }],
  name: [{ required: true, message: t("validation.required", { field: t("spare.spareName") }), trigger: "submit" }],
  category: [{ required: true, message: t("validation.selectRequired", { field: t("spare.spareType") }), trigger: "submit" }],
  unit: [{ required: true, message: t("validation.selectRequired", { field: t("spare.unit") }), trigger: "submit" }],
  initial_data_center: [{
    validator: (_rule, value, callback) => {
      if (Number(sparePartForm.value.initial_quantity || 0) > 0 && !value) {
        callback(new Error(t("validation.selectRequired", { field: t("spare.initialDataCenter") })));
        return;
      }
      callback();
    },
    trigger: "submit",
  }],
}));

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
  if (!part) return t("common.notAvailable");
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
const operationQuantityHelp = computed(() => operationMax.value === undefined ? "" : t("spare.maxOperation", { count: operationMax.value }));
const adjustmentMin = computed(() => -Math.max(0, operationCurrentQuantity.value));
const adjustmentAfterQuantity = computed(() => operationCurrentQuantity.value + Number(adjustmentQuantityValue.value ?? 0));
const adjustmentQuantityHelp = computed(() => t("spare.adjustmentPositive"));

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
    if (delta === null) return t("spare.enterAdjustment");
    if (!Number.isInteger(delta)) return t("spare.integerAdjustment");
    if (delta === 0) return t("spare.zeroAdjustment");
    if (adjustmentAfterQuantity.value < 0) return t("spare.negativeStock");
  }
  return t("spare.operationUnavailable");
});

function roomsFor(dataCenterId: string) {
  return (spareRooms.value as ServerRoom[]).filter((room) => String(room.data_center) === String(dataCenterId) && room.is_active);
}
function locationLabel(dataCenterName?: string | null, roomName?: string | null) {
  if (!dataCenterName) return t("common.notAvailable");
  return roomName ? `${dataCenterName} / ${roomName}` : `${dataCenterName} (${t("spare.centerStock")})`;
}
function stockLocationLabel(stock: SpareStock) { return locationLabel(stock.data_center_name, stock.server_room_name); }
function transactionQuantityLabel(row: SpareTransaction) {
  const delta = row.quantity_delta;
  return `${delta > 0 ? "+" : ""}${delta} ${spareUnitLabel(row.unit)}`;
}
function transactionDateTime(value: string) {
  return value ? new Date(value).toLocaleString(locale.value) : t("common.notAvailable");
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
            <SearchField v-model="spareSearch" :placeholder="t('spare.searchPlaceholder')" :aria-label="t('spare.title')" :loading="spareListLoading" @search="searchSpareParts" />
          </template>
          <template #actions>
            <el-button v-if="can('spares.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingSpares" :disabled="exportingSpares" @click="exportSpareParts">
              {{ t('asset.exportData') }}
            </el-button>
          </template>
          <template #primary>
            <el-button v-if="can('spares.manage')" class="page-primary-action" type="primary" @click="openSparePartModal()">{{ t('spare.addSpare') }}</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface class="spare-list-content">
        <ResourceState :error="spareListError" @retry="retrySpareList">
          <template #error="{ error }">
            <el-alert :title="t('common.dataLoadFailed')" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" :loading="spareListLoading" @click="retrySpareList">{{ t('common.retry') }}</el-button>
          </template>
          <PagedTable v-model:current-page="sparePage" v-model:page-size="sparePageSize" :total="sparePartCount" @update:current-page="changeSparePage" @update:page-size="changeSparePageSize">
          <el-table class="spare-table" table-layout="fixed" v-loading="spareListLoading" :data="spareParts" row-key="id" @expand-change="handleExpandChange">
            <template #empty>
              <el-empty :image-size="56" :description="hasSpareFilters ? t('spare.noMatchingSpares') : t('spare.noSpares')">
                <el-button v-if="hasSpareFilters" link type="primary" @click="resetSpareFilters">{{ t('common.clearFilters') }}</el-button>
              </el-empty>
            </template>
            <el-table-column type="expand" width="46">
              <template #default="{ row }">
                <div class="spare-location-panel">
                  <div class="spare-location-header"><strong>{{ t('spare.stockLocation') }}</strong><span class="form-hint">{{ t('spare.stockLocationHint') }}</span></div>
                  <el-skeleton v-if="stockLocationLoadingByPart[row.id]" :rows="2" animated />
                  <div v-else-if="stockLocationErrorByPart[row.id]" class="spare-inline-error" role="alert"><span>{{ t('spare.stockLocationLoadFailed') }}: {{ stockLocationErrorByPart[row.id] }}</span><el-button link type="primary" @click="stockLocationRetry(row.id)">{{ t('common.retry') }}</el-button></div>
                  <div v-else-if="stockLocationLoadedByPart[row.id] && stocksFor(row).length" class="spare-location-list">
                    <div v-for="stock in stocksFor(row)" :key="stock.id" class="spare-location-row">
                      <div class="spare-location-main"><strong>{{ stockLocationLabel(stock) }}</strong><span class="form-hint">{{ t('spare.updatedAt') }}: {{ stock.updated_at || t('common.notAvailable') }}</span></div>
                      <el-tag :type="stock.quantity > 0 ? 'success' : 'info'" class="spare-location-quantity">{{ stock.quantity }} {{ spareUnitLabel(row.unit) }}</el-tag>
                      <div class="ep-table-actions">
                        <TableIconButton v-if="can('spares.manage')" :icon="Upload" :label="t('spare.inbound')" type="primary" @click="openLocationOperation(row, 'inbound', stock)" />
                        <TableIconButton v-if="can('spares.manage')" :icon="TopRight" :label="t('spare.outbound')" :disabled="stock.quantity <= 0" @click="openLocationOperation(row, 'outbound', stock)" />
                        <TableIconButton v-if="can('spares.manage')" :icon="Switch" :label="t('spare.transfer')" @click="openLocationOperation(row, 'transfer', stock)" />
                        <TableIconButton v-if="can('spares.manage')" :icon="Operation" :label="t('spare.adjustStock')" @click="openLocationOperation(row, 'adjustment', stock)" />
                        <TableIconButton v-if="can('spares.manage')" :icon="Delete" :label="t('spare.scrap')" type="danger" :disabled="stock.quantity <= 0" @click="openLocationOperation(row, 'scrap', stock)" />
                        <TableIconButton :icon="Tickets" :label="t('spare.viewTransactions')" type="primary" @click="openTransactionDrawer(row)" />
                      </div>
                    </div>
                    <div v-if="(stockLocationTotalsByPart[row.id] || 0) > stocksFor(row).length" class="spare-location-total-hint">{{ t('spare.currentLocations', { shown: stocksFor(row).length, total: stockLocationTotalsByPart[row.id] }) }}</div>
                  </div>
                  <el-empty v-else-if="stockLocationLoadedByPart[row.id]" :image-size="48" :description="t('spare.noStockLocations')"><TableIconButton v-if="can('spares.manage')" :icon="Upload" :label="t('spare.registerInbound')" type="primary" @click="openSpareOperation(row, 'inbound')" /></el-empty>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="name" :label="t('spare.listName')" min-width="220" />
            <el-table-column :label="t('spare.manufacturer')" min-width="135">
              <template #default="{ row }">{{ row.manufacturer_name || t('common.notAvailable') }}</template>
            </el-table-column>
            <el-table-column :label="t('spare.storageLocation')" min-width="210">
              <template #default="{ row }">{{ row.storage_location || t('common.notAvailable') }}</template>
            </el-table-column>
            <el-table-column :label="t('spare.stockQuantity')" width="126" align="center">
              <template #default="{ row }">
                <div class="spare-stock-cell">
                  <span>{{ row.total_quantity ?? 0 }} {{ spareUnitLabel(row.unit) }}</span>
                  <StatusTag v-if="row.is_low_stock" size="small" tone="warning" :label="t('spare.lowStock')" />
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="t('spare.outbound')" width="88">
              <template #default="{ row }">
                <TableIconButton v-if="can('spares.manage')" :icon="TopRight" :label="t('spare.outbound')" type="primary" :disabled="deletingSparePartId === row.id" @click="openSpareOperation(row, 'outbound')" />
              </template>
            </el-table-column>
            <el-table-column :label="t('common.operation')" fixed="right" width="132">
              <template #default="{ row }">
                <div v-if="can('spares.manage')" class="ep-table-actions">
                  <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="deletingSparePartId === row.id" @click="openSparePartModal(row)" />
                  <TableIconButton :icon="Operation" :label="t('spare.adjustStock')" type="primary" :disabled="deletingSparePartId === row.id" @click="openSpareOperation(row, 'adjustment')" />
                  <TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" :loading="deletingSparePartId === row.id" :disabled="deletingSparePartId === row.id" @click="deleteSparePart(row)" />
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
      :title="editingSparePart ? t('spare.editSpare') : t('spare.addSpare')"
      :description="t('spare.spareDescription')"
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
          <h3 class="form-dialog__section-title">{{ t('spare.basicInfo') }}</h3>
          <div class="horizontal-form__rows">
            <el-form-item :label="t('spare.spareCode')" prop="code"><el-input v-model="sparePartForm.code" :disabled="Boolean(editingSparePart)" :placeholder="t('validation.required', { field: t('spare.spareCode') })" /></el-form-item>
            <el-form-item :label="t('spare.spareName')" prop="name"><el-input v-model="sparePartForm.name" /></el-form-item>
            <el-form-item :label="t('spare.spareType')" prop="category"><el-select v-model="sparePartForm.category" filterable :placeholder="t('validation.selectRequired', { field: t('spare.spareType') })"><el-option v-for="item in activeSpareCategories" :key="item.id" :label="`${item.name}${item.is_active ? '' : ` (${t('status.inactive')})`}`" :value="String(item.id)" /></el-select></el-form-item>
            <el-form-item :label="t('spare.manufacturer')"><el-select v-model="sparePartForm.manufacturer" filterable clearable :placeholder="t('spare.unlinkedManufacturer')"><el-option v-for="manufacturer in manufacturerOptions" :key="manufacturer.id" :label="`${manufacturer.name}${manufacturer.is_active ? '' : ` (${t('status.inactive')})`}`" :value="String(manufacturer.id)" /></el-select></el-form-item>
            <el-form-item :label="t('asset.model')"><el-input v-model="sparePartForm.model" /></el-form-item>
            <el-form-item :label="t('spare.specification')"><el-input v-model="sparePartForm.specification" /></el-form-item>
            <el-form-item :label="t('spare.unit')" prop="unit">
              <el-select v-model="sparePartForm.unit" :placeholder="t('validation.selectRequired', { field: t('spare.unit') })" :disabled="spareUnitLocked">
                <el-option v-for="unit in SPARE_UNIT_OPTIONS" :key="unit.value" :label="spareUnitLabel(unit.value)" :value="unit.value" />
              </el-select>
              <FieldHelp v-if="spareUnitLocked" :text="t('spare.unitLocked')" />
            </el-form-item>
          </div>
        </section>
        <section class="form-dialog__section">
          <h3 class="form-dialog__section-title">{{ t('spare.stockInfo') }}</h3>
          <div class="horizontal-form__rows">
            <el-form-item v-if="!editingSparePart" :label="t('spare.initialStock')"><el-input-number v-model="sparePartForm.initial_quantity" :min="0" :step="1" :value-on-clear="null" :aria-label="t('spare.initialStock')"><template #suffix>{{ spareUnitLabel(sparePartForm.unit) }}</template></el-input-number><FieldHelp :text="t('spare.initialStockHint')" /></el-form-item>
            <el-form-item v-else :label="t('spare.currentStock')"><el-input :model-value="`${sparePartForm.current_quantity} ${spareUnitLabel(sparePartForm.unit)}`" disabled /></el-form-item>
            <el-form-item v-if="!editingSparePart && Number(sparePartForm.initial_quantity || 0) > 0" :label="t('spare.initialDataCenter')" prop="initial_data_center" required><el-select v-model="sparePartForm.initial_data_center" :placeholder="t('validation.selectRequired', { field: t('spare.initialDataCenter') })" @change="onInitialDataCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item>
            <el-form-item v-if="!editingSparePart && Number(sparePartForm.initial_quantity || 0) > 0" :label="t('spare.initialRoom')"><el-select v-model="sparePartForm.initial_server_room" :placeholder="t('spare.centerStock')" clearable><el-option v-for="room in roomsFor(sparePartForm.initial_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item>
            <el-form-item :label="t('spare.safetyStock')"><el-input-number v-model="sparePartForm.safety_stock" :min="0" :step="1" :value-on-clear="null" :aria-label="t('spare.safetyStock')"><template #suffix>{{ spareUnitLabel(sparePartForm.unit) }}</template></el-input-number><FieldHelp :text="t('spare.safetyStockHint')" /></el-form-item>
            <el-form-item :label="t('spare.storageLocation')"><el-input v-model="sparePartForm.storage_location" :placeholder="t('spare.storageLocationPlaceholder')" /></el-form-item>
          </div>
        </section>
        <section class="form-dialog__section">
          <h3 class="form-dialog__section-title">{{ t('spare.otherInfo') }}</h3>
          <div class="horizontal-form__rows">
            <el-form-item :label="t('common.notes')"><el-input v-model="sparePartForm.notes" type="textarea" :rows="2" /></el-form-item>
          </div>
        </section>
      </el-form>
      <template #footer>
        <el-button :disabled="spareSaving" @click="showSparePartModal = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="spareSaving" :disabled="spareSaving" @click="handleSaveSparePart">{{ t('spare.saveSpare') }}</el-button>
      </template>
    </FormDialogShell>

    <ActionDialogShell
      v-model="showSpareOperationModal"
      :title="`${spareOperationLabel(spareOperationType)}${t('spare.stockQuantity')}`"
      :description="t('spare.operationTitle')"
      size="medium"
      :pending="spareOperationSaving"
      :error="spareOperationError"
      :close-disabled="spareOperationSaving"
    >
      <el-form label-position="top" @submit.prevent="saveSpareOperation">
        <el-alert v-if="operationPart && selectedOperation !== 'adjustment'" class="spare-operation-context" type="info" :closable="false">{{ t('spare.currentInventory', { inventory: operationInventoryLabel }) }}<span v-if="spareOperationLocationLabel"> · {{ t('spare.currentStockLocation', { location: spareOperationLocationLabel }) }}</span></el-alert>
        <el-form-item :label="t('spare.spareName')"><el-input :model-value="operationPart?.name || t('common.notAvailable')" disabled /></el-form-item>
        <el-form-item v-if="selectedOperation === 'adjustment'" :label="t('spare.currentStock')">
          <el-input :model-value="operationInventoryLabel" disabled />
        </el-form-item>
        <el-form-item v-if="selectedOperation === 'adjustment'" :label="t('spare.adjustmentQuantity')" required>
          <el-input-number v-model="adjustmentQuantityValue" :min="adjustmentMin" :step="1" :precision="0" :value-on-clear="null" :formatter="formatAdjustmentQuantity" :parser="parseAdjustmentQuantity" :aria-label="t('spare.adjustmentQuantity')">
            <template #suffix>{{ operationPart ? spareUnitLabel(operationPart.unit) : '' }}</template>
          </el-input-number>
          <FieldHelp :text="adjustmentQuantityHelp" />
        </el-form-item>
        <el-form-item v-if="selectedOperation === 'adjustment'" :label="t('spare.afterAdjustment')">
          <el-input :model-value="`${adjustmentAfterQuantity} ${operationPart ? spareUnitLabel(operationPart.unit) : ''}`" disabled />
        </el-form-item>
        <el-form-item v-if="showQuantity" :label="t('spare.operationQuantity')" required>
          <el-input-number
            v-model="operationQuantityValue"
            :min="1"
            :max="operationMax"
            :step="1"
            :precision="0"
            :value-on-clear="null"
            :aria-label="t('spare.operationQuantity')"
          >
            <template #suffix>{{ operationPart ? spareUnitLabel(operationPart.unit) : '' }}</template>
          </el-input-number>
          <FieldHelp v-if="operationQuantityHelp" :text="operationQuantityHelp" />
        </el-form-item>
        <div v-if="showSourceLocation" class="form-grid"><el-form-item :label="t('spare.sourceDataCenter')" required><el-select v-model="spareOperationForm.source_data_center" :disabled="sourceLocationLocked" :placeholder="t('common.select')" @change="onOperationSourceCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item><el-form-item :label="t('spare.sourceRoom')"><el-select v-model="spareOperationForm.source_server_room" :disabled="sourceLocationLocked" :placeholder="t('spare.centerStock')" clearable><el-option v-for="room in roomsFor(spareOperationForm.source_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item></div>
        <div v-if="showTargetLocation" class="form-grid"><el-form-item :label="selectedOperation === 'adjustment' ? t('spare.inventoryDataCenter') : t('spare.targetDataCenter')" required><el-select v-model="spareOperationForm.target_data_center" :disabled="targetLocationLocked" :placeholder="t('common.select')" @change="onOperationTargetCenterChange"><el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" /></el-select></el-form-item><el-form-item :label="selectedOperation === 'adjustment' ? t('spare.inventoryRoom') : t('spare.targetRoom')"><el-select v-model="spareOperationForm.target_server_room" :disabled="targetLocationLocked" :placeholder="t('spare.centerStock')" clearable><el-option v-for="room in roomsFor(spareOperationForm.target_data_center)" :key="room.id" :label="room.name" :value="String(room.id)" /></el-select></el-form-item></div>
        <el-alert v-if="operationCannotOperate" class="spare-operation-context" type="warning" :closable="false" :title="operationWarningTitle" /><div class="form-grid"><el-form-item :label="t('spare.referencePurpose')"><el-input v-model="spareOperationForm.reference" /></el-form-item><el-form-item :label="t('common.notes')"><el-input v-model="spareOperationForm.notes" /></el-form-item></div>
      </el-form>
      <template #footer><el-button :disabled="spareOperationSaving" @click="showSpareOperationModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :disabled="operationCannotOperate || spareOperationSaving" :loading="spareOperationSaving" @click="saveSpareOperation">{{ t('spare.saveTransaction') }}</el-button></template>
    </ActionDialogShell>

    <el-drawer v-model="transactionDrawerOpen" :title="t('spare.transactionTitle')" size="620px" destroy-on-close>
      <div v-if="selectedPart" class="spare-transaction-drawer-title"><div><strong>{{ selectedPart.name }}</strong><span class="form-hint">{{ selectedPart.category_name }} · {{ spareUnitLabel(selectedPart.unit) }}</span></div><el-button v-if="can('spares.export')" class="toolbar-secondary-action" :icon="Download" :loading="exportingSpares" :disabled="exportingSpares" @click="exportSpareTransactions(selectedPart.id)">{{ t('spare.exportTransactions') }}</el-button></div>
      <div v-if="selectedPart" class="spare-detail-summary">
        <div><span>{{ t('spare.spareCode') }}</span><strong>{{ selectedPart.code }}</strong></div>
        <div><span>{{ t('spare.spareType') }}</span><strong>{{ selectedPart.category_name }}</strong></div>
        <div><span>{{ t('spare.manufacturer') }}</span><strong>{{ selectedPart.manufacturer_name || t('spare.unlinkedManufacturer') }}</strong></div>
        <div><span>{{ t('asset.model') }}</span><strong>{{ selectedPart.model || t('common.notAvailable') }}</strong></div>
        <div><span>{{ t('spare.specification') }}</span><strong>{{ selectedPart.specification || t('common.notAvailable') }}</strong></div>
        <div><span>{{ t('spare.currentStock') }}</span><strong>{{ selectedPart.total_quantity }} {{ spareUnitLabel(selectedPart.unit) }}</strong></div>
        <div><span>{{ t('spare.safetyStock') }}</span><strong>{{ selectedPart.safety_stock }} {{ spareUnitLabel(selectedPart.unit) }}</strong></div>
        <div><span>{{ t('spare.storageLocation') }}</span><strong>{{ selectedPart.storage_location || t('common.notAvailable') }}</strong></div>
        <div class="spare-detail-summary__notes"><span>{{ t('common.notes') }}</span><strong>{{ selectedPart.notes || t('common.notAvailable') }}</strong></div>
      </div>
      <div class="spare-transaction-filters">
        <el-select v-model="spareTransactionFilters.operation_type" class="spare-transaction-type-filter" :placeholder="t('spare.allStockTypes')" clearable @change="applyTransactionFilters">
          <el-option :label="t('spare.allStockTypes')" value="" />
          <el-option v-for="option in STOCK_OPERATION_OPTIONS" :key="option.value" :label="spareOperationLabel(option.value)" :value="option.value" />
        </el-select>
        <el-date-picker v-model="transactionDateRange" class="spare-transaction-date-filter" type="daterange" value-format="YYYY-MM-DD" :start-placeholder="t('spare.startDate')" :end-placeholder="t('spare.endDate')" :range-separator="t('spare.to')" clearable />
        <el-button v-if="spareTransactionFilters.operation_type || spareTransactionFilters.start || spareTransactionFilters.end" link type="primary" @click="resetTransactionFilters">{{ t('common.reset') }}</el-button>
      </div>
      <ResourceState :loading="transactionLoading" :error="transactionError" :empty="transactionEmpty" :empty-text="t('spare.noTransactions')" @retry="retryTransactions">
        <template #error="{ error }">
          <div class="spare-inline-error spare-transaction-error" role="alert"><span>{{ t('spare.transactionLoadFailed') }}: {{ error }}</span><el-button link type="primary" :loading="transactionLoading" @click="retryTransactions">{{ t('common.retry') }}</el-button></div>
        </template>
        <el-table :data="transactionRows">
          <el-table-column :label="t('common.time')" width="145"><template #default="{ row }">{{ transactionDateTime(row.created_at) }}</template></el-table-column>
          <el-table-column :label="t('common.type')" width="86" align="center"><template #default="{ row }"><StatusTag size="small" :tone="stockOperationTone(row.operation_type)" :label="spareOperationLabel(row.operation_type)" /></template></el-table-column>
          <el-table-column :label="t('spare.changeQuantity')" width="92" align="right"><template #default="{ row }"><span class="spare-ledger-delta" :class="{ 'is-positive': row.quantity_delta > 0, 'is-negative': row.quantity_delta < 0 }">{{ transactionQuantityLabel(row) }}</span></template></el-table-column>
          <el-table-column :label="t('spare.changedBefore')" width="82" align="right"><template #default="{ row }">{{ row.before_quantity }} {{ spareUnitLabel(row.unit) }}</template></el-table-column>
          <el-table-column :label="t('spare.changedAfter')" width="82" align="right"><template #default="{ row }">{{ row.after_quantity }} {{ spareUnitLabel(row.unit) }}</template></el-table-column>
          <el-table-column prop="operator_name" :label="t('spare.operator')" width="100" />
          <el-table-column :label="t('common.reason')" min-width="140">
            <template #default="{ row }">
              <span class="spare-ledger-reason">{{ row.reference || (row.notes ? t('spare.transactionReason') : t('common.notAvailable')) }}</span>
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
.spare-stock-cell { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
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
