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
 * The client owns request cancellation and the monotonically increasing load
 * token, while App.vue remains responsible for deciding which page to load.
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
    try {
      return await apiRequest<T>(
        path,
        {
          ...options,
          signal: signal || options.signal || activeLoadController?.signal,
        },
        () => csrfToken.value,
        loadCsrf,
        () => {
          authenticated.value = false;
        },
        retryCsrf,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return undefined as T;
      if (error instanceof Error && error.name === "AbortError")
        return undefined as T;
      throw error;
    }
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
