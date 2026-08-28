<!-- UX Reference: standard data-list page. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowDown, ArrowUp, Check, Download, MoreFilled, Operation, Upload } from "@element-plus/icons-vue";
import type { Asset } from "../types";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import { statusTone } from "../status";
import ResourceState from "./ResourceState.vue";
import DynamicFieldDisplay from "./fields/DynamicFieldDisplay.vue";
import type { AssetLedgerContext } from "../types/page-context";
import { ASSET_STATUS_OPTIONS, isAssetStatus } from "../business-enums";
import {
  MAX_DYNAMIC_ASSET_COLUMNS,
} from "../composables/useAssets";

const props = defineProps<{ context: AssetLedgerContext }>();
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
  deleteSelectedAssets,
  exportAssets,
  registerFaultFromSelection,
  downloadImportTemplate,
  openImportDialog,
  assets,
  handleElementAssetSelection,
  openAssetDetail,
  assetValue,
  openAssetClone,
  openAssetEditor,
  deleteAsset,
  assetPage,
  assetPageSize,
  assetCount,
  changeAssetPage,
  changeAssetPageSize,
} = context;

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
  rack_code: 200,
  manufacturer_model: 150,
  maintenance_expiry_date: 130,
};

function assetColumnMinWidth(column: { key: string; width?: number }): number {
  return column.width || assetColumnMinWidths[column.key] || 120;
}

function dynamicAssetValue(asset: Asset, columnKey: string): unknown {
  return asset.custom_values?.[columnKey.slice("custom:".length)];
}

function dynamicColumnDisabled(columnKey: string): boolean {
  return !visibleAssetColumns.value.includes(columnKey) &&
    visibleAssetColumns.value.filter((key) => key.startsWith("custom:")).length >= MAX_DYNAMIC_ASSET_COLUMNS;
}

function assetLocation(asset: Asset) {
  const rack = asset.rack_allocation;
  const dataCenter = asset.data_center || rack?.data_center || asset.asset_data_center_name || "";
  const room = asset.server_room || rack?.server_room || "";
  const rackCode = rack?.rack_code || asset.rack_code || "";
  const uRange = asset.u_range || (rack ? `U${rack.start_u}–U${rack.end_u}` : "");
  const fullParts = [dataCenter, room, rackCode, uRange].filter(Boolean);
  if (!fullParts.length) {
    return { primary: "—", secondary: "" };
  }
  const primary = (room ? [room, rackCode, uRange] : [dataCenter, rackCode, uRange])
    .filter(Boolean)
    .join(" · ");
  return {
    primary,
    secondary: "",
  };
}

function assetName(asset: Asset): string {
  const name = assetValue(asset, "name").trim();
  return name && name !== "—" ? name : asset.asset_no || "未命名资产";
}

function handleAssetRowAction(command: string, asset: Asset) {
  if (command === "clone") return openAssetClone(asset.id);
  if (command === "delete") return deleteAsset(asset);
}

type AssetHeaderFilterKey = "device_type" | "status";
type AssetHeaderFilterOption = { label: string; value: string };

const assetHeaderDropdownOpen = ref<AssetHeaderFilterKey | null>(null);
const assetStatusHeaderOptions: AssetHeaderFilterOption[] = [
  { label: "全部", value: "" },
  ...ASSET_STATUS_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
];
const assetDeviceTypeHeaderOptions = computed<AssetHeaderFilterOption[]>(() => [
  { label: "全部", value: "" },
  ...activeDeviceTypes.value.map((item) => ({ label: item.name, value: String(item.id) })),
]);

function isAssetHeaderFilterKey(columnKey: string): columnKey is AssetHeaderFilterKey {
  return columnKey === "device_type" || columnKey === "status";
}

function assetHeaderFilterOptions(columnKey: string): readonly AssetHeaderFilterOption[] {
  if (columnKey === "device_type") return assetDeviceTypeHeaderOptions.value;
  if (columnKey === "status") return assetStatusHeaderOptions;
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

function handleToolbarAction(command: string) {
  if (command === "template") return downloadImportTemplate();
  if (command === "fault") return registerFaultFromSelection();
  if (command === "delete") return deleteSelectedAssets();
}
</script>

<template>
  <PageContainer class="itam-page">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField
              v-model="assetSearch"
              placeholder="搜索资产编号、名称、序列号、型号或 IP"
              aria-label="搜索资产"
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
                placeholder="标签"
                @change="searchLedger"
              >
                <el-option v-for="tag in activeTags" :key="tag.id" :label="tag.name" :value="String(tag.id)" />
              </el-select>
            </div>
          </template>
          <template #actions>
            <div class="asset-toolbar-table-actions">
              <el-popover placement="bottom" :width="300" trigger="click">
                <template #reference><el-button :icon="Operation">显示列</el-button></template>
                <div class="ep-column-list">
                  <div class="asset-column-section">
                    <div class="asset-column-section__title">基础字段</div>
                    <el-checkbox v-for="column in assetColumnOptions" :key="column.key" :model-value="visibleAssetColumns.includes(column.key)" :disabled="column.required" :title="column.required ? '核心字段不可隐藏' : undefined" @change="toggleAssetColumn(column.key)">{{ column.label }}<span v-if="column.required" class="asset-ledger-column-fixed">（固定）</span></el-checkbox>
                  </div>
                  <div class="asset-column-section">
                    <div class="asset-column-section__title">扩展字段</div>
                    <div v-if="assetListCustomSchemaLoading" class="asset-column-section__state">正在加载扩展列配置…</div>
                    <div v-else-if="assetListCustomSchemaError" class="asset-column-section__state asset-column-section__state--error">
                      <span>扩展列配置加载失败</span>
                      <el-button link type="primary" @click="retryAssetListCustomSchema">重试</el-button>
                    </div>
                    <template v-else>
                      <el-checkbox v-for="column in assetDynamicColumnOptions" :key="column.key" :model-value="visibleAssetColumns.includes(column.key)" :disabled="dynamicColumnDisabled(column.key)" :title="[column.scopeLabel, column.field?.help_text].filter(Boolean).join(' · ') || undefined" @change="toggleAssetColumn(column.key)">
                        <span>{{ column.label }}</span>
                        <span v-if="column.scopeLabel" class="asset-column-option-scope">（{{ column.scopeLabel }}）</span>
                      </el-checkbox>
                      <div v-if="!assetDynamicColumnOptions.length" class="asset-column-section__state">暂无可配置的扩展列</div>
                    </template>
                  </div>
                  <el-button link type="primary" @click="resetAssetColumns">恢复默认</el-button>
                </div>
              </el-popover>
              <el-button v-if="can('assets.manage')" :icon="Upload" @click="openImportDialog">导入资产</el-button>
              <el-dropdown v-if="can('assets.manage') || can('faults.manage')" trigger="click" @command="handleToolbarAction">
                <el-button :icon="MoreFilled">更多操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="can('assets.manage')" command="template">导入模板</el-dropdown-item>
                    <el-dropdown-item v-if="can('faults.manage')" command="fault" :disabled="selectedAssetIds.length !== 1">登记故障</el-dropdown-item>
                    <el-dropdown-item v-if="can('assets.manage')" command="delete" :disabled="!selectedAssetIds.length" divided>批量删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
            <el-button v-if="can('assets.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingAssets" :disabled="exportingAssets" @click="exportAssets">
              导出数据
            </el-button>
          </template>
          <template #primary>
            <el-button v-if="can('assets.manage')" class="page-primary-action" type="primary" @click="openNewAssetModal">新增资产</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <ResourceState :error="assetListError" @retry="searchLedger">
          <template #error="{ error }">
            <el-alert title="资产数据加载失败" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" @click="searchLedger">重新加载</el-button>
          </template>
          <PagedTable v-model:current-page="assetPage" v-model:page-size="assetPageSize" :total="assetCount" @update:current-page="changeAssetPage" @update:page-size="changeAssetPageSize">
          <el-table class="asset-ledger-table" v-loading="assetListLoading" :data="assets" row-key="id" @selection-change="handleElementAssetSelection">
            <template #empty>
              <el-empty :image-size="56" :description="hasAssetFilters ? '没有符合当前筛选条件的资产' : '暂无资产'">
                <el-button v-if="hasAssetFilters" link type="primary" @click="resetAssetFilters">清除筛选</el-button>
              </el-empty>
            </template>
            <el-table-column type="selection" width="48" />
            <el-table-column
              v-for="column in visibleAssetColumnOptions"
              :key="column.key"
              :label="column.label"
              :min-width="assetColumnMinWidth(column)"
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
                    link
                    class="asset-table-header-dropdown-trigger"
                    native-type="button"
                    :aria-expanded="assetHeaderDropdownOpen === column.key"
                    :aria-label="`按${column.label}筛选`"
                  >
                    <span class="asset-table-header-dropdown-trigger__label">{{ column.label }}</span>
                    <el-icon aria-hidden="true">
                      <ArrowUp v-if="assetHeaderDropdownOpen === column.key" />
                      <ArrowDown v-else />
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
                <span v-else>{{ column.label }}</span>
              </template>
              <template #default="{ row }">
                <template v-if="column.key === 'name'">
                  <el-button link type="primary" class="asset-identity-cell" :aria-label="`查看资产 ${assetName(row)}`" @click.stop="openAssetDetail(row.id)">
                    <span class="asset-identity-cell__name">{{ assetName(row) }}</span>
                  </el-button>
                </template>
                <StatusTag v-else-if="column.key === 'status'" size="small" :tone="statusTone(row.status)" :label="String(assetValue(row, column.key))" />
                <template v-else-if="column.key === 'rack_code'">
                  <span class="asset-location-cell">{{ assetLocation(row).primary }}</span>
                </template>
                <DynamicFieldDisplay v-else-if="column.dynamic && column.field" class="asset-ledger-dynamic-cell" :field="column.field" :value="dynamicAssetValue(row, column.key)" />
                <span v-else-if="column.key === 'asset_no'" class="asset-number-cell">{{ assetValue(row, column.key) }}</span>
                <span v-else>{{ assetValue(row, column.key) }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="can('assets.manage')" label="操作" fixed="right" width="132">
              <template #default="{ row }">
                <div class="asset-row-actions">
                  <el-button link type="primary" @click.stop="openAssetEditor(row.id)">编辑</el-button>
                  <el-dropdown trigger="click" @command="(command: string) => handleAssetRowAction(command, row)">
                    <el-button link :icon="MoreFilled" aria-label="更多操作" @click.stop />
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-if="can('assets.manage')" command="clone">克隆资产</el-dropdown-item>
                        <el-dropdown-item v-if="can('assets.manage')" command="delete" divided class="asset-row-danger">删除资产</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>
            </el-table-column>
          </el-table>
          </PagedTable>
        </ResourceState>
      </PageContent>
  </PageContainer>
</template>
