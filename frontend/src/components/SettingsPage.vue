<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
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
  isAdmin,
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
const allDictionaryTabs: PageTabItem[] = [
  { label: "厂商", value: "manufacturers" },
  { label: "设备类型", value: "device-types" },
  { label: "备件类型", value: "spare-categories" },
];
const organizationTabs: PageTabItem[] = [
  { label: "用户账号", value: "users" },
  { label: "预设角色", value: "roles" },
];
const dictionaryTabs = computed(() => allDictionaryTabs);
const canManageCurrentDictionary = computed(() => can("settings.manage"));
const dictionaryPrimaryLabel = computed(() => {
  if (dictionarySection.value === "manufacturers") return "新增厂商";
  if (dictionarySection.value === "device-types") return "新增类型";
  if (dictionarySection.value === "spare-categories") return "新增类型";
  return "新增字典";
});
const dictionaryAttributeLabel = computed(() =>
  dictionarySection.value === "device-types"
    ? "颜色"
    : dictionarySection.value === "spare-categories"
      ? "类型编码"
      : "厂商编码",
);
const dictionaryCountLabel = computed(() =>
  dictionarySection.value === "spare-categories" ? "备件数量" : "资产数量",
);
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
            title="系统参数加载失败"
            type="error"
            show-icon
            :closable="false"
          >
            <template #default>
              <span>{{ systemSettingsError }}</span>
              <el-button link type="danger" :loading="systemSettingsLoading" @click="retrySystemSettings">重新加载</el-button>
            </template>
          </el-alert>

          <template v-else-if="systemSettings">
            <div class="settings-system__heading">
              <div>
                <h2>运行参数</h2>
                <p>仅维护当前应用中已有的少量运行时默认值。</p>
              </div>
              <div class="settings-system__actions">
                <el-button :disabled="!systemSettingsDirty || systemSettingsSaving" @click="resetSystemSettingsForm">恢复未保存</el-button>
                <el-button
                  v-if="can('settings.manage')"
                  type="primary"
                  :loading="systemSettingsSaving"
                  :disabled="!systemSettingsDirty || systemSettingsSaving"
                  @click="saveSystemSettings"
                >
                  保存设置
                </el-button>
              </div>
            </div>

            <el-alert
              v-if="!can('settings.manage')"
              title="当前账号为只读权限"
              description="你可以查看当前系统参数，但不能修改设置。"
              type="info"
              show-icon
              :closable="false"
            />

            <el-form class="settings-system__form" label-position="top" @submit.prevent="saveSystemSettings">
              <el-form-item
                :label="systemSettingDefinition('default_page_size')?.label || '默认每页条数'"
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
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <div v-if="systemSettingDefinition('default_page_size')?.help_text" class="settings-system__help">
                  {{ systemSettingDefinition('default_page_size')?.help_text }}
                </div>
              </el-form-item>

              <el-form-item
                :label="systemSettingDefinition('default_asset_status')?.label || '新资产默认状态'"
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
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <div v-if="systemSettingDefinition('default_asset_status')?.help_text" class="settings-system__help">
                  {{ systemSettingDefinition('default_asset_status')?.help_text }}
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
              :placeholder="`搜索${currentDictionaryLabel}`"
              :aria-label="`搜索${currentDictionaryLabel}`"
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
        <el-alert v-if="dictionaryError" title="字典数据加载失败" type="error" show-icon :closable="false">
          <template #default>
            <span>{{ dictionaryError }}</span>
            <el-button link type="danger" :loading="dictionaryLoading" @click="retryDictionaries">重新加载</el-button>
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
            <el-empty :image-size="56" :description="hasDictionaryFilters ? '没有符合当前筛选条件的' + currentDictionaryLabel : '暂无' + currentDictionaryLabel">
              <el-button v-if="hasDictionaryFilters" link type="primary" @click="clearDictionarySearch">清除筛选</el-button>
            </el-empty>
          </template>
          <el-table-column prop="name" :label="currentDictionaryLabel" min-width="220" />
          <el-table-column :label="dictionaryAttributeLabel" width="160">
            <template #default="{ row }">
              <template v-if="dictionarySection === 'device-types'">
                <span class="color-chip" :style="{ background: row.color || '#1677EF' }" />
                {{ row.color || "#1677EF" }}
              </template>
              <template v-else>{{ row.code || "—" }}</template>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" />
            </template>
          </el-table-column>
          <el-table-column :label="dictionaryCountLabel" width="110">
            <template #default="{ row }">
              {{ dictionarySection === "spare-categories" ? (row.spare_parts_count || 0) : (row.assets_count || 0) }}
            </template>
          </el-table-column>
          <el-table-column v-if="dictionarySection === 'manufacturers'" prop="licenses_count" label="许可数量" width="110" />
          <el-table-column v-if="dictionarySection === 'manufacturers'" prop="spare_parts_count" label="备件数量" width="110" />
          <el-table-column label="操作" width="210" fixed="right">
            <template #default="{ row }">
              <div class="ep-table-actions">
                <TableIconButton
                  :icon="Edit"
                  label="编辑"
                  type="primary"
                  :disabled="!canManageCurrentDictionary || dictionaryActionId === row.id"
                  @click="openDictionaryModal(row)"
                />
                <TableIconButton
                  :icon="row.is_active ? CircleClose : CircleCheck"
                  :label="row.is_active ? '停用' : '启用'"
                  :disabled="!canManageCurrentDictionary || dictionaryActionId === row.id"
                  @click="toggleDictionary(row)"
                />
                <TableIconButton
                  :icon="Delete"
                  label="删除"
                  type="danger"
                  :disabled="!canManageCurrentDictionary || dictionaryActionId === row.id || dictionaryItemUsed(row)"
                  @click="deleteDictionary(row)"
                />
              </div>
            </template>
          </el-table-column>
          </el-table>
        </PagedTable>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'organization' && isAdmin">
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
              placeholder="搜索用户名、姓名或邮箱"
              aria-label="搜索用户账号"
              @search="triggerUserSearch"
            />
          </template>
          <template v-if="organizationTab === 'users'" #primary>
            <div class="settings-user-primary-actions">
              <div v-if="selectedUserIds.length" class="settings-user-batch-actions">
                <el-tag type="info">已选择 {{ selectedUserIds.length }} 项</el-tag>
                <el-button
                  v-if="can('organization.manage')"
                  :loading="userBatchSaving"
                  :disabled="userBatchSaving"
                  @click="batchUpdateUserStatus(true)"
                >
                  批量启用
                </el-button>
                <el-button
                  v-if="can('organization.manage')"
                  :loading="userBatchSaving"
                  :disabled="userBatchSaving"
                  @click="batchUpdateUserStatus(false)"
                >
                  批量停用
                </el-button>
                <el-button link :disabled="userBatchSaving" @click="clearUserSelection">取消选择</el-button>
              </div>
              <el-button class="page-primary-action" type="primary" :loading="userSaving" :disabled="userSaving || userBatchSaving" @click="openUserModal()">新增用户</el-button>
            </div>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <template v-if="organizationTab === 'users'">
          <el-alert v-if="userListError" title="用户数据加载失败" type="error" show-icon :closable="false">
            <template #default>
              <span>{{ userListError }}</span>
              <el-button link type="danger" :loading="organizationLoading" @click="retryUserList">重新加载</el-button>
            </template>
          </el-alert>
          <el-table ref="userTableRef" v-else v-loading="organizationLoading" :data="users" table-layout="fixed" @selection-change="handleUserSelection">
            <template #empty>
              <el-empty :image-size="56" :description="hasUserSearch ? '没有符合当前筛选条件的用户账号' : '暂无用户账号'">
                <el-button v-if="hasUserSearch" link type="primary" @click="userSearch = ''; triggerUserSearch()">清除筛选</el-button>
              </el-empty>
            </template>
            <el-table-column type="selection" width="48" />
            <el-table-column prop="username" label="用户名" min-width="180" />
            <el-table-column prop="display_name" label="姓名" min-width="180" />
            <el-table-column prop="email" label="邮箱" min-width="220" />
            <el-table-column prop="assigned_role_name" label="角色" min-width="150" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template>
            </el-table-column>
            <el-table-column label="操作" width="164" fixed="right">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton
                    :icon="Edit"
                    label="编辑"
                    type="primary"
                    :disabled="userPendingId === row.id || userSaving"
                    @click="openUserModal(row)"
                  />
                  <TableIconButton
                    :icon="Key"
                    label="重置密码"
                    :disabled="userPendingId === row.id || userSaving"
                    @click="openUserResetModal(row)"
                  />
                  <TableIconButton
                    :icon="row.is_active ? CircleClose : CircleCheck"
                    :label="userProtectionReason(row) || (row.is_active ? '停用' : '启用')"
                    :disabled="userPendingId === row.id || userSaving || Boolean(userProtectionReason(row))"
                    @click="toggleUser(row)"
                  />
                  <TableIconButton
                    :icon="Delete"
                    :label="userProtectionReason(row) || '删除用户'"
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
          <el-alert v-if="roleListError" title="角色数据加载失败" type="error" show-icon :closable="false">
            <template #default>
              <span>{{ roleListError }}</span>
              <el-button link type="danger" :loading="organizationLoading" @click="retryOrganization">重新加载</el-button>
            </template>
          </el-alert>
          <el-table v-else v-loading="organizationLoading && !roles.length" :data="roles" table-layout="fixed">
            <template #empty><el-empty :image-size="56" description="暂无角色" /></template>
            <el-table-column prop="name" label="角色名称" min-width="220" />
            <el-table-column prop="description" label="权限范围" min-width="320" />
            <el-table-column prop="user_count" label="用户数" width="120" />
          </el-table>
          <p class="form-hint">预设角色不可重命名或删除，每个账号只能分配一个业务角色。</p>
        </template>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'audit' && can('audit.view')">
      <template #toolbar>
        <PageToolbar>
          <template #search>
            <SearchField v-model="auditFilters.search" :loading="auditListLoading" placeholder="操作者、资源或编号" aria-label="搜索操作日志" @search="searchAuditLogs" />
          </template>
          <template #filters>
            <div class="page-toolbar__filter-group">
              <el-select v-model="auditFilters.resource_type" placeholder="全部资源" clearable :disabled="auditListLoading" @change="searchAuditLogs">
                <el-option v-for="item in auditResourceOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
              <el-select v-model="auditFilters.action" placeholder="全部动作" clearable :disabled="auditListLoading" @change="searchAuditLogs">
                <el-option v-for="item in auditActionOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </div>
          </template>
        </PageToolbar>
      </template>
      <PageContent surface>
        <el-alert v-if="auditListError" title="操作日志数据加载失败" type="error" show-icon :closable="false">
          <template #default>
            <span>{{ auditListError }}</span>
            <el-button link type="danger" :loading="auditListLoading" @click="retryAuditLogs">重新加载</el-button>
          </template>
        </el-alert>
        <template v-else>
          <el-table class="audit-log-table" v-loading="auditListLoading" :data="auditLogs" table-layout="fixed">
            <template #empty>
              <el-empty :image-size="56" :description="hasAuditFilters ? '没有符合当前筛选条件的操作日志' : '暂无操作日志'">
                <el-button v-if="hasAuditFilters" link type="primary" @click="clearAuditFilters">清除筛选</el-button>
              </el-empty>
            </template>
            <el-table-column prop="created_at" label="时间" width="178"><template #default="{ row }">{{ formatAuditDateTime(row.created_at) }}</template></el-table-column>
            <el-table-column prop="actor_display_name" label="操作者" width="138" />
            <el-table-column label="资源" width="108"><template #default="{ row }">{{ resourceLabel(row.resource_type) }}</template></el-table-column>
            <el-table-column label="动作" width="108"><template #default="{ row }">{{ auditLogActionLabel(row) }}</template></el-table-column>
            <el-table-column label="对象" min-width="180">
              <template #default="{ row }">{{ auditObjectLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="变更摘要" min-width="320">
              <template #default="{ row }">
                <span class="audit-change-summary">{{ auditChangeSummary(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="96" fixed="right">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <TableIconButton :icon="View" label="查看详情" type="primary" @click="openAuditDetail(row)" />
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
            title="高风险操作"
            type="warning"
            show-icon
            :closable="false"
            description="恢复操作会清除当前应用业务数据，且无法通过页面撤销。请先确认已经完成必要的数据留存。"
          />
          <section class="settings-maintenance__section">
            <div class="settings-maintenance__intro">
              <h2>恢复系统初始状态</h2>
              <p>仅保留执行账号和已有超级管理员账号，业务数据恢复为空白初始状态。</p>
            </div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="将清除">资产、位置、机柜、盘点、维修、许可证、备件、字典、标签及业务操作日志</el-descriptions-item>
              <el-descriptions-item label="将保留">当前执行账号、已有超级管理员账号、数据库结构和系统权限定义</el-descriptions-item>
              <el-descriptions-item label="不会执行">数据库删表、迁移回滚、部署配置修改或文件系统清理</el-descriptions-item>
            </el-descriptions>
            <div class="settings-maintenance__action">
              <el-button type="danger" :disabled="systemResetSaving" @click="openSystemResetDialog">恢复系统初始状态</el-button>
            </div>
          </section>
        </div>
      </PageContent>
    </PageContainer>

    <el-drawer v-model="auditDetailVisible" class="audit-detail-drawer" title="操作日志详情" size="680px" destroy-on-close>
      <template v-if="selectedAuditLog && selectedAuditDetail">
        <div class="audit-detail-intro">
          <strong>{{ selectedAuditDetail.summary }}</strong>
          <span>记录编号 #{{ selectedAuditLog.id }}</span>
        </div>

        <dl class="audit-detail-meta">
          <div><dt>时间</dt><dd>{{ formatAuditDateTime(selectedAuditLog.created_at) }}</dd></div>
          <div><dt>操作者</dt><dd>{{ selectedAuditLog.actor_display_name || selectedAuditLog.actor_username || "—" }}</dd></div>
          <div><dt>资源</dt><dd>{{ selectedAuditDetail.resourceLabel }}</dd></div>
          <div><dt>动作</dt><dd>{{ selectedAuditDetail.actionLabel }}</dd></div>
          <div><dt>对象</dt><dd>{{ selectedAuditDetail.objectLabel }}</dd></div>
          <div v-if="selectedAuditLog.resource_id"><dt>资源编号</dt><dd>#{{ selectedAuditLog.resource_id }}</dd></div>
        </dl>

        <section v-if="selectedAuditDetail.metadata.length" class="audit-detail-section">
          <h3>事件信息</h3>
          <dl class="audit-detail-meta audit-detail-meta--event">
            <div v-for="item in selectedAuditDetail.metadata" :key="item.label"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
          </dl>
        </section>

        <section class="audit-detail-section">
          <h3>{{ selectedAuditDetail.changeTitle }}</h3>
          <el-table v-if="selectedAuditDetail.changes.length" class="audit-change-table" :data="selectedAuditDetail.changes" table-layout="fixed">
          <el-table-column prop="label" label="字段" width="150" />
            <el-table-column label="变更前" min-width="180">
              <template #default="{ row }"><span class="audit-value">{{ row.beforeText }}</span></template>
            </el-table-column>
            <el-table-column label="变更后" min-width="180">
              <template #default="{ row }"><span class="audit-value audit-value--after">{{ row.afterText }}</span></template>
            </el-table-column>
          </el-table>
          <el-table v-else-if="selectedAuditDetail.fields.length" class="audit-change-table" :data="selectedAuditDetail.fields" table-layout="fixed">
          <el-table-column prop="label" label="字段" width="150" />
            <el-table-column label="内容" min-width="320">
              <template #default="{ row }"><span class="audit-value">{{ row.valueText }}</span></template>
            </el-table-column>
          </el-table>
          <p v-else class="audit-detail-empty">{{ selectedAuditDetail.summary }}</p>
        </section>

        <el-collapse class="audit-raw-collapse">
          <el-collapse-item title="查看原始数据" name="raw">
            <pre class="audit-raw-data">{{ JSON.stringify(selectedAuditDetail.rawPayload, null, 2) }}</pre>
          </el-collapse-item>
        </el-collapse>
      </template>
    </el-drawer>

    <ActionDialogShell
      v-model="showUserBatchResult"
      title="批量用户状态更新结果"
      description="用户列表已按最新数据刷新，以下账号未能更新。"
      size="medium"
      :close-disabled="userBatchSaving"
      @close="closeUserBatchResult"
    >
      <section v-if="userBatchResult" class="action-dialog__result">
        <el-alert
          type="warning"
          :closable="false"
          :title="`成功更新 ${userBatchResult.succeeded} 项，${userBatchResult.failed} 项失败`"
        />
        <el-table v-if="userBatchFailures.length" :data="userBatchFailures" table-layout="fixed" class="batch-result-table">
          <el-table-column prop="username" label="用户名" min-width="180" />
          <el-table-column prop="reason" label="失败原因" min-width="300" show-overflow-tooltip />
        </el-table>
      </section>
      <template #footer>
        <el-button :disabled="userBatchSaving" @click="closeUserBatchResult">关闭</el-button>
      </template>
    </ActionDialogShell>

    <el-dialog
      v-model="showSystemResetDialog"
      title="恢复系统初始状态"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="!systemResetSaving"
      @close="closeSystemResetDialog"
    >
      <el-alert v-if="systemResetError" :title="systemResetError" type="error" show-icon :closable="false" />
      <div class="settings-maintenance__confirm">
        <p>这是不可逆的应用级数据清理操作。请准确输入确认口令后继续：</p>
        <el-form @submit.prevent="resetSystem">
          <el-form-item label="确认口令">
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
        <el-button :disabled="systemResetSaving" @click="closeSystemResetDialog">取消</el-button>
        <el-button
          type="danger"
          :loading="systemResetSaving"
          :disabled="systemResetConfirmation !== systemResetConfirmationToken"
          @click="resetSystem"
        >
          确认恢复
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
