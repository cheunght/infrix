<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import { pendingJob } from "../jobs";
import { ApiError, isAbortError } from "../api";
import { formatSystemDateTime } from "../system-settings";
const props = defineProps<{ context: SettingsContext; dirty: boolean }>();
const { t } = useI18n();
type DigestStatus = {
  date: string;
  latest_job: {
    id: string;
    status: string;
    created_at: string;
    finished_at: string | null;
    error_code: string;
    result: { status?: string; sent?: number; failed?: number };
  } | null;
  deliveries: Record<string, number>;
};
const status = ref<DigestStatus | null>(null);
const error = ref("");
const sending = ref(false);
const loading = ref(false);
const pending = computed(
  () =>
    Object.values(props.context.jobs.records.value).some(
      (job) => job.kind === "notification_digest" && pendingJob(job),
    ) ||
    (status.value?.latest_job &&
      ["queued", "running"].includes(status.value.latest_job.status)),
);
const resultLabels: Record<string, string> = {
  complete: "digestComplete",
  failed: "digestPartialFailure",
  disabled: "digestDisabled",
  unconfigured: "digestUnconfigured",
  empty: "digestEmpty",
};
let cooldown = 0;
let version = 0;
let controller: AbortController | null = null;
async function load() {
  if (!props.context.can("settings.manage") || Date.now() < cooldown) return;
  const current = ++version;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = "";
  try {
    const data = await props.context.request<DigestStatus>(
      "/system/notification-digest/status/",
      { signal: controller.signal },
    );
    if (current === version) status.value = data;
  } catch (cause) {
    if (current === version && !isAbortError(cause))
      error.value = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof ApiError && cause.status === 503)
      cooldown = Date.now() + Math.max(10000, cause.retryAfterMs);
  } finally {
    if (current === version) loading.value = false;
  }
}
async function send() {
  if (props.dirty || sending.value || pending.value) return;
  sending.value = true;
  error.value = "";
  const current = version;
  try {
    await props.context.jobs.submit("notification_digest", {});
    if (current === version) await load();
  } catch (cause) {
    if (current === version && !isAbortError(cause))
      error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (current === version || !controller?.signal.aborted)
      sending.value = false;
  }
}
const stop = props.context.jobs.onCompleted((job) => {
  if (job.kind === "notification_digest") void load();
});
const timer = setInterval(() => {
  if (!document.hidden && pending.value && !loading.value) void load();
}, 10000);
onMounted(load);
onBeforeUnmount(() => {
  ++version;
  controller?.abort();
  clearInterval(timer);
  stop();
});
</script>
<template>
  <section v-if="context.can('settings.manage')" class="digest-status">
    <div class="digest-status__actions">
      <el-button
        type="primary"
        :loading="sending"
        :disabled="dirty || sending || pending || loading || !!error"
        @click="send"
        >{{ t("jobs.sendToday") }}</el-button
      ><el-button :loading="loading" @click="load">{{
        t("common.refresh")
      }}</el-button>
    </div>
    <p v-if="dirty">{{ t("jobs.saveBeforeSend") }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="status">
      <p>
        {{ t("jobs.latestDigest") }}：<template v-if="status.latest_job"
          >{{ formatSystemDateTime(status.latest_job.created_at)
          }}<template v-if="status.latest_job.finished_at">
            →
            {{ formatSystemDateTime(status.latest_job.finished_at) }}</template
          >
          · {{ t(`jobs.status.${status.latest_job.status}`)
          }}<template v-if="status.latest_job.result.status">
            ·
            {{
              t(
                `jobs.${resultLabels[status.latest_job.result.status] || "digestUnknown"}`,
              )
            }}</template
          ><template v-if="status.latest_job.error_code">
            · {{ t(`jobs.errors.${status.latest_job.error_code}`) }}</template
          ></template
        ><template v-else>{{ t("jobs.empty") }}</template>
      </p>
      <div class="digest-status__counts">
        <strong>{{ t("jobs.todayDelivery") }} · {{ status.date }}</strong
        ><span v-for="(count, state) in status.deliveries" :key="state"
          >{{ t(`operations.${state}`) }} {{ count }}</span
        >
      </div>
    </template>
    <p>{{ t("jobs.digestNote") }}</p>
  </section>
</template>
<style scoped>
.digest-status {
  display: grid;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}
.digest-status p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.digest-status__actions,
.digest-status__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
</style>
