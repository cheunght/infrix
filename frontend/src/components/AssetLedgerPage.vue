<!-- UX Reference: standard data-list page. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed } from "vue";
import { Delete, Download, Filter, MoreFilled, Operation, Plus, Upload, Warning } from "@element-plus/icons-vue";
import type { Asset } from "../types";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import type { AssetLedgerContext } from "../types/page-context";

const props = defineProps<{ context: AssetLedgerContext }>();
const context = props.context;
const {
  assetSearch,
  searchLedger,
  assetFilters,
  assetListLoading,
  assetListError,
  resetAssetFilters,
  tags,
  brands,
  deviceTypes,
  assetColumnOptions,
  visibleAssetColumns,
  toggleAssetColumn,
  resetAssetColumns,
  visibleAssetColumnOptions,
  can,
  openNewAssetModal,
  selectedAssetIds,
  deleteSelectedAssets,
  exportAssets,
  registerFaultFromSelection,
  downloadImportTemplate,
  onElementUploadChange,
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

const statusOptions = [
  { value: "in_stock", label: "在库" },
  { value: "in_use", label: "在用" },
  { value: "idle", label: "闲置" },
  { value: "repair", label: "维修中" },
  { value: "retired", label: "已报废" },
];

const activeTags = computed(() => tags.value.filter((item) => item.is_active));
const activeBrands = computed(() => brands.value.filter((item) => item.is_active));
const activeDeviceTypes = computed(() => deviceTypes.value.filter((item) => item.is_active));
const hasAssetFilters = computed(() => Boolean(
  assetSearch.value.trim() ||
  assetFilters.status ||
  assetFilters.deviceType ||
  assetFilters.tag ||
  assetFilters.brand ||
  assetFilters.model.trim(),
));
const exportLabel = computed(() =>
  selectedAssetIds.value.length ? `导出选中（${selectedAssetIds.value.length}）` : "导出全部",
);

const assetColumnMinWidths: Record<string, number> = {
  asset_no: 220,
  asset_type: 120,
  status: 105,
  rack_code: 200,
  brand_model: 150,
  maintenance_expiry_date: 130,
};

function assetColumnMinWidth(key: string): number {
  return assetColumnMinWidths[key] || 120;
}

function assetLocation(asset: Asset) {
  const rack = asset.rack_allocation;
  const dataCenter = asset.data_center || rack?.data_center || asset.asset_data_center_name || "";
  const room = asset.server_room || rack?.server_room || "";
  const rackCode = rack?.rack_code || asset.rack_code || "";
  const uRange = asset.u_range || (rack ? `U${rack.start_u}–U${rack.end_u}` : "");
  const primaryParts = [dataCenter, room].filter(Boolean);
  const secondaryParts = [rackCode, uRange].filter(Boolean);
  if (!primaryParts.length && !secondaryParts.length) {
    return { primary: "—", secondary: "", full: "—" };
  }
  const primary = primaryParts.join(" · ") || secondaryParts.join(" · ");
  const secondary = primaryParts.length ? secondaryParts.join(" · ") : "";
  return {
    primary,
    secondary,
    full: [primary, secondary].filter(Boolean).join(" / "),
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

function updateAssetHeaderFilter(filter: "status" | "deviceType", value: string) {
  assetFilters[filter] = value;
  return searchLedger();
}

function handleToolbarAction(command: string) {
  if (command === "template") return downloadImportTemplate();
  if (command === "fault") return registerFaultFromSelection();
  if (command === "delete") return deleteSelectedAssets();
}
</script>

<template>
  <div class="itam-page">
    <PageContainer>
      <template #toolbar>
        <PageToolbar class="asset-ledger-toolbar">
          <div class="asset-toolbar-filters">
            <SearchField
              class="asset-toolbar-search"
              v-model="assetSearch"
              placeholder="搜索资产编号、名称、SN、IP 等"
              aria-label="搜索资产"
              @search="searchLedger"
            />
            <el-select
              class="asset-toolbar-filter"
              v-model="assetFilters.tag"
              clearable
              filterable
              placeholder="标签"
              @change="searchLedger"
            >
              <el-option v-for="tag in activeTags" :key="tag.id" :label="tag.name" :value="tag.name" />
            </el-select>
            <el-popover placement="bottom-start" :width="280" trigger="click">
              <template #reference><el-button class="asset-toolbar-more" :icon="Filter">更多筛选</el-button></template>
              <div class="asset-ledger-advanced-filters">
                <el-form label-position="top">
                  <el-form-item label="品牌">
                    <el-select v-model="assetFilters.brand" clearable filterable placeholder="全部品牌" @change="searchLedger">
                      <el-option v-for="item in activeBrands" :key="item.id" :label="item.name" :value="String(item.id)" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="型号">
                    <el-input v-model="assetFilters.model" clearable placeholder="输入型号" @keyup.enter="searchLedger" @clear="searchLedger" />
                  </el-form-item>
                </el-form>
              </div>
            </el-popover>
          </div>
          <div class="asset-toolbar-actions">
            <el-button v-if="can('assets.manage')" type="primary" :icon="Plus" @click="openNewAssetModal">新增资产</el-button>
            <el-button @click="resetAssetFilters">重置</el-button>
            <div class="asset-toolbar-table-actions">
              <el-popover placement="bottom" :width="240" trigger="click">
                <template #reference><el-button :icon="Operation">显示列</el-button></template>
                <div class="ep-column-list">
                  <el-checkbox v-for="column in assetColumnOptions" :key="column.key" :model-value="visibleAssetColumns.includes(column.key)" :disabled="column.required" :title="column.required ? '核心字段不可隐藏' : undefined" @change="toggleAssetColumn(column.key)">{{ column.label }}<span v-if="column.required" class="asset-ledger-column-fixed">（固定）</span></el-checkbox>
                  <el-button link type="primary" @click="resetAssetColumns">恢复默认</el-button>
                </div>
              </el-popover>
              <el-button v-if="can('assets.export')" :icon="Download" @click="exportAssets">{{ exportLabel }}</el-button>
              <el-upload v-if="can('assets.import')" accept=".csv,text/csv" :auto-upload="false" :show-file-list="false" :on-change="onElementUploadChange"><el-button :icon="Upload">导入资产</el-button></el-upload>
              <el-dropdown v-if="can('assets.import') || can('faults.manage') || can('assets.manage')" trigger="click" @command="handleToolbarAction">
                <el-button :icon="MoreFilled">更多操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="can('assets.import')" command="template">导入模板</el-dropdown-item>
                    <el-dropdown-item v-if="can('faults.manage')" command="fault" :disabled="selectedAssetIds.length !== 1">登记故障</el-dropdown-item>
                    <el-dropdown-item v-if="can('assets.manage')" command="delete" :disabled="!selectedAssetIds.length" divided>批量删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </PageToolbar>
      </template>
      <PageContent surface>
        <div v-if="assetListError" class="asset-ledger-error" role="alert">
          <div class="asset-ledger-error__copy">
            <strong>资产数据加载失败</strong>
            <span>{{ assetListError }}</span>
          </div>
          <el-button type="primary" plain @click="searchLedger">重新加载</el-button>
        </div>
        <PagedTable v-else v-model:current-page="assetPage" v-model:page-size="assetPageSize" :total="assetCount" :loading="assetListLoading" @update:current-page="changeAssetPage" @update:page-size="changeAssetPageSize">
          <el-table class="asset-ledger-table" :data="assets" row-key="id" @selection-change="handleElementAssetSelection" @row-click="(row: Asset) => openAssetDetail(row.id)">
            <template #empty>
              <div class="asset-ledger-empty">
                <strong>{{ hasAssetFilters ? "没有符合当前筛选条件的资产" : "暂无资产" }}</strong>
                <el-button v-if="hasAssetFilters" link type="primary" @click="resetAssetFilters">清除筛选</el-button>
              </div>
            </template>
            <el-table-column type="selection" width="48" />
            <el-table-column v-for="column in visibleAssetColumnOptions" :key="column.key" :label="column.label" :min-width="assetColumnMinWidth(column.key)" show-overflow-tooltip>
              <template #header>
                <div v-if="column.key === 'status'" class="asset-table-header-filter">
                  <span class="asset-table-header-filter__label">{{ column.label }}</span>
                  <el-popover placement="bottom-start" :width="180" trigger="click">
                    <template #reference>
                      <el-button
                        text
                        class="asset-table-header-filter__trigger"
                        :class="{ 'is-active': Boolean(assetFilters.status) }"
                        :icon="Filter"
                        aria-label="按状态筛选"
                        title="按状态筛选"
                      />
                    </template>
                    <el-select class="asset-table-filter-select" v-model="assetFilters.status" clearable placeholder="全部状态" @change="updateAssetHeaderFilter('status', $event)">
                      <el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" />
                    </el-select>
                  </el-popover>
                </div>
                <div v-else-if="column.key === 'asset_type'" class="asset-table-header-filter">
                  <span class="asset-table-header-filter__label">{{ column.label }}</span>
                  <el-popover placement="bottom-start" :width="220" trigger="click">
                    <template #reference>
                      <el-button
                        text
                        class="asset-table-header-filter__trigger"
                        :class="{ 'is-active': Boolean(assetFilters.deviceType) }"
                        :icon="Filter"
                        aria-label="按设备类型筛选"
                        title="按设备类型筛选"
                      />
                    </template>
                    <el-select class="asset-table-filter-select" v-model="assetFilters.deviceType" clearable filterable placeholder="全部设备类型" @change="updateAssetHeaderFilter('deviceType', $event)">
                      <el-option v-for="item in activeDeviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
                    </el-select>
                  </el-popover>
                </div>
                <span v-else>{{ column.label }}</span>
              </template>
              <template #default="{ row }">
                <el-tooltip v-if="column.key === 'asset_no'" :content="[assetName(row), row.asset_no || '—'].join(' / ')" placement="top">
                  <button type="button" class="asset-identity-cell" :aria-label="`查看资产 ${row.asset_no}`" @click.stop="openAssetDetail(row.id)">
                    <span class="asset-identity-cell__name">{{ assetName(row) }}</span>
                    <span class="asset-identity-cell__number">{{ row.asset_no || "—" }}</span>
                  </button>
                </el-tooltip>
                <StatusTag v-else-if="column.key === 'status'" :status="row.status" :label="String(assetValue(row, column.key))" />
                <el-tooltip v-else-if="column.key === 'rack_code'" :content="assetLocation(row).full" placement="top">
                  <span class="asset-location-cell">
                    <span class="asset-location-cell__primary">{{ assetLocation(row).primary }}</span>
                    <span class="asset-location-cell__secondary">{{ assetLocation(row).secondary }}</span>
                  </span>
                </el-tooltip>
                <span v-else>{{ assetValue(row, column.key) }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="can('assets.manage')" label="操作" fixed="right" width="132">
              <template #default="{ row }">
                <div class="asset-row-actions">
                  <el-button link type="primary" @click.stop="openAssetEditor(row.id)">编辑</el-button>
                  <el-dropdown trigger="click" @command="(command: string) => handleAssetRowAction(command, row)">
                    <el-button text :icon="MoreFilled" aria-label="更多操作" title="更多操作" @click.stop />
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
      </PageContent>
    </PageContainer>
  </div>
</template>
