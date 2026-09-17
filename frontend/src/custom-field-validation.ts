import type { CustomFieldFormat } from "./types";

export const CUSTOM_FIELD_NUMBER_MAX_DIGITS = 20;
export const CUSTOM_FIELD_NUMBER_STORAGE_DECIMAL_PLACES = 6;
export const CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES = 2;
export const CUSTOM_FIELD_NUMBER_MAX_INTEGER_DIGITS =
  CUSTOM_FIELD_NUMBER_MAX_DIGITS - CUSTOM_FIELD_NUMBER_STORAGE_DECIMAL_PLACES;

export const CUSTOM_FIELD_FORMATS: readonly CustomFieldFormat[] = [
  "any",
  "alpha",
  "alpha_dash",
  "numeric",
  "alpha_numeric",
  "email",
  "date",
  "url",
  "ip",
  "ipv4",
  "ipv6",
  "mac",
  "regex",
];

const CUSTOM_FIELD_MAC_PATTERN = /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$|^(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}$/;

export function isCustomFieldFormat(value: unknown): value is CustomFieldFormat {
  return typeof value === "string" && CUSTOM_FIELD_FORMATS.includes(value as CustomFieldFormat);
}

/** Return an error message when a custom regex cannot be compiled. */
export function customFieldFormatPatternError(pattern: unknown): string | null {
  if (typeof pattern !== "string" || !pattern.trim()) return "required";
  if (pattern.length > 500) return "too_long";
  try {
    new RegExp(`^(?:${pattern})$`);
    return null;
  } catch {
    return "invalid";
  }
}

function customFieldIpMatches(value: string, format: CustomFieldFormat): boolean {
  if (format === "ipv4") return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255);
  if (format === "ipv6") return value.includes(":") && /^[0-9A-Fa-f:]+$/.test(value);
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || (value.includes(":") && /^[0-9A-Fa-f:]+$/.test(value));
}

/** Match the browser-side input formats; the backend remains authoritative. */
export function customFieldFormatMatches(
  value: unknown,
  format: CustomFieldFormat = "any",
  pattern?: unknown,
): boolean {
  if (typeof value !== "string") return false;
  if (format === "any") return true;
  if (format === "alpha") return /^[A-Za-z]+$/.test(value);
  if (format === "alpha_dash") return /^[A-Za-z0-9_-]+$/.test(value);
  if (format === "numeric") return parseDecimalText(value) !== null;
  if (format === "alpha_numeric") return /^[A-Za-z0-9]+$/.test(value);
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "date") return isValidIsoDate(value);
  if (format === "url") {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }
  if (format === "ip" || format === "ipv4" || format === "ipv6") return customFieldIpMatches(value, format);
  if (format === "mac") return CUSTOM_FIELD_MAC_PATTERN.test(value);
  if (format === "regex") {
    if (customFieldFormatPatternError(pattern)) return false;
    try {
      return new RegExp(`^(?:${String(pattern)})$`).test(value);
    } catch {
      return false;
    }
  }
  return false;
}

export type DecimalTextInfo = {
  sign: 1 | -1;
  digits: string;
  scale: number;
  integerDigits: number;
  decimalPlaces: number;
};

const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

/** Parse decimal text without converting it through JavaScript Number. */
export function parseDecimalText(value: unknown): DecimalTextInfo | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return null;

  const exponent = match[5] ? Number(match[5]) : 0;
  if (!Number.isSafeInteger(exponent)) return null;
  const integerPart = match[2] || "0";
  const fractionPart = match[3] ?? match[4] ?? "";
  let digits = `${integerPart}${fractionPart}`.replace(/^0+/, "") || "0";
  let scale = fractionPart.length - exponent;
  if (!Number.isSafeInteger(scale)) return null;

  if (digits === "0") {
    return { sign: 1, digits, scale: 0, integerDigits: 1, decimalPlaces: 0 };
  }

  while (scale > 0 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale -= 1;
  }

  return {
    sign: match[1] === "-" ? -1 : 1,
    digits,
    scale,
    integerDigits: Math.max(1, digits.length - scale),
    decimalPlaces: Math.max(0, scale),
  };
}

/** Compare two decimal strings. Returns null when either value is invalid. */
export function compareDecimalText(left: unknown, right: unknown): -1 | 0 | 1 | null {
  const a = parseDecimalText(left);
  const b = parseDecimalText(right);
  if (!a || !b) return null;
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;

  const aIntegerDigits = a.digits.length - a.scale;
  const bIntegerDigits = b.digits.length - b.scale;
  let result: -1 | 0 | 1 = 0;
  if (aIntegerDigits !== bIntegerDigits) {
    result = aIntegerDigits < bIntegerDigits ? -1 : 1;
  } else {
    const length = Math.max(a.digits.length, b.digits.length);
    for (let index = 0; index < length; index += 1) {
      const aDigit = a.digits[index] || "0";
      const bDigit = b.digits[index] || "0";
      if (aDigit === bDigit) continue;
      result = aDigit < bDigit ? -1 : 1;
      break;
    }
  }
  return a.sign === 1 ? result : result === 0 ? 0 : result === 1 ? -1 : 1;
}

export type DecimalStorageIssue = "invalid" | "integer" | "precision";

export function decimalPrecisionLimit(value: unknown = CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES): number {
  const requestedPrecision = Number(value);
  if (!Number.isFinite(requestedPrecision)) return CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES;
  return Math.min(
    CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES,
    Math.max(0, Math.trunc(requestedPrecision)),
  );
}

/** Validate the strict YYYY-MM-DD format used by Django's date parser. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function decimalStorageIssue(
  value: unknown,
  precision = CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES,
): DecimalStorageIssue | null {
  const parsed = parseDecimalText(value);
  if (!parsed) return "invalid";
  if (parsed.integerDigits > CUSTOM_FIELD_NUMBER_MAX_INTEGER_DIGITS) return "integer";
  const allowedPrecision = decimalPrecisionLimit(precision);
  if (parsed.decimalPlaces > allowedPrecision) return "precision";
  return null;
}
