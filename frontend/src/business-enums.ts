/**
 * Frontend presentation contracts for backend business choices.
 *
 * The backend model choices define the legal values.  Keep this file limited
 * to the mirrored value contract plus UI label/tone/order; do not add values
 * here that the API does not accept.
 */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export type BusinessOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
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

export function businessOptionLabel(options: readonly BusinessOption<string>[], value: string): string {
  return options.find((option) => option.value === value)?.label || value;
}

export function businessOptionTone(
  options: readonly BusinessOption<string>[],
  value: string,
  fallback: StatusTone = "neutral",
): StatusTone {
  return options.find((option) => option.value === value)?.tone || fallback;
}

export const SPARE_UNIT_OPTIONS = [
  { value: "piece", label: "个" },
  { value: "block", label: "块" },
  { value: "stick", label: "条" },
  { value: "root", label: "根" },
  { value: "set", label: "套" },
  { value: "pair", label: "对" },
  { value: "box", label: "盒" },
] as const;
export type SpareUnit = (typeof SPARE_UNIT_OPTIONS)[number]["value"];
export const SPARE_UNIT_VALUES = SPARE_UNIT_OPTIONS.map((option) => option.value) as SpareUnit[];
export const SPARE_UNIT_LABEL_MAP: Record<SpareUnit, string> = Object.fromEntries(
  SPARE_UNIT_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SpareUnit, string>;

export function spareUnitLabel(value: string): string {
  return SPARE_UNIT_LABEL_MAP[value as SpareUnit] || value;
}

export const ASSET_STATUS_OPTIONS = [
  { value: "in_stock", label: "在库", tone: "info" },
  { value: "in_use", label: "在用", tone: "success" },
  { value: "idle", label: "闲置", tone: "info" },
  { value: "repair", label: "维修中", tone: "warning" },
  { value: "retired", label: "已报废", tone: "info" },
] as const satisfies readonly BusinessOption<string>[];
export type AssetStatus = (typeof ASSET_STATUS_OPTIONS)[number]["value"];
export const ASSET_STATUS_VALUES = optionValues(ASSET_STATUS_OPTIONS);
export const ASSET_STATUS_LABEL_MAP = optionLabelMap(ASSET_STATUS_OPTIONS);
export const ASSET_STATUS_TONE_MAP = optionToneMap(ASSET_STATUS_OPTIONS);

export function isAssetStatus(value: string): value is AssetStatus {
  return ASSET_STATUS_VALUES.some((status) => status === value);
}

export const INVENTORY_TASK_STATUS_OPTIONS = [
  { value: "in_progress", label: "进行中", tone: "warning" },
  { value: "completed", label: "已完成", tone: "success" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryTaskStatus = (typeof INVENTORY_TASK_STATUS_OPTIONS)[number]["value"];
export const INVENTORY_TASK_STATUS_VALUES = optionValues(INVENTORY_TASK_STATUS_OPTIONS);
export const INVENTORY_TASK_STATUS_LABEL_MAP = optionLabelMap(INVENTORY_TASK_STATUS_OPTIONS);
export const INVENTORY_TASK_STATUS_TONE_MAP = optionToneMap(INVENTORY_TASK_STATUS_OPTIONS);

export const INVENTORY_ITEM_STATUS_OPTIONS = [
  { value: "pending", label: "未盘点", tone: "info" },
  { value: "normal", label: "正常", tone: "success" },
  { value: "location_mismatch", label: "位置不符", tone: "warning" },
  { value: "not_found", label: "未找到", tone: "danger" },
  { value: "info_mismatch", label: "设备信息不符", tone: "danger" },
  { value: "other", label: "其他异常", tone: "warning" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryStatus = (typeof INVENTORY_ITEM_STATUS_OPTIONS)[number]["value"];
export const INVENTORY_ITEM_STATUS_VALUES = optionValues(INVENTORY_ITEM_STATUS_OPTIONS);
export const INVENTORY_ITEM_STATUS_LABEL_MAP = optionLabelMap(INVENTORY_ITEM_STATUS_OPTIONS);
export const INVENTORY_ITEM_STATUS_TONE_MAP = optionToneMap(INVENTORY_ITEM_STATUS_OPTIONS);
export const INVENTORY_EXCEPTION_STATUS_VALUES: InventoryStatus[] = INVENTORY_ITEM_STATUS_VALUES.filter(
  (status) => status !== "pending" && status !== "normal",
);

export const INVENTORY_RESOLUTION_STATUS_OPTIONS = [
  { value: "not_required", label: "无需处理", tone: "info" },
  { value: "pending", label: "待处理", tone: "warning" },
  { value: "resolved", label: "已处理", tone: "success" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryResolutionStatus = (typeof INVENTORY_RESOLUTION_STATUS_OPTIONS)[number]["value"];
export const INVENTORY_RESOLUTION_STATUS_VALUES = optionValues(INVENTORY_RESOLUTION_STATUS_OPTIONS);
export const INVENTORY_RESOLUTION_STATUS_LABEL_MAP = optionLabelMap(INVENTORY_RESOLUTION_STATUS_OPTIONS);
export const INVENTORY_RESOLUTION_STATUS_TONE_MAP = optionToneMap(INVENTORY_RESOLUTION_STATUS_OPTIONS);

export const INVENTORY_RESOLUTION_ACTION_OPTIONS = [
  { value: "update_asset", label: "更新资产台账", tone: "info" },
  { value: "keep_asset", label: "保持资产台账", tone: "info" },
  { value: "confirm_missing", label: "确认设备缺失", tone: "danger" },
  { value: "ignore", label: "忽略/误报", tone: "warning" },
] as const satisfies readonly BusinessOption<string>[];
export type InventoryResolutionAction = (typeof INVENTORY_RESOLUTION_ACTION_OPTIONS)[number]["value"];
export const INVENTORY_RESOLUTION_ACTION_VALUES = optionValues(INVENTORY_RESOLUTION_ACTION_OPTIONS);
export const INVENTORY_RESOLUTION_ACTION_LABEL_MAP = optionLabelMap(INVENTORY_RESOLUTION_ACTION_OPTIONS);

export const RACK_STATUS_OPTIONS = [
  { value: "in_use", label: "在用", tone: "success" },
  { value: "reserved", label: "预留", tone: "warning" },
  { value: "disabled", label: "停用", tone: "info" },
] as const satisfies readonly BusinessOption<string>[];
export type RackStatus = (typeof RACK_STATUS_OPTIONS)[number]["value"];
export const RACK_STATUS_VALUES = optionValues(RACK_STATUS_OPTIONS);
export const RACK_STATUS_LABEL_MAP = optionLabelMap(RACK_STATUS_OPTIONS);
export const RACK_STATUS_TONE_MAP = optionToneMap(RACK_STATUS_OPTIONS);

export const STOCK_OPERATION_OPTIONS = [
  { value: "initial", label: "初始库存", tone: "info" },
  { value: "inbound", label: "入库", tone: "success" },
  { value: "outbound", label: "出库", tone: "warning" },
  { value: "transfer", label: "调拨", tone: "info" },
  { value: "adjustment", label: "调整", tone: "info" },
  { value: "scrap", label: "报废", tone: "danger" },
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
  { value: "normal", label: "正常", tone: "success" },
  { value: "expiring", label: "即将到期", tone: "warning" },
  { value: "expired", label: "已过期", tone: "danger" },
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
