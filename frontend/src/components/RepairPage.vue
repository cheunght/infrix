<script setup lang="ts">
import { computed } from "vue";
import { Download, Filter } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
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
</script>

<template>
  <PageContainer class="itam-page repair-page">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="repairKeyword" placeholder="搜索资产编号、名称、故障原因" aria-label="搜索故障" @search="searchRepairs" />
          </template>
          <template #primary-filter>
            <el-select v-model="repairStatus" placeholder="全部状态" clearable @change="onRepairStatusChange">
              <el-option label="未关闭" value="false" />
              <el-option label="已关闭" value="true" />
            </el-select>
          </template>
          <template #extra-filter>
            <div class="toolbar-extra-group">
              <el-popover placement="bottom-start" :width="360" trigger="click">
                <template #reference><el-button class="toolbar-extra-action" :icon="Filter">更多筛选</el-button></template>
                <div class="toolbar-extra-panel">
                  <el-date-picker v-model="repairStart" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" @change="onRepairDateChange" />
                  <el-date-picker v-model="repairEnd" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" @change="onRepairDateChange" />
                  <div class="toolbar-extra-popover-actions">
                    <el-button class="toolbar-secondary-action" @click="resetRepairFilters">重置</el-button>
                  </div>
                </div>
              </el-popover>
            </div>
          </template>
          <template #actions>
            <el-button v-if="can('faults.export')" class="toolbar-secondary-action toolbar-export-action" :icon="Download" :loading="exportingRepairs" :disabled="exportingRepairs" @click="exportRepairs">
              导出数据
            </el-button>
            <el-button v-if="can('faults.manage')" class="page-primary-action" type="primary" @click="openFaultModal()">新增故障</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <PagedTable
          v-model:current-page="repairPage"
          v-model:page-size="repairPageSize"
          :total="repairCount"
          :loading="repairListLoading"
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
          <el-table v-loading="repairListLoading" :data="repairRows">
            <template #empty>
              <div v-if="repairListError" class="repair-list-empty repair-list-empty--error">
                <span>故障数据加载失败</span>
                <small>{{ repairListError }}</small>
                <el-button link type="primary" @click="retryRepairList">重新加载</el-button>
              </div>
              <div v-else-if="hasRepairFilters" class="repair-list-empty">
                <span>没有符合当前筛选条件的故障</span>
                <el-button link type="primary" @click="resetRepairFilters">清除筛选</el-button>
              </div>
              <span v-else>暂无故障记录</span>
            </template>
            <el-table-column label="资产" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <el-button link type="primary" @click="openAssetDetail(row.asset)">
                  {{ row.asset_no }} · {{ row.asset_name }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="发生时间" min-width="170">
              <template #default="{ row }">{{ new Date(row.occurred_at).toLocaleString("zh-CN") }}</template>
            </el-table-column>
            <el-table-column prop="reason" label="故障原因" min-width="150" show-overflow-tooltip />
            <el-table-column prop="description" label="故障描述" min-width="180" show-overflow-tooltip />
            <el-table-column label="维修完成时间" min-width="170">
              <template #default="{ row }">{{ row.repair?.finished_at ? new Date(row.repair.finished_at).toLocaleString("zh-CN") : "—" }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <StatusTag :status="row.is_closed ? 'completed' : 'pending'" :label="row.is_closed ? '已关闭' : '未关闭'" />
              </template>
            </el-table-column>
            <el-table-column v-if="can('faults.manage')" label="操作" fixed="right" width="120">
              <template #default="{ row }">
                <el-button link type="primary" @click="openRepairModal(row)">{{ row.repair ? "编辑维修" : "填写维修" }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </PagedTable>
      </PageContent>
  </PageContainer>
</template>
