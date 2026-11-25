<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ImportPreview } from "../composables/useAssets";
import type { ImportReviewGroup, ImportReviewRow } from "../import-review";
import ImportReviewTable from "./ImportReviewTable.vue";
const props = defineProps<{ preview: ImportPreview; disabled?: boolean }>();
const emit = defineEmits<{ copyErrors: []; downloadErrors: [] }>();
const { t } = useI18n();
const groups = computed<ImportReviewGroup[]>(() => [
  { value: "create", label: t("asset.importReviewReady") },
  { value: "conflict", label: t("asset.importReviewConflicts") },
  { value: "error", label: t("asset.importReviewErrors") },
]);
const rows = computed<ImportReviewRow[]>(() => props.preview.rows.map(row => ({
  ...row,
  identity: row.asset_no,
  operation: row.valid ? "create" : row.action === "conflict" ? "conflict" : "error",
  fields: [
    { label: t("asset.code"), value: row.asset_no || "—" },
    { label: t("asset.name"), value: row.name || "—" },
    { label: t("asset.deviceType"), value: row.device_type || "—" },
    { label: t("common.location"), value: row.location || "—" },
    ...(row.depreciation ? [{ label: t("asset.depreciation"), value: row.depreciation }] : []),
  ],
})));
</script>
<template>
  <ImportReviewTable :source="preview" :rows="rows" :groups="groups" :identity-label="t('asset.code')" :name-label="t('asset.name')" :search-label="t('asset.importReviewSearch')" :disabled="disabled" @copy-errors="emit('copyErrors')" @download-errors="emit('downloadErrors')" />
</template>
