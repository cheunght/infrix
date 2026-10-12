<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Bell, Refresh } from "@element-plus/icons-vue";
import { formatSystemDate, formatSystemDateTime } from "../system-settings";
import type { JobTasks } from "../composables/useJobTasks";
import { jobLocation, jobAttemptKey } from "../jobs";
import { useNotifications } from "../composables/useNotifications";
import type { OperationalAlert } from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";

const props = defineProps<{
  request: RequestFn;
  tasks?: JobTasks;
  can: CapabilityFn;
  username: string;
}>();

const emit = defineEmits<{
  select: [alert: OperationalAlert];
}>();

const { t } = useI18n();
const visible = ref(false);
const username = computed(() => props.username);
const {
  alerts,
  summary,
  loading,
  error,
  generatedAt,
  unreadCount: alertUnreadCount,
  isRead,
  loadNotifications,
  markRead,
  markAllRead,
} = useNotifications({
  request: props.request,
  can: props.can,
  username,
});

const alertTitleKeys: Record<string, string> = {
  "maintenance:expired": "notifications.maintenanceExpired",
  "maintenance:expiring": "notifications.maintenanceExpiring",
  "license:expired": "notifications.licenseExpired",
  "license:expiring": "notifications.licenseExpiring",
  "license:over_limit": "notifications.licenseOverLimit",
  "fault:open": "notifications.faultOpen",
  "inventory:overdue": "notifications.inventoryOverdue",
  "spare:below_safety_stock": "notifications.spareBelowSafetyStock",
};

function alertTitle(alert: OperationalAlert) {
  return t(
    alertTitleKeys[`${alert.kind}:${alert.state}`] || "notifications.title",
  );
}

function alertSubject(alert: OperationalAlert) {
  if (alert.asset_no || alert.asset_name) {
    return t("notifications.assetReference", {
      assetNo: alert.asset_no || t("common.notAvailable"),
      assetName: alert.asset_name || t("common.notAvailable"),
    });
  }
  return (
    alert.name || alert.code || alert.reference || t("common.notAvailable")
  );
}

function formatDate(value: string | undefined) {
  if (!value) return "";
  return value.includes("T")
    ? formatSystemDateTime(value)
    : formatSystemDate(value);
}

function alertMeta(alert: OperationalAlert) {
  if (alert.kind === "license" && alert.state === "over_limit") {
    return t("notifications.licenseUsage", {
      used: alert.used_count ?? 0,
      authorized: alert.authorized_count ?? 0,
    });
  }
  if (alert.kind === "maintenance" || alert.kind === "license") {
    const days = alert.days_remaining ?? 0;
    if (days < 0)
      return t("notifications.dueDaysOverdue", { count: Math.abs(days) });
    if (days === 0) return t("notifications.dueToday");
    return t("notifications.dueInDays", { count: days });
  }
  if (alert.kind === "inventory") {
    const days = alert.days_overdue ?? 0;
    return days > 0
      ? t("notifications.dueDaysOverdue", { count: days })
      : t("notifications.inventoryOverdueToday");
  }
  if (alert.kind === "spare") {
    return t("notifications.stockUsage", {
      quantity: alert.quantity ?? 0,
      safetyStock: alert.safety_stock ?? 0,
    });
  }
  return formatDate(alert.occurred_at);
}

function alertContext(alert: OperationalAlert) {
  if (
    alert.kind === "license" &&
    alert.state !== "expired" &&
    alert.state !== "expiring"
  ) {
    return "";
  }
  if (alert.kind === "inventory") {
    return t("notifications.inventoryPending", {
      count: alert.pending_count ?? 0,
    });
  }
  if (alert.kind === "spare") return "";
  return alert.due_date ? formatDate(alert.due_date) : alert.reference || "";
}

function levelLabel(level: OperationalAlert["level"]) {
  return t(`notifications.${level}`);
}

function alertActionLabel(alert: OperationalAlert) {
  return alert.kind === "license" || alert.kind === "spare"
    ? t("notifications.openRelatedList")
    : t("notifications.openDetails");
}

function alertAccessibleLabel(alert: OperationalAlert) {
  return [
    levelLabel(alert.level),
    alertTitle(alert),
    alertSubject(alert),
    alertContext(alert),
    alertMeta(alert),
  ]
    .filter(Boolean)
    .join(" · ");
}

function handleSelect(alert: OperationalAlert) {
  markRead(alert.id);
  visible.value = false;
  emit("select", alert);
}

function handleMarkAllRead() {
  if (activeTab.value === "operations") markOperationsRead();
  else markAllRead();
}

function handleOpen() {
  void props.tasks?.refresh();
  void loadOperations();
  void loadNotifications();
}

const activeTab = ref(props.can("dashboard.view") ? "alerts" : "operations");
const operationIds = ref<string[]>([]);
const operationCount = ref(0);
const operationOffset = ref(0);
const operationError = ref("");
const operationLoading = ref(false);
let operationVersion = 0;
const unreadCount = computed(
  () => alertUnreadCount.value + (props.tasks?.unread.value || 0),
);
async function loadOperations() {
  if (!props.tasks) return;
  const current = ++operationVersion;
  operationLoading.value = true;
  operationError.value = "";
  try {
    const page = await props.tasks.list({
      status: "succeeded,failed,cancelled",
      offset: operationOffset.value,
    });
    if (current !== operationVersion) return;
    operationCount.value = page.count;
    operationIds.value = page.results.map((job) => job.id);
  } catch (cause) {
    if (current === operationVersion)
      operationError.value =
        cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (current === operationVersion) operationLoading.value = false;
  }
}
function openOperation(id: string) {
  const job = props.tasks?.records.value[id];
  if (job) props.tasks?.markRead(job);
  visible.value = false;
}
function operationPage(step: number) {
  operationOffset.value = Math.max(0, operationOffset.value + step);
  void loadOperations();
}
function markOperationsRead() {
  operationIds.value.forEach((id) => {
    const job = props.tasks?.records.value[id];
    if (job) props.tasks?.markRead(job);
  });
}
watch(
  () => props.username,
  () => {
    ++operationVersion;
    operationIds.value = [];
    operationOffset.value = 0;
    operationCount.value = 0;
    operationError.value = "";
    operationLoading.value = false;
    visible.value = false;
  },
);
watch(activeTab, (tab) => {
  if (tab === "operations" && visible.value) void loadOperations();
});

const stopJobCompletion = props.tasks?.onCompleted(() => {
  if (
    visible.value &&
    activeTab.value === "operations" &&
    operationOffset.value === 0
  )
    void loadOperations();
});
onBeforeUnmount(() => {
  ++operationVersion;
  stopJobCompletion?.();
});

const showingLimitedAlerts = computed(
  () => summary.value.total > alerts.value.length,
);

onMounted(() => {
  void loadNotifications();
});
</script>

<template>
  <el-popover
    v-model:visible="visible"
    placement="bottom-end"
    :width="420"
    trigger="click"
    popper-class="notification-center__popover"
    @show="handleOpen"
  >
    <template #reference>
      <el-button
        class="notification-center__trigger"
        text
        aria-haspopup="dialog"
        :aria-expanded="visible ? 'true' : 'false'"
        :aria-label="t('notifications.title')"
        :title="t('notifications.title')"
      >
        <el-badge :value="unreadCount" :max="99" :hidden="unreadCount === 0">
          <el-icon class="header-control-icon"><Bell /></el-icon>
        </el-badge>
      </el-button>
    </template>

    <section
      class="notification-center"
      role="dialog"
      :aria-label="t('notifications.title')"
    >
      <header class="notification-center__header">
        <div class="notification-center__heading">
          <strong>{{ t("notifications.title") }}</strong>
          <span v-if="unreadCount">{{
            t("notifications.unread", { count: unreadCount })
          }}</span>
          <span v-else>{{
            t("notifications.total", { count: summary.total })
          }}</span>
        </div>
        <el-button text :disabled="!unreadCount" @click="handleMarkAllRead">{{
          t("notifications.markAllRead")
        }}</el-button>
      </header>

      <div v-if="tasks" class="notification-center__tabs">
        <el-button
          v-if="can('dashboard.view')"
          text
          :type="activeTab === 'alerts' ? 'primary' : undefined"
          @click="activeTab = 'alerts'"
          >{{ t("jobs.businessAlerts") }}</el-button
        >
        <el-button
          text
          :type="activeTab === 'operations' ? 'primary' : undefined"
          @click="activeTab = 'operations'"
          >{{ t("jobs.operationResults") }}</el-button
        >
      </div>
      <div
        v-if="activeTab === 'operations' && tasks"
        class="notification-center__operations"
      >
        <p v-if="operationError">{{ operationError }}</p>
        <p v-else-if="operationLoading">{{ t("common.loadingData") }}</p>
        <p v-else-if="!operationIds.length">{{ t("jobs.empty") }}</p>
        <router-link
          v-for="id in operationIds"
          :key="id"
          :to="jobLocation(tasks.records.value[id]!)"
          class="notification-center__operation"
          :class="{
            'is-read': tasks.readIds.value.has(
              jobAttemptKey(tasks.records.value[id]!),
            ),
          }"
          @click="openOperation(id)"
        >
          <strong>{{ t(`jobs.kinds.${tasks.records.value[id]!.kind}`) }}</strong
          ><span
            >{{ t(`jobs.status.${tasks.records.value[id]!.status}`) }} ·
            {{
              formatSystemDateTime(tasks.records.value[id]!.created_at)
            }}</span
          >
        </router-link>
        <div class="notification-center__tabs">
          <el-button
            text
            :disabled="!operationOffset || operationLoading"
            @click="operationPage(-30)"
            >{{ t("jobs.previous") }}</el-button
          ><span
            >{{ Math.min(operationOffset + 30, operationCount) }} /
            {{ operationCount }}</span
          ><el-button
            text
            :disabled="
              operationOffset + 30 >= operationCount || operationLoading
            "
            @click="operationPage(30)"
            >{{ t("jobs.next") }}</el-button
          >
        </div>
      </div>
      <template v-else>
        <p class="notification-center__range">{{ t("dataScope.alertHint") }}</p>
        <div class="notification-center__summary" aria-live="polite">
          <span class="notification-center__summary-item is-critical">
            <i aria-hidden="true"></i>{{ levelLabel("critical") }}
            {{ summary.critical }}
          </span>
          <span class="notification-center__summary-item is-warning">
            <i aria-hidden="true"></i>{{ levelLabel("warning") }}
            {{ summary.warning }}
          </span>
          <span class="notification-center__summary-item is-notice">
            <i aria-hidden="true"></i>{{ levelLabel("notice") }}
            {{ summary.notice }}
          </span>
        </div>

        <div
          v-if="showingLimitedAlerts"
          class="notification-center__range"
          aria-live="polite"
        >
          {{
            t("notifications.showingFirst", {
              shown: alerts.length,
              total: summary.total,
            })
          }}
        </div>

        <div v-if="loading" class="notification-center__state">
          {{ t("common.loadingData") }}
        </div>
        <div v-else-if="error" class="notification-center__state is-error">
          <span>{{ error }}</span>
          <el-button text @click="loadNotifications(true)">{{
            t("common.retry")
          }}</el-button>
        </div>
        <div v-else-if="alerts.length" class="notification-center__list">
          <el-button
            v-for="alert in alerts"
            :key="alert.id"
            class="notification-center__item"
            :class="[`is-${alert.level}`, { 'is-read': isRead(alert.id) }]"
            text
            :aria-label="alertAccessibleLabel(alert)"
            :title="alertActionLabel(alert)"
            @click="handleSelect(alert)"
          >
            <span class="notification-center__item-content">
              <i class="notification-center__item-dot" aria-hidden="true"></i>
              <span class="notification-center__item-body">
                <strong>{{ alertTitle(alert) }}</strong>
                <span
                  class="notification-center__item-subject"
                  :title="alertSubject(alert)"
                  >{{ alertSubject(alert) }}</span
                >
                <span
                  v-if="alertContext(alert)"
                  class="notification-center__item-context"
                  >{{ alertContext(alert) }}</span
                >
              </span>
              <span class="notification-center__item-meta">{{
                alertMeta(alert)
              }}</span>
            </span>
          </el-button>
        </div>
        <div v-else class="notification-center__state">
          {{ t("notifications.noAlerts") }}
        </div>
      </template>
      <footer class="notification-center__footer">
        <span v-if="generatedAt">{{
          t("notifications.updatedAt", { time: formatDate(generatedAt) })
        }}</span>
        <el-button
          text
          :icon="Refresh"
          :loading="activeTab === 'operations' ? operationLoading : loading"
          @click="
            activeTab === 'operations'
              ? loadOperations()
              : loadNotifications(true)
          "
        >
          {{ t("notifications.refresh") }}
        </el-button>
      </footer>
    </section>
  </el-popover>
</template>

<style scoped>
.notification-center__tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.notification-center__operations {
  max-height: 440px;
  overflow: auto;
}
.notification-center__operation {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  color: var(--el-text-color-primary);
  text-decoration: none;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.notification-center__operation span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.notification-center__operation.is-read {
  opacity: 0.7;
}

:global(.notification-center__popover) {
  box-sizing: border-box;
  max-width: calc(100vw - 24px);
}

.notification-center__trigger {
  width: 40px;
  height: 40px;
  padding: 0;
  color: var(--el-text-color-secondary);
}

.notification-center__trigger:hover,
.notification-center__trigger:focus-visible {
  color: var(--el-color-primary);
}

.notification-center__trigger .header-control-icon {
  font-size: 20px;
}

.notification-center {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
  color: var(--el-text-color-primary);
}

.notification-center__header,
.notification-center__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
}

.notification-center__heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-2);
}

.notification-center__heading strong {
  font-size: var(--el-font-size-medium);
  line-height: 24px;
}

.notification-center__heading span,
.notification-center__footer span {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-extra-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-center__header .el-button,
.notification-center__footer .el-button {
  flex: 0 0 auto;
  min-height: auto;
  padding: 3px 0;
}

.notification-center__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--el-border-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.notification-center__range {
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-extra-small);
  line-height: 18px;
}

.notification-center__summary-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-extra-small);
}

.notification-center__summary-item i,
.notification-center__item-dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.notification-center__summary-item.is-critical,
.notification-center__item.is-critical .notification-center__item-dot {
  color: var(--el-color-danger);
}

.notification-center__summary-item.is-warning,
.notification-center__item.is-warning .notification-center__item-dot {
  color: var(--el-color-warning);
}

.notification-center__summary-item.is-notice,
.notification-center__item.is-notice .notification-center__item-dot {
  color: var(--el-color-primary);
}

.notification-center__list {
  display: flex;
  max-height: min(440px, calc(100vh - 240px));
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  margin: 0 -6px;
  overflow-y: auto;
}

.notification-center__item.el-button {
  display: flex;
  width: 100%;
  min-height: 70px;
  justify-content: flex-start;
  margin-left: 0;
  padding: 9px 8px;
  border: 1px solid transparent;
  border-radius: var(--el-border-radius-base);
  text-align: left;
  white-space: normal;
}

.notification-center__item.el-button > span {
  display: block;
  width: 100%;
  min-width: 0;
}

.notification-center__item.el-button:hover,
.notification-center__item.el-button:focus-visible {
  border-color: var(--el-border-color-light);
  background: var(--el-fill-color-light);
}

.notification-center__item.is-read {
  opacity: 0.7;
}

.notification-center__item-content {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 8px minmax(0, 1fr) 112px;
  align-items: start;
  gap: var(--space-2);
}

.notification-center__item-dot {
  margin-top: 6px;
}

.notification-center__item-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.notification-center__item-body strong,
.notification-center__item-subject,
.notification-center__item-context {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-center__item-body strong {
  color: var(--el-text-color-primary);
  font-size: var(--el-font-size-small);
  font-weight: 600;
  line-height: 20px;
}

.notification-center__item-subject {
  color: var(--el-text-color-regular);
  font-size: var(--el-font-size-extra-small);
  line-height: 18px;
}

.notification-center__item-context,
.notification-center__item-meta {
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-extra-small);
  line-height: 18px;
}

.notification-center__item-meta {
  width: 112px;
  max-width: 112px;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-center__state {
  display: flex;
  min-height: 96px;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small);
  text-align: center;
}

.notification-center__state.is-error {
  flex-direction: column;
  gap: var(--space-2);
  color: var(--el-color-danger);
}

.notification-center__footer {
  padding-top: var(--space-1);
  border-top: 1px solid var(--el-border-color-lighter);
}

@media (max-width: 560px) {
  .notification-center__item-content {
    grid-template-columns: 8px minmax(0, 1fr);
  }

  .notification-center__item-meta {
    grid-column: 2;
    width: auto;
    max-width: none;
    text-align: left;
  }
}
</style>
