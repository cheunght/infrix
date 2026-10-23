import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";
import type { RackSharedContext } from "../page-context";
import type { Rack } from "../types";
import type { PlacementOptions } from "./useRackOperations";
import { ApiError, isAbortError } from "../api";

export const RACK_COMPARE_LIMIT = 4;
export type RackComparisonEntry = {
  id: number;
  rack: Rack | null;
  options: PlacementOptions | null;
  loading: boolean;
  failed: boolean;
};

/** URL selection and fresh, scoped snapshots; never use list rows as occupancy data. */
export function useRackComparison(
  context: RackSharedContext,
  route: RouteLocationNormalizedLoaded,
  router: Router,
  placementRevision: Ref<number>,
) {
  const selection = computed(() => {
    const value = route.query.compare;
    if (value == null || value === "")
      return { ids: [] as number[], invalid: false };
    if (typeof value !== "string") return { ids: [], invalid: true };
    const parts = value.split(",");
    const ids = parts.map(Number);
    const invalid =
      parts.length > RACK_COMPARE_LIMIT ||
      parts.some((part) => !/^[1-9]\d*$/.test(part)) ||
      ids.some((id) => !Number.isSafeInteger(id)) ||
      new Set(ids).size !== ids.length;
    return { ids: invalid ? [] : ids, invalid };
  });
  const ids = computed(() => selection.value.ids);
  const invalid = computed(() => selection.value.invalid);
  const active = computed(() => ids.value.length >= 2);
  const entries = ref<RackComparisonEntry[]>([]);
  const loading = ref(false);
  const coolingDown = ref(false);
  let generation = 0,
    alive = true;
  let selectionQueue: Promise<void> = Promise.resolve();
  let controller: AbortController | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAt = 0;
  let snapshotAccount = context.currentUsername.value;

  function stop() {
    ++generation;
    controller?.abort();
    controller = null;
    entries.value = [];
    loading.value = false;
  }
  async function refresh() {
    const previous = snapshotAccount === context.currentUsername.value ? entries.value : [];
    snapshotAccount = context.currentUsername.value;
    stop();
    if (
      !alive ||
      !context.currentUsername.value ||
      !context.can("racks.view") ||
      invalid.value
    )
      return;
    entries.value = ids.value.map((id) => ({
      id,
      rack: previous.find((entry) => entry.id === id)?.rack || null,
      options: previous.find((entry) => entry.id === id)?.options || null,
      loading: false,
      failed: false,
    }));
    if (coolingDown.value) return;
    const version = generation;
    const requestController = new AbortController();
    controller = requestController;
    loading.value = ids.value.length > 0;
    await Promise.all(
      entries.value.map(async (entry) => {
        entry.loading = true;
        try {
          const [rack, options] = await Promise.all([
            context.request<Rack>(`/racks/${entry.id}/`, {
              signal: requestController.signal,
            }),
            context.request<PlacementOptions>(
              `/racks/${entry.id}/placement-options/`,
              { signal: requestController.signal },
            ),
          ]);
          if (!alive || version !== generation) return;
          entry.rack = rack;
          entry.options = options;
        } catch (cause) {
          if (!alive || version !== generation || isAbortError(cause)) return;
          entry.rack = null;
          entry.options = null;
          entry.failed = true;
          if (cause instanceof ApiError && cause.status === 503) {
            coolingDown.value = true;
            const delay = Number.isFinite(cause.retryAfterMs)
              ? Math.max(1000, cause.retryAfterMs)
              : 1000;
            retryAt = Math.max(retryAt, Date.now() + delay);
            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(
              () => {
                coolingDown.value = false;
              },
              Math.min(2147483647, Math.max(0, retryAt - Date.now())),
            );
          }
        } finally {
          if (alive && version === generation) entry.loading = false;
        }
      }),
    );
    if (alive && version === generation) loading.value = false;
  }
  async function setSelection(next: number[]) {
    await router.replace({
      query: {
        ...route.query,
        compare: next.length ? next.join(",") : undefined,
      },
    });
  }
  function updateSelection(update: (current: number[]) => number[]) {
    const account = context.currentUsername.value;
    selectionQueue = selectionQueue
      .catch(() => {})
      .then(async () => {
        if (!alive || account !== context.currentUsername.value) return;
        await setSelection(update(ids.value));
      });
    return selectionQueue;
  }
  function toggle(id: number) {
    return updateSelection((current) => {
      if (!Number.isSafeInteger(id) || id < 1) return current;
      return current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= RACK_COMPARE_LIMIT
          ? current
          : [...current, id];
    });
  }
  function clear() {
    return updateSelection(() => []);
  }
  watch(
    [
      () => route.query.compare,
      placementRevision,
      context.currentUsername,
      () => context.can("racks.view"),
    ],
    () => {
      void refresh();
    },
    { immediate: true, flush: "sync" },
  );
  onBeforeUnmount(() => {
    alive = false;
    stop();
    if (cooldownTimer) clearTimeout(cooldownTimer);
  });
  return {
    ids,
    invalid,
    active,
    entries,
    loading,
    coolingDown,
    toggle,
    clear,
    refresh,
  };
}
export type RackComparison = ReturnType<typeof useRackComparison>;
