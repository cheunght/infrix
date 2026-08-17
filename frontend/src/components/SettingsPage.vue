<script setup lang="ts">
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";

const props = defineProps<{ context: Record<string, any> }>();
const {
  loading,
  settingsSection,
  categories,
  can,
  openCategoryModal,
  deleteCategory,
  dictionarySection,
  dictionarySearch,
  loadDictionaries,
  currentDictionaryLabel,
  openDictionaryModal,
  currentDictionaryItems,
  toggleDictionary,
  deleteDictionary,
  dictionaryItemUsed,
  isAdmin,
  users,
  openUserModal,
  toggleUser,
  deleteUser,
  roles,
  openRoleModal,
  deleteRole,
  auditFilters,
  loadAuditLogs,
  searchAuditLogs,
  auditLogs,
  formatDateTime,
  auditPage,
  auditPageSize,
  auditCount,
  changeAuditPage,
  changeAuditPageSize,
} = props.context;
</script>

<template>
  <div class="itam-page settings-page">
        <el-card v-if="settingsSection === 'categories'" shadow="never"
          ><template #header
            ><div class="ep-toolbar">
              <strong>设备分类</strong><span class="ep-toolbar-spacer"></span
              ><div class="ep-toolbar-actions"><el-button
                type="primary"
                :disabled="!can('settings.manage')"
                @click="openCategoryModal()"
                >新增分类</el-button></div
              >
            </div></template
          ><el-table :data="categories" empty-text="暂无设备分类"
            ><el-table-column prop="name" label="分类名称" /><el-table-column
              label="颜色"
              ><template #default="{ row }"
                ><el-color-picker :model-value="row.color" disabled />
                {{ row.color }}</template
              ></el-table-column
            ><el-table-column
              prop="assets_count"
              label="资产数量"
            /><el-table-column label="操作" width="150"
              ><template #default="{ row }"
                ><div class="ep-table-actions"><el-button
                  link
                  type="primary"
                  :disabled="!can('settings.manage')"
                  @click="openCategoryModal(row)"
                  >编辑</el-button
                ><el-button
                  link
                  type="danger"
                  :disabled="!can('settings.manage') || (row.assets_count ?? 0) > 0"
                  @click="deleteCategory(row)"
                  >删除</el-button></div
                ></template
              ></el-table-column
            ></el-table
          ></el-card
        >
        <CustomFieldSettingsPage v-else-if="settingsSection === 'custom-fields'" :context="props.context" />
        <TagSettingsPage v-else-if="settingsSection === 'tags'" :context="props.context" />
        <el-card v-else-if="settingsSection === 'dictionaries'" shadow="never"
          ><template #header
            ><div class="ep-toolbar">
              <el-radio-group
                v-model="dictionarySection"
                @change="() => loadDictionaries()"
                ><el-radio-button value="brands">品牌</el-radio-button
                ><el-radio-button value="device-types">设备类型</el-radio-button
                ><el-radio-button value="data-centers"
                  >数据中心</el-radio-button
                ></el-radio-group
              ><SearchField
                v-model="dictionarySearch"
                :placeholder="`搜索${currentDictionaryLabel}`"
                :aria-label="`搜索${currentDictionaryLabel}`"
                @search="() => loadDictionaries()"
              />
              <span class="ep-toolbar-spacer"></span
              ><div class="ep-toolbar-actions"><el-button
                type="primary"
                :disabled="!can('settings.manage')"
                @click="openDictionaryModal()"
                >新增{{ currentDictionaryLabel }}</el-button></div
              >
            </div></template
          ><el-table
            :data="currentDictionaryItems"
            :empty-text="`暂无${currentDictionaryLabel}`"
            ><el-table-column
              prop="name"
              :label="currentDictionaryLabel"
            /><el-table-column label="状态" width="100"
              ><template #default="{ row }"
                ><el-tag :type="row.is_active ? 'success' : 'info'">{{
                  row.is_active ? "启用" : "停用"
                }}</el-tag></template
              ></el-table-column
            ><el-table-column
              prop="assets_count"
              label="资产数量"
              width="110"
            /><el-table-column label="操作" width="210"
              ><template #default="{ row }"
                ><div class="ep-table-actions"><el-button
                  link
                  type="primary"
                  :disabled="!can('settings.manage')"
                  @click="openDictionaryModal(row)"
                  >编辑</el-button
                ><el-button
                  link
                  :disabled="!can('settings.manage')"
                  @click="toggleDictionary(row)"
                  >{{ row.is_active ? "停用" : "启用" }}</el-button
                ><el-button
                  link
                  type="danger"
                  :disabled="!can('settings.manage') || dictionaryItemUsed(row)"
                  @click="deleteDictionary(row)"
                  >删除</el-button></div
                ></template
              ></el-table-column
            ></el-table
          ></el-card
        >
        <section
          v-else-if="settingsSection === 'organization' && isAdmin"
          class="organization-grid"
        >
          <el-card shadow="never"
            ><template #header
              ><div class="ep-toolbar">
                <strong>用户账号</strong><span class="ep-toolbar-spacer"></span
                ><div class="ep-toolbar-actions"><el-button type="primary" @click="openUserModal()"
                  >新增用户</el-button></div
                >
              </div></template
            ><el-table :data="users" empty-text="暂无用户账号"
              ><el-table-column
                prop="username"
                label="用户名"
              /><el-table-column
                prop="display_name"
                label="姓名"
              /><el-table-column prop="email" label="邮箱" /><el-table-column
                label="状态"
                ><template #default="{ row }"
                  ><el-tag :type="row.is_active ? 'success' : 'info'">{{
                    row.is_active ? "启用" : "停用"
                  }}</el-tag></template
                ></el-table-column
              ><el-table-column label="操作" width="190"
                ><template #default="{ row }"
                  ><div class="ep-table-actions"><el-button link type="primary" @click="openUserModal(row)"
                    >编辑</el-button
                  ><el-button link @click="toggleUser(row)">{{
                    row.is_active ? "停用" : "启用"
                  }}</el-button
                  ><el-button link type="danger" @click="deleteUser(row)"
                    >删除</el-button></div
                  ></template
                ></el-table-column
              ></el-table
            ></el-card
          ><el-card shadow="never"
            ><template #header
              ><div class="ep-toolbar">
                <strong>预设角色</strong><span class="ep-toolbar-spacer"></span>
              </div></template
            ><el-table :data="roles" empty-text="暂无角色"
              ><el-table-column prop="name" label="角色名称" /><el-table-column prop="description" label="权限范围" min-width="240"/><el-table-column
                prop="user_count"
                label="用户数"
              /></el-table><p class="form-hint">预设角色不可重命名或删除，每个账号只能分配一个业务角色。</p
            ></el-card
          >
        </section>
        <el-card v-else-if="settingsSection === 'audit' && can('audit.view')" shadow="never">
          <template #header><div class="ep-toolbar audit-toolbar"><strong>操作日志</strong><SearchField v-model="auditFilters.search" placeholder="操作者、资源或编号" aria-label="搜索操作日志" @search="searchAuditLogs"/><el-select v-model="auditFilters.resource_type" placeholder="全部资源" clearable @change="searchAuditLogs"><el-option label="资产" value="asset"/><el-option label="数据中心" value="data_center"/><el-option label="机房" value="server_room"/><el-option label="机柜" value="rack"/><el-option label="故障" value="fault_event"/><el-option label="维修" value="repair_record"/><el-option label="许可证" value="software_license"/><el-option label="备件" value="spare_part"/><el-option label="库存流水" value="spare_stock_transaction"/><el-option label="登录认证" value="auth_login"/></el-select><el-select v-model="auditFilters.action" placeholder="全部动作" clearable @change="searchAuditLogs"><el-option label="新增" value="create"/><el-option label="修改" value="update"/><el-option label="删除" value="delete"/><el-option label="导入" value="import"/><el-option label="登录成功" value="login_success"/><el-option label="登录失败" value="login_failure"/><el-option label="账号锁定" value="login_locked"/></el-select><el-date-picker v-model="auditFilters.start" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" @change="searchAuditLogs"/><el-date-picker v-model="auditFilters.end" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" @change="searchAuditLogs"/></div></template>
          <el-table :data="auditLogs" empty-text="暂无操作日志"><el-table-column prop="created_at" label="时间" width="180"><template #default="{ row }">{{ formatDateTime(row.created_at) }}</template></el-table-column><el-table-column prop="actor_display_name" label="操作者" width="130"/><el-table-column prop="resource_type" label="资源" width="130"/><el-table-column prop="action" label="动作" width="90"/><el-table-column prop="resource_id" label="资源编号" width="120"/><el-table-column label="变更内容" min-width="320"><template #default="{ row }"><el-popover placement="left" :width="520" trigger="click"><pre class="audit-payload">{{ JSON.stringify(row.payload, null, 2) }}</pre><template #reference><el-button link type="primary">查看变更</el-button></template></el-popover></template></el-table-column></el-table>
          <PagedTable v-model:current-page="auditPage" v-model:page-size="auditPageSize" :total="auditCount" :page-sizes="[20, 50, 100]" :loading="loading" @update:current-page="changeAuditPage" @update:page-size="changeAuditPageSize"/>
        </el-card>
  </div>
</template>
