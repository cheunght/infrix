<!-- UX Reference: standard dashboard hierarchy. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed } from "vue";
import {
  ArrowRight,
  OfficeBuilding,
  Refresh,
} from "@element-plus/icons-vue";
import DashboardDonut from "./DashboardDonut.vue";
import StatisticCard from "./StatisticCard.vue";
import "../dashboard.css";
import metricAssets from "../assets/dashboard/metric-assets.png";
import metricRacks from "../assets/dashboard/metric-racks.png";
import metricDatacenter from "../assets/dashboard/metric-datacenter.png";
import metricExpiring from "../assets/dashboard/metric-expiring.png";
import quickImportIcon from "../assets/dashboard/quick-import.png";
import inventoryCheckIcon from "../assets/dashboard/inventory-check.png";
import type {
  DashboardDataCenterOverview,
  DashboardExpiration,
  DashboardRecentChange,
  DashboardStatus,
} from "../types";
import type { DashboardContext } from "../types/page-context";
import StatusTag, { type StatusTagType } from "./StatusTag.vue";
import PageContainer from "./page/PageContainer.vue";
import PageHeader from "./page/PageHeader.vue";

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
const recentChangeItems = computed<DashboardRecentChange[]>(
  () => recentChanges.value.slice(0, 5),
);
const upcomingExpirations = computed<DashboardExpiration[]>(
  () => (dashboard.value?.upcoming_expirations || []).slice(0, 5),
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

function recentChangeTagType(action: string): StatusTagType {
  if (["故障", "报废"].includes(action)) return "danger";
  if (["状态变化", "下架"].includes(action)) return "warning";
  if (["新增", "上架"].includes(action)) return "success";
  return "info";
}

function expirationLabel(item: DashboardExpiration) {
  return item.days_remaining < 0 ? "已过期" : `还有 ${item.days_remaining} 天`;
}

function expirationTagType(item: DashboardExpiration): StatusTagType {
  return item.days_remaining <= 30 ? "danger" : "warning";
}
</script>

<template>
  <PageContainer class="itam-page dashboard-shell">
    <template #header>
      <PageHeader
        title="资产管理概览"
        description="实时掌握资产运行状态与关键指标"
      />
    </template>
    <div class="dashboard-body">
      <div v-if="dashboardLoading" class="dashboard-inline-loading" role="status" aria-live="polite">
        <el-icon class="is-loading"><Refresh /></el-icon>
        正在更新仪表盘数据…
      </div>

      <section class="dashboard-kpi-row">
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

      <section class="dashboard-overview-row">
        <el-card shadow="never" class="dashboard-panel dashboard-panel--status">
          <template #header>
            <div class="dashboard-card-heading"><strong>设备状态分布</strong><el-button text type="primary" @click="goLedger">详情 <el-icon><ArrowRight /></el-icon></el-button></div>
          </template>
          <DashboardDonut :items="statusItems" :total="statusTotal" center-label="设备总数" @select="selectStatus" />
        </el-card>
        <el-card shadow="never" class="dashboard-panel dashboard-panel--datacenters">
          <template #header>
            <div class="dashboard-card-heading"><strong>数据中心概览</strong><el-button text type="primary" @click="goLedger">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div>
          </template>
          <div v-if="dataCenterItems.length" class="dashboard-data-center-grid">
            <button v-for="item in dataCenterItems" :key="item.data_center_id" type="button" class="dashboard-data-center-item" @click="selectAssetFilter(item.data_center)">
              <div class="dashboard-data-center-title"><span class="dashboard-data-center-icon"><OfficeBuilding /></span><strong>{{ item.data_center }}</strong><el-icon><ArrowRight /></el-icon></div>
              <div class="dashboard-data-center-stats"><span><b>{{ item.asset_count }}</b>设备</span><span><b>{{ item.rack_count }}</b>机柜</span></div>
              <div class="dashboard-data-center-capacity"><span>U 位 {{ item.used_u }} / {{ item.total_u }}</span><span>{{ item.utilization.toFixed(1) }}%</span></div>
              <el-progress :percentage="Math.min(100, Math.max(0, item.utilization))" :show-text="false" :stroke-width="4" />
            </button>
          </div>
          <el-empty v-else description="暂无数据中心数据" :image-size="64" />
        </el-card>
      </section>

      <section class="dashboard-summary-row">
        <el-card shadow="never" class="dashboard-panel dashboard-panel--activity" :class="{ 'is-empty': !recentChangeItems.length }">
          <template #header><div class="dashboard-card-heading"><strong>最近资产变更</strong><el-button text type="primary" @click="openChanges">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div></template>
          <div v-if="recentChangeItems.length" class="dashboard-activity-list">
            <el-button
              v-for="row in recentChangeItems"
              :key="row.id"
              text
              native-type="button"
              class="dashboard-activity-item"
              @click="openAssetDetail(row.asset_id)"
            >
              <span class="dashboard-activity-main">
                <strong>{{ row.asset_name }}</strong>
                <small>{{ row.asset_no }} · {{ row.location || "未上架" }}</small>
              </span>
              <span class="dashboard-activity-meta">
                <StatusTag :type="recentChangeTagType(row.action)" :label="row.action" />
                <time>{{ dashboardDateTime(row.created_at) }}</time>
              </span>
            </el-button>
          </div>
          <div v-else class="dashboard-compact-empty">暂无资产变更</div>
        </el-card>
        <el-card shadow="never" class="dashboard-panel dashboard-panel--expiring" :class="{ 'is-empty': !upcomingExpirations.length }">
          <template #header><div class="dashboard-card-heading"><strong>即将过保设备</strong><el-button text type="primary" @click="goLedger">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div></template>
          <div v-if="upcomingExpirations.length" class="dashboard-expiring-list">
            <el-button
              v-for="row in upcomingExpirations"
              :key="row.asset_id"
              text
              native-type="button"
              class="dashboard-expiring-item"
              @click="openAssetDetail(row.asset_id)"
            >
              <span class="dashboard-expiring-main">
                <strong>{{ row.asset_name }}</strong>
                <small>{{ row.asset_no }}</small>
              </span>
              <span class="dashboard-expiring-meta">
                <StatusTag :type="expirationTagType(row)" :label="expirationLabel(row)" />
                <time>{{ dashboardDate(row.expiry_date) }}</time>
              </span>
            </el-button>
          </div>
          <div v-else class="dashboard-compact-empty">暂无即将过保设备</div>
        </el-card>
      </section>

      <el-card shadow="never" class="dashboard-panel dashboard-panel--actions">
        <template #header><strong>快速操作</strong></template>
        <div class="dashboard-action-grid">
          <button v-if="can('assets.manage')" type="button" class="dashboard-quick-action" @click="openNewAssetModal">
            <span class="dashboard-quick-action__icon"><img :src="metricAssets" alt="" aria-hidden="true" /></span>
            <span class="dashboard-quick-action__content"><strong class="dashboard-quick-action__title">新增设备</strong><small class="dashboard-quick-action__description">添加新的设备资产</small></span>
            <span class="dashboard-quick-action__chevron"><el-icon><ArrowRight /></el-icon></span>
          </button>
          <button v-if="can('racks.manage')" type="button" class="dashboard-quick-action" @click="openRackSection('manage')">
            <span class="dashboard-quick-action__icon"><img :src="metricRacks" alt="" aria-hidden="true" /></span>
            <span class="dashboard-quick-action__content"><strong class="dashboard-quick-action__title">新增机柜</strong><small class="dashboard-quick-action__description">创建新的机柜</small></span>
            <span class="dashboard-quick-action__chevron"><el-icon><ArrowRight /></el-icon></span>
          </button>
          <button v-if="can('assets.import')" type="button" class="dashboard-quick-action" @click="handleMenuSelect('asset-list')">
            <span class="dashboard-quick-action__icon"><img :src="quickImportIcon" alt="" aria-hidden="true" /></span>
            <span class="dashboard-quick-action__content"><strong class="dashboard-quick-action__title">导入设备</strong><small class="dashboard-quick-action__description">批量导入设备资产</small></span>
            <span class="dashboard-quick-action__chevron"><el-icon><ArrowRight /></el-icon></span>
          </button>
          <button v-if="can('inventory.manage')" type="button" class="dashboard-quick-action" @click="openInventory">
            <span class="dashboard-quick-action__icon"><img :src="inventoryCheckIcon" alt="" aria-hidden="true" /></span>
            <span class="dashboard-quick-action__content"><strong class="dashboard-quick-action__title">发起盘点</strong><small class="dashboard-quick-action__description">创建新的盘点任务</small></span>
            <span class="dashboard-quick-action__chevron"><el-icon><ArrowRight /></el-icon></span>
          </button>
        </div>
      </el-card>
    </div>
  </PageContainer>
</template>
