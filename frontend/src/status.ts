import {
  ASSET_STATUS_OPTIONS,
  INVENTORY_TASK_STATUS_OPTIONS,
  LICENSE_STATUS_OPTIONS,
  RACK_STATUS_OPTIONS,
  type BusinessOption,
  type StatusTone,
} from "./business-enums";

export type StatusTagType = StatusTone;

const PRESENTATION_STATUS_OPTIONS = [
  { value: "active", label: "启用", tone: "success" },
  { value: "enabled", label: "启用", tone: "success" },
  { value: "pending", label: "待处理", tone: "warning" },
  { value: "fault", label: "故障", tone: "danger" },
  { value: "inactive", label: "停用", tone: "info" },
  { value: "unconfigured", label: "未配置", tone: "neutral" },
  { value: "not_started", label: "尚未开始", tone: "warning" },
  { value: "depreciating", label: "折旧中", tone: "success" },
  { value: "fully_depreciated", label: "已折旧完", tone: "info" },
  { value: "resolved", label: "已处理", tone: "success" },
] as const satisfies readonly BusinessOption<string>[];

const STATUS_OPTIONS = [
  ...PRESENTATION_STATUS_OPTIONS,
  ...ASSET_STATUS_OPTIONS,
  ...INVENTORY_TASK_STATUS_OPTIONS,
  ...RACK_STATUS_OPTIONS,
  ...LICENSE_STATUS_OPTIONS,
] as const;

export const STATUS_LABEL_MAP: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

const STATUS_TONE_MAP: Record<string, StatusTagType> = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.tone]),
);

export function statusLabel(status: string): string {
  return STATUS_LABEL_MAP[status] || status || "—";
}

export function statusTone(status: string | null | undefined): StatusTagType {
  return STATUS_TONE_MAP[status || ""] || "neutral";
}
