<!-- UX Reference: standard data-list page. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowDown, Check, CopyDocument, Delete, Download, Edit, Grid, Operation, Upload } from "@element-plus/icons-vue";
import type { Asset } from "../types";
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
  closeAssetBatchDeleteResult,
  deleteSelectedAssets,
  exportAssets,
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

const assetTableRef = ref<{ clearSelection: () => void } | null>(null);
const showQrDialog = ref(false);

const selectedQrAssets = computed(() => assets.value.filter((asset) => selectedAssetIds.value.includes(asset.id)));

const assetTableDefaultSort = computed(() => assetSortField.value && assetSortOrder.value
  ? { prop: assetSortField.value, order: assetSortOrder.value }
  : { prop: "", order: "" });

const assetBatchDeleteFailures = computed(() =>
  (assetBatchDeleteResult.value?.results || []).filter((result) => !result.success),
);

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
  showQrDialog.value = true;
}
</script>

<template>
  <PageContainer class="infrix-page">
      <template #toolbar>
        <PageToolbar>
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
              <el-button :icon="Grid" :disabled="!selectedQrAssets.length" @click="openSelectedQrDialog">
                {{ t('asset.generateQr') }}
              </el-button>
              <el-button v-if="can('faults.manage') && selectedAssetIds.length === 1" @click="registerFaultFromSelection">
                {{ t('asset.registerFault') }}
              </el-button>
              <el-button
                v-if="can('assets.manage')"
                type="danger"
                :loading="assetBatchDeleteSaving"
                :disabled="assetBatchDeleteSaving"
                @click="deleteSelectedAssets"
              >
                {{ t('common.delete') }}
              </el-button>
              <el-button link :disabled="assetBatchDeleteSaving" @click="clearAssetSelection">{{ t('common.cancel') }}</el-button>
            </div>
            <el-popover placement="bottom" :width="300" trigger="click">
              <template #reference><el-button :icon="Operation">{{ t('asset.showColumns') }}</el-button></template>
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
            <el-button v-if="can('assets.manage')" :icon="Upload" @click="openImportDialog">{{ t('asset.importAssets') }}</el-button>
            <el-button v-if="can('assets.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingAssets" :disabled="exportingAssets" @click="exportAssets">
              {{ t('asset.exportData') }}
            </el-button>
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
  <AssetQrDialog v-model="showQrDialog" :assets="selectedQrAssets" />
</template>
