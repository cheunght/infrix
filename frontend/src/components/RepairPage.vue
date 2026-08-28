<script setup lang="ts">
import { computed } from "vue";
import { Download, Tools, View } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import ResourceState from "./ResourceState.vue";
import { statusTone } from "../status";
import type { FaultEvent } from "../types";
import type { RepairContext } from "../types/page-context";

const props = defineProps<{ context: RepairContext }>();
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
  return fault.reason?.trim() || fault.description?.trim() || "未填写故障信息";
}

function formatRepairDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN");
}

function repairStage(fault: FaultEvent) {
  if (fault.repair?.finished_at) {
    return { label: "已完成", tone: statusTone("completed") };
  }
  if (fault.repair) {
    return { label: "维修中", tone: statusTone("repair") };
  }
  return { label: "待维修", tone: statusTone("pending") };
}

function repairActionLabel(fault: FaultEvent): string {
  if (fault.is_closed) return "查看结果";
  return fault.repair ? "处理维修" : "开始维修";
}

function repairActionIcon(fault: FaultEvent) {
  return fault.is_closed ? View : Tools;
}
</script>

<template>
  <PageContainer class="itam-page repair-page">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="repairKeyword" placeholder="搜索资产编号、名称、故障原因或描述" aria-label="搜索故障" @search="searchRepairs" />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select v-model="repairStatus" placeholder="全部状态" clearable @change="onRepairStatusChange">
                <el-option label="未关闭" value="false" />
                <el-option label="已关闭" value="true" />
              </el-select>
            </div>
          </template>
          <template #actions>
            <el-button v-if="can('faults.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingRepairs" :disabled="exportingRepairs" @click="exportRepairs">
              导出数据
            </el-button>
          </template>
          <template #primary>
            <el-button v-if="can('faults.manage')" class="page-primary-action" type="primary" @click="openFaultModal()">新增故障</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <ResourceState
          :loading="repairListLoading && !repairRows.length"
          :error="repairListError && !repairRows.length ? repairListError : ''"
          :empty="!repairListLoading && !repairListError && !repairRows.length"
          :empty-text="hasRepairFilters ? '没有匹配当前条件的故障记录' : '暂无故障记录'"
          @retry="retryRepairList"
        >
          <template #error="{ error }">
            <el-alert title="故障数据加载失败" :description="error" type="error" show-icon :closable="false" />
            <el-button link type="primary" @click="retryRepairList">重新加载</el-button>
          </template>
          <template #empty>
            <el-empty :image-size="56" :description="hasRepairFilters ? '没有匹配当前条件的故障记录' : '暂无故障记录'">
              <el-button v-if="hasRepairFilters" link type="primary" @click="resetRepairFilters">清除筛选</el-button>
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
            title="故障数据加载失败"
          >
            <template #default>
              <span>{{ repairListError }}</span>
              <el-button link type="danger" @click="retryRepairList">重新加载</el-button>
            </template>
          </el-alert>
          <el-table v-loading="repairListLoading" :data="repairRows" table-layout="fixed">
            <el-table-column label="故障" min-width="240">
              <template #default="{ row }">
                <el-button link type="primary" class="repair-fault-link" :aria-label="`查看故障：${faultSummary(row)}`" @click="openRepairModal(row)">
                  <span>{{ faultSummary(row) }}</span>
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="关联资产" min-width="190">
              <template #default="{ row }">
                <el-button link class="repair-asset-link" @click="openAssetDetail(row.asset)">
                  <span>{{ row.asset_no }} · {{ row.asset_name }}</span>
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <StatusTag :tone="statusTone(row.is_closed ? 'completed' : 'repair')" :label="row.is_closed ? '已关闭' : '未关闭'" />
              </template>
            </el-table-column>
            <el-table-column label="发生时间" width="172">
              <template #default="{ row }">{{ formatRepairDateTime(row.occurred_at) }}</template>
            </el-table-column>
            <el-table-column label="维修状态" width="120">
              <template #default="{ row }">
                <StatusTag :tone="repairStage(row).tone" :label="repairStage(row).label" />
              </template>
            </el-table-column>
            <el-table-column v-if="can('faults.manage')" label="操作" fixed="right" width="132">
              <template #default="{ row }">
                <div class="repair-row-actions">
                  <el-button link type="primary" :icon="repairActionIcon(row)" @click="openRepairModal(row)">{{ repairActionLabel(row) }}</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          </PagedTable>
        </ResourceState>
      </PageContent>
  </PageContainer>
</template>
