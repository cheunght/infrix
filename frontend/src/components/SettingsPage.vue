<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit, Key, View } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import LdapConfigurationPage from "./LdapConfigurationPage.vue";
import PeopleSettingsPage from "./ResponsibilitySubjectSettingsPage.vue";
import BrandingSettings from "./BrandingSettings.vue";
import SystemOperations from "./SystemOperations.vue";
import NotificationDeliveryLogs from "./NotificationDeliveryLogs.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";
import DescriptionList from "./DescriptionList.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import ActionDialogShell from "./ActionDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import { pageItems, type PageResult } from "../api";
import type { SettingsContext } from "../page-context";
import { routeForPage, type SystemSettingsTab } from "../router";
import type { AuditLog, Department, PersonOption } from "../types";
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
const router = useRouter();
const context = props.context;
function mapDigestPerson(item: Record<string, unknown>): SearchableSelectOption {
  const person = item as unknown as PersonOption;
  const email = person.notification_email || person.email || person.account_email || "";
  return {
    value: person.id,
    label: person.display_name || person.name,
    secondary: [person.employee_no, person.department_name, email].filter(Boolean).join(" · "),
    disabled: person.is_active === false || !email,
    data: person,
  };
}

function mapDepartment(item: Record<string, unknown>): SearchableSelectOption {
  const department = item as unknown as Department;
  return {
    value: department.id,
    label: department.name,
    secondary: [department.code, department.parent_name].filter(Boolean).join(" · "),
    disabled: department.id === editingDepartment.value?.id,
    data: department,
  };
}
const maintenanceTab = ref("operations");
const maintenanceTabs = computed<PageTabItem[]>(() => [
  { value: "operations", label: t("operations.statusTab") },
  { value: "reset", label: t("operations.resetTab"), disabled: !context.can("system.reset") },
]);
watch([context.settingsSection, () => context.can("system.reset")], () => {
  maintenanceTab.value = "operations";
});
const {
  settingsSection,
  organizationTab,
  changeOrganizationTab,
  systemSettingsTab,
  changeSystemSettingsTab,
  can,
  systemSettings,
  systemSettingsForm,
  systemSettingsDefinitions,
  systemSettingsLoading,
  systemSettingsSaving,
  systemSettingsError,
  systemSettingsFormErrors,
  systemSettingsDirty,
  systemSmtpTesting,
  systemSmtpTestRecipient,
  retrySystemSettings,
  resetSystemSettingsForm,
  saveSystemSettings,
  testSystemSmtp,
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
  departments,
  departmentOptions,
  departmentCount,
  departmentPage,
  departmentPageSize,
  departmentSearch,
  departmentLoading,
  departmentError,
  departmentSaving,
  departmentActionId,
  departmentFormErrors,
  departmentForm,
  editingDepartment,
  showDepartmentModal,
  searchDepartments,
  changeDepartmentPage,
  changeDepartmentPageSize,
  retryDepartments,
  openDepartmentModal,
  saveDepartment,
  deleteDepartment,
  responsibilityDirectorySubjects,
  responsibilityDirectoryTotal,
  responsibilityDirectoryPage,
  responsibilityDirectoryPageSize,
  responsibilityDirectorySearch,
  responsibilityDirectoryType,
  responsibilityDirectoryActive,
  responsibilityDirectoryLoading,
  responsibilityDirectoryError,
  responsibilityDirectorySaving,
  responsibilityDirectoryActionId,
  responsibilityDirectoryFormErrors,
  responsibilityDirectoryForm,
  editingResponsibilitySubject,
  showResponsibilitySubjectModal,
  searchResponsibilityDirectory,
  retryResponsibilityDirectory,
  changeResponsibilityDirectoryPage,
  changeResponsibilityDirectoryPageSize,
  openResponsibilitySubjectModal,
  saveResponsibilitySubject,
  toggleResponsibilitySubject,
  deleteResponsibilitySubject,
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

const userTableRef = ref<{ clearSelection: () => void } | null>(null);
const auditTab = ref("audit");
const auditTabs = computed<PageTabItem[]>(() => [
  { value: "audit", label: t("settings.auditTab") },
  { value: "mail-delivery", label: t("settings.mailDeliveryTab") },
]);
watch(settingsSection, () => {
  auditTab.value = "audit";
});
const dictionaryTabs = computed<PageTabItem[]>(() => [
  { label: t("settings.manufacturersTab"), value: "manufacturers" },
  { label: t("settings.deviceTypesTab"), value: "device-types" },
  { label: t("settings.spareCategoriesTab"), value: "spare-categories" },
]);
const organizationTabs = computed<PageTabItem[]>(() => [
  ...(can("organization.manage") ? [{ label: t("settings.usersTab"), value: "users" }] : []),
  ...(can("settings.view") || can("settings.manage")
    ? [{ label: t("settings.peopleTab"), value: "people" }]
    : []),
  ...(can("settings.manage") ? [{ label: t("settings.departmentsTab"), value: "departments" }] : []),
  ...(can("organization.manage")
    ? [
        { label: t("settings.rolesTab"), value: "roles" },
        { label: t("settings.ldapOrganizationTab"), value: "ldap" },
      ]
    : []),
]);
const canManageCurrentDictionary = computed(() => can("settings.manage"));
const smtpTestRecipientError = computed(() => {
  const value = systemSmtpTestRecipient.value.trim();
  return value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? t("validation.invalidEmail") : "";
});
const systemSettingsCategories = computed<Array<{ value: SystemSettingsTab; label: string }>>(() => [
  { value: "general", label: t("settings.generalSection") },
  { value: "security", label: t("settings.securitySection") },
  { value: "smtp", label: t("settings.smtpSection") },
  { value: "notifications", label: t("settings.notificationsSection") },
  { value: "branding", label: t("branding.title") },
]);
const systemSettingsCategoryDirty = computed<Record<SystemSettingsTab, boolean>>(() => {
  const result: Record<SystemSettingsTab, boolean> = {
    general: false,
    security: false,
    smtp: false,
    notifications: false,
    branding: false,
  };
  if (!systemSettings.value) return result;
  for (const category of systemSettingsCategories.value) {
    result[category.value] = systemSettingsDefinitions.value
      .filter((definition) => definition.section === category.value)
      .some((definition) => JSON.stringify(systemSettingsForm.value[definition.key]) !== JSON.stringify(systemSettings.value?.[definition.key]));
  }
  if (systemSettingsForm.value.smtp_password) result.smtp = true;
  return result;
});
const systemSettingsCategoryErrors = computed<Record<SystemSettingsTab, boolean>>(() => {
  const result: Record<SystemSettingsTab, boolean> = {
    general: false,
    security: false,
    smtp: false,
    notifications: false,
    branding: false,
  };
  for (const category of systemSettingsCategories.value) {
    result[category.value] = systemSettingsDefinitions.value
      .filter((definition) => definition.section === category.value)
      .some((definition) => Boolean(systemSettingsFormErrors.value[definition.key]));
  }
  result.smtp = result.smtp || Boolean(systemSettingsFormErrors.value.smtp_password || smtpTestRecipientError.value);
  return result;
});
function systemSettingsCategoryStatus(category: SystemSettingsTab) {
  if (systemSettingsCategoryErrors.value[category]) return t("settings.categoryHasErrors");
  if (systemSettingsCategoryDirty.value[category]) return t("settings.categoryHasUnsavedChanges");
  return "";
}
const systemSettingsTabItems = computed<PageTabItem[]>(() => systemSettingsCategories.value.map((category) => ({
  ...category,
  status: systemSettingsCategoryErrors.value[category.value]
    ? "error"
    : systemSettingsCategoryDirty.value[category.value]
      ? "warning"
      : undefined,
  statusLabel: systemSettingsCategoryStatus(category.value) || undefined,
})));
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
const hasDepartmentSearch = computed(() => Boolean(departmentSearch.value.trim()));
const selectedDepartmentParentOption = computed<SearchableSelectOption | null>(() => {
  const selectedId = departmentForm.value.parent;
  if (!selectedId) return null;
  const item = [...departments.value, ...departmentOptions.value]
    .find((entry) => String(entry.id) === selectedId && entry.id !== editingDepartment.value?.id);
  return item ? mapDepartment(item as unknown as Record<string, unknown>) : null;
});
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

function handleDictionarySectionChange(value: string) {
  if (value === "device-types") {
    void router.replace(routeForPage("asset-config", { assetConfigSection: "device-types" }));
    return;
  }
  return changeDictionarySection();
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
    default_locale: "settings.defaultLocale",
    date_format: "settings.dateFormat",
    currency: "settings.currency",
    password_min_length: "settings.passwordMinLength",
    password_expiry_days: "settings.passwordExpiryDays",
    login_max_attempts: "settings.loginMaxAttempts",
    login_window_seconds: "settings.loginWindowSeconds",
    login_lock_seconds: "settings.loginLockSeconds",
    smtp_enabled: "settings.smtpEnabled",
    smtp_host: "settings.smtpHost",
    smtp_port: "settings.smtpPort",
    smtp_security_mode: "settings.smtpSecurityMode",
    smtp_username: "settings.smtpUsername",
    smtp_from_email: "settings.smtpFromEmail",
    smtp_from_name: "settings.smtpFromName",
    smtp_timeout: "settings.smtpTimeout",
    notify_maintenance: "settings.notifyMaintenance",
    maintenance_expiry_days: "settings.maintenanceExpiryDays",
    notify_license_expiry: "settings.notifyLicenseExpiry",
    license_expiry_days: "settings.licenseExpiryDays",
    notify_open_faults: "settings.notifyOpenFaults",
    notify_overdue_inventory: "settings.notifyOverdueInventory",
    notify_low_spare_stock: "settings.notifyLowSpareStock",
  };
  return labels[key] ? t(labels[key]) : systemSettingDefinition(key)?.label || key;
}

function systemSettingHelp(key: string) {
  const helpKeys: Record<string, string> = {
    default_page_size: "settings.defaultPageSizeHelp",
    default_asset_status: "settings.defaultAssetStatusHelp",
    default_locale: "settings.defaultLocaleHelp",
    date_format: "settings.dateFormatHelp",
    currency: "settings.currencyHelp",
    password_min_length: "settings.passwordMinLengthHelp",
    password_expiry_days: "settings.passwordExpiryDaysHelp",
    login_max_attempts: "settings.loginMaxAttemptsHelp",
    login_window_seconds: "settings.loginWindowSecondsHelp",
    login_lock_seconds: "settings.loginLockSecondsHelp",
    smtp_enabled: "settings.smtpEnabledHelp",
    smtp_host: "settings.smtpHostHelp",
    smtp_port: "settings.smtpPortHelp",
    smtp_security_mode: "settings.smtpSecurityModeHelp",
    smtp_username: "settings.smtpUsernameHelp",
    smtp_from_email: "settings.smtpFromEmailHelp",
    smtp_from_name: "settings.smtpFromNameHelp",
    smtp_timeout: "settings.smtpTimeoutHelp",
    notify_maintenance: "settings.notifyMaintenanceHelp",
    maintenance_expiry_days: "settings.maintenanceExpiryDaysHelp",
    notify_license_expiry: "settings.notifyLicenseExpiryHelp",
    license_expiry_days: "settings.licenseExpiryDaysHelp",
    notify_open_faults: "settings.notifyOpenFaultsHelp",
    notify_overdue_inventory: "settings.notifyOverdueInventoryHelp",
    notify_low_spare_stock: "settings.notifyLowSpareStockHelp",
  };
  return helpKeys[key] ? t(helpKeys[key]) : systemSettingDefinition(key)?.help_text || "";
}

function systemSettingOptionLabel(key: string, option: { value: string | number | boolean; label: string }) {
  if (key === "default_asset_status") return businessOptionLabel(ASSET_STATUS_OPTIONS, String(option.value));
  const optionLabels: Record<string, string> = {
    "default_locale:zh-CN": "settings.localeZhCN",
    "default_locale:en-US": "settings.localeEnUS",
    "date_format:YYYY-MM-DD": "settings.dateFormatYmd",
    "date_format:DD/MM/YYYY": "settings.dateFormatDmy",
    "date_format:MM/DD/YYYY": "settings.dateFormatMdy",
    "currency:CNY": "settings.currencyCny",
    "currency:USD": "settings.currencyUsd",
    "currency:EUR": "settings.currencyEur",
    "currency:GBP": "settings.currencyGbp",
    "currency:JPY": "settings.currencyJpy",
    "currency:HKD": "settings.currencyHkd",
    "smtp_security_mode:none": "settings.smtpSecurityNone",
    "smtp_security_mode:starttls": "settings.smtpSecurityStarttls",
    "smtp_security_mode:ssl": "settings.smtpSecuritySsl",
  };
  const translationKey = optionLabels[`${key}:${String(option.value)}`];
  if (translationKey) return t(translationKey);
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

</script>

<template>
  <div class="infrix-page settings-page">
    <CustomFieldSettingsPage v-if="settingsSection === 'custom-fields'" :context="props.context" />
    <TagSettingsPage v-else-if="settingsSection === 'tags'" :context="props.context" />

    <PageContainer v-else-if="settingsSection === 'system' && can('settings.view')">
      <template #subnav>
        <PageTabs v-model="systemSettingsTab" :items="systemSettingsTabItems" @update:model-value="changeSystemSettingsTab" />
      </template>
      <template #toolbar>
        <PageToolbar>
          <template #primary>
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
          </template>
        </PageToolbar>
      </template>
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
            <el-alert
              v-if="!can('settings.manage')"
              class="settings-system__readonly-alert"
              :title="t('settings.readOnlyAccount')"
              :description="t('settings.readOnlySettings')"
              type="info"
              show-icon
              :closable="false"
            />

            <el-form label-position="top" @submit.prevent="saveSystemSettings">
              <section v-if="systemSettingsTab === 'general'" class="settings-system__section">
                <div class="settings-system__form">
                  <el-form-item :label="systemSettingLabel('default_page_size')" :error="systemSettingsFormErrors.default_page_size">
                    <el-select v-model="systemSettingsForm.default_page_size" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control">
                      <el-option v-for="option in (systemSettingDefinition('default_page_size')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('default_page_size', option)" :value="option.value" />
                    </el-select>
                    <div class="settings-system__help">{{ systemSettingHelp('default_page_size') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('default_asset_status')" :error="systemSettingsFormErrors.default_asset_status">
                    <el-select v-model="systemSettingsForm.default_asset_status" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control">
                      <el-option v-for="option in (systemSettingDefinition('default_asset_status')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('default_asset_status', option)" :value="option.value" />
                    </el-select>
                    <div class="settings-system__help">{{ systemSettingHelp('default_asset_status') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('default_locale')" :error="systemSettingsFormErrors.default_locale">
                    <el-select v-model="systemSettingsForm.default_locale" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control">
                      <el-option v-for="option in (systemSettingDefinition('default_locale')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('default_locale', option)" :value="option.value" />
                    </el-select>
                    <div class="settings-system__help">{{ systemSettingHelp('default_locale') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('date_format')" :error="systemSettingsFormErrors.date_format">
                    <el-select v-model="systemSettingsForm.date_format" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control">
                      <el-option v-for="option in (systemSettingDefinition('date_format')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('date_format', option)" :value="option.value" />
                    </el-select>
                    <div class="settings-system__help">{{ systemSettingHelp('date_format') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('currency')" :error="systemSettingsFormErrors.currency">
                    <el-select v-model="systemSettingsForm.currency" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control">
                      <el-option v-for="option in (systemSettingDefinition('currency')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('currency', option)" :value="option.value" />
                    </el-select>
                    <div class="settings-system__help">{{ systemSettingHelp('currency') }}</div>
                  </el-form-item>
                </div>
              </section>
              <section v-else-if="systemSettingsTab === 'security'" class="settings-system__section">
                <div class="settings-system__form">
                  <el-form-item :label="systemSettingLabel('password_min_length')" :error="systemSettingsFormErrors.password_min_length">
                    <el-input-number v-model="systemSettingsForm.password_min_length" :min="8" :max="128" :step="1" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
                    <div class="settings-system__help">{{ systemSettingHelp('password_min_length') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('password_expiry_days')" :error="systemSettingsFormErrors.password_expiry_days">
                    <el-input-number v-model="systemSettingsForm.password_expiry_days" :min="0" :max="3650" :step="1" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
                    <div class="settings-system__help">{{ systemSettingHelp('password_expiry_days') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('login_max_attempts')" :error="systemSettingsFormErrors.login_max_attempts">
                    <el-input-number v-model="systemSettingsForm.login_max_attempts" :min="1" :max="100" :step="1" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
                    <div class="settings-system__help">{{ systemSettingHelp('login_max_attempts') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('login_window_seconds')" :error="systemSettingsFormErrors.login_window_seconds">
                    <el-input-number v-model="systemSettingsForm.login_window_seconds" :min="1" :max="86400" :step="60" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
                    <div class="settings-system__help">{{ systemSettingHelp('login_window_seconds') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('login_lock_seconds')" :error="systemSettingsFormErrors.login_lock_seconds">
                    <el-input-number v-model="systemSettingsForm.login_lock_seconds" :min="1" :max="86400" :step="60" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
                    <div class="settings-system__help">{{ systemSettingHelp('login_lock_seconds') }}</div>
                  </el-form-item>
                </div>
                  </section>
              <section v-else-if="systemSettingsTab === 'smtp'" class="settings-system__section">
                <div class="settings-system__form">
                  <el-form-item :label="systemSettingLabel('smtp_enabled')" :error="systemSettingsFormErrors.smtp_enabled">
                    <el-switch v-model="systemSettingsForm.smtp_enabled" :disabled="!can('settings.manage') || systemSettingsSaving" />
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_enabled') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('smtp_security_mode')" :error="systemSettingsFormErrors.smtp_security_mode">
                    <el-select v-model="systemSettingsForm.smtp_security_mode" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control">
                      <el-option v-for="option in (systemSettingDefinition('smtp_security_mode')?.options || [])" :key="String(option.value)" :label="systemSettingOptionLabel('smtp_security_mode', option)" :value="option.value" />
                    </el-select>
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_security_mode') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('smtp_host')" :error="systemSettingsFormErrors.smtp_host">
                    <el-input v-model="systemSettingsForm.smtp_host" :disabled="!can('settings.manage') || systemSettingsSaving" autocomplete="off" />
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_host') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('smtp_port')" :error="systemSettingsFormErrors.smtp_port">
                    <el-input-number v-model="systemSettingsForm.smtp_port" :min="1" :max="65535" :step="1" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_port') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('smtp_username')" :error="systemSettingsFormErrors.smtp_username">
                    <el-input v-model="systemSettingsForm.smtp_username" :disabled="!can('settings.manage') || systemSettingsSaving" autocomplete="username" />
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_username') }}</div>
                  </el-form-item>
                  <el-form-item :label="t('settings.smtpPassword')" :error="systemSettingsFormErrors.smtp_password">
                    <el-input v-model="systemSettingsForm.smtp_password" type="password" show-password :disabled="!can('settings.manage') || systemSettingsSaving" autocomplete="new-password" :placeholder="systemSettings.smtp_password_configured ? t('settings.smtpPasswordKeep') : t('settings.smtpPasswordPlaceholder')" />
                    <div class="settings-system__help">{{ systemSettings.smtp_password_configured ? t('settings.smtpPasswordConfigured') : t('settings.smtpPasswordNotConfigured') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('smtp_from_email')" :error="systemSettingsFormErrors.smtp_from_email">
                    <el-input v-model="systemSettingsForm.smtp_from_email" :disabled="!can('settings.manage') || systemSettingsSaving" autocomplete="email" />
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_from_email') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('smtp_from_name')" :error="systemSettingsFormErrors.smtp_from_name">
                    <el-input v-model="systemSettingsForm.smtp_from_name" :disabled="!can('settings.manage') || systemSettingsSaving" />
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_from_name') }}</div>
                  </el-form-item>
                  <el-form-item :label="systemSettingLabel('smtp_timeout')" :error="systemSettingsFormErrors.smtp_timeout">
                    <el-input-number v-model="systemSettingsForm.smtp_timeout" :min="1" :max="120" :step="1" :disabled="!can('settings.manage') || systemSettingsSaving" class="settings-system__control" />
                    <div class="settings-system__help">{{ systemSettingHelp('smtp_timeout') }}</div>
                  </el-form-item>
                  <el-form-item :label="t('settings.smtpTestRecipient')" :error="smtpTestRecipientError">
                    <el-input v-model="systemSmtpTestRecipient" type="email" :disabled="!can('settings.manage') || systemSmtpTesting" autocomplete="email" :placeholder="t('settings.smtpTestRecipientPlaceholder')" />
                    <div class="settings-system__help">{{ t('settings.smtpTestRecipientHelp') }}</div>
                    <el-button v-if="can('settings.manage')" type="primary" plain :loading="systemSmtpTesting" :disabled="systemSmtpTesting" @click="testSystemSmtp">{{ t('settings.smtpTest') }}</el-button>
                  </el-form-item>
                </div>
                  </section>
              <section v-else-if="systemSettingsTab === 'notifications'" class="settings-system__section">
                <div class="settings-system__notification-sections">
                  <section class="settings-system__notification-section">
                    <header class="settings-system__notification-section-heading">
                      <h2>{{ t('settings.emailDigestSection') }}</h2>
                      <p>{{ t('settings.emailDigestSectionDescription') }}</p>
                    </header>
                    <el-form-item :label="t('operations.emailEnabled')" :error="systemSettingsFormErrors.email_digest_enabled">
                      <el-switch v-model="systemSettingsForm.email_digest_enabled" :disabled="!can('settings.manage') || systemSettingsSaving" />
                    </el-form-item>
                    <el-form-item :label="t('operations.recipients')" :error="systemSettingsFormErrors.email_digest_people">
                      <SearchableSelect
                        v-model="systemSettingsForm.email_digest_people"
                        multiple
                        collapse-tags
                        :max-collapse-tags="3"
                        :request="context.request"
                        endpoint="/people/"
                        :map-option="mapDigestPerson"
                        :base-query="{ is_active: 'all', email_configured: true }"
                        :disabled="!can('settings.manage') || systemSettingsSaving"
                        :placeholder="t('operations.peoplePlaceholder')"
                        :aria-label="t('operations.recipients')"
                      />
                      <div class="settings-system__help">{{ t('operations.emailHelp') }}</div>
                    </el-form-item>
                    <el-form-item :label="t('operations.additionalRecipients')" :error="systemSettingsFormErrors.email_digest_recipients">
                      <el-select v-model="systemSettingsForm.email_digest_recipients" multiple filterable allow-create default-first-option :reserve-keyword="false" :disabled="!can('settings.manage') || systemSettingsSaving" />
                      <div class="settings-system__help">{{ t('operations.additionalEmailHelp') }}</div>
                    </el-form-item>
                    <el-form-item :label="t('operations.applicationUrl')" :error="systemSettingsFormErrors.application_url">
                      <el-input v-model="systemSettingsForm.application_url" :disabled="!can('settings.manage') || systemSettingsSaving" />
                    </el-form-item>
                  </section>

                  <section class="settings-system__notification-section">
                    <header class="settings-system__notification-section-heading">
                      <h2>{{ t('settings.inAppNotificationsSection') }}</h2>
                      <p>{{ t('settings.inAppNotificationsSectionDescription') }}</p>
                    </header>
                    <div class="settings-system__notification-list">
                      <div class="settings-system__notification-row">
                        <div class="settings-system__notification-copy">
                          <div class="settings-system__notification-title">{{ systemSettingLabel('notify_maintenance') }}</div>
                          <div class="settings-system__help">{{ systemSettingHelp('notify_maintenance') }}</div>
                        </div>
                        <div class="settings-system__notification-field">
                          <div class="settings-system__notification-field-label">{{ systemSettingLabel('maintenance_expiry_days') }}</div>
                          <el-form-item class="settings-system__notification-form-item" :error="systemSettingsFormErrors.maintenance_expiry_days">
                            <el-input-number v-model="systemSettingsForm.maintenance_expiry_days" :min="0" :max="3650" :step="1" :disabled="!can('settings.manage') || systemSettingsSaving" />
                          </el-form-item>
                          <div class="settings-system__help">{{ systemSettingHelp('maintenance_expiry_days') }}</div>
                        </div>
                        <div class="settings-system__notification-switch">
                          <el-form-item class="settings-system__notification-form-item" :error="systemSettingsFormErrors.notify_maintenance">
                            <el-switch v-model="systemSettingsForm.notify_maintenance" :disabled="!can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel('notify_maintenance')" />
                          </el-form-item>
                          <span class="settings-system__notification-switch-label">{{ systemSettingsForm.notify_maintenance ? t('status.enabled') : t('status.disabled') }}</span>
                        </div>
                      </div>

                      <div class="settings-system__notification-row">
                        <div class="settings-system__notification-copy">
                          <div class="settings-system__notification-title">{{ systemSettingLabel('notify_license_expiry') }}</div>
                          <div class="settings-system__help">{{ systemSettingHelp('notify_license_expiry') }}</div>
                        </div>
                        <div class="settings-system__notification-field">
                          <div class="settings-system__notification-field-label">{{ systemSettingLabel('license_expiry_days') }}</div>
                          <el-form-item class="settings-system__notification-form-item" :error="systemSettingsFormErrors.license_expiry_days">
                            <el-input-number v-model="systemSettingsForm.license_expiry_days" :min="0" :max="3650" :step="1" :disabled="!can('settings.manage') || systemSettingsSaving" />
                          </el-form-item>
                          <div class="settings-system__help">{{ systemSettingHelp('license_expiry_days') }}</div>
                        </div>
                        <div class="settings-system__notification-switch">
                          <el-form-item class="settings-system__notification-form-item" :error="systemSettingsFormErrors.notify_license_expiry">
                            <el-switch v-model="systemSettingsForm.notify_license_expiry" :disabled="!can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel('notify_license_expiry')" />
                          </el-form-item>
                          <span class="settings-system__notification-switch-label">{{ systemSettingsForm.notify_license_expiry ? t('status.enabled') : t('status.disabled') }}</span>
                        </div>
                      </div>

                      <div class="settings-system__notification-row">
                        <div class="settings-system__notification-copy">
                          <div class="settings-system__notification-title">{{ systemSettingLabel('notify_open_faults') }}</div>
                          <div class="settings-system__help">{{ systemSettingHelp('notify_open_faults') }}</div>
                        </div>
                        <div class="settings-system__notification-spacer" aria-hidden="true"></div>
                        <div class="settings-system__notification-switch">
                          <el-form-item class="settings-system__notification-form-item" :error="systemSettingsFormErrors.notify_open_faults">
                            <el-switch v-model="systemSettingsForm.notify_open_faults" :disabled="!can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel('notify_open_faults')" />
                          </el-form-item>
                          <span class="settings-system__notification-switch-label">{{ systemSettingsForm.notify_open_faults ? t('status.enabled') : t('status.disabled') }}</span>
                        </div>
                      </div>

                      <div class="settings-system__notification-row">
                        <div class="settings-system__notification-copy">
                          <div class="settings-system__notification-title">{{ systemSettingLabel('notify_overdue_inventory') }}</div>
                          <div class="settings-system__help">{{ systemSettingHelp('notify_overdue_inventory') }}</div>
                        </div>
                        <div class="settings-system__notification-spacer" aria-hidden="true"></div>
                        <div class="settings-system__notification-switch">
                          <el-form-item class="settings-system__notification-form-item" :error="systemSettingsFormErrors.notify_overdue_inventory">
                            <el-switch v-model="systemSettingsForm.notify_overdue_inventory" :disabled="!can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel('notify_overdue_inventory')" />
                          </el-form-item>
                          <span class="settings-system__notification-switch-label">{{ systemSettingsForm.notify_overdue_inventory ? t('status.enabled') : t('status.disabled') }}</span>
                        </div>
                      </div>

                      <div class="settings-system__notification-row">
                        <div class="settings-system__notification-copy">
                          <div class="settings-system__notification-title">{{ systemSettingLabel('notify_low_spare_stock') }}</div>
                          <div class="settings-system__help">{{ systemSettingHelp('notify_low_spare_stock') }}</div>
                        </div>
                        <div class="settings-system__notification-spacer" aria-hidden="true"></div>
                        <div class="settings-system__notification-switch">
                          <el-form-item class="settings-system__notification-form-item" :error="systemSettingsFormErrors.notify_low_spare_stock">
                            <el-switch v-model="systemSettingsForm.notify_low_spare_stock" :disabled="!can('settings.manage') || systemSettingsSaving" :aria-label="systemSettingLabel('notify_low_spare_stock')" />
                          </el-form-item>
                          <span class="settings-system__notification-switch-label">{{ systemSettingsForm.notify_low_spare_stock ? t('status.enabled') : t('status.disabled') }}</span>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </section>
              <BrandingSettings v-else-if="systemSettingsTab === 'branding'" :context="context" />
            </el-form>
          </template>

        </div>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'dictionaries'">
      <template #subnav>
        <PageTabs v-model="dictionarySection" :items="dictionaryTabs" @update:model-value="handleDictionarySectionChange">
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
          <el-table-column v-if="dictionarySection === 'device-types'" prop="default_fieldset_name" :label="t('settings.defaultFieldset')" min-width="180">
            <template #default="{ row }">{{ row.default_fieldset_name || t('settings.noDefaultFieldset') }}</template>
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

    <PageContainer v-else-if="settingsSection === 'organization' && (can('organization.manage') || can('settings.manage') || can('settings.view'))">
      <template #subnav>
        <PageTabs v-model="organizationTab" :items="organizationTabs" @update:model-value="changeOrganizationTab" />
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
          <template v-if="organizationTab === 'departments'" #search>
            <SearchField
              v-model="departmentSearch"
              :loading="departmentLoading"
              :disabled="departmentLoading"
              :placeholder="t('settings.departmentName')"
              :aria-label="t('settings.departments')"
              @search="searchDepartments"
            />
          </template>
          <template v-if="organizationTab === 'departments'" #primary>
            <el-button class="page-primary-action" type="primary" :loading="departmentSaving" :disabled="departmentSaving" @click="openDepartmentModal()">
              {{ t('settings.addDepartment') }}
            </el-button>
          </template>
          <template v-if="organizationTab === 'people'" #search>
            <SearchField
              v-model="responsibilityDirectorySearch"
              :loading="responsibilityDirectoryLoading"
              :disabled="responsibilityDirectoryLoading"
              :placeholder="t('settings.personSearchPlaceholder')"
              :aria-label="t('settings.peopleTab')"
              @search="searchResponsibilityDirectory"
            />
          </template>
          <template v-if="organizationTab === 'people'" #filters>
            <div class="page-toolbar__filter-group">
              <SearchableSelect v-model="responsibilityDirectoryType" :request="context.request" endpoint="/departments/" :map-option="mapDepartment" :base-query="{ is_active: 'all' }" :placeholder="t('settings.personDepartment')" :disabled="responsibilityDirectoryLoading" clearable @update:model-value="searchResponsibilityDirectory" />
              <el-select v-model="responsibilityDirectoryActive" :placeholder="t('common.all')" :disabled="responsibilityDirectoryLoading" @change="searchResponsibilityDirectory">
                <el-option :label="t('common.all')" value="all" />
                <el-option :label="t('status.active')" value="true" />
                <el-option :label="t('status.inactive')" value="false" />
              </el-select>
            </div>
          </template>
          <template v-if="organizationTab === 'people'" #primary>
            <el-button v-if="can('settings.manage')" class="page-primary-action" type="primary" :loading="responsibilityDirectorySaving" :disabled="responsibilityDirectorySaving" @click="openResponsibilitySubjectModal()">
              {{ t('settings.addPerson') }}
            </el-button>
          </template>
        </PageToolbar>
      </template>
      <LdapConfigurationPage v-if="organizationTab === 'ldap'" :context="props.context" />
      <PeopleSettingsPage v-else-if="organizationTab === 'people'" :context="props.context" />
      <PageContent v-else-if="organizationTab === 'departments'" surface>
        <el-alert v-if="departmentError" :title="t('settings.departmentDataLoadFailed')" type="error" show-icon :closable="false">
          <template #default>
            <span>{{ departmentError }}</span>
            <el-button link type="danger" :loading="departmentLoading" @click="retryDepartments">{{ t('common.retry') }}</el-button>
          </template>
        </el-alert>
        <PagedTable
          v-else
          v-model:current-page="departmentPage"
          v-model:page-size="departmentPageSize"
          :total="departmentCount"
          :page-sizes="[20, 50, 100]"
          @update:current-page="changeDepartmentPage"
          @update:page-size="changeDepartmentPageSize"
        >
          <el-table v-loading="departmentLoading" :data="departments" table-layout="fixed">
            <template #empty>
              <el-empty :image-size="56" :description="hasDepartmentSearch ? t('settings.noMatchingDepartments') : t('settings.noDepartments')">
                <el-button v-if="hasDepartmentSearch" link type="primary" @click="departmentSearch = ''; searchDepartments()">{{ t('common.clearFilters') }}</el-button>
              </el-empty>
            </template>
            <el-table-column prop="name" :label="t('settings.departmentName')" min-width="220" />
            <el-table-column prop="code" :label="t('settings.code')" min-width="150" />
            <el-table-column prop="parent_name" :label="t('settings.parentDepartment')" min-width="200">
              <template #default="{ row }">{{ row.parent_name || '—' }}</template>
            </el-table-column>
            <el-table-column prop="assets_count" :label="t('settings.assetCount')" width="120" />
            <el-table-column v-if="can('settings.manage')" :label="t('common.operation')" width="112" fixed="right">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="departmentActionId === row.id || departmentSaving" @click="openDepartmentModal(row)" />
                  <TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" :disabled="departmentActionId === row.id || departmentSaving || row.assets_count > 0" @click="deleteDepartment(row)" />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </PagedTable>
      </PageContent>
      <PageContent v-else surface>
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

    <PageContainer v-else-if="settingsSection === 'audit' && can('audit.view')" :toolbar-visible="auditTab === 'audit'">
      <template #subnav>
        <PageTabs v-model="auditTab" :items="auditTabs" />
      </template>
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
      <template v-if="auditTab === 'audit'">
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
      </template>
      <NotificationDeliveryLogs v-else :context="context" />
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'maintenance' && can('settings.view')" content-class="settings-maintenance-container">
      <template #subnav>
        <PageTabs v-model="maintenanceTab" :items="maintenanceTabs" />
      </template>
      <PageContent surface>
        <div class="settings-maintenance">
          <SystemOperations v-show="maintenanceTab === 'operations'" :context="context" />
          <el-alert
            v-if="maintenanceTab === 'reset' && can('system.reset')"
            :title="t('settings.highRiskAction')"
            type="warning"
            show-icon
            :closable="false"
            :description="t('settings.systemResetDescription')"
          />
          <section v-if="maintenanceTab === 'reset' && can('system.reset')" class="settings-maintenance__section">
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
      v-model="showDepartmentModal"
      :title="editingDepartment ? t('common.edit') : t('settings.addDepartment')"
      width="520px"
      :close-on-click-modal="!departmentSaving"
      :close-on-press-escape="!departmentSaving"
      :show-close="!departmentSaving"
    >
      <el-form :model="departmentForm" label-position="top" @submit.prevent="saveDepartment">
        <el-form-item :label="t('settings.departmentName')" :error="departmentFormErrors.name" required>
          <el-input v-model="departmentForm.name" :disabled="departmentSaving" maxlength="100" />
        </el-form-item>
        <el-form-item :label="t('settings.code')" :error="departmentFormErrors.code" required>
          <el-input v-model="departmentForm.code" :disabled="departmentSaving" maxlength="50" />
        </el-form-item>
        <el-form-item :label="t('settings.parentDepartment')" :error="departmentFormErrors.parent">
          <SearchableSelect v-model="departmentForm.parent" :request="context.request" endpoint="/departments/" :map-option="mapDepartment" :base-query="{ is_active: true }" :selected-option="selectedDepartmentParentOption" clearable :disabled="departmentSaving" :placeholder="t('settings.parentDepartment')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="departmentSaving" @click="showDepartmentModal = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="departmentSaving" :disabled="departmentSaving" @click="saveDepartment">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

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
