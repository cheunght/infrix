<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Download, Upload } from "@element-plus/icons-vue";
import FormDialogShell from "./FormDialogShell.vue";
import type { PeopleImportPreview, PeopleImportRow } from "../types";

const props = defineProps<{
  modelValue: boolean;
  file: File | null;
  preview: PeopleImportPreview | null;
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

function operationLabel(operation: PeopleImportRow["operation"]): string {
  switch (operation) {
    case "create": return t("settings.peopleImportCreate");
    case "update": return t("settings.peopleImportUpdate");
    case "unchanged": return t("settings.peopleImportUnchanged");
    default: return t("settings.peopleImportError");
  }
}

function operationType(operation: PeopleImportRow["operation"]): "success" | "warning" | "info" | "danger" {
  switch (operation) {
    case "create": return "success";
    case "update": return "warning";
    case "unchanged": return "info";
    default: return "danger";
  }
}

function rowErrors(row: PeopleImportRow): string {
  return row.errors.map((item) => item.label ? `${item.label}：${item.message}` : item.message).join("；");
}
</script>

<template>
  <FormDialogShell
    :model-value="modelValue"
    :title="t('settings.peopleImportTitle')"
    :description="t('settings.peopleImportHint')"
    :error="error"
    size="large"
    :saving="importing"
    :close-disabled="importing"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <div class="people-import-dialog">
      <input ref="fileInput" class="people-import-dialog__input" type="file" accept=".xlsx" @change="handleFileChange" />
      <div class="people-import-dialog__file-row">
        <el-button type="primary" plain :disabled="previewing || importing" @click="chooseFile">
          <el-icon><Upload /></el-icon>
          {{ t("settings.peopleImportChooseFile") }}
        </el-button>
        <span class="people-import-dialog__filename" :title="file?.name || ''">{{ file?.name || t("settings.peopleImportNoFile") }}</span>
        <el-button link :disabled="previewing || importing" @click="emit('download-template')">
          <el-icon><Download /></el-icon>
          {{ t("settings.peopleImportDownloadTemplate") }}
        </el-button>
      </div>

      <el-alert v-if="previewing" :title="t('settings.peopleImportPreviewing')" type="info" :closable="false" show-icon />

      <template v-if="preview">
        <el-alert
          :title="t('settings.peopleImportPreviewSummary', preview)"
          :type="preview.error ? 'warning' : 'success'"
          :closable="false"
          show-icon
        />
        <el-alert
          v-if="preview.ignored_columns.length"
          class="people-import-dialog__ignored"
          :title="t('settings.peopleImportIgnoredColumns', { columns: preview.ignored_columns.join(', ') })"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-table
          class="people-import-dialog__table"
          :data="preview.rows"
          max-height="360"
          stripe
          border
          table-layout="fixed"
        >
          <el-table-column prop="line" :label="t('common.line')" width="64" />
          <el-table-column prop="employee_no" :label="t('settings.peopleImportEmployeeNo')" min-width="130" show-overflow-tooltip />
          <el-table-column prop="name" :label="t('settings.personName')" min-width="110" show-overflow-tooltip />
          <el-table-column prop="department" :label="t('settings.peopleImportDepartment')" min-width="120" show-overflow-tooltip />
          <el-table-column :label="t('settings.peopleImportOperation')" width="96">
            <template #default="{ row }">
              <el-tag :type="operationType(row.operation)" effect="light">{{ operationLabel(row.operation) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('settings.peopleImportErrors')" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">{{ rowErrors(row) || "—" }}</template>
          </el-table-column>
        </el-table>
      </template>
      <el-empty v-else :image-size="64" :description="t('settings.peopleImportChooseFile')" />
    </div>

    <template #footer>
      <el-button :disabled="importing" @click="emit('update:modelValue', false)">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="importing" :disabled="!canCommit" @click="emit('commit')">
        {{ t("settings.peopleImportCommit") }}
      </el-button>
    </template>
  </FormDialogShell>
</template>

<style scoped>
.people-import-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.people-import-dialog__input {
  display: none;
}

.people-import-dialog__file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.people-import-dialog__filename {
  min-width: 160px;
  flex: 1;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.people-import-dialog__ignored {
  margin-top: -2px;
}

.people-import-dialog__table {
  width: 100%;
}
</style>
