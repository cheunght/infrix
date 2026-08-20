<script setup lang="ts">
import { Download, Warning } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageHeader from "./page/PageHeader.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import type { RepairContext } from "../types/page-context";

const props = defineProps<{ context: RepairContext }>();
const context = props.context;
const {
  loading,
  repairKeyword,
  searchRepairs,
  repairStatus,
  repairStart,
  repairEnd,
  exportRepairs,
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
</script>

<template>
  <div class="itam-page repair-page">
    <PageContainer>
      <template #header>
        <PageHeader description="记录设备故障、维修过程和处理状态">
          <template #actions>
            <el-button v-if="can('faults.manage')" type="primary" :icon="Warning" @click="openFaultModal()">登记故障</el-button>
          </template>
        </PageHeader>
      </template>
      <template #toolbar>
        <PageToolbar>
          <SearchField class="itam-filter-search" v-model="repairKeyword" placeholder="搜索资产编号、名称、故障原因" aria-label="搜索故障" @search="searchRepairs" />
          <el-select class="itam-filter-select" v-model="repairStatus" placeholder="全部状态" clearable>
            <el-option label="未关闭" value="false" />
            <el-option label="已关闭" value="true" />
          </el-select>
          <el-date-picker class="itam-filter-date" v-model="repairStart" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" />
          <el-date-picker class="itam-filter-date" v-model="repairEnd" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" />
          <template #actions>
            <el-button v-if="can('faults.export')" :icon="Download" @click="exportRepairs">导出维修记录</el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <PagedTable
          v-model:current-page="repairPage"
          v-model:page-size="repairPageSize"
          :total="repairCount"
          :loading="loading"
          @update:current-page="changeRepairPage"
          @update:page-size="changeRepairPageSize"
        >
          <el-table v-loading="loading" :data="repairRows" empty-text="暂无故障记录">
            <el-table-column label="资产" min-width="160">
              <template #default="{ row }">
                <el-button link type="primary" @click="openAssetDetail(row.asset)">
                  {{ row.asset_no }} · {{ row.asset_name }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column label="发生时间" min-width="170">
              <template #default="{ row }">{{ new Date(row.occurred_at).toLocaleString("zh-CN") }}</template>
            </el-table-column>
            <el-table-column prop="reason" label="故障原因" min-width="130" />
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
  </div>
</template>
