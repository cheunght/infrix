<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit, Key, View } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import DescriptionList from "./DescriptionList.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import ActionDialogShell from "./ActionDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import type { SettingsContext } from "../page-context";
import type { AuditLog } from "../types";
import { ASSET_STATUS_OPTIONS, businessOptionLabel, roleDescription, roleLabel } from "../business-enums";
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
const {
  settingsSection,
  can,
  systemSettings,
  systemSettingsForm,
  systemSettingsDefinitions,
  systemSettingsLoading,
  systemSettingsSaving,
  systemSettingsError,
  systemSettingsFormErrors,
  systemSettingsDirty,
  ldapConfiguration,
  ldapConfigurationForm,
  ldapConfigurationLoading,
  ldapConfigurationSaving,
  ldapConfigurationError,
  ldapConfigurationFormErrors,
  ldapConfigurationDirty,
  ldapDiagnosticLoading,
  ldapDiagnosticResult,
  ldapDiagnosticError,
  retryLdapConfiguration,
  resetLdapConfigurationForm,
  saveLdapConfiguration,
  runLdapDiagnostics,
  retrySystemSettings,
  resetSystemSettingsForm,
  saveSystemSettings,
  dictionarySection,
  dictionaryPage,
  dictionaryPageSize,
  dictionaryCount,
  dictionarySearch,
  dictionaryLoading,
  dictionaryError,
  dictionarySaving,
  dictionaryActionId,
  changeDictionarySection,
  searchDictionaries,
  changeDictionaryPage,
  changeDictionaryPageSize,
  retryDictionaries,
  currentDictionaryLabel,
  openDictionaryModal,
  currentDictionaryItems,
  toggleDictionary,
  deleteDictionary,
  dictionaryItemUsed,
  currentUsername,
  organizationLoading,
  userListError,
  roleListError,
  retryOrganization,
  users,
  userSearch,
  userPage,
  userPageSize,
  userCount,
  selectedUserIds,
  userBatchSaving,
  userBatchResult,
  showUserBatchResult,
  searchUsers,
  retryUserList,
  changeUserPage,
  changeUserPageSize,
  handleUserSelection,
  clearUserSelection,
  batchUpdateUserStatus,
  closeUserBatchResult,
  userSaving,
  userPendingId,
  openUserModal,
  openUserResetModal,
  userProtectionReason,
  userDeleteProtectionReason,
  toggleUser,
  deleteUser,
  roles,
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
  showSystemResetDialog,
  systemResetConfirmation,
  systemResetConfirmationToken,
  systemResetSaving,
  systemResetError,
  openSystemResetDialog,
  closeSystemResetDialog,
  resetSystem,
} = context;

const organizationTab = ref<"users" | "roles">("users");
const userTableRef = ref<{ clearSelection: () => void } | null>(null);
const dictionaryTabs = computed<PageTabItem[]>(() => [
  { label: t("settings.manufacturers"), value: "manufacturers" },
  { label: t("settings.deviceTypes"), value: "device-types" },
  { label: t("settings.spareCategories"), value: "spare-categories" },
]);
const organizationTabs = computed<PageTabItem[]>(() => [
  { label: t("settings.users"), value: "users" },
  { label: t("settings.roles"), value: "roles" },
]);
const canManageCurrentDictionary = computed(() => can("settings.manage"));
const dictionaryPrimaryLabel = computed(() => {
  if (dictionarySection.value === "manufacturers") return t("settings.addManufacturer");
  if (dictionarySection.value === "device-types" || dictionarySection.value === "spare-categories") return t("settings.addType");
  return t("settings.addDictionary");
});
const dictionaryAttributeLabel = computed(() =>
  dictionarySection.value === "device-types"
    ? t("settings.color")
    : dictionarySection.value === "spare-categories"
      ? t("settings.typeCode")
      : t("settings.manufacturerCode"),
);
const dictionaryCountLabel = computed(() =>
  dictionarySection.value === "spare-categories" ? t("settings.spareCount") : t("settings.assetCount"),
);
const localizedDictionaryLabel = computed(() => {
  if (dictionarySection.value === "manufacturers") return t("settings.manufacturer");
  if (dictionarySection.value === "device-types") return t("settings.deviceType");
  if (dictionarySection.value === "spare-categories") return t("settings.spareCategory");
  return currentDictionaryLabel.value;
});
const hasDictionaryFilters = computed(() => Boolean(dictionarySearch.value.trim()));
const hasUserSearch = computed(() => Boolean(userSearch.value.trim()));
const userBatchFailures = computed(() =>
  (userBatchResult.value?.results || []).filter((result) => !result.success),
);

watch(selectedUserIds, (ids) => {
  if (!ids.length) userTableRef.value?.clearSelection();
});
const hasAuditFilters = computed(() => Boolean(
  auditFilters.value.search?.trim() ||
  auditFilters.value.resource_type ||
  auditFilters.value.action ||
  auditFilters.value.start ||
  auditFilters.value.end,
));
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
let userSearchTimer: ReturnType<typeof setTimeout> | null = null;

function clearUserSearchTimer() {
  if (userSearchTimer !== null) {
    clearTimeout(userSearchTimer);
    userSearchTimer = null;
  }
}

function triggerUserSearch() {
  clearUserSearchTimer();
  void searchUsers();
}

watch(userSearch, () => {
  clearUserSearchTimer();
  userSearchTimer = setTimeout(() => {
    userSearchTimer = null;
    void searchUsers();
  }, 300);
});

onBeforeUnmount(clearUserSearchTimer);

function clearDictionarySearch() {
  dictionarySearch.value = "";
  return searchDictionaries();
}

function clearAuditFilters() {
  auditFilters.value.search = "";
  auditFilters.value.actor = "";
  auditFilters.value.resource_type = "";
  auditFilters.value.action = "";
  auditFilters.value.start = "";
  auditFilters.value.end = "";
  return searchAuditLogs();
}

function openAuditDetail(log: AuditLog) {
  selectedAuditLog.value = log;
  auditDetailVisible.value = true;
}

function systemSettingDefinition(key: string) {
  return systemSettingsDefinitions.value.find((definition) => definition.key === key);
}

function systemSettingLabel(key: string) {
  const labels: Record<string, string> = {
    default_page_size: "settings.defaultPageSize",
    default_asset_status: "settings.defaultAssetStatus",
  };
  return labels[key] ? t(labels[key]) : systemSettingDefinition(key)?.label || key;
}

function systemSettingHelp(key: string) {
  const helpKeys: Record<string, string> = {
    default_page_size: "settings.defaultPageSizeHelp",
    default_asset_status: "settings.defaultAssetStatusHelp",
  };
  return helpKeys[key] ? t(helpKeys[key]) : systemSettingDefinition(key)?.help_text || "";
}

function systemSettingOptionLabel(key: string, option: { value: string | number; label: string }) {
  if (key === "default_asset_status") return businessOptionLabel(ASSET_STATUS_OPTIONS, String(option.value));
  return String(option.label);
}

function userDirectoryTooltip(user: { auth_source: string; directory_provider: string | null; directory_login_identifier: string | null; directory_last_seen_at: string | null }) {
  if (user.auth_source !== "ldap") return t("settings.localAccount");
  return [
    `${t("settings.directoryProvider")}: ${user.directory_provider || "—"}`,
    `${t("settings.directoryLoginIdentifier")}: ${user.directory_login_identifier || "—"}`,
    `${t("settings.directoryLastSeen")}: ${user.directory_last_seen_at ? formatAuditDateTime(user.directory_last_seen_at) : t("settings.directoryNeverSeen")}`,
  ].join("\n");
}

function ldapCheckLabel(name: string) {
  return t(`settings.ldapChecks.${name}`);
}

function ldapCheckTone(status: string) {
  if (status === "success") return "success" as const;
  if (status === "error") return "danger" as const;
  return "info" as const;
}

function ldapCheckStatusLabel(status: string) {
  if (status === "success") return t("settings.ldapCheckSuccess");
  if (status === "disabled") return t("settings.ldapCheckDisabled");
  return t("settings.ldapCheckFailed");
}

function ldapModeLabel(value: boolean | null) {
  if (value === true) return t("settings.ldapAdSpecific");
  if (value === false) return t("settings.ldapGenericDirectory");
  return t("settings.ldapUnknownMode");
}

const ldapPasswordEditing = ref(false);
const ldapPrimaryPortTouched = ref(false);
const ldapSecondaryPortTouched = ref(false);

function ldapDirectoryTypeLabel(value: string) {
  return value === "active_directory"
    ? t("settings.ldapActiveDirectory")
    : t("settings.ldapGenericDirectory");
}

function ldapSecurityModeLabel(value: string) {
  if (value === "ldaps") return t("settings.ldapSecurityLdaps");
  if (value === "starttls") return t("settings.ldapSecurityStarttls");
  return t("settings.ldapSecurityNone");
}

function applyLdapSecurityDefaults() {
  const port = ldapConfigurationForm.value.security_mode === "ldaps" ? 636 : 389;
  if (!ldapPrimaryPortTouched.value) ldapConfigurationForm.value.primary_port = port;
  if (!ldapSecondaryPortTouched.value && ldapConfigurationForm.value.secondary_host) {
    ldapConfigurationForm.value.secondary_port = port;
  }
}

watch(
  () => ldapConfigurationForm.value.directory_type,
  (value) => {
    if (value === "active_directory") {
      ldapConfigurationForm.value.external_id_attribute = "objectGUID";
    }
  },
);
</script>

<template>
  <div class="infrix-page settings-page">
    <CustomFieldSettingsPage v-if="settingsSection === 'custom-fields'" :context="props.context" />
    <TagSettingsPage v-else-if="settingsSection === 'tags'" :context="props.context" />

    <PageContainer v-else-if="settingsSection === 'system' && can('settings.view')" content-class="settings-system-container">
      <PageContent surface>
        <div v-loading="systemSettingsLoading" class="settings-system">
          <el-alert
            v-if="systemSettingsError"
            :title="t('common.dataLoadFailed')"
            type="error"
            show-icon
            :closable="false"
          >
            <template #default>
              <span>{{ systemSettingsError }}</span>
              <el-button link type="danger" :loading="systemSettingsLoading" @click="retrySystemSettings">{{ t('common.retry') }}</el-button>
            </template>
          </el-alert>

          <template v-else-if="systemSettings">
            <div class="settings-system__heading">
              <div>
                <h2>{{ t('settings.runtimeParameters') }}</h2>
                <p>{{ t('settings.runtimeParametersDescription') }}</p>
              </div>
              <div class="settings-system__actions">
                <el-button :disabled="!systemSettingsDirty || systemSettingsSaving" @click="resetSystemSettingsForm">{{ t('settings.restoreUnsaved') }}</el-button>
                <el-button
                  v-if="can('settings.manage')"
                  type="primary"
                  :loading="systemSettingsSaving"
                  :disabled="!systemSettingsDirty || systemSettingsSaving"
                  @click="saveSystemSettings"
                >
                  {{ t('settings.saveSettings') }}
                </el-button>
              </div>
            </div>

            <el-alert
              v-if="!can('settings.manage')"
              :title="t('settings.readOnlyAccount')"
              :description="t('settings.readOnlySettings')"
              type="info"
              show-icon
              :closable="false"
            />

            <el-form class="settings-system__form" label-position="top" @submit.prevent="saveSystemSettings">
              <el-form-item
                :label="systemSettingLabel('default_page_size')"
                :error="systemSettingsFormErrors.default_page_size"
              >
                <el-select
                  v-model="systemSettingsForm.default_page_size"
                  :disabled="!can('settings.manage') || systemSettingsSaving"
                  class="settings-system__control"
                >
                  <el-option
                    v-for="option in (systemSettingDefinition('default_page_size')?.options || [])"
                    :key="String(option.value)"
                    :label="systemSettingOptionLabel('default_page_size', option)"
                    :value="option.value"
                  />
                </el-select>
                <div v-if="systemSettingHelp('default_page_size')" class="settings-system__help">
                  {{ systemSettingHelp('default_page_size') }}
                </div>
              </el-form-item>

              <el-form-item
                :label="systemSettingLabel('default_asset_status')"
                :error="systemSettingsFormErrors.default_asset_status"
              >
                <el-select
                  v-model="systemSettingsForm.default_asset_status"
                  :disabled="!can('settings.manage') || systemSettingsSaving"
                  class="settings-system__control"
                >
                  <el-option
                    v-for="option in (systemSettingDefinition('default_asset_status')?.options || [])"
                    :key="String(option.value)"
                    :label="systemSettingOptionLabel('default_asset_status', option)"
                    :value="option.value"
                  />
                </el-select>
                <div v-if="systemSettingHelp('default_asset_status')" class="settings-system__help">
                  {{ systemSettingHelp('default_asset_status') }}
                </div>
              </el-form-item>
            </el-form>
          </template>

          <section v-if="can('organization.manage')" class="settings-ldap-panel">
            <div class="settings-ldap-panel__heading">
              <div>
                <div class="settings-ldap-panel__eyebrow">{{ t('settings.ldapIntegration') }}</div>
                <h2>{{ t('settings.ldapConfigurationTitle') }}</h2>
                <p>{{ t('settings.ldapIntegrationDescription') }}</p>
              </div>
              <div class="settings-ldap-panel__actions">
                <el-button
                  :loading="ldapDiagnosticLoading"
                  :disabled="ldapDiagnosticLoading || ldapConfigurationLoading"
                  @click="runLdapDiagnostics"
                >
                  {{ t('settings.ldapTestConnection') }}
                </el-button>
                <el-button
                  type="primary"
                  :loading="ldapConfigurationSaving"
                  :disabled="!ldapConfigurationDirty || ldapConfigurationSaving"
                  @click="saveLdapConfiguration"
                >
                  {{ t('settings.ldapSaveConfiguration') }}
                </el-button>
              </div>
            </div>

            <el-skeleton v-if="ldapConfigurationLoading" :rows="8" animated />
            <el-alert
              v-else-if="ldapConfigurationError"
              :title="t('settings.ldapConfigurationLoadFailed')"
              :description="ldapConfigurationError"
              type="error"
              show-icon
              :closable="false"
            >
              <el-button link type="danger" @click="retryLdapConfiguration">{{ t('common.retry') }}</el-button>
            </el-alert>
            <template v-else-if="ldapConfiguration">
              <el-alert
                v-if="ldapConfiguration.source === 'environment'"
                :title="t('settings.ldapBootstrapConfiguration')"
                :description="t('settings.ldapBootstrapConfigurationDescription')"
                type="info"
                show-icon
                :closable="false"
              />
              <el-alert
                v-if="ldapConfigurationForm.security_mode === 'none'"
                :title="t('settings.ldapSecurityNoneWarning')"
                :description="t('settings.ldapSecurityNoneWarningDescription')"
                type="warning"
                show-icon
                :closable="false"
              />
              <el-alert
                v-if="ldapConfiguration.identity_anchor_locked"
                :title="t('settings.ldapIdentityAnchorLocked')"
                :description="t('settings.ldapIdentityAnchorLockedDescription', { count: ldapConfiguration.directory_identity_count })"
                type="info"
                show-icon
                :closable="false"
              />

              <el-form
                class="settings-ldap-panel__form"
                label-position="top"
                @submit.prevent="saveLdapConfiguration"
              >
                <div class="settings-ldap-panel__summary">
                  <div>
                    <span>{{ t('settings.ldapStatus') }}</span>
                    <StatusTag
                      :tone="ldapConfigurationForm.enabled ? (ldapConfiguration.configured ? 'success' : 'warning') : 'info'"
                      :label="ldapConfigurationForm.enabled ? (ldapConfiguration.configured ? t('settings.ldapEnabled') : t('settings.ldapConfigurationInvalid')) : t('settings.ldapDisabled')"
                    />
                  </div>
                  <div>
                    <span>{{ t('settings.ldapDirectoryType') }}</span>
                    <strong>{{ ldapDirectoryTypeLabel(ldapConfigurationForm.directory_type) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('settings.ldapSecretStatus') }}</span>
                    <strong>{{ ldapConfiguration.bind_password_configured && ldapConfiguration.secret_available ? t('settings.ldapSecretConfigured') : t('settings.ldapSecretMissing') }}</strong>
                  </div>
                  <div v-if="ldapConfiguration.last_diagnostic_at">
                    <span>{{ t('settings.ldapLastDiagnostic') }}</span>
                    <strong>{{ ldapConfiguration.last_diagnostic_success ? t('settings.ldapDiagnosticSuccess') : t('settings.ldapDiagnosticFailed') }}</strong>
                  </div>
                </div>

                <div class="settings-ldap-panel__grid">
                  <el-form-item :label="t('settings.ldapEnabledToggle')" :error="ldapConfigurationFormErrors.enabled">
                    <el-switch v-model="ldapConfigurationForm.enabled" :active-text="t('settings.ldapEnabled')" :inactive-text="t('settings.ldapDisabled')" />
                  </el-form-item>
                  <el-form-item :label="t('settings.ldapDirectoryType')" :error="ldapConfigurationFormErrors.directory_type">
                    <el-select v-model="ldapConfigurationForm.directory_type" class="settings-ldap-panel__control" :disabled="ldapConfigurationSaving || ldapConfiguration.identity_anchor_locked">
                      <el-option value="active_directory" :label="t('settings.ldapActiveDirectory')" />
                      <el-option value="generic_ldap" :label="t('settings.ldapGenericDirectory')" />
                    </el-select>
                  </el-form-item>
                  <el-form-item :label="t('settings.ldapSecurityMode')" :error="ldapConfigurationFormErrors.security_mode">
                    <el-select v-model="ldapConfigurationForm.security_mode" class="settings-ldap-panel__control" :disabled="ldapConfigurationSaving" @change="applyLdapSecurityDefaults">
                      <el-option value="ldaps" :label="ldapSecurityModeLabel('ldaps')" />
                      <el-option value="starttls" :label="ldapSecurityModeLabel('starttls')" />
                      <el-option value="none" :label="ldapSecurityModeLabel('none')" />
                    </el-select>
                  </el-form-item>
                  <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapPrimaryServer')" :error="ldapConfigurationFormErrors.primary_host">
                    <div class="settings-ldap-panel__host-port">
                      <el-input v-model="ldapConfigurationForm.primary_host" :placeholder="t('settings.ldapHostPlaceholder')" :disabled="ldapConfigurationSaving" />
                      <el-form-item :error="ldapConfigurationFormErrors.primary_port">
                        <el-input-number v-model="ldapConfigurationForm.primary_port" :min="1" :max="65535" controls-position="right" :disabled="ldapConfigurationSaving" @change="ldapPrimaryPortTouched = true" />
                      </el-form-item>
                    </div>
                  </el-form-item>
                  <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapSecondaryServer')" :error="ldapConfigurationFormErrors.secondary_host">
                    <div class="settings-ldap-panel__host-port">
                      <el-input v-model="ldapConfigurationForm.secondary_host" :placeholder="t('settings.ldapOptional')" :disabled="ldapConfigurationSaving" />
                      <el-form-item :error="ldapConfigurationFormErrors.secondary_port">
                        <el-input-number v-model="ldapConfigurationForm.secondary_port" :min="1" :max="65535" controls-position="right" :disabled="ldapConfigurationSaving" @change="ldapSecondaryPortTouched = true" />
                      </el-form-item>
                    </div>
                  </el-form-item>
                  <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapBaseDn')" :error="ldapConfigurationFormErrors.base_dn">
                    <el-input v-model="ldapConfigurationForm.base_dn" :placeholder="t('settings.ldapBaseDnPlaceholder')" :disabled="ldapConfigurationSaving" />
                  </el-form-item>
                  <el-form-item :label="t('settings.ldapBindAccount')" :error="ldapConfigurationFormErrors.bind_dn">
                    <el-input v-model="ldapConfigurationForm.bind_dn" :placeholder="t('settings.ldapBindAccountPlaceholder')" :disabled="ldapConfigurationSaving" />
                    <div class="settings-ldap-panel__help">{{ t('settings.ldapBindAccountHelp') }}</div>
                  </el-form-item>
                  <el-form-item :label="t('settings.ldapBindPassword')" :error="ldapConfigurationFormErrors.bind_password">
                    <div v-if="!ldapPasswordEditing" class="settings-ldap-panel__secret-control">
                      <el-input :model-value="ldapConfiguration.bind_password_configured ? '••••••••' : ''" readonly :placeholder="t('settings.ldapPasswordNotConfigured')" />
                      <el-button link type="primary" @click="ldapPasswordEditing = true">{{ t('settings.ldapUpdatePassword') }}</el-button>
                    </div>
                    <el-input
                      v-else
                      v-model="ldapConfigurationForm.bind_password"
                      type="password"
                      show-password
                      autocomplete="new-password"
                      :placeholder="t('settings.ldapPasswordPlaceholder')"
                      :disabled="ldapConfigurationSaving"
                    />
                    <div class="settings-ldap-panel__help">{{ t('settings.ldapBindPasswordHelp') }}</div>
                  </el-form-item>
                </div>

                <el-collapse class="settings-ldap-panel__advanced">
                  <el-collapse-item :title="t('settings.ldapAdvancedTitle')" name="advanced">
                    <div class="settings-ldap-panel__grid">
                      <el-form-item :label="t('settings.ldapUserSearchBase')" :error="ldapConfigurationFormErrors.user_search_base">
                        <el-input v-model="ldapConfigurationForm.user_search_base" :placeholder="t('settings.ldapUseBaseDn')" :disabled="ldapConfigurationSaving" />
                      </el-form-item>
                      <el-form-item :label="t('settings.ldapLoginAttribute')" :error="ldapConfigurationFormErrors.user_login_attribute">
                        <el-input v-model="ldapConfigurationForm.user_login_attribute" :disabled="ldapConfigurationSaving" />
                      </el-form-item>
                      <el-form-item :label="t('settings.ldapIdentityAttribute')" :error="ldapConfigurationFormErrors.external_id_attribute">
                        <el-input
                          v-model="ldapConfigurationForm.external_id_attribute"
                          :disabled="ldapConfigurationSaving || ldapConfiguration.identity_anchor_locked || ldapConfigurationForm.directory_type === 'active_directory'"
                        />
                        <div class="settings-ldap-panel__help">
                          {{ ldapConfigurationForm.directory_type === 'active_directory'
                            ? t('settings.ldapIdentityAttributeAdHelp')
                            : ldapConfiguration.identity_anchor_locked
                              ? t('settings.ldapIdentityAttributeLockedHelp')
                              : t('settings.ldapIdentityAttributeGenericHelp') }}
                        </div>
                      </el-form-item>
                      <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapUserFilter')" :error="ldapConfigurationFormErrors.user_filter">
                        <el-input v-model="ldapConfigurationForm.user_filter" :disabled="ldapConfigurationSaving" />
                        <div class="settings-ldap-panel__help">{{ t('settings.ldapUserFilterHelp') }}</div>
                      </el-form-item>
                      <el-form-item :label="t('settings.ldapTlsServerName')" :error="ldapConfigurationFormErrors.tls_server_name">
                        <el-input v-model="ldapConfigurationForm.tls_server_name" :placeholder="t('settings.ldapTlsServerNamePlaceholder')" :disabled="ldapConfigurationSaving" />
                      </el-form-item>
                      <el-form-item :label="t('settings.ldapCaCertFile')" :error="ldapConfigurationFormErrors.ca_cert_file">
                        <el-input v-model="ldapConfigurationForm.ca_cert_file" :placeholder="t('settings.ldapCaCertFilePlaceholder')" :disabled="ldapConfigurationSaving" />
                      </el-form-item>
                      <el-form-item :label="t('settings.ldapConnectTimeout')" :error="ldapConfigurationFormErrors.connect_timeout">
                        <el-input-number v-model="ldapConfigurationForm.connect_timeout" :min="1" :max="300" controls-position="right" :disabled="ldapConfigurationSaving" />
                      </el-form-item>
                      <el-form-item :label="t('settings.ldapOperationTimeout')" :error="ldapConfigurationFormErrors.operation_timeout">
                        <el-input-number v-model="ldapConfigurationForm.operation_timeout" :min="1" :max="300" controls-position="right" :disabled="ldapConfigurationSaving" />
                      </el-form-item>
                    </div>
                  </el-collapse-item>
                </el-collapse>

                <div class="settings-ldap-panel__footer">
                  <el-button :disabled="!ldapConfigurationDirty || ldapConfigurationSaving" @click="resetLdapConfigurationForm">{{ t('settings.restoreUnsaved') }}</el-button>
                  <span>{{ t('settings.ldapUnsavedHint') }}</span>
                </div>
              </el-form>

              <el-alert
                v-if="ldapDiagnosticError"
                class="settings-ldap-panel__diagnostic-error"
                :title="t('settings.ldapDiagnosticRequestFailed')"
                :description="ldapDiagnosticError"
                type="error"
                show-icon
                :closable="false"
              />
              <div v-if="ldapDiagnosticResult" class="settings-ldap-panel__diagnostic">
                <el-alert
                  :title="ldapDiagnosticResult.success ? t('settings.ldapDiagnosticSuccess') : t('settings.ldapDiagnosticFailed')"
                  :description="ldapDiagnosticResult.success ? t('settings.ldapDiagnosticComplete') : (ldapDiagnosticResult.message || t('settings.ldapDiagnosticRequestFailed'))"
                  :type="ldapDiagnosticResult.success ? 'success' : 'error'"
                  show-icon
                  :closable="false"
                />
                <div class="settings-ldap-panel__checks">
                  <div v-for="check in ldapDiagnosticResult.checks" :key="check.name" class="settings-ldap-panel__check">
                    <span>{{ ldapCheckLabel(check.name) }}</span>
                    <StatusTag :tone="ldapCheckTone(check.status)" :label="ldapCheckStatusLabel(check.status)" size="small" />
                  </div>
                </div>
              </div>
            </template>
          </section>
        </div>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'dictionaries'">
      <template #subnav>
        <PageTabs v-model="dictionarySection" :items="dictionaryTabs" @update:model-value="changeDictionarySection">
        </PageTabs>
      </template>
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField
              v-model="dictionarySearch"
              :loading="dictionaryLoading"
              :placeholder="t('settings.searchDictionary', { item: localizedDictionaryLabel })"
              :aria-label="t('settings.searchDictionary', { item: localizedDictionaryLabel })"
              @search="searchDictionaries"
            />
          </template>
          <template #primary>
            <el-button v-if="canManageCurrentDictionary" class="page-primary-action" type="primary" :loading="dictionarySaving" :disabled="dictionarySaving" @click="openDictionaryModal()">
              {{ dictionaryPrimaryLabel }}
            </el-button>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <el-alert v-if="dictionaryError" :title="t('settings.dictionaryLoadFailed')" type="error" show-icon :closable="false">
          <template #default>
            <span>{{ dictionaryError }}</span>
            <el-button link type="danger" :loading="dictionaryLoading" @click="retryDictionaries">{{ t('common.retry') }}</el-button>
          </template>
        </el-alert>
        <PagedTable
          v-else
          v-model:current-page="dictionaryPage"
          v-model:page-size="dictionaryPageSize"
          :total="dictionaryCount"
          @update:current-page="changeDictionaryPage"
          @update:page-size="changeDictionaryPageSize"
        >
          <el-table :key="`dictionary-table-${dictionarySection}`" class="settings-dictionary-table" v-loading="dictionaryLoading" :data="currentDictionaryItems" table-layout="fixed">
          <template #empty>
            <el-empty :image-size="56" :description="hasDictionaryFilters ? t('settings.noMatchingDictionary', { item: localizedDictionaryLabel }) : t('settings.noDictionary', { item: localizedDictionaryLabel })">
              <el-button v-if="hasDictionaryFilters" link type="primary" @click="clearDictionarySearch">{{ t('common.clearFilters') }}</el-button>
            </el-empty>
          </template>
          <el-table-column prop="name" :label="localizedDictionaryLabel" min-width="220" />
          <el-table-column :label="dictionaryAttributeLabel" width="160">
            <template #default="{ row }">
              <template v-if="dictionarySection === 'device-types'">
                <span class="color-chip" :style="{ background: row.color || '#1677EF' }" />
                {{ row.color || "#1677EF" }}
              </template>
              <template v-else>{{ row.code || "—" }}</template>
            </template>
          </el-table-column>
          <el-table-column :label="t('common.status')" width="100">
            <template #default="{ row }">
              <StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" />
            </template>
          </el-table-column>
          <el-table-column :label="dictionaryCountLabel" width="110">
            <template #default="{ row }">
              {{ dictionarySection === "spare-categories" ? (row.spare_parts_count || 0) : (row.assets_count || 0) }}
            </template>
          </el-table-column>
          <el-table-column v-if="dictionarySection === 'manufacturers'" prop="licenses_count" :label="t('settings.licenseCount')" width="110" />
          <el-table-column v-if="dictionarySection === 'manufacturers'" prop="spare_parts_count" :label="t('settings.spareCount')" width="110" />
          <el-table-column v-if="canManageCurrentDictionary" :label="t('common.operation')" width="132" fixed="right">
            <template #default="{ row }">
              <div class="ep-table-actions">
                <TableIconButton
                  :icon="Edit"
                  :label="t('common.edit')"
                  type="primary"
                  :disabled="dictionaryActionId === row.id"
                  @click="openDictionaryModal(row)"
                />
                <TableIconButton
                  :icon="row.is_active ? CircleClose : CircleCheck"
                  :label="row.is_active ? t('status.inactive') : t('status.active')"
                  :disabled="dictionaryActionId === row.id"
                  @click="toggleDictionary(row)"
                />
                <TableIconButton
                  :icon="Delete"
                  :label="t('common.delete')"
                  type="danger"
                  :disabled="dictionaryActionId === row.id || dictionaryItemUsed(row)"
                  @click="deleteDictionary(row)"
                />
              </div>
            </template>
          </el-table-column>
          </el-table>
        </PagedTable>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'organization' && can('organization.manage')">
      <template #subnav>
        <PageTabs v-model="organizationTab" :items="organizationTabs" />
      </template>
      <template #toolbar>
        <PageToolbar>
          <template v-if="organizationTab === 'users'" #search>
            <SearchField
              v-model="userSearch"
              :loading="organizationLoading"
              :disabled="organizationLoading"
              :placeholder="t('settings.userSearchPlaceholder')"
              :aria-label="t('settings.user')"
              @search="triggerUserSearch"
            />
          </template>
          <template v-if="organizationTab === 'users'" #primary>
            <div class="settings-user-primary-actions">
              <div v-if="selectedUserIds.length" class="settings-user-batch-actions">
                <el-tag type="info">{{ t('settings.selectedUsers', { count: selectedUserIds.length }) }}</el-tag>
                <el-button
                  v-if="can('organization.manage')"
                  :loading="userBatchSaving"
                  :disabled="userBatchSaving"
                  @click="batchUpdateUserStatus(true)"
                >
                  {{ t('settings.batchEnable') }}
                </el-button>
                <el-button
                  v-if="can('organization.manage')"
                  :loading="userBatchSaving"
                  :disabled="userBatchSaving"
                  @click="batchUpdateUserStatus(false)"
                >
                  {{ t('settings.batchDisable') }}
                </el-button>
                <el-button link :disabled="userBatchSaving" @click="clearUserSelection">{{ t('common.cancel') }}</el-button>
              </div>
              <el-button v-if="can('organization.manage')" class="page-primary-action" type="primary" :loading="userSaving" :disabled="userSaving || userBatchSaving" @click="openUserModal()">{{ t('settings.addUser') }}</el-button>
            </div>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <template v-if="organizationTab === 'users'">
          <el-alert v-if="userListError" :title="t('settings.userLoadFailed')" type="error" show-icon :closable="false">
            <template #default>
              <span>{{ userListError }}</span>
              <el-button link type="danger" :loading="organizationLoading" @click="retryUserList">{{ t('common.retry') }}</el-button>
            </template>
          </el-alert>
          <el-table ref="userTableRef" v-else v-loading="organizationLoading" :data="users" table-layout="fixed" @selection-change="handleUserSelection">
            <template #empty>
              <el-empty :image-size="56" :description="hasUserSearch ? t('settings.noMatchingUsers') : t('settings.noUsers')">
                <el-button v-if="hasUserSearch" link type="primary" @click="userSearch = ''; triggerUserSearch()">{{ t('common.clearFilters') }}</el-button>
              </el-empty>
            </template>
            <el-table-column type="selection" width="48" />
            <el-table-column prop="username" :label="t('settings.username')" min-width="180" />
            <el-table-column prop="display_name" :label="t('settings.name')" min-width="180" />
            <el-table-column prop="email" :label="t('auth.email')" min-width="220" />
            <el-table-column :label="t('settings.authSource')" width="116">
              <template #default="{ row }">
                <el-tooltip :content="userDirectoryTooltip(row)" placement="top">
                  <el-tag :type="row.auth_source === 'ldap' ? 'warning' : 'info'" size="small">
                    {{ row.auth_source === 'ldap' ? t('settings.ldapAccount') : t('settings.localAccount') }}
                  </el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column :label="t('settings.role')" min-width="150"><template #default="{ row }">{{ roleLabel(row.assigned_role_code, row.assigned_role_name) }}</template></el-table-column>
            <el-table-column :label="t('common.status')" width="120">
              <template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template>
            </el-table-column>
            <el-table-column v-if="can('organization.manage')" :label="t('common.operation')" width="132" fixed="right">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton
                    :icon="Edit"
                    :label="t('common.edit')"
                    type="primary"
                    :disabled="userPendingId === row.id || userSaving"
                    @click="openUserModal(row)"
                  />
                  <TableIconButton
                    v-if="row.auth_source !== 'ldap'"
                    :icon="Key"
                    :label="t('auth.changePassword')"
                    :disabled="userPendingId === row.id || userSaving"
                    @click="openUserResetModal(row)"
                  />
                  <TableIconButton
                    :icon="row.is_active ? CircleClose : CircleCheck"
                    :label="userProtectionReason(row) || (row.is_active ? t('status.inactive') : t('status.active'))"
                    :disabled="userPendingId === row.id || userSaving || Boolean(userProtectionReason(row))"
                    @click="toggleUser(row)"
                  />
                  <TableIconButton
                    :icon="Delete"
                    :label="userDeleteProtectionReason(row) || t('settings.deleteUser')"
                    type="danger"
                    :disabled="userPendingId === row.id || userSaving || Boolean(userDeleteProtectionReason(row))"
                    @click="deleteUser(row)"
                  />
                </div>
              </template>
            </el-table-column>
          </el-table>
          <PagedTable v-if="!userListError" v-model:current-page="userPage" v-model:page-size="userPageSize" :total="userCount" :page-sizes="[20, 50, 100]" @update:current-page="changeUserPage" @update:page-size="changeUserPageSize" />
        </template>
        <template v-else>
          <el-alert v-if="roleListError" :title="t('settings.roleLoadFailed')" type="error" show-icon :closable="false">
            <template #default>
              <span>{{ roleListError }}</span>
              <el-button link type="danger" :loading="organizationLoading" @click="retryOrganization">{{ t('common.retry') }}</el-button>
            </template>
          </el-alert>
          <el-table v-else v-loading="organizationLoading && !roles.length" :data="roles" table-layout="fixed">
            <template #empty><el-empty :image-size="56" :description="t('settings.noRoles')" /></template>
            <el-table-column :label="t('settings.roleName')" min-width="220"><template #default="{ row }">{{ roleLabel(row.code, row.name) }}</template></el-table-column>
            <el-table-column :label="t('settings.permissionScope')" min-width="320"><template #default="{ row }">{{ roleDescription(row.code, row.description) }}</template></el-table-column>
            <el-table-column prop="user_count" :label="t('settings.userCount')" width="120" />
          </el-table>
          <p class="form-hint">{{ t('settings.roleHint') }}</p>
        </template>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'audit' && can('audit.view')">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="auditFilters.search" :loading="auditListLoading" :placeholder="t('settings.auditSearchPlaceholder')" :aria-label="t('settings.audit')" @search="searchAuditLogs" />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select v-model="auditFilters.resource_type" :placeholder="t('settings.allResources')" clearable :disabled="auditListLoading" @change="searchAuditLogs">
                <el-option v-for="item in auditResourceOptions" :key="item.value" :label="t(item.labelKey)" :value="item.value" />
              </el-select>
              <el-select v-model="auditFilters.action" :placeholder="t('settings.allActions')" clearable :disabled="auditListLoading" @change="searchAuditLogs">
                <el-option v-for="item in auditActionOptions" :key="item.value" :label="t(item.labelKey)" :value="item.value" />
              </el-select>
            </div>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
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
            <el-table-column :label="t('common.operation')" width="132" fixed="right">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton :icon="View" :label="t('common.details')" type="primary" @click="openAuditDetail(row)" />
                </div>
              </template>
            </el-table-column>
          </el-table>
          <PagedTable v-model:current-page="auditPage" v-model:page-size="auditPageSize" :total="auditCount" :page-sizes="[20, 50, 100]" @update:current-page="changeAuditPage" @update:page-size="changeAuditPageSize" />
        </template>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'maintenance' && can('system.reset')" content-class="settings-maintenance-container">
      <PageContent surface>
        <div class="settings-maintenance">
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
              <el-button type="danger" :disabled="systemResetSaving" @click="openSystemResetDialog">{{ t('settings.systemReset') }}</el-button>
            </div>
          </section>
        </div>
      </PageContent>
    </PageContainer>

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

    <ActionDialogShell
      v-model="showUserBatchResult"
      :title="t('settings.batchUpdateResult')"
      :description="t('settings.batchUpdateDescription')"
      size="medium"
      :close-disabled="userBatchSaving"
      @close="closeUserBatchResult"
    >
      <section v-if="userBatchResult" class="action-dialog__result">
        <el-alert
          type="warning"
          :closable="false"
          :title="t('settings.batchUpdateSummary', { succeeded: userBatchResult.succeeded, failed: userBatchResult.failed })"
        />
        <el-table v-if="userBatchFailures.length" :data="userBatchFailures" table-layout="fixed" class="batch-result-table">
          <el-table-column prop="username" :label="t('settings.username')" min-width="180" />
          <el-table-column prop="reason" :label="t('common.reason')" min-width="300" show-overflow-tooltip />
        </el-table>
      </section>
      <template #footer>
        <el-button :disabled="userBatchSaving" @click="closeUserBatchResult">{{ t('common.close') }}</el-button>
      </template>
    </ActionDialogShell>

    <el-dialog
      v-model="showSystemResetDialog"
      :title="t('settings.systemReset')"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="!systemResetSaving"
      @close="closeSystemResetDialog"
    >
      <el-alert v-if="systemResetError" :title="systemResetError" type="error" show-icon :closable="false" />
      <div class="settings-maintenance__confirm">
        <p>{{ t('settings.resetWarning') }}</p>
        <el-form @submit.prevent="resetSystem">
          <el-form-item :label="t('settings.resetCommand')">
            <el-input
              v-model="systemResetConfirmation"
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
          :disabled="systemResetConfirmation !== systemResetConfirmationToken"
          @click="resetSystem"
        >
          {{ t('settings.confirmReset') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
