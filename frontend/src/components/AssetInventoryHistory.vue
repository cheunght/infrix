<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatSystemDateTime } from "../system-settings";
import {
  businessOptionLabel,
  businessOptionTone,
  INVENTORY_ITEM_STATUS_OPTIONS,
  INVENTORY_RESOLUTION_ACTION_OPTIONS,
  INVENTORY_RESOLUTION_STATUS_OPTIONS,
} from "../business-enums";
import type { AssetInventoryHistoryContext } from "../page-context";
import DetailSection from "./DetailSection.vue";
import PagedTable from "./PagedTable.vue";
import ResourceState from "./ResourceState.vue";
import StatusTag, { type StatusTagType } from "./StatusTag.vue";

const props = withDefaults(defineProps<{
  context: AssetInventoryHistoryContext;
  collapsible?: boolean;
}>(), {
  collapsible: false,
});
const { t } = useI18n();
const context = props.context;

const items = computed(() => context.inventoryHistoryItems.value);
const loading = computed(() => context.inventoryHistoryLoading.value);
const error = computed(() => context.inventoryHistoryError.value);
const page = computed(() => context.inventoryHistoryPage.value);
const pageSize = computed(() => context.inventoryHistoryPageSize.value);
const total = computed(() => context.inventoryHistoryTotal.value);
const empty = computed(() => !loading.value && !error.value && total.value === 0);

function formatDateTime(value: string | null): string {
  if (!value) return t("common.notAvailable");
  return formatSystemDateTime(value) || value;
}

function statusTone(status: string): StatusTagType {
  return businessOptionTone(INVENTORY_ITEM_STATUS_OPTIONS, status, "info");
}

function resolutionTone(status: string): StatusTagType {
  return businessOptionTone(INVENTORY_RESOLUTION_STATUS_OPTIONS, status, "info");
}

function resolutionActionLabel(action: string | null): string {
  return action
    ? businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, action)
    : t("common.notAvailable");
}

function retry() {
  void context.retryInventoryHistory();
}

function changePage(value: number) {
  void context.changeInventoryHistoryPage(value);
}

function changePageSize(value: number) {
  void context.changeInventoryHistoryPageSize(value);
}
</script>

<template>
  <DetailSection
    class="asset-inventory-history"
    :title="t('asset.inventoryRecords')"
    :collapsible="collapsible"
    :summary="t('units.item', total)"
  >
    <ResourceState
      :loading="loading"
      :error="error"
      :empty="empty"
      :empty-text="t('common.noData')"
      @retry="retry"
    >
      <PagedTable
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        @update:current-page="changePage"
        @update:page-size="changePageSize"
      >
        <el-table :data="items" row-key="id" table-layout="fixed">
          <el-table-column prop="task_name" :label="t('inventory.taskName')" min-width="180" show-overflow-tooltip />
          <el-table-column :label="t('inventory.result')" width="120">
            <template #default="{ row }">
              <StatusTag
                :tone="statusTone(row.status)"
                :label="businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, row.status)"
              />
            </template>
          </el-table-column>
          <el-table-column :label="t('inventory.inspector')" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ row.checked_by_name || t('common.notAvailable') }}</template>
          </el-table-column>
          <el-table-column :label="t('inventory.checkedAt')" width="166">
            <template #default="{ row }">{{ formatDateTime(row.checked_at) }}</template>
          </el-table-column>
          <el-table-column :label="t('inventory.processStatus')" width="120">
            <template #default="{ row }">
              <StatusTag
                :tone="resolutionTone(row.resolution_status)"
                :label="businessOptionLabel(INVENTORY_RESOLUTION_STATUS_OPTIONS, row.resolution_status)"
              />
            </template>
          </el-table-column>
          <el-table-column :label="t('inventory.processResult')" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ resolutionActionLabel(row.resolution_action) }}</template>
          </el-table-column>
        </el-table>
      </PagedTable>
    </ResourceState>
  </DetailSection>
</template>

<style scoped>
.asset-inventory-history :deep(.el-table) {
  width: 100%;
}

.asset-inventory-history :deep(.el-table__cell) {
  padding: 8px 0;
}
</style>
