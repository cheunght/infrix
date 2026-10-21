import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { RackSharedContext } from "../page-context";
import type { PositionRange } from "./useRackOperations";
import { ApiError, isAbortError } from "../api";

export type RackCapacityPlan = {
  rack_id: number;
  status: "ready";
  capacity: number;
  planned_quantity: number;
  placements: Array<PositionRange & { sequence: number }>;
  total_u: number;
  used_u_before: number;
  free_u_before: number;
  used_u_after: number;
  free_u_after: number;
  utilization_after: number;
  available_ranges_after: PositionRange[];
  gap_ranges_after: PositionRange[];
};
export type RackCapacityResult = {
  height_u: number;
  quantity: number;
  allocated_quantity: number;
  unallocated_quantity: number;
  excluded_racks: number;
  available_capacity: number;
  generated_at: string;
  plans: Array<
    RackCapacityPlan | { rack_id: number; status: "restricted" | "unavailable" }
  >;
};

export function useRackCapacityPlanning(
  context: RackSharedContext,
  rackIds: Ref<number[]>,
  placementRevision: Ref<number>,
) {
  const visible = ref(false),
    loading = ref(false),
    coolingDown = ref(false);
  const height = ref<number | undefined>(1),
    quantity = ref<number | undefined>(1);
  const result = ref<RackCapacityResult | null>(null),
    error = ref("");
  const valid = computed(
    () =>
      rackIds.value.length >= 1 &&
      rackIds.value.length <= 4 &&
      Number.isInteger(height.value) &&
      Number(height.value) >= 1 &&
      Number(height.value) <= 32767 &&
      Number.isInteger(quantity.value) &&
      Number(quantity.value) >= 1 &&
      Number(quantity.value) <= 500,
  );
  let generation = 0,
    alive = true;
  let controller: AbortController | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  function invalidate() {
    ++generation;
    controller?.abort();
    controller = null;
    result.value = null;
    error.value = "";
    loading.value = false;
  }
  function open() {
    if (!context.can("racks.view") || !rackIds.value.length) return;
    invalidate();
    visible.value = true;
  }
  function close() {
    visible.value = false;
    invalidate();
  }
  async function generate() {
    if (
      !visible.value ||
      !valid.value ||
      loading.value ||
      coolingDown.value ||
      !context.can("racks.view")
    )
      return;
    invalidate();
    const version = generation;
    controller = new AbortController();
    loading.value = true;
    try {
      const params = new URLSearchParams({
        rack_ids: rackIds.value.join(","),
        height_u: String(height.value),
        quantity: String(quantity.value),
      });
      const data = await context.request<RackCapacityResult>(
        `/racks/capacity-plan/?${params}`,
        { signal: controller.signal },
      );
      if (alive && version === generation) result.value = data;
    } catch (cause) {
      if (!alive || version !== generation || isAbortError(cause)) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof ApiError && cause.status === 503) {
        coolingDown.value = true;
        if (cooldownTimer) clearTimeout(cooldownTimer);
        const delay = Number.isFinite(cause.retryAfterMs)
          ? Math.max(1000, cause.retryAfterMs)
          : 1000;
        cooldownTimer = setTimeout(
          () => {
            coolingDown.value = false;
          },
          Math.min(2147483647, delay),
        );
      }
    } finally {
      if (alive && version === generation) loading.value = false;
    }
  }
  watch(
    [height, quantity, () => rackIds.value.join(","), placementRevision],
    invalidate,
    { flush: "sync" },
  );
  watch(
    [context.currentUsername, () => context.can("racks.view")],
    () => {
      close();
      height.value = 1;
      quantity.value = 1;
    },
    { flush: "sync" },
  );
  onBeforeUnmount(() => {
    alive = false;
    invalidate();
    if (cooldownTimer) clearTimeout(cooldownTimer);
  });
  return {
    visible,
    loading,
    coolingDown,
    height,
    quantity,
    result,
    error,
    valid,
    open,
    close,
    generate,
  };
}
export type RackCapacityPlanning = ReturnType<typeof useRackCapacityPlanning>;
