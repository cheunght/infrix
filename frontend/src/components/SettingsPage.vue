<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Download, Filter, Refresh, View } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import NotificationDeliveryLogs from "./NotificationDeliveryLogs.vue";
import SystemSettingsPage from "./SystemSettingsPage.vue";
import SystemMaintenancePage from "./SystemMaintenancePage.vue";
import DataDictionaryPage from "./DataDictionaryPage.vue";
import OrganizationSettingsPage from "./OrganizationSettingsPage.vue";
import DescriptionList from "./DescriptionList.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import TableIconButton from "./TableIconButton.vue";
import ToolbarIconButton from "./page/ToolbarIconButton.vue";
import { normalizeApiError } from "../error-handling";
import { currentLocale } from "../i18n";
import type { SettingsContext } from "../page-context";
import type { AuditLog } from "../types";
import { systemDatePickerFormat } from "../system-settings";
import {
  auditActionOptions,
  auditLogActionLabel,
  auditChangeSummary,
  auditDetail,
  auditResourceOptions,
  auditObjectLabel,
  formatAuditDateTime,
  resourceLabel,
} from "../audit-formatters";

const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();
const context = props.context;

type NotificationDeliveryLogsHandle = {
  busy: boolean;
  statusFilter: string;
  load: () => Promise<void>;
  changeStatus: (value: string | undefined) => void;
};

const notificationDeliveryRef = ref<NotificationDeliveryLogsHandle | null>(null);
const notificationDeliveryBusy = computed(() => notificationDeliveryRef.value?.busy ?? true);
const notificationDeliveryStatusFilter = computed(() => notificationDeliveryRef.value?.statusFilter ?? "");
const showAuditFilters = ref(false);
const auditFilterDraft = reactive({ resource_type: "", action: "", start: "", end: "" });
const auditExporting = ref(false);

function notificationDeliveryStatusLabel(value: string) {
  const key = `operations.${value}`;
  const translated = String(t(key));
  return translated === key ? value : translated;
}

function changeNotificationDeliveryStatus(value: string | undefined) {
  notificationDeliveryRef.value?.changeStatus(value);
}

function refreshNotificationDelivery() {
  if (!notificationDeliveryRef.value) return;
  void notificationDeliveryRef.value.load();
}

const {
  settingsSection,
  can,
  auditFilters,
  auditListLoading,
  auditListError,
  retryAuditLogs,
  searchAuditLogs,
  auditLogs,
  auditPage,
  auditPageSize,
  auditCount,
  changeAuditPage,
  changeAuditPageSize,
} = context;

const auditTab = ref("audit");
const auditTabs = computed<PageTabItem[]>(() => [
  { value: "audit", label: t("settings.auditTab") },
  { value: "mail-delivery", label: t("settings.mailDeliveryTab") },
]);
watch(settingsSection, () => {
  auditTab.value = "audit";
});
const hasAuditFilters = computed(() => Boolean(
  auditFilters.value.search?.trim() ||
  auditFilters.value.resource_type ||
  auditFilters.value.action ||
  auditFilters.value.start ||
  auditFilters.value.end,
));
const activeAuditFilterCount = computed(() =>
  Number(Boolean(auditFilters.value.resource_type)) +
  Number(Boolean(auditFilters.value.action)) +
  Number(Boolean(auditFilters.value.start || auditFilters.value.end)),
);
const auditDraftDateError = computed(() =>
  auditFilterDraft.start && auditFilterDraft.end && auditFilterDraft.start > auditFilterDraft.end
    ? t("settings.auditInvalidDateRange")
    : "",
);
const selectedAuditLog = ref<AuditLog | null>(null);
const auditDetailVisible = ref(false);
const selectedAuditDetail = computed(() => (selectedAuditLog.value ? auditDetail(selectedAuditLog.value) : null));
const auditDetailDescriptionItems = computed(() => {
  const log = selectedAuditLog.value;
  const detail = selectedAuditDetail.value;
  if (!log || !detail) return [];
  const items = [
    { key: "auditTime", label: t("settings.auditTime"), value: formatAuditDateTime(log.created_at) },
    {
      key: "actor",
      label: t("settings.actor"),
      value: log.actor_display_name || log.actor_username || "—",
    },
    { key: "resource", label: t("settings.resource"), value: detail.resourceLabel },
    { key: "action", label: t("settings.action"), value: detail.actionLabel },
    { key: "object", label: t("settings.object"), value: detail.objectLabel },
  ];
  if (log.resource_id) {
    items.push({ key: "resourceId", label: t("settings.resourceId"), value: `#${log.resource_id}` });
  }
  return items.map((item) => ({ ...item, className: "audit-detail-descriptions__value" }));
});
const auditMetadataDescriptionItems = computed(() =>
  (selectedAuditDetail.value?.metadata || []).map((item, index) => ({
    key: `metadata-${index}-${item.label}`,
    label: item.label,
    value: item.value,
    className: "audit-detail-descriptions__value",
  })),
);
function clearAuditFilters() {
  auditFilters.value.search = "";
  auditFilters.value.actor = "";
  auditFilters.value.resource_type = "";
  auditFilters.value.action = "";
  auditFilters.value.start = "";
  auditFilters.value.end = "";
  return searchAuditLogs();
}

function openAuditFilters() {
  auditFilterDraft.resource_type = auditFilters.value.resource_type;
  auditFilterDraft.action = auditFilters.value.action;
  auditFilterDraft.start = auditFilters.value.start;
  auditFilterDraft.end = auditFilters.value.end;
  showAuditFilters.value = true;
}

function clearAuditFilterDraft() {
  auditFilterDraft.resource_type = "";
  auditFilterDraft.action = "";
  auditFilterDraft.start = "";
  auditFilterDraft.end = "";
}

function applyAuditFilters() {
  if (auditDraftDateError.value) return;
  auditFilters.value.resource_type = auditFilterDraft.resource_type;
  auditFilters.value.action = auditFilterDraft.action;
  auditFilters.value.start = auditFilterDraft.start;
  auditFilters.value.end = auditFilterDraft.end;
  searchAuditLogs();
  showAuditFilters.value = false;
}

async function exportAuditLogs() {
  if (auditExporting.value || !can("audit.view")) return;
  auditExporting.value = true;
  const params = new URLSearchParams();
  Object.entries(auditFilters.value).forEach(([key, value]) => {
    const normalizedValue = String(value || "").trim();
    if (normalizedValue) params.set(key, normalizedValue);
  });
  params.set("locale", currentLocale.value);
  const query = params.toString();
  try {
    await context.downloadFile(
      `/audit-logs/export/${query ? `?${query}` : ""}`,
      "audit-logs.xlsx",
    );
    context.actionMessageType.value = "success";
    context.actionMessage.value = t("settings.auditExported");
  } catch (error) {
    const normalized = normalizeApiError(error);
    context.actionMessageType.value = "error";
    context.actionMessage.value = normalized.message || t("settings.auditExportFailed");
  } finally {
    auditExporting.value = false;
  }
}

function openAuditDetail(log: AuditLog) {
  selectedAuditLog.value = log;
  auditDetailVisible.value = true;
}

</script>

<template>
  <div class="infrix-page settings-page">
    <CustomFieldSettingsPage v-if="settingsSection === 'custom-fields'" :context="props.context" />
    <TagSettingsPage v-else-if="settingsSection === 'tags'" :context="props.context" />
    <SystemSettingsPage v-else-if="settingsSection === 'system' && can('settings.view')" :context="props.context" />

    <DataDictionaryPage v-else-if="settingsSection === 'dictionaries' && can('settings.view')" :context="props.context" />

    <OrganizationSettingsPage
      v-else-if="settingsSection === 'organization' && (can('organization.manage') || can('settings.manage') || can('settings.view'))"
      :context="props.context"
      :organization="props.context.organizationSettings"
    />

    <PageContainer v-else-if="settingsSection === 'audit' && can('audit.view')">
      <template #subnav>
        <PageTabs v-model="auditTab" :items="auditTabs" />
      </template>
      <PageContent surface>
        <PageToolbar v-if="auditTab === 'audit'" class="settings-list-toolbar">
          <template #search>
            <SearchField v-model="auditFilters.search" :loading="auditListLoading" :placeholder="t('settings.auditSearchPlaceholder')" :aria-label="t('settings.audit')" @search="searchAuditLogs" />
          </template>
          <template #filters>
            <ToolbarIconButton :icon="Filter" :label="t('asset.moreFilters')" :badge="activeAuditFilterCount" @click="openAuditFilters" />
          </template>
          <template #actions>
            <ToolbarIconButton
              :icon="Download"
              :label="t('settings.exportAudit')"
              :loading="auditExporting"
              :disabled="auditExporting"
              @click="exportAuditLogs"
            />
          </template>
        </PageToolbar>
        <PageToolbar v-else class="settings-list-toolbar">
          <template #filters>
            <el-select
              class="notification-delivery__status-filter"
              :model-value="notificationDeliveryStatusFilter"
              clearable
              :disabled="notificationDeliveryBusy"
              :placeholder="t('operations.allDeliveryStatuses')"
              @update:model-value="changeNotificationDeliveryStatus"
            >
              <el-option v-for="value in ['pending', 'sending', 'sent', 'failed', 'unknown']" :key="value" :label="notificationDeliveryStatusLabel(value)" :value="value" />
            </el-select>
          </template>
          <template #actions>
            <ToolbarIconButton :icon="Refresh" :label="t('common.refresh')" :loading="notificationDeliveryBusy" :disabled="notificationDeliveryBusy" @click="refreshNotificationDelivery" />
          </template>
        </PageToolbar>
        <template v-if="auditTab === 'audit'">
          <el-alert v-if="auditListError" :title="t('settings.auditLoadFailed')" type="error" show-icon :closable="false">
            <template #default>
              <span>{{ auditListError }}</span>
              <el-button link type="danger" :loading="auditListLoading" @click="retryAuditLogs">{{ t('common.retry') }}</el-button>
            </template>
          </el-alert>
          <template v-else>
            <el-table class="audit-log-table" v-loading="auditListLoading" :data="auditLogs" table-layout="fixed">
              <template #empty>
                <el-empty :image-size="56" :description="hasAuditFilters ? t('settings.noMatchingAudit') : t('settings.noAudit')">
                  <el-button v-if="hasAuditFilters" link type="primary" @click="clearAuditFilters">{{ t('common.clearFilters') }}</el-button>
                </el-empty>
              </template>
              <el-table-column prop="created_at" :label="t('common.time')" width="178"><template #default="{ row }">{{ formatAuditDateTime(row.created_at) }}</template></el-table-column>
              <el-table-column prop="actor_display_name" :label="t('settings.actor')" width="138" />
              <el-table-column :label="t('settings.resource')" width="108"><template #default="{ row }">{{ resourceLabel(row.resource_type) }}</template></el-table-column>
              <el-table-column :label="t('settings.action')" width="108"><template #default="{ row }">{{ auditLogActionLabel(row) }}</template></el-table-column>
              <el-table-column :label="t('settings.object')" min-width="180">
                <template #default="{ row }">{{ auditObjectLabel(row) }}</template>
              </el-table-column>
              <el-table-column :label="t('settings.changeSummary')" min-width="320">
                <template #default="{ row }">
                  <span class="audit-change-summary">{{ auditChangeSummary(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('common.operation')" width="84" fixed="right">
                <template #default="{ row }">
                  <div class="ep-table-actions">
                    <el-button-group>
                      <TableIconButton :icon="View" :label="t('common.details')" type="primary" @click="openAuditDetail(row)" />
                    </el-button-group>
                  </div>
                </template>
              </el-table-column>
            </el-table>
            <PagedTable v-model:current-page="auditPage" v-model:page-size="auditPageSize" :total="auditCount" :page-sizes="[20, 50, 100]" @update:current-page="changeAuditPage" @update:page-size="changeAuditPageSize" />
          </template>
        </template>
        <NotificationDeliveryLogs v-else ref="notificationDeliveryRef" :context="context" />
      </PageContent>
    </PageContainer>

    <el-drawer v-if="settingsSection === 'audit' && auditTab === 'audit'" v-model="showAuditFilters" :title="t('asset.moreFilters')" size="360px" append-to-body>
      <el-form label-position="top">
        <el-form-item :label="t('settings.allResources')">
          <el-select v-model="auditFilterDraft.resource_type" clearable :placeholder="t('settings.allResources')">
            <el-option v-for="item in auditResourceOptions" :key="item.value" :label="t(item.labelKey)" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('settings.allActions')">
          <el-select v-model="auditFilterDraft.action" clearable :placeholder="t('settings.allActions')">
            <el-option v-for="item in auditActionOptions" :key="item.value" :label="t(item.labelKey)" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('settings.auditStartDate')">
          <el-date-picker
            v-model="auditFilterDraft.start"
            type="date"
            value-format="YYYY-MM-DD"
            :format="systemDatePickerFormat()"
            :placeholder="t('settings.auditStartDate')"
            clearable
          />
        </el-form-item>
        <el-form-item :label="t('settings.auditEndDate')" :error="auditDraftDateError">
          <el-date-picker
            v-model="auditFilterDraft.end"
            type="date"
            value-format="YYYY-MM-DD"
            :format="systemDatePickerFormat()"
            :placeholder="t('settings.auditEndDate')"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="page-filter-drawer__footer">
          <el-button @click="clearAuditFilterDraft">{{ t('common.clearFilters') }}</el-button>
          <el-button @click="showAuditFilters = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" :disabled="Boolean(auditDraftDateError)" @click="applyAuditFilters">{{ t('asset.applyFilters') }}</el-button>
        </div>
      </template>
    </el-drawer>

    <SystemMaintenancePage v-else-if="settingsSection === 'maintenance' && can('settings.view')" :context="context.systemMaintenance" />

    <el-drawer v-model="auditDetailVisible" class="audit-detail-drawer" :title="t('settings.auditDetail')" size="680px" destroy-on-close>
      <template v-if="selectedAuditLog && selectedAuditDetail">
        <div class="audit-detail-intro">
          <strong>{{ selectedAuditDetail.summary }}</strong>
          <span>{{ t('settings.recordNumber', { id: selectedAuditLog.id }) }}</span>
        </div>

        <DescriptionList
          class="audit-detail-descriptions"
          :items="auditDetailDescriptionItems"
          :columns="2"
          border
          size="small"
        />

        <section v-if="selectedAuditDetail.metadata.length" class="audit-detail-section">
          <h3>{{ t('settings.eventInfo') }}</h3>
          <DescriptionList
            class="audit-detail-descriptions audit-detail-descriptions--event"
            :items="auditMetadataDescriptionItems"
            :columns="2"
            border
            size="small"
          />
        </section>

        <section class="audit-detail-section">
          <h3>{{ selectedAuditDetail.changeTitle }}</h3>
          <el-table v-if="selectedAuditDetail.changes.length" class="audit-change-table" :data="selectedAuditDetail.changes" table-layout="fixed">
          <el-table-column prop="label" :label="t('common.field')" width="150" />
            <el-table-column :label="t('common.before')" min-width="180">
              <template #default="{ row }"><span class="audit-value">{{ row.beforeText }}</span></template>
            </el-table-column>
            <el-table-column :label="t('common.after')" min-width="180">
              <template #default="{ row }"><span class="audit-value audit-value--after">{{ row.afterText }}</span></template>
            </el-table-column>
          </el-table>
          <el-table v-else-if="selectedAuditDetail.fields.length" class="audit-change-table" :data="selectedAuditDetail.fields" table-layout="fixed">
          <el-table-column prop="label" :label="t('common.field')" width="150" />
            <el-table-column :label="t('common.content')" min-width="320">
              <template #default="{ row }"><span class="audit-value">{{ row.valueText }}</span></template>
            </el-table-column>
          </el-table>
          <p v-else class="audit-detail-empty">{{ selectedAuditDetail.summary }}</p>
        </section>

        <el-collapse class="audit-raw-collapse">
          <el-collapse-item :title="t('settings.rawData')" name="raw">
            <pre class="audit-raw-data">{{ JSON.stringify(selectedAuditDetail.rawPayload, null, 2) }}</pre>
          </el-collapse-item>
        </el-collapse>
      </template>
    </el-drawer>

  </div>
</template>
