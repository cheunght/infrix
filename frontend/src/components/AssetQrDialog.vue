<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Download, Grid, Printer } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import QRCode from "qrcode";
import type { Asset } from "../types";
import { assetLocationLabel, buildAssetQrValue } from "../asset-qr";
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
let generation = 0;

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
  const labels = entries.value.map((entry) => `
    <article class="asset-qr-print-label">
      <img src="${entry.image}" alt="${escapeHtml(t("asset.qrCodeAlt", { asset: entry.asset.asset_no }))}">
      <div class="asset-qr-print-copy">
        <strong>${escapeHtml(entry.asset.asset_no || `#${entry.asset.id}`)}</strong>
        <span>${escapeHtml(entry.asset.name || t("asset.unlisted"))}</span>
        <small>${escapeHtml(assetLocationLabel(entry.asset))}</small>
      </div>
    </article>`).join("");
  printWindow.document.write(`<!doctype html>
    <html lang="${escapeHtml(document.documentElement.lang || "zh-CN")}">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(t("asset.qrCodeTitle"))}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; padding: 24px; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          .asset-qr-print-sheet { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
          .asset-qr-print-label { display: flex; align-items: center; gap: 16px; min-height: 160px; padding: 16px; border: 1px solid #dcdfe6; border-radius: 4px; break-inside: avoid; }
          .asset-qr-print-label img { width: 132px; height: 132px; image-rendering: pixelated; }
          .asset-qr-print-copy { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
          .asset-qr-print-copy strong { font-size: 18px; }
          .asset-qr-print-copy span { font-size: 14px; }
          .asset-qr-print-copy small { color: #606266; line-height: 1.5; overflow-wrap: anywhere; }
          @media print { body { padding: 0; } .asset-qr-print-sheet { gap: 10mm; } }
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
      <div v-else-if="entries.length" class="asset-qr-sheet" :class="{ 'asset-qr-sheet--single': entries.length === 1 }">
        <article v-for="entry in entries" :key="entry.asset.id" class="asset-qr-label">
          <img class="asset-qr-label__image" :src="entry.image" :alt="t('asset.qrCodeAlt', { asset: entry.asset.asset_no })" />
          <div class="asset-qr-label__copy">
            <strong>{{ entry.asset.asset_no || `#${entry.asset.id}` }}</strong>
            <span :title="entry.asset.name || t('asset.unlisted')">{{ entry.asset.name || t('asset.unlisted') }}</span>
            <small :title="assetLocationLabel(entry.asset)">{{ assetLocationLabel(entry.asset) }}</small>
          </div>
          <el-button v-if="entries.length === 1" text type="primary" :icon="Download" :aria-label="t('asset.downloadQr')" @click="downloadEntry(entry)">
            {{ t('asset.downloadQr') }}
          </el-button>
        </article>
      </div>
      <el-empty v-else :description="t('asset.noQrAssets')" :image-size="64" />
    </div>

    <template #footer>
      <el-button @click="close">{{ t('common.close') }}</el-button>
      <el-button type="primary" :icon="Printer" :disabled="!entries.length || loading" @click="printEntries">
        {{ t('asset.printQr') }}
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

@media (max-width: 680px) {
  .asset-qr-sheet,
  .asset-qr-sheet--single {
    grid-template-columns: minmax(0, 1fr);
  }

  .asset-qr-label,
  .asset-qr-sheet--single .asset-qr-label {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .asset-qr-label__image,
  .asset-qr-sheet--single .asset-qr-label__image {
    width: 96px;
    height: 96px;
  }

  .asset-qr-label .el-button {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
