<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Download, Grid, Printer } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import QRCode from "qrcode";
import type { Asset } from "../types";
import { buildAssetQrValue } from "../asset-qr";
import { normalizeApiError } from "../error-handling";

type QrEntry = {
  asset: Asset;
  payload: string;
  image: string;
};

const props = defineProps<{
  modelValue: boolean;
  assets: Asset[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const { t } = useI18n();
const entries = ref<QrEntry[]>([]);
const loading = ref(false);
const error = ref("");
const labelSize = ref<"small" | "medium">("medium");
let generation = 0;

function modelLabel(asset: Asset): string {
  return asset.model_name || asset.model_text || t("asset.noModel");
}

function serialLabel(asset: Asset): string {
  return asset.serial_number || t("asset.noSerial");
}

async function generateCodes() {
  const currentGeneration = ++generation;
  if (!props.modelValue || !props.assets.length) {
    entries.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const nextEntries = await Promise.all(props.assets.map(async (asset) => ({
      asset,
      payload: buildAssetQrValue(asset),
      image: await QRCode.toDataURL(buildAssetQrValue(asset), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      }),
    })));
    if (currentGeneration === generation) entries.value = nextEntries;
  } catch (generationError) {
    if (currentGeneration === generation) {
      const normalized = normalizeApiError(generationError);
      error.value = normalized.kind === "unknown"
        ? t("asset.qrCodeGenerateFailed")
        : normalized.message;
      entries.value = [];
    }
  } finally {
    if (currentGeneration === generation) loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.assets],
  () => void generateCodes(),
  { deep: true, immediate: true },
);

function close() {
  emit("update:modelValue", false);
}

function downloadEntry(entry: QrEntry) {
  const anchor = document.createElement("a");
  anchor.href = entry.image;
  anchor.download = `${entry.asset.asset_no || `asset-${entry.asset.id}`}-qr.png`;
  anchor.click();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}

async function printEntries() {
  if (!entries.value.length) return;
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=960,height=760");
  if (!printWindow) {
    ElMessage.warning(t("asset.qrCodePrintBlocked"));
    return;
  }
  const isSmall = labelSize.value === "small";
  const labelWidth = isSmall ? "50mm" : "70mm";
  const labelHeight = isSmall ? "30mm" : "40mm";
  const qrSize = isSmall ? "18mm" : "24mm";
  const labels = entries.value.map((entry) => `
    <article class="asset-qr-print-label">
      <img src="${entry.image}" alt="${escapeHtml(t("asset.qrCodeAlt", { asset: entry.asset.asset_no }))}">
      <div class="asset-qr-print-copy">
        <strong>${escapeHtml(entry.asset.asset_no || `#${entry.asset.id}`)}</strong>
        <span>${escapeHtml(modelLabel(entry.asset))}</span>
        <small>${escapeHtml(serialLabel(entry.asset))}</small>
      </div>
    </article>`).join("");
  printWindow.document.write(`<!doctype html>
    <html lang="${escapeHtml(document.documentElement.lang || "zh-CN")}">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(t("asset.qrCodeTitle"))}</title>
        <style>
          * { box-sizing: border-box; }
          @page { margin: 8mm; }
          body { margin: 0; padding: 8mm; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          .asset-qr-print-sheet { display: grid; grid-template-columns: repeat(2, ${labelWidth}); gap: 5mm; align-items: start; }
          .asset-qr-print-label { display: flex; align-items: center; gap: 3mm; width: ${labelWidth}; height: ${labelHeight}; padding: 3mm; border: 0.3mm solid #dcdfe6; border-radius: 1mm; break-inside: avoid; page-break-inside: avoid; overflow: hidden; }
          .asset-qr-print-label img { flex: 0 0 ${qrSize}; width: ${qrSize}; height: ${qrSize}; image-rendering: pixelated; }
          .asset-qr-print-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1mm; overflow: hidden; }
          .asset-qr-print-copy strong, .asset-qr-print-copy span, .asset-qr-print-copy small { overflow-wrap: anywhere; word-break: break-word; line-height: 1.2; }
          .asset-qr-print-copy strong { font-size: ${isSmall ? "9pt" : "11pt"}; }
          .asset-qr-print-copy span { font-size: ${isSmall ? "7pt" : "9pt"}; }
          .asset-qr-print-copy small { color: #606266; font-size: ${isSmall ? "6pt" : "7pt"}; }
          @media print { body { padding: 0; } .asset-qr-print-sheet { gap: 4mm; } }
        </style>
      </head>
      <body><main class="asset-qr-print-sheet">${labels}</main></body>
    </html>`);
  printWindow.document.close();
  await nextTick();
  printWindow.focus();
  printWindow.print();
  printWindow.close();
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="asset-qr-dialog"
    width="min(720px, 92vw)"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="asset-qr-dialog__heading">
        <el-icon aria-hidden="true"><Grid /></el-icon>
        <div>
          <strong>{{ t('asset.qrCodeTitle') }}</strong>
          <span>{{ t('asset.qrCodeDescription') }}</span>
        </div>
      </div>
    </template>

    <div v-loading="loading" class="asset-qr-dialog__body">
      <el-alert v-if="error" :title="t('asset.qrCodeGenerateFailed')" :description="error" type="error" show-icon :closable="false" />
      <div v-if="entries.length" class="asset-qr-dialog__options">
        <span>{{ t('asset.labelSize') }}</span>
        <el-select v-model="labelSize" size="small" :aria-label="t('asset.labelSize')" style="width: 150px">
          <el-option :label="t('asset.smallLabel')" value="small" />
          <el-option :label="t('asset.mediumLabel')" value="medium" />
        </el-select>
      </div>
      <div v-if="entries.length" class="asset-qr-sheet" :class="[`asset-qr-sheet--${labelSize}`, { 'asset-qr-sheet--single': entries.length === 1 }]">
        <article v-for="entry in entries" :key="entry.asset.id" class="asset-qr-label">
          <img class="asset-qr-label__image" :src="entry.image" :alt="t('asset.qrCodeAlt', { asset: entry.asset.asset_no })" />
          <div class="asset-qr-label__copy">
            <strong>{{ entry.asset.asset_no || `#${entry.asset.id}` }}</strong>
            <span :title="modelLabel(entry.asset)">{{ modelLabel(entry.asset) }}</span>
            <small :title="serialLabel(entry.asset)">{{ serialLabel(entry.asset) }}</small>
          </div>
          <el-button v-if="entries.length === 1" text type="primary" :icon="Download" :aria-label="t('asset.downloadQr')" @click="downloadEntry(entry)">
            {{ t('asset.downloadQr') }}
          </el-button>
        </article>
      </div>
      <el-empty v-else-if="!error" :description="t('asset.noQrAssets')" :image-size="64" />
    </div>

    <template #footer>
      <el-button @click="close">{{ t('common.close') }}</el-button>
      <el-button type="primary" :icon="Printer" :disabled="!entries.length || loading" @click="printEntries">
        {{ t('asset.printLabels') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.asset-qr-dialog__heading {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.asset-qr-dialog__heading > .el-icon {
  color: var(--el-color-primary);
  font-size: 20px;
  margin-top: 2px;
}

.asset-qr-dialog__heading > div {
  display: grid;
  gap: 4px;
}

.asset-qr-dialog__heading strong {
  color: var(--el-text-color-primary);
  font-size: 16px;
  line-height: 1.4;
}

.asset-qr-dialog__heading span {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.asset-qr-dialog__body {
  min-height: 220px;
}

.asset-qr-dialog__options {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.asset-qr-sheet {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.asset-qr-sheet--single {
  grid-template-columns: minmax(0, 1fr);
}

.asset-qr-label {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-blank);
}

.asset-qr-sheet--single .asset-qr-label {
  grid-template-columns: 180px minmax(0, 1fr) auto;
  padding: 16px;
}

.asset-qr-label__image {
  display: block;
  width: 112px;
  height: 112px;
  image-rendering: pixelated;
}

.asset-qr-sheet--single .asset-qr-label__image {
  width: 180px;
  height: 180px;
}

.asset-qr-label__copy {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.asset-qr-label__copy strong,
.asset-qr-label__copy span,
.asset-qr-label__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-qr-label__copy strong {
  color: var(--el-text-color-primary);
  font-size: 16px;
}

.asset-qr-label__copy span {
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.asset-qr-label__copy small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.asset-qr-sheet--small .asset-qr-label {
  grid-template-columns: 80px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
}

.asset-qr-sheet--small .asset-qr-label__image {
  width: 80px;
  height: 80px;
}

.asset-qr-sheet--medium .asset-qr-label__image {
  width: 112px;
  height: 112px;
}

@media (max-width: 680px) {
  .asset-qr-sheet,
  .asset-qr-sheet--single {
    grid-template-columns: minmax(0, 1fr);
  }

  .asset-qr-label,
  .asset-qr-sheet--single .asset-qr-label {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .asset-qr-sheet--small .asset-qr-label {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .asset-qr-label__image,
  .asset-qr-sheet--single .asset-qr-label__image {
    width: 96px;
    height: 96px;
  }

  .asset-qr-sheet--small .asset-qr-label__image {
    width: 72px;
    height: 72px;
  }

  .asset-qr-label .el-button {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
