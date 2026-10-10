import { ref, type Ref } from "vue";
import { announceJob, exportJobs, importJobs, type QueuedJob } from "../jobs";
import {
  apiBase,
  apiRequest,
  createRequestCoordinator,
  downloadFile as downloadBlob,
} from "../api";

export interface ApiClientOptions {
  csrfToken: Ref<string>;
  authenticated: Ref<boolean>;
}

/**
 * Shared authenticated API plumbing for all page composables.
 *
 * The client owns read-request cancellation and the monotonically increasing
 * load token, while App.vue remains responsible for deciding which page to load.
 */
export function useApiClient({ csrfToken, authenticated }: ApiClientOptions) {
  const loadVersion = ref(0);
  let activeLoadController: AbortController | null = null;
  const loadRequests = createRequestCoordinator();
  const pendingExports = new Map<string, string>();
  let pendingImports = new WeakMap<File, Map<string, string>>();

  function beginLoad() {
    activeLoadController?.abort();
    activeLoadController = loadRequests.next("page");
    loadVersion.value += 1;
    return loadVersion.value;
  }

  function isCurrentLoad(version: number) {
    return version === loadVersion.value;
  }

  async function loadCsrf(signal?: AbortSignal) {
    const response = await fetch(`${apiBase}/auth/csrf/`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) {
      throw new Error(`CSRF bootstrap failed with status ${response.status}`);
    }
    const data = await response.json() as { csrfToken?: unknown };
    if (typeof data.csrfToken !== "string" || !data.csrfToken) {
      throw new Error("CSRF bootstrap did not return a token");
    }
    csrfToken.value = data.csrfToken;
  }

  async function request<T>(
    path: string,
    options: RequestInit = {},
    retryCsrf = true,
    signal?: AbortSignal,
  ): Promise<T> {
    const method = (options.method || "GET").toUpperCase();
    const importKind = importJobs[path];
    if (method === "POST" && importKind && options.body instanceof FormData) {
      const file = options.body.get("file");
      if (file instanceof File) {
        let keys = pendingImports.get(file);
        if (!keys) { keys = new Map(); pendingImports.set(file, keys); }
        let key = keys.get(importKind);
        if (!key) { key = crypto.randomUUID(); keys.set(importKind, key); }
        const body = new FormData();
        body.append("kind", importKind);
        body.append("file", file);
        const headers = new Headers(options.headers);
        headers.set("Idempotency-Key", key);
        const result = await request<QueuedJob>("/jobs/", {...options, body, headers}, retryCsrf, signal);
        announceJob(result.job);
        return result as T;
      }
    }
    // Route changes may cancel page reads; mutation cancellation must be explicit.
    const inheritedLoadSignal = method === "GET" || method === "HEAD"
      ? activeLoadController?.signal
      : undefined;
    return apiRequest<T>(
      path,
      {
        ...options,
        signal: signal || options.signal || inheritedLoadSignal,
      },
      () => csrfToken.value,
      loadCsrf,
      () => {
        authenticated.value = false;
      },
      retryCsrf,
    );
  }

  async function download(path: string, filename?: string) {
    const url = new URL(path, window.location.origin);
    const task = url.pathname.match(/^\/inventory-tasks\/(\d+)\/export\/$/);
    const kind = exportJobs[url.pathname] || (task ? "inventory_export" : "");
    if (kind) {
      const params = Object.fromEntries(url.searchParams.entries());
      if (task) params.task_id = task[1]!;
      const body = JSON.stringify({kind, params});
      let key = pendingExports.get(body);
      if (!key) { key = crypto.randomUUID(); pendingExports.set(body, key); }
      const result = await request<QueuedJob>("/jobs/", {method: "POST", body, headers: {"Content-Type": "application/json", "Idempotency-Key": key}});
      pendingExports.delete(body);
      announceJob(result.job);
      return;
    }
    await downloadBlob(path, {
      filename,
      onUnauthorized: () => {
        authenticated.value = false;
      },
    });
  }

  function dispose() {
    activeLoadController?.abort();
    loadRequests.cancelAll();
    pendingExports.clear();
    pendingImports = new WeakMap();
  }

  return {
    api: apiBase,
    loadVersion,
    beginLoad,
    isCurrentLoad,
    loadCsrf,
    request,
    download,
    dispose,
  };
}
