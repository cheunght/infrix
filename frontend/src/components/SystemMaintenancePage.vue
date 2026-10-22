<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Refresh } from "@element-plus/icons-vue";
import type { SystemMaintenanceDependencies } from "../page-context";
import { routeForPage, type MaintenanceTab } from "../router";
import { useSystemMaintenance } from "../composables/useSystemMaintenance";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import ToolbarIconButton from "./page/ToolbarIconButton.vue";
import SystemOperations from "./SystemOperations.vue";
import BackupRestorePage from "./BackupRestorePage.vue";
import DetailSection from "./DetailSection.vue";
import BackupMaintenanceScreen from "./BackupMaintenanceScreen.vue";
import { useBackupOperations } from "../composables/useBackupOperations";

const props = defineProps<{ context: SystemMaintenanceDependencies }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const context = props.context;
const maintenance = useSystemMaintenance(context);
const backupOperations = useBackupOperations();

const {
  status,
  statusLoading,
  statusError,
  systemOperationsBusy,
  backups,
  backupLoading,
  backupError,
  backupNotice,
  pendingFilename,
  backupDeleting,
  backupCreating,
  backupRestoring,
  createBackup,
  openRestoreDialog,
  closeRestoreDialog,
  restoreBackup,
  restoreDialogVisible,
  restoreConfirmation,
  restoreError,
  restoreEntry,
  hasNonTransactionalTables,
  resetDialogVisible,
  resetConfirmation,
  resetError,
  resetOutcome,
  systemResetConfirmationToken,
  systemResetSaving,
  maintenanceBusy,
  uncertainOperation,
  loadStatus,
  loadBackups,
  downloadBackup,
  deleteBackup,
  openSystemResetDialog,
  closeSystemResetDialog,
  resetSystem,
} = maintenance;

const maintenanceTab = ref<MaintenanceTab>("operations");
onBeforeRouteLeave(() => !systemResetSaving.value);
onBeforeRouteUpdate(() => !systemResetSaving.value);
const maintenanceTabs = computed<PageTabItem[]>(() => [
  { value: "operations", label: t("operations.statusTab"), disabled: systemResetSaving.value },
  { value: "backup", label: t("settings.backupRestoreTab"), disabled: systemResetSaving.value || !context.can("system.reset") },
  { value: "reset", label: t("operations.resetTab"), disabled: systemResetSaving.value || !context.can("system.reset") },
]);

function routeTab(): string | undefined {
  const value = route.query.tab;
  return Array.isArray(value) ? value[0] || undefined : value || undefined;
}

function maintenanceTabFromRoute(): MaintenanceTab {
  const value = routeTab();
  if (context.can("system.reset") && (value === "backup" || value === "reset")) return value;
  return "operations";
}

function syncMaintenanceTabFromRoute() {
  maintenanceTab.value = maintenanceTabFromRoute();
  const value = routeTab();
  const known = value === undefined || value === "operations" || value === "backup" || value === "reset";
  const unauthorized = (!context.can("system.reset") && (value === "backup" || value === "reset"));
  if (!known || unauthorized) {
    void router.replace(routeForPage("settings", { settingsSection: "maintenance" }));
  }
}

function loadCurrentTab() {
  if (maintenanceTab.value === "operations") void loadStatus();
  if (maintenanceTab.value === "backup" && context.can("system.reset") && !backupOperations.receipt.value) void loadBackups();
}

async function finishBackupOperation() {
  if (backupOperations.submitting.value || (backupOperations.busy.value && !backupOperations.notFound.value) || backupOperations.operation.value?.maintenance_closed || backupOperations.operation.value?.recovery_required) return;
  const completed = backupOperations.operation.value;
  backupOperations.clear();
  if (completed?.kind === "restore" && completed.status === "succeeded") {
    context.reload();
    return;
  }
  const refreshed = await loadBackups();
  if (completed?.status === "succeeded" && !backupOperations.receipt.value) {
    backupNotice.value = t(refreshed ? "settings.backupCreated" : "settings.backupCreatedRefreshFailed", {
      filename: completed.result?.filename || completed.filename,
    });
  }
}

watch(
  [backupOperations.operation, backupOperations.submitting, () => context.can("system.reset")],
  ([operation, submitting, allowed]) => {
    if (allowed && !submitting && operation?.kind === "backup" && operation.status === "succeeded" && !operation.maintenance_closed) {
      void finishBackupOperation();
    }
  },
  { immediate: true },
);

watch(
  [() => route.query.tab, () => context.can("system.reset"), () => context.can("settings.manage")],
  () => {
    syncMaintenanceTabFromRoute();
    loadCurrentTab();
  },
  { immediate: true },
);

function changeMaintenanceTab(value: string) {
  if (systemResetSaving.value) return;
  if (value !== "operations" && value !== "backup" && value !== "reset") return;
  if ((value === "backup" || value === "reset") && !context.can("system.reset")) return;
  maintenanceTab.value = value;
  void router.push(routeForPage("settings", {
    settingsSection: "maintenance",
    maintenanceTab: value,
  }));
}
</script>

<template>
  <PageContainer content-class="settings-maintenance-container">
    <template #subnav>
      <PageTabs v-model="maintenanceTab" :items="maintenanceTabs" @update:model-value="changeMaintenanceTab" />
    </template>
    <PageContent surface>
      <PageToolbar v-if="maintenanceTab === 'operations' || (maintenanceTab === 'backup' && context.can('system.reset'))" class="settings-form-toolbar">
        <template #actions>
          <ToolbarIconButton
            v-if="maintenanceTab === 'operations'"
            :icon="Refresh"
            :label="t('common.refresh')"
            :loading="statusLoading"
            :disabled="statusLoading"
            @click="loadStatus"
          />
          <template v-else-if="maintenanceTab === 'backup' && context.can('system.reset')">
            <el-button type="primary" :loading="backupCreating" :disabled="maintenanceBusy" @click="createBackup">{{ t('settings.createBackup') }}</el-button>
            <ToolbarIconButton :icon="Refresh" :label="t('common.refresh')" :loading="backupLoading" :disabled="backupLoading || maintenanceBusy" @click="loadBackups" />
          </template>
        </template>
      </PageToolbar>

      <div class="settings-maintenance">
        <BackupMaintenanceScreen
          v-if="backupOperations.receipt.value && context.can('system.reset')"
          :monitor="backupOperations"
          inline
          @continue="finishBackupOperation"
        />
        <SystemOperations
          v-show="maintenanceTab === 'operations'"
          :context="context"
          :status="status"
          :loading="statusLoading"
          :error="statusError"
        />
        <BackupRestorePage
          v-if="maintenanceTab === 'backup' && context.can('system.reset')"
          :context="context"
          :backups="backups"
          :loading="backupLoading"
          :deleting="backupDeleting"
          :busy="maintenanceBusy"
          :pending-filename="pendingFilename"
          :error="backupError"
          :notice="backupNotice"
          :has-non-transactional-tables="hasNonTransactionalTables"
          @load="loadBackups"
          @download="downloadBackup"
          @delete="deleteBackup"
          @restore="openRestoreDialog"
        />

        <section v-if="maintenanceTab === 'reset' && context.can('system.reset')" class="settings-maintenance__section system-reset-page">
          <div class="settings-maintenance__intro">
            <h2>{{ t('settings.systemReset') }}</h2>
            <p>{{ t('settings.systemResetDescription') }}</p>
          </div>
          <div class="system-reset-summary">
            <div><h3>{{ t('settings.clearData') }}</h3><p>{{ t('settings.resetClearSummary') }}</p></div>
            <div><h3>{{ t('settings.keepData') }}</h3><p>{{ t('settings.resetKeepSummary') }}</p></div>
          </div>
          <DetailSection :title="t('settings.resetScopeDetails')" collapsible>
            <el-descriptions :column="1" border>
              <el-descriptions-item :label="t('settings.clearData')">{{ t('settings.resetClears') }}</el-descriptions-item>
              <el-descriptions-item :label="t('settings.resetConfiguration')">{{ t('settings.resetConfigurationDetails') }}</el-descriptions-item>
              <el-descriptions-item :label="t('settings.keepData')">{{ t('settings.resetKeeps') }}</el-descriptions-item>
              <el-descriptions-item :label="t('settings.willNotExecute')">{{ t('settings.resetDoesNot') }}</el-descriptions-item>
            </el-descriptions>
          </DetailSection>
          <div v-if="systemResetSaving || resetOutcome" class="system-reset-status" role="status" aria-live="polite" :aria-busy="systemResetSaving">
            <el-alert
              :title="t(systemResetSaving ? 'settings.resetRunning' : resetOutcome === 'succeeded' ? 'settings.resetCompleted' : resetOutcome === 'unknown' ? 'settings.resetUnconfirmed' : 'settings.resetRequestFailed')"
              :description="systemResetSaving ? t('settings.resetRunningHelp') : resetOutcome === 'succeeded' ? t('settings.resetCompletedHelp') : resetError"
              :type="systemResetSaving ? 'info' : resetOutcome === 'succeeded' ? 'success' : resetOutcome === 'unknown' ? 'warning' : 'error'"
              show-icon
              :closable="false"
            />
          </div>
          <div class="system-reset-action">
            <el-button v-if="resetOutcome === 'succeeded'" type="primary" @click="context.reload">{{ t('settings.resetReload') }}</el-button>
            <template v-else>
              <span>{{ t('settings.resetBackupReminder') }}</span>
              <el-button type="danger" :loading="systemResetSaving" :disabled="maintenanceBusy" @click="openSystemResetDialog">{{ t('settings.systemReset') }}</el-button>
            </template>
          </div>
        </section>
      </div>

      <el-alert
        v-if="uncertainOperation"
        class="settings-maintenance__result-alert"
        :title="t('settings.maintenanceOperationUnknown')"
        type="warning"
        show-icon
        :closable="false"
      />

    </PageContent>
  </PageContainer>

  <el-dialog v-model="restoreDialogVisible" :title="t('settings.restoreBackup')" width="520px" :close-on-click-modal="false" :close-on-press-escape="!backupRestoring" :show-close="!backupRestoring" @close="closeRestoreDialog">
    <el-alert :title="t('settings.restoreBackupWarning')" type="warning" :closable="false" show-icon />
    <p>{{ restoreEntry?.filename }}</p>
    <el-alert v-if="restoreError" :title="restoreError" type="error" :closable="false" />
    <el-form @submit.prevent="restoreBackup">
      <el-form-item :label="t('settings.restoreConfirmationLabel')">
        <el-input v-model="restoreConfirmation" :placeholder="t('settings.restoreConfirmationPlaceholder')" :disabled="backupRestoring" autocomplete="off" @keyup.enter="restoreBackup" />
      </el-form-item>
      <p>{{ t('settings.restoreConfirmationHelp') }}</p>
    </el-form>
    <template #footer>
      <el-button :disabled="backupRestoring" @click="closeRestoreDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="danger" :loading="backupRestoring" :disabled="restoreConfirmation !== 'RESTORE INFRIX' || maintenanceBusy" @click="restoreBackup">{{ t('settings.restoreBackup') }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="resetDialogVisible"
    :title="t('settings.systemReset')"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="!systemResetSaving"
    @close="closeSystemResetDialog"
  >
    <el-alert v-if="resetError" :title="resetError" type="error" show-icon :closable="false" />
    <div class="settings-maintenance__confirm">
      <p>{{ t('settings.resetWarning') }}</p>
      <el-form @submit.prevent="resetSystem">
        <el-form-item :label="t('settings.resetCommand')">
          <el-input
            v-model="resetConfirmation"
            autocomplete="off"
            :placeholder="systemResetConfirmationToken"
            :disabled="systemResetSaving"
          />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button :disabled="systemResetSaving" @click="closeSystemResetDialog">{{ t('common.cancel') }}</el-button>
      <el-button
        type="danger"
        :loading="systemResetSaving"
        :disabled="resetConfirmation !== systemResetConfirmationToken || maintenanceBusy"
        @click="resetSystem"
      >
        {{ t('settings.systemReset') }}
      </el-button>
    </template>
  </el-dialog>
</template>
