<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit, Key, View } from "@element-plus/icons-vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import ActionDialogShell from "./ActionDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import type { SettingsContext } from "../types/page-context";
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
</script>

<template>
  <div class="itam-page settings-page">
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
                    :label="userProtectionReason(row) || t('settings.deleteUser')"
                    type="danger"
                    :disabled="userPendingId === row.id || userSaving || Boolean(userProtectionReason(row))"
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

        <dl class="audit-detail-meta">
          <div><dt>{{ t('settings.auditTime') }}</dt><dd>{{ formatAuditDateTime(selectedAuditLog.created_at) }}</dd></div>
          <div><dt>{{ t('settings.actor') }}</dt><dd>{{ selectedAuditLog.actor_display_name || selectedAuditLog.actor_username || "—" }}</dd></div>
          <div><dt>{{ t('settings.resource') }}</dt><dd>{{ selectedAuditDetail.resourceLabel }}</dd></div>
          <div><dt>{{ t('settings.action') }}</dt><dd>{{ selectedAuditDetail.actionLabel }}</dd></div>
          <div><dt>{{ t('settings.object') }}</dt><dd>{{ selectedAuditDetail.objectLabel }}</dd></div>
          <div v-if="selectedAuditLog.resource_id"><dt>{{ t('settings.resourceId') }}</dt><dd>#{{ selectedAuditLog.resource_id }}</dd></div>
        </dl>

        <section v-if="selectedAuditDetail.metadata.length" class="audit-detail-section">
          <h3>{{ t('settings.eventInfo') }}</h3>
          <dl class="audit-detail-meta audit-detail-meta--event">
            <div v-for="item in selectedAuditDetail.metadata" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
          </dl>
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
