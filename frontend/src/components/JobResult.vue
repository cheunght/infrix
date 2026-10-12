<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { flattenError, isAbortError } from "../api";
import { JobTasksKey, type JobTasks } from "../composables/useJobTasks";
import { pendingJob } from "../jobs";
import { formatSystemDateTime } from "../system-settings";
const props = defineProps<{
  jobId: string;
  tasks?: JobTasks;
  compact?: boolean;
}>();
const emit = defineEmits<{ created: [id: string] }>();
const tasks = props.tasks || inject(JobTasksKey)!;
const { t } = useI18n();
const job = computed(() => tasks.records.value[props.jobId]);
const error = ref("");
const busy = ref(false);
const counts = computed(() =>
  Object.entries(job.value?.result || {}).filter(
    ([key, value]) =>
      ["created", "updated", "unchanged", "total"].includes(key) &&
      typeof value === "number",
  ),
);
const validation = computed(() => {
  const result = job.value?.result || {};
  if (Array.isArray(result.errors))
    return result.errors.map((item) => ({
      line: String(item.line || ""),
      message: flattenError(item.detail || item.errors || item),
    }));
  if (!result.detail) return [];
  const detail = result.detail as Record<string, unknown>;
  const preview = detail.preview as
    | { rows?: { line: number; valid?: boolean; errors?: unknown }[] }
    | undefined;
  const errors = preview?.rows
    ?.filter(
      (row) => row.valid === false || (row.errors && flattenError(row.errors)),
    )
    .map((row) => ({
      line: String(row.line),
      message: flattenError(row.errors),
    }));
  return errors?.length
    ? errors
    : [{ line: "", message: flattenError(result.detail) }];
});
async function regenerate() {
  if (!job.value?.params) return;
  const created = await tasks.submit(job.value.kind, job.value.params);
  emit("created", created.id);
}
const filterLabels: Record<string, string> = {
  search: "common.search",
  data_center: "common.dataCenter",
  server_room: "common.room",
  room: "common.room",
  room__data_center: "common.dataCenter",
  task_id: "inventory.title",
  status: "common.status",
  manufacturer: "asset.manufacturer",
  part: "spare.title",
  operation_type: "common.type",
  resource_type: "settings.resource",
  action: "settings.action",
  start: "jobs.startedAt",
  end: "jobs.finishedAt",
};
async function perform(action: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await action();
  } catch (cause) {
    if (!isAbortError(cause))
      error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
watch(
  () => props.jobId,
  async (id) => {
    error.value = "";
    if (!tasks.records.value[id]) await perform(() => tasks.detail(id));
  },
  { immediate: true },
);
function downloadErrors() {
  const cell = (value: string) =>
    `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
  const content =
    "\uFEFF" +
    [
      [t("common.line"), t("common.errorDetails")],
      ...validation.value.map((row) => [row.line, row.message]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}
</script>
<template>
  <section class="job-result" aria-live="polite">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="job">
      <div v-if="!compact" class="job-result__heading">
        <strong>{{ t(`jobs.kinds.${job.kind}`) }}</strong
        ><span>{{ t(`jobs.status.${job.status}`) }}</span>
      </div>
      <p v-if="!compact" class="job-result__meta">
        {{ formatSystemDateTime(job.created_at)
        }}<template v-if="job.attempts">
          · {{ t("jobs.attempts", { count: job.attempts }) }}</template
        >
      </p>
      <p v-if="pendingJob(job)">{{ t("jobs.continues") }}</p>
      <p v-if="job.error_code" class="job-result__error">
        {{ t(`jobs.errors.${job.error_code}`) }}
      </p>
      <p v-if="job.result_unavailable_reason">
        {{ t(`jobs.errors.${job.result_unavailable_reason}`) }}
      </p>
      <p v-if="!compact && job.params && Object.keys(job.params).length">
        {{ t("jobs.filterSummary") }}：<template
          v-for="(value, key) in job.params"
          :key="key"
          ><span v-if="key !== 'locale'"
            >{{
              filterLabels[key] ? t(filterLabels[key]!) : t("jobs.otherFilter")
            }}
            {{ value }} ·
          </span></template
        >
      </p>
      <p v-if="job.result_unavailable_reason === 'job_authorization_changed'">
        {{ t("jobs.noParams") }}
      </p>
      <div v-if="counts.length" class="job-result__counts">
        <span v-for="[key, value] in counts" :key="key"
          >{{ t(`jobs.counts.${key}`) }} {{ value }}</span
        >
      </div>
      <div v-if="!compact && validation.length" class="job-result__validation">
        <p v-for="(row, index) in validation" :key="index">
          <strong v-if="row.line"
            >{{ t("overlay.importErrorLine", { line: row.line }) }} </strong
          >{{ row.message }}
        </p>
      </div>
      <div class="job-result__actions">
        <el-button
          v-if="job.result_available"
          type="primary"
          :loading="busy"
          @click="perform(() => tasks.download(job!))"
          >{{ t("jobs.download") }}</el-button
        >
        <el-button
          v-if="job.status === 'queued'"
          :disabled="busy || tasks.busyIds.value.has(job.id)"
          @click="perform(() => tasks.act(job!, 'cancel'))"
          >{{ t("common.cancel") }}</el-button
        >
        <el-button
          v-if="job.status === 'failed'"
          :disabled="busy || tasks.busyIds.value.has(job.id)"
          @click="perform(() => tasks.act(job!, 'retry'))"
          >{{ t("common.retry") }}</el-button
        >
        <el-button
          v-if="
            job.status === 'succeeded' &&
            job.kind.endsWith('_export') &&
            !job.result_available &&
            job.params
          "
          :loading="busy"
          @click="perform(regenerate)"
          >{{ t("jobs.regenerateAction") }}</el-button
        >
        <el-button v-if="validation.length" @click="downloadErrors">{{
          t("asset.downloadImportErrors")
        }}</el-button>
      </div>
    </template>
  </section>
</template>
<style scoped>
.job-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px 0;
}
.job-result__heading,
.job-result__counts,
.job-result__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.job-result p {
  margin: 0;
  overflow-wrap: anywhere;
}
.job-result__meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.job-result__error {
  color: var(--el-color-danger);
}
.job-result__validation {
  max-height: 260px;
  overflow: auto;
  background: var(--el-fill-color-light);
  padding: 12px;
}
</style>
