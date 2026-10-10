<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useJobs } from '../composables/useJobs';
import type { CapabilityFn, RequestFn } from '../page-context';
import type { BackgroundJob } from '../jobs';
import { formatSystemDateTime } from '../system-settings';
const props = defineProps<{ request:RequestFn; download:(path:string,filename?:string)=>Promise<void>; username:string; can:CapabilityFn }>();
const {t} = useI18n();
const visible = ref(false);
const {jobs, count, offset, loading, error, pending, load, act, digest, clear} = useJobs(props.request);
let timer: ReturnType<typeof setInterval> | undefined;
function created() { if (visible.value) void load(); else visible.value = true; }
async function download(job:BackgroundJob) {
  try { await props.download(`/jobs/${job.id}/result/`); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure); }
}
function move(step:number) { offset.value = Math.max(0, offset.value + step); void load(); }
watch(visible, (opened) => { if (opened) void load(); });
watch(() => props.username, () => { visible.value = false; clear(); });
onMounted(() => {
  window.addEventListener('infrix-job-created', created);
  timer = setInterval(() => { if (visible.value && !loading.value && jobs.value.some(job => ['queued','running'].includes(job.status))) void load(); }, 10000);
});
onBeforeUnmount(() => { window.removeEventListener('infrix-job-created', created); clearInterval(timer); });
</script>
<template>
  <el-button text @click="visible = true">{{ t('jobs.title') }}</el-button>
  <el-drawer v-model="visible" :title="t('jobs.title')" size="min(760px, 100vw)">
    <p>{{ t('jobs.explanation') }}</p>
    <div class="jobs-actions">
      <el-button :loading="loading" @click="load">{{ t('common.refresh') }}</el-button>
      <el-button v-if="can('settings.manage')" :disabled="!!pending" @click="digest">{{ t('jobs.digest') }}</el-button>
    </div>
    <el-alert v-if="error" type="error" :title="error" :closable="false" />
    <p v-if="!jobs.length && !loading">{{ t('jobs.empty') }}</p>
    <article v-for="job in jobs" :key="job.id" class="job-entry">
      <strong>{{ t(`jobs.kinds.${job.kind}`) }}</strong>
      <p>{{ t(`jobs.status.${job.status}`) }} · {{ job.progress }}% · {{ t('jobs.attempts', {count:job.attempts}) }}</p>
      <p>{{ formatSystemDateTime(job.created_at) }} · {{ job.id }}</p>
      <p v-if="job.error_code">{{ t(`jobs.errors.${job.error_code}`) }}</p>
      <pre v-if="Object.keys(job.result).length">{{ JSON.stringify(job.result, null, 2) }}</pre>
      <el-button v-if="job.result_available" @click="download(job)">{{ t('jobs.download') }}</el-button>
      <el-button v-if="job.status === 'queued'" :disabled="!!pending" @click="act(job, 'cancel')">{{ t('common.cancel') }}</el-button>
      <el-button v-if="job.status === 'failed'" :disabled="!!pending" @click="act(job, 'retry')">{{ t('common.retry') }}</el-button>
      <p v-if="job.status === 'succeeded' && job.kind.endsWith('_export') && !job.result_available">{{ t('jobs.regenerate') }}</p>
    </article>
    <div class="jobs-actions">
      <el-button :disabled="offset === 0 || loading" @click="move(-30)">{{ t('jobs.previous') }}</el-button>
      <span>{{ Math.min(offset + 30, count) }} / {{ count }}</span>
      <el-button :disabled="offset + 30 >= count || loading" @click="move(30)">{{ t('jobs.next') }}</el-button>
    </div>
  </el-drawer>
</template>
<style scoped>
.jobs-actions { display:flex; align-items:center; gap:12px; margin:16px 0; }
.job-entry { padding:16px 0; border-bottom:1px solid var(--el-border-color); }
.job-entry p { overflow-wrap:anywhere; color:var(--el-text-color-secondary); }
.job-entry pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:240px; overflow:auto; padding:12px; background:var(--el-fill-color-light); }
</style>
