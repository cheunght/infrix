import type { DepreciationStatus } from "./types";

export const DEPRECIATION_METHOD_STRAIGHT_LINE = "straight_line" as const;

export const DEPRECIATION_STATUS_LABELS: Record<DepreciationStatus, string> = {
  unconfigured: "未配置",
  not_started: "尚未开始",
  depreciating: "折旧中",
  fully_depreciated: "已折旧完",
};

export const DEPRECIATION_METHOD_LABELS: Record<string, string> = {
  [DEPRECIATION_METHOD_STRAIGHT_LINE]: "直线法",
};

type DecimalParts = { integer: string; fraction: string };

function decimalParts(value: unknown): DecimalParts | null {
  const text = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return {
    integer: match[1].replace(/^0+(?=\d)/, "") || "0",
    fraction: (match[2] || "").replace(/0+$/, ""),
  };
}

function decimalText(integer: string, fraction: string): string {
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function shiftDecimal(parts: DecimalParts, places: number): string {
  const digits = `${parts.integer}${parts.fraction}` || "0";
  const decimalIndex = parts.integer.length + places;
  if (decimalIndex <= 0) return decimalText("0", `${"0".repeat(-decimalIndex)}${digits}`);
  if (decimalIndex >= digits.length) return decimalText(`${digits}${"0".repeat(decimalIndex - digits.length)}`, "");
  return decimalText(digits.slice(0, decimalIndex), digits.slice(decimalIndex));
}

function isAtMostOneHundred(parts: DecimalParts): boolean {
  if (parts.integer.length > 3) return false;
  if (parts.integer.length < 3) return true;
  if (parts.integer !== "100") return parts.integer < "100";
  return parts.fraction.length === 0;
}

/** Convert the user-facing percentage (5) to the API rate (0.05) exactly. */
export function percentageToRate(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parts = decimalParts(value);
  if (!parts || parts.fraction.length > 2 || !isAtMostOneHundred(parts)) return null;
  return shiftDecimal(parts, -2);
}

/** Convert the API rate (0.0500) to the user-facing percentage (5). */
export function rateToPercentageText(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parts = decimalParts(value);
  if (!parts) return null;
  return shiftDecimal(parts, 2);
}

export function formatResidualRate(value: unknown): string {
  const percentage = rateToPercentageText(value);
  return percentage === null ? "—" : `${percentage}%`;
}

export function isPositiveDecimalString(value: unknown): boolean {
  const text = String(value ?? "").trim();
  const parts = decimalParts(text);
  return Boolean(parts && `${parts.integer}${parts.fraction}`.replace(/0/g, ""));
}

export function formatMoneyDecimalString(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return text;
  const integer = match[2].replace(/^0+(?=\d)/, "") || "0";
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = `${match[3] || ""}00`.slice(0, 2);
  return `${match[1] === "-" ? "-" : ""}¥${grouped}.${fraction}`;
}

function fractionPercentageText(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parts = decimalParts(value);
  return parts ? shiftDecimal(parts, 2) : null;
}

export function formatDepreciationProgress(
  progress: unknown,
  elapsedMonths?: number | null,
  totalMonths?: number | null,
): string {
  const fromBackend = fractionPercentageText(progress);
  if (fromBackend !== null) return `${fromBackend}%`;
  if (!totalMonths || totalMonths <= 0 || elapsedMonths == null) return "—";
  const fallback = Math.min(100, Math.max(0, Math.round((elapsedMonths / totalMonths) * 100)));
  return `${fallback}%`;
}

export function depreciationStatusLabel(value: string | null | undefined): string {
  return value && value in DEPRECIATION_STATUS_LABELS
    ? DEPRECIATION_STATUS_LABELS[value as DepreciationStatus]
    : "—";
}

export function depreciationMethodLabel(value: string | null | undefined): string {
  return value ? DEPRECIATION_METHOD_LABELS[value] || value : "—";
}
