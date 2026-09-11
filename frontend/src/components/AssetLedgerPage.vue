<!-- UX Reference: standard data-list page. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CopyDocument, Delete, Download, Edit, Filter, Operation, Plus, Printer, Upload } from "@element-plus/icons-vue";
import type { Asset, AssetBatchAssignmentAction, AssetCustomFilter, CustomFieldFilterOperator, PersonOption } from "../types";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import { statusTone } from "../status";
import ResourceState from "./ResourceState.vue";
import ActionDialogShell from "./ActionDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import AssetQrDialog from "./AssetQrDialog.vue";
import DynamicFieldDisplay from "./fields/DynamicFieldDisplay.vue";
import ToolbarIconButton from "./page/ToolbarIconButton.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";
import type { AssetLedgerContext } from "../page-context";
import { ASSET_STATUS_OPTIONS, businessOptionLabel, isAssetStatus } from "../business-enums";
import {
  ASSET_SORT_FIELD_MAP,
  CUSTOM_FIELD_FILTER_OPERATORS,
  MAX_DYNAMIC_ASSET_COLUMNS,
  MAX_DYNAMIC_ASSET_FILTERS,
  defaultCustomFieldFilterOperator,
} from "../composables/useAssets";

const props = defineProps<{ context: AssetLedgerContext }>();
const { t } = useI18n();
const context = props.context;
const {
  assetSearch,
  searchLedger,
  assetFilters,
  draftCustomFilters,
  assetFilterCustomFieldSchema,
  assetFilterCustomSchemaLoading,
  assetFilterCustomSchemaError,
  retryAssetFilterCustomSchema,
  assetListLoading,
  assetListError,
  exportingAssets,
  resetAssetFilters,
  tags,
  manufacturers,
  dataCenters,
  deviceTypes,
  assetColumnOptions,
  assetDynamicColumnOptions,
  visibleAssetColumns,
  toggleAssetColumn,
  resetAssetColumns,
  visibleAssetColumnOptions,
  assetListCustomSchemaLoading,
  assetListCustomSchemaError,
  retryAssetListCustomSchema,
  appliedCustomFilters,
  tagListLoading,
  can,
  openNewAssetModal,
  selectedAssetIds,
  assetBatchDeleteSaving,
  assetBatchDeleteResult,
  showAssetBatchDeleteResult,
  assetBatchAssignmentSaving,
  assetBatchAssignmentError,
  assetBatchAssignmentResult,
  showAssetBatchAssignmentResult,
  assetLabelPrintLoading,
  batchAssignAssets,
  closeAssetBatchAssignmentResult,
  closeAssetBatchDeleteResult,
  deleteSelectedAssets,
  exportAssets,
  loadAllAssetsForLabels,
  registerFaultFromSelection,
  openImportDialog,
  assets,
  handleElementAssetSelection,
  clearAssetSelection: clearSelectedAssets,
  openAssetDetail,
  assetValue,
  openAssetClone,
  openAssetEditor,
  deleteAsset,
  assetPage,
  assetPageSize,
  assetCount,
  assetSortField,
  assetSortOrder,
  changeAssetSort,
  changeAssetPage,
  changeAssetPageSize,
} = context;

const assetTableRef = ref<{
  clearSelection: () => void;
  toggleRowSelection: (row: Asset, selected?: boolean, ignoreSelectable?: boolean) => void;
} | null>(null);
const showQrDialog = ref(false);
const qrDialogAssets = ref<Asset[]>([]);

const selectedQrAssets = computed(() => assets.value.filter((asset) => selectedAssetIds.value.includes(asset.id)));

const assetTableDefaultSort = computed(() => assetSortField.value && assetSortOrder.value
  ? { prop: assetSortField.value, order: assetSortOrder.value }
  : { prop: "", order: "" });

const assetBatchDeleteFailures = computed(() =>
  (assetBatchDeleteResult.value?.results || []).filter((result) => !result.success),
);
const assetBatchAssignmentFailures = computed(() =>
  (assetBatchAssignmentResult.value?.results || []).filter((result) => !result.success),
);

const showBatchAssignmentDialog = ref(false);
const batchAssignmentAction = ref<AssetBatchAssignmentAction>("assign");
const batchAssignmentTargetPersonId = ref("");
const batchAssignmentReason = ref("");
const batchAssignmentFormError = ref("");

const selectedAssetsForBatch = computed(() => selectedAssetIds.value.map((id) =>
  assets.value.find((asset) => asset.id === id) || ({ id, asset_no: `ID ${id}`, name: "" } as Asset),
));
const batchAssignmentTitle = computed(() => t(
  batchAssignmentAction.value === "assign" ? "asset.batchAssignPerson" : "asset.batchTransferPerson",
));
const batchAssignmentActionLabel = computed(() => t(
  batchAssignmentAction.value === "assign" ? "asset.assignPerson" : "asset.transferPerson",
));
const batchAssignmentSubmitLabel = computed(() => t("asset.batchAssignmentSubmit", {
  action: batchAssignmentActionLabel.value,
  count: selectedAssetIds.value.length,
}));
const batchAssignmentCanSubmit = computed(() => Boolean(
  selectedAssetIds.value.length &&
  selectedAssetIds.value.length <= 100 &&
  Number.isSafeInteger(Number(batchAssignmentTargetPersonId.value)) &&
  Number(batchAssignmentTargetPersonId.value) > 0 &&
  !assetBatchAssignmentSaving.value,
));

function mapPerson(item: Record<string, unknown>): SearchableSelectOption {
  const person = item as unknown as PersonOption;
  return {
    value: person.id,
    label: person.display_name || person.name,
    secondary: [person.employee_no, person.department_name].filter(Boolean).join(" · "),
    data: person,
  };
}

function openBatchAssignment(action: AssetBatchAssignmentAction) {
  if (!can("assets.manage") || !selectedAssetIds.value.length || assetBatchAssignmentSaving.value) return;
  batchAssignmentAction.value = action;
  batchAssignmentTargetPersonId.value = "";
  batchAssignmentReason.value = "";
  batchAssignmentFormError.value = "";
  context.assetBatchAssignmentError.value = "";
  showBatchAssignmentDialog.value = true;
  if (selectedAssetIds.value.length > 100) {
    context.assetBatchAssignmentError.value = t("asset.batchAssignmentLimit");
    return;
  }
}

function closeBatchAssignment() {
  if (assetBatchAssignmentSaving.value) return;
  showBatchAssignmentDialog.value = false;
  batchAssignmentFormError.value = "";
  context.assetBatchAssignmentError.value = "";
}

function handleBatchPersonUpdate(value: unknown) {
  const selected = Array.isArray(value) ? value[0] : value;
  batchAssignmentTargetPersonId.value = selected == null ? "" : String(selected);
  batchAssignmentFormError.value = "";
}

async function submitBatchAssignment() {
  if (!batchAssignmentCanSubmit.value) {
    batchAssignmentFormError.value = t("asset.selectPerson");
    return;
  }
  batchAssignmentFormError.value = "";
  const completed = await batchAssignAssets(
    batchAssignmentAction.value,
    [...selectedAssetIds.value],
    Number(batchAssignmentTargetPersonId.value),
    batchAssignmentReason.value,
  );
  if (completed) {
    closeBatchAssignment();
    await nextTick();
    const selectedIds = new Set(selectedAssetIds.value);
    assetTableRef.value?.clearSelection();
    for (const asset of assets.value) {
      if (selectedIds.has(asset.id)) assetTableRef.value?.toggleRowSelection(asset, true);
    }
  }
}

watch(selectedAssetIds, (ids) => {
  if (!ids.length) assetTableRef.value?.clearSelection();
});

const activeTags = computed(() => tags.value.filter((item) => item.is_active));
const activeDeviceTypes = computed(() => deviceTypes.value.filter((item) => item.is_active));
const activeManufacturers = computed(() => manufacturers.value.filter((item) => item.is_active));
const activeDataCenters = computed(() => dataCenters.value.filter((item) => item.is_active !== false));

function mapLedgerDictionaryOption(item: Record<string, unknown>): SearchableSelectOption {
  return {
    value: String(item.id ?? ""),
    label: String(item.name ?? ""),
    secondary: String(item.code ?? ""),
    data: item,
  };
}

function mapLedgerTagOption(item: Record<string, unknown>): SearchableSelectOption {
  return {
    value: String(item.id ?? ""),
    label: String(item.name ?? ""),
    secondary: item.is_active === false ? t("status.inactive") : "",
    disabled: item.is_active === false,
    data: item,
  };
}

function mapLedgerDataCenterOption(item: Record<string, unknown>): SearchableSelectOption {
  return {
    value: String(item.id ?? ""),
    label: String(item.name ?? ""),
    secondary: String(item.address ?? ""),
    data: item,
  };
}

const selectedDeviceTypeOption = computed<SearchableSelectOption | null>(() => {
  const item = activeDeviceTypes.value.find((entry) => String(entry.id) === assetFilters.deviceType);
  return item ? mapLedgerDictionaryOption(item as unknown as Record<string, unknown>) : null;
});
const selectedTagOptions = computed<SearchableSelectOption[]>(() => activeTags.value
  .filter((item) => assetFilters.tag.includes(String(item.id)))
  .map((item) => mapLedgerTagOption(item as unknown as Record<string, unknown>)));
const selectedManufacturerOption = computed<SearchableSelectOption | null>(() => {
  const item = activeManufacturers.value.find((entry) => String(entry.id) === advancedFilters.manufacturer);
  return item ? mapLedgerDictionaryOption(item as unknown as Record<string, unknown>) : null;
});
const selectedDataCenterOption = computed<SearchableSelectOption | null>(() => {
  const item = activeDataCenters.value.find((entry) => String(entry.id) === advancedFilters.dataCenter);
  return item ? mapLedgerDataCenterOption(item as unknown as Record<string, unknown>) : null;
});
const hasAssetFilters = computed(() => Boolean(
  assetSearch.value.trim() ||
  assetFilters.status ||
  assetFilters.deviceType ||
  assetFilters.tag.length ||
  assetFilters.manufacturer ||
  assetFilters.model.trim() ||
  assetFilters.dataCenter ||
  assetFilters.warranty ||
  appliedCustomFilters.value.length,
));
const assetColumnMinWidths: Record<string, number> = {
  name: 220,
  device_type: 120,
  manufacturer: 150,
  status: 105,
  data_center: 160,
  server_room: 140,
  rack_code: 110,
  u_range: 100,
  manufacturer_model: 150,
  maintenance_expiry_date: 130,
};

function assetColumnMinWidth(column: { key: string; width?: number }): number {
  return column.width || assetColumnMinWidths[column.key] || 120;
}

function assetSortFieldForColumn(columnKey: string) {
  return Object.prototype.hasOwnProperty.call(ASSET_SORT_FIELD_MAP, columnKey)
    ? columnKey as keyof typeof ASSET_SORT_FIELD_MAP
    : undefined;
}

function dynamicAssetValue(asset: Asset, columnKey: string): unknown {
  return asset.custom_values?.[columnKey.slice("custom:".length)];
}

function dynamicColumnDisabled(columnKey: string): boolean {
  return !visibleAssetColumns.value.includes(columnKey) &&
    visibleAssetColumns.value.filter((key) => key.startsWith("custom:")).length >= MAX_DYNAMIC_ASSET_COLUMNS;
}

function assetName(asset: Asset): string {
  const name = assetValue(asset, "name").trim();
  return name && name !== "—" ? name : asset.asset_no || t("asset.unlisted");
}

const staticAssetColumnLabelKeys: Record<string, string> = {
  name: "asset.identity",
  asset_no: "asset.code",
  device_type: "asset.deviceType",
  manufacturer: "asset.manufacturer",
  manufacturer_model: "asset.model",
  purpose: "asset.purpose",
  assigned_person: "asset.assignedPerson",
  status: "asset.status",
  serial_number: "asset.serialNumber",
  data_center: "location.dataCenter",
  server_room: "location.room",
  rack_code: "asset.rack",
  u_range: "asset.uPosition",
  business_ip: "asset.businessIp",
  management_ip: "asset.managementIp",
  oob_ip: "asset.oobIp",
  purchase_date: "asset.purchaseDate",
  supplier: "asset.supplier",
  purchase_order_no: "asset.purchaseOrder",
  depreciation_net_book_value: "asset.netBookValue",
  depreciation_accumulated_depreciation: "asset.accumulatedDepreciation",
  depreciation_status: "asset.depreciationStatus",
  maintenance_provider: "asset.maintenanceProvider",
  maintenance_expiry_date: "asset.maintenanceExpiry",
  notes: "common.notes",
};

function assetColumnLabel(column: { key: string; label: string }): string {
  const key = staticAssetColumnLabelKeys[column.key];
  return key ? t(key) : column.label;
}

const showAdvancedFilters = ref(false);
const advancedFilters = reactive({ manufacturer: "", model: "", dataCenter: "", warranty: "" });

const customFilterFields = computed(() => assetFilterCustomFieldSchema.value.filter((field) => field.is_active !== false && field.filterable));
const customFilterOperators = (filter: AssetCustomFilter): CustomFieldFilterOperator[] => {
  const field = customFilterFields.value.find((item) => item.key === filter.fieldKey);
  return field ? CUSTOM_FIELD_FILTER_OPERATORS[field.field_type] : ["contains", "eq"];
};
const customFieldForFilter = (filter: AssetCustomFilter) => customFilterFields.value.find((field) => field.key === filter.fieldKey);

function openAdvancedFilters() {
  advancedFilters.manufacturer = assetFilters.manufacturer;
  advancedFilters.model = assetFilters.model;
  advancedFilters.dataCenter = assetFilters.dataCenter;
  advancedFilters.warranty = assetFilters.warranty;
  draftCustomFilters.value = appliedCustomFilters.value.map((filter) => ({ ...filter }));
  showAdvancedFilters.value = true;
  if (!assetFilterCustomFieldSchema.value.length && !assetFilterCustomSchemaLoading.value) void retryAssetFilterCustomSchema();
}

function addCustomFilter() {
  if (draftCustomFilters.value.length >= MAX_DYNAMIC_ASSET_FILTERS) return;
  draftCustomFilters.value.push({ fieldKey: "", operator: "contains", value: "" });
}

function removeCustomFilter(index: number) {
  draftCustomFilters.value.splice(index, 1);
}

function updateCustomFilterField(filter: AssetCustomFilter) {
  const field = customFieldForFilter(filter);
  filter.operator = field ? defaultCustomFieldFilterOperator(field.field_type) : "contains";
  filter.value = "";
}

async function applyAdvancedFilters() {
  assetFilters.manufacturer = advancedFilters.manufacturer;
  assetFilters.model = advancedFilters.model.trim();
  assetFilters.dataCenter = advancedFilters.dataCenter;
  assetFilters.warranty = advancedFilters.warranty;
  await context.applyAssetCustomFilters(draftCustomFilters.value);
  showAdvancedFilters.value = false;
}

function clearAdvancedFilters() {
  advancedFilters.manufacturer = "";
  advancedFilters.model = "";
  advancedFilters.dataCenter = "";
  advancedFilters.warranty = "";
  draftCustomFilters.value = [];
}

const activeFilterChips = computed(() => {
  const chips: Array<{ key: string; label: string }> = [];
  if (assetSearch.value.trim()) chips.push({ key: "search", label: `${t("common.search")}：${assetSearch.value.trim()}` });
  if (assetFilters.status) chips.push({ key: "status", label: `${t("asset.status")}：${businessOptionLabel(ASSET_STATUS_OPTIONS, assetFilters.status)}` });
  if (assetFilters.deviceType) chips.push({ key: "deviceType", label: `${t("asset.deviceType")}：${activeDeviceTypes.value.find((item) => String(item.id) === assetFilters.deviceType)?.name || assetFilters.deviceType}` });
  if (assetFilters.tag.length) chips.push({ key: "tag", label: `${t("asset.tag")}：${activeTags.value.filter((item) => assetFilters.tag.includes(String(item.id))).map((item) => item.name).join(", ")}` });
  if (assetFilters.manufacturer) chips.push({ key: "manufacturer", label: `${t("asset.manufacturer")}：${activeManufacturers.value.find((item) => String(item.id) === assetFilters.manufacturer)?.name || assetFilters.manufacturer}` });
  if (assetFilters.model.trim()) chips.push({ key: "model", label: `${t("asset.model")}：${assetFilters.model.trim()}` });
  if (assetFilters.dataCenter) chips.push({ key: "dataCenter", label: `${t("location.dataCenter")}：${activeDataCenters.value.find((item) => String(item.id) === assetFilters.dataCenter)?.name || assetFilters.dataCenter}` });
  if (assetFilters.warranty) chips.push({ key: "warranty", label: `${t("asset.warranty")}：${t(`asset.${assetFilters.warranty}`)}` });
  appliedCustomFilters.value.forEach((filter, index) => {
    const field = customFieldForFilter(filter);
    chips.push({
      key: `custom:${index}`,
      label: `${field?.name || filter.fieldKey} ${t(`asset.operator.${filter.operator}`)}：${filter.value}`,
    });
  });
  return chips;
});

async function removeFilterChip(key: string) {
  if (key === "search") assetSearch.value = "";
  else if (key === "status") assetFilters.status = "";
  else if (key === "deviceType") assetFilters.deviceType = "";
  else if (key === "tag") assetFilters.tag = [];
  else if (key === "manufacturer") assetFilters.manufacturer = "";
  else if (key === "model") assetFilters.model = "";
  else if (key === "dataCenter") assetFilters.dataCenter = "";
  else if (key === "warranty") assetFilters.warranty = "";
  else if (key.startsWith("custom:")) {
    const index = Number(key.slice("custom:".length));
    await context.applyAssetCustomFilters(appliedCustomFilters.value.filter((_filter, filterIndex) => filterIndex !== index));
    return;
  }
  await searchLedger();
}

function clearAssetSelection() {
  clearSelectedAssets();
}

function openSelectedQrDialog() {
  if (!selectedQrAssets.value.length) return;
  qrDialogAssets.value = [...selectedQrAssets.value];
  showQrDialog.value = true;
}

async function openAllQrDialog() {
  const allAssets = await loadAllAssetsForLabels();
  if (!allAssets?.length) return;
  qrDialogAssets.value = allAssets;
  showQrDialog.value = true;
}
</script>

<template>
  <PageContainer class="infrix-page">
      <template #toolbar>
        <PageToolbar class="asset-ledger-toolbar">
          <template #search>
            <SearchField
              v-model="assetSearch"
              :placeholder="t('asset.searchPlaceholder')"
              :aria-label="t('asset.title')"
              @search="searchLedger"
            />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select
                v-model="assetFilters.status"
                clearable
                :placeholder="t('asset.status')"
                @change="searchLedger"
              >
                <el-option v-for="option in ASSET_STATUS_OPTIONS" :key="option.value" :label="businessOptionLabel(ASSET_STATUS_OPTIONS, option.value)" :value="option.value" />
              </el-select>
              <SearchableSelect
                v-model="assetFilters.deviceType"
                :request="context.request"
                endpoint="/device-types/"
                :map-option="mapLedgerDictionaryOption"
                :selected-option="selectedDeviceTypeOption"
                :base-query="{ is_active: true }"
                :placeholder="t('asset.deviceType')"
                :aria-label="t('asset.deviceType')"
                clearable
                @update:model-value="searchLedger"
              />
              <SearchableSelect
                v-model="assetFilters.tag"
                :request="context.request"
                endpoint="/tags/"
                :map-option="mapLedgerTagOption"
                :selected-options="selectedTagOptions"
                :base-query="{ is_active: true }"
                :placeholder="t('asset.tag')"
                :aria-label="t('asset.tag')"
                multiple
                clearable
                collapse-tags
                :max-collapse-tags="2"
                @update:model-value="searchLedger"
              />
              <ToolbarIconButton
                :icon="Filter"
                :label="t('asset.moreFilters')"
                :title="t('asset.moreFilters')"
                @click="openAdvancedFilters"
              />
            </div>
          </template>
          <template #actions>
            <div class="asset-ledger-action-group asset-ledger-action-group--view" role="group" :aria-label="t('asset.viewTools')">
                <el-popover placement="bottom" trigger="click">
                  <template #reference>
                    <el-button
                      class="page-toolbar-icon-action"
                      :icon="Operation"
                      :aria-label="t('asset.showColumns')"
                      :title="t('asset.showColumns')"
                    />
                  </template>
                  <div class="ep-column-list">
                    <el-button link type="primary" @click="resetAssetColumns">{{ t('asset.restoreColumns') }}</el-button>
                    <div class="asset-column-section">
                      <div class="asset-column-section__title">{{ t('asset.basicFields') }}</div>
                      <el-checkbox v-for="column in assetColumnOptions" :key="column.key" :model-value="visibleAssetColumns.includes(column.key)" :disabled="column.required" :title="column.required ? t('asset.coreFieldFixed') : undefined" @change="toggleAssetColumn(column.key)">{{ assetColumnLabel(column) }}<span v-if="column.required" class="asset-ledger-column-fixed">{{ t('asset.coreFieldFixed') }}</span></el-checkbox>
                    </div>
                    <div class="asset-column-section">
                      <div class="asset-column-section__title">{{ t('asset.extendedFields') }}</div>
                      <div v-if="assetListCustomSchemaLoading" class="asset-column-section__state">{{ t('asset.loadingExtendedColumns') }}</div>
                      <div v-else-if="assetListCustomSchemaError" class="asset-column-section__state asset-column-section__state--error">
                        <span>{{ t('asset.extendedColumnsLoadFailed') }}</span>
                        <el-button link type="primary" @click="retryAssetListCustomSchema">{{ t('common.retry') }}</el-button>
                      </div>
                      <template v-else>
                        <el-checkbox v-for="column in assetDynamicColumnOptions" :key="column.key" :model-value="visibleAssetColumns.includes(column.key)" :disabled="dynamicColumnDisabled(column.key)" :title="[column.scopeLabel, column.field?.help_text].filter(Boolean).join(' · ') || undefined" @change="toggleAssetColumn(column.key)">
                          <span>{{ column.label }}</span>
                          <span v-if="column.scopeLabel" class="asset-column-option-scope">（{{ column.scopeLabel }}）</span>
                        </el-checkbox>
                        <div v-if="!assetDynamicColumnOptions.length" class="asset-column-section__state">{{ t('asset.noExtendedColumns') }}</div>
                      </template>
                    </div>
                  </div>
                </el-popover>
                <ToolbarIconButton
                  v-if="can('assets.view') && assetCount"
                  :icon="Printer"
                  :label="t('asset.printFilteredLabels', { count: assetCount })"
                  :loading="assetLabelPrintLoading"
                  :disabled="assetLabelPrintLoading"
                  @click="openAllQrDialog"
                />
            </div>
            <span v-if="can('assets.manage') || can('assets.export')" class="asset-ledger-action-divider" aria-hidden="true" />
            <div v-if="can('assets.manage') || can('assets.export')" class="asset-ledger-action-group asset-ledger-action-group--data" role="group" :aria-label="t('asset.dataTools')">
              <ToolbarIconButton v-if="can('assets.manage')" :icon="Upload" :label="t('asset.importAssets')" @click="openImportDialog" />
              <ToolbarIconButton v-if="can('assets.export')" :icon="Download" :label="t('asset.exportData')" :loading="exportingAssets" :disabled="exportingAssets" @click="exportAssets" />
            </div>
          </template>
          <template #primary>
            <el-button v-if="can('assets.manage')" class="page-primary-action" type="primary" @click="openNewAssetModal">{{ t('asset.addAsset') }}</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <div v-if="selectedAssetIds.length" class="asset-selection-bar" role="region" :aria-label="t('asset.batchActions')">
          <div class="asset-selection-bar__summary">
            <strong>{{ t('common.selectedItems', { count: selectedAssetIds.length }) }}</strong>
            <span>{{ t('asset.currentPageSelection') }}</span>
          </div>
          <div class="asset-selection-bar__actions">
            <el-button v-if="can('assets.manage')" type="primary" plain :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving || selectedAssetIds.length > 100" @click="openBatchAssignment('assign')">{{ t('asset.batchAssignPerson') }}</el-button>
            <el-button v-if="can('assets.manage')" type="primary" plain :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving || selectedAssetIds.length > 100" @click="openBatchAssignment('transfer')">{{ t('asset.batchTransferPerson') }}</el-button>
            <el-button :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving || !selectedQrAssets.length" @click="openSelectedQrDialog">{{ t('asset.printLabels') }}</el-button>
            <el-button v-if="can('faults.manage') && selectedAssetIds.length === 1" :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving" @click="registerFaultFromSelection">{{ t('asset.registerFault') }}</el-button>
            <el-button v-if="can('assets.manage')" type="danger" plain :loading="assetBatchDeleteSaving" :disabled="assetBatchAssignmentSaving" @click="deleteSelectedAssets">{{ t('common.delete') }}</el-button>
            <el-button link :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving" @click="clearAssetSelection">{{ t('common.cancel') }}</el-button>
          </div>
        </div>
        <div v-if="activeFilterChips.length" class="asset-active-filters" aria-live="polite">
          <span class="asset-active-filters__label">{{ t('asset.activeFilters') }}</span>
          <el-tag v-for="chip in activeFilterChips" :key="chip.key" closable @close="removeFilterChip(chip.key)">{{ chip.label }}</el-tag>
          <el-button link type="primary" @click="resetAssetFilters">{{ t('common.clearFilters') }}</el-button>
        </div>
        <ResourceState :error="assetListError" @retry="searchLedger">
          <template #error="{ error }">
            <el-alert :title="t('common.dataLoadFailed')" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" @click="searchLedger">{{ t('common.retry') }}</el-button>
          </template>
          <PagedTable v-model:current-page="assetPage" v-model:page-size="assetPageSize" :total="assetCount" @update:current-page="changeAssetPage" @update:page-size="changeAssetPageSize">
          <el-table
            ref="assetTableRef"
            class="asset-ledger-table"
            v-loading="assetListLoading"
            :data="assets"
            :default-sort="assetTableDefaultSort"
            row-key="id"
            @selection-change="handleElementAssetSelection"
            @sort-change="changeAssetSort"
          >
            <template #empty>
              <el-empty :image-size="56" :description="hasAssetFilters ? t('asset.noMatchingAssets') : t('asset.noAssetsShort')">
                <el-button v-if="hasAssetFilters" link type="primary" @click="resetAssetFilters">{{ t('common.clearFilters') }}</el-button>
              </el-empty>
            </template>
            <el-table-column type="selection" width="48" />
            <el-table-column
              v-for="column in visibleAssetColumnOptions"
              :key="column.key"
              :label="assetColumnLabel(column)"
              :prop="column.key"
              :min-width="assetColumnMinWidth(column)"
              :fixed="column.key === 'name' || column.key === 'status' ? 'left' : undefined"
              :show-overflow-tooltip="['data_center', 'server_room', 'rack_code', 'u_range'].includes(column.key)"
              :sortable="assetSortFieldForColumn(column.key) ? 'custom' : false"
            >
              <template #header><span>{{ assetColumnLabel(column) }}</span></template>
              <template #default="{ row }">
                <template v-if="column.key === 'name'">
                  <el-button link type="primary" class="asset-identity-cell" :aria-label="t('asset.viewAsset') + ' ' + assetName(row)" @click.stop="openAssetDetail(row.id)">
                    <span class="asset-identity-cell__name">{{ assetName(row) }}</span>
                  </el-button>
                </template>
                <StatusTag v-else-if="column.key === 'status'" size="small" :tone="statusTone(row.status)" :label="String(assetValue(row, column.key))" />
                <DynamicFieldDisplay v-else-if="column.dynamic && column.field" class="asset-ledger-dynamic-cell" :field="column.field" :value="dynamicAssetValue(row, column.key)" />
                <span v-else-if="column.key === 'asset_no'" class="asset-number-cell">{{ assetValue(row, column.key) }}</span>
                <span v-else-if="column.key === 'u_range'" class="asset-number-cell">{{ assetValue(row, column.key) }}</span>
                <span v-else>{{ assetValue(row, column.key) }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="can('assets.manage')" :label="t('common.operation')" fixed="right" width="132">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" @click="openAssetEditor(row.id)" />
                  <TableIconButton :icon="CopyDocument" :label="t('asset.cloneAsset')" @click="openAssetClone(row.id)" />
                  <TableIconButton :icon="Delete" :label="t('asset.deleteAsset')" type="danger" @click="deleteAsset(row)" />
                </div>
              </template>
            </el-table-column>
          </el-table>
          </PagedTable>
        </ResourceState>
      </PageContent>
  </PageContainer>

  <el-drawer v-model="showAdvancedFilters" :title="t('asset.moreFilters')" size="420px" append-to-body>
    <div class="asset-filter-drawer">
      <el-form label-position="top">
        <el-form-item :label="t('asset.manufacturer')">
          <SearchableSelect
            v-model="advancedFilters.manufacturer"
            :request="context.request"
            endpoint="/manufacturers/"
            :map-option="mapLedgerDictionaryOption"
            :selected-option="selectedManufacturerOption"
            :base-query="{ is_active: true }"
            :placeholder="t('asset.manufacturer')"
            :aria-label="t('asset.manufacturer')"
            clearable
          />
        </el-form-item>
        <el-form-item :label="t('asset.model')">
          <el-input v-model="advancedFilters.model" clearable :placeholder="t('asset.modelFilterPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('location.dataCenter')">
          <SearchableSelect
            v-model="advancedFilters.dataCenter"
            :request="context.request"
            endpoint="/data-centers/"
            :map-option="mapLedgerDataCenterOption"
            :selected-option="selectedDataCenterOption"
            :base-query="{ is_active: true }"
            :placeholder="t('location.dataCenter')"
            :aria-label="t('location.dataCenter')"
            clearable
          />
        </el-form-item>
        <el-form-item :label="t('asset.warranty')">
          <el-select v-model="advancedFilters.warranty" clearable class="asset-filter-drawer__control">
            <el-option :label="t('asset.within_30_days')" value="within_30_days" />
            <el-option :label="t('asset.expired')" value="expired" />
          </el-select>
        </el-form-item>
      </el-form>

      <section class="asset-filter-drawer__custom">
        <div class="asset-filter-drawer__section-heading">
          <h3>{{ t('asset.customFilters') }}</h3>
          <el-button link type="primary" :disabled="draftCustomFilters.length >= MAX_DYNAMIC_ASSET_FILTERS || !customFilterFields.length" @click="addCustomFilter">
            <el-icon aria-hidden="true"><Plus /></el-icon>{{ t('asset.addFilter') }}
          </el-button>
        </div>
        <el-alert v-if="assetFilterCustomSchemaError" :title="assetFilterCustomSchemaError" type="error" show-icon :closable="false">
          <template #default><el-button link type="danger" :loading="assetFilterCustomSchemaLoading" @click="retryAssetFilterCustomSchema">{{ t('common.retry') }}</el-button></template>
        </el-alert>
        <el-skeleton v-else-if="assetFilterCustomSchemaLoading" :rows="3" animated />
        <el-empty v-else-if="!customFilterFields.length" :image-size="48" :description="t('asset.noFilterFields')" />
        <div v-else class="asset-filter-drawer__custom-list">
          <div v-for="(filter, index) in draftCustomFilters" :key="`${index}-${filter.fieldKey}`" class="asset-filter-drawer__custom-row">
            <el-select v-model="filter.fieldKey" filterable :placeholder="t('asset.customField')" @change="updateCustomFilterField(filter)">
              <el-option v-for="field in customFilterFields" :key="field.key" :label="field.name" :value="field.key" />
            </el-select>
            <el-select v-model="filter.operator" :aria-label="t('asset.filterOperator')">
              <el-option v-for="operator in customFilterOperators(filter)" :key="operator" :label="t(`asset.operator.${operator}`)" :value="operator" />
            </el-select>
            <el-input v-model="filter.value" :placeholder="t('asset.filterValue')" @keyup.enter="applyAdvancedFilters" />
            <el-button text type="danger" :aria-label="t('common.delete')" @click="removeCustomFilter(index)"><el-icon><Delete /></el-icon></el-button>
          </div>
        </div>
      </section>
    </div>
    <template #footer>
      <div class="asset-filter-drawer__footer">
        <el-button @click="clearAdvancedFilters">{{ t('asset.clearAdvancedFilters') }}</el-button>
        <el-button @click="showAdvancedFilters = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="applyAdvancedFilters">{{ t('asset.applyFilters') }}</el-button>
      </div>
    </template>
  </el-drawer>

  <ActionDialogShell
    v-model="showAssetBatchDeleteResult"
    :title="t('asset.deleteResult')"
    :description="t('asset.deleteResultDescription')"
    size="medium"
    :close-disabled="assetBatchDeleteSaving"
    @close="closeAssetBatchDeleteResult"
  >
    <section v-if="assetBatchDeleteResult" class="action-dialog__result">
      <el-alert
        type="warning"
        :closable="false"
        :title="t('asset.deleteSummary', { succeeded: assetBatchDeleteResult.succeeded, failed: assetBatchDeleteResult.failed })"
      />
      <el-table v-if="assetBatchDeleteFailures.length" :data="assetBatchDeleteFailures" table-layout="fixed" class="batch-result-table">
        <el-table-column prop="asset_no" :label="t('asset.code')" min-width="180" />
        <el-table-column prop="reason" :label="t('asset.failedReason')" min-width="300" show-overflow-tooltip />
      </el-table>
    </section>
    <template #footer>
      <el-button :disabled="assetBatchDeleteSaving" @click="closeAssetBatchDeleteResult">{{ t('common.close') }}</el-button>
    </template>
  </ActionDialogShell>

  <ActionDialogShell
    v-model="showBatchAssignmentDialog"
    :title="batchAssignmentTitle"
    :description="t('asset.batchAssignmentDescription', { count: selectedAssetIds.length })"
    size="medium"
    :pending="assetBatchAssignmentSaving"
    :close-disabled="assetBatchAssignmentSaving"
    @close="closeBatchAssignment"
  >
    <el-alert
      v-if="assetBatchAssignmentError"
      :title="t('asset.batchAssignmentFailed')"
      :description="assetBatchAssignmentError"
      type="error"
      :closable="false"
      show-icon
      class="action-dialog__alert"
    />
    <dl class="asset-batch-assignment__summary">
      <div>
        <dt>{{ t('asset.batchAssignmentSelected') }}</dt>
        <dd>
          <div class="asset-batch-assignment__asset-list">
            <el-tag v-for="asset in selectedAssetsForBatch" :key="asset.id" type="info">
              {{ asset.asset_no || `ID ${asset.id}` }}
            </el-tag>
          </div>
        </dd>
      </div>
    </dl>
    <el-form label-position="top" @submit.prevent="submitBatchAssignment">
      <el-form-item
        :label="t('asset.batchAssignmentTarget')"
        required
        :error="batchAssignmentFormError"
      >
        <SearchableSelect
          :model-value="batchAssignmentTargetPersonId"
          :request="context.request"
          endpoint="/people/"
          :map-option="mapPerson"
          :base-query="{ is_active: true }"
          :placeholder="t('asset.selectPerson')"
          :aria-label="t('asset.batchAssignmentTarget')"
          @update:model-value="handleBatchPersonUpdate"
        />
      </el-form-item>
      <el-form-item :label="t('asset.batchAssignmentReason')">
        <el-input
          v-model="batchAssignmentReason"
          type="textarea"
          :rows="3"
          maxlength="2000"
          show-word-limit
          :placeholder="t('common.reason')"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="assetBatchAssignmentSaving" @click="closeBatchAssignment">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="assetBatchAssignmentSaving" :disabled="!batchAssignmentCanSubmit" @click="submitBatchAssignment">
        {{ batchAssignmentSubmitLabel }}
      </el-button>
    </template>
  </ActionDialogShell>

  <ActionDialogShell
    v-model="showAssetBatchAssignmentResult"
    :title="t('asset.batchAssignmentResult')"
    :description="t('asset.batchAssignmentResultDescription')"
    size="medium"
    :close-disabled="assetBatchAssignmentSaving"
    @close="closeAssetBatchAssignmentResult"
  >
    <section v-if="assetBatchAssignmentResult" class="action-dialog__result">
      <el-alert
        :type="assetBatchAssignmentResult.failed ? 'warning' : 'success'"
        :closable="false"
        :title="t('asset.batchAssignmentSummary', { succeeded: assetBatchAssignmentResult.succeeded, failed: assetBatchAssignmentResult.failed })"
      />
      <el-table v-if="assetBatchAssignmentFailures.length" :data="assetBatchAssignmentFailures" table-layout="fixed" class="batch-result-table">
        <el-table-column prop="asset_no" :label="t('asset.batchAssignmentResultAsset')" min-width="180" />
        <el-table-column prop="reason" :label="t('asset.batchAssignmentResultReason')" min-width="300" show-overflow-tooltip />
      </el-table>
    </section>
    <template #footer>
      <el-button :disabled="assetBatchAssignmentSaving" @click="closeAssetBatchAssignmentResult">{{ t('common.close') }}</el-button>
    </template>
  </ActionDialogShell>
  <AssetQrDialog v-model="showQrDialog" :assets="qrDialogAssets" />
</template>
