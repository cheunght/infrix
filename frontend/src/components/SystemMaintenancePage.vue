<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
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

const props = defineProps<{ context: SystemMaintenanceDependencies }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const context = props.context;
const maintenance = useSystemMaintenance(context);

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
  backupCreating,
  backupRestoring,
  backupDeleting,
  hasNonTransactionalTables,
  restoreDialogVisible,
  restoreConfirmation,
  restoreTarget,
  restoreResult,
  restoreConfirmationValid,
  resetDialogVisible,
  resetConfirmation,
  resetError,
  systemResetConfirmationToken,
  systemResetSaving,
  maintenanceBusy,
  uncertainOperation,
  loadStatus,
  loadBackups,
  createBackup,
  downloadBackup,
  openRestore,
  closeRestore,
  restore,
  deleteBackup,
  openSystemResetDialog,
  closeSystemResetDialog,
  resetSystem,
  relogin,
} = maintenance;

const maintenanceTab = ref<MaintenanceTab>("operations");
const maintenanceTabs = computed<PageTabItem[]>(() => [
  { value: "operations", label: t("operations.statusTab") },
  { value: "backup", label: t("settings.backupRestoreTab"), disabled: !context.can("system.reset") },
  { value: "reset", label: t("operations.resetTab"), disabled: !context.can("system.reset") },
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
  const unauthorized = !context.can("system.reset") && (value === "backup" || value === "reset");
  if (!known || unauthorized) {
    void router.replace(routeForPage("settings", { settingsSection: "maintenance" }));
  }
}

function loadCurrentTab() {
  if (maintenanceTab.value === "operations") void loadStatus();
  if (maintenanceTab.value === "backup" && context.can("system.reset")) void loadBackups();
}

watch(
  [() => route.query.tab, () => context.can("system.reset")],
  () => {
    syncMaintenanceTabFromRoute();
    loadCurrentTab();
  },
  { immediate: true },
);

function changeMaintenanceTab(value: string) {
  if (value !== "operations" && value !== "backup" && value !== "reset") return;
  if (value !== "operations" && !context.can("system.reset")) return;
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
            <ToolbarIconButton :icon="Refresh" :label="t('common.refresh')" :loading="backupLoading" :disabled="backupLoading || maintenanceBusy" @click="loadBackups" />
            <el-button type="primary" :loading="backupCreating" :disabled="backupLoading || maintenanceBusy" @click="createBackup">
              {{ t('settings.createBackup') }}
            </el-button>
          </template>
        </template>
      </PageToolbar>

      <div class="settings-maintenance">
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
          :creating="backupCreating"
          :restoring="backupRestoring"
          :deleting="backupDeleting"
          :pending-filename="pendingFilename"
          :error="backupError"
          :notice="backupNotice"
          :has-non-transactional-tables="hasNonTransactionalTables"
          :restore-dialog-visible="restoreDialogVisible"
          :restore-confirmation="restoreConfirmation"
          :restore-target="restoreTarget"
          :restore-confirmation-valid="restoreConfirmationValid"
          @update:restore-dialog-visible="restoreDialogVisible = $event"
          @update:restore-confirmation="restoreConfirmation = $event"
          @load="loadBackups"
          @create="createBackup"
          @download="downloadBackup"
          @open-restore="openRestore"
          @close-restore="closeRestore"
          @restore="restore"
          @delete="deleteBackup"
        />

        <template v-if="maintenanceTab === 'reset' && context.can('system.reset')">
          <el-alert
            :title="t('settings.highRiskAction')"
            type="warning"
            show-icon
            :closable="false"
            :description="t('settings.systemResetDescription')"
          />
          <section class="settings-maintenance__section">
            <div class="settings-maintenance__intro">
              <h2>{{ t('settings.systemReset') }}</h2>
              <p>{{ t('settings.systemResetIntro') }}</p>
            </div>
            <el-descriptions :column="1" border>
              <el-descriptions-item :label="t('settings.clearData')">{{ t('settings.resetClears') }}</el-descriptions-item>
              <el-descriptions-item :label="t('settings.keepData')">{{ t('settings.resetKeeps') }}</el-descriptions-item>
              <el-descriptions-item :label="t('settings.willNotExecute')">{{ t('settings.resetDoesNot') }}</el-descriptions-item>
            </el-descriptions>
            <div class="settings-maintenance__action">
              <el-button type="danger" :disabled="maintenanceBusy" @click="openSystemResetDialog">{{ t('settings.systemReset') }}</el-button>
            </div>
          </section>
        </template>
      </div>

      <el-alert
        v-if="uncertainOperation"
        class="settings-maintenance__result-alert"
        :title="t('settings.maintenanceOperationUnknown')"
        type="warning"
        show-icon
        :closable="false"
      />
      <el-alert v-if="restoreResult" class="settings-maintenance__result-alert" type="warning" show-icon :closable="false">
        <template #title>{{ t('settings.backupRestoreSessionInvalidated') }}</template>
        <el-button size="small" type="primary" @click="relogin">{{ t('auth.login') }}</el-button>
      </el-alert>
    </PageContent>
  </PageContainer>

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
            @keyup.enter="resetSystem"
          />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button :disabled="systemResetSaving" @click="closeSystemResetDialog">{{ t('common.cancel') }}</el-button>
      <el-button
        type="danger"
        :loading="systemResetSaving"
        :disabled="resetConfirmation !== systemResetConfirmationToken"
        @click="resetSystem"
      >
        {{ t('settings.confirmReset') }}
      </el-button>
    </template>
  </el-dialog>
</template>
