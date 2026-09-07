import { reactive } from "vue";
import { currentLocale } from "./i18n";
import type { AssetStatus, CurrencyCode, DateFormat, SystemLocale, SystemSettings } from "./types";

/** Small shared snapshot for defaults consumed by more than one composable. */
export const systemSettingsState = reactive({
  defaultPageSize: 50,
  defaultAssetStatus: "in_stock" as AssetStatus,
  defaultLocale: "zh-CN" as SystemLocale,
  timezone: "Asia/Shanghai",
  dateFormat: "YYYY-MM-DD" as DateFormat,
  currency: "CNY" as CurrencyCode,
  passwordMinLength: 8,
  loaded: false,
});

export const currencySymbols: Record<CurrencyCode, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
};

function safeTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "Asia/Shanghai";
  }
}

function dateParts(value: string | number | Date, includeTime: boolean) {
  const source = value instanceof Date
    ? value
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00Z`)
      : new Date(value);
  if (Number.isNaN(source.getTime())) return null;
  const parts = new Intl.DateTimeFormat(currentLocale.value, {
    timeZone: safeTimeZone(systemSettingsState.timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
      : {}),
  }).formatToParts(source);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values;
}

export function systemDateKey(value: string | number | Date = new Date()): string {
  const parts = dateParts(value, false);
  if (!parts?.year || !parts.month || !parts.day) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatSystemDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const parts = dateParts(value, false);
  if (!parts) return String(value);
  if (systemSettingsState.dateFormat === "DD/MM/YYYY") {
    return `${parts.day}/${parts.month}/${parts.year}`;
  }
  if (systemSettingsState.dateFormat === "MM/DD/YYYY") {
    return `${parts.month}/${parts.day}/${parts.year}`;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatSystemDateTime(
  value: string | number | Date | null | undefined,
  includeSeconds = false,
): string {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const parts = dateParts(value, includeSeconds);
  if (!parts) return String(value);
  return `${formatSystemDate(value)} ${parts.hour}:${parts.minute}${includeSeconds ? `:${parts.second}` : ""}`;
}

export function currencySymbol(value: CurrencyCode = systemSettingsState.currency): string {
  return currencySymbols[value] || currencySymbols.CNY;
}

export function applySystemSettings(settings: SystemSettings): void {
  if (Number.isFinite(settings.default_page_size)) {
    systemSettingsState.defaultPageSize = settings.default_page_size;
  }
  if (typeof settings.default_asset_status === "string") {
    systemSettingsState.defaultAssetStatus = settings.default_asset_status;
  }
  if (settings.default_locale === "zh-CN" || settings.default_locale === "en-US") {
    systemSettingsState.defaultLocale = settings.default_locale;
  }
  if (typeof settings.timezone === "string" && settings.timezone.trim()) {
    systemSettingsState.timezone = safeTimeZone(settings.timezone.trim());
  }
  if (["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"].includes(settings.date_format)) {
    systemSettingsState.dateFormat = settings.date_format;
  }
  if (settings.currency in currencySymbols) {
    systemSettingsState.currency = settings.currency;
  }
  if (Number.isFinite(settings.password_min_length)) {
    systemSettingsState.passwordMinLength = Math.max(8, settings.password_min_length);
  }
  systemSettingsState.loaded = true;
}
