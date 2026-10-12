<script setup lang="ts">
import { toRefs } from "vue";
import { Delete, Download, RefreshLeft } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import type { SystemMaintenanceDependencies } from "../page-context";
import type { BackupEntry } from "../types";
import TableIconButton from "./TableIconButton.vue";

const props = defineProps<{
  context: SystemMaintenanceDependencies;
  backups: BackupEntry[];
  loading: boolean;
  deleting: boolean;
  busy?: boolean;
  pendingFilename: string;
  error: string;
  notice: string;
  hasNonTransactionalTables: boolean;
}>();
const emit = defineEmits<{
  (event: "load"): void;
  (event: "download", value: BackupEntry): void;
  (event: "delete", value: BackupEntry): void;
  (event: "restore", value: BackupEntry): void;
}>();
const { t } = useI18n();
const context = props.context;
const {
  backups,
  loading,
  deleting,
  busy,
  pendingFilename,
  error,
  notice,
  hasNonTransactionalTables,
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

    <el-alert :title="t('settings.backupWebNotice')" type="info" :closable="false" />
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
              {{ row.valid ? (row.media_reference_validation === "legacy_unverified" ? t("settings.backupLegacyUnverified") : t("settings.backupValid")) : t("settings.backupInvalid") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.operation')" width="148" fixed="right">
          <template #default="{ row }">
            <div class="backup-restore-table__actions">
              <el-button-group>
                <TableIconButton :icon="Download" :label="t('settings.downloadBackup')" type="primary" :disabled="pendingFilename !== '' || busy || !row.valid" @click="emit('download', row)" />
                <TableIconButton :icon="RefreshLeft" :label="t('settings.restoreBackup')" type="warning" :disabled="pendingFilename !== '' || busy || !row.valid" @click="emit('restore', row)" />
                <TableIconButton :icon="Delete" :label="t('settings.deleteBackup')" type="danger" :loading="pendingFilename === row.filename" :disabled="pendingFilename !== '' || busy" @click="emit('delete', row)" />
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
            <div><dt>{{ t("settings.backupIntegrity") }}</dt><dd :class="{ 'is-invalid': !row.valid }">{{ row.valid ? (row.media_reference_validation === "legacy_unverified" ? t("settings.backupLegacyUnverified") : t("settings.backupValid")) : t("settings.backupInvalid") }}</dd></div>
          </dl>
          <div class="backup-restore-list__footer">
            <small v-if="!row.valid" class="backup-restore-list__error">{{ row.validation_error || t("settings.backupInvalid") }}</small>
            <div class="backup-restore-table__actions">
              <el-button-group>
                <TableIconButton :icon="Download" :label="t('settings.downloadBackup')" type="primary" :disabled="pendingFilename !== '' || busy || !row.valid" @click="emit('download', row)" />
                <TableIconButton :icon="RefreshLeft" :label="t('settings.restoreBackup')" type="warning" :disabled="pendingFilename !== '' || busy || !row.valid" @click="emit('restore', row)" />
                <TableIconButton :icon="Delete" :label="t('settings.deleteBackup')" type="danger" :loading="pendingFilename === row.filename" :disabled="pendingFilename !== '' || busy" @click="emit('delete', row)" />
              </el-button-group>
            </div>
          </div>
        </article>
      </div>
    </div>

    <p class="backup-restore-page__help">{{ t("settings.backupRestoreHelp") }}</p>


  </section>
</template>
