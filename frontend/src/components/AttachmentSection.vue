<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isAbortError, pageItems, type PageResult } from "../api";
import { normalizeApiError } from "../error-handling";
import type { RequestFn } from "../page-context";
import type { AssetAttachment, AttachmentCategoryOption } from "../types";

const props = withDefaults(defineProps<{
  assetId: number;
  repairId?: number | null;
  scope: "asset" | "repair";
  request: RequestFn;
  download: (path: string, filename?: string) => Promise<void>;
  canView?: boolean;
  canManage?: boolean;
  showHeading?: boolean;
  confirmAction?: (message: string) => Promise<boolean>;
}>(), {
  repairId: null,
  canView: true,
  canManage: false,
  showHeading: true,
});

const { t } = useI18n();
const attachments = ref<AssetAttachment[]>([]);
const categories = ref<AttachmentCategoryOption[]>([]);
const loading = ref(false);
const error = ref("");
const uploadError = ref("");
const uploading = ref(false);
const downloadingId = ref<number | null>(null);
const deletingId = ref<number | null>(null);
const selectedFile = ref<File | null>(null);
const category = ref("other");
const note = ref("");
let controller: AbortController | null = null;
let requestSequence = 0;

const acceptedFileTypes = ".pdf,.txt,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

function resourceQuery(): string {
  const params = new URLSearchParams();
  if (props.scope === "repair" && props.repairId) params.set("repair", String(props.repairId));
  else params.set("asset", String(props.assetId));
  return params.toString();
}

function formatSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  if (!value) return t("common.notAvailable");
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function categoryLabel(value: string): string {
  return categories.value.find((item) => item.value === value)?.label || value;
}

function setDefaultCategory(options: AttachmentCategoryOption[]) {
  if (!options.some((item) => item.value === category.value)) {
    category.value = options[0]?.value || "other";
  }
}

function resetFile() {
  selectedFile.value = null;
}

function handleFileChange(file: { raw?: File }) {
  selectedFile.value = file.raw || null;
  uploadError.value = "";
}

function handleFileExceed() {
  uploadError.value = t("attachment.onlyOneFile");
}

async function load() {
  if (!props.canView || !props.assetId || (props.scope === "repair" && !props.repairId)) return;
  const sequence = ++requestSequence;
  controller?.abort();
  const nextController = new AbortController();
  controller = nextController;
  loading.value = true;
  error.value = "";
  try {
    const [categoryPayload, attachmentPayload] = await Promise.all([
      props.request<AttachmentCategoryOption[]>(`/attachments/categories/?scope=${props.scope}`, { signal: nextController.signal }),
      props.request<PageResult<AssetAttachment> | AssetAttachment[]>(`/attachments/?${resourceQuery()}`, { signal: nextController.signal }),
    ]);
    if (sequence !== requestSequence || nextController.signal.aborted) return;
    categories.value = categoryPayload;
    setDefaultCategory(categoryPayload);
    attachments.value = pageItems(attachmentPayload);
  } catch (cause) {
    if (sequence !== requestSequence || nextController.signal.aborted || isAbortError(cause)) return;
    error.value = normalizeApiError(cause).message || t("attachment.loadFailed");
  } finally {
    if (sequence === requestSequence) {
      loading.value = false;
      if (controller === nextController) controller = null;
    }
  }
}

async function upload() {
  if (!props.canManage || !selectedFile.value || uploading.value) return;
  uploading.value = true;
  uploadError.value = "";
  const body = new FormData();
  body.append("asset", String(props.assetId));
  if (props.scope === "repair" && props.repairId) body.append("repair", String(props.repairId));
  body.append("category", category.value);
  if (note.value.trim()) body.append("note", note.value.trim());
  body.append("file", selectedFile.value, selectedFile.value.name);
  try {
    await props.request<AssetAttachment>("/attachments/", {
      method: "POST",
      body,
    });
    resetFile();
    note.value = "";
    await load();
  } catch (cause) {
    uploadError.value = normalizeApiError(cause).message || t("attachment.uploadFailed");
  } finally {
    uploading.value = false;
  }
}

async function download(attachment: AssetAttachment) {
  if (downloadingId.value !== null) return;
  downloadingId.value = attachment.id;
  try {
    await props.download(attachment.download_url, attachment.file_name);
  } catch (cause) {
    error.value = normalizeApiError(cause).message || t("attachment.downloadFailed");
  } finally {
    downloadingId.value = null;
  }
}

async function remove(attachment: AssetAttachment) {
  if (!props.canManage || deletingId.value !== null) return;
  const confirmed = props.confirmAction
    ? await props.confirmAction(t("attachment.deleteConfirm", { name: attachment.file_name }))
    : true;
  if (!confirmed) return;
  deletingId.value = attachment.id;
  error.value = "";
  try {
    await props.request(`/attachments/${attachment.id}/`, { method: "DELETE" });
    attachments.value = attachments.value.filter((item) => item.id !== attachment.id);
  } catch (cause) {
    error.value = normalizeApiError(cause).message || t("attachment.deleteFailed");
  } finally {
    deletingId.value = null;
  }
}

watch(
  [() => props.assetId, () => props.repairId, () => props.scope, () => props.canView],
  () => {
    attachments.value = [];
    categories.value = [];
    resetFile();
    note.value = "";
    void load();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  requestSequence += 1;
  controller?.abort();
});
</script>

<template>
  <section
    v-if="canView"
    class="asset-attachments"
    :aria-labelledby="showHeading ? `attachment-title-${scope}` : undefined"
    :aria-label="showHeading ? undefined : t('attachment.title')"
  >
    <div v-if="showHeading" class="asset-attachments__heading">
      <div>
        <h3 :id="`attachment-title-${scope}`">{{ t("attachment.title") }}</h3>
        <p>{{ scope === "repair" ? t("attachment.repairHint") : t("attachment.assetHint") }}</p>
      </div>
      <span v-if="attachments.length" class="asset-attachments__count">{{ attachments.length }}</span>
    </div>

    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon>
      <template #default>
        <el-button link type="danger" @click="load">{{ t("common.retry") }}</el-button>
      </template>
    </el-alert>

    <div v-if="canManage" class="asset-attachments__upload">
      <div class="asset-attachments__upload-row">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          :limit="1"
          :accept="acceptedFileTypes"
          :disabled="uploading"
          :on-change="handleFileChange"
          :on-exceed="handleFileExceed"
        >
          <el-button plain :disabled="uploading">{{ t("attachment.chooseFile") }}</el-button>
        </el-upload>
        <span v-if="selectedFile" class="asset-attachments__selected-file" :title="selectedFile.name">
          {{ selectedFile.name }}
        </span>
        <span v-else class="asset-attachments__file-hint">{{ t("attachment.fileHint") }}</span>
      </div>
      <div class="asset-attachments__upload-fields">
        <el-select v-model="category" :disabled="uploading" :aria-label="t('attachment.category')">
          <el-option v-for="item in categories" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-input v-model="note" :disabled="uploading" :placeholder="t('attachment.notePlaceholder')" maxlength="2000" />
        <el-button type="primary" :loading="uploading" :disabled="!selectedFile || uploading" @click="upload">
          {{ t("attachment.upload") }}
        </el-button>
      </div>
      <p v-if="uploadError" class="asset-attachments__error" role="alert">{{ uploadError }}</p>
    </div>

    <div v-if="loading" class="asset-attachments__state" role="status">{{ t("attachment.loading") }}</div>
    <div v-else-if="!attachments.length && !error" class="asset-attachments__state">{{ t("attachment.empty") }}</div>
    <ul v-else class="asset-attachments__list">
      <li v-for="attachment in attachments" :key="attachment.id" class="asset-attachments__item">
        <div class="asset-attachments__file">
          <strong :title="attachment.file_name">{{ attachment.file_name }}</strong>
          <span>
            {{ categoryLabel(attachment.category) }} · {{ formatSize(attachment.size) }} ·
            {{ attachment.uploaded_by_name || t("common.notAvailable") }} · {{ formatDate(attachment.uploaded_at) }}
          </span>
          <p v-if="attachment.note">{{ attachment.note }}</p>
        </div>
        <div class="asset-attachments__actions">
          <el-button link type="primary" :loading="downloadingId === attachment.id" :disabled="downloadingId !== null" @click="download(attachment)">
            {{ t("attachment.download") }}
          </el-button>
          <el-button v-if="canManage" link type="danger" :loading="deletingId === attachment.id" :disabled="deletingId !== null" @click="remove(attachment)">
            {{ t("common.delete") }}
          </el-button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.asset-attachments {
  min-width: 0;
}

.asset-attachments__heading,
.asset-attachments__upload-row,
.asset-attachments__upload-fields,
.asset-attachments__item {
  display: flex;
  min-width: 0;
  align-items: center;
}

.asset-attachments__heading {
  justify-content: space-between;
  gap: 12px;
}

.asset-attachments__heading h3 {
  margin: 0;
}

.asset-attachments__heading p,
.asset-attachments__file-hint,
.asset-attachments__state,
.asset-attachments__file span {
  color: var(--el-text-color-secondary);
}

.asset-attachments__heading p {
  margin: 4px 0 0;
  font-size: 12px;
}

.asset-attachments__count {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.asset-attachments__upload {
  display: grid;
  gap: 8px;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
}

.asset-attachments__upload-row {
  gap: 8px;
}

.asset-attachments__selected-file,
.asset-attachments__file,
.asset-attachments__file strong,
.asset-attachments__file span,
.asset-attachments__file p {
  min-width: 0;
  overflow-wrap: anywhere;
}

.asset-attachments__selected-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-attachments__file-hint {
  font-size: 12px;
}

.asset-attachments__upload-fields {
  gap: 8px;
}

.asset-attachments__upload-fields .el-select {
  flex: 0 0 150px;
}

.asset-attachments__upload-fields .el-input {
  min-width: 0;
  flex: 1 1 220px;
}

.asset-attachments__state {
  padding: 16px 0;
  font-size: 13px;
}

.asset-attachments__list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.asset-attachments__item {
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.asset-attachments__file {
  display: grid;
  flex: 1 1 auto;
  gap: 3px;
}

.asset-attachments__file strong {
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.asset-attachments__file span,
.asset-attachments__file p {
  font-size: 12px;
  line-height: 1.5;
}

.asset-attachments__file p {
  margin: 2px 0 0;
  white-space: pre-wrap;
}

.asset-attachments__actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.asset-attachments__actions .el-button + .el-button {
  margin-left: 0;
}

.asset-attachments__error {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 12px;
}

@media (max-width: 560px) {
  .asset-attachments__upload-fields,
  .asset-attachments__item {
    align-items: stretch;
    flex-direction: column;
  }

  .asset-attachments__upload-fields .el-select {
    flex-basis: auto;
    width: 100%;
  }

  .asset-attachments__actions {
    justify-content: flex-start;
  }
}
</style>
