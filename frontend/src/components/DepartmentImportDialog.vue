<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Download, Upload } from "@element-plus/icons-vue";
import FormDialogShell from "./FormDialogShell.vue";
import type { DepartmentImportPreview } from "../types";
import ReferenceImportReview from "./ReferenceImportReview.vue";

const props = defineProps<{
  modelValue: boolean;
  file: File | null;
  preview: DepartmentImportPreview | null;
  previewing: boolean;
  importing: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [];
  select: [file: File | null];
  commit: [];
  "download-template": [];
}>();

const { t } = useI18n();
const fileInput = ref<HTMLInputElement | null>(null);
const canCommit = computed(() => Boolean(
  props.preview
  && props.file
  && props.preview.valid > 0
  && props.preview.error === 0
  && !props.previewing
  && !props.importing,
));

function chooseFile() {
  fileInput.value?.click();
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;
  input.value = "";
  emit("select", file);
}

</script>

<template>
  <FormDialogShell
    :model-value="modelValue"
    :title="t('settings.departmentImportTitle')"
    :description="t('settings.departmentImportHint')"
    :error="error"
    size="large"
    :saving="importing"
    :close-disabled="importing"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <div class="department-import-dialog">
      <input ref="fileInput" class="department-import-dialog__input" type="file" accept=".xlsx" @change="handleFileChange" />
      <div class="department-import-dialog__file-row">
        <el-button type="primary" plain :disabled="previewing || importing" @click="chooseFile">
          <el-icon><Upload /></el-icon>
          {{ t("settings.departmentImportChooseFile") }}
        </el-button>
        <span class="department-import-dialog__filename" :title="file?.name || ''">{{ file?.name || t("settings.departmentImportNoFile") }}</span>
        <el-button link :disabled="previewing || importing" @click="emit('download-template')">
          <el-icon><Download /></el-icon>
          {{ t("settings.departmentImportDownloadTemplate") }}
        </el-button>
      </div>

      <el-alert v-if="previewing" :title="t('settings.departmentImportPreviewing')" type="info" :closable="false" show-icon />

      <template v-if="preview">
        <el-alert
          v-if="preview.ignored_columns.length"
          class="department-import-dialog__ignored"
          :title="t('settings.departmentImportIgnoredColumns', { columns: preview.ignored_columns.join(', ') })"
          type="warning"
          :closable="false"
          show-icon
        />
        <ReferenceImportReview kind="department" :preview="preview" :disabled="previewing || importing" />
      </template>
      <el-empty v-else :image-size="64" :description="t('settings.departmentImportChooseFile')" />
    </div>

    <template #footer>
      <el-button :disabled="importing" @click="emit('update:modelValue', false)">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="importing" :disabled="!canCommit" @click="emit('commit')">
        {{ t("settings.departmentImportCommit") }}
      </el-button>
    </template>
  </FormDialogShell>
</template>

<style scoped>
.department-import-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.department-import-dialog__input {
  display: none;
}

.department-import-dialog__file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.department-import-dialog__filename {
  min-width: 160px;
  flex: 1;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.department-import-dialog__ignored {
  margin-top: -2px;
}

</style>
