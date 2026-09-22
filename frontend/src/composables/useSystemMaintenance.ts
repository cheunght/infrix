import { computed, getCurrentInstance, onBeforeUnmount, ref } from "vue";
import { isAbortError } from "../api";
import { normalizeApiError } from "../error-handling";
import { i18n } from "../i18n";
import type { SystemMaintenanceDependencies } from "../page-context";
import type { BackupEntry, BackupListResponse, BackupRestoreResult } from "../types";

export type SystemOperations = {
  application: Record<string, string>;
  database: {
    status: string;
    engine: string;
    version: string | null;
    migrations: string;
    pending: number | null;
  };
  smtp?: { status: string; digest_enabled: boolean };
  ldap?: { status: string };
  configuration_status?: string;
};

export type MaintenanceOperation =
  | "backup:create"
  | "backup:restore"
  | "backup:delete"
  | "system:reset";

const BACKUP_ERROR_KEYS: Record<string, string> = {
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
  reset_confirmation_required: "settings.resetConfirmationError",
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
  system_reset_failed: "settings.resetFailed",
};

export function useSystemMaintenance(deps: SystemMaintenanceDependencies) {
  const t = (key: string, params?: Record<string, unknown>) =>
    String(params ? i18n.global.t(key, params) : i18n.global.t(key));
  const status = ref<SystemOperations | null>(null);
  const statusLoading = ref(false);
  const statusError = ref("");
  const backups = ref<BackupEntry[]>([]);
  const backupLoading = ref(false);
  const backupError = ref("");
  const backupNotice = ref("");
  const pendingFilename = ref("");
  const restoreDialogVisible = ref(false);
  const restoreConfirmation = ref("");
  const restoreTarget = ref<BackupEntry | null>(null);
  const restoreResult = ref<BackupRestoreResult | null>(null);
  const resetDialogVisible = ref(false);
  const resetConfirmation = ref("");
  const resetError = ref("");
  const uncertainOperation = ref(false);
  const activeOperation = ref<MaintenanceOperation | null>(null);
  const statusGeneration = ref(0);
  let statusController: AbortController | null = null;
  let backupListController: AbortController | null = null;

  const systemOperationsBusy = computed(() => statusLoading.value);
  const backupCreating = computed(() => activeOperation.value === "backup:create");
  const backupRestoring = computed(() => activeOperation.value === "backup:restore");
  const backupDeleting = computed(() => activeOperation.value === "backup:delete");
  const systemResetSaving = computed(() => activeOperation.value === "system:reset");
  const maintenanceBusy = computed(() => activeOperation.value !== null);
  const hasNonTransactionalTables = computed(() =>
    backups.value.some((entry) => Boolean(entry.transaction_consistency_warning)),
  );
  const restoreConfirmationValid = computed(() => restoreConfirmation.value === "RESTORE INFRIX");
  const systemResetConfirmationToken = computed(() => "RESET INFRIX");

  function errorText(value: unknown, fallback: string): string {
    const normalized = normalizeApiError(value);
    const key = normalized.code ? BACKUP_ERROR_KEYS[normalized.code] : undefined;
    if (key) {
      const translated = String(t(key, { token: systemResetConfirmationToken.value }));
      if (translated !== key) return translated;
    }
    return normalized.message || t(fallback);
  }

  function setActionError(value: unknown, fallback: string) {
    const normalized = normalizeApiError(value);
    uncertainOperation.value = normalized.kind === "network";
    backupError.value = uncertainOperation.value
      ? t("settings.maintenanceOperationUnknown")
      : errorText(value, fallback);
  }

  function beginOperation(operation: MaintenanceOperation): boolean {
    if (activeOperation.value || !deps.can("system.reset")) return false;
    activeOperation.value = operation;
    uncertainOperation.value = false;
    backupError.value = "";
    backupNotice.value = "";
    resetError.value = "";
    return true;
  }

  function finishOperation() {
    activeOperation.value = null;
  }

  async function loadStatus(): Promise<boolean> {
    const generation = statusGeneration.value + 1;
    statusGeneration.value = generation;
    statusController?.abort();
    const controller = new AbortController();
    statusController = controller;
    statusLoading.value = true;
    statusError.value = "";
    try {
      const result = await deps.request<SystemOperations>("/system/operations/", { signal: controller.signal });
      if (generation !== statusGeneration.value) return false;
      status.value = result;
      return true;
    } catch (error) {
      if (generation !== statusGeneration.value || isAbortError(error)) return false;
      status.value = null;
      statusError.value = normalizeApiError(error).message;
      return false;
    } finally {
      if (generation === statusGeneration.value) {
        statusLoading.value = false;
        if (statusController === controller) statusController = null;
      }
    }
  }

  async function loadBackups(): Promise<boolean> {
    if (backupLoading.value) return false;
    const controller = new AbortController();
    backupListController?.abort();
    backupListController = controller;
    backupLoading.value = true;
    backupError.value = "";
    try {
      const response = await deps.request<BackupListResponse>("/system/backups/", { signal: controller.signal });
      backups.value = Array.isArray(response)
        ? response as unknown as BackupEntry[]
        : response?.results || [];
      return true;
    } catch (error) {
      if (isAbortError(error)) return false;
      backupError.value = errorText(error, "settings.backupListFailed");
      return false;
    } finally {
      if (backupListController === controller) {
        backupListController = null;
        backupLoading.value = false;
      }
    }
  }

  function backupEndpoint(filename: string, suffix = "") {
    return `/system/backups/${encodeURIComponent(filename)}${suffix}`;
  }

  async function createBackup() {
    if (backupLoading.value || !beginOperation("backup:create")) return;
    try {
      const result = await deps.request<BackupEntry>("/system/backups/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const refreshed = await loadBackups();
      backupNotice.value = t(
        refreshed ? "settings.backupCreated" : "settings.backupCreatedRefreshFailed",
        { filename: result.filename },
      );
    } catch (error) {
      setActionError(error, "settings.backupCreateFailed");
    } finally {
      finishOperation();
    }
  }

  async function downloadBackup(entry: BackupEntry) {
    if (!entry.valid || pendingFilename.value || maintenanceBusy.value || !deps.can("system.reset")) return;
    pendingFilename.value = entry.filename;
    backupError.value = "";
    try {
      await deps.downloadFile(backupEndpoint(entry.filename, "/download/"), entry.filename);
    } catch (error) {
      backupError.value = errorText(error, "settings.backupDownloadFailed");
    } finally {
      pendingFilename.value = "";
    }
  }

  function openRestore(entry: BackupEntry) {
    if (!entry.valid || pendingFilename.value || maintenanceBusy.value || !deps.can("system.reset")) return;
    restoreTarget.value = entry;
    restoreConfirmation.value = "";
    restoreResult.value = null;
    restoreDialogVisible.value = true;
  }

  function closeRestore() {
    if (backupRestoring.value) return;
    restoreDialogVisible.value = false;
    restoreConfirmation.value = "";
    restoreTarget.value = null;
  }

  async function restore() {
    const target = restoreTarget.value;
    if (!target || !restoreConfirmationValid.value || !beginOperation("backup:restore")) return;
    try {
      const result = await deps.request<BackupRestoreResult>(backupEndpoint(target.filename, "/restore/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: restoreConfirmation.value }),
      });
      restoreResult.value = result;
      backupNotice.value = t("settings.backupRestored", {
        filename: result.filename,
        safety: result.safety_backup,
      });
      restoreDialogVisible.value = false;
      restoreConfirmation.value = "";
      restoreTarget.value = null;
    } catch (error) {
      setActionError(error, "settings.backupRestoreFailed");
    } finally {
      finishOperation();
    }
  }

  async function deleteBackup(entry: BackupEntry) {
    if (pendingFilename.value || maintenanceBusy.value || !deps.can("system.reset")) return;
    const confirmed = await deps.confirmAction(t("settings.backupDeleteConfirm", { filename: entry.filename }));
    if (!confirmed || !beginOperation("backup:delete")) return;
    pendingFilename.value = entry.filename;
    try {
      await deps.request(backupEndpoint(entry.filename, "/"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: `DELETE ${entry.filename}` }),
      });
      const refreshed = await loadBackups();
      backupNotice.value = t(
        refreshed ? "settings.backupDeleted" : "settings.backupDeletedRefreshFailed",
        { filename: entry.filename },
      );
    } catch (error) {
      setActionError(error, "settings.backupDeleteFailed");
    } finally {
      pendingFilename.value = "";
      finishOperation();
    }
  }

  function openSystemResetDialog() {
    if (!deps.can("system.reset") || maintenanceBusy.value) return;
    resetConfirmation.value = "";
    resetError.value = "";
    resetDialogVisible.value = true;
  }

  function closeSystemResetDialog() {
    if (systemResetSaving.value) return;
    resetDialogVisible.value = false;
    resetConfirmation.value = "";
    resetError.value = "";
  }

  async function resetSystem() {
    if (!deps.can("system.reset") || resetConfirmation.value !== systemResetConfirmationToken.value) {
      resetError.value = t("settings.resetConfirmationError", { token: systemResetConfirmationToken.value });
      return;
    }
    if (!beginOperation("system:reset")) return;
    try {
      await deps.request("/system/reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: resetConfirmation.value }),
      });
      resetDialogVisible.value = false;
      resetConfirmation.value = "";
      resetError.value = "";
      deps.reload();
    } catch (error) {
      const normalized = normalizeApiError(error);
      uncertainOperation.value = normalized.kind === "network";
      resetError.value = uncertainOperation.value
        ? t("settings.maintenanceOperationUnknown")
        : errorText(error, "settings.resetFailed");
    } finally {
      finishOperation();
    }
  }

  function relogin() {
    deps.reload();
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      statusGeneration.value += 1;
      statusController?.abort();
      backupListController?.abort();
    });
  }

  return {
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
  };
}

export type SystemMaintenanceController = ReturnType<typeof useSystemMaintenance>;
