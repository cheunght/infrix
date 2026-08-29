<script setup lang="ts">
import { proxyRefs, ref } from "vue";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import PagedTable from "./PagedTable.vue";
import FormDialogShell from "./FormDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import type { TagContext } from "../types/page-context";

const props = defineProps<{ context: TagContext }>();
const c = proxyRefs(props.context);
const tagFormRef = ref<FormInstance>();
const tagFormRules: FormRules = {
  name: [
    { required: true, whitespace: true, message: "请输入标签名称", trigger: "blur" },
    { max: 80, message: "标签名称不能超过 80 个字符", trigger: "blur" },
  ],
};

async function submitTag() {
  const valid = await tagFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await c.saveTag();
}
</script>

<template>
  <PageContainer>
    <template #toolbar>
      <PageToolbar>
        <template #search>
            <SearchField v-model="c.tagSearch" :loading="c.tagListLoading" placeholder="搜索标签" aria-label="搜索标签" @search="c.refreshTagList()" />
        </template>
        <template #filters>
          <div class="page-toolbar__filter-group">
            <el-select v-model="c.tagActive" placeholder="全部状态" clearable :disabled="c.tagListLoading" @change="c.refreshTagList()">
              <el-option label="启用" value="true" />
              <el-option label="停用" value="false" />
            </el-select>
          </div>
        </template>
        <template #primary>
          <el-button v-if="c.can('tags.manage')" class="page-primary-action" type="primary" :disabled="c.tagSaving" @click="c.openTagModal()">新增标签</el-button>
        </template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-alert v-if="c.tagListError" title="标签数据加载失败" type="error" show-icon :closable="false">
        <template #default>
          <span>{{ c.tagListError }}</span>
          <el-button link type="danger" :loading="c.tagListLoading" @click="c.retryTagList">重新加载</el-button>
        </template>
      </el-alert>
      <PagedTable
        v-else
        v-model:current-page="c.tagPage"
        v-model:page-size="c.tagPageSize"
        :total="c.tagCount"
        @update:current-page="c.changeTagPage"
        @update:page-size="c.changeTagPageSize"
      >
        <el-table v-loading="c.tagListLoading" :data="c.tagTableItems">
        <template #empty>
          <el-empty :image-size="56" :description="c.tagSearch.trim() || c.tagActive ? '没有符合筛选条件的标签' : '暂无标签'">
            <el-button v-if="c.tagSearch.trim() || c.tagActive" link type="primary" @click="c.tagSearch = ''; c.tagActive = ''; c.refreshTagList()">清除筛选</el-button>
          </el-empty>
        </template>
        <el-table-column prop="name" label="标签名称" min-width="220" />
        <el-table-column prop="assets_count" label="引用资产" width="110" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <TableIconButton
                :icon="Edit"
                label="编辑"
                type="primary"
                :disabled="!c.can('tags.manage') || c.tagActionId === row.id || c.tagSaving"
                @click="c.openTagModal(row)"
              />
              <TableIconButton
                :icon="row.is_active ? CircleClose : CircleCheck"
                :label="row.is_active ? '停用' : '启用'"
                :disabled="!c.can('tags.manage') || c.tagActionId === row.id"
                @click="c.toggleTag(row)"
              />
              <TableIconButton
                :icon="Delete"
                label="删除"
                type="danger"
                :disabled="!c.can('tags.manage') || c.tagActionId === row.id || (row.assets_count || 0) > 0"
                @click="c.deleteTag(row)"
              />
            </div>
          </template>
        </el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell v-model="c.showTagModal" :title="c.editingTag ? '编辑标签' : '新增标签'" description="维护标签名称和启用状态" size="small" :saving="c.tagSaving" :show-close="!c.tagSaving" :close-disabled="c.tagSaving" :close-on-click-modal="!c.tagSaving" :close-on-press-escape="!c.tagSaving">
    <el-form ref="tagFormRef" class="horizontal-form" :model="c.tagForm" :rules="tagFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitTag">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">基本信息</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="标签名称" prop="name" required :error="c.tagFormErrors.name"><el-input v-model="c.tagForm.name" maxlength="80" /></el-form-item>
          <el-form-item label="状态">
            <el-select v-model="c.tagForm.is_active" aria-label="状态">
              <el-option label="启用" :value="true" />
              <el-option label="停用" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer><el-button :disabled="c.tagSaving" @click="c.showTagModal = false">取消</el-button><el-button type="primary" :loading="c.tagSaving" :disabled="c.tagSaving" @click="submitTag">保存标签</el-button></template>
  </FormDialogShell>
</template>
