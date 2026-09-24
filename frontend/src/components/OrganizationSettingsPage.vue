<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit, Filter, InfoFilled, Lock, Message, Upload, User } from "@element-plus/icons-vue";
import type { FormInstance } from "element-plus";
import type { SettingsContext } from "../page-context";
import type { OrganizationSettingsState } from "../composables/useOrganizationSettings";
import type { Department, ManagedUser, Person, PersonOption } from "../types";
import { roleDescription, roleLabel } from "../business-enums";
import { systemSettingsState } from "../system-settings";
import SearchField from "./SearchField.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";
import PagedTable from "./PagedTable.vue";
import StatusTag from "./StatusTag.vue";
import LdapConfigurationPage from "./LdapConfigurationPage.vue";
import PeopleSettingsPage from "./ResponsibilitySubjectSettingsPage.vue";
import ActionDialogShell from "./ActionDialogShell.vue";
import FormDialogShell from "./FormDialogShell.vue";
import FieldHelp from "./FieldHelp.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import TableIconButton from "./TableIconButton.vue";
import ToolbarIconButton from "./page/ToolbarIconButton.vue";

const props = defineProps<{
  context: SettingsContext;
  organization: OrganizationSettingsState;
}>();

const { t } = useI18n();
const context = props.context;
const organization = props.organization;

const {
  organizationTab,
  changeOrganizationTab,
} = context;
const {
  ldapConfiguration,
  ldapConfigurationLoading,
  ldapConfigurationSaving,
  ldapConfigurationDirty,
  ldapDiagnosticLoading,
  resetLdapConfigurationForm,
  saveLdapConfiguration,
  runLdapDiagnostics,
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
  openPeopleImport,
  saveResponsibilitySubject,
  toggleResponsibilitySubject,
  deleteResponsibilitySubject,
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
  userProtectionReason,
  userDeleteProtectionReason,
  toggleUser,
  deleteUser,
  roles,
  showUserModal,
  editingUser,
  userForm,
  userFormRef,
  userFormRules,
  canChangeUserRole,
  userFormErrors,
  saveUser,
} = organization;
const { can } = context;

const showPeopleFilters = ref(false);
const peopleFilterDraft = reactive({ department: "", active: "true" });
const userTableRef = ref<{ clearSelection: () => void } | null>(null);
let userSearchTimer: ReturnType<typeof setTimeout> | null = null;

function mapDepartment(item: Record<string, unknown>): SearchableSelectOption {
  const department = item as unknown as Department;
  return {
    value: String(department.id),
    label: department.name,
    secondary: [department.code, department.parent_name].filter(Boolean).join(" · "),
    disabled: department.id === editingDepartment.value?.id,
    data: department,
  };
}

function mapUnlinkedPerson(item: Record<string, unknown>): SearchableSelectOption {
  const person = item as unknown as PersonOption;
  return {
    value: String(person.id),
    label: person.name || person.display_name,
    secondary: [person.employee_no, person.department_name].filter(Boolean).join(" · "),
    data: person,
  };
}

function userDirectoryTooltip(user: ManagedUser): string {
  if (user.auth_source !== "ldap") return t("settings.localAccount");
  return [
    `${t("settings.directoryProvider")}: ${user.directory_provider || "—"}`,
    `${t("settings.directoryLoginIdentifier")}: ${user.directory_login_identifier || "—"}`,
    `${t("settings.directoryLastSeen")}: ${user.directory_last_seen_at ? user.directory_last_seen_at : t("settings.directoryNeverSeen")}`,
  ].join("\n");
}

const organizationTabs = computed<PageTabItem[]>(() => [
  ...(can("organization.manage") ? [{ label: t("settings.usersTab"), value: "users" }] : []),
  ...(can("settings.view") || can("settings.manage") ? [{ label: t("settings.peopleTab"), value: "people" }] : []),
  ...(can("settings.manage") ? [{ label: t("settings.departmentsTab"), value: "departments" }] : []),
  ...(can("organization.manage")
    ? [
        { label: t("settings.rolesTab"), value: "roles" },
        { label: t("settings.ldapOrganizationTab"), value: "ldap" },
      ]
    : []),
]);
const organizationTabsKey = computed(() => organizationTabs.value.map((item) => item.value).join("|"));
const hasUserSearch = computed(() => Boolean(userSearch.value.trim()));
const hasDepartmentSearch = computed(() => Boolean(departmentSearch.value.trim()));
const activePeopleFilterCount = computed(() =>
  Number(Boolean(responsibilityDirectoryType.value)) + Number(responsibilityDirectoryActive.value !== "true"),
);
const selectedPeopleDepartmentOption = computed<SearchableSelectOption | null>(() => {
  const item = departmentOptions.value.find((entry) => String(entry.id) === peopleFilterDraft.department);
  return item ? mapDepartment(item as unknown as Record<string, unknown>) : null;
});
const selectedDepartmentParentOption = computed<SearchableSelectOption | null>(() => {
  const selectedId = departmentForm.value.parent;
  if (!selectedId) return null;
  const item = [...departments.value, ...departmentOptions.value].find(
    (entry) => String(entry.id) === selectedId && entry.id !== editingDepartment.value?.id,
  );
  return item ? mapDepartment(item as unknown as Record<string, unknown>) : null;
});
const userBatchFailures = computed(() => (userBatchResult.value?.results || []).filter((result) => !result.success));
const usernameEditHelp = computed(() => t("overlay.usernameEditHelp"));
const roleHelp = computed(() => t("overlay.roleHelp"));

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

watch(selectedUserIds, (ids) => {
  if (!ids.length) userTableRef.value?.clearSelection();
});

onBeforeUnmount(clearUserSearchTimer);

function openPeopleFilters() {
  peopleFilterDraft.department = responsibilityDirectoryType.value;
  peopleFilterDraft.active = responsibilityDirectoryActive.value;
  showPeopleFilters.value = true;
}

function clearPeopleFilters() {
  peopleFilterDraft.department = "";
  peopleFilterDraft.active = "true";
}

function applyPeopleFilters() {
  responsibilityDirectoryType.value = peopleFilterDraft.department;
  responsibilityDirectoryActive.value = peopleFilterDraft.active;
  void searchResponsibilityDirectory();
  showPeopleFilters.value = false;
}
</script>

<template>
  <div class="infrix-page settings-page organization-settings-page">
    <PageContainer v-if="organizationTabs.length" :key="'organization-settings'">
      <template #subnav>
        <PageTabs :key="organizationTabsKey" v-model="organizationTab" :items="organizationTabs" @update:model-value="changeOrganizationTab" />
      </template>

      <PageContent v-if="organizationTab === 'ldap'" surface>
        <PageToolbar class="settings-form-toolbar">
          <template #actions>
            <div class="settings-ldap-panel__action-controls">
              <el-button :loading="ldapDiagnosticLoading" :disabled="ldapDiagnosticLoading || ldapConfigurationLoading || ldapConfigurationSaving || !ldapConfiguration" @click="runLdapDiagnostics">
                {{ t("settings.ldapTestConnection") }}
              </el-button>
              <el-button :disabled="!ldapConfigurationDirty || ldapConfigurationSaving" @click="resetLdapConfigurationForm">
                {{ t("settings.ldapRestoreConfiguration") }}
              </el-button>
              <el-button type="primary" :loading="ldapConfigurationSaving" :disabled="!ldapConfigurationDirty || ldapConfigurationSaving || !ldapConfiguration" @click="saveLdapConfiguration">
                {{ t("settings.ldapSaveConfiguration") }}
              </el-button>
            </div>
          </template>
        </PageToolbar>
        <LdapConfigurationPage :context="context" :organization="organization">
          <template #notice>
            <div v-if="ldapConfigurationDirty" class="settings-ldap-panel__action-notice" role="status">
              <el-icon aria-hidden="true"><InfoFilled /></el-icon>
              <span>{{ t("settings.ldapUnsavedChanges") }} · {{ t("settings.ldapUnsavedHint") }}</span>
            </div>
          </template>
        </LdapConfigurationPage>
      </PageContent>

      <PageContent v-else surface>
        <PageToolbar v-if="['users', 'departments', 'people'].includes(organizationTab)" :key="`organization-toolbar-${organizationTab}`" class="settings-list-toolbar">
          <template v-if="organizationTab === 'users'" #search>
            <SearchField v-model="userSearch" :loading="organizationLoading" :disabled="organizationLoading" :placeholder="t('settings.userSearchPlaceholder')" :aria-label="t('settings.user')" @search="triggerUserSearch" />
          </template>
          <template v-if="organizationTab === 'users'" #primary>
            <div class="settings-user-primary-actions">
              <div v-if="selectedUserIds.length" class="settings-user-batch-actions">
                <el-tag type="info">{{ t('settings.selectedUsers', { count: selectedUserIds.length }) }}</el-tag>
                <el-button v-if="can('organization.manage')" :loading="userBatchSaving" :disabled="userBatchSaving" @click="batchUpdateUserStatus(true)">{{ t('settings.batchEnable') }}</el-button>
                <el-button v-if="can('organization.manage')" :loading="userBatchSaving" :disabled="userBatchSaving" @click="batchUpdateUserStatus(false)">{{ t('settings.batchDisable') }}</el-button>
                <el-button link :disabled="userBatchSaving" @click="clearUserSelection">{{ t('common.cancel') }}</el-button>
              </div>
              <el-button v-if="can('organization.manage')" class="page-primary-action" type="primary" :loading="userSaving" :disabled="userSaving || userBatchSaving" @click="openUserModal()">{{ t('settings.addUser') }}</el-button>
            </div>
          </template>
          <template v-if="organizationTab === 'departments'" #search>
            <SearchField v-model="departmentSearch" :loading="departmentLoading" :disabled="departmentLoading" :placeholder="t('settings.departmentName')" :aria-label="t('settings.departments')" @search="searchDepartments" />
          </template>
          <template v-if="organizationTab === 'departments'" #primary>
            <el-button class="page-primary-action" type="primary" :loading="departmentSaving" :disabled="departmentSaving" @click="openDepartmentModal()">{{ t('settings.addDepartment') }}</el-button>
          </template>
          <template v-if="organizationTab === 'people'" #search>
            <SearchField v-model="responsibilityDirectorySearch" :loading="responsibilityDirectoryLoading" :disabled="responsibilityDirectoryLoading" :placeholder="t('settings.personSearchPlaceholder')" :aria-label="t('settings.peopleTab')" @search="searchResponsibilityDirectory" />
          </template>
          <template v-if="organizationTab === 'people'" #filters>
            <ToolbarIconButton :icon="Filter" :label="t('asset.moreFilters')" :badge="activePeopleFilterCount" @click="openPeopleFilters" />
          </template>
          <template v-if="organizationTab === 'people'" #actions>
            <ToolbarIconButton v-if="can('settings.manage')" :icon="Upload" :label="t('common.import')" @click="openPeopleImport" />
          </template>
          <template v-if="organizationTab === 'people'" #primary>
            <el-button v-if="can('settings.manage')" class="page-primary-action" type="primary" :loading="responsibilityDirectorySaving" :disabled="responsibilityDirectorySaving" @click="openResponsibilitySubjectModal()">{{ t('settings.addPerson') }}</el-button>
          </template>
        </PageToolbar>

        <PeopleSettingsPage v-if="organizationTab === 'people'" :context="context" :organization="organization" />
        <template v-else-if="organizationTab === 'departments'">
          <el-alert v-if="departmentError" :title="t('settings.departmentDataLoadFailed')" type="error" show-icon :closable="false">
            <template #default><span>{{ departmentError }}</span><el-button link type="danger" :loading="departmentLoading" @click="retryDepartments">{{ t('common.retry') }}</el-button></template>
          </el-alert>
          <PagedTable v-else v-model:current-page="departmentPage" v-model:page-size="departmentPageSize" :total="departmentCount" :page-sizes="[20, 50, 100]" @update:current-page="changeDepartmentPage" @update:page-size="changeDepartmentPageSize">
            <el-table v-loading="departmentLoading" :data="departments" table-layout="fixed">
              <template #empty><el-empty :image-size="56" :description="hasDepartmentSearch ? t('settings.noMatchingDepartments') : t('settings.noDepartments')"><el-button v-if="hasDepartmentSearch" link type="primary" @click="departmentSearch = ''; searchDepartments()">{{ t('common.clearFilters') }}</el-button></el-empty></template>
              <el-table-column prop="name" :label="t('settings.departmentName')" min-width="220" />
              <el-table-column prop="code" :label="t('settings.code')" min-width="150" />
              <el-table-column prop="parent_name" :label="t('settings.parentDepartment')" min-width="200"><template #default="{ row }">{{ row.parent_name || '—' }}</template></el-table-column>
              <el-table-column prop="assets_count" :label="t('settings.assetCount')" width="120" />
              <el-table-column v-if="can('settings.manage')" :label="t('common.operation')" width="84" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><el-button-group><TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="departmentActionId === row.id || departmentSaving" @click="openDepartmentModal(row)" /><TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" :disabled="departmentActionId === row.id || departmentSaving || row.assets_count > 0" @click="deleteDepartment(row)" /></el-button-group></div></template></el-table-column>
            </el-table>
          </PagedTable>
        </template>
        <template v-else-if="organizationTab === 'users'">
          <el-alert v-if="userListError" :title="t('settings.userLoadFailed')" type="error" show-icon :closable="false"><template #default><span>{{ userListError }}</span><el-button link type="danger" :loading="organizationLoading" @click="retryUserList">{{ t('common.retry') }}</el-button></template></el-alert>
          <el-table ref="userTableRef" v-else v-loading="organizationLoading" :data="users" table-layout="fixed" @selection-change="handleUserSelection">
            <template #empty><el-empty :image-size="56" :description="hasUserSearch ? t('settings.noMatchingUsers') : t('settings.noUsers')"><el-button v-if="hasUserSearch" link type="primary" @click="userSearch = ''; triggerUserSearch()">{{ t('common.clearFilters') }}</el-button></el-empty></template>
            <el-table-column type="selection" width="48" />
            <el-table-column prop="username" :label="t('settings.username')" min-width="180" />
            <el-table-column prop="display_name" :label="t('settings.name')" min-width="180" />
            <el-table-column prop="email" :label="t('auth.email')" min-width="220" />
            <el-table-column :label="t('settings.authSource')" width="116"><template #default="{ row }"><el-tooltip :content="userDirectoryTooltip(row)" placement="top"><el-tag :type="row.auth_source === 'ldap' ? 'warning' : 'info'" size="small">{{ row.auth_source === 'ldap' ? t('settings.ldapAccount') : t('settings.localAccount') }}</el-tag></el-tooltip></template></el-table-column>
            <el-table-column :label="t('settings.role')" min-width="190"><template #default="{ row }"><div class="settings-user-role-list"><el-tag v-for="role in row.roles" :key="role.code" size="small">{{ roleLabel(role.code, role.name) }}</el-tag><el-tag v-if="row.role_anomaly === 'multiple'" type="warning" size="small">{{ t('settings.multipleRoles') }}</el-tag></div></template></el-table-column>
            <el-table-column :label="t('common.status')" width="120"><template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template></el-table-column>
            <el-table-column v-if="can('organization.manage')" :label="t('common.operation')" width="152" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><el-button-group><TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="userPendingId === row.id || userSaving" @click="openUserModal(row)" /><TableIconButton :icon="row.is_active ? CircleClose : CircleCheck" :label="userProtectionReason(row) || (row.is_active ? t('status.inactive') : t('status.active'))" :disabled="userPendingId === row.id || userSaving || Boolean(userProtectionReason(row))" @click="toggleUser(row)" /><TableIconButton :icon="Delete" :label="userDeleteProtectionReason(row) || t('settings.deleteUser')" type="danger" :disabled="userPendingId === row.id || userSaving || Boolean(userDeleteProtectionReason(row))" @click="deleteUser(row)" /></el-button-group></div></template></el-table-column>
          </el-table>
          <PagedTable v-if="!userListError" v-model:current-page="userPage" v-model:page-size="userPageSize" :total="userCount" :page-sizes="[20, 50, 100]" @update:current-page="changeUserPage" @update:page-size="changeUserPageSize" />
        </template>
        <template v-else>
          <el-alert v-if="roleListError" :title="t('settings.roleLoadFailed')" type="error" show-icon :closable="false"><template #default><span>{{ roleListError }}</span><el-button link type="danger" :loading="organizationLoading" @click="retryOrganization">{{ t('common.retry') }}</el-button></template></el-alert>
          <el-table v-else v-loading="organizationLoading && !roles.length" :data="roles" table-layout="fixed"><template #empty><el-empty :image-size="56" :description="t('settings.noRoles')" /></template><el-table-column :label="t('settings.roleName')" min-width="220"><template #default="{ row }">{{ roleLabel(row.code, row.name) }}</template></el-table-column><el-table-column :label="t('settings.permissionScope')" min-width="320"><template #default="{ row }">{{ roleDescription(row.code, row.description) }}</template></el-table-column><el-table-column prop="user_count" :label="t('settings.userCount')" width="120" /></el-table>
          <p class="form-hint">{{ t('settings.roleHint') }}</p>
        </template>
      </PageContent>
    </PageContainer>

    <el-drawer v-if="organizationTab === 'people'" v-model="showPeopleFilters" :title="t('asset.moreFilters')" size="360px" append-to-body>
      <el-form label-position="top"><el-form-item :label="t('settings.personDepartment')"><SearchableSelect v-model="peopleFilterDraft.department" :request="context.request" endpoint="/departments/" :map-option="mapDepartment" :base-query="{ is_active: 'all' }" :selected-option="selectedPeopleDepartmentOption" :placeholder="t('settings.personDepartment')" clearable /></el-form-item><el-form-item :label="t('common.status')"><el-select v-model="peopleFilterDraft.active" :placeholder="t('common.all')" clearable><el-option :label="t('common.all')" value="all" /><el-option :label="t('status.active')" value="true" /><el-option :label="t('status.inactive')" value="false" /></el-select></el-form-item></el-form>
      <template #footer><div class="page-filter-drawer__footer"><el-button @click="clearPeopleFilters">{{ t('common.clearFilters') }}</el-button><el-button @click="showPeopleFilters = false">{{ t('common.cancel') }}</el-button><el-button type="primary" @click="applyPeopleFilters">{{ t('asset.applyFilters') }}</el-button></div></template>
    </el-drawer>

    <ActionDialogShell v-model="showUserBatchResult" :title="t('settings.batchUpdateResult')" :description="t('settings.batchUpdateDescription')" size="medium" :close-disabled="userBatchSaving" @close="closeUserBatchResult">
      <section v-if="userBatchResult" class="action-dialog__result"><el-alert type="warning" :closable="false" :title="t('settings.batchUpdateSummary', { succeeded: userBatchResult.succeeded, failed: userBatchResult.failed })" /><el-table v-if="userBatchFailures.length" :data="userBatchFailures" table-layout="fixed" class="batch-result-table"><el-table-column prop="username" :label="t('settings.username')" min-width="180" /><el-table-column prop="reason" :label="t('common.reason')" min-width="300" show-overflow-tooltip /></el-table></section>
      <template #footer><el-button :disabled="userBatchSaving" @click="closeUserBatchResult">{{ t('common.close') }}</el-button></template>
    </ActionDialogShell>

    <el-dialog v-model="showDepartmentModal" :title="editingDepartment ? t('common.edit') : t('settings.addDepartment')" width="520px" :close-on-click-modal="!departmentSaving" :close-on-press-escape="!departmentSaving" :show-close="!departmentSaving">
      <el-form :model="departmentForm" label-position="top" @submit.prevent="saveDepartment"><el-form-item :label="t('settings.departmentName')" :error="departmentFormErrors.name" required><el-input v-model="departmentForm.name" :disabled="departmentSaving" maxlength="100" /></el-form-item><el-form-item :label="t('settings.code')" :error="departmentFormErrors.code" required><el-input v-model="departmentForm.code" :disabled="departmentSaving" maxlength="50" /></el-form-item><el-form-item :label="t('settings.parentDepartment')" :error="departmentFormErrors.parent"><SearchableSelect v-model="departmentForm.parent" :request="context.request" endpoint="/departments/" :map-option="mapDepartment" :base-query="{ is_active: true }" :selected-option="selectedDepartmentParentOption" clearable :disabled="departmentSaving" :placeholder="t('settings.parentDepartment')" /></el-form-item></el-form>
      <template #footer><el-button :disabled="departmentSaving" @click="showDepartmentModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="departmentSaving" :disabled="departmentSaving" @click="saveDepartment">{{ editingDepartment ? t('common.save') : t('common.create') }}</el-button></template>
    </el-dialog>

    <FormDialogShell v-model="showUserModal" :title="editingUser ? t('settings.editUser') : t('settings.addUser')" :description="t('overlay.userDialogDescription')" size="medium" :saving="userSaving" :show-close="!userSaving" :close-on-click-modal="!userSaving" :close-on-press-escape="!userSaving" :close-disabled="userSaving">
      <el-form ref="userFormRef" :model="userForm" :rules="userFormRules" :validate-on-rule-change="false" label-position="right" class="horizontal-form user-account-form" @submit.prevent="saveUser">
        <section class="form-dialog__section"><h3 class="form-dialog__section-title">{{ t('overlay.accountInformation') }}</h3><div class="horizontal-form__rows"><el-form-item :label="t('auth.username')" prop="username" required :error="userFormErrors.username"><el-input v-model="userForm.username" :disabled="!!editingUser" autocomplete="username" :validate-event="false" :placeholder="t('overlay.enterUsername')" /><FieldHelp v-if="editingUser" :text="usernameEditHelp" /></el-form-item><el-form-item :label="t('auth.email')" prop="email" :error="userFormErrors.email"><el-input v-model="userForm.email" type="email" autocomplete="email" :validate-event="false" :prefix-icon="Message" :placeholder="t('overlay.enterEmailOptional')" /></el-form-item><el-form-item :label="t('auth.lastName')" prop="last_name" required :error="userFormErrors.last_name"><el-input v-model="userForm.last_name" autocomplete="family-name" :validate-event="false" :prefix-icon="Edit" :placeholder="t('overlay.enterLastName')" /></el-form-item><el-form-item :label="t('auth.firstName')" prop="first_name" required :error="userFormErrors.first_name"><el-input v-model="userForm.first_name" autocomplete="given-name" :validate-event="false" :prefix-icon="Edit" :placeholder="t('overlay.enterFirstName')" /></el-form-item></div></section>
        <section v-if="!editingUser" class="form-dialog__section"><h3 class="form-dialog__section-title">{{ t('overlay.personInformation') }}</h3><div class="horizontal-form__rows"><el-form-item :label="t('settings.person')" prop="person_id" :error="userFormErrors.person_id"><SearchableSelect v-model="userForm.person_id" :request="context.request" endpoint="/people/" :map-option="mapUnlinkedPerson" :base-query="{ is_active: true, account: 'unlinked' }" :placeholder="t('overlay.selectPersonOptional')" :aria-label="t('settings.person')" clearable /><FieldHelp :text="t('overlay.personSelectHelp')" /></el-form-item></div></section>
        <section class="form-dialog__section"><h3 class="form-dialog__section-title">{{ t('overlay.roleAndStatus') }}</h3><div class="horizontal-form__rows"><el-form-item :label="t('settings.role')" prop="role_code" required :error="userFormErrors.role_code"><el-select v-model="userForm.role_code" class="user-account-role" :placeholder="t('overlay.selectRole')" :validate-event="false" :disabled="!!editingUser && !canChangeUserRole(editingUser)"><template #prefix><el-icon><User /></el-icon></template><el-option v-for="role in roles" :key="role.code" :label="roleLabel(role.code, role.name)" :value="role.code" /></el-select><FieldHelp :text="roleHelp" /></el-form-item><el-form-item :label="t('overlay.accountStatus')" class="user-account-status"><el-select v-model="userForm.is_active" :disabled="!!editingUser && !canChangeUserRole(editingUser)" :aria-label="t('overlay.accountStatus')"><el-option :label="t('status.active')" :value="true" /><el-option :label="t('status.inactive')" :value="false" /></el-select></el-form-item></div></section>
        <section v-if="!editingUser" class="form-dialog__section"><h3 class="form-dialog__section-title">{{ t('overlay.initialPassword') }}</h3><div class="horizontal-form__rows"><el-form-item :label="t('overlay.initialPassword')" prop="password" required :error="userFormErrors.password"><el-input v-model="userForm.password" type="password" show-password autocomplete="new-password" :validate-event="false" :prefix-icon="Lock" :placeholder="t('overlay.enterPasswordMin', { min: systemSettingsState.passwordMinLength })" /></el-form-item><el-form-item :label="t('auth.confirmPassword')" prop="confirm_password" required :error="userFormErrors.confirm_password"><el-input v-model="userForm.confirm_password" type="password" show-password autocomplete="new-password" :validate-event="false" :prefix-icon="Lock" :placeholder="t('overlay.enterPasswordAgain')" /></el-form-item></div></section>
      </el-form>
      <template #footer><el-button :disabled="userSaving" @click="showUserModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="userSaving" :disabled="userSaving" @click="saveUser">{{ editingUser ? t('common.save') : t('common.create') }}</el-button></template>
    </FormDialogShell>
  </div>
</template>
