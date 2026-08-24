<script setup lang="ts">
import { computed } from "vue";
import {
  ArrowRight,
  OfficeBuilding,
  Warning,
} from "@element-plus/icons-vue";
import DashboardDonut from "./DashboardDonut.vue";
import StatisticCard from "./StatisticCard.vue";
import "../dashboard.css";
import metricAssets from "../assets/dashboard/metric-assets.png";
import metricRacks from "../assets/dashboard/metric-racks.png";
import quickImportIcon from "../assets/dashboard/quick-import.png";
import inventoryCheckIcon from "../assets/dashboard/inventory-check.png";
import assetsTotalIcon from "../assets/dashboard/generated-icons/assets-total.png";
import assetsInUseIcon from "../assets/dashboard/generated-icons/assets-in-use.png";
import assetsInStockIcon from "../assets/dashboard/generated-icons/assets-in-stock.png";
import assetsRepairIcon from "../assets/dashboard/generated-icons/assets-repair.png";
import faultOpenIcon from "../assets/dashboard/generated-icons/fault-open.png";
import licenseRiskIcon from "../assets/dashboard/generated-icons/license-risk.png";
import maintenanceDueIcon from "../assets/dashboard/generated-icons/maintenance-due.png";
import type {
  DashboardAlert,
  DashboardDataCenterOverview,
  DashboardLicenseSummary,
  DashboardRecentChange,
  DashboardStatus,
  DashboardOverview,
} from "../types";
import type { DashboardContext } from "../types/page-context";
import StatusTag, { type StatusTagType } from "./StatusTag.vue";
import PageContainer from "./page/PageContainer.vue";

const props = defineProps<{ context: DashboardContext }>();
const {
  dashboard,
  dashboardLoading,
  dashboardError,
  refreshDashboard,
  handleMenuSelect,
  goToAssets,
  goToRepairs,
  goToLicenses,
  openAssetDetail,
  openNewAssetModal,
  openRackSection,
  can,
  dashboardDateTime,
} = props.context;
// The template only reaches the main content branch after the null/error
// states above. Keep that runtime guard explicit while giving Vue's template
// type checker a non-null view of the loaded response.
const dashboardData = computed(() => dashboard.value as DashboardOverview);

const statusItems = computed<DashboardStatus[]>(
  () => dashboard.value?.status_distribution || [],
);
const statusTotal = computed(() => dashboard.value?.assets.total ?? 0);
const dataCenterItems = computed<DashboardDataCenterOverview[]>(
  () => dashboard.value?.data_center_overview || [],
);
const resourceItems = computed(() => dataCenterItems.value.slice(0, 5));
const recentChangeItems = computed<DashboardRecentChange[]>(
  () => (dashboard.value?.recent_changes || []).slice(0, 5),
);
const recentFaultItems = computed<DashboardAlert[]>(
  () => (dashboard.value?.recent_alerts || []).slice(0, 5),
);
const licenseSummary = computed<DashboardLicenseSummary | null>(
  () => dashboard.value?.licenses || null,
);
const licenseRiskTotal = computed(() => {
  const summary = licenseSummary.value;
  return summary ? summary.expiring + summary.expired : 0;
});

function openChanges() {
  if (can("audit.view")) handleMenuSelect("settings-audit");
  else if (can("assets.view")) goToAssets();
}

function openInventory() {
  handleMenuSelect("inventory");
}

const assetStatusValues = new Set(["in_stock", "in_use", "idle", "repair", "retired"]);

function openStatusDrilldown(item: { status?: string }) {
  const status = item.status && assetStatusValues.has(item.status) ? item.status : "";
  goToAssets(status ? { status } : {});
}

function openRecentFault(row: DashboardAlert) {
  if (!can("faults.view")) return;
  const query: Record<string, string> = { is_closed: "false" };
  if (row.asset_no) query.search = row.asset_no;
  goToRepairs(query);
}

function recentChangeTagType(action: string): StatusTagType {
  if (["故障", "报废"].includes(action)) return "danger";
  if (["状态变化", "下架"].includes(action)) return "warning";
  if (["新增", "上架"].includes(action)) return "success";
  return "info";
}

function utilization(value: number) {
  return Math.min(100, Math.max(0, Number(value || 0)));
}
</script>

<template>
  <PageContainer class="itam-page dashboard-shell">
    <div class="dashboard-body">
      <div v-if="dashboardError && dashboard" class="dashboard-error-banner" role="alert">
        <span>Dashboard 数据加载失败：{{ dashboardError }}</span>
        <el-button link type="primary" :loading="dashboardLoading" @click="refreshDashboard">重新加载</el-button>
      </div>

      <div v-if="!dashboard && !dashboardError" class="dashboard-skeleton" role="status" aria-live="polite">
        <div class="dashboard-skeleton__kpis">
          <span v-for="index in 4" :key="`kpi-${index}`" class="dashboard-skeleton__block" />
        </div>
        <div class="dashboard-skeleton__attention">
          <span v-for="index in 3" :key="`attention-${index}`" class="dashboard-skeleton__block" />
        </div>
        <div class="dashboard-skeleton__content">
          <span class="dashboard-skeleton__block" />
          <span class="dashboard-skeleton__block" />
        </div>
      </div>

      <div v-else-if="!dashboard && dashboardError" class="dashboard-state dashboard-state--error" role="alert">
        <el-icon><Warning /></el-icon>
        <strong>Dashboard 数据加载失败</strong>
        <span>{{ dashboardError }}</span>
        <el-button type="primary" plain :loading="dashboardLoading" @click="refreshDashboard">重新加载</el-button>
      </div>

      <template v-else>
        <section class="dashboard-kpi-row" aria-label="资产核心指标">
          <StatisticCard
            label="资产总数"
            :value="dashboardData.assets.total"
            subtitle="全部纳管资产"
            tone="blue"
            :icon-image="assetsTotalIcon"
            :clickable="can('assets.view')"
            @click="can('assets.view') && goToAssets()"
          />
          <StatisticCard
            label="使用中"
            :value="dashboardData.assets.in_use"
            subtitle="当前正在使用"
            tone="green"
            :icon-image="assetsInUseIcon"
            :clickable="can('assets.view')"
            @click="can('assets.view') && goToAssets({ status: 'in_use' })"
          />
          <StatisticCard
            label="在库"
            :value="dashboardData.assets.in_stock"
            subtitle="当前在库资产"
            tone="purple"
            :icon-image="assetsInStockIcon"
            :clickable="can('assets.view')"
            @click="can('assets.view') && goToAssets({ status: 'in_stock' })"
          />
          <StatisticCard
            label="维修中"
            :value="dashboardData.assets.repair"
            subtitle="存在未闭环维修"
            tone="orange"
            :icon-image="assetsRepairIcon"
            :clickable="can('assets.view')"
            @click="can('assets.view') && goToAssets({ status: 'repair' })"
          />
        </section>

        <section class="dashboard-attention-section" aria-labelledby="dashboard-attention-title">
          <div class="dashboard-section-heading">
            <strong id="dashboard-attention-title">立即关注</strong>
          </div>
          <div class="dashboard-attention-grid">
            <div
              v-if="can('faults.view') && dashboardData.alerts"
              class="dashboard-attention-card dashboard-attention-card--fault dashboard-attention-card--interactive"
              role="button"
              tabindex="0"
              @click="goToRepairs({ is_closed: 'false' })"
              @keydown.enter="goToRepairs({ is_closed: 'false' })"
              @keydown.space.prevent="goToRepairs({ is_closed: 'false' })"
            >
              <span class="dashboard-attention-card__icon"><img :src="faultOpenIcon" alt="" aria-hidden="true" /></span>
              <span class="dashboard-attention-card__content">
                <span class="dashboard-attention-card__title">未关闭故障</span>
                <strong>{{ dashboardData.alerts?.open_faults }}</strong>
                <small>{{ dashboardData.alerts?.open_faults ? "需要跟进的设备故障" : "当前无未关闭故障" }}</small>
              </span>
              <span class="dashboard-attention-card__action" aria-hidden="true">
                <el-icon class="dashboard-attention-card__arrow"><ArrowRight /></el-icon>
              </span>
            </div>
            <div v-if="can('licenses.view') && licenseSummary" class="dashboard-attention-card dashboard-attention-card--license">
              <span class="dashboard-attention-card__icon"><img :src="licenseRiskIcon" alt="" aria-hidden="true" /></span>
              <span class="dashboard-attention-card__content">
                <span class="dashboard-attention-card__title">软件许可风险</span>
                <strong>{{ licenseRiskTotal }}</strong>
                <small v-if="!licenseRiskTotal">当前无许可风险</small>
                <span v-else class="dashboard-attention-risk-links">
                  <el-button link class="dashboard-attention-risk-link" @click="goToLicenses({ status: 'expired' })">已过期 {{ licenseSummary.expired }}</el-button>
                  <el-button link class="dashboard-attention-risk-link" @click="goToLicenses({ status: 'expiring' })">即将到期 {{ licenseSummary.expiring }}</el-button>
                </span>
              </span>
            </div>
            <div
              class="dashboard-attention-card dashboard-attention-card--maintenance"
              :class="{ 'dashboard-attention-card--interactive': can('assets.view') }"
              :role="can('assets.view') ? 'button' : undefined"
              :tabindex="can('assets.view') ? 0 : undefined"
              @click="can('assets.view') && goToAssets({ warranty: 'within_30_days' })"
              @keydown.enter="can('assets.view') && goToAssets({ warranty: 'within_30_days' })"
              @keydown.space.prevent="can('assets.view') && goToAssets({ warranty: 'within_30_days' })"
            >
              <span class="dashboard-attention-card__icon"><img :src="maintenanceDueIcon" alt="" aria-hidden="true" /></span>
              <span class="dashboard-attention-card__content">
                <span class="dashboard-attention-card__title">30 天内维保到期</span>
                <strong>{{ dashboardData.expiring.within_30_days }}</strong>
                <small>
                  <el-button
                    v-if="can('assets.view')"
                    link
                    class="dashboard-attention-risk-link"
                    @click.stop="goToAssets({ warranty: 'expired' })"
                  >已过期 {{ dashboardData.expiring.expired || 0 }} 项</el-button>
                  <span v-else>已过期 {{ dashboardData.expiring.expired || 0 }} 项</span>
                </small>
              </span>
              <span v-if="can('assets.view')" class="dashboard-attention-card__action" aria-hidden="true">
                <el-icon class="dashboard-attention-card__arrow"><ArrowRight /></el-icon>
              </span>
            </div>
          </div>
        </section>

        <section class="dashboard-overview-row">
          <el-card shadow="never" class="dashboard-panel dashboard-panel--status">
            <template #header>
              <div class="dashboard-card-heading"><strong>资产状态分布</strong><el-button v-if="can('assets.view')" text type="primary" @click="goToAssets()">详情 <el-icon><ArrowRight /></el-icon></el-button></div>
            </template>
            <DashboardDonut
              :items="statusItems"
              :total="statusTotal"
              center-label="资产总数"
              :selectable="can('assets.view')"
              @select="openStatusDrilldown"
            />
          </el-card>
          <el-card shadow="never" class="dashboard-panel dashboard-panel--resources">
            <template #header>
              <div class="dashboard-card-heading"><strong>数据中心 / 机柜资源概览</strong><el-button v-if="can('assets.view')" text type="primary" @click="goToAssets()">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div>
            </template>
            <div v-if="resourceItems.length" class="dashboard-resource-table" role="table" aria-label="数据中心资源概览">
              <div class="dashboard-resource-row dashboard-resource-row--header" role="row">
                <span role="columnheader">数据中心</span>
                <span role="columnheader">机房 / 机柜</span>
                <span role="columnheader">已用 U / 总 U</span>
                <span role="columnheader">U 位利用率</span>
              </div>
              <div
                v-for="item in resourceItems"
                :key="item.data_center_id"
                class="dashboard-resource-row"
                :class="{ 'dashboard-resource-row--interactive': can('assets.view') }"
                role="row"
                :tabindex="can('assets.view') ? 0 : undefined"
                :aria-label="can('assets.view') ? `查看${item.data_center}资产` : undefined"
                @click="can('assets.view') && goToAssets({ data_center: String(item.data_center_id) })"
                @keydown.enter="can('assets.view') && goToAssets({ data_center: String(item.data_center_id) })"
                @keydown.space.prevent="can('assets.view') && goToAssets({ data_center: String(item.data_center_id) })"
              >
                <strong class="dashboard-resource-name" role="cell"><OfficeBuilding />{{ item.data_center }}</strong>
                <span role="cell">{{ item.room_count }} / {{ item.rack_count }}</span>
                <span role="cell">{{ item.used_u }} / {{ item.total_u }}</span>
                <span class="dashboard-resource-utilization" role="cell">
                  <b>{{ item.utilization.toFixed(1) }}%</b>
                  <el-progress :percentage="utilization(item.utilization)" :show-text="false" :stroke-width="4" />
                </span>
              </div>
            </div>
            <div v-else class="dashboard-compact-empty">暂无数据中心资源</div>
          </el-card>
        </section>

        <section class="dashboard-summary-row" :class="{ 'is-single': !can('faults.view') }">
          <el-card shadow="never" class="dashboard-panel dashboard-panel--activity" :class="{ 'is-empty': !recentChangeItems.length }">
            <template #header><div class="dashboard-card-heading"><strong>最近资产变更</strong><el-button v-if="can('audit.view') || can('assets.view')" text type="primary" @click="openChanges">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div></template>
            <div v-if="recentChangeItems.length" class="dashboard-activity-list">
              <component
                v-for="row in recentChangeItems"
                :key="row.id"
                :is="can('assets.view') ? 'button' : 'div'"
                :type="can('assets.view') ? 'button' : undefined"
                class="dashboard-activity-item"
                @click="can('assets.view') && openAssetDetail(row.asset_id)"
              >
                <time class="dashboard-activity-time">{{ dashboardDateTime(row.created_at) }}</time>
                <span class="dashboard-activity-main">
                  <strong>{{ row.asset_no }} / {{ row.asset_name }}</strong>
                  <small>{{ row.action }} · {{ row.location || "未上架" }}</small>
                </span>
                <span class="dashboard-activity-meta">
                  <span>{{ row.actor_name || "系统" }}</span>
                  <StatusTag :type="recentChangeTagType(row.action)" :label="row.action" />
                </span>
              </component>
            </div>
            <div v-else class="dashboard-compact-empty">暂无资产变更</div>
          </el-card>

          <el-card v-if="can('faults.view')" shadow="never" class="dashboard-panel dashboard-panel--faults" :class="{ 'is-empty': !recentFaultItems.length }">
            <template #header><div class="dashboard-card-heading"><strong>最近未关闭故障</strong><el-button text type="primary" @click="goToRepairs({ is_closed: 'false' })">查看全部 <el-icon><ArrowRight /></el-icon></el-button></div></template>
            <div v-if="recentFaultItems.length" class="dashboard-fault-list">
              <el-button
                v-for="row in recentFaultItems"
                :key="row.id"
                text
                native-type="button"
                class="dashboard-fault-item"
                @click="openRecentFault(row)"
              >
                <time class="dashboard-fault-time">{{ dashboardDateTime(row.occurred_at) }}</time>
                <span class="dashboard-fault-main">
                  <strong>{{ row.asset_no }} / {{ row.asset_name }}</strong>
                  <small>{{ row.title }}</small>
                </span>
                <StatusTag type="warning" label="未关闭" />
              </el-button>
            </div>
            <div v-else class="dashboard-compact-empty">暂无未关闭故障</div>
          </el-card>
        </section>
      </template>

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
          <button v-if="can('assets.manage')" type="button" class="dashboard-quick-action" @click="handleMenuSelect('asset-list')">
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
