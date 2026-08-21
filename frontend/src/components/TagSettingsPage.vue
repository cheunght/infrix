<script setup lang="ts">
import { proxyRefs } from "vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import type { TagContext } from "../types/page-context";

const props = defineProps<{ context: TagContext }>();
const c = proxyRefs(props.context);
</script>

<template>
  <PageContainer>
    <template #toolbar>
      <PageToolbar>
        <SearchField class="itam-filter-search" v-model="c.tagSearch" placeholder="搜索标签" aria-label="搜索标签" @search="c.loadTags()" />
        <el-select class="itam-filter-select" v-model="c.tagActive" @change="c.loadTags()">
          <el-option label="全部状态" value="all" />
          <el-option label="启用" value="true" />
          <el-option label="停用" value="false" />
        </el-select>
        <template #actions>
          <el-button type="primary" :disabled="!c.can('tags.manage')" @click="c.openTagModal()">新增标签</el-button>
        </template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-table v-loading="c.loading" :data="c.tags" empty-text="暂无标签">
        <el-table-column prop="name" label="标签名称" min-width="220" />
        <el-table-column prop="assets_count" label="引用资产" width="110" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><StatusTag :type="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <el-button link type="primary" :disabled="!c.can('tags.manage')" @click="c.openTagModal(row)">编辑</el-button>
              <el-button link :disabled="!c.can('tags.manage')" @click="c.toggleTag(row)">{{ row.is_active ? "停用" : "启用" }}</el-button>
              <el-button link type="danger" :disabled="!c.can('tags.manage') || (row.assets_count || 0) > 0" @click="c.deleteTag(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </PageContent>
  </PageContainer>

  <el-dialog v-model="c.showTagModal" :title="c.editingTag ? '编辑标签' : '新增标签'" width="460px">
    <el-form label-position="top">
      <el-form-item label="标签名称" required><el-input v-model="c.tagForm.name" /></el-form-item>
      <el-checkbox v-model="c.tagForm.is_active">启用</el-checkbox>
    </el-form>
    <template #footer><el-button @click="c.showTagModal = false">取消</el-button><el-button type="primary" @click="c.saveTag">保存</el-button></template>
  </el-dialog>
</template>
