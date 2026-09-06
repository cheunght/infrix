import type { AuditLog } from "./types";
import { depreciationMethodLabel, formatResidualRate } from "./depreciation";
import { currentLocale, i18n } from "./i18n";
import {
  businessOptionLabel,
  INVENTORY_RESOLUTION_ACTION_OPTIONS,
  INVENTORY_RESOLUTION_STATUS_OPTIONS,
  STOCK_OPERATION_OPTIONS,
} from "./business-enums";
import { statusLabel } from "./status";

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
  asset: "auditLog.resources.asset",
  manufacturer: "auditLog.resources.manufacturer",
  device_type: "auditLog.resources.device_type",
  data_center: "auditLog.resources.data_center",
  server_room: "auditLog.resources.server_room",
  rack: "auditLog.resources.rack",
  custom_field: "auditLog.resources.custom_field",
  custom_field_option: "auditLog.resources.custom_field_option",
  tag: "auditLog.resources.tag",
  fault_event: "auditLog.resources.fault_event",
  repair_record: "auditLog.resources.repair_record",
  software_license: "auditLog.resources.software_license",
  spare_part: "auditLog.resources.spare_part",
  spare_part_category: "auditLog.resources.spare_part_category",
  spare_stock_transaction: "auditLog.resources.spare_stock_transaction",
  inventory_task: "auditLog.resources.inventory_task",
  inventory_item: "auditLog.resources.inventory_item",
  user: "auditLog.resources.user",
  auth_login: "auditLog.resources.auth_login",
  ldap: "auditLog.resources.ldap",
  system: "auditLog.resources.system",
  system_settings: "auditLog.resources.system_settings",
};

const ACTION_LABELS: Record<string, string> = {
  create: "auditLog.actions.create",
  update: "auditLog.actions.update",
  delete: "auditLog.actions.delete",
  complete: "auditLog.actions.complete",
  close: "auditLog.actions.close",
  reopen: "auditLog.actions.reopen",
  resolve: "auditLog.actions.resolve",
  login_success: "auditLog.actions.login_success",
  login_failure: "auditLog.actions.login_failure",
  login_locked: "auditLog.actions.login_locked",
  ldap_diagnostic: "auditLog.actions.ldap_diagnostic",
  ldap_configuration_updated: "auditLog.actions.ldap_configuration_updated",
  ldap_enabled: "auditLog.actions.ldap_enabled",
  ldap_disabled: "auditLog.actions.ldap_disabled",
  ldap_bind_password_updated: "auditLog.actions.ldap_bind_password_updated",
  system_reset: "auditLog.actions.system_reset",
};

export const auditResourceOptions = Object.entries(RESOURCE_LABELS).map(([value, labelKey]) => ({ labelKey, value }));
export const auditActionOptions = Object.entries(ACTION_LABELS).map(([value, labelKey]) => ({ labelKey, value }));

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
  const translationKey = `auditLog.fields.${normalized}`;
  return i18n.global.te(translationKey) ? String(i18n.global.t(translationKey)) : normalized.replace(/_/g, " ");
}

function statusText(value: unknown, key: string): string | null {
  if (typeof value !== "string") return null;
  const normalizedKey = lowerKey(key).split(".").pop() || key;
  if (normalizedKey === "resolution_action") return businessOptionLabel(INVENTORY_RESOLUTION_ACTION_OPTIONS, value);
  if (normalizedKey === "resolution_status") return businessOptionLabel(INVENTORY_RESOLUTION_STATUS_OPTIONS, value);
  if (normalizedKey === "operation_type") return businessOptionLabel(STOCK_OPERATION_OPTIONS, value);
  if (normalizedKey === "status" || normalizedKey === "status_before_repair" || normalizedKey.endsWith("_status")) {
    return statusLabel(value);
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
    .map(([entryKey, entryValue]) => `${labelForKey(entryKey)}: ${formatAuditValue(entryValue, entryKey, resourceType)}`);
  return entries.length ? entries.join("; ") : String(i18n.global.t("auditLog.empty"));
}

export function formatAuditValue(value: unknown, key = "", resourceType?: string): string {
  if (isSensitiveKey(key)) return String(i18n.global.t("auditLog.hidden"));
  if (value === null || value === undefined || value === "") return String(i18n.global.t("auditLog.empty"));
  if (typeof value === "boolean") return value ? String(i18n.global.t("common.yes")) : String(i18n.global.t("common.no"));
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
    const empty = String(i18n.global.t("auditLog.empty"));
    const items = value.map((item) => formatAuditValue(item, key, resourceType)).filter((item) => item !== empty);
    return items.length ? items.join(", ") : empty;
  }
  if (isRecord(value)) return formatObjectValue(value, key, resourceType);
  return String(value);
}

export function formatAuditDateTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return String(i18n.global.t("auditLog.empty"));
  return formatDateValue(String(value));
}

function redactValue(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) return i18n.global.t("auditLog.hidden");
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
}

export function formatRawAuditPayload(payload: Record<string, unknown>): AuditRecord {
  return asRecord(redactValue(payload));
}

export function resourceLabel(value: string): string {
  const key = RESOURCE_LABELS[value];
  return key ? String(i18n.global.t(key)) : value || String(i18n.global.t("auditLog.unknownResource"));
}

export function actionLabel(value: string): string {
  const key = ACTION_LABELS[value];
  return key ? String(i18n.global.t(key)) : value || String(i18n.global.t("auditLog.unknownAction"));
}

export function auditLogActionLabel(log: AuditLog): string {
  const extra = getExtra(log);
  if (log.resource_type === "system" && log.action === "system_reset") return String(i18n.global.t("auditLog.actions.system_reset"));
  if (log.resource_type === "user" && extra.password_reset) return String(i18n.global.t("auditLog.adminPasswordReset"));
  if (log.resource_type === "user" && extra.password_change) return String(i18n.global.t("auditLog.passwordChange"));
  if (log.resource_type === "user" && extra.profile_update) return String(i18n.global.t("auditLog.profileUpdate"));
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
  if (resourceType === "ldap") return String(i18n.global.t("auditLog.ldapConfiguration"));
  if (assetNo !== undefined) return name === undefined ? String(assetNo) : `${String(assetNo)} / ${String(name)}`;
  if (code !== undefined) return name === undefined ? String(code) : `${String(code)} / ${String(name)}`;
  if (name !== undefined) return String(name);
  const display = displayValue(source);
  return display || null;
}

export function auditObjectLabel(log: AuditLog): string {
  if (log.resource_type === "system_settings") return String(i18n.global.t("auditLog.systemSettings"));
  const extra = getExtra(log);
  const before = getSnapshot(log.payload, "before");
  const after = getSnapshot(log.payload, "after");
  const fromPayload = objectLabelFromSnapshot(after, log.resource_type) || objectLabelFromSnapshot(before, log.resource_type);
  if (fromPayload) return fromPayload;
  const fromExtra = firstDefined(extra.target_username, extra.username, extra.asset_no, extra.asset_name, extra.object_name, extra.name);
  if (fromExtra !== undefined) return String(fromExtra);
  if (log.resource_id) return `#${log.resource_id}`;
  return String(i18n.global.t("auditLog.empty"));
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
    const key = String(firstDefined(item.name, item.key, item.field_id, "custom_value"));
    const label = String(firstDefined(
      item.name,
      item.key,
      i18n.global.t("auditLog.fieldFallback", { id: String(item.field_id ?? i18n.global.t("auditLog.empty")) }),
    ));
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
    added.length ? String(i18n.global.t("auditLog.tagAdded", { value: added.join(", ") })) : "",
    removed.length ? String(i18n.global.t("auditLog.tagRemoved", { value: removed.join(", ") })) : "",
  ].filter(Boolean);
  return makeChange(
    "tags",
    beforeNames,
    afterNames,
    resourceType,
    String(i18n.global.t("auditLog.tagChange", {
      value: operations.join(", ") || i18n.global.t("auditLog.tagsAdjusted"),
    })),
  );
}

function positionChange(before: AuditRecord, after: AuditRecord, resourceType: string): AuditChange | null {
  const beforeText = locationText(before);
  const afterText = locationText(after);
  if (!beforeText && !afterText) return null;
  if (beforeText === afterText) return null;
  return {
    key: "location",
    label: labelForKey("location"),
    before: beforeText,
    after: afterText,
    beforeText: beforeText || String(i18n.global.t("auditLog.empty")),
    afterText: afterText || String(i18n.global.t("auditLog.empty")),
    summary: String(i18n.global.t("auditLog.positionChange", {
      before: formatAuditValue(beforeText, "location", resourceType),
      after: formatAuditValue(afterText, "location", resourceType),
    })),
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
  if (username !== undefined) metadata.push({ label: labelForKey("username"), value: formatAuditValue(username, "username", log.resource_type) });
  if (ip !== undefined) metadata.push({ label: labelForKey("ip"), value: formatAuditValue(ip, "ip", log.resource_type) });
  if (reason !== undefined) metadata.push({ label: labelForKey("reason"), value: formatAuditValue(reason, "reason", log.resource_type) });
  return metadata;
}

function ldapDiagnosticMetadata(log: AuditLog): AuditMetadata[] {
  const extra = getExtra(log);
  const metadata: AuditMetadata[] = [];
  const stage = firstDefined(extra.stage);
  const code = firstDefined(extra.code);
  const success = firstDefined(extra.success);
  if (success !== undefined) {
    metadata.push({
      label: String(i18n.global.t("auditLog.diagnosticResult")),
      value: success ? String(i18n.global.t("auditLog.diagnosticPassed")) : String(i18n.global.t("auditLog.diagnosticFailed")),
    });
  }
  if (stage !== undefined) metadata.push({ label: String(i18n.global.t("auditLog.diagnosticStage")), value: String(stage) });
  if (code !== undefined) metadata.push({ label: String(i18n.global.t("auditLog.diagnosticCode")), value: String(code) });
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
      label: String(firstDefined(
        item.name,
        item.key,
        i18n.global.t("auditLog.fieldFallback", { id: String(item.field_id ?? i18n.global.t("auditLog.empty")) }),
      )),
      value: item.value,
      valueText: formatCustomValue(log, item, item.value),
    });
  }
  return fields.slice(0, 10);
}

function summaryForLogin(log: AuditLog): string {
  const extra = getExtra(log);
  const reason = firstDefined(extra.reason, extra.failure_reason, extra.login_reason);
  return reason === undefined
    ? actionLabel(log.action)
    : String(i18n.global.t("auditLog.loginSummary", { action: actionLabel(log.action), reason: String(reason) }));
}

export function auditChangeSummary(log: AuditLog): string {
  if (log.resource_type === "auth_login") return summaryForLogin(log);
  if (log.resource_type === "ldap" && log.action === "ldap_diagnostic") {
    const extra = getExtra(log);
    return String(i18n.global.t(
      extra.success ? "auditLog.ldapDiagnosticSuccess" : "auditLog.ldapDiagnosticFailure",
      { stage: String(extra.stage || i18n.global.t("auditLog.empty")) },
    ));
  }
  if (log.resource_type === "system" && log.action === "system_reset") return String(i18n.global.t("auditLog.actions.system_reset"));
  const object = auditObjectLabel(log);
  const resource = resourceLabel(log.resource_type);
  const extra = getExtra(log);
  if (log.resource_type === "user" && extra.password_reset) {
    return String(i18n.global.t("auditLog.summary.adminPasswordReset", { object }));
  }
  if (log.resource_type === "user" && extra.password_change) {
    return String(i18n.global.t("auditLog.summary.passwordChange", { object }));
  }
  if (log.resource_type === "user" && extra.profile_update) {
    return String(i18n.global.t("auditLog.summary.profileUpdate", { object }));
  }
  if (log.action === "create") {
    return String(i18n.global.t("auditLog.summary.created", { resource, object }));
  }
  if (log.action === "delete") {
    return String(i18n.global.t("auditLog.summary.deleted", { resource, object }));
  }
  const changes = auditChanges(log);
  if (!changes.length) {
    if (log.action === "resolve" && extra.resolution_action !== undefined) {
      return `${labelForKey("resolution_action")}: ${formatAuditValue(extra.resolution_action, "resolution_action", log.resource_type)}`;
    }
    if (log.action === "update") {
      return String(i18n.global.t("auditLog.summary.updated", { resource, object }));
    }
    return String(i18n.global.t("auditLog.summary.action", {
      action: auditLogActionLabel(log),
      resource,
      object,
    }));
  }
  const parts = changes.slice(0, 2).map((change) => change.summary || `${change.label}: ${change.beforeText} → ${change.afterText}`);
  const suffix = changes.length > parts.length ? ` ${i18n.global.t("auditLog.changeCount", { count: changes.length })}` : "";
  return `${parts.join("; ")}${suffix}`;
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
    changeTitle: isDelete
      ? String(i18n.global.t("auditLog.deleteBefore"))
      : isCreate
        ? String(i18n.global.t("auditLog.createAt"))
        : String(i18n.global.t("auditLog.fieldChanges")),
    changes: auditChanges(log),
    fields,
    metadata: log.resource_type === "auth_login"
      ? loginMetadata(log)
      : log.resource_type === "ldap" ? ldapDiagnosticMetadata(log) : [],
    rawPayload: formatRawAuditPayload(log.payload),
  };
}
