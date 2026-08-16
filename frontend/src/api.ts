export const apiBase = import.meta.env.VITE_API_BASE || "/api/v1";

export type PageResult<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export function pageItems<T>(payload: PageResult<T> | T[]): T[] {
  return Array.isArray(payload) ? payload : payload.results;
}

export function pageTotal<T>(payload: PageResult<T> | T[]): number {
  return Array.isArray(payload) ? payload.length : payload.count;
}

const FIELD_LABELS: Record<string, string> = {
  asset_no: "资产编号",
  name: "名称",
  asset_type: "设备类型",
  category: "设备分类",
  brand: "品牌",
  device_type: "设备类型",
  serial_number: "序列号",
  configuration: "关联信息",
  room: "机房",
  rack: "机柜",
  occurred_at: "故障发生时间",
  finished_at: "维修完成时间",
  used_count: "已用数",
  authorized_count: "授权数",
  data_center: "数据中心",
  server_room: "机房",
  start_at: "开始时间",
  end_at: "结束时间",
  actual_rack: "实际机柜",
  actual_start_u: "实际起始 U",
  actual_end_u: "实际结束 U",
  status: "状态",
  notes: "备注",
};

export function flattenError(value: unknown): string {
  if (Array.isArray(value))
    return value.map(flattenError).filter(Boolean).join("；");
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${FIELD_LABELS[key] || key}：${flattenError(item)}`)
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

function statusMessage(status: number): string {
  if (status === 400) return "请求数据不完整或格式不正确";
  if (status === 401) return "登录已失效，请重新登录";
  if (status === 403) return "当前账号没有执行此操作的权限";
  if (status === 404) return "请求的资源不存在或已被删除";
  if (status >= 500) return `服务端内部错误（${status}），请联系管理员查看日志`;
  return `请求失败（${status}）`;
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
