<script setup lang="ts">
import { proxyRefs, ref } from "vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
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
import type { TagContext } from "../page-context";

const props = defineProps<{ context: TagContext }>();
const { t } = useI18n();
const c = proxyRefs(props.context);
const tagFormRef = ref<FormInstance>();
const tagFormRules = computed<FormRules>(() => ({
  name: [
    { required: true, whitespace: true, message: t("tag.nameRequired"), trigger: "blur" },
    { max: 80, message: t("tag.nameMax"), trigger: "blur" },
  ],
}));

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
            <SearchField v-model="c.tagSearch" :loading="c.tagListLoading" :placeholder="t('tag.searchPlaceholder')" :aria-label="t('tag.searchPlaceholder')" @search="c.refreshTagList()" />
        </template>
        <template #filters>
          <div class="page-toolbar__filter-group">
            <el-select v-model="c.tagActive" :placeholder="t('tag.allStatuses')" clearable :disabled="c.tagListLoading" @change="c.refreshTagList()">
              <el-option :label="t('status.active')" value="true" />
              <el-option :label="t('status.inactive')" value="false" />
            </el-select>
          </div>
        </template>
        <template #primary>
          <el-button v-if="c.can('tags.manage')" class="page-primary-action" type="primary" :disabled="c.tagSaving" @click="c.openTagModal()">{{ t('tag.add') }}</el-button>
        </template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-alert v-if="c.tagListError" :title="t('tag.loadFailed')" type="error" show-icon :closable="false">
        <template #default>
          <span>{{ c.tagListError }}</span>
          <el-button link type="danger" :loading="c.tagListLoading" @click="c.retryTagList">{{ t('common.retry') }}</el-button>
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
        <el-table class="settings-tag-table" v-loading="c.tagListLoading" :data="c.tagTableItems" table-layout="fixed">
        <template #empty>
          <el-empty :image-size="56" :description="c.tagSearch.trim() || c.tagActive ? t('tag.noMatching') : t('tag.noTags')">
            <el-button v-if="c.tagSearch.trim() || c.tagActive" link type="primary" @click="c.tagSearch = ''; c.tagActive = ''; c.refreshTagList()">{{ t('common.clearFilters') }}</el-button>
          </el-empty>
        </template>
        <el-table-column prop="name" :label="t('tag.name')" width="360" show-overflow-tooltip />
        <el-table-column prop="assets_count" :label="t('tag.referencedAssets')" min-width="150" />
        <el-table-column :label="t('common.status')" width="90">
          <template #default="{ row }"><StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template>
        </el-table-column>
        <el-table-column v-if="c.can('tags.manage')" :label="t('common.operation')" width="132" fixed="right">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <TableIconButton
                :icon="Edit"
                :label="t('common.edit')"
                type="primary"
                :disabled="c.tagActionId === row.id || c.tagSaving"
                @click="c.openTagModal(row)"
              />
              <TableIconButton
                :icon="row.is_active ? CircleClose : CircleCheck"
                :label="row.is_active ? t('status.inactive') : t('status.active')"
                :disabled="c.tagActionId === row.id"
                @click="c.toggleTag(row)"
              />
              <TableIconButton
                :icon="Delete"
                :label="t('common.delete')"
                type="danger"
                :disabled="c.tagActionId === row.id || (row.assets_count || 0) > 0"
                @click="c.deleteTag(row)"
              />
            </div>
          </template>
        </el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell v-model="c.showTagModal" :title="c.editingTag ? t('tag.editTitle') : t('tag.createTitle')" :description="t('tag.description')" size="small" :saving="c.tagSaving" :show-close="!c.tagSaving" :close-disabled="c.tagSaving" :close-on-click-modal="!c.tagSaving" :close-on-press-escape="!c.tagSaving">
    <el-form ref="tagFormRef" class="horizontal-form" :model="c.tagForm" :rules="tagFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitTag">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('tag.basicInfo') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('tag.name')" prop="name" required :error="c.tagFormErrors.name"><el-input v-model="c.tagForm.name" maxlength="80" /></el-form-item>
          <el-form-item :label="t('common.status')">
            <el-select v-model="c.tagForm.is_active" :aria-label="t('common.status')">
              <el-option :label="t('status.active')" :value="true" />
              <el-option :label="t('status.inactive')" :value="false" />
            </el-select>
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer><el-button :disabled="c.tagSaving" @click="c.showTagModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="c.tagSaving" :disabled="c.tagSaving" @click="submitTag">{{ t('tag.save') }}</el-button></template>
  </FormDialogShell>
</template>
