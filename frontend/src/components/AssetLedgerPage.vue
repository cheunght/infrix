<!-- UX Reference: standard data-list page. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { Delete, Download, Filter, MoreFilled, Operation, Upload } from "@element-plus/icons-vue";
import type { Asset, AssetCustomFilter, CustomFieldFilterOperator, CustomFieldSchema } from "../types";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import DynamicFilterValueEditor from "./fields/DynamicFilterValueEditor.vue";
import DynamicFieldDisplay from "./fields/DynamicFieldDisplay.vue";
import type { AssetLedgerContext } from "../types/page-context";
import {
  CUSTOM_FIELD_FILTER_OPERATORS,
  defaultCustomFieldFilterOperator,
  MAX_DYNAMIC_ASSET_COLUMNS,
  MAX_DYNAMIC_ASSET_FILTERS,
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
  manufacturers,
  deviceTypes,
  dataCenters,
  assetColumnOptions,
  assetDynamicColumnOptions,
  visibleAssetColumns,
  toggleAssetColumn,
  resetAssetColumns,
  visibleAssetColumnOptions,
  assetListCustomSchemaLoading,
  assetListCustomSchemaError,
  retryAssetListCustomSchema,
  draftCustomFilters,
  appliedCustomFilters,
  applyAssetCustomFilters,
  assetFilterCustomFieldSchema,
  assetFilterCustomSchemaLoading,
  assetFilterCustomSchemaError,
  retryAssetFilterCustomSchema,
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

const statusOptions = [
  { value: "in_stock", label: "在库" },
  { value: "in_use", label: "在用" },
  { value: "idle", label: "闲置" },
  { value: "repair", label: "维修中" },
  { value: "retired", label: "已报废" },
];

const activeTags = computed(() => tags.value.filter((item) => item.is_active));
const activeManufacturers = computed(() => manufacturers.value.filter((item) => item.is_active));
const activeDeviceTypes = computed(() => deviceTypes.value.filter((item) => item.is_active));
const activeDataCenters = computed(() => dataCenters.value.filter((item) => item.is_active !== false));
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
  asset_no: 220,
  asset_type: 120,
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

const operatorLabels: Record<CustomFieldFilterOperator, string> = {
  contains: "包含",
  eq: "等于",
  gte: "大于等于",
  lte: "小于等于",
};

function fieldScopeLabel(field: CustomFieldSchema): string {
  return field.device_type_name ? `设备类型：${field.device_type_name}` : "全局字段";
}

function fieldLabel(field: CustomFieldSchema): string {
  return `${field.name} · ${fieldScopeLabel(field)}`;
}

function fieldForDynamicFilter(condition: AssetCustomFilter): CustomFieldSchema | undefined {
  return assetFilterCustomFieldSchema.value.find((field) => field.key === condition.fieldKey);
}

function dynamicFilterFields(condition: AssetCustomFilter): CustomFieldSchema[] {
  const selectedKey = condition.fieldKey;
  const deviceType = assetFilters.deviceType;
  return assetFilterCustomFieldSchema.value.filter((field) =>
    !deviceType ||
    field.device_type === null ||
    String(field.device_type) === String(deviceType) ||
    field.key === selectedKey,
  );
}

function operatorOptions(condition: AssetCustomFilter): CustomFieldFilterOperator[] {
  const field = fieldForDynamicFilter(condition);
  return field ? CUSTOM_FIELD_FILTER_OPERATORS[field.field_type] : [];
}

function operatorLabel(operator: CustomFieldFilterOperator): string {
  return operatorLabels[operator];
}

function syncDraftCustomFilters() {
  draftCustomFilters.value = appliedCustomFilters.value.map((filter) => ({ ...filter }));
}

function addDynamicFilter() {
  if (draftCustomFilters.value.length >= MAX_DYNAMIC_ASSET_FILTERS) return;
  draftCustomFilters.value.push({ fieldKey: "", operator: "eq", value: "" });
}

function removeDynamicFilter(index: number) {
  draftCustomFilters.value.splice(index, 1);
}

function onDynamicFieldChange(condition: AssetCustomFilter) {
  const field = fieldForDynamicFilter(condition);
  condition.operator = field ? defaultCustomFieldFilterOperator(field.field_type) : "eq";
  condition.value = "";
}

function onDynamicOperatorChange(condition: AssetCustomFilter) {
  condition.value = "";
}

async function applyDynamicFilters() {
  const normalized: AssetCustomFilter[] = [];
  for (const [index, condition] of draftCustomFilters.value.entries()) {
    const rowNumber = index + 1;
    const field = fieldForDynamicFilter(condition);
    if (!field) {
      ElMessage.warning(`筛选条件无效：第 ${rowNumber} 条请选择字段`);
      return;
    }
    if (!CUSTOM_FIELD_FILTER_OPERATORS[field.field_type].includes(condition.operator)) {
      ElMessage.warning(`筛选条件无效：第 ${rowNumber} 条操作符不适用于该字段`);
      return;
    }
    const value = condition.value.trim();
    if (!value) {
      ElMessage.warning(`筛选条件无效：第 ${rowNumber} 条请输入筛选值`);
      return;
    }
    normalized.push({ fieldKey: field.key, operator: condition.operator, value });
  }
  await applyAssetCustomFilters(normalized);
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
              placeholder="搜索资产编号、名称、SN、IP 等"
              aria-label="搜索资产"
              @search="searchLedger"
            />
          </template>
          <template #primary-filter>
            <el-select
              v-model="assetFilters.tag"
              multiple
              clearable
              filterable
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="2"
              :loading="tagListLoading"
              placeholder="标签"
              @change="searchLedger"
            >
              <el-option v-for="tag in activeTags" :key="tag.id" :label="tag.name" :value="String(tag.id)" />
            </el-select>
          </template>
          <template #extra-filter>
            <div class="toolbar-extra-group">
            <el-popover
              placement="bottom-start"
              :width="680"
              trigger="click"
              popper-class="asset-ledger-filter-popover"
              @show="syncDraftCustomFilters"
            >
              <template #reference><el-button class="toolbar-extra-action asset-toolbar-more" :icon="Filter">更多筛选</el-button></template>
              <div class="asset-ledger-advanced-filters">
                <el-form label-position="top">
                  <el-form-item label="厂商">
                    <el-select v-model="assetFilters.manufacturer" clearable filterable placeholder="全部厂商" @change="searchLedger">
                      <el-option v-for="item in activeManufacturers" :key="item.id" :label="item.name" :value="String(item.id)" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="型号">
                    <el-input v-model="assetFilters.model" clearable placeholder="输入型号" @keyup.enter="searchLedger" @clear="searchLedger" />
                  </el-form-item>
                  <el-form-item label="数据中心">
                    <el-select v-model="assetFilters.dataCenter" clearable filterable placeholder="全部数据中心" @change="searchLedger">
                      <el-option v-for="item in activeDataCenters" :key="item.id" :label="item.name" :value="String(item.id)" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="维保状态">
                    <el-select v-model="assetFilters.warranty" clearable placeholder="全部维保状态" @change="searchLedger">
                      <el-option label="30 天内到期" value="within_30_days" />
                      <el-option label="已过期" value="expired" />
                    </el-select>
                  </el-form-item>
                </el-form>
                <el-divider />
                <section class="asset-ledger-dynamic-filter-section" aria-labelledby="asset-dynamic-filter-title">
                  <div class="asset-ledger-dynamic-filter-heading">
                    <span id="asset-dynamic-filter-title">动态字段筛选</span>
                    <span class="asset-ledger-dynamic-filter-note">条件之间为 AND，最多 8 条</span>
                  </div>
                  <div v-if="assetFilterCustomSchemaLoading" class="asset-column-section__state">正在加载可筛选字段…</div>
                  <div v-else-if="assetFilterCustomSchemaError" class="asset-column-section__state asset-column-section__state--error">
                    <span>{{ assetFilterCustomSchemaError }}</span>
                    <el-button link type="primary" @click="retryAssetFilterCustomSchema">重试</el-button>
                  </div>
                  <div v-else-if="!assetFilterCustomFieldSchema.length" class="asset-column-section__state">暂无可筛选字段</div>
                  <template v-else>
                    <div v-for="(condition, index) in draftCustomFilters" :key="`${index}-${condition.fieldKey}`" class="asset-ledger-dynamic-filter-row">
                      <el-select
                        v-model="condition.fieldKey"
                        filterable
                        clearable
                        placeholder="选择字段"
                        @change="onDynamicFieldChange(condition)"
                      >
                        <el-option
                          v-for="field in dynamicFilterFields(condition)"
                          :key="field.key"
                          :label="fieldLabel(field)"
                          :value="field.key"
                        />
                      </el-select>
                      <el-select
                        v-model="condition.operator"
                        :disabled="!fieldForDynamicFilter(condition)"
                        placeholder="操作符"
                        @change="onDynamicOperatorChange(condition)"
                      >
                        <el-option
                          v-for="operator in operatorOptions(condition)"
                          :key="operator"
                          :label="operatorLabel(operator)"
                          :value="operator"
                        />
                      </el-select>
                      <DynamicFilterValueEditor
                        v-if="fieldForDynamicFilter(condition)"
                        :field="fieldForDynamicFilter(condition)!"
                        v-model="condition.value"
                      />
                      <el-input v-else disabled placeholder="先选择字段" />
                      <el-button
                        text
                        type="danger"
                        :icon="Delete"
                        aria-label="删除筛选条件"
                        title="删除筛选条件"
                        @click="removeDynamicFilter(index)"
                      />
                    </div>
                    <div class="asset-ledger-dynamic-filter-actions">
                      <el-button link type="primary" :disabled="draftCustomFilters.length >= MAX_DYNAMIC_ASSET_FILTERS" @click="addDynamicFilter">
                        添加条件
                      </el-button>
                      <div class="asset-ledger-dynamic-filter-buttons">
                        <el-button @click="syncDraftCustomFilters">取消</el-button>
                        <el-button type="primary" @click="applyDynamicFilters">应用</el-button>
                      </div>
                    </div>
                  </template>
                </section>
                <el-divider />
                <div class="asset-toolbar-popover-actions">
                  <el-button class="toolbar-secondary-action" @click="resetAssetFilters">重置</el-button>
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
                </div>
              </div>
            </el-popover>
          </div>
          </template>
          <template #actions>
            <el-button v-if="can('assets.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingAssets" :disabled="exportingAssets" @click="exportAssets">
              导出数据
            </el-button>
            <el-button v-if="can('assets.manage')" class="page-primary-action" type="primary" @click="openNewAssetModal">新增资产</el-button>
          </template>
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
            <el-table-column v-for="column in visibleAssetColumnOptions" :key="column.key" :label="column.label" :min-width="assetColumnMinWidth(column)" show-overflow-tooltip>
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
                <DynamicFieldDisplay v-else-if="column.dynamic && column.field" class="asset-ledger-dynamic-cell" :field="column.field" :value="dynamicAssetValue(row, column.key)" />
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
</template>
