<!-- UX Reference: standard data-list page. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowDown, Check, CopyDocument, Delete, Download, Edit, Operation, Printer, Upload } from "@element-plus/icons-vue";
import type { Asset, AssetBatchAssignmentAction, PersonOption } from "../types";
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
import type { AssetLedgerContext } from "../page-context";
import { ASSET_STATUS_OPTIONS, businessOptionLabel, isAssetStatus } from "../business-enums";
import {
  ASSET_SORT_FIELD_MAP,
  MAX_DYNAMIC_ASSET_COLUMNS,
} from "../composables/useAssets";

const props = defineProps<{ context: AssetLedgerContext }>();
const { t } = useI18n();
const context = props.context;
const {
  assetSearch,
  searchLedger,
  assetFilters,
  assetListLoading,
  assetListError,
  exportingAssets,
  resetAssetFilters,
  tags,
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
  people,
  peopleLoading,
  peopleError,
  loadResponsibilitySubjects,
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

function handleAssetBatchAction(command: string) {
  if (command === "assign" || command === "transfer") {
    openBatchAssignment(command);
    return;
  }
  if (command === "qr") {
    openSelectedQrDialog();
    return;
  }
  if (command === "fault") {
    registerFaultFromSelection();
    return;
  }
  if (command === "delete") deleteSelectedAssets();
}

function personLabel(person: PersonOption): string {
  return person.display_name || person.name;
}

function personMeta(person: PersonOption): string {
  return [person.employee_no, person.department_name]
    .filter((value) => Boolean(value && value.trim()))
    .join(" · ");
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
  void loadResponsibilitySubjects("");
}

function closeBatchAssignment() {
  if (assetBatchAssignmentSaving.value) return;
  showBatchAssignmentDialog.value = false;
  batchAssignmentFormError.value = "";
  context.assetBatchAssignmentError.value = "";
}

function searchBatchPeople(query: string) {
  void loadResponsibilitySubjects(query);
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
  asset_no: 145,
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
  name: "asset.name",
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

type AssetHeaderFilterKey = "device_type" | "status";
type AssetHeaderFilterOption = { label: string; value: string };

const assetHeaderDropdownOpen = ref<AssetHeaderFilterKey | null>(null);
const assetStatusHeaderOptions = computed<AssetHeaderFilterOption[]>(() => [
  { label: t("common.all"), value: "" },
  ...ASSET_STATUS_OPTIONS.map((option) => ({ label: businessOptionLabel(ASSET_STATUS_OPTIONS, option.value), value: option.value })),
]);
const assetDeviceTypeHeaderOptions = computed<AssetHeaderFilterOption[]>(() => [
  { label: t("common.all"), value: "" },
  ...activeDeviceTypes.value.map((item) => ({ label: item.name, value: String(item.id) })),
]);

function isAssetHeaderFilterKey(columnKey: string): columnKey is AssetHeaderFilterKey {
  return columnKey === "device_type" || columnKey === "status";
}

function assetHeaderFilterOptions(columnKey: string): readonly AssetHeaderFilterOption[] {
  if (columnKey === "device_type") return assetDeviceTypeHeaderOptions.value;
  if (columnKey === "status") return assetStatusHeaderOptions.value;
  return [];
}

function isAssetHeaderFilterSelected(columnKey: string, value: string): boolean {
  if (columnKey === "device_type") return assetFilters.deviceType === value;
  if (columnKey === "status") return assetFilters.status === value;
  return value === "";
}

function handleAssetHeaderDropdownVisible(columnKey: string, visible: boolean) {
  if (!isAssetHeaderFilterKey(columnKey)) return;
  if (visible) {
    assetHeaderDropdownOpen.value = columnKey;
  } else if (assetHeaderDropdownOpen.value === columnKey) {
    assetHeaderDropdownOpen.value = null;
  }
}

function handleAssetHeaderFilterCommand(columnKey: string, command: string) {
  if (columnKey === "status") {
    assetFilters.status = isAssetStatus(command) ? command : "";
  } else if (columnKey === "device_type") {
    assetFilters.deviceType = /^\d+$/.test(command) && Number(command) > 0 ? command : "";
  }
  return searchLedger();
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
                v-model="assetFilters.tag"
                multiple
                clearable
                filterable
                collapse-tags
                :max-collapse-tags="2"
                :loading="tagListLoading"
                :placeholder="t('asset.tag')"
                @change="searchLedger"
              >
                <el-option v-for="tag in activeTags" :key="tag.id" :label="tag.name" :value="String(tag.id)" />
              </el-select>
            </div>
          </template>
          <template #actions>
            <div v-if="selectedAssetIds.length" class="asset-batch-actions">
              <el-tag type="info">{{ t('common.selectedItems', { count: selectedAssetIds.length }) }}</el-tag>
              <el-dropdown
                class="asset-batch-actions__dropdown"
                trigger="click"
                placement="bottom-start"
                :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving"
                @command="handleAssetBatchAction"
              >
                <el-button
                  type="primary"
                  plain
                  class="asset-batch-actions__trigger"
                  :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving"
                  :aria-label="t('asset.batchActions')"
                >
                  {{ t('asset.batchActions') }}
                  <el-icon class="el-icon--right" aria-hidden="true"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu class="asset-batch-actions__menu">
                    <el-dropdown-item v-if="can('assets.manage')" command="assign">
                      {{ t('asset.batchAssignPerson') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="can('assets.manage')" command="transfer">
                      {{ t('asset.batchTransferPerson') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="qr" :disabled="!selectedQrAssets.length">
                      {{ t('asset.printLabels') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="can('faults.manage') && selectedAssetIds.length === 1" command="fault">
                      {{ t('asset.registerFault') }}
                    </el-dropdown-item>
                    <el-dropdown-item v-if="can('assets.manage')" command="delete" divided class="asset-batch-actions__danger">
                      {{ t('common.delete') }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button link :disabled="assetBatchDeleteSaving || assetBatchAssignmentSaving" @click="clearAssetSelection">{{ t('common.cancel') }}</el-button>
            </div>
            <template v-else>
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
          </template>
          <template #primary>
            <el-button v-if="can('assets.manage')" class="page-primary-action" type="primary" @click="openNewAssetModal">{{ t('asset.addAsset') }}</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
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
              :show-overflow-tooltip="['data_center', 'server_room', 'rack_code', 'u_range'].includes(column.key)"
              :sortable="assetSortFieldForColumn(column.key) ? 'custom' : false"
            >
              <template #header>
                <el-dropdown
                  v-if="isAssetHeaderFilterKey(column.key)"
                  class="asset-table-header-dropdown"
                  trigger="click"
                  placement="bottom-start"
                  @command="(command: string) => handleAssetHeaderFilterCommand(column.key, command)"
                  @visible-change="(visible: boolean) => handleAssetHeaderDropdownVisible(column.key, visible)"
                >
                  <el-button
                    text
                    class="asset-table-header-filter-trigger"
                    :aria-expanded="assetHeaderDropdownOpen === column.key"
                    :aria-label="t('common.search') + ' ' + assetColumnLabel(column)"
                    aria-haspopup="menu"
                  >
                    <span class="asset-table-header-filter-trigger__label">{{ assetColumnLabel(column) }}</span>
                    <el-icon aria-hidden="true">
                      <ArrowDown />
                    </el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-for="option in assetHeaderFilterOptions(column.key)" :key="option.value" :command="option.value">
                        <span class="asset-table-header-dropdown-option">
                          <el-icon class="asset-table-header-dropdown-option__check" :class="{ 'is-selected': isAssetHeaderFilterSelected(column.key, option.value) }" aria-hidden="true"><Check /></el-icon>
                          <span>{{ option.label }}</span>
                        </span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <span v-else>{{ assetColumnLabel(column) }}</span>
              </template>
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
    <el-alert
      v-if="peopleError"
      :title="t('asset.peopleLoadFailed')"
      :description="peopleError"
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
        <el-select
          v-model="batchAssignmentTargetPersonId"
          filterable
          remote
          reserve-keyword
          clearable
          :remote-method="searchBatchPeople"
          :loading="peopleLoading"
          :placeholder="t('asset.selectPerson')"
          :no-data-text="t('common.noData')"
          :no-match-text="t('common.noData')"
          :aria-label="t('asset.batchAssignmentTarget')"
          @change="batchAssignmentFormError = ''"
        >
          <el-option
            v-for="person in people"
            :key="person.id"
            :label="personLabel(person)"
            :value="String(person.id)"
          >
            <span>{{ personLabel(person) }}</span>
            <small v-if="personMeta(person)"> · {{ personMeta(person) }}</small>
          </el-option>
        </el-select>
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
