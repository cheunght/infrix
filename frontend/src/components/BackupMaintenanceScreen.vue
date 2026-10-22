<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { useBackupOperations } from "../composables/useBackupOperations";
const props = defineProps<{ monitor: ReturnType<typeof useBackupOperations>; inline?: boolean }>();
const emit = defineEmits<{ (event: "continue"): void }>();
const { t } = useI18n();
const operation = computed(() => props.monitor.operation.value);
const success = computed(() => operation.value?.status === "succeeded");
const stage = computed(() => {
  if (!props.monitor.busy.value) return success.value ? t("settings.backupOperationCompleted") : t("settings.backupOperationFailed");
  const value = operation.value?.stage;
  if (value === "queued") return t("settings.backupOperationQueued");
  if (value === "draining") return t("settings.backupOperationDraining");
  if (value === "restoring_database") return t("settings.backupOperationDatabase");
  if (value === "restoring_media") return t("settings.backupOperationMedia");
  if (value === "verifying_restored_media") return t("settings.backupOperationVerifying");
  return t("settings.backupOperationRunning");
});
</script>

<template>
  <div class="backup-maintenance-screen" :class="inline ? 'backup-maintenance-screen--inline' : 'loading-screen'">
    <section class="backup-maintenance-card" aria-live="polite">
      <el-result :icon="monitor.busy.value ? 'info' : success ? 'success' : 'error'" :title="t(operation?.kind === 'restore' ? 'settings.restoreBackup' : 'settings.createBackup')" :sub-title="stage">
        <template #extra>
          <p v-if="operation?.filename">{{ operation.filename }}</p>
          <p v-if="operation?.result?.filename">{{ operation.result.filename }}</p>
          <p v-if="operation?.result?.safety_backup || operation?.safety_backup">{{ t('settings.backupOperationSafety') }} {{ operation?.result?.safety_backup || operation?.safety_backup }}</p>
          <el-alert v-if="monitor.busy.value" :title="t('settings.backupOperationWait')" type="info" :closable="false" />
          <el-alert v-if="monitor.readFailed.value" :title="t('settings.backupOperationReadFailed')" type="warning" :closable="false" />
          <el-alert v-if="operation?.detail" :title="operation.detail" type="error" :closable="false" />
          <el-alert v-if="operation?.recovery_required" :title="t('settings.backupOperationRecovery')" type="error" :closable="false" />
          <el-alert v-else-if="operation?.maintenance_closed && !monitor.busy.value" :title="t('settings.backupOperationWait')" type="info" :closable="false" />
          <p v-if="success && operation?.kind === 'restore'">{{ t('settings.backupRestoreSessionInvalidated') }}</p>
          <div class="backup-maintenance-actions">
            <el-button v-if="monitor.readFailed.value" @click="monitor.poll()">{{ t('common.refresh') }}</el-button>
            <el-button v-if="(!monitor.busy.value && !operation?.maintenance_closed) || monitor.notFound.value" type="primary" @click="emit('continue')">
              {{ t(inline ? 'settings.backupOperationRefresh' : success && operation?.kind === 'restore' ? 'settings.backupOperationLogin' : 'settings.backupOperationReturn') }}
            </el-button>
          </div>
        </template>
      </el-result>
    </section>
  </div>
</template>

<style scoped>
.backup-maintenance-card { width: min(640px, 100%); padding: 24px; overflow-wrap: anywhere; }
.backup-maintenance-card p { margin: 12px 0; }
.backup-maintenance-card .el-alert { margin: 12px 0; text-align: left; }
.backup-maintenance-actions { display: flex; justify-content: center; gap: 12px; margin-top: 20px; }
.backup-maintenance-screen--inline { margin-bottom: 16px; border: 1px solid var(--el-border-color-lighter); border-radius: var(--el-border-radius-base); }
.backup-maintenance-screen--inline .backup-maintenance-card { width: 100%; padding: 16px; }
.backup-maintenance-screen--inline :deep(.el-result) { padding: 0; align-items: stretch; text-align: left; }
.backup-maintenance-screen--inline :deep(.el-result__icon) { display: none; }
.backup-maintenance-screen--inline :deep(.el-result__title),
.backup-maintenance-screen--inline :deep(.el-result__subtitle),
.backup-maintenance-screen--inline :deep(.el-result__extra) { margin-top: 8px; }
.backup-maintenance-screen--inline :deep(.el-result__title p) { margin: 0; font-size: 15px; }
.backup-maintenance-screen--inline .backup-maintenance-actions { justify-content: flex-start; margin-top: 12px; }
</style>
