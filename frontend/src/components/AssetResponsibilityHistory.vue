<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatSystemDateTime } from "../system-settings";
import type { AssetResponsibilityHistoryContext } from "../page-context";
import type { AssetAssignmentEvent } from "../types";
import DetailSection from "./DetailSection.vue";
import PagedTable from "./PagedTable.vue";
import ResourceState from "./ResourceState.vue";

const props = withDefaults(
  defineProps<{
    context: AssetResponsibilityHistoryContext;
    collapsible?: boolean;
    compact?: boolean;
  }>(),
  {
    collapsible: false,
  },
);
const { t } = useI18n();
const context = props.context;

const items = computed(() => context.responsibilityHistoryItems.value);
const loading = computed(() => context.responsibilityHistoryLoading.value);
const error = computed(() => context.responsibilityHistoryError.value);
const page = computed(() => context.responsibilityHistoryPage.value);
const pageSize = computed(() => context.responsibilityHistoryPageSize.value);
const total = computed(() => context.responsibilityHistoryTotal.value);
const empty = computed(
  () => !loading.value && !error.value && total.value === 0,
);

function formatDateTime(value: string): string {
  return formatSystemDateTime(value) || value;
}

function actionLabel(action: string): string {
  const key =
    action === "assign"
      ? "asset.assignPerson"
      : action === "return"
        ? "asset.returnPerson"
        : action === "transfer"
          ? "asset.transferPerson"
          : "asset.assignmentAction";
  return t(key);
}

function personLabel(
  name: string,
  employeeNo: string,
  department: string,
  organization: string,
  contact: string,
): string {
  const displayName = name || t("asset.unassigned");
  const metadata = [
    employeeNo,
    department,
    organization,
    contact,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" · ");
  return metadata ? `${displayName} (${metadata})` : displayName;
}

function transitionLabel(item: AssetAssignmentEvent): string {
  const from = personLabel(
    item.from_person_name,
    item.from_person_employee_no,
    item.from_person_department,
    item.from_person_organization,
    item.from_person_contact,
  );
  const to = personLabel(
    item.to_person_name,
    item.to_person_employee_no,
    item.to_person_department,
    item.to_person_organization,
    item.to_person_contact,
  );
  return `${from} → ${to}`;
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
  <DetailSection
    class="asset-responsibility-history"
    :title="t('asset.assignmentHistory')"
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
        <div v-if="compact" class="asset-history-list">
          <article
            v-for="item in items"
            :key="item.id"
            class="asset-history-record"
          >
            <strong
              >{{ actionLabel(item.action) }} ·
              {{
                transitionLabel(item)
              }}</strong
            >
            <span
              >{{ t("asset.assignmentOperator") }} ·
              {{ item.operator_name || t("common.notAvailable") }}</span
            >
            <time>{{ formatDateTime(item.created_at) }}</time>
            <p>
              {{ t("asset.assignmentReason") }} ·
              {{ item.reason || t("common.notAvailable") }}
            </p>
          </article>
        </div>
        <el-table v-else :data="items" row-key="id" table-layout="fixed">
          <el-table-column :label="t('asset.assignmentAction')" width="90">
            <template #default="{ row }">{{
              actionLabel(row.action)
            }}</template>
          </el-table-column>
          <el-table-column
            :label="t('asset.assignmentTransition')"
            min-width="190"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{
              transitionLabel(row)
            }}</template>
          </el-table-column>
          <el-table-column
            :label="t('asset.assignmentOperator')"
            width="130"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{
              row.operator_name || t("common.notAvailable")
            }}</template>
          </el-table-column>
          <el-table-column
            :label="t('asset.assignmentReason')"
            min-width="180"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{
              row.reason || t("common.notAvailable")
            }}</template>
          </el-table-column>
          <el-table-column :label="t('asset.assignmentTime')" width="170">
            <template #default="{ row }">{{
              formatDateTime(row.created_at)
            }}</template>
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
