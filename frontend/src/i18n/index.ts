import { computed } from "vue";
import { createI18n } from "vue-i18n";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = "itam.locale";

function browserLocale(): Locale {
  if (typeof navigator === "undefined") return "zh-CN";
  const value = String(navigator.language || "").toLowerCase();
  if (value.startsWith("en")) return "en-US";
  if (value.startsWith("zh")) return "zh-CN";
  return "zh-CN";
}

export function normalizeLocale(value: unknown): Locale {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en-US";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  return "zh-CN";
}

function storedLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return value ? normalizeLocale(value) : null;
  } catch {
    return null;
  }
}

export function resolveInitialLocale(): Locale {
  return storedLocale() || browserLocale();
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveInitialLocale(),
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
  },
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

export const currentLocale = i18n.global.locale;
export const elementPlusLocale = computed(() => (
  currentLocale.value === "en-US" ? en : zhCn
));

export function setLocale(value: unknown, persist = true): Locale {
  const nextLocale = normalizeLocale(value);
  i18n.global.locale.value = nextLocale;
  if (typeof document !== "undefined") document.documentElement.lang = nextLocale;
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // A restricted browser storage context should not block language use.
    }
  }
  return nextLocale;
}

export function localeLabel(locale: Locale): string {
  return locale === "en-US" ? "English" : "简体中文";
}

setLocale(currentLocale.value, false);
