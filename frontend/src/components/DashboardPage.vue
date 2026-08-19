<script setup lang="ts">
import { computed } from "vue";
import {
  ArrowRight,
  OfficeBuilding,
  Refresh,
} from "@element-plus/icons-vue";
import DashboardDonut from "./DashboardDonut.vue";
import StatisticCard from "./StatisticCard.vue";
import metricAssets from "../assets/dashboard/metric-assets.png";
import metricRacks from "../assets/dashboard/metric-racks.png";
import metricDatacenter from "../assets/dashboard/metric-datacenter.png";
import metricExpiring from "../assets/dashboard/metric-expiring.png";
import quickImportIcon from "../assets/dashboard/quick-import.png";
import inventoryCheckIcon from "../assets/dashboard/inventory-check.png";
import type {
  DashboardDataCenterOverview,
  DashboardRecentChange,
  DashboardStatus,
} from "../types";
import type { DashboardContext } from "../types/page-context";

const props = defineProps<{ context: DashboardContext }>();
const {
  dashboard,
  dashboardLoading,
  handleMenuSelect,
  openAssetDetail,
  openNewAssetModal,
  openRackSection,
  assetSearch,
  searchLedger,
  can,
  dashboardDate,
  dashboardDateTime,
} = props.context;

const statusItems = computed<DashboardStatus[]>(
  () => dashboard.value?.status_distribution || [],
);
const dataCenterItems = computed<DashboardDataCenterOverview[]>(
  () => dashboard.value?.data_center_overview || [],
);
const recentChanges = computed<DashboardRecentChange[]>(
  () => dashboard.value?.recent_changes || [],
);
const statusTotal = computed(() =>
  statusItems.value.reduce((total, item) => total + item.count, 0),
);

function selectAssetFilter(value: string) {
  assetSearch.value = value;
  handleMenuSelect("asset-list");
  searchLedger();
}
function selectStatus(item: { label: string; status?: string; key?: string }) {
  selectAssetFilter(item.status || item.key || item.label);
}
function openChanges() {
  handleMenuSelect(can("audit.view") ? "settings-audit" : "asset-list");
}
function openInventory() {
  handleMenuSelect("inventory");
}
function goLedger() {
  handleMenuSelect("asset-list");
}
</script>

<template>
  <div class="itam-page dashboard-page dashboard-reference-page">
    <div v-if="dashboardLoading" class="dashboard-inline-loading">
      <el-icon class="is-loading"><Refresh /></el-icon>
      正在更新仪表盘数据…
    </div>

    <section class="dashboard-reference-metrics statistic-card-grid">
      <StatisticCard
        label="设备总数"
        :value="dashboard?.assets.total ?? 0"
        tone="blue"
        :icon-image="metricAssets"
        icon-alt="设备"
      />
      <StatisticCard
        label="机柜总数"
        :value="dashboard?.racks.total ?? 0"
        tone="green"
        :icon-image="metricRacks"
        icon-alt="机柜"
      />
      <StatisticCard
        label="数据中心数"
        :value="dashboard?.data_centers?.total ?? 0"
        tone="purple"
        :icon-image="metricDatacenter"
        icon-alt="数据中心"
      />
      <StatisticCard
        label="即将过保设备"
        :value="dashboard?.expiring.within_90_days ?? 0"
        tone="orange"
        :icon-image="metricExpiring"
        icon-alt="即将过保"
      />
    </section>

    <section class="dashboard-reference-grid dashboard-primary-grid">
      <el-card shadow="never" class="dashboard-reference-card dashboard-chart-card">
        <template #header>
          <div class="dashboard-card-heading"><strong>设备状态分布</strong><el-button text type="primary" @click="goLedger">详情 <el-icon><ArrowRight /></el-icon></el-button></div>
        </template>
        <DashboardDonut :items="statusItems" :total="statusTotal" center-label="设备总数" @select="selectStatus" />
      </el-card>
      <el-card shadow="never" class="dashboard-reference-card">
        <template #header>
          <div class="dashboard-card-heading"><strong>数据中心概览</strong><el-button text type="primary" @click="goLedger">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div>
        </template>
        <div v-if="dataCenterItems.length" class="data-center-overview-list">
          <button v-for="item in dataCenterItems" :key="item.data_center_id" type="button" class="data-center-overview-item" @click="selectAssetFilter(item.data_center)">
            <div class="data-center-overview-title"><span class="data-center-icon"><OfficeBuilding /></span><strong>{{ item.data_center }}</strong><el-icon><ArrowRight /></el-icon></div>
            <div class="data-center-overview-stats"><span><b>{{ item.asset_count }}</b>设备</span><span><b>{{ item.rack_count }}</b>机柜</span></div>
          </button>
        </div>
        <el-empty v-else description="暂无数据中心数据" :image-size="64" />
      </el-card>
    </section>

    <section class="dashboard-reference-grid dashboard-table-grid">
      <el-card shadow="never" class="dashboard-reference-card">
        <template #header><div class="dashboard-card-heading"><strong>最近资产变更</strong><el-button text type="primary" @click="openChanges">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div></template>
        <div class="dashboard-table-scroll">
          <el-table :data="recentChanges" empty-text="暂无资产变更" class="dashboard-reference-table" @row-click="(row: DashboardRecentChange) => openAssetDetail(row.asset_id)">
            <el-table-column label="时间" width="112"><template #default="{ row }">{{ dashboardDateTime(row.created_at) }}</template></el-table-column>
            <el-table-column prop="action" label="变更类型" width="92"><template #default="{ row }"><el-tag size="small" effect="plain">{{ row.action }}</el-tag></template></el-table-column>
            <el-table-column prop="asset_name" label="资产名称" min-width="140" />
            <el-table-column prop="location" label="位置" min-width="170" show-overflow-tooltip />
            <el-table-column prop="actor_name" label="操作人" width="82" />
          </el-table>
        </div>
      </el-card>
      <el-card shadow="never" class="dashboard-reference-card">
        <template #header><div class="dashboard-card-heading"><strong>即将过保设备</strong><el-button text type="primary" @click="goLedger">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div></template>
        <div class="dashboard-table-scroll">
          <el-table :data="dashboard?.upcoming_expirations || []" empty-text="暂无即将过保设备" class="dashboard-reference-table" @row-click="(row: any) => openAssetDetail(row.asset_id)">
            <el-table-column prop="asset_name" label="资产名称" min-width="150" />
            <el-table-column prop="asset_no" label="资产编号" min-width="120" />
            <el-table-column label="到期日期" width="108"><template #default="{ row }">{{ dashboardDate(row.expiry_date) }}</template></el-table-column>
            <el-table-column label="剩余天数" width="90"><template #default="{ row }"><span :class="{ 'dashboard-expiry-warning': row.days_remaining <= 30 }">{{ row.days_remaining }} 天</span></template></el-table-column>
          </el-table>
        </div>
      </el-card>
    </section>

    <el-card shadow="never" class="dashboard-reference-card dashboard-quick-actions">
      <template #header><strong>快速操作</strong></template>
      <div class="quick-action-grid">
        <button v-if="can('assets.manage')" type="button" @click="openNewAssetModal"><img class="quick-action-icon-image" :src="metricAssets" alt="" aria-hidden="true" /><span><strong>新增设备</strong><small>添加新的设备资产</small></span></button>
        <button v-if="can('racks.manage')" type="button" @click="openRackSection('manage')"><img class="quick-action-icon-image" :src="metricRacks" alt="" aria-hidden="true" /><span><strong>新增机柜</strong><small>创建新的机柜</small></span></button>
        <button v-if="can('assets.import')" type="button" @click="handleMenuSelect('asset-list')"><img class="quick-action-icon-image" :src="quickImportIcon" alt="" aria-hidden="true" /><span><strong>导入设备</strong><small>批量导入设备资产</small></span></button>
        <button v-if="can('inventory.manage')" type="button" @click="openInventory"><img class="quick-action-icon-image" :src="inventoryCheckIcon" alt="" aria-hidden="true" /><span><strong>发起盘点</strong><small>创建新的盘点任务</small></span></button>
      </div>
    </el-card>
  </div>
</template>
