import { onScopeDispose, ref } from 'vue';
import { isAbortError } from '../api';
import { announceJob, type BackgroundJob, type QueuedJob } from '../jobs';
import type { RequestFn } from '../page-context';

export function useJobs(request: RequestFn) {
  const jobs = ref<BackgroundJob[]>([]);
  const count = ref(0);
  const offset = ref(0);
  const loading = ref(false);
  const error = ref('');
  const pending = ref('');
  let version = 0;
  let accountVersion = 0;
  let digestKey: string | null = null;
  let controller: AbortController | null = null;
  async function load() {
    const current = ++version;
    controller?.abort(); controller = new AbortController();
    loading.value = true; error.value = '';
    try {
      const data = await request<{count:number; results:BackgroundJob[]}>(`/jobs/?offset=${offset.value}`, {signal:controller.signal});
      if (current !== version) return;
      jobs.value = data.results; count.value = data.count;
    } catch (failure) {
      if (current === version && !isAbortError(failure)) error.value = failure instanceof Error ? failure.message : String(failure);
    } finally { if (current === version) loading.value = false; }
  }
  async function act(job: BackgroundJob, action: 'cancel' | 'retry') {
    if (pending.value) return;
    const account = accountVersion;
    pending.value = job.id; error.value = '';
    try { await request(`/jobs/${job.id}/${action}/`, {method:'POST'}); if (account === accountVersion) await load(); }
    catch (failure) { if (account === accountVersion) error.value = failure instanceof Error ? failure.message : String(failure); }
    finally { if (account === accountVersion) pending.value = ''; }
  }
  async function digest() {
    if (pending.value) return;
    const account = accountVersion;
    digestKey ||= crypto.randomUUID();
    pending.value = 'digest'; error.value = '';
    try {
      const result = await request<QueuedJob>('/jobs/', {method:'POST', body:JSON.stringify({kind:'notification_digest', params:{}}), headers:{'Content-Type':'application/json','Idempotency-Key':digestKey}});
      if (account !== accountVersion) return;
      digestKey = null;
      announceJob(result.job); await load();
    } catch (failure) { if (account === accountVersion) error.value = failure instanceof Error ? failure.message : String(failure); }
    finally { if (account === accountVersion) pending.value = ''; }
  }
  function clear() { ++accountVersion; ++version; controller?.abort(); jobs.value = []; offset.value = 0; count.value = 0; error.value = ''; loading.value = false; pending.value = ''; digestKey = null; }
  onScopeDispose(clear);
  return {jobs, count, offset, loading, error, pending, load, act, digest, clear};
}
