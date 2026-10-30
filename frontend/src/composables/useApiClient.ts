import { ref, type Ref } from "vue";
import {
  ApiError,
  apiBase,
  apiRequest,
  createRequestCoordinator,
  downloadFile as downloadBlob,
} from "../api";

export interface ApiClientOptions {
  csrfToken: Ref<string>;
  authenticated: Ref<boolean>;
  passwordChangeRequired?: Ref<boolean>;
}

/**
 * Shared authenticated API plumbing for all page composables.
 *
 * The client owns read-request cancellation and the monotonically increasing
 * load token, while AppSession.vue remains responsible for deciding which page to load.
 */
export function useApiClient({
  csrfToken,
  authenticated,
  passwordChangeRequired,
}: ApiClientOptions) {
  const loadVersion = ref(0);
  let activeLoadController: AbortController | null = null;
  const loadRequests = createRequestCoordinator();
  let disposed = false;

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
    if (disposed) throw new DOMException("Session ended", "AbortError");
    const response = await fetch(`${apiBase}/auth/csrf/`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) {
      throw new Error(`CSRF bootstrap failed with status ${response.status}`);
    }
    const data = (await response.json()) as { csrfToken?: unknown };
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
    if (disposed) throw new DOMException("Session ended", "AbortError");
    const method = (options.method || "GET").toUpperCase();
    // Route changes may cancel page reads; mutation cancellation must be explicit.
    const inheritedLoadSignal =
      method === "GET" || method === "HEAD"
        ? activeLoadController?.signal
        : undefined;
    try {
      return await apiRequest<T>(
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
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        error.details &&
        typeof error.details === "object" &&
        "code" in error.details &&
        error.details.code === "password_change_required" &&
        passwordChangeRequired
      )
        passwordChangeRequired.value = true;
      throw error;
    }
  }

  async function download(
    path: string,
    filename?: string,
    options: RequestInit = {},
  ) {
    if (disposed) throw new DOMException("Session ended", "AbortError");
    await downloadBlob(path, {
      ...options,
      filename,
      onUnauthorized: () => {
        authenticated.value = false;
      },
    });
  }

  function dispose() {
    disposed = true;
    loadVersion.value += 1;
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
