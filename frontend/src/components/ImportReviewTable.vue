<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CopyDocument, Download } from "@element-plus/icons-vue";
import { importReviewValue, type ImportReviewGroup, type ImportReviewOperation, type ImportReviewRow } from "../import-review";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{
  source: object;
  rows: ImportReviewRow[];
  groups: ImportReviewGroup[];
  identityLabel: string;
  nameLabel: string;
  searchLabel: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ copyErrors: []; downloadErrors: [] }>();
const { t } = useI18n();
type ReviewGroup = "all" | ImportReviewOperation;
const group = ref<ReviewGroup>("all");
const keyword = ref("");
const line = ref("");
const page = ref(1);
const pageSize = ref(20);
const expandedLines = ref<number[]>([]);

const counts = computed(() => {
  const result = { all: props.rows.length, create: 0, update: 0, unchanged: 0, conflict: 0, error: 0 };
  for (const row of props.rows) result[row.operation] += 1;
  return result;
});
const groups = computed(() => [{ value: "all" as const, label: t("asset.importReviewAll") }, ...props.groups]
  .map(item => ({ ...item, label: `${item.label} (${counts.value[item.value]})` })));
const invalid = computed(() => counts.value.conflict + counts.value.error);
const invalidLine = computed(() => Boolean(line.value.trim() && !/^[1-9]\d*$/.test(line.value.trim())));
const matchedRows = computed(() => {
  const search = keyword.value.trim().toLocaleLowerCase();
  const fileLine = line.value.trim();
  return props.rows.filter(row => {
    if (group.value !== "all" && row.operation !== group.value) return false;
    if (fileLine && (invalidLine.value || row.line !== Number(fileLine))) return false;
    if (!search) return true;
    return [row.identity, row.name, ...row.fields.map(field => field.value),
      ...row.changes.flatMap(change => [change.label, importReviewValue(change.old_value), importReviewValue(change.new_value)]),
      ...row.errors.flatMap(error => [error.label, error.message]),
    ].some(value => String(value || "").toLocaleLowerCase().includes(search));
  });
});
const pageRows = computed(() => matchedRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

watch(() => props.source, () => {
  group.value = "all";
  keyword.value = "";
  line.value = "";
  page.value = 1;
  expandedLines.value = [];
});
watch([group, keyword, line, pageSize], () => { page.value = 1; expandedLines.value = []; });
watch(page, () => { expandedLines.value = []; });

function rowLabel(row: ImportReviewRow) {
  return props.groups.find(item => item.value === row.operation)?.label || t("asset.importReviewErrors");
}
function rowErrors(row: ImportReviewRow) {
  return row.errors.map(error => `${error.label ? `${error.label}: ` : ""}${error.message}`).join("; ");
}
function clearSearch() { keyword.value = ""; line.value = ""; }
function expandRow(_row: ImportReviewRow, expanded: ImportReviewRow[]) {
  expandedLines.value = expanded.map(row => row.line);
}
</script>

<template>
  <section class="asset-import-review" :aria-label="t('asset.importReviewTitle')">
    <div class="asset-import-review__groups">
      <el-radio-group v-model="group" :disabled="disabled" :aria-label="t('asset.importReviewGroup')" size="small">
        <el-radio-button v-for="item in groups" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
      </el-radio-group>
      <span class="asset-import-review__scope">{{ t('asset.importReviewBatch', { count: rows.length }) }}</span>
    </div>
    <div class="asset-import-review__tools">
      <SearchField v-model="keyword" :disabled="disabled" :placeholder="searchLabel" :aria-label="searchLabel" />
      <el-input v-model="line" class="asset-import-review__line" inputmode="numeric" clearable :disabled="disabled" :placeholder="t('asset.importReviewLine')" :aria-label="t('asset.importReviewLine')" />
      <el-button v-if="keyword || line" link :disabled="disabled" @click="clearSearch">{{ t('asset.importReviewClearSearch') }}</el-button>
    </div>
    <p v-if="invalidLine" class="asset-import-review__line-error" role="alert">{{ t('asset.importReviewInvalidLine') }}</p>
    <div v-if="invalid" class="asset-import-review__reports">
      <span>{{ t('asset.importReviewBlocked', { count: invalid }) }}</span>
      <div>
        <el-button size="small" :icon="CopyDocument" :disabled="disabled" @click="emit('copyErrors')">{{ t('asset.importReviewCopyErrors') }}</el-button>
        <el-button size="small" :icon="Download" :disabled="disabled" @click="emit('downloadErrors')">{{ t('asset.importReviewDownloadErrors') }}</el-button>
      </div>
    </div>
    <PagedTable v-model:current-page="page" v-model:page-size="pageSize" :total="matchedRows.length" :disabled="disabled">
      <el-table class="asset-import-review__table" :data="pageRows" border stripe max-height="clamp(160px, calc(82vh - 500px), 320px)" row-key="line" :expand-row-keys="expandedLines" :empty-text="t('overlay.importNoMatchingRows')" @expand-change="expandRow">
        <el-table-column type="expand" width="44">
          <template #default="{ row }">
            <div class="asset-import-review__detail">
              <strong>{{ t('asset.importReviewRowDetails', { line: row.line }) }}</strong>
              <dl class="asset-import-review__fields">
                <div v-for="(field, index) in row.fields" :key="index"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div>
              </dl>
              <table v-if="row.changes.length" class="asset-import-review__changes">
                <caption>{{ t('asset.importReviewChanges') }}</caption>
                <thead><tr><th scope="col">{{ t('common.field') }}</th><th scope="col">{{ t('asset.importReviewBefore') }}</th><th scope="col">{{ t('asset.importReviewAfter') }}</th></tr></thead>
                <tbody><tr v-for="change in row.changes" :key="change.field"><th scope="row">{{ change.label }}</th><td>{{ importReviewValue(change.old_value) }}</td><td>{{ importReviewValue(change.new_value) }}</td></tr></tbody>
              </table>
              <p v-else-if="row.changedFields?.length">{{ t('asset.importReviewChangedFields') }}: {{ row.changedFields.join(', ') }}</p>
              <ul v-if="row.errors.length" class="asset-import-review__errors">
                <li v-for="(error, index) in row.errors" :key="index"><strong v-if="error.label">{{ error.label }}: </strong>{{ error.message }}</li>
              </ul>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="line" :label="t('asset.importReviewLineHeader')" width="88" />
        <el-table-column prop="identity" :label="identityLabel" min-width="135" show-overflow-tooltip />
        <el-table-column prop="name" :label="nameLabel" min-width="160" show-overflow-tooltip />
        <el-table-column :label="t('overlay.validationResult')" width="112">
          <template #default="{ row }"><StatusTag :tone="row.operation === 'error' ? 'danger' : ['conflict', 'update'].includes(row.operation) ? 'warning' : row.operation === 'unchanged' ? 'info' : 'success'" :label="rowLabel(row)" /></template>
        </el-table-column>
        <el-table-column :label="t('overlay.errorDetails')" min-width="210">
          <template #default="{ row }"><span class="asset-import-review__error-summary">{{ rowErrors(row) || '—' }}</span></template>
        </el-table-column>
      </el-table>
    </PagedTable>
  </section>
</template>

<style scoped>
.asset-import-review { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.asset-import-review__groups, .asset-import-review__tools, .asset-import-review__reports { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; }
.asset-import-review__groups :deep(.el-radio-group) { flex-wrap: wrap; gap: 4px 0; }
.asset-import-review__groups :deep(.el-radio-button__inner) { white-space: nowrap; }
.asset-import-review__scope { margin-left: auto; color: var(--el-text-color-secondary); font-size: 12px; }
.asset-import-review__tools > .infrix-search-field { flex: 1 1 260px; min-width: 160px; }
.asset-import-review__tools > .asset-import-review__line { flex: 0 1 150px; width: 150px; }
.asset-import-review__line-error { margin: 0; color: var(--el-color-danger); font-size: 12px; }
.asset-import-review__table { width: 100%; }
.asset-import-review :deep(.el-pagination) { flex-wrap: wrap; gap: 8px 0; max-width: 100%; justify-content: flex-end; }
.asset-import-review :deep(.el-pagination__sizes .el-select) { width: 128px; min-width: 128px; }
.asset-import-review__error-summary { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.asset-import-review__detail { padding: 12px 18px; white-space: normal; overflow-wrap: anywhere; background: var(--el-fill-color-lighter); }
.asset-import-review__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; margin: 12px 0 0; }
.asset-import-review__fields > div { display: flex; gap: 8px; min-width: 0; }
.asset-import-review__fields dt { flex-shrink: 0; color: var(--el-text-color-secondary); }
.asset-import-review__fields dd { margin: 0; min-width: 0; }
.asset-import-review__changes { width: 100%; margin-top: 12px; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
.asset-import-review__changes caption { text-align: left; font-weight: 600; margin-bottom: 8px; }
.asset-import-review__changes th, .asset-import-review__changes td { text-align: left; padding: 6px 8px; border: 1px solid var(--el-border-color-lighter); white-space: pre-wrap; overflow-wrap: anywhere; }
.asset-import-review__changes th { width: 28%; font-weight: 500; }
.asset-import-review__errors { margin: 12px 0 0; padding-left: 18px; color: var(--el-color-danger); }
.asset-import-review__reports { justify-content: space-between; color: var(--el-color-warning-dark-2); font-size: 13px; }
.asset-import-review__reports > div { display: flex; flex-wrap: wrap; gap: 8px; }
.asset-import-review__reports :deep(.el-button + .el-button) { margin-left: 0; }
@media (max-width: 640px) {
  .asset-import-review__scope { margin-left: 0; }
  .asset-import-review__fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
