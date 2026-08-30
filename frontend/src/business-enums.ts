/**
 * Frontend presentation contracts for backend business choices.
 *
 * The backend model choices define the legal values.  Keep this file limited
 * to the mirrored value contract plus UI label/tone/order; do not add values
 * here that the API does not accept.
 */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";
import { i18n } from "./i18n";

const ROLE_LABEL_KEYS: Record<string, string> = {
  system_admin: "settings.roleNames.systemAdmin",
  asset_admin: "settings.roleNames.assetAdmin",
  repairer: "settings.roleNames.repairer",
  auditor: "settings.roleNames.auditor",
};

const ROLE_DESCRIPTION_KEYS: Record<string, string> = {
  system_admin: "settings.roleDescriptions.systemAdmin",
  asset_admin: "settings.roleDescriptions.assetAdmin",
  repairer: "settings.roleDescriptions.repairer",
  auditor: "settings.roleDescriptions.auditor",
};

export function roleLabel(code: string, fallback = code): string {
  const key = ROLE_LABEL_KEYS[code];
  return key ? String(i18n.global.t(key)) : fallback;
}

export function roleDescription(code: string, fallback = ""): string {
  const key = ROLE_DESCRIPTION_KEYS[code];
  return key ? String(i18n.global.t(key)) : fallback;
}

export type BusinessOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
  labelKey?: string;
  tone: StatusTone;
}>;

type OptionValue<Options extends readonly BusinessOption<string>[]> = Options[number]["value"];

function optionValues<const Options extends readonly BusinessOption<string>[]>(options: Options): OptionValue<Options>[] {
  return options.map((option) => option.value) as OptionValue<Options>[];
}

function optionLabelMap<const Options extends readonly BusinessOption<string>[]>(options: Options): Record<OptionValue<Options>, string> {
  return Object.fromEntries(options.map((option) => [option.value, option.label])) as Record<OptionValue<Options>, string>;
}

function optionToneMap<const Options extends readonly BusinessOption<string>[]>(options: Options): Record<OptionValue<Options>, StatusTone> {
  return Object.fromEntries(options.map((option) => [option.value, option.tone])) as Record<OptionValue<Options>, StatusTone>;
}

type LabeledOption = Readonly<{ value: string; label: string; labelKey?: string }>;

export function businessOptionLabel(options: readonly LabeledOption[], value: string): string {
  const option = options.find((item) => item.value === value);
  return option?.labelKey ? i18n.global.t(option.labelKey) : option?.label || value;
}

export function businessOptionTone(
  options: readonly BusinessOption<string>[],
  value: string,
  fallback: StatusTone = "neutral",
): StatusTone {
  return options.find((option) => option.value === value)?.tone || fallback;
}

export const SPARE_UNIT_OPTIONS = [
  { value: "piece", label: "个", labelKey: "units.piece" },
  { value: "block", label: "块", labelKey: "units.block" },
  { value: "stick", label: "条", labelKey: "units.stick" },
  { value: "root", label: "根", labelKey: "units.root" },
  { value: "set", label: "套", labelKey: "units.set" },
  { value: "pair", label: "对", labelKey: "units.pair" },
  { value: "box", label: "盒", labelKey: "units.box" },
] as const;
export type SpareUnit = (typeof SPARE_UNIT_OPTIONS)[number]["value"];
export const SPARE_UNIT_VALUES = SPARE_UNIT_OPTIONS.map((option) => option.value) as SpareUnit[];
export const SPARE_UNIT_LABEL_MAP: Record<SpareUnit, string> = Object.fromEntries(
  SPARE_UNIT_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SpareUnit, string>;

export function spareUnitLabel(value: string): string {
  return businessOptionLabel(SPARE_UNIT_OPTIONS, value);
}

export const ASSET_STATUS_OPTIONS = [
  { value: "in_stock", label: "在库", labelKey: "status.inStock", tone: "info" },
  { value: "in_use", label: "在用", labelKey: "status.inUse", tone: "success" },
  { value: "idle", label: "闲置", labelKey: "status.idle", tone: "info" },
  { value: "repair", label: "维修中", labelKey: "status.repair", tone: "warning" },
  { value: "retired", label: "已报废", labelKey: "status.retired", tone: "info" },
] as const satisfies readonly BusinessOption<string>[];
export type AssetStatus = (typeof ASSET_STATUS_OPTIONS)[number]["value"];
export const ASSET_STATUS_VALUES = optionValues(ASSET_STATUS_OPTIONS);
export const ASSET_STATUS_LABEL_MAP = optionLabelMap(ASSET_STATUS_OPTIONS);
export const ASSET_STATUS_TONE_MAP = optionToneMap(ASSET_STATUS_OPTIONS);

export function isAssetStatus(value: string): value is AssetStatus {
  return ASSET_STATUS_VALUES.some((status) => status === value);
}

export const INVENTORY_TASK_STATUS_OPTIONS = [
  { value: "in_progress", label: "进行中", labelKey: "status.inProgress", tone: "warning" },
  { value: "completed", label: "已完成", labelKey: "status.completed", tone: "success" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryTaskStatus = (typeof INVENTORY_TASK_STATUS_OPTIONS)[number]["value"];
export const INVENTORY_TASK_STATUS_VALUES = optionValues(INVENTORY_TASK_STATUS_OPTIONS);
export const INVENTORY_TASK_STATUS_LABEL_MAP = optionLabelMap(INVENTORY_TASK_STATUS_OPTIONS);
export const INVENTORY_TASK_STATUS_TONE_MAP = optionToneMap(INVENTORY_TASK_STATUS_OPTIONS);

export const INVENTORY_ITEM_STATUS_OPTIONS = [
  { value: "pending", label: "未盘点", labelKey: "status.pendingInventory", tone: "info" },
  { value: "normal", label: "正常", labelKey: "status.normal", tone: "success" },
  { value: "location_mismatch", label: "位置不符", labelKey: "status.locationMismatch", tone: "warning" },
  { value: "not_found", label: "未找到", labelKey: "status.notFound", tone: "danger" },
  { value: "info_mismatch", label: "设备信息不符", labelKey: "status.infoMismatch", tone: "danger" },
  { value: "other", label: "其他异常", labelKey: "status.otherException", tone: "warning" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryStatus = (typeof INVENTORY_ITEM_STATUS_OPTIONS)[number]["value"];
export const INVENTORY_ITEM_STATUS_VALUES = optionValues(INVENTORY_ITEM_STATUS_OPTIONS);
export const INVENTORY_ITEM_STATUS_LABEL_MAP = optionLabelMap(INVENTORY_ITEM_STATUS_OPTIONS);
export const INVENTORY_ITEM_STATUS_TONE_MAP = optionToneMap(INVENTORY_ITEM_STATUS_OPTIONS);
export const INVENTORY_EXCEPTION_STATUS_VALUES: InventoryStatus[] = INVENTORY_ITEM_STATUS_VALUES.filter(
  (status) => status !== "pending" && status !== "normal",
);

export const INVENTORY_RESOLUTION_STATUS_OPTIONS = [
  { value: "not_required", label: "无需处理", labelKey: "status.notRequired", tone: "info" },
  { value: "pending", label: "待处理", labelKey: "status.pending", tone: "warning" },
  { value: "resolved", label: "已处理", labelKey: "status.resolved", tone: "success" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryResolutionStatus = (typeof INVENTORY_RESOLUTION_STATUS_OPTIONS)[number]["value"];
export const INVENTORY_RESOLUTION_STATUS_VALUES = optionValues(INVENTORY_RESOLUTION_STATUS_OPTIONS);
export const INVENTORY_RESOLUTION_STATUS_LABEL_MAP = optionLabelMap(INVENTORY_RESOLUTION_STATUS_OPTIONS);
export const INVENTORY_RESOLUTION_STATUS_TONE_MAP = optionToneMap(INVENTORY_RESOLUTION_STATUS_OPTIONS);

export const INVENTORY_RESOLUTION_ACTION_OPTIONS = [
  { value: "update_asset", label: "更新资产台账", labelKey: "inventory.updateAsset", tone: "info" },
  { value: "keep_asset", label: "保持资产台账", labelKey: "inventory.keepAsset", tone: "info" },
  { value: "confirm_missing", label: "确认设备缺失", labelKey: "inventory.confirmMissing", tone: "danger" },
  { value: "ignore", label: "忽略/误报", labelKey: "inventory.ignore", tone: "warning" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryResolutionAction = (typeof INVENTORY_RESOLUTION_ACTION_OPTIONS)[number]["value"];
export const INVENTORY_RESOLUTION_ACTION_VALUES = optionValues(INVENTORY_RESOLUTION_ACTION_OPTIONS);
export const INVENTORY_RESOLUTION_ACTION_LABEL_MAP = optionLabelMap(INVENTORY_RESOLUTION_ACTION_OPTIONS);

export const RACK_STATUS_OPTIONS = [
  { value: "in_use", label: "在用", labelKey: "status.inUse", tone: "success" },
  { value: "reserved", label: "预留", labelKey: "status.reserved", tone: "warning" },
  { value: "disabled", label: "停用", labelKey: "status.disabled", tone: "info" },
] as const satisfies readonly BusinessOption<string>[];
export type RackStatus = (typeof RACK_STATUS_OPTIONS)[number]["value"];
export const RACK_STATUS_VALUES = optionValues(RACK_STATUS_OPTIONS);
export const RACK_STATUS_LABEL_MAP = optionLabelMap(RACK_STATUS_OPTIONS);
export const RACK_STATUS_TONE_MAP = optionToneMap(RACK_STATUS_OPTIONS);

export const STOCK_OPERATION_OPTIONS = [
  { value: "initial", label: "初始库存", labelKey: "spare.initialOperation", tone: "info" },
  { value: "inbound", label: "入库", labelKey: "spare.inbound", tone: "success" },
  { value: "outbound", label: "出库", labelKey: "spare.outbound", tone: "warning" },
  { value: "transfer", label: "调拨", labelKey: "spare.transfer", tone: "info" },
  { value: "adjustment", label: "调整", labelKey: "spare.adjustment", tone: "info" },
  { value: "scrap", label: "报废", labelKey: "spare.scrap", tone: "danger" },
] as const satisfies readonly BusinessOption<string>[];
export type StockOperationType = (typeof STOCK_OPERATION_OPTIONS)[number]["value"];
export const STOCK_OPERATION_VALUES = optionValues(STOCK_OPERATION_OPTIONS);
export const STOCK_OPERATION_LABEL_MAP = optionLabelMap(STOCK_OPERATION_OPTIONS);
export const STOCK_OPERATION_TONE_MAP = optionToneMap(STOCK_OPERATION_OPTIONS);
export const STOCK_SOURCE_OPERATION_VALUES: readonly StockOperationType[] = ["outbound", "transfer", "scrap"];
export const STOCK_TARGET_OPERATION_VALUES: readonly StockOperationType[] = ["initial", "inbound", "transfer", "adjustment"];

export function stockOperationTone(operationType: string): StatusTone {
  return businessOptionTone(STOCK_OPERATION_OPTIONS, operationType);
}

export const LICENSE_STATUS_OPTIONS = [
  { value: "normal", label: "正常", labelKey: "status.normal", tone: "success" },
  { value: "expiring", label: "即将到期", labelKey: "status.expiring", tone: "warning" },
  { value: "expired", label: "已过期", labelKey: "status.expired", tone: "danger" },
] as const satisfies readonly BusinessOption<string>[];
export type LicenseStatus = (typeof LICENSE_STATUS_OPTIONS)[number]["value"];
export const LICENSE_STATUS_VALUES = optionValues(LICENSE_STATUS_OPTIONS);
export const LICENSE_STATUS_LABEL_MAP = optionLabelMap(LICENSE_STATUS_OPTIONS);
export const LICENSE_STATUS_TONE_MAP = optionToneMap(LICENSE_STATUS_OPTIONS);

export function rackStatusValue(status?: string | null, isActive: boolean | undefined = true): RackStatus {
  if (status === "reserved") return "reserved";
  if (status === "disabled" || isActive === false) return "disabled";
  return "in_use";
}

export function rackStatusLabel(status?: string | null, isActive: boolean | undefined = true): string {
  return RACK_STATUS_LABEL_MAP[rackStatusValue(status, isActive)];
}

export function rackStatusTone(status?: string | null, isActive: boolean | undefined = true): StatusTone {
  return RACK_STATUS_TONE_MAP[rackStatusValue(status, isActive)];
}
