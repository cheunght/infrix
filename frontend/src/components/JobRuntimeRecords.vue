<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { SystemMaintenanceDependencies } from "../page-context";
import {
  exportJobs,
  importJobs,
  jobLocation,
  type BackgroundJob,
} from "../jobs";
import { isAbortError, ApiError } from "../api";
import { formatSystemDateTime } from "../system-settings";
const props = defineProps<{ context: SystemMaintenanceDependencies }>();
const { t } = useI18n();
const router = useRouter();
type RuntimeJob = Pick<
  BackgroundJob,
  | "id"
  | "kind"
  | "status"
  | "created_at"
  | "started_at"
  | "finished_at"
  | "attempts"
  | "error_code"
> & { submitter: string | null };
const rows = ref<RuntimeJob[]>([]);
const count = ref(0);
const offset = ref(0);
const kind = ref("");
const state = ref("");
const busy = ref(false);
const error = ref("");
const kinds = [
  ...Object.values(importJobs),
  ...Object.values(exportJobs),
  "inventory_export",
  "notification_digest",
];
function kindLabel(value: string | undefined) {
  return value && kinds.includes(value)
    ? t(`jobs.kinds.${value}`)
    : t("common.unknown");
}
function stateLabel(value: string | undefined) {
  return value &&
    ["queued", "running", "succeeded", "failed", "cancelled"].includes(value)
    ? t(`jobs.status.${value}`)
    : t("common.unknown");
}
let version = 0;
let controller: AbortController | null = null;
let cooldown = 0;
async function load() {
  if (Date.now() < cooldown) return;
  const current = ++version;
  controller?.abort();
  controller = new AbortController();
  busy.value = true;
  error.value = "";
  const params = new URLSearchParams({ offset: String(offset.value) });
  if (kind.value) params.set("kind", kind.value);
  if (state.value) params.set("status", state.value);
  try {
    const page = await props.context.request<{
      count: number;
      results: RuntimeJob[];
    }>(`/system/jobs/?${params}`, { signal: controller.signal });
    if (current === version) {
      rows.value = page.results;
      count.value = page.count;
    }
  } catch (cause) {
    if (current === version && !isAbortError(cause)) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof ApiError && cause.status === 503)
        cooldown = Date.now() + Math.max(10000, cause.retryAfterMs);
    }
  } finally {
    if (current === version) busy.value = false;
  }
}
function filter() {
  offset.value = 0;
  void load();
}
function move(step: number) {
  offset.value = Math.max(0, offset.value + step);
  void load();
}
async function ownResult(job: RuntimeJob) {
  try {
    const own = await props.context.jobs.detail(job.id);
    await router.push(jobLocation(own));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
const timer = setInterval(() => {
  if (
    !document.hidden &&
    !busy.value &&
    rows.value.some((job) => ["queued", "running"].includes(job.status))
  )
    void load();
}, 10000);
onMounted(load);
onBeforeUnmount(() => {
  ++version;
  controller?.abort();
  clearInterval(timer);
});
</script>
<template>
  <section class="runtime-jobs">
    <div class="runtime-jobs__filters">
      <el-select
        v-model="kind"
        :placeholder="t('jobs.all')"
        clearable
        :aria-label="t('jobs.kind')"
        @change="filter"
        ><el-option
          v-for="value in kinds"
          :key="value"
          :value="value"
          :label="kindLabel(value)"
      /></el-select>
      <el-select
        v-model="state"
        :placeholder="t('jobs.all')"
        clearable
        :aria-label="t('common.status')"
        @change="filter"
        ><el-option
          v-for="value in [
            'queued',
            'running',
            'succeeded',
            'failed',
            'cancelled',
          ]"
          :key="value"
          :value="value"
          :label="stateLabel(value)"
      /></el-select>
      <el-button :loading="busy" @click="load">{{
        t("common.refresh")
      }}</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-table :data="rows" v-loading="busy" :empty-text="t('jobs.empty')">
      <el-table-column :label="t('jobs.kind')" min-width="140"
        ><template #default="{ row }">{{
          kindLabel(row.kind)
        }}</template></el-table-column
      >
      <el-table-column :label="t('jobs.submitter')" min-width="120"
        ><template #default="{ row }">{{
          row.submitter || t("jobs.scheduler")
        }}</template></el-table-column
      >
      <el-table-column :label="t('common.status')" min-width="100"
        ><template #default="{ row }">{{
          stateLabel(row.status)
        }}</template></el-table-column
      >
      <el-table-column :label="t('jobs.submittedAt')" min-width="180"
        ><template #default="{ row }">{{
          formatSystemDateTime(row.created_at)
        }}</template></el-table-column
      >
      <el-table-column :label="t('jobs.startedAt')" min-width="180"
        ><template #default="{ row }">{{
          row.started_at ? formatSystemDateTime(row.started_at) : "—"
        }}</template></el-table-column
      >
      <el-table-column :label="t('jobs.finishedAt')" min-width="180"
        ><template #default="{ row }">{{
          row.finished_at ? formatSystemDateTime(row.finished_at) : "—"
        }}</template></el-table-column
      >
      <el-table-column
        prop="attempts"
        :label="t('operations.attempts')"
        width="90"
      />
      <el-table-column :label="t('operations.failureReason')" min-width="180"
        ><template #default="{ row }">{{
          row.error_code ? t(`jobs.errors.${row.error_code}`) : "—"
        }}</template></el-table-column
      >
      <el-table-column :label="t('jobs.actions')" width="120"
        ><template #default="{ row }"
          ><el-button
            v-if="row.submitter === context.jobs.account.value"
            text
            @click="ownResult(row)"
            >{{ t("common.view") }}</el-button
          ></template
        ></el-table-column
      >
    </el-table>
    <div class="runtime-jobs__filters">
      <el-button :disabled="!offset || busy" @click="move(-30)">{{
        t("jobs.previous")
      }}</el-button
      ><span>{{ Math.min(offset + 30, count) }} / {{ count }}</span
      ><el-button :disabled="offset + 30 >= count || busy" @click="move(30)">{{
        t("jobs.next")
      }}</el-button>
    </div>
  </section>
</template>
<style scoped>
.runtime-jobs {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.runtime-jobs__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.runtime-jobs__filters .el-select {
  width: 240px;
  max-width: 100%;
}
</style>
