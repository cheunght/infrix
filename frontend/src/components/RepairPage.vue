<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Download, Tools, View } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import ResourceState from "./ResourceState.vue";
import TableIconButton from "./TableIconButton.vue";
import { statusTone } from "../status";
import type { FaultEvent } from "../types";
import type { RepairContext } from "../page-context";

const props = defineProps<{ context: RepairContext }>();
const { t, locale } = useI18n();
const context = props.context;
const {
  repairListLoading,
  repairListError,
  repairKeyword,
  searchRepairs,
  repairStatus,
  repairStart,
  repairEnd,
  onRepairStatusChange,
  onRepairDateChange,
  resetRepairFilters,
  retryRepairList,
  exportRepairs,
  exportingRepairs,
  can,
  openFaultModal,
  openAssetDetail,
  repairRows,
  openRepairModal,
  repairPage,
  repairPageSize,
  repairCount,
  changeRepairPage,
  changeRepairPageSize,
} = context;

const hasRepairFilters = computed(() => Boolean(
  repairKeyword.value.trim() || repairStatus.value || repairStart.value || repairEnd.value,
));

function faultSummary(fault: FaultEvent): string {
  return fault.reason?.trim() || fault.description?.trim() || t("repair.noDescription");
}

function formatRepairDateTime(value: string | null | undefined): string {
  if (!value) return t("common.notAvailable");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("common.notAvailable") : date.toLocaleString(locale.value);
}

function formatRepairCost(fault: FaultEvent): string {
  const cost = fault.repair?.cost;
  return cost || t("common.notAvailable");
}

function repairStage(fault: FaultEvent) {
  if (fault.repair?.finished_at) {
    return { label: t("status.completed"), tone: statusTone("completed") };
  }
  if (fault.repair) {
    return { label: t("status.repair"), tone: statusTone("repair") };
  }
  return { label: t("repair.start"), tone: statusTone("pending") };
}

function repairActionLabel(fault: FaultEvent): string {
  if (!can("faults.manage")) return t("common.details");
  if (fault.is_closed) return t("repair.viewResult");
  return fault.repair ? t("repair.process") : t("repair.start");
}

function repairActionIcon(fault: FaultEvent) {
  if (!can("faults.manage")) return View;
  return fault.is_closed ? View : Tools;
}
</script>

<template>
  <PageContainer class="infrix-page repair-page">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="repairKeyword" :placeholder="t('repair.searchPlaceholder')" :aria-label="t('repair.title')" @search="searchRepairs" />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select v-model="repairStatus" :placeholder="t('common.all') + t('common.status')" clearable @change="onRepairStatusChange">
                <el-option :label="t('status.open')" value="false" />
                <el-option :label="t('status.closed')" value="true" />
              </el-select>
            </div>
          </template>
          <template #actions>
            <el-button v-if="can('faults.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingRepairs" :disabled="exportingRepairs" @click="exportRepairs">
              {{ t('asset.exportData') }}
            </el-button>
          </template>
          <template #primary>
          <el-button v-if="can('faults.manage')" class="page-primary-action" type="primary" @click="openFaultModal()">{{ t('repair.addFault') }}</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <ResourceState
          :loading="repairListLoading && !repairRows.length"
          :error="repairListError && !repairRows.length ? repairListError : ''"
          :empty="!repairListLoading && !repairListError && !repairRows.length"
          :empty-text="hasRepairFilters ? t('repair.noMatching') : t('repair.noFaults')"
          @retry="retryRepairList"
        >
          <template #error="{ error }">
            <el-alert :title="t('repair.faultLoadFailed')" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" @click="retryRepairList">{{ t('common.retry') }}</el-button>
          </template>
          <template #empty>
            <el-empty :image-size="56" :description="hasRepairFilters ? t('repair.noMatching') : t('repair.noFaults')">
              <el-button v-if="hasRepairFilters" link type="primary" @click="resetRepairFilters">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
          </template>
          <PagedTable
            v-model:current-page="repairPage"
            v-model:page-size="repairPageSize"
            :total="repairCount"
            @update:current-page="changeRepairPage"
            @update:page-size="changeRepairPageSize"
          >
          <el-alert
            v-if="repairListError && repairRows.length"
            class="repair-list-alert"
            type="error"
            :closable="false"
            :title="t('repair.faultLoadFailed')"
          >
            <template #default>
              <span>{{ repairListError }}</span>
              <el-button link type="danger" @click="retryRepairList">{{ t('common.retry') }}</el-button>
            </template>
          </el-alert>
          <el-table class="repair-table" v-loading="repairListLoading" :data="repairRows" table-layout="fixed">
            <el-table-column :label="t('repair.fault')" min-width="240">
              <template #default="{ row }">
                <el-button link type="primary" class="repair-fault-link" :aria-label="t('repair.viewFaultAria', { summary: faultSummary(row) })" @click="openRepairModal(row)">
                  <span>{{ faultSummary(row) }}</span>
                </el-button>
              </template>
            </el-table-column>
            <el-table-column :label="t('repair.asset')" min-width="190">
              <template #default="{ row }">
                <el-button link class="repair-asset-link" @click="openAssetDetail(row.asset)">
                  <span>{{ row.asset_no }} · {{ row.asset_name }}</span>
                </el-button>
              </template>
            </el-table-column>
            <el-table-column :label="t('common.status')" width="100">
              <template #default="{ row }">
                <StatusTag :tone="statusTone(row.is_closed ? 'completed' : 'repair')" :label="row.is_closed ? t('status.closed') : t('status.open')" />
              </template>
            </el-table-column>
            <el-table-column :label="t('repair.occurredAt')" width="172">
              <template #default="{ row }">{{ formatRepairDateTime(row.occurred_at) }}</template>
            </el-table-column>
            <el-table-column :label="t('repair.repairStatus')" width="160">
              <template #default="{ row }">
                <StatusTag :tone="repairStage(row).tone" :label="repairStage(row).label" />
              </template>
            </el-table-column>
            <el-table-column :label="t('repair.cost')" width="130">
              <template #default="{ row }">{{ formatRepairCost(row) }}</template>
            </el-table-column>
            <el-table-column v-if="can('faults.view')" :label="t('common.operation')" fixed="right" width="132">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton
                    :icon="repairActionIcon(row)"
                    :label="repairActionLabel(row)"
                    type="primary"
                    @click="openRepairModal(row)"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
          </PagedTable>
        </ResourceState>
      </PageContent>
  </PageContainer>
</template>
