<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowDown,
  ArrowRight,
  CircleCheck,
  Clock,
  DataAnalysis,
  DocumentChecked,
  Key,
  Monitor,
  OfficeBuilding,
  Plus,
  Refresh,
  Timer,
  Warning,
} from "@element-plus/icons-vue";
import DashboardDonut from "./DashboardDonut.vue";
import "../dashboard.css";
import type {
  DashboardAlert,
  DashboardInventorySummary,
  DashboardLicenseSummary,
  DashboardRecentChange,
  DashboardStatus,
  DashboardTypeDistribution,
  DashboardOverview,
} from "../types";
import type { DashboardContext } from "../page-context";
import StatusTag, { type StatusTagType } from "./StatusTag.vue";
import PageContainer from "./page/PageContainer.vue";
import PageHeader from "./page/PageHeader.vue";
import ResourceState from "./ResourceState.vue";
import { isAssetStatus } from "../business-enums";

const props = defineProps<{ context: DashboardContext }>();
const { t } = useI18n();
const {
  dashboard,
  dashboardLoading,
  dashboardError,
  dashboardUpdatedAt,
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

// The template only reaches the loaded branch after the null/error states
// above. Keep this explicit cast so the template remains strongly typed.
const dashboardData = computed(() => dashboard.value as DashboardOverview);

const statusItems = computed<DashboardStatus[]>(
  () => dashboard.value?.status_distribution || [],
);
const statusTotal = computed(() => dashboard.value?.assets.total ?? 0);
const typeItems = computed<DashboardTypeDistribution[]>(
  () => (dashboard.value?.type_distribution || []).slice(0, 6),
);
const recentChangeItems = computed<DashboardRecentChange[]>(
  () => (dashboard.value?.recent_changes || []).slice(0, 5),
);
const recentFaultItems = computed<DashboardAlert[]>(
  () => (dashboard.value?.recent_alerts || []).slice(0, 5),
);
const licenseSummary = computed<DashboardLicenseSummary | null>(
  () => dashboard.value?.licenses || null,
);
const inventorySummary = computed<DashboardInventorySummary | null>(
  () => dashboard.value?.inventory_summary || null,
);
const licenseRiskTotal = computed(() => {
  const summary = licenseSummary.value;
  return summary ? summary.expiring + summary.expired : 0;
});
const rackTotalU = computed(() => {
  const racks = dashboard.value?.racks;
  return racks ? racks.used_u + racks.free_u : 0;
});
const rackUtilization = computed(() => ratio(
  dashboard.value?.racks.used_u ?? 0,
  rackTotalU.value,
));
const inUseRate = computed(() => ratio(
  dashboard.value?.assets.in_use ?? 0,
  dashboard.value?.assets.total ?? 0,
));
const dashboardLoadedAt = computed(() => dashboardUpdatedAt.value
  ? dashboardDateTime(dashboardUpdatedAt.value)
  : "");
const hasQuickActions = computed(() => (
  can("assets.manage") ||
  can("assets.view") ||
  can("racks.view") ||
  can("inventory.view")
));

function ratio(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function utilization(value: number) {
  return Math.min(100, Math.max(0, Number(value || 0)));
}

function typePercent(item: DashboardTypeDistribution) {
  return utilization(ratio(item.count, statusTotal.value));
}

function openChanges() {
  if (can("audit.view")) handleMenuSelect("settings-audit");
  else if (can("assets.view")) goToAssets();
}

function openStatusDrilldown(item: { status?: string }) {
  const status = item.status && isAssetStatus(item.status) ? item.status : "";
  goToAssets(status ? { status } : {});
}

function openRecentFault(row: DashboardAlert) {
  if (!can("faults.view")) return;
  const query: Record<string, string> = { is_closed: "false" };
  if (row.asset_no) query.search = row.asset_no;
  goToRepairs(query);
}

function openResourceLocations() {
  if (!can("racks.view")) return;
  openRackSection("locations");
}

function openInventory() {
  if (!can("inventory.view")) return;
  handleMenuSelect("inventory");
}

function recentChangeTagType(action: string): StatusTagType {
  if (["故障", "报废", "fault", "retired"].includes(action)) return "danger";
  if (["状态变化", "下架", "status_change", "unmounted"].includes(action)) return "warning";
  if (["新增", "上架", "created", "mounted"].includes(action)) return "success";
  return "info";
}

function recentChangeLabel(action: string): string {
  const labels: Record<string, string> = {
    "故障": "dashboard.actionFault",
    "报废": "dashboard.actionRetire",
    "状态变化": "dashboard.actionStatusChange",
    "下架": "dashboard.actionUnmount",
    "新增": "dashboard.actionCreate",
    "上架": "dashboard.actionMount",
    fault: "dashboard.actionFault",
    retired: "dashboard.actionRetire",
    status_change: "dashboard.actionStatusChange",
    unmounted: "dashboard.actionUnmount",
    created: "dashboard.actionCreate",
    mounted: "dashboard.actionMount",
  };
  return labels[action] ? t(labels[action]) : action;
}
</script>

<template>
  <PageContainer class="infrix-page dashboard-shell">
    <template #header>
      <PageHeader
        :title="t('dashboard.overviewTitle')"
      >
        <template #actions>
          <div class="dashboard-header-actions">
            <span v-if="dashboardLoadedAt" class="dashboard-loaded-at">
              <el-icon aria-hidden="true"><Clock /></el-icon>
              {{ t('dashboard.loadedAt', { time: dashboardLoadedAt }) }}
            </span>
            <el-button
              text
              type="primary"
              :loading="dashboardLoading"
              :aria-label="t('dashboard.refresh')"
              @click="refreshDashboard"
            >
              <el-icon aria-hidden="true"><Refresh /></el-icon>{{ t('dashboard.refresh') }}
            </el-button>
            <el-dropdown v-if="hasQuickActions" class="dashboard-quick-actions" trigger="click">
              <el-button text type="primary">
                <el-icon aria-hidden="true"><Plus /></el-icon>{{ t('dashboard.quickActions') }}
                <el-icon aria-hidden="true"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="can('assets.manage')" @click="openNewAssetModal">
                    <el-icon><Plus /></el-icon>{{ t('dashboard.newAsset') }}
                  </el-dropdown-item>
                  <el-dropdown-item v-if="can('assets.view')" @click="goToAssets">
                    <el-icon><Monitor /></el-icon>{{ t('dashboard.viewAssets') }}
                  </el-dropdown-item>
                  <el-dropdown-item v-if="can('racks.view')" @click="openResourceLocations">
                    <el-icon><OfficeBuilding /></el-icon>{{ t('dashboard.viewLocations') }}
                  </el-dropdown-item>
                  <el-dropdown-item v-if="can('inventory.view')" @click="openInventory">
                    <el-icon><DocumentChecked /></el-icon>{{ t('dashboard.viewInventory') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </PageHeader>
    </template>

    <div class="dashboard-body">
      <el-alert
        v-if="dashboardError && dashboard"
        class="dashboard-error-banner"
        :title="t('dashboard.dataLoadFailed')"
        :description="dashboardError"
        type="error"
        show-icon
        :closable="false"
      >
        <template #default>
          <el-button link type="primary" :loading="dashboardLoading" @click="refreshDashboard">{{ t('common.retry') }}</el-button>
        </template>
      </el-alert>

      <el-skeleton
        v-if="!dashboard && !dashboardError"
        class="dashboard-skeleton"
        :rows="10"
        animated
        role="status"
        aria-live="polite"
      />

      <el-result
        v-else-if="!dashboard && dashboardError"
        class="dashboard-state dashboard-state--error"
        icon="error"
        :title="t('dashboard.dataLoadFailed')"
        :sub-title="dashboardError"
      >
        <template #extra>
          <el-button type="primary" plain :loading="dashboardLoading" @click="refreshDashboard">{{ t('common.retry') }}</el-button>
        </template>
      </el-result>

      <template v-else>
        <section class="dashboard-kpi-grid" :aria-label="t('dashboard.assetCoreMetrics')">
          <el-card
            shadow="never"
            class="dashboard-kpi-card dashboard-kpi-card--assets"
            :class="{ 'is-interactive': can('assets.view') }"
            :role="can('assets.view') ? 'button' : undefined"
            :tabindex="can('assets.view') ? 0 : undefined"
            @click="can('assets.view') && goToAssets()"
            @keydown.enter="can('assets.view') && goToAssets()"
            @keydown.space.prevent="can('assets.view') && goToAssets()"
          >
            <div class="dashboard-kpi-card__label">
              <span class="dashboard-kpi-card__icon" aria-hidden="true"><Monitor /></span>
              <span>{{ t('dashboard.totalAssets') }}</span>
            </div>
            <strong class="dashboard-kpi-card__value">{{ dashboardData.assets.total }}</strong>
            <div class="dashboard-kpi-breakdown">
              <span>{{ dashboardData.assets.in_use }} {{ t('dashboard.assetsInUse') }}</span>
              <span>{{ dashboardData.assets.in_stock }} {{ t('dashboard.assetsInStock') }}</span>
              <span>{{ dashboardData.assets.repair }} {{ t('dashboard.assetsInRepair') }}</span>
            </div>
          </el-card>

          <el-card
            shadow="never"
            class="dashboard-kpi-card dashboard-kpi-card--usage"
            :class="{ 'is-interactive': can('assets.view') }"
            :role="can('assets.view') ? 'button' : undefined"
            :tabindex="can('assets.view') ? 0 : undefined"
            @click="can('assets.view') && goToAssets({ status: 'in_use' })"
            @keydown.enter="can('assets.view') && goToAssets({ status: 'in_use' })"
            @keydown.space.prevent="can('assets.view') && goToAssets({ status: 'in_use' })"
          >
            <div class="dashboard-kpi-card__label">
              <span class="dashboard-kpi-card__icon" aria-hidden="true"><CircleCheck /></span>
              <span>{{ t('dashboard.inUseRate') }}</span>
            </div>
            <strong class="dashboard-kpi-card__value">{{ inUseRate.toFixed(1) }}%</strong>
            <div class="dashboard-kpi-card__support">{{ dashboardData.assets.in_use }} {{ t('dashboard.assets') }} · {{ t('dashboard.currentlyInUse') }}</div>
          </el-card>

          <el-card
            shadow="never"
            class="dashboard-kpi-card dashboard-kpi-card--capacity"
            :class="{ 'is-interactive': can('racks.view') }"
            :role="can('racks.view') ? 'button' : undefined"
            :tabindex="can('racks.view') ? 0 : undefined"
            @click="can('racks.view') && openResourceLocations()"
            @keydown.enter="can('racks.view') && openResourceLocations()"
            @keydown.space.prevent="can('racks.view') && openResourceLocations()"
          >
            <div class="dashboard-kpi-card__label">
              <span class="dashboard-kpi-card__icon" aria-hidden="true"><DataAnalysis /></span>
              <span>{{ t('dashboard.rackCapacity') }}</span>
            </div>
            <strong class="dashboard-kpi-card__value">{{ rackUtilization.toFixed(1) }}%</strong>
            <div class="dashboard-kpi-card__support">{{ dashboardData.racks.used_u }} / {{ rackTotalU }} U · {{ dashboardData.racks.free_u }} {{ t('dashboard.freeCapacity') }}</div>
          </el-card>

          <el-card
            shadow="never"
            class="dashboard-kpi-card dashboard-kpi-card--locations"
            :class="{ 'is-interactive': can('racks.view') }"
            :role="can('racks.view') ? 'button' : undefined"
            :tabindex="can('racks.view') ? 0 : undefined"
            @click="can('racks.view') && openResourceLocations()"
            @keydown.enter="can('racks.view') && openResourceLocations()"
            @keydown.space.prevent="can('racks.view') && openResourceLocations()"
          >
            <div class="dashboard-kpi-card__label">
              <span class="dashboard-kpi-card__icon" aria-hidden="true"><OfficeBuilding /></span>
              <span>{{ t('dashboard.locations') }}</span>
            </div>
            <strong class="dashboard-kpi-card__value">{{ dashboardData.data_centers?.total || 0 }}</strong>
            <div class="dashboard-kpi-card__support">{{ dashboardData.racks.total }} {{ t('dashboard.racks') }} · {{ t('dashboard.activeInfrastructure') }}</div>
          </el-card>
        </section>

        <section class="dashboard-risk-section" aria-labelledby="dashboard-risk-title">
          <div class="dashboard-section-heading">
            <strong id="dashboard-risk-title">{{ t('dashboard.riskSummaryTitle') }}</strong>
          </div>
          <div class="dashboard-risk-grid">
            <button
              v-if="can('faults.view') && dashboardData.alerts"
              type="button"
              class="dashboard-risk-item dashboard-risk-item--fault"
              @click="goToRepairs({ is_closed: 'false' })"
            >
              <span class="dashboard-risk-item__icon" aria-hidden="true"><Warning /></span>
              <span class="dashboard-risk-item__copy">
                <small>{{ t('dashboard.openFaults') }}</small>
                <strong>{{ dashboardData.alerts.open_faults }}</strong>
              </span>
              <el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </button>
            <button
              v-if="can('licenses.view') && licenseSummary"
              type="button"
              class="dashboard-risk-item dashboard-risk-item--license"
              @click="goToLicenses()"
            >
              <span class="dashboard-risk-item__icon" aria-hidden="true"><Key /></span>
              <span class="dashboard-risk-item__copy">
                <small>{{ t('dashboard.licenseRisk') }}</small>
                <strong>{{ licenseRiskTotal }}</strong>
                <span>{{ t('dashboard.expiredItems', { count: licenseSummary.expired }) }} · {{ t('dashboard.expiringItems', { count: licenseSummary.expiring }) }}</span>
              </span>
              <el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </button>
            <button
              v-if="can('assets.view')"
              type="button"
              class="dashboard-risk-item dashboard-risk-item--maintenance"
              @click="goToAssets({ warranty: 'within_30_days' })"
            >
              <span class="dashboard-risk-item__icon" aria-hidden="true"><Timer /></span>
              <span class="dashboard-risk-item__copy">
                <small>{{ t('dashboard.warrantyExpiring') }}</small>
                <strong>{{ dashboardData.expiring.within_30_days }}</strong>
                <span>{{ t('dashboard.expiredItems', { count: dashboardData.expiring.expired || 0 }) }}</span>
              </span>
              <el-icon aria-hidden="true"><ArrowRight /></el-icon>
            </button>
            <button
              v-if="inventorySummary"
              type="button"
              class="dashboard-risk-item dashboard-risk-item--inventory"
              :class="{ 'is-static': !can('inventory.view') }"
              :disabled="!can('inventory.view')"
              @click="openInventory"
            >
              <span class="dashboard-risk-item__icon" aria-hidden="true"><DocumentChecked /></span>
              <span class="dashboard-risk-item__copy">
                <small>{{ t('dashboard.inventoryAttention') }}</small>
                <strong>{{ inventorySummary.pending + inventorySummary.abnormal }}</strong>
                <span>{{ t('dashboard.inventoryAttentionDetail', { pending: inventorySummary.pending, abnormal: inventorySummary.abnormal }) }}</span>
              </span>
              <el-icon v-if="can('inventory.view')" aria-hidden="true"><ArrowRight /></el-icon>
            </button>
          </div>
        </section>

        <section class="dashboard-analysis-grid">
          <el-card shadow="never" class="dashboard-panel dashboard-panel--status">
            <template #header>
              <div class="dashboard-card-heading">
                <strong>{{ t('dashboard.portfolioHealthTitle') }}</strong>
                <el-button v-if="can('assets.view')" text type="primary" @click="goToAssets()">
                  {{ t('common.details') }} <el-icon><ArrowRight /></el-icon>
                </el-button>
              </div>
            </template>
            <DashboardDonut
              :items="statusItems"
              :total="statusTotal"
              :center-label="t('dashboard.totalAssets')"
              :selectable="can('assets.view')"
              @select="openStatusDrilldown"
            />
          </el-card>

          <el-card shadow="never" class="dashboard-panel dashboard-panel--types">
            <template #header>
              <div class="dashboard-card-heading">
                <strong>{{ t('dashboard.assetMixTitle') }}</strong>
              </div>
            </template>
            <ResourceState :empty="!typeItems.length" :empty-text="t('dashboard.noTypeData')">
              <div class="dashboard-type-list">
                <div v-for="item in typeItems" :key="item.type || item.label" class="dashboard-type-row">
                  <div class="dashboard-type-row__label">
                    <span>{{ item.label || item.type }}</span>
                    <strong>{{ item.count }}</strong>
                  </div>
                  <div class="dashboard-type-row__track" role="progressbar" :aria-valuenow="item.count" aria-valuemin="0" :aria-valuemax="statusTotal">
                    <span :style="{ width: `${typePercent(item)}%`, backgroundColor: item.color }"></span>
                  </div>
                </div>
              </div>
            </ResourceState>
          </el-card>
        </section>

        <section class="dashboard-summary-grid">
          <el-card shadow="never" class="dashboard-panel dashboard-panel--activity" :class="{ 'is-empty': !recentChangeItems.length }">
            <template #header>
              <div class="dashboard-card-heading">
                <strong>{{ t('dashboard.activityTitle') }}</strong>
                <el-button v-if="can('audit.view') || can('assets.view')" text type="primary" @click="openChanges">
                  {{ t('dashboard.viewAll') }} <el-icon><ArrowRight /></el-icon>
                </el-button>
              </div>
            </template>
            <ResourceState :empty="!recentChangeItems.length" :empty-text="t('dashboard.noAssetChanges')">
              <div class="dashboard-activity-list">
                <el-button
                  v-for="row in recentChangeItems"
                  :key="row.id"
                  :tag="can('assets.view') ? 'button' : 'div'"
                  text
                  native-type="button"
                  class="dashboard-activity-item"
                  :class="{ 'is-static': !can('assets.view') }"
                  @click="can('assets.view') && openAssetDetail(row.asset_id)"
                >
                  <time class="dashboard-activity-time">{{ dashboardDateTime(row.created_at) }}</time>
                  <span class="dashboard-activity-main">
                    <strong>{{ row.asset_no }} / {{ row.asset_name }}</strong>
                    <small>{{ recentChangeLabel(row.action) }} · {{ row.location || t('dashboard.notMounted') }}</small>
                  </span>
                  <span class="dashboard-activity-meta">
                    <span>{{ row.actor_name || t('dashboard.systemActor') }}</span>
                    <StatusTag :tone="recentChangeTagType(row.action)" :label="recentChangeLabel(row.action)" />
                  </span>
                </el-button>
              </div>
            </ResourceState>
          </el-card>

          <el-card v-if="can('faults.view')" shadow="never" class="dashboard-panel dashboard-panel--faults" :class="{ 'is-empty': !recentFaultItems.length }">
            <template #header>
              <div class="dashboard-card-heading">
                <strong>{{ t('dashboard.faultActivityTitle') }}</strong>
                <el-button text type="primary" @click="goToRepairs({ is_closed: 'false' })">
                  {{ t('dashboard.viewAll') }} <el-icon><ArrowRight /></el-icon>
                </el-button>
              </div>
            </template>
            <ResourceState :empty="!recentFaultItems.length" :empty-text="t('dashboard.noOpenFaultList')">
              <div class="dashboard-fault-list">
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
                  <StatusTag tone="warning" :label="t('status.open')" />
                </el-button>
              </div>
            </ResourceState>
          </el-card>
        </section>
      </template>
    </div>
  </PageContainer>
</template>
