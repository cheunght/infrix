<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { JobTasks } from "../composables/useJobTasks";
import { pendingJob } from "../jobs";
import { isAbortError } from "../api";
import JobResult from "./JobResult.vue";
const props = defineProps<{
  tasks: JobTasks;
  kinds: string[];
  taskId?: number | null;
}>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const expanded = ref(false);
const offset = ref(0);
const count = ref(0);
const ids = ref<string[]>([]);
const loading = ref(false);
const error = ref("");
const selected = ref("");
let version = 0;
const matches = (job: { kind: string; task_id?: string | number | null }) =>
  props.kinds.includes(job.kind) &&
  (!props.taskId || Number(job.task_id) === props.taskId);
const active = computed(() =>
  Object.values(props.tasks.records.value).filter(
    (job) => matches(job) && pendingJob(job),
  ),
);
const latest = computed(
  () =>
    Object.values(props.tasks.records.value)
      .filter(matches)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
);
async function load() {
  const current = ++version;
  loading.value = true;
  error.value = "";
  try {
    const page = await props.tasks.list({
      kind: props.kinds.join(","),
      task_id: props.taskId || undefined,
      offset: offset.value,
    });
    if (current !== version) return;
    count.value = page.count;
    ids.value = page.results.map((job) => job.id);
  } catch (cause) {
    if (current === version && !isAbortError(cause))
      error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (current === version) loading.value = false;
  }
}
watch(
  () => [props.kinds.join(","), props.taskId, props.tasks.account.value],
  () => {
    ++version;
    offset.value = 0;
    ids.value = [];
    selected.value = "";
    void load();
  },
  { immediate: true },
);
watch(
  () => route.query.job,
  async (value) => {
    if (typeof value !== "string") return;
    const current = version;
    try {
      const job = await props.tasks.detail(value);
      if (current !== version) return;
      if (!matches(job)) {
        error.value = t("jobs.wrongPage");
        return;
      }
      selected.value = job.id;
      expanded.value = true;
      props.tasks.markRead(job);
    } catch (cause) {
      if (current === version && !isAbortError(cause))
        error.value = t("jobs.linkUnavailable");
    }
  },
  { immediate: true },
);
function select(id: string) {
  expanded.value = true;
  selected.value = id;
  const job = props.tasks.records.value[id];
  if (job) props.tasks.markRead(job);
}
function move(step: number) {
  offset.value = Math.max(0, offset.value + step);
  void load();
}
async function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) await load();
}
function closeDetail() {
  selected.value = "";
  if (route.query.job) {
    const query = { ...route.query };
    delete query.job;
    void router.replace({ path: route.path, query });
  }
}
</script>
<template>
  <section class="business-jobs">
    <div class="business-jobs__toolbar">
      <span v-if="active.length">{{
        t("jobs.pendingCount", { count: active.length })
      }}</span>
      <span v-else-if="latest"
        >{{ t(`jobs.kinds.${latest.kind}`) }} ·
        {{ t(`jobs.status.${latest.status}`) }}</span
      >
      <el-button text @click="toggle">{{
        kinds.some((kind) => kind.endsWith("_import"))
          ? t("jobs.importExportHistory")
          : t("jobs.exportHistory")
      }}</el-button>
    </div>
    <el-alert
      v-if="error || tasks.error.value"
      :title="error || tasks.error.value"
      type="warning"
      :closable="false"
    />
    <JobResult
      v-if="latest && !expanded"
      compact
      :tasks="tasks"
      :job-id="latest.id"
      @created="select"
    />
    <template v-if="expanded">
      <div class="business-jobs__toolbar">
        <el-button :loading="loading" @click="load">{{
          t("common.refresh")
        }}</el-button
        ><el-button v-if="selected" text @click="closeDetail">{{
          t("common.close")
        }}</el-button>
      </div>
      <JobResult
        v-if="selected"
        :tasks="tasks"
        :job-id="selected"
        @created="select"
      />
      <template v-else
        ><JobResult
          v-for="id in ids"
          :key="id"
          :tasks="tasks"
          :job-id="id"
          @created="select"
        />
        <p v-if="!ids.length && !loading">{{ t("jobs.empty") }}</p></template
      >
      <div class="business-jobs__toolbar">
        <el-button :disabled="!offset || loading" @click="move(-30)">{{
          t("jobs.previous")
        }}</el-button
        ><span>{{ Math.min(offset + 30, count) }} / {{ count }}</span
        ><el-button
          :disabled="offset + 30 >= count || loading"
          @click="move(30)"
          >{{ t("jobs.next") }}</el-button
        >
      </div>
    </template>
  </section>
</template>
<style scoped>
.business-jobs {
  margin-bottom: 16px;
  padding: 10px 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  min-width: 0;
}
.business-jobs__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
