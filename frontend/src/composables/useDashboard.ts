import { computed, ref } from "vue";
import { isAbortError } from "../api";
import type { DashboardOverview } from "../types";
import type { CapabilityFn } from "../types/page-context";
import { currentLocale, i18n } from "../i18n";

export interface DashboardApi {
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  can: CapabilityFn;
}

export function useDashboard(api: DashboardApi) {
  const dashboard = ref<DashboardOverview | null>(null);
  const dashboardLoading = ref(false);
  const dashboardError = ref("");
  const dashboardUpdatedAt = ref<string | null>(null);

  async function loadDashboardData(version = api.beginLoad()): Promise<boolean> {
    if (!api.can("dashboard.view")) return false;
    dashboardLoading.value = true;
    dashboardError.value = "";
    try {
      const result = await api.request<DashboardOverview>("/reports/dashboard/");
      if (!api.isCurrentLoad(version)) return false;
      if (result == null) throw new Error(i18n.global.t("common.noData"));
      dashboard.value = result;
      dashboardUpdatedAt.value = new Date().toISOString();
      return true;
    } catch (error) {
      if (api.isCurrentLoad(version) && !isAbortError(error)) {
        dashboardError.value = error instanceof Error && error.message
          ? error.message
          : i18n.global.t("dashboard.dataLoadFailed");
      }
      return false;
    } finally {
      if (api.isCurrentLoad(version)) dashboardLoading.value = false;
    }
  }

  function refreshDashboard() {
    return loadDashboardData();
  }

  const maxDashboardStatusCount = computed(() =>
    Math.max(
      1,
      ...(dashboard.value?.status_distribution || []).map((item) => item.count),
    ),
  );

  function dashboardBarPercent(value: number, maximum: number) {
    return `${Math.max(
      value ? 2 : 0,
      Math.min(100, (value / Math.max(maximum, 1)) * 100),
    )}%`;
  }

  function dashboardDate(value: string) {
    return new Date(value).toLocaleDateString(currentLocale.value);
  }

  function dashboardDateTime(value: string) {
    return new Date(value).toLocaleString(currentLocale.value, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function dashboardAlertLevel(level: string) {
    return level === "critical"
      ? i18n.global.t("dashboard.critical")
      : level === "warning"
        ? i18n.global.t("dashboard.warning")
        : i18n.global.t("dashboard.notice");
  }

  return {
    dashboard,
    dashboardLoading,
    dashboardError,
    dashboardUpdatedAt,
    loadDashboardData,
    refreshDashboard,
    maxDashboardStatusCount,
    dashboardBarPercent,
    dashboardDate,
    dashboardDateTime,
    dashboardAlertLevel,
  };
}
