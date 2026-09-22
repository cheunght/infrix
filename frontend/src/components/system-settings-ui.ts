import { ASSET_STATUS_OPTIONS, businessOptionLabel } from "../business-enums";
import { SYSTEM_SETTING_DEFINITIONS } from "../system-settings-config";

export type Translate = (key: string) => string;

const LABEL_KEYS: Record<string, string> = {
  default_page_size: "settings.defaultPageSize",
  default_asset_status: "settings.defaultAssetStatus",
  default_locale: "settings.defaultLocale",
  date_format: "settings.dateFormat",
  currency: "settings.currency",
  password_min_length: "settings.passwordMinLength",
  password_expiry_days: "settings.passwordExpiryDays",
  login_max_attempts: "settings.loginMaxAttempts",
  login_window_seconds: "settings.loginWindowSeconds",
  login_lock_seconds: "settings.loginLockSeconds",
  smtp_enabled: "settings.smtpEnabled",
  smtp_host: "settings.smtpHost",
  smtp_port: "settings.smtpPort",
  smtp_security_mode: "settings.smtpSecurityMode",
  smtp_username: "settings.smtpUsername",
  smtp_from_email: "settings.smtpFromEmail",
  smtp_from_name: "settings.smtpFromName",
  smtp_timeout: "settings.smtpTimeout",
  notify_maintenance: "settings.notifyMaintenance",
  maintenance_expiry_days: "settings.maintenanceExpiryDays",
  notify_license_expiry: "settings.notifyLicenseExpiry",
  license_expiry_days: "settings.licenseExpiryDays",
  notify_open_faults: "settings.notifyOpenFaults",
  notify_overdue_inventory: "settings.notifyOverdueInventory",
  notify_low_spare_stock: "settings.notifyLowSpareStock",
};

const HELP_KEYS: Record<string, string> = {
  default_page_size: "settings.defaultPageSizeHelp",
  default_asset_status: "settings.defaultAssetStatusHelp",
  default_locale: "settings.defaultLocaleHelp",
  date_format: "settings.dateFormatHelp",
  currency: "settings.currencyHelp",
  password_min_length: "settings.passwordMinLengthHelp",
  password_expiry_days: "settings.passwordExpiryDaysHelp",
  login_max_attempts: "settings.loginMaxAttemptsHelp",
  login_window_seconds: "settings.loginWindowSecondsHelp",
  login_lock_seconds: "settings.loginLockSecondsHelp",
  smtp_enabled: "settings.smtpEnabledHelp",
  smtp_host: "settings.smtpHostHelp",
  smtp_port: "settings.smtpPortHelp",
  smtp_security_mode: "settings.smtpSecurityModeHelp",
  smtp_username: "settings.smtpUsernameHelp",
  smtp_from_email: "settings.smtpFromEmailHelp",
  smtp_from_name: "settings.smtpFromNameHelp",
  smtp_timeout: "settings.smtpTimeoutHelp",
  notify_maintenance: "settings.notifyMaintenanceHelp",
  maintenance_expiry_days: "settings.maintenanceExpiryDaysHelp",
  notify_license_expiry: "settings.notifyLicenseExpiryHelp",
  license_expiry_days: "settings.licenseExpiryDaysHelp",
  notify_open_faults: "settings.notifyOpenFaultsHelp",
  notify_overdue_inventory: "settings.notifyOverdueInventoryHelp",
  notify_low_spare_stock: "settings.notifyLowSpareStockHelp",
};

const OPTION_KEYS: Record<string, string> = {
  "default_locale:zh-CN": "settings.localeZhCN",
  "default_locale:en-US": "settings.localeEnUS",
  "date_format:YYYY-MM-DD": "settings.dateFormatYmd",
  "date_format:DD/MM/YYYY": "settings.dateFormatDmy",
  "date_format:MM/DD/YYYY": "settings.dateFormatMdy",
  "currency:CNY": "settings.currencyCny",
  "currency:USD": "settings.currencyUsd",
  "currency:EUR": "settings.currencyEur",
  "currency:GBP": "settings.currencyGbp",
  "currency:JPY": "settings.currencyJpy",
  "currency:HKD": "settings.currencyHkd",
  "smtp_security_mode:none": "settings.smtpSecurityNone",
  "smtp_security_mode:starttls": "settings.smtpSecurityStarttls",
  "smtp_security_mode:ssl": "settings.smtpSecuritySsl",
};

export function systemSettingDefinition(key: string) {
  return SYSTEM_SETTING_DEFINITIONS.find((definition) => definition.key === key);
}

export function systemSettingLabel(key: string, t: Translate): string {
  return LABEL_KEYS[key] ? t(LABEL_KEYS[key]) : systemSettingDefinition(key)?.label || key;
}

export function systemSettingHelp(key: string, t: Translate): string {
  return HELP_KEYS[key] ? t(HELP_KEYS[key]) : systemSettingDefinition(key)?.help_text || "";
}

export function systemSettingOptionLabel(
  key: string,
  option: { value: string | number | boolean; label: string },
  t: Translate,
): string {
  if (key === "default_asset_status") return businessOptionLabel(ASSET_STATUS_OPTIONS, String(option.value));
  const translationKey = OPTION_KEYS[`${key}:${String(option.value)}`];
  return translationKey ? t(translationKey) : String(option.label);
}
