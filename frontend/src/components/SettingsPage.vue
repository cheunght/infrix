<script setup lang="ts">
import { computed, ref } from "vue";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import type { SettingsContext } from "../types/page-context";

const props = defineProps<{ context: SettingsContext }>();
const context = props.context;
const {
  settingsSection,
  can,
  dictionarySection,
  dictionarySearch,
  dictionaryLoading,
  dictionaryError,
  dictionarySaving,
  dictionaryActionId,
  loadDictionaries,
  retryDictionaries,
  currentDictionaryLabel,
  openDictionaryModal,
  currentDictionaryItems,
  toggleDictionary,
  deleteDictionary,
  dictionaryItemUsed,
  isAdmin,
  organizationLoading,
  userListError,
  roleListError,
  retryOrganization,
  users,
  userSearch,
  userPage,
  userPageSize,
  userCount,
  searchUsers,
  retryUserList,
  changeUserPage,
  changeUserPageSize,
  userSaving,
  userActionId,
  openUserModal,
  toggleUser,
  deleteUser,
  roles,
  auditFilters,
  auditListLoading,
  auditListError,
  retryAuditLogs,
  searchAuditLogs,
  auditLogs,
  formatDateTime,
  auditPage,
  auditPageSize,
  auditCount,
  changeAuditPage,
  changeAuditPageSize,
} = context;

const organizationTab = ref<"users" | "roles">("users");
const allDictionaryTabs: PageTabItem[] = [
  { label: "品牌", value: "brands" },
  { label: "设备类型", value: "device-types" },
  { label: "数据中心", value: "data-centers" },
];
const organizationTabs: PageTabItem[] = [
  { label: "用户账号", value: "users" },
  { label: "预设角色", value: "roles" },
];
const dictionaryTabs = computed(() =>
  can("racks.view") ? allDictionaryTabs : allDictionaryTabs.filter((item) => item.value !== "data-centers"),
);
const canManageCurrentDictionary = computed(() =>
  can(dictionarySection.value === "data-centers" ? "racks.manage" : "settings.manage"),
);
const hasDictionaryFilters = computed(() => Boolean(dictionarySearch.value.trim()));
const hasUserSearch = computed(() => Boolean(userSearch.value.trim()));
const hasAuditFilters = computed(() => Boolean(
  auditFilters.value.search?.trim() ||
  auditFilters.value.resource_type ||
  auditFilters.value.action ||
  auditFilters.value.start ||
  auditFilters.value.end,
));
const auditResourceOptions = [
  { label: "用户", value: "user" },
  { label: "品牌", value: "brand" },
  { label: "设备类型", value: "device_type" },
  { label: "数据中心", value: "data_center" },
  { label: "机房", value: "server_room" },
  { label: "机柜", value: "rack" },
  { label: "自定义字段", value: "custom_field" },
  { label: "字段选项", value: "custom_field_option" },
  { label: "标签", value: "tag" },
  { label: "资产", value: "asset" },
  { label: "故障", value: "fault_event" },
  { label: "维修", value: "repair_record" },
  { label: "许可证", value: "software_license" },
  { label: "备件", value: "spare_part" },
  { label: "库存流水", value: "spare_stock_transaction" },
  { label: "盘点任务", value: "inventory_task" },
  { label: "盘点设备", value: "inventory_item" },
  { label: "登录认证", value: "auth_login" },
];
const auditActionOptions = [
  { label: "新增", value: "create" },
  { label: "修改", value: "update" },
  { label: "删除", value: "delete" },
  { label: "导入", value: "import" },
  { label: "完成", value: "complete" },
  { label: "重新打开", value: "reopen" },
  { label: "登录成功", value: "login_success" },
  { label: "登录失败", value: "login_failure" },
  { label: "账号锁定", value: "login_locked" },
];

function clearDictionarySearch() {
  dictionarySearch.value = "";
  return loadDictionaries();
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
</script>

<template>
  <div class="itam-page settings-page">
    <CustomFieldSettingsPage v-if="settingsSection === 'custom-fields'" :context="props.context" />
    <TagSettingsPage v-else-if="settingsSection === 'tags'" :context="props.context" />

    <PageContainer v-else-if="settingsSection === 'dictionaries'">
      <template #subnav>
        <PageTabs v-model="dictionarySection" :items="dictionaryTabs" @update:model-value="() => loadDictionaries()">
          <template #actions>
            <el-button type="primary" :disabled="!canManageCurrentDictionary || dictionarySaving" @click="openDictionaryModal()">
              新增{{ currentDictionaryLabel }}
            </el-button>
          </template>
        </PageTabs>
      </template>
      <template #toolbar>
        <PageToolbar>
          <SearchField
            class="itam-filter-search"
            v-model="dictionarySearch"
            :loading="dictionaryLoading"
            :placeholder="`搜索${currentDictionaryLabel}`"
            :aria-label="`搜索${currentDictionaryLabel}`"
            @search="() => loadDictionaries()"
          />
        </PageToolbar>
      </template>
      <PageContent surface>
        <div v-if="dictionaryError" class="settings-state settings-state--error" role="alert">
          <div class="settings-state__copy">
            <strong>字典数据加载失败</strong>
            <span>{{ dictionaryError }}</span>
          </div>
          <el-button type="primary" plain :loading="dictionaryLoading" @click="retryDictionaries">重新加载</el-button>
        </div>
        <el-table v-else v-loading="dictionaryLoading" :data="currentDictionaryItems" table-layout="fixed">
          <template #empty>
            <div class="settings-empty">
              <span>{{ hasDictionaryFilters ? `没有符合当前筛选条件的${currentDictionaryLabel}` : `暂无${currentDictionaryLabel}` }}</span>
              <el-button v-if="hasDictionaryFilters" link type="primary" @click="clearDictionarySearch">清除筛选</el-button>
            </div>
          </template>
          <el-table-column prop="name" :label="currentDictionaryLabel" min-width="220" show-overflow-tooltip />
          <el-table-column v-if="dictionarySection === 'device-types'" label="颜色" width="150">
            <template #default="{ row }">
              <span class="color-chip" :style="{ background: row.color || '#1677EF' }" />
              {{ row.color || "#1677EF" }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <StatusTag :type="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" />
            </template>
          </el-table-column>
          <el-table-column prop="assets_count" label="资产数量" width="110" />
          <el-table-column label="操作" width="210" fixed="right">
            <template #default="{ row }">
              <div class="ep-table-actions">
                <el-button link type="primary" :disabled="!canManageCurrentDictionary || dictionaryActionId === row.id" @click="openDictionaryModal(row)">编辑</el-button>
                <el-button link :disabled="!canManageCurrentDictionary || dictionaryActionId === row.id" @click="toggleDictionary(row)">{{ row.is_active ? "停用" : "启用" }}</el-button>
                <el-button link type="danger" :disabled="!canManageCurrentDictionary || dictionaryActionId === row.id || dictionaryItemUsed(row)" @click="deleteDictionary(row)">删除</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'organization' && isAdmin" :toolbar-visible="organizationTab === 'users'">
      <template #subnav>
        <PageTabs v-model="organizationTab" :items="organizationTabs">
          <template #actions>
            <el-button v-if="organizationTab === 'users'" type="primary" :disabled="userSaving" @click="openUserModal()">新增用户</el-button>
          </template>
        </PageTabs>
      </template>
      <template #toolbar v-if="organizationTab === 'users'">
        <PageToolbar>
          <SearchField
            class="itam-filter-search"
            v-model="userSearch"
            :loading="organizationLoading"
            :disabled="organizationLoading"
            placeholder="搜索用户名、姓名或邮箱"
            aria-label="搜索用户账号"
            @search="searchUsers"
          />
        </PageToolbar>
      </template>
      <PageContent surface>
        <template v-if="organizationTab === 'users'">
          <div v-if="userListError" class="settings-state settings-state--error" role="alert">
            <div class="settings-state__copy"><strong>用户数据加载失败</strong><span>{{ userListError }}</span></div>
            <el-button type="primary" plain :loading="organizationLoading" @click="retryUserList">重新加载</el-button>
          </div>
          <el-table v-else v-loading="organizationLoading" :data="users" table-layout="fixed">
            <template #empty>
              <div class="settings-empty">
                <span>{{ hasUserSearch ? "没有符合当前筛选条件的用户账号" : "暂无用户账号" }}</span>
                <el-button v-if="hasUserSearch" link type="primary" @click="userSearch = ''; searchUsers()">清除筛选</el-button>
              </div>
            </template>
            <el-table-column prop="username" label="用户名" min-width="180" show-overflow-tooltip />
            <el-table-column prop="display_name" label="姓名" min-width="180" show-overflow-tooltip />
            <el-table-column prop="email" label="邮箱" min-width="220" show-overflow-tooltip />
            <el-table-column prop="assigned_role_name" label="角色" min-width="150" show-overflow-tooltip />
            <el-table-column label="状态" width="120">
              <template #default="{ row }"><StatusTag :type="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template>
            </el-table-column>
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <div class="ep-table-actions">
                  <el-button link type="primary" :disabled="userActionId === row.id || userSaving" @click="openUserModal(row)">编辑</el-button>
                  <el-button link :disabled="userActionId === row.id" @click="toggleUser(row)">{{ row.is_active ? "停用" : "启用" }}</el-button>
                  <el-button link type="danger" :disabled="userActionId === row.id" @click="deleteUser(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <PagedTable v-if="!userListError" v-model:current-page="userPage" v-model:page-size="userPageSize" :total="userCount" :page-sizes="[20, 50, 100]" :loading="organizationLoading" @update:current-page="changeUserPage" @update:page-size="changeUserPageSize" />
        </template>
        <template v-else>
          <div v-if="roleListError" class="settings-state settings-state--error" role="alert">
            <div class="settings-state__copy"><strong>角色数据加载失败</strong><span>{{ roleListError }}</span></div>
            <el-button type="primary" plain :loading="organizationLoading" @click="retryOrganization">重新加载</el-button>
          </div>
          <el-table v-else v-loading="organizationLoading && !roles.length" :data="roles" table-layout="fixed">
            <template #empty><div class="settings-empty"><span>暂无角色</span></div></template>
            <el-table-column prop="name" label="角色名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="description" label="权限范围" min-width="320" show-overflow-tooltip />
            <el-table-column prop="user_count" label="用户数" width="120" />
          </el-table>
          <p class="form-hint">预设角色不可重命名或删除，每个账号只能分配一个业务角色。</p>
        </template>
      </PageContent>
    </PageContainer>

    <PageContainer v-else-if="settingsSection === 'audit' && can('audit.view')">
      <template #toolbar>
        <PageToolbar>
          <SearchField class="itam-filter-search" v-model="auditFilters.search" :loading="auditListLoading" placeholder="操作者、资源或编号" aria-label="搜索操作日志" @search="searchAuditLogs" />
          <el-select class="itam-filter-select" v-model="auditFilters.resource_type" placeholder="全部资源" clearable :disabled="auditListLoading" @change="searchAuditLogs">
            <el-option v-for="item in auditResourceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-select class="itam-filter-select" v-model="auditFilters.action" placeholder="全部动作" clearable :disabled="auditListLoading" @change="searchAuditLogs">
            <el-option v-for="item in auditActionOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-date-picker class="itam-filter-date" v-model="auditFilters.start" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" :disabled="auditListLoading" @change="searchAuditLogs" />
          <el-date-picker class="itam-filter-date" v-model="auditFilters.end" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" :disabled="auditListLoading" @change="searchAuditLogs" />
        </PageToolbar>
      </template>
      <PageContent surface>
        <div v-if="auditListError" class="settings-state settings-state--error" role="alert">
          <div class="settings-state__copy"><strong>操作日志数据加载失败</strong><span>{{ auditListError }}</span></div>
          <el-button type="primary" plain :loading="auditListLoading" @click="retryAuditLogs">重新加载</el-button>
        </div>
        <template v-else>
          <el-table v-loading="auditListLoading" :data="auditLogs">
            <template #empty>
              <div class="settings-empty">
                <span>{{ hasAuditFilters ? "没有符合当前筛选条件的操作日志" : "暂无操作日志" }}</span>
                <el-button v-if="hasAuditFilters" link type="primary" @click="clearAuditFilters">清除筛选</el-button>
              </div>
            </template>
            <el-table-column prop="created_at" label="时间" width="180"><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></el-table-column>
            <el-table-column prop="actor_display_name" label="操作者" width="130" />
            <el-table-column prop="resource_type" label="资源" width="130" />
            <el-table-column prop="action" label="动作" width="90" />
            <el-table-column prop="resource_id" label="资源编号" width="120" />
            <el-table-column label="变更内容" min-width="320">
              <template #default="{ row }">
                <el-popover placement="left" :width="520" trigger="click">
                  <pre class="audit-payload">{{ JSON.stringify(row.payload, null, 2) }}</pre>
                  <template #reference><el-button link type="primary">查看变更</el-button></template>
                </el-popover>
              </template>
            </el-table-column>
          </el-table>
          <PagedTable v-model:current-page="auditPage" v-model:page-size="auditPageSize" :total="auditCount" :page-sizes="[20, 50, 100]" :loading="auditListLoading" @update:current-page="changeAuditPage" @update:page-size="changeAuditPageSize" />
        </template>
      </PageContent>
    </PageContainer>
  </div>
</template>
