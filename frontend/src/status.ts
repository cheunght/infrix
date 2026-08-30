import {
  ASSET_STATUS_OPTIONS,
  INVENTORY_TASK_STATUS_OPTIONS,
  LICENSE_STATUS_OPTIONS,
  RACK_STATUS_OPTIONS,
  type BusinessOption,
  type StatusTone,
} from "./business-enums";
import { i18n } from "./i18n";

export type StatusTagType = StatusTone;

const PRESENTATION_STATUS_OPTIONS = [
  { value: "active", label: "启用", labelKey: "status.active", tone: "success" },
  { value: "enabled", label: "启用", labelKey: "status.enabled", tone: "success" },
  { value: "pending", label: "待处理", labelKey: "status.pending", tone: "warning" },
  { value: "fault", label: "故障", labelKey: "status.fault", tone: "danger" },
  { value: "inactive", label: "停用", labelKey: "status.inactive", tone: "info" },
  { value: "unconfigured", label: "未配置", labelKey: "status.unconfigured", tone: "neutral" },
  { value: "not_started", label: "尚未开始", labelKey: "status.notStarted", tone: "warning" },
  { value: "depreciating", label: "折旧中", labelKey: "status.depreciating", tone: "success" },
  { value: "fully_depreciated", label: "已折旧完", labelKey: "status.fullyDepreciated", tone: "info" },
  { value: "resolved", label: "已处理", labelKey: "status.resolved", tone: "success" },
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
const STATUS_LABEL_KEY_MAP: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.labelKey || ""]),
);

export function statusLabel(status: string): string {
  const labelKey = STATUS_LABEL_KEY_MAP[status];
  return labelKey ? i18n.global.t(labelKey) : STATUS_LABEL_MAP[status] || status || i18n.global.t("common.notAvailable");
}

export function statusTone(status: string | null | undefined): StatusTagType {
  return STATUS_TONE_MAP[status || ""] || "neutral";
}
