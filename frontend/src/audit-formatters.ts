import type { AuditLog } from "./types";
import { depreciationMethodLabel, formatResidualRate } from "./depreciation";
import {
  ASSET_STATUS_LABEL_MAP,
  businessOptionLabel,
  INVENTORY_ITEM_STATUS_LABEL_MAP,
  INVENTORY_RESOLUTION_ACTION_OPTIONS,
  INVENTORY_RESOLUTION_STATUS_OPTIONS,
  INVENTORY_TASK_STATUS_LABEL_MAP,
  LICENSE_STATUS_LABEL_MAP,
  RACK_STATUS_LABEL_MAP,
  STOCK_OPERATION_OPTIONS,
} from "./business-enums";

type AuditRecord = Record<string, unknown>;

export type AuditChange = {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
  beforeText: string;
  afterText: string;
  summary?: string;
};

export type AuditField = {
  key: string;
  label: string;
  value: unknown;
  valueText: string;
};

export type AuditMetadata = {
  label: string;
  value: string;
};

export type AuditDetail = {
  resourceLabel: string;
  actionLabel: string;
  objectLabel: string;
  summary: string;
  changeTitle: string;
  changes: AuditChange[];
  fields: AuditField[];
  metadata: AuditMetadata[];
  rawPayload: AuditRecord;
};

const RESOURCE_LABELS: Record<string, string> = {
  asset: "资产",
  manufacturer: "厂商",
  device_type: "设备类型",
  data_center: "数据中心",
  server_room: "机房",
  rack: "机柜",
  custom_field: "自定义字段",
  custom_field_option: "字段选项",
  tag: "标签",
  fault_event: "故障",
  repair_record: "维修记录",
  software_license: "软件许可",
  spare_part: "备件",
  spare_part_category: "备件类型",
  spare_stock_transaction: "库存流水",
  inventory_task: "盘点任务",
  inventory_item: "盘点项目",
  user: "用户",
  auth_login: "登录",
};

const ACTION_LABELS: Record<string, string> = {
  create: "新增",
  update: "修改",
  delete: "删除",
  complete: "完成",
  close: "关闭",
  reopen: "重新打开",
  resolve: "处理",
  login_success: "登录成功",
  login_failure: "登录失败",
  login_locked: "账号锁定",
};

export const auditResourceOptions = Object.entries(RESOURCE_LABELS).map(([value, label]) => ({ label, value }));
export const auditActionOptions = Object.entries(ACTION_LABELS).map(([value, label]) => ({ label, value }));

const FIELD_LABELS: Record<string, string> = {
  id: "编号",
  asset_no: "资产编号",
  asset_name: "资产名称",
  name: "名称",
  code: "编码",
  username: "用户名",
  display_name: "显示名称",
  first_name: "名",
  last_name: "姓",
  email: "邮箱",
  status: "状态",
  status_before_repair: "维修前状态",
  is_active: "状态",
  is_closed: "是否关闭",
  device_type: "设备类型",
  device_type_name: "设备类型",
  manufacturer: "厂商",
  manufacturer_name: "厂商",
  model: "型号",
  specification: "规格",
  unit: "计量单位",
  safety_stock: "安全库存",
  storage_location: "存放位置",
  total_quantity: "库存数量",
  is_low_stock: "低库存",
  model_name: "型号",
  manufacturer_model: "厂商/型号",
  serial_number: "序列号",
  purpose: "用途",
  department: "部门",
  department_name: "部门",
  owner: "使用人",
  owner_name: "使用人",
  data_center: "数据中心",
  data_center_name: "数据中心",
  asset_data_center: "数据中心",
  asset_data_center_name: "数据中心",
  server_room: "机房",
  server_room_name: "机房",
  rack: "机柜",
  rack_code: "机柜",
  rack_allocation: "位置",
  location: "位置",
  start_u: "起始 U",
  end_u: "结束 U",
  rack_start_u: "起始 U",
  rack_end_u: "结束 U",
  actual_data_center: "实际数据中心",
  actual_data_center_name: "实际数据中心",
  actual_server_room: "实际机房",
  actual_server_room_name: "实际机房",
  actual_rack: "实际机柜",
  actual_rack_code: "实际机柜",
  actual_start_u: "实际起始 U",
  actual_end_u: "实际结束 U",
  system_data_center: "系统数据中心",
  system_data_center_name: "系统数据中心",
  system_server_room: "系统机房",
  system_server_room_name: "系统机房",
  system_rack: "系统机柜",
  system_rack_code: "系统机柜",
  system_start_u: "系统起始 U",
  system_end_u: "系统结束 U",
  provider: "维修厂商",
  started_at: "开始时间",
  finished_at: "完成时间",
  occurred_at: "发生时间",
  resolved_at: "解决时间",
  checked_at: "盘点时间",
  checked_by: "盘点人",
  checked_by_name: "盘点人",
  notes: "备注",
  reason: "故障原因",
  description: "故障描述",
  expiry_date: "到期日",
  purchase_date: "采购日期",
  depreciation_start_date: "折旧起算日",
  depreciation_years: "折旧年限",
  residual_rate: "残值率",
  depreciation_method: "折旧方法",
  created_at: "创建时间",
  updated_at: "更新时间",
  tags: "标签",
  tag_names: "标签",
  custom_fields: "自定义字段",
  custom_values: "自定义字段",
  custom_value_snapshot: "自定义字段",
  custom_changes: "自定义字段",
  authorized_count: "授权数量",
  used_count: "已用数量",
  remaining_count: "剩余数量",
  utilization: "使用率",
  license_type: "许可类型",
  part_name: "备件",
  category: "备件类型",
  category_name: "备件类型",
  operation_type: "操作类型",
  operation_type_label: "操作类型",
  quantity: "数量",
  quantity_delta: "变化数量",
  before_quantity: "操作前库存",
  after_quantity: "操作后库存",
  reference: "参考单号/用途",
  source_data_center: "来源数据中心",
  source_data_center_name: "来源数据中心",
  source_server_room: "来源机房",
  source_server_room_name: "来源机房",
  target_data_center: "目标数据中心",
  target_data_center_name: "目标数据中心",
  target_server_room: "目标机房",
  target_server_room_name: "目标机房",
  resolution_status: "处理状态",
  resolution_status_label: "处理状态",
  resolution_action: "处理方式",
  resolution_action_label: "处理方式",
  resolution_note: "处理备注",
  resolved_by: "处理人",
  resolved_by_name: "处理人",
  exception_status: "异常状态",
  task: "盘点任务",
  task_name: "盘点任务",
  item: "盘点项目",
  item_id: "盘点项目",
  asset_changed: "是否更新资产",
  ip: "IP 地址",
  ip_address: "IP 地址",
  failure_reason: "失败原因",
  login_reason: "登录原因",
  user_agent: "客户端",
  source: "来源",
  transition: "状态变化",
};

const STATUS_LABELS: Record<string, string> = {
  ...ASSET_STATUS_LABEL_MAP,
  ...INVENTORY_ITEM_STATUS_LABEL_MAP,
  ...INVENTORY_TASK_STATUS_LABEL_MAP,
  ...LICENSE_STATUS_LABEL_MAP,
  ...RACK_STATUS_LABEL_MAP,
  resolved: "已处理",
  unresolved: "未处理",
  unconfigured: "未配置",
  not_started: "尚未开始",
  depreciating: "折旧中",
  fully_depreciated: "已折旧完",
};

const REFERENCE_KEYS = new Set([
  "actor",
  "asset",
  "manufacturer",
  "device_type",
  "data_center",
  "server_room",
  "rack",
  "department",
  "owner",
  "task",
  "item",
  "fault",
  "repair",
  "spare_part",
  "software_license",
  "checked_by",
  "resolved_by",
]);

const OMITTED_CHANGE_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "custom_fields",
  "custom_values",
  "custom_value_snapshot",
  "custom_changes",
  "inventory_records",
  "procurement_records",
  "maintenance_contracts",
  "network_addresses",
  "rack_allocation",
  "tags",
  "tag_names",
]);

const SENSITIVE_KEYS = new Set([
  "password",
  "old_password",
  "new_password",
  "confirm_password",
  "password_hash",
  "csrf",
  "csrf_token",
  "token",
  "session",
  "cookie",
  "authorization",
  "secret",
]);

const KEY_FIELD_ORDER = [
  "asset_no",
  "name",
  "asset_name",
  "username",
  "display_name",
  "code",
  "category",
  "status",
  "manufacturer_name",
  "device_type_name",
  "serial_number",
  "model",
  "provider",
  "started_at",
  "finished_at",
  "expiry_date",
  "depreciation_start_date",
  "depreciation_years",
  "residual_rate",
  "depreciation_method",
  "authorized_count",
  "used_count",
  "reason",
  "description",
  "notes",
  "tag_names",
  "tags",
];

function isRecord(value: unknown): value is AuditRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): AuditRecord {
  return isRecord(value) ? value : {};
}

function getSnapshot(payload: AuditRecord, key: "before" | "after"): AuditRecord {
  return asRecord(payload[key]);
}

function getExtra(log: AuditLog): AuditRecord {
  return asRecord(log.payload?.extra);
}

function lowerKey(key: string): string {
  return key.trim().toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = lowerKey(key);
  return SENSITIVE_KEYS.has(normalized) || /(password|token|session|cookie|csrf|secret|authorization)/.test(normalized);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateValue(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const date = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  const hasTime = /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(value);
  if (!hasTime) return date;
  return `${date} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

function isDateKey(key: string): boolean {
  const normalized = lowerKey(key).split(".").pop() || "";
  return normalized.endsWith("_at") || normalized.endsWith("_date") || normalized === "date" || normalized === "timestamp";
}

function labelForKey(key: string): string {
  const normalized = key.split(".").pop() || key;
  return FIELD_LABELS[normalized] || FIELD_LABELS[key] || normalized;
}

function statusText(value: unknown, key: string): string | null {
  if (typeof value !== "string") return null;
  const normalizedKey = lowerKey(key).split(".").pop() || key;
  if (normalizedKey === "resolution_action") return businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, value);
  if (normalizedKey === "resolution_status") return businessOptionLabel(INVENTORY_RESOLUTION_STATUS_OPTIONS, value);
  if (normalizedKey === "operation_type") return businessOptionLabel(STOCK_OPERATION_OPTIONS, value);
  if (normalizedKey === "status" || normalizedKey === "status_before_repair" || normalizedKey.endsWith("_status")) {
    return STATUS_LABELS[value] || value;
  }
  return null;
}

function displayValue(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const preferredKeys = ["display_name", "name", "label", "code", "asset_no", "username", "part_name", "rack_code", "id"];
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (candidate !== null && candidate !== undefined && candidate !== "") {
      return key === "id" ? `#${String(candidate)}` : String(candidate);
    }
  }
  return null;
}

function locationText(value: unknown): string | null {
  const source = asRecord(value);
  const nested = asRecord(source.rack_allocation);
  const location = Object.keys(nested).length ? nested : source;
  const rack = asRecord(location.rack);
  const dataCenter = firstDefined(
    location.actual_data_center_name,
    location.actual_data_center,
    location.data_center_name,
    location.data_center_label,
    location.data_center,
    location.system_data_center_name,
    location.system_data_center,
  );
  const serverRoom = firstDefined(
    location.actual_server_room_name,
    location.actual_server_room,
    location.server_room_name,
    location.server_room_label,
    location.server_room,
    location.system_server_room_name,
    location.system_server_room,
  );
  const rackCode = firstDefined(
    location.actual_rack_code,
    location.rack_code,
    location.rack_name,
    rack.code,
    rack.name,
    location.rack,
    location.system_rack_code,
    location.system_rack,
  );
  const start = firstDefined(location.actual_start_u, location.start_u, location.rack_start_u, location.system_start_u);
  const end = firstDefined(location.actual_end_u, location.end_u, location.rack_end_u, location.system_end_u);
  const place = [dataCenter, serverRoom, rackCode]
    .map((part) => (isRecord(part) ? displayValue(part) : part))
    .filter((part): part is string | number => part !== null && part !== undefined && part !== "")
    .map(String);
  if (!place.length && start === undefined && end === undefined) return null;
  const unit = start === undefined && end === undefined
    ? ""
    : `U${String(start ?? "—")}${end !== undefined && end !== start ? `-U${String(end)}` : ""}`;
  return [...place, unit].filter(Boolean).join(" / ") || null;
}

function formatObjectValue(value: AuditRecord, key: string, resourceType?: string): string {
  const location = lowerKey(key).includes("location") || lowerKey(key).includes("rack_allocation")
    ? locationText(value)
    : null;
  if (location) return location;
  const display = displayValue(value);
  if (display) return display;
  const entries = Object.entries(value)
    .filter(([entryKey]) => !isSensitiveKey(entryKey))
    .slice(0, 6)
    .map(([entryKey, entryValue]) => `${labelForKey(entryKey)}：${formatAuditValue(entryValue, entryKey, resourceType)}`);
  return entries.length ? entries.join("；") : "—";
}

export function formatAuditValue(value: unknown, key = "", resourceType?: string): string {
  if (isSensitiveKey(key)) return "已隐藏";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  const normalizedKey = lowerKey(key).split(".").pop() || key;
  if (normalizedKey === "depreciation_method" && typeof value === "string") return depreciationMethodLabel(value);
  if (normalizedKey === "residual_rate") return formatResidualRate(value);
  const mappedStatus = statusText(value, key);
  if (mappedStatus) return mappedStatus;
  if (typeof value === "string") {
    if (isDateKey(key) && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDateValue(value);
    if (REFERENCE_KEYS.has(lowerKey(key).split(".").pop() || key) && /^\d+$/.test(value)) return `#${value}`;
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return REFERENCE_KEYS.has(lowerKey(key).split(".").pop() || key) ? `#${String(value)}` : String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => formatAuditValue(item, key, resourceType)).filter((item) => item !== "—");
    return items.length ? items.join("、") : "—";
  }
  if (isRecord(value)) return formatObjectValue(value, key, resourceType);
  return String(value);
}

export function formatAuditDateTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatDateValue(String(value));
}

function redactValue(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) return "已隐藏";
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
}

export function formatRawAuditPayload(payload: Record<string, unknown>): AuditRecord {
  return asRecord(redactValue(payload));
}

export function resourceLabel(value: string): string {
  return RESOURCE_LABELS[value] || value || "未知资源";
}

export function actionLabel(value: string): string {
  return ACTION_LABELS[value] || value || "未知动作";
}

export function auditLogActionLabel(log: AuditLog): string {
  const extra = getExtra(log);
  if (log.resource_type === "user" && extra.password_reset) return "管理员重置密码";
  if (log.resource_type === "user" && extra.password_change) return "修改密码";
  if (log.resource_type === "user" && extra.profile_update) return "修改资料";
  return actionLabel(log.action);
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function objectLabelFromSnapshot(snapshot: AuditRecord, resourceType: string): string | null {
  const nested = [snapshot.task, snapshot.item, snapshot.asset, snapshot.fault, snapshot.repair].find(isRecord);
  const source = nested || snapshot;
  const assetNo = firstDefined(source.asset_no, snapshot.asset_no);
  const name = firstDefined(source.name, source.asset_name, snapshot.asset_name, source.display_name, source.username);
  const code = firstDefined(source.code, source.rack_code, source.part_no);
  if (resourceType === "auth_login") {
    const username = firstDefined(source.username, source.user, snapshot.username);
    return username === undefined ? null : String(username);
  }
  if (assetNo !== undefined) return name === undefined ? String(assetNo) : `${String(assetNo)} / ${String(name)}`;
  if (code !== undefined) return name === undefined ? String(code) : `${String(code)} / ${String(name)}`;
  if (name !== undefined) return String(name);
  const display = displayValue(source);
  return display || null;
}

export function auditObjectLabel(log: AuditLog): string {
  const extra = getExtra(log);
  const before = getSnapshot(log.payload, "before");
  const after = getSnapshot(log.payload, "after");
  const fromPayload = objectLabelFromSnapshot(after, log.resource_type) || objectLabelFromSnapshot(before, log.resource_type);
  if (fromPayload) return fromPayload;
  const fromExtra = firstDefined(extra.target_username, extra.username, extra.asset_no, extra.asset_name, extra.object_name, extra.name);
  if (fromExtra !== undefined) return String(fromExtra);
  if (log.resource_id) return `#${log.resource_id}`;
  return "—";
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (isRecord(item)) return firstDefined(item.name, item.label, item.code, item.id) === undefined ? "" : String(firstDefined(item.name, item.label, item.code, item.id));
      return item === null || item === undefined || item === "" ? "" : String(item);
    })
    .filter(Boolean);
}

function sameValue(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function makeChange(key: string, before: unknown, after: unknown, resourceType: string, summary?: string): AuditChange {
  const beforeText = formatAuditValue(before, key, resourceType);
  const afterText = formatAuditValue(after, key, resourceType);
  return { key, label: labelForKey(key), before, after, beforeText, afterText, summary };
}

function customChanges(log: AuditLog): AuditChange[] {
  const changes = getExtra(log).custom_changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((item) => {
    if (!isRecord(item)) return [];
    const key = String(firstDefined(item.name, item.key, item.field_id, "自定义字段"));
    const label = String(firstDefined(item.name, item.key, `字段 #${String(item.field_id ?? "—")}`));
    const change = makeChange(key, item.old_value, item.new_value, log.resource_type);
    return [{
      ...change,
      label,
      beforeText: formatCustomValue(log, item, item.old_value),
      afterText: formatCustomValue(log, item, item.new_value),
    }];
  });
}

function customFieldsForLog(log: AuditLog): AuditRecord[] {
  const snapshots = [getSnapshot(log.payload, "before"), getSnapshot(log.payload, "after")];
  const fields = snapshots.flatMap((snapshot) => (Array.isArray(snapshot.custom_fields) ? snapshot.custom_fields : []));
  return fields.filter(isRecord);
}

function customFieldForChange(log: AuditLog, item: AuditRecord): AuditRecord | undefined {
  const fieldId = item.field_id;
  const key = item.key;
  return customFieldsForLog(log).find((field) => (
    (fieldId !== undefined && field.id === fieldId) ||
    (key !== undefined && field.key === key)
  ));
}

function formatCustomValue(log: AuditLog, item: AuditRecord, value: unknown): string {
  const field = customFieldForChange(log, item);
  const options = field && Array.isArray(field.options) ? field.options.filter(isRecord) : [];
  if (options.length && (item.field_type === "select" || item.field_type === "multiselect")) {
    const optionLabels = new Map(options.map((option) => [String(option.value), String(firstDefined(option.label, option.value))]));
    if (Array.isArray(value)) {
      return value.length ? value.map((entry) => optionLabels.get(String(entry)) || String(entry)).join("、") : "—";
    }
    if (value !== null && value !== undefined && value !== "") return optionLabels.get(String(value)) || String(value);
  }
  return formatAuditValue(value, String(firstDefined(item.key, item.name, "custom_value")), log.resource_type);
}

function tagChange(before: unknown, after: unknown, resourceType: string): AuditChange | null {
  const beforeNames = tagNames(before);
  const afterNames = tagNames(after);
  if (beforeNames.join("\u0000") === afterNames.join("\u0000")) return null;
  const added = afterNames.filter((name) => !beforeNames.includes(name));
  const removed = beforeNames.filter((name) => !afterNames.includes(name));
  const operations = [
    added.length ? `新增“${added.join("、")}”` : "",
    removed.length ? `移除“${removed.join("、")}”` : "",
  ].filter(Boolean);
  return makeChange("tags", beforeNames, afterNames, resourceType, `标签：${operations.join("，") || "已调整"}`);
}

function positionChange(before: AuditRecord, after: AuditRecord, resourceType: string): AuditChange | null {
  const beforeText = locationText(before);
  const afterText = locationText(after);
  if (!beforeText && !afterText) return null;
  if (beforeText === afterText) return null;
  return {
    key: "location",
    label: "位置",
    before: beforeText,
    after: afterText,
    beforeText: beforeText || "—",
    afterText: afterText || "—",
    summary: `位置：${formatAuditValue(beforeText, "location", resourceType)} → ${formatAuditValue(afterText, "location", resourceType)}`,
  };
}

function genericChanges(log: AuditLog): AuditChange[] {
  const before = getSnapshot(log.payload, "before");
  const after = getSnapshot(log.payload, "after");
  if (!Object.keys(before).length && !Object.keys(after).length) return [];
  const changes: AuditChange[] = [];
  const position = positionChange(before, after, log.resource_type);
  if (position) changes.push(position);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (OMITTED_CHANGE_KEYS.has(key) || isSensitiveKey(key) || key === "location") continue;
    const oldValue = before[key];
    const newValue = after[key];
    if (sameValue(oldValue, newValue)) continue;
    changes.push(makeChange(key, oldValue, newValue, log.resource_type));
  }
  const extra = getExtra(log);
  if (!changes.some((change) => change.key === "status") && extra.old_status !== undefined && extra.new_status !== undefined && !sameValue(extra.old_status, extra.new_status)) {
    changes.push(makeChange("status", extra.old_status, extra.new_status, log.resource_type));
  }
  return changes;
}

export function auditChanges(log: AuditLog): AuditChange[] {
  if (log.resource_type === "auth_login" || log.action === "create" || log.action === "delete") return [];
  const changes = genericChanges(log);
  const before = getSnapshot(log.payload, "before");
  const after = getSnapshot(log.payload, "after");
  const tags = tagChange(before.tags ?? before.tag_names, after.tags ?? after.tag_names, log.resource_type);
  if (tags) changes.push(tags);
  changes.push(...customChanges(log));
  return changes;
}

function loginMetadata(log: AuditLog): AuditMetadata[] {
  const extra = getExtra(log);
  const payload = log.payload;
  const metadata: AuditMetadata[] = [];
  const username = firstDefined(extra.username, payload.username, log.actor_username);
  const ip = firstDefined(extra.ip, extra.ip_address, payload.ip, payload.ip_address);
  const reason = firstDefined(extra.reason, extra.failure_reason, extra.login_reason, payload.reason, payload.failure_reason);
  if (username !== undefined) metadata.push({ label: "用户名", value: formatAuditValue(username, "username", log.resource_type) });
  if (ip !== undefined) metadata.push({ label: "IP 地址", value: formatAuditValue(ip, "ip", log.resource_type) });
  if (reason !== undefined) metadata.push({ label: "原因", value: formatAuditValue(reason, "reason", log.resource_type) });
  return metadata;
}

function fieldsFromSnapshot(log: AuditLog): AuditField[] {
  const snapshot = log.action === "delete" ? getSnapshot(log.payload, "before") : getSnapshot(log.payload, "after");
  const source = [snapshot.task, snapshot.item, snapshot.asset].find(isRecord) || snapshot;
  const fields: AuditField[] = [];
  for (const key of KEY_FIELD_ORDER) {
    if (!(key in source) || isSensitiveKey(key)) continue;
    fields.push({ key, label: labelForKey(key), value: source[key], valueText: formatAuditValue(source[key], key, log.resource_type) });
  }
  const customSnapshot = Array.isArray(snapshot.custom_value_snapshot) ? snapshot.custom_value_snapshot.filter(isRecord) : [];
  for (const item of customSnapshot) {
    if (fields.length >= 10) break;
    const key = String(firstDefined(item.key, item.field_id, "custom_value"));
    fields.push({
      key: `custom:${key}`,
      label: String(firstDefined(item.name, item.key, `字段 #${String(item.field_id ?? "—")}`)),
      value: item.value,
      valueText: formatCustomValue(log, item, item.value),
    });
  }
  return fields.slice(0, 10);
}

function summaryForLogin(log: AuditLog): string {
  const extra = getExtra(log);
  const reason = firstDefined(extra.reason, extra.failure_reason, extra.login_reason);
  return reason === undefined ? actionLabel(log.action) : `${actionLabel(log.action)}：${String(reason)}`;
}

export function auditChangeSummary(log: AuditLog): string {
  if (log.resource_type === "auth_login") return summaryForLogin(log);
  const object = auditObjectLabel(log);
  const extra = getExtra(log);
  if (log.resource_type === "user" && extra.password_reset) return `管理员重置密码 ${object}`;
  if (log.resource_type === "user" && extra.password_change) return `修改密码 ${object}`;
  if (log.action === "create") return `新增${resourceLabel(log.resource_type)} ${object}`;
  if (log.action === "delete") return `删除${resourceLabel(log.resource_type)} ${object}`;
  const changes = auditChanges(log);
  if (!changes.length) {
    if (log.action === "resolve" && extra.resolution_action !== undefined) return `处理方式：${formatAuditValue(extra.resolution_action, "resolution_action", log.resource_type)}`;
    return `${actionLabel(log.action)}${resourceLabel(log.resource_type)} ${object}`;
  }
  const parts = changes.slice(0, 2).map((change) => change.summary || `${change.label}：${change.beforeText} → ${change.afterText}`);
  const suffix = changes.length > parts.length ? ` 等 ${changes.length} 项` : "";
  return `${parts.join("；")}${suffix}`;
}

export function auditDetail(log: AuditLog): AuditDetail {
  const isDelete = log.action === "delete";
  const isCreate = log.action === "create";
  const fields = isCreate || isDelete ? fieldsFromSnapshot(log) : [];
  return {
    resourceLabel: resourceLabel(log.resource_type),
    actionLabel: auditLogActionLabel(log),
    objectLabel: auditObjectLabel(log),
    summary: auditChangeSummary(log),
    changeTitle: isDelete ? "删除前数据" : isCreate ? "新增时数据" : "字段变更",
    changes: auditChanges(log),
    fields,
    metadata: log.resource_type === "auth_login" ? loginMetadata(log) : [],
    rawPayload: formatRawAuditPayload(log.payload),
  };
}
