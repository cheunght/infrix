import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { isAbortError } from "../api";
import type { OperationalAlert, OperationalAlertsResponse } from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
import { normalizeApiError } from "../error-handling";
import { i18n } from "../i18n";

const READ_ALERTS_PREFIX = "infrix.alerts.read";
const MAX_SAVED_READ_IDS = 200;
const NOTIFICATION_REFRESH_INTERVAL_MS = 60_000;

export interface NotificationsDeps {
  request: RequestFn;
  can: CapabilityFn;
  username: Ref<string>;
}

function readStorageIds(key: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

export function useNotifications(deps: NotificationsDeps) {
  const alerts = ref<OperationalAlert[]>([]);
  const summary = ref<OperationalAlertsResponse["summary"]>({
    total: 0,
    critical: 0,
    warning: 0,
    notice: 0,
  });
  const loading = ref(false);
  const error = ref("");
  const generatedAt = ref<string | null>(null);
  const readAlertIds = ref<Set<string>>(new Set());
  let requestId = 0;
  let notificationsController: AbortController | null = null;
  let lastLoadedAt = 0;

  function storageKey() {
    return `${READ_ALERTS_PREFIX}.${deps.username.value || "anonymous"}`;
  }

  function loadReadAlertIds() {
    readAlertIds.value = readStorageIds(storageKey());
  }

  function persistReadAlertIds() {
    try {
      localStorage.setItem(
        storageKey(),
        JSON.stringify([...readAlertIds.value].slice(-MAX_SAVED_READ_IDS)),
      );
    } catch {
      // Local storage is an enhancement; a blocked storage context must not
      // prevent the notification center from loading.
    }
  }

  async function loadNotifications(force = false) {
    if (!deps.can("dashboard.view")) return false;
    if (loading.value) return false;
    if (!force && lastLoadedAt > 0 && Date.now() - lastLoadedAt < NOTIFICATION_REFRESH_INTERVAL_MS) {
      return true;
    }
    const currentRequestId = ++requestId;
    notificationsController?.abort();
    const controller = new AbortController();
    notificationsController = controller;
    loading.value = true;
    error.value = "";
    try {
      // Keep the notification request independent from page-level loading.
      // Navigating to another page should not cancel the header badge refresh.
      const response = await deps.request<OperationalAlertsResponse>(
        "/reports/alerts/",
        { signal: controller.signal },
      );
      if (currentRequestId !== requestId) return false;
      alerts.value = response.alerts || [];
      summary.value = response.summary || {
        total: alerts.value.length,
        critical: 0,
        warning: 0,
        notice: 0,
      };
      generatedAt.value = response.generated_at || null;
      loadReadAlertIds();
      lastLoadedAt = Date.now();
      return true;
    } catch (reason) {
      if (currentRequestId === requestId && !isAbortError(reason)) {
        const normalized = normalizeApiError(reason);
        error.value = normalized.kind === "unknown"
          ? i18n.global.t("notifications.loadFailed")
          : normalized.message;
      }
      return false;
    } finally {
      if (currentRequestId === requestId) loading.value = false;
      if (notificationsController === controller) notificationsController = null;
    }
  }

  function markRead(alertId: string) {
    const next = new Set(readAlertIds.value);
    next.add(alertId);
    readAlertIds.value = next;
    persistReadAlertIds();
  }

  function markAllRead() {
    const next = new Set(readAlertIds.value);
    alerts.value.forEach((alert) => next.add(alert.id));
    readAlertIds.value = next;
    persistReadAlertIds();
  }

  const unreadCount = computed(() => alerts.value.reduce(
    (count, alert) => count + (readAlertIds.value.has(alert.id) ? 0 : 1),
    0,
  ));

  function isRead(alertId: string) {
    return readAlertIds.value.has(alertId);
  }

  watch(deps.username, () => {
    requestId += 1;
    notificationsController?.abort();
    notificationsController = null;
    loading.value = false;
    alerts.value = [];
    summary.value = { total: 0, critical: 0, warning: 0, notice: 0 };
    generatedAt.value = null;
    error.value = "";
    lastLoadedAt = 0;
    loadReadAlertIds();
  }, { immediate: true });
  onBeforeUnmount(() => notificationsController?.abort());

  return {
    alerts,
    summary,
    loading,
    error,
    generatedAt,
    unreadCount,
    isRead,
    loadNotifications,
    markRead,
    markAllRead,
  };
}
