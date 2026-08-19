import { computed, ref, type Ref } from "vue";
import type { DashboardOverview } from "../types";

export interface DashboardApi {
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
}

export function useDashboard(api: DashboardApi) {
  const dashboard = ref<DashboardOverview | null>(null);
  const dashboardLoading = ref(false);

  async function loadDashboardData(version = api.beginLoad()) {
    dashboardLoading.value = true;
    try {
      const result = await api.request<DashboardOverview>("/reports/dashboard/");
      if (api.isCurrentLoad(version)) dashboard.value = result;
    } finally {
      if (api.isCurrentLoad(version)) dashboardLoading.value = false;
    }
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
    return new Date(value).toLocaleDateString("zh-CN");
  }

  function dashboardDateTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function dashboardAlertLevel(level: string) {
    return level === "critical" ? "严重" : level === "warning" ? "警告" : "提醒";
  }

  return {
    dashboard,
    dashboardLoading,
    loadDashboardData,
    maxDashboardStatusCount,
    dashboardBarPercent,
    dashboardDate,
    dashboardDateTime,
    dashboardAlertLevel,
  };
}
