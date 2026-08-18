<script setup lang="ts">
import { computed } from "vue";
import { CopyDocument, Delete, Download, Edit, Operation, Plus, Upload, Warning } from "@element-plus/icons-vue";
import type { Asset } from "../types";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";

const props = defineProps<{ context: Record<string, any> }>();
const {
  loading,
  assetSearch,
  searchLedger,
  assetTagFilter,
  assetCustomFilterField,
  assetCustomFilterValue,
  customFields,
  tags,
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
} = props.context;
function selectCustomField() {
  assetCustomFilterValue.value = "";
  searchLedger();
}
const selectedCustomField = computed(() => customFields.value.find((field: any) => field.key === assetCustomFilterField.value));
</script>

<template>
  <div class="itam-page ledger-page">
          <el-card shadow="never">
          <div class="ep-toolbar ep-ledger-toolbar">
            <div class="ep-ledger-filters">
              <SearchField
                class="itam-filter-search"
                v-model="assetSearch"
                placeholder="搜索资产编号、名称、IP、机柜、供应商等"
                aria-label="搜索资产"
                @search="searchLedger"
              />
              <el-select class="itam-filter-select" v-model="assetTagFilter" clearable filterable placeholder="标签" @change="searchLedger"><el-option v-for="tag in tags.filter((item: any) => item.is_active)" :key="tag.id" :label="tag.name" :value="tag.name" /></el-select>
              <el-select class="itam-filter-select" v-model="assetCustomFilterField" clearable filterable placeholder="自定义字段" @change="selectCustomField"><el-option v-for="field in customFields.filter((item: any) => item.is_active)" :key="field.id" :label="field.name" :value="field.key" /></el-select>
              <el-select class="itam-filter-select" v-if="selectedCustomField && ['select','multiselect','boolean'].includes(selectedCustomField.field_type)" v-model="assetCustomFilterValue" clearable placeholder="字段值" @change="searchLedger"><el-option v-if="selectedCustomField.field_type === 'boolean'" label="是" value="true" /><el-option v-if="selectedCustomField.field_type === 'boolean'" label="否" value="false" /><el-option v-for="option in (selectedCustomField.options || []).filter((item: any) => item.is_active)" v-else :key="option.id" :label="option.label" :value="option.value" /></el-select>
              <el-input class="itam-filter-search-value" v-else-if="assetCustomFilterField" v-model="assetCustomFilterValue" placeholder="字段值" @keyup.enter="searchLedger"><template #append><el-button @click="searchLedger">查询</el-button></template></el-input>
              <el-popover placement="bottom" :width="240" trigger="click"
                ><template #reference
                  ><el-button :icon="Operation">显示列</el-button></template
                >
                <div class="ep-column-list">
                  <el-checkbox
                    v-for="column in assetColumnOptions"
                    :key="column.key"
                    :model-value="visibleAssetColumns.includes(column.key)"
                    @change="toggleAssetColumn(column.key)"
                    >{{ column.label }}</el-checkbox
                  ><el-button link type="primary" @click="resetAssetColumns"
                    >恢复默认</el-button
                  >
                </div></el-popover
              >
            </div>
            <div class="ep-toolbar-actions">
            <el-button v-if="can('assets.manage')" type="primary" :icon="Plus" @click="openNewAssetModal"
              >新增资产</el-button
            ><el-button
              v-if="can('assets.manage')"
              type="danger"
              :icon="Delete"
              :disabled="!selectedAssetIds.length"
              @click="deleteSelectedAssets"
              >批量删除</el-button
            ><el-button v-if="can('assets.export')" :icon="Download" @click="exportAssets">导出</el-button
            ><el-button v-if="can('faults.manage')" :icon="Warning" @click="registerFaultFromSelection"
              >登记故障</el-button
            ><el-button v-if="can('assets.import')" :icon="Download" @click="downloadImportTemplate"
              >导入模板</el-button
            ><el-upload v-if="can('assets.import')"
              accept=".csv,text/csv"
              :auto-upload="false"
              :show-file-list="false"
              :on-change="onElementUploadChange"
              ><el-button :icon="Upload">导入资产</el-button></el-upload
            ></div>
          </div>
          <PagedTable
            v-model:current-page="assetPage"
            v-model:page-size="assetPageSize"
            :total="assetCount"
            :loading="loading"
            @update:current-page="changeAssetPage"
            @update:page-size="changeAssetPageSize"
          >
          <el-table
            :data="assets"
            row-key="id"
            empty-text="暂无资产数据"
            @selection-change="handleElementAssetSelection"
            @row-click="(row: Asset) => openAssetDetail(row.id)"
          >
            <el-table-column type="selection" width="48" /><el-table-column
              v-for="column in visibleAssetColumnOptions"
              :key="column.key"
              :label="column.label"
              min-width="130"
              ><template #default="{ row }"
                ><el-button
                  v-if="column.key === 'asset_no'"
                  link
                  type="primary"
                  @click.stop="openAssetDetail(row.id)"
                  >{{ assetValue(row, column.key) }}</el-button
                ><el-tag v-else-if="column.key === 'status'" effect="plain">{{
                  assetValue(row, column.key)
                }}</el-tag
                ><span v-else>{{ assetValue(row, column.key) }}</span></template
              ></el-table-column
            >
            <el-table-column v-if="can('assets.manage')" label="操作" fixed="right" width="150"
              ><template #default="{ row }"
                ><div class="ep-table-actions"><el-tooltip content="克隆资产"
                  ><el-button
                    circle
                    :icon="CopyDocument"
                    aria-label="克隆资产"
                    title="克隆资产"
                    @click.stop="openAssetClone(row.id)" /></el-tooltip
                ><el-tooltip content="编辑资产"
                  ><el-button
                    circle
                    :icon="Edit"
                    aria-label="编辑资产"
                    title="编辑资产"
                    @click.stop="openAssetEditor(row.id)" /></el-tooltip
                ><el-tooltip content="删除资产"
                  ><el-button
                    circle
                    :icon="Delete"
                    aria-label="删除资产"
                    title="删除资产"
                    @click.stop="deleteAsset(row)" /></el-tooltip
                ></div></template
            ></el-table-column>
          </el-table>
          </PagedTable>
        </el-card>
  </div>
</template>
