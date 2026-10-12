<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { SettingsContext } from "../page-context";
import { ApiError, isAbortError } from "../api";
const props = defineProps<{ context: SettingsContext; dirty: boolean }>();
const { t } = useI18n();
type DigestResult = { status: string; sent: number; failed: number };
type DigestStatus = { date: string; deliveries: Record<string, number> };
const status = ref<DigestStatus | null>(null);
const result = ref<DigestResult | null>(null);
const error = ref("");
const sending = ref(false);
const loading = ref(false);
const resultLabels: Record<string, string> = {
  complete: "digestComplete",
  failed: "digestPartialFailure",
  disabled: "digestDisabled",
  unconfigured: "digestUnconfigured",
  empty: "digestEmpty",
  suppressed: "digestSuppressed",
};
let cooldown = 0;
let version = 0;
let controller: AbortController | null = null;
async function load() {
  if (
    !props.context.can("settings.manage") ||
    loading.value ||
    Date.now() < cooldown
  )
    return;
  const current = version;
  controller = new AbortController();
  loading.value = true;
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
  if (props.dirty || sending.value || loading.value || Date.now() < cooldown)
    return;
  sending.value = true;
  error.value = "";
  result.value = null;
  const current = version;
  const sendController = new AbortController();
  controller = sendController;
  try {
    const data = await props.context.request<DigestResult>(
      "/system/notification-digest/send/",
      { method: "POST", signal: sendController.signal },
    );
    if (current !== version) return;
    result.value = data;
    await load();
  } catch (cause) {
    if (current === version && !isAbortError(cause))
      error.value = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof ApiError && cause.status === 503)
      cooldown = Date.now() + Math.max(10000, cause.retryAfterMs);
  } finally {
    if (current === version) sending.value = false;
  }
}
onMounted(load);
onBeforeUnmount(() => {
  ++version;
  controller?.abort();
});
</script>
<template>
  <section v-if="context.can('settings.manage')" class="digest-status">
    <div class="digest-status__actions">
      <el-button
        type="primary"
        :loading="sending"
        :disabled="dirty || sending || loading"
        @click="send"
        >{{ t("notificationDigest.sendToday") }}</el-button
      >
      <el-button
        :loading="loading"
        :disabled="sending || loading"
        @click="
          error = '';
          load();
        "
        >{{ t("common.refresh") }}</el-button
      >
    </div>
    <p v-if="dirty">{{ t("notificationDigest.saveBeforeSend") }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <p v-if="result">
      {{
        t(
          `notificationDigest.${resultLabels[result.status] || "digestUnknown"}`,
        )
      }}
      · {{ t("operations.sent") }} {{ result.sent }} ·
      {{ t("operations.failed") }} {{ result.failed }}
    </p>
    <div v-if="status" class="digest-status__counts">
      <strong
        >{{ t("notificationDigest.todayDelivery") }} · {{ status.date }}</strong
      >
      <span v-for="(count, state) in status.deliveries" :key="state"
        >{{ t(`operations.${state}`) }} {{ count }}</span
      >
    </div>
    <p>{{ t("notificationDigest.digestNote") }}</p>
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
