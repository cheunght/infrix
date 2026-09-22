<script setup lang="ts">
import { toRefs } from "vue";
import { Delete, Download, Refresh } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import type { SystemMaintenanceDependencies } from "../page-context";
import type { BackupEntry } from "../types";
import TableIconButton from "./TableIconButton.vue";

const props = defineProps<{
  context: SystemMaintenanceDependencies;
  backups: BackupEntry[];
  loading: boolean;
  creating: boolean;
  restoring: boolean;
  deleting: boolean;
  pendingFilename: string;
  error: string;
  notice: string;
  hasNonTransactionalTables: boolean;
  restoreDialogVisible: boolean;
  restoreConfirmation: string;
  restoreTarget: BackupEntry | null;
  restoreConfirmationValid: boolean;
}>();
const emit = defineEmits<{
  (event: "update:restore-dialog-visible", value: boolean): void;
  (event: "update:restore-confirmation", value: string): void;
  (event: "load"): void;
  (event: "create"): void;
  (event: "download", value: BackupEntry): void;
  (event: "open-restore", value: BackupEntry): void;
  (event: "close-restore"): void;
  (event: "restore"): void;
  (event: "delete", value: BackupEntry): void;
}>();
const { t } = useI18n();
const context = props.context;
const {
  backups,
  loading,
  creating,
  restoring,
  deleting,
  pendingFilename,
  error,
  notice,
  hasNonTransactionalTables,
  restoreDialogVisible,
  restoreConfirmation,
  restoreTarget,
  restoreConfirmationValid,
} = toRefs(props);

function formatSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatCreatedAt(value: string): string {
  return context.formatDateTime(value || null);
}

function updateRestoreDialogVisible(value: boolean) {
  emit("update:restore-dialog-visible", value);
}

function updateRestoreConfirmation(value: string) {
  emit("update:restore-confirmation", value);
}
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
                <TableIconButton :icon="Download" :label="t('settings.downloadBackup')" type="primary" :disabled="pendingFilename !== '' || creating || restoring || deleting || !row.valid" @click="emit('download', row)" />
                <TableIconButton :icon="Refresh" :label="t('settings.restoreBackup')" :disabled="pendingFilename !== '' || creating || restoring || deleting || !row.valid" @click="emit('open-restore', row)" />
                <TableIconButton :icon="Delete" :label="t('settings.deleteBackup')" type="danger" :loading="pendingFilename === row.filename" :disabled="pendingFilename !== '' || creating || restoring || deleting" @click="emit('delete', row)" />
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
                <TableIconButton :icon="Download" :label="t('settings.downloadBackup')" type="primary" :disabled="pendingFilename !== '' || creating || restoring || deleting || !row.valid" @click="emit('download', row)" />
                <TableIconButton :icon="Refresh" :label="t('settings.restoreBackup')" :disabled="pendingFilename !== '' || creating || restoring || deleting || !row.valid" @click="emit('open-restore', row)" />
                <TableIconButton :icon="Delete" :label="t('settings.deleteBackup')" type="danger" :loading="pendingFilename === row.filename" :disabled="pendingFilename !== '' || creating || restoring || deleting" @click="emit('delete', row)" />
              </el-button-group>
            </div>
          </div>
        </article>
      </div>
    </div>

    <p class="backup-restore-page__help">{{ t("settings.backupRestoreHelp") }}</p>

    <el-dialog
      class="backup-restore-dialog"
      :model-value="restoreDialogVisible"
      :title="t('settings.restoreBackup')"
      width="560px"
      :close-on-click-modal="!restoring"
      :close-on-press-escape="!restoring"
      :show-close="!restoring"
      @update:model-value="updateRestoreDialogVisible"
      @close="emit('close-restore')"
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
        <el-form label-position="top" @submit.prevent="emit('restore')">
          <el-form-item :label="t('settings.restoreConfirmationLabel')" required>
            <el-input :model-value="restoreConfirmation" :placeholder="t('settings.restoreConfirmationPlaceholder')" autocomplete="off" @update:model-value="updateRestoreConfirmation" />
            <p class="form-hint">{{ t("settings.restoreConfirmationHelp") }}</p>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button :disabled="restoring" @click="emit('close-restore')">{{ t("common.cancel") }}</el-button>
        <el-button type="danger" :loading="restoring" :disabled="!restoreConfirmationValid" @click="emit('restore')">{{ t("settings.restoreBackup") }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>
