import { i18n } from "./i18n";

export const apiBase = import.meta.env.VITE_API_BASE || "/api/v1";

export type PageResult<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export function pageItems<T>(payload: PageResult<T> | T[] | null | undefined): T[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : payload.results;
}

export function pageTotal<T>(payload: PageResult<T> | T[] | null | undefined): number {
  if (!payload) return 0;
  return Array.isArray(payload) ? payload.length : payload.count;
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  asset_no: "asset.code",
  name: "common.name",
  manufacturer: "asset.manufacturer",
  device_type: "common.deviceType",
  serial_number: "asset.serialNumber",
  configuration: "common.details",
  room: "common.room",
  rack: "rack.rackCode",
  occurred_at: "repair.occurredAt",
  finished_at: "overlay.repairFinishedAt",
  used_count: "license.usedCount",
  authorized_count: "license.authorizedCount",
  data_center: "common.dataCenter",
  server_room: "common.room",
  start_at: "inventory.startTime",
  end_at: "inventory.endTime",
  actual_rack: "inventory.actualRack",
  actual_start_u: "inventory.actualStartU",
  actual_end_u: "inventory.actualEndU",
  status: "common.status",
  notes: "common.notes",
};

const tr = (key: string): string => String(i18n.global.t(key));

export function flattenError(value: unknown): string {
  if (Array.isArray(value))
    return value.map(flattenError).filter(Boolean).join("；");
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${FIELD_LABEL_KEYS[key] ? tr(FIELD_LABEL_KEYS[key]) : key}：${flattenError(item)}`)
      .join("；");
  return String(value ?? "");
}

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError",
  );
}

export type DownloadOptions = RequestInit & {
  filename?: string;
  onUnauthorized?: () => void;
};

/** Remove list-only controls before an export request is sent. */
export function buildExportQuery(params: URLSearchParams): string {
  const exportParams = new URLSearchParams(params);
  exportParams.delete("page");
  exportParams.delete("page_size");
  exportParams.delete("compact");
  exportParams.delete("custom_columns");
  return exportParams.toString();
}

/** Download an authenticated file without navigating away from the SPA. */
export async function downloadFile(path: string, options: DownloadOptions = {}): Promise<void> {
  const { filename, onUnauthorized, ...requestOptions } = options;
  const response = await fetch(`${apiBase}${path}`, {
    ...requestOptions,
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.();
    const text = await response.text();
    let details: unknown = text;
    let message = statusMessage(response.status);
    try {
      const payload = JSON.parse(text);
      details = payload;
      message = flattenError(payload.detail ?? payload) || message;
    } catch {
      // Never expose raw HTML error pages to users.
    }
    throw new ApiError(response.status, message, details);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename(?!\*)="?([^";]+)"?/i)?.[1];
  let serverFilename = plainName;
  if (encodedName) {
    try {
      serverFilename = decodeURIComponent(encodedName);
    } catch {
      // Fall back to the ASCII filename when a malformed header is returned.
    }
  }
  const resolvedName = serverFilename || filename || "download";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = resolvedName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function createRequestCoordinator() {
  const controllers = new Map<string, AbortController>();
  return {
    next(key: string) {
      controllers.get(key)?.abort();
      const controller = new AbortController();
      controllers.set(key, controller);
      return controller;
    },
    cancel(key: string) {
      controllers.get(key)?.abort();
      controllers.delete(key);
    },
    cancelAll() {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    },
  };
}

function statusMessage(status: number): string {
  if (status === 400) return tr("api.invalidRequest");
  if (status === 401) return tr("api.sessionExpired");
  if (status === 403) return tr("api.forbidden");
  if (status === 404) return tr("api.resourceNotFound");
  if (status >= 500) return tr("api.serverError").replace("{status}", String(status));
  return tr("api.requestFailed").replace("{status}", String(status));
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit,
  getCsrfToken: () => string,
  refreshCsrf: () => Promise<void>,
  onUnauthorized: () => void,
  retryCsrf = true,
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const csrfToken = getCsrfToken();
  if (options.method && options.method !== "GET" && csrfToken)
    headers.set("X-CSRFToken", csrfToken);
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 403 && retryCsrf) {
    const text = await response.text();
    if (text.includes("CSRF")) {
      await refreshCsrf();
      return apiRequest(
        path,
        options,
        getCsrfToken,
        refreshCsrf,
        onUnauthorized,
        false,
      );
    }
    throw new ApiError(403, statusMessage(403), text);
  }
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    const text = await response.text();
    let details: unknown = text;
    let message = statusMessage(response.status);
    try {
      const payload = JSON.parse(text);
      details = payload;
      message = flattenError(payload.detail ?? payload) || message;
    } catch {
      // HTML error pages and empty responses are deliberately not shown to users.
    }
    throw new ApiError(response.status, message, details);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
