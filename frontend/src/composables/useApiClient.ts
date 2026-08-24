import { ref, type Ref } from "vue";
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

  function beginLoad() {
    activeLoadController?.abort();
    activeLoadController = loadRequests.next("page");
    loadVersion.value += 1;
    return loadVersion.value;
  }

  function isCurrentLoad(version: number) {
    return version === loadVersion.value;
  }

  async function loadCsrf() {
    const response = await fetch(`${apiBase}/auth/csrf/`, {
      credentials: "include",
    });
    const data = await response.json();
    csrfToken.value = data.csrfToken;
  }

  async function request<T>(
    path: string,
    options: RequestInit = {},
    retryCsrf = true,
    signal?: AbortSignal,
  ): Promise<T> {
    const method = (options.method || "GET").toUpperCase();
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
