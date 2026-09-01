import { computed } from "vue";
import { createI18n } from "vue-i18n";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";
import zhCN from "./locales/zh-CN";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = "infrix.locale";
type LocaleMessages = typeof zhCN;

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

const initialMessages: Record<Locale, LocaleMessages> = {
  "zh-CN": zhCN,
  "en-US": {} as LocaleMessages,
};

export const i18n = createI18n({
  legacy: false,
  locale: resolveInitialLocale(),
  fallbackLocale: "zh-CN",
  messages: initialMessages,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

export const currentLocale = i18n.global.locale;
export const elementPlusLocale = computed(() => (
  currentLocale.value === "en-US" ? en : zhCn
));

const localeLoaders: Partial<Record<Locale, () => Promise<{ default: LocaleMessages }>>> = {
  "en-US": () => import("./locales/en-US").then(({ default: messages }) => ({
    default: messages as unknown as LocaleMessages,
  })),
};
const loadedLocales = new Set<Locale>(["zh-CN"]);
const localeMessagePromises = new Map<Locale, Promise<Locale>>();

export function loadLocaleMessages(value: unknown): Promise<Locale> {
  const nextLocale = normalizeLocale(value);
  if (loadedLocales.has(nextLocale)) return Promise.resolve(nextLocale);

  const existing = localeMessagePromises.get(nextLocale);
  if (existing) return existing;

  const loader = localeLoaders[nextLocale];
  if (!loader) return Promise.resolve(nextLocale);

  const promise = loader().then(({ default: messages }) => {
    i18n.global.setLocaleMessage(nextLocale, messages);
    loadedLocales.add(nextLocale);
    return nextLocale;
  }).catch((error) => {
    localeMessagePromises.delete(nextLocale);
    throw error;
  });
  localeMessagePromises.set(nextLocale, promise);
  return promise;
}

export function setLocale(value: unknown, persist = true): Locale {
  const nextLocale = normalizeLocale(value);
  i18n.global.locale.value = nextLocale;
  void loadLocaleMessages(nextLocale).catch(() => undefined);
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
