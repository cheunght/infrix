<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { currentLocale } from "../i18n";
import type { AssetResponsibilityHistoryContext } from "../page-context";
import DetailSection from "./DetailSection.vue";
import PagedTable from "./PagedTable.vue";
import ResourceState from "./ResourceState.vue";

const props = defineProps<{ context: AssetResponsibilityHistoryContext }>();
const { t } = useI18n();
const context = props.context;

const items = computed(() => context.responsibilityHistoryItems.value);
const loading = computed(() => context.responsibilityHistoryLoading.value);
const error = computed(() => context.responsibilityHistoryError.value);
const page = computed(() => context.responsibilityHistoryPage.value);
const pageSize = computed(() => context.responsibilityHistoryPageSize.value);
const total = computed(() => context.responsibilityHistoryTotal.value);
const empty = computed(() => !loading.value && !error.value && total.value === 0);

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(currentLocale.value, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function actionLabel(action: string): string {
  const key = action === "assign"
    ? "asset.assign"
    : action === "return"
      ? "asset.return"
      : action === "transfer"
        ? "asset.transfer"
        : "asset.responsibilityAction";
  return t(key);
}

function transitionLabel(from: string, to: string): string {
  return `${from || t("asset.unassigned")} → ${to || t("asset.unassigned")}`;
}

function retry() {
  void context.retryResponsibilityHistory();
}

function changePage(value: number) {
  void context.changeResponsibilityHistoryPage(value);
}

function changePageSize(value: number) {
  void context.changeResponsibilityHistoryPageSize(value);
}
</script>

<template>
  <DetailSection class="asset-responsibility-history" :title="t('asset.responsibilityHistory')">
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
          <el-table-column :label="t('asset.responsibilityAction')" width="90">
            <template #default="{ row }">{{ actionLabel(row.action) }}</template>
          </el-table-column>
          <el-table-column :label="t('asset.responsibilityTransition')" min-width="190" show-overflow-tooltip>
            <template #default="{ row }">{{ transitionLabel(row.from_user_name, row.to_user_name) }}</template>
          </el-table-column>
          <el-table-column :label="t('asset.responsibilityOperator')" width="130" show-overflow-tooltip>
            <template #default="{ row }">{{ row.operator_name || t('common.notAvailable') }}</template>
          </el-table-column>
          <el-table-column :label="t('asset.responsibilityReason')" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.reason || t('common.notAvailable') }}</template>
          </el-table-column>
          <el-table-column :label="t('asset.responsibilityTime')" width="170">
            <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
          </el-table-column>
        </el-table>
      </PagedTable>
    </ResourceState>
  </DetailSection>
</template>

<style scoped>
.asset-responsibility-history :deep(.el-table) {
  width: 100%;
}

.asset-responsibility-history :deep(.el-table__cell) {
  padding: 8px 0;
}
</style>
