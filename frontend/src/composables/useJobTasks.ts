import {
  computed,
  onScopeDispose,
  ref,
  watch,
  type InjectionKey,
  type Ref,
} from "vue";
import { ApiError, isAbortError } from "../api";
import {
  exportJobs,
  jobAttemptKey,
  pendingJob,
  type BackgroundJob,
  type QueuedJob,
} from "../jobs";
import type { RequestFn } from "../page-context";

export type JobPage = { count: number; results: BackgroundJob[] };
export type JobFilter = {
  kind?: string;
  status?: string;
  task_id?: string | number;
  offset?: number;
};
export const JobTasksKey: InjectionKey<JobTasks> = Symbol("job-tasks");

export function useJobTasks(options: {
  request: RequestFn;
  download: (
    path: string,
    filename?: string,
    options?: RequestInit,
  ) => Promise<void>;
  account: Ref<string>;
  enabled: Ref<boolean>;
}) {
  const records = ref<Record<string, BackgroundJob>>({});
  const error = ref("");
  const readIds = ref(new Set<string>());
  const busyIds = ref(new Set<string>());
  const recent = computed(() =>
    Object.values(records.value)
      .filter((job) => !pendingJob(job))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 30),
  );
  const unread = computed(
    () =>
      recent.value.filter((job) => !readIds.value.has(jobAttemptKey(job)))
        .length,
  );
  let generation = 0;
  let restored = false;
  let refreshPromise: Promise<void> | null = null;
  let cooldown = 0;
  let imports = new WeakMap<File, Map<string, string>>();
  const submissionKeys = new Map<string, string>();
  const inflight = new Map<string, Promise<BackgroundJob>>();
  const controllers = new Set<AbortController>();
  const epochs = new Map<string, number>();
  const listeners = new Set<(job: BackgroundJob) => void>();
  const storageKey = () => `infrix.jobs.read.${options.account.value}`;
  const alive = (version: number) =>
    version === generation && options.enabled.value && !!options.account.value;

  function remember(job: BackgroundJob, version = generation) {
    if (!alive(version)) return;
    const previous = records.value[job.id];
    records.value = { ...records.value, [job.id]: job };
    if (previous && pendingJob(previous) && !pendingJob(job))
      listeners.forEach((listener) => listener(job));
  }
  async function read<T>(path: string): Promise<T> {
    if (!options.enabled.value) throw new Error("Session unavailable");
    if (Date.now() < cooldown) throw new ApiError(503, error.value);
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await options.request<T>(path, { signal: controller.signal });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 503) {
        cooldown = Date.now() + Math.max(10000, failure.retryAfterMs || 0);
        error.value = failure.message;
      }
      throw failure;
    } finally {
      controllers.delete(controller);
    }
  }
  async function list(filter: JobFilter = {}): Promise<JobPage> {
    const version = generation;
    const snapshot = new Map(epochs);
    const params = new URLSearchParams();
    Object.entries(filter).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    const page = await read<JobPage>(`/jobs/?${params}`);
    if (!alive(version))
      throw new DOMException("Account changed", "AbortError");
    page.results.forEach((job) => {
      if ((snapshot.get(job.id) || 0) === (epochs.get(job.id) || 0))
        remember(job, version);
    });
    return page;
  }
  function detail(id: string): Promise<BackgroundJob> {
    const existing = inflight.get(id);
    if (existing) return existing;
    const version = generation;
    const epoch = epochs.get(id) || 0;
    const promise = read<BackgroundJob>(
      `/jobs/${encodeURIComponent(id)}/`,
    ).then((job) => {
      if (!alive(version))
        throw new DOMException("Account changed", "AbortError");
      if (epoch === (epochs.get(id) || 0)) remember(job, version);
      return records.value[id] || job;
    });
    inflight.set(id, promise);
    void promise
      .finally(() => {
        if (inflight.get(id) === promise) inflight.delete(id);
      })
      .catch(() => {});
    return promise;
  }
  function refresh(): Promise<void> {
    if (refreshPromise) return refreshPromise;
    const version = generation;
    const promise = (async () => {
      try {
        await list({ status: "succeeded,failed,cancelled" });
        let offset = 0;
        while (alive(version)) {
          const page = await list({ status: "queued,running", offset });
          if (offset + 30 >= page.count) break;
          offset += 30;
        }
        if (alive(version)) {
          restored = true;
          error.value = "";
        }
      } catch (failure) {
        if (alive(version) && !isAbortError(failure))
          error.value =
            failure instanceof Error ? failure.message : String(failure);
      }
    })();
    refreshPromise = promise;
    void promise.finally(() => {
      if (refreshPromise === promise) refreshPromise = null;
    });
    return promise;
  }
  async function poll() {
    if (!options.enabled.value || document.hidden || Date.now() < cooldown)
      return;
    if (!restored) {
      await refresh();
      return;
    }
    const version = generation;
    const results = await Promise.allSettled(
      Object.values(records.value)
        .filter(pendingJob)
        .map((job) => detail(job.id)),
    );
    if (!alive(version)) return;
    const failed = results.find(
      (result) => result.status === "rejected" && !isAbortError(result.reason),
    );
    error.value =
      failed?.status === "rejected"
        ? String(
            failed.reason instanceof Error
              ? failed.reason.message
              : failed.reason,
          )
        : "";
  }
  async function submit(
    kind: string,
    params: Record<string, string | number | boolean>,
    file?: File,
  ): Promise<BackgroundJob> {
    const version = generation;
    const identity = JSON.stringify({ kind, params });
    let key: string;
    if (file) {
      let keys = imports.get(file);
      if (!keys) {
        keys = new Map();
        imports.set(file, keys);
      }
      key = keys.get(kind) || crypto.randomUUID();
      keys.set(kind, key);
    } else {
      key = submissionKeys.get(identity) || crypto.randomUUID();
      submissionKeys.set(identity, key);
    }
    const headers = new Headers({ "Idempotency-Key": key });
    let body: BodyInit;
    if (file) {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      body = form;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify({ kind, params });
    }
    const response = await options.request<QueuedJob>("/jobs/", {
      method: "POST",
      headers,
      body,
    });
    if (!alive(version))
      throw new DOMException("Account changed", "AbortError");
    if (!file) submissionKeys.delete(identity);
    remember(response.job, version);
    return response.job;
  }
  function submitImport(kind: string, file: File) {
    return submit(kind, {}, file);
  }
  function submitExport(path: string, _filename?: string) {
    const url = new URL(path, window.location.origin);
    const task = url.pathname.match(/^\/inventory-tasks\/(\d+)\/export\/$/);
    const kind = exportJobs[url.pathname] || (task ? "inventory_export" : "");
    if (!kind) throw new Error("Unsupported export");
    const params: Record<string, string | number | boolean> =
      Object.fromEntries(url.searchParams);
    if (task) params.task_id = task[1]!;
    return submit(kind, params);
  }
  async function act(job: BackgroundJob, action: "cancel" | "retry") {
    if (busyIds.value.has(job.id)) return;
    const version = generation;
    busyIds.value = new Set([...busyIds.value, job.id]);
    try {
      epochs.set(job.id, (epochs.get(job.id) || 0) + 1);
      const updated = await options.request<BackgroundJob>(
        `/jobs/${job.id}/${action}/`,
        { method: "POST" },
      );
      remember(updated, version);
    } finally {
      if (alive(version)) {
        const next = new Set(busyIds.value);
        next.delete(job.id);
        busyIds.value = next;
      }
    }
  }
  async function download(job: BackgroundJob) {
    if (!job.result_available) throw new Error("Result unavailable");
    const version = generation;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      await options.download(`/jobs/${job.id}/result/`, undefined, {
        signal: controller.signal,
      });
    } catch (failure) {
      if (alive(version)) await detail(job.id).catch(() => {});
      throw failure;
    } finally {
      controllers.delete(controller);
    }
  }
  function markRead(job: BackgroundJob) {
    readIds.value = new Set([...readIds.value, jobAttemptKey(job)]);
    try {
      localStorage.setItem(
        storageKey(),
        JSON.stringify([...readIds.value].slice(-200)),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  function onCompleted(callback: (job: BackgroundJob) => void) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }
  function clear() {
    ++generation;
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    epochs.clear();
    inflight.clear();
    refreshPromise = null;
    imports = new WeakMap();
    submissionKeys.clear();
    records.value = {};
    readIds.value = new Set();
    busyIds.value = new Set();
    error.value = "";
    cooldown = 0;
    restored = false;
  }
  watch(
    [options.account, options.enabled],
    () => {
      clear();
      if (options.enabled.value && options.account.value) {
        try {
          const saved: unknown = JSON.parse(
            localStorage.getItem(storageKey()) || "[]",
          );
          if (Array.isArray(saved))
            readIds.value = new Set(
              saved
                .filter((id): id is string => typeof id === "string")
                .slice(-200),
            );
        } catch {
          /* Storage is optional. */
        }
        void refresh();
      }
    },
    { immediate: true, flush: "sync" },
  );
  const visible = () => {
    if (!document.hidden) void poll();
  };
  document.addEventListener("visibilitychange", visible);
  const timer = setInterval(() => void poll(), 10000);
  onScopeDispose(() => {
    clear();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visible);
    listeners.clear();
  });
  return {
    account: options.account,
    records,
    recent,
    unread,
    readIds,
    busyIds,
    error,
    list,
    detail,
    refresh,
    poll,
    submit,
    submitImport,
    submitExport,
    act,
    download,
    markRead,
    onCompleted,
    clear,
  };
}
export type JobTasks = ReturnType<typeof useJobTasks>;
