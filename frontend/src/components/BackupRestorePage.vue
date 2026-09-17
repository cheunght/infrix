<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Delete, Download, Refresh } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import type { BackupEntry, BackupListResponse, BackupRestoreResult } from "../types";
import { isAbortError } from "../api";
import { normalizeApiError } from "../error-handling";
import TableIconButton from "./TableIconButton.vue";

const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();
const context = props.context;

const backups = ref<BackupEntry[]>([]);
const loading = ref(false);
const creating = ref(false);
const error = ref("");
const notice = ref("");
const pendingFilename = ref("");
const restoreDialogVisible = ref(false);
const restoreConfirmation = ref("");
const restoreTarget = ref<BackupEntry | null>(null);
const restoring = ref(false);
let backupListController: AbortController | null = null;

const backupErrorKeys: Record<string, string> = {
  mariadb_required: "settings.backupMariaDbRequired",
  backup_directory_invalid: "settings.backupDirectoryInvalid",
  backup_directory_unwritable: "settings.backupDirectoryUnwritable",
  dump_client_missing: "settings.backupDumpClientMissing",
  restore_client_missing: "settings.backupRestoreClientMissing",
  database_dump_failed: "settings.backupDatabaseDumpFailed",
  database_dump_empty: "settings.backupDatabaseDumpEmpty",
  database_archive_failed: "settings.backupDatabaseArchiveFailed",
  database_configuration_invalid: "settings.backupDatabaseConfigurationInvalid",
  migration_state_unavailable: "settings.backupMigrationStateUnavailable",
  backup_archive_failed: "settings.backupArchiveFailed",
  database_restore_failed: "settings.backupDatabaseRestoreFailed",
  safety_backup_failed: "settings.backupSafetyBackupFailed",
  backup_operation_in_progress: "settings.backupOperationInProgress",
  backup_not_found: "settings.backupNotFound",
  restore_confirmation_required: "settings.backupRestoreConfirmationRequired",
  delete_confirmation_required: "settings.backupDeleteConfirmationRequired",
  backup_delete_failed: "settings.backupDeleteFailed",
  backup_extract_failed: "settings.backupArchiveInvalid",
  backup_media_directory_conflict: "settings.backupDirectoryInvalid",
  backup_public_directory: "settings.backupDirectoryInvalid",
  media_directory_invalid: "settings.backupDirectoryInvalid",
  media_backup_failed: "settings.backupMediaBackupFailed",
  media_contains_symlink: "settings.backupArchiveInvalid",
  media_contains_special_file: "settings.backupArchiveInvalid",
  media_missing: "settings.backupArchiveInvalid",
  media_restore_failed: "settings.backupMediaRestoreFailed",
  manifest_invalid: "settings.backupArchiveInvalid",
  post_restore_validation_failed: "settings.backupPostRestoreValidationFailed",
  restore_failed: "settings.backupRestoreFailed",
  backup_application_mismatch: "settings.backupApplicationMismatch",
  backup_database_mismatch: "settings.backupDatabaseMismatch",
  backup_format_unsupported: "settings.backupFormatUnsupported",
  migration_state_incompatible: "settings.backupMigrationIncompatible",
  unsafe_archive_path: "settings.backupUnsafeArchive",
  unsafe_archive_member: "settings.backupUnsafeArchive",
  backup_archive_invalid: "settings.backupArchiveInvalid",
  unsupported_archive_content: "settings.backupArchiveInvalid",
  database_dump_invalid: "settings.backupArchiveInvalid",
  database_dump_missing: "settings.backupArchiveInvalid",
};

const canManage = computed(() => context.can("system.reset"));
const hasNonTransactionalTables = computed(() => backups.value.some((entry) => Boolean(entry.transaction_consistency_warning)));
const restoreConfirmationValid = computed(() => restoreConfirmation.value === "RESTORE INFRIX");

function errorText(value: unknown, fallback: string): string {
  const normalized = normalizeApiError(value);
  const key = normalized.code ? backupErrorKeys[normalized.code] : undefined;
  return key ? t(key) : normalized.message || t(fallback);
}

function backupEndpoint(filename: string, suffix = ""): string {
  return `/system/backups/${encodeURIComponent(filename)}${suffix}`;
}

function formatSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatCreatedAt(value: string): string {
  return context.formatDateTime(value || null);
}

async function loadBackups(): Promise<boolean> {
  if (loading.value) return false;
  const controller = new AbortController();
  backupListController?.abort();
  backupListController = controller;
  loading.value = true;
  error.value = "";
  try {
    // Keep this page's list request independent from the application-level
    // route loading controller. Switching into the maintenance tab can
    // otherwise abort this request immediately after the component mounts.
    const response = await context.request<BackupListResponse>("/system/backups/", {
      signal: controller.signal,
    });
    backups.value = Array.isArray(response)
      ? response as unknown as BackupEntry[]
      : response?.results || [];
    return true;
  } catch (value) {
    if (isAbortError(value)) return false;
    error.value = errorText(value, "settings.backupListFailed");
    return false;
  } finally {
    if (backupListController === controller) {
      backupListController = null;
      loading.value = false;
    }
  }
}

async function createBackup(): Promise<void> {
  if (creating.value || loading.value || !canManage.value) return;
  creating.value = true;
  notice.value = "";
  error.value = "";
  try {
    const result = await context.request<BackupEntry>("/system/backups/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const refreshed = await loadBackups();
    notice.value = t(
      refreshed ? "settings.backupCreated" : "settings.backupCreatedRefreshFailed",
      { filename: result.filename },
    );
  } catch (value) {
    error.value = errorText(value, "settings.backupCreateFailed");
  } finally {
    creating.value = false;
  }
}

async function downloadBackup(entry: BackupEntry): Promise<void> {
  if (!entry.valid || pendingFilename.value || !canManage.value) return;
  pendingFilename.value = entry.filename;
  error.value = "";
  try {
    await context.downloadFile(backupEndpoint(entry.filename, "/download/"), entry.filename);
  } catch (value) {
    error.value = errorText(value, "settings.backupDownloadFailed");
  } finally {
    pendingFilename.value = "";
  }
}

function openRestore(entry: BackupEntry): void {
  if (!entry.valid || pendingFilename.value || creating.value || !canManage.value) return;
  restoreTarget.value = entry;
  restoreConfirmation.value = "";
  restoreDialogVisible.value = true;
}

function closeRestore(): void {
  if (restoring.value) return;
  restoreDialogVisible.value = false;
  restoreConfirmation.value = "";
  restoreTarget.value = null;
}

async function restore(): Promise<void> {
  const target = restoreTarget.value;
  if (!target || restoring.value || !restoreConfirmationValid.value || !canManage.value) return;
  restoring.value = true;
  error.value = "";
  try {
    const result = await context.request<BackupRestoreResult>(backupEndpoint(target.filename, "/restore/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: restoreConfirmation.value }),
    });
    notice.value = t("settings.backupRestored", {
      filename: result.filename,
      safety: result.safety_backup,
    });
    // The backend invalidates all sessions as part of a successful restore.
    // Clear the dialog directly because closeRestore intentionally refuses to
    // close while a restore request is still in flight.
    restoreDialogVisible.value = false;
    restoreConfirmation.value = "";
    restoreTarget.value = null;
    // Restore invalidates sessions. Do not issue a follow-up request with the
    // session that the backend has deliberately invalidated.
  } catch (value) {
    error.value = errorText(value, "settings.backupRestoreFailed");
  } finally {
    restoring.value = false;
  }
}

async function deleteBackup(entry: BackupEntry): Promise<void> {
  if (pendingFilename.value || creating.value || restoring.value || !canManage.value) return;
  const confirmed = await context.confirmAction(t("settings.backupDeleteConfirm", { filename: entry.filename }));
  if (!confirmed) return;
  pendingFilename.value = entry.filename;
  error.value = "";
  try {
    await context.request(backupEndpoint(entry.filename, "/"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: `DELETE ${entry.filename}` }),
    });
    const refreshed = await loadBackups();
    notice.value = t(
      refreshed ? "settings.backupDeleted" : "settings.backupDeletedRefreshFailed",
      { filename: entry.filename },
    );
  } catch (value) {
    error.value = errorText(value, "settings.backupDeleteFailed");
  } finally {
    pendingFilename.value = "";
  }
}

onMounted(() => {
  void loadBackups();
});

onBeforeUnmount(() => {
  backupListController?.abort();
  backupListController = null;
});

defineExpose({ loading, creating, restoring, loadBackups, createBackup });
</script>

<template>
  <section class="backup-restore-page">
    <header class="backup-restore-page__header">
      <p class="backup-restore-page__description">{{ t("settings.backupRestoreDescription") }}</p>
    </header>

    <el-alert
      class="backup-restore-page__notice"
      :title="t('settings.backupSafetyNotice')"
      type="warning"
      show-icon
      :closable="false"
    />
    <el-alert v-if="error" class="backup-restore-page__notice" :title="error" type="error" show-icon :closable="false" />
    <el-alert v-if="notice" class="backup-restore-page__notice" :title="notice" type="success" show-icon :closable="false" />
    <el-alert
      v-if="hasNonTransactionalTables"
      class="backup-restore-page__notice"
      :title="t('settings.backupNonTransactionalWarning')"
      type="warning"
      show-icon
      :closable="false"
    />

    <el-skeleton v-if="loading && !backups.length" :rows="5" animated />
    <el-empty v-else-if="!loading && !backups.length" :description="t('settings.noBackups')" />
    <div v-else class="backup-restore-results">
      <el-table class="backup-restore-table" :data="backups" row-key="id" table-layout="fixed">
        <el-table-column :label="t('settings.backupType')" width="82">
          <template #default="{ row }">
            {{ row.backup_type === "pre_restore" ? t("settings.backupPreRestore") : t("settings.backupManual") }}
          </template>
        </el-table-column>
        <el-table-column prop="filename" :label="t('settings.backupFile')" width="170" class-name="backup-restore-table__filename" />
        <el-table-column :label="t('settings.backupCreatedAt')" width="176">
          <template #default="{ row }">{{ formatCreatedAt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column :label="t('settings.backupSize')" width="82">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column :label="t('settings.backupDatabase')" width="90">
          <template #default="{ row }">{{ row.database_engine }}</template>
        </el-table-column>
        <el-table-column :label="t('settings.backupMedia')" width="104">
          <template #default="{ row }">
            <el-tag :type="row.media_included ? 'success' : 'info'" effect="plain">
              {{ row.media_included ? t("settings.backupIncluded") : t("settings.backupNotIncluded") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('settings.backupIntegrity')" width="90">
          <template #default="{ row }">
            <el-tag :type="row.valid ? 'success' : 'danger'" effect="plain">
              {{ row.valid ? t("settings.backupValid") : t("settings.backupInvalid") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.operation')" width="116" fixed="right">
          <template #default="{ row }">
            <div class="backup-restore-table__actions">
              <el-button-group>
                <TableIconButton :icon="Download" :label="t('settings.downloadBackup')" type="primary" :disabled="pendingFilename !== '' || !row.valid" @click="downloadBackup(row)" />
                <TableIconButton :icon="Refresh" :label="t('settings.restoreBackup')" :disabled="pendingFilename !== '' || creating || restoring || !row.valid" @click="openRestore(row)" />
                <TableIconButton :icon="Delete" :label="t('settings.deleteBackup')" type="danger" :loading="pendingFilename === row.filename" :disabled="pendingFilename !== '' || creating || restoring" @click="deleteBackup(row)" />
              </el-button-group>
            </div>
            <small v-if="!row.valid" class="backup-restore-table__error">{{ row.validation_error || t("settings.backupInvalid") }}</small>
          </template>
        </el-table-column>
      </el-table>

      <div class="backup-restore-list" role="list">
        <article v-for="row in backups" :key="row.id" class="backup-restore-list__item" role="listitem">
          <div class="backup-restore-list__heading">
            <strong class="backup-restore-list__filename">{{ row.filename }}</strong>
            <el-tag size="small" effect="plain">{{ row.backup_type === "pre_restore" ? t("settings.backupPreRestore") : t("settings.backupManual") }}</el-tag>
          </div>
          <dl class="backup-restore-list__details">
            <div><dt>{{ t("settings.backupCreatedAt") }}</dt><dd>{{ formatCreatedAt(row.created_at) }}</dd></div>
            <div><dt>{{ t("settings.backupSize") }}</dt><dd>{{ formatSize(row.size) }}</dd></div>
            <div><dt>{{ t("settings.backupDatabase") }}</dt><dd>{{ row.database_engine }}</dd></div>
            <div><dt>{{ t("settings.backupMedia") }}</dt><dd>{{ row.media_included ? t("settings.backupIncluded") : t("settings.backupNotIncluded") }}</dd></div>
            <div><dt>{{ t("settings.backupIntegrity") }}</dt><dd :class="{ 'is-invalid': !row.valid }">{{ row.valid ? t("settings.backupValid") : t("settings.backupInvalid") }}</dd></div>
          </dl>
          <div class="backup-restore-list__footer">
            <small v-if="!row.valid" class="backup-restore-list__error">{{ row.validation_error || t("settings.backupInvalid") }}</small>
            <div class="backup-restore-table__actions">
              <el-button-group>
                <TableIconButton :icon="Download" :label="t('settings.downloadBackup')" type="primary" :disabled="pendingFilename !== '' || !row.valid" @click="downloadBackup(row)" />
                <TableIconButton :icon="Refresh" :label="t('settings.restoreBackup')" :disabled="pendingFilename !== '' || creating || restoring || !row.valid" @click="openRestore(row)" />
                <TableIconButton :icon="Delete" :label="t('settings.deleteBackup')" type="danger" :loading="pendingFilename === row.filename" :disabled="pendingFilename !== '' || creating || restoring" @click="deleteBackup(row)" />
              </el-button-group>
            </div>
          </div>
        </article>
      </div>
    </div>

    <p class="backup-restore-page__help">{{ t("settings.backupRestoreHelp") }}</p>

    <el-dialog
      v-model="restoreDialogVisible"
      class="backup-restore-dialog"
      :title="t('settings.restoreBackup')"
      width="560px"
      :close-on-click-modal="!restoring"
      :close-on-press-escape="!restoring"
      :show-close="!restoring"
      @close="closeRestore"
    >
      <template v-if="restoreTarget">
        <el-alert :title="t('settings.restoreBackupWarning')" type="warning" show-icon :closable="false" />
        <dl class="backup-restore-dialog__summary">
          <div><dt>{{ t("settings.backupFile") }}</dt><dd>{{ restoreTarget.filename }}</dd></div>
          <div><dt>{{ t("settings.backupCreatedAt") }}</dt><dd>{{ formatCreatedAt(restoreTarget.created_at) }}</dd></div>
          <div><dt>{{ t("settings.backupType") }}</dt><dd>{{ restoreTarget.backup_type === "pre_restore" ? t("settings.backupPreRestore") : t("settings.backupManual") }}</dd></div>
          <div><dt>{{ t("settings.backupDatabase") }}</dt><dd>{{ restoreTarget.database_engine }}</dd></div>
          <div>
            <dt>{{ t("settings.backupMigrationState") }}</dt>
            <dd>
              <span>{{ t("settings.backupMigrationCount", { count: restoreTarget.migration_state.length }) }}</span>
              <code class="backup-restore-dialog__migration-state">{{ restoreTarget.migration_state.join(", ") }}</code>
            </dd>
          </div>
          <div><dt>{{ t("settings.backupChecksum") }}</dt><dd class="backup-restore-dialog__checksum" :title="restoreTarget.checksum">{{ restoreTarget.checksum }}</dd></div>
        </dl>
        <el-form label-position="top" @submit.prevent="restore">
          <el-form-item :label="t('settings.restoreConfirmationLabel')" required>
            <el-input v-model="restoreConfirmation" :placeholder="t('settings.restoreConfirmationPlaceholder')" autocomplete="off" />
            <p class="form-hint">{{ t("settings.restoreConfirmationHelp") }}</p>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button :disabled="restoring" @click="closeRestore">{{ t("common.cancel") }}</el-button>
        <el-button type="danger" :loading="restoring" :disabled="!restoreConfirmationValid" @click="restore">{{ t("settings.restoreBackup") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>
