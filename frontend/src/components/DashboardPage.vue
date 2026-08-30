<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowRight,
  Box,
  CircleCheck,
  Key,
  Monitor,
  OfficeBuilding,
  Timer,
  Tools,
  Warning,
} from "@element-plus/icons-vue";
import DashboardDonut from "./DashboardDonut.vue";
import "../dashboard.css";
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
import ResourceState from "./ResourceState.vue";
import { isAssetStatus } from "../business-enums";

const props = defineProps<{ context: DashboardContext }>();
const { t } = useI18n();
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

function openDataCenterRacks(item: DashboardDataCenterOverview) {
  if (!can("racks.view")) return;
  openRackSection("view", { data_center: String(item.data_center_id) });
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

function utilization(value: number) {
  return Math.min(100, Math.max(0, Number(value || 0)));
}
</script>

<template>
  <PageContainer class="itam-page dashboard-shell">
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
        <section class="dashboard-kpi-row" :aria-label="t('dashboard.assetCoreMetrics')">
          <el-card
            shadow="never"
            class="dashboard-stat-card dashboard-stat-card--assets"
            :class="{ 'dashboard-stat-card--interactive': can('assets.view') }"
            :role="can('assets.view') ? 'button' : undefined"
            :tabindex="can('assets.view') ? 0 : undefined"
            @click="can('assets.view') && goToAssets()"
            @keydown.enter="can('assets.view') && goToAssets()"
            @keydown.space.prevent="can('assets.view') && goToAssets()"
          >
            <div class="dashboard-stat">
              <span class="dashboard-stat__icon" aria-hidden="true"><el-icon :size="20"><Monitor /></el-icon></span>
              <div class="dashboard-stat__content">
                <el-statistic :title="t('dashboard.totalAssets')" :value="dashboardData.assets.total" />
                <div class="dashboard-stat__hint">{{ t('dashboard.allManagedAssets') }}</div>
              </div>
            </div>
          </el-card>
          <el-card
            shadow="never"
            class="dashboard-stat-card dashboard-stat-card--in-use"
            :class="{ 'dashboard-stat-card--interactive': can('assets.view') }"
            :role="can('assets.view') ? 'button' : undefined"
            :tabindex="can('assets.view') ? 0 : undefined"
            @click="can('assets.view') && goToAssets({ status: 'in_use' })"
            @keydown.enter="can('assets.view') && goToAssets({ status: 'in_use' })"
            @keydown.space.prevent="can('assets.view') && goToAssets({ status: 'in_use' })"
          >
            <div class="dashboard-stat">
              <span class="dashboard-stat__icon" aria-hidden="true"><el-icon :size="20"><CircleCheck /></el-icon></span>
              <div class="dashboard-stat__content">
                <el-statistic :title="t('dashboard.assetsInUse')" :value="dashboardData.assets.in_use" />
                <div class="dashboard-stat__hint">{{ t('dashboard.currentlyInUse') }}</div>
              </div>
            </div>
          </el-card>
          <el-card
            shadow="never"
            class="dashboard-stat-card dashboard-stat-card--in-stock"
            :class="{ 'dashboard-stat-card--interactive': can('assets.view') }"
            :role="can('assets.view') ? 'button' : undefined"
            :tabindex="can('assets.view') ? 0 : undefined"
            @click="can('assets.view') && goToAssets({ status: 'in_stock' })"
            @keydown.enter="can('assets.view') && goToAssets({ status: 'in_stock' })"
            @keydown.space.prevent="can('assets.view') && goToAssets({ status: 'in_stock' })"
          >
            <div class="dashboard-stat">
              <span class="dashboard-stat__icon" aria-hidden="true"><el-icon :size="20"><Box /></el-icon></span>
              <div class="dashboard-stat__content">
                <el-statistic :title="t('dashboard.assetsInStock')" :value="dashboardData.assets.in_stock" />
                <div class="dashboard-stat__hint">{{ t('dashboard.currentlyInStock') }}</div>
              </div>
            </div>
          </el-card>
          <el-card
            shadow="never"
            class="dashboard-stat-card dashboard-stat-card--repair"
            :class="{ 'dashboard-stat-card--interactive': can('assets.view') }"
            :role="can('assets.view') ? 'button' : undefined"
            :tabindex="can('assets.view') ? 0 : undefined"
            @click="can('assets.view') && goToAssets({ status: 'repair' })"
            @keydown.enter="can('assets.view') && goToAssets({ status: 'repair' })"
            @keydown.space.prevent="can('assets.view') && goToAssets({ status: 'repair' })"
          >
            <div class="dashboard-stat">
              <span class="dashboard-stat__icon" aria-hidden="true"><el-icon :size="20"><Tools /></el-icon></span>
              <div class="dashboard-stat__content">
                <el-statistic :title="t('dashboard.assetsInRepair')" :value="dashboardData.assets.repair" />
                <div class="dashboard-stat__hint">{{ t('dashboard.currentlyUnderRepair') }}</div>
              </div>
            </div>
          </el-card>
        </section>

        <section class="dashboard-attention-section" aria-labelledby="dashboard-attention-title">
          <div class="dashboard-section-heading">
            <strong id="dashboard-attention-title">{{ t('dashboard.attention') }}</strong>
          </div>
          <div class="dashboard-attention-grid">
            <el-card
              v-if="can('faults.view') && dashboardData.alerts"
              shadow="never"
              class="dashboard-attention-card dashboard-attention-card--fault dashboard-attention-card--interactive"
              role="button"
              tabindex="0"
              @click="goToRepairs({ is_closed: 'false' })"
              @keydown.enter="goToRepairs({ is_closed: 'false' })"
              @keydown.space.prevent="goToRepairs({ is_closed: 'false' })"
            >
              <span class="dashboard-attention-card__icon" aria-hidden="true"><el-icon :size="20"><Warning /></el-icon></span>
              <span class="dashboard-attention-card__content">
                <span class="dashboard-attention-card__title">{{ t('dashboard.openFaults') }}</span>
                <strong>{{ dashboardData.alerts?.open_faults }}</strong>
                <small>{{ dashboardData.alerts?.open_faults ? t('dashboard.needsFollowUp') : t('dashboard.noOpenFaults') }}</small>
              </span>
              <span class="dashboard-attention-card__action" aria-hidden="true">
                <el-icon class="dashboard-attention-card__arrow"><ArrowRight /></el-icon>
              </span>
            </el-card>
            <el-card
              v-if="can('licenses.view') && licenseSummary"
              shadow="never"
              class="dashboard-attention-card dashboard-attention-card--license dashboard-attention-card--interactive"
              role="button"
              tabindex="0"
              @click="goToLicenses()"
              @keydown.enter="goToLicenses()"
              @keydown.space.prevent="goToLicenses()"
            >
              <span class="dashboard-attention-card__icon" aria-hidden="true"><el-icon :size="20"><Key /></el-icon></span>
              <span class="dashboard-attention-card__content">
                <span class="dashboard-attention-card__title">{{ t('dashboard.licenseRisk') }}</span>
                <strong>{{ licenseRiskTotal }}</strong>
                <small v-if="!licenseRiskTotal">{{ t('dashboard.noLicenseRisk') }}</small>
                <span v-else class="dashboard-attention-risk-links">
                  <el-button link class="dashboard-attention-risk-link" @click.stop="goToLicenses({ status: 'expired' })" @keydown.stop>{{ t('status.expired') }} {{ licenseSummary.expired }}</el-button>
                  <el-button link class="dashboard-attention-risk-link" @click.stop="goToLicenses({ status: 'expiring' })" @keydown.stop>{{ t('status.expiring') }} {{ licenseSummary.expiring }}</el-button>
                </span>
              </span>
              <span class="dashboard-attention-card__action" aria-hidden="true">
                <el-icon class="dashboard-attention-card__arrow"><ArrowRight /></el-icon>
              </span>
            </el-card>
            <el-card
              class="dashboard-attention-card dashboard-attention-card--maintenance"
              shadow="never"
              :class="{ 'dashboard-attention-card--interactive': can('assets.view') }"
              :role="can('assets.view') ? 'button' : undefined"
              :tabindex="can('assets.view') ? 0 : undefined"
              @click="can('assets.view') && goToAssets({ warranty: 'within_30_days' })"
              @keydown.enter="can('assets.view') && goToAssets({ warranty: 'within_30_days' })"
              @keydown.space.prevent="can('assets.view') && goToAssets({ warranty: 'within_30_days' })"
            >
              <span class="dashboard-attention-card__icon" aria-hidden="true"><el-icon :size="20"><Timer /></el-icon></span>
              <span class="dashboard-attention-card__content">
                <span class="dashboard-attention-card__title">{{ t('dashboard.warrantyExpiring') }}</span>
                <strong>{{ dashboardData.expiring.within_30_days }}</strong>
                <small>
                  <el-button
                    v-if="can('assets.view')"
                    link
                    class="dashboard-attention-risk-link"
                    @click.stop="goToAssets({ warranty: 'expired' })"
                    @keydown.stop
                  >{{ t('dashboard.expiredItems', { count: dashboardData.expiring.expired || 0 }) }}</el-button>
                  <span v-else>{{ t('dashboard.expiredItems', { count: dashboardData.expiring.expired || 0 }) }}</span>
                </small>
              </span>
              <span v-if="can('assets.view')" class="dashboard-attention-card__action" aria-hidden="true">
                <el-icon class="dashboard-attention-card__arrow"><ArrowRight /></el-icon>
              </span>
            </el-card>
          </div>
        </section>

        <section class="dashboard-overview-row">
          <el-card shadow="never" class="dashboard-panel dashboard-panel--status">
            <template #header>
              <div class="dashboard-card-heading"><strong>{{ t('dashboard.statusDistribution') }}</strong><el-button v-if="can('assets.view')" text type="primary" @click="goToAssets()">{{ t('common.details') }} <el-icon><ArrowRight /></el-icon></el-button></div>
            </template>
            <DashboardDonut
              :items="statusItems"
              :total="statusTotal"
              :center-label="t('dashboard.totalAssets')"
              :selectable="can('assets.view')"
              @select="openStatusDrilldown"
            />
          </el-card>
          <el-card shadow="never" class="dashboard-panel dashboard-panel--resources">
            <template #header>
              <div class="dashboard-card-heading"><strong>{{ t('dashboard.resourceOverview') }}</strong><el-button v-if="can('racks.view')" text type="primary" @click="openResourceLocations">{{ t('dashboard.viewAll') }} <el-icon><ArrowRight /></el-icon></el-button></div>
            </template>
            <ResourceState :empty="!resourceItems.length" :empty-text="t('dashboard.noResource')">
              <el-table
                class="dashboard-resource-table"
                :data="resourceItems"
                row-key="data_center_id"
                table-layout="fixed"
                @row-click="openDataCenterRacks"
              >
                <el-table-column :label="t('dashboard.dataCenter')" min-width="160">
                  <template #default="{ row }">
                    <el-button
                      v-if="can('racks.view')"
                      link
                      type="primary"
                      class="dashboard-resource-name"
                      :aria-label="t('rack.viewRack') + ' ' + row.data_center"
                      @click.stop="openDataCenterRacks(row)"
                    >
                      <OfficeBuilding />{{ row.data_center }}
                    </el-button>
                    <span v-else class="dashboard-resource-name"><OfficeBuilding />{{ row.data_center }}</span>
                  </template>
                </el-table-column>
                <el-table-column :label="t('dashboard.roomRack')" width="120">
                  <template #default="{ row }">{{ row.room_count }} / {{ row.rack_count }}</template>
                </el-table-column>
                <el-table-column :label="t('dashboard.usedUTotalU')" width="120">
                  <template #default="{ row }">{{ row.used_u }} / {{ row.total_u }}</template>
                </el-table-column>
                <el-table-column :label="t('dashboard.uUtilization')" min-width="170">
                  <template #default="{ row }">
                    <div class="dashboard-resource-utilization">
                      <b>{{ row.utilization.toFixed(1) }}%</b>
                      <el-progress :percentage="utilization(row.utilization)" :show-text="false" :stroke-width="4" />
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </ResourceState>
          </el-card>
        </section>

        <section class="dashboard-summary-row" :class="{ 'is-single': !can('faults.view') }">
          <el-card shadow="never" class="dashboard-panel dashboard-panel--activity" :class="{ 'is-empty': !recentChangeItems.length }">
            <template #header><div class="dashboard-card-heading"><strong>{{ t('dashboard.assetChanges') }}</strong><el-button v-if="can('audit.view') || can('assets.view')" text type="primary" @click="openChanges">{{ t('dashboard.viewAll') }} <el-icon><ArrowRight /></el-icon></el-button></div></template>
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
            <template #header><div class="dashboard-card-heading"><strong>{{ t('dashboard.openFaultList') }}</strong><el-button text type="primary" @click="goToRepairs({ is_closed: 'false' })">{{ t('dashboard.viewAll') }} <el-icon><ArrowRight /></el-icon></el-button></div></template>
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
