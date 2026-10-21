import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
  type InjectionKey,
  type Ref,
} from "vue";
import { ElMessage } from "element-plus";
import {
  ApiError,
  isAbortError,
  pageItems,
  pageTotal,
  type PageResult,
} from "../api";
import { revisionHeaders } from "../revision";
import { i18n } from "../i18n";
import type { RackSharedContext } from "../page-context";
import type { Rack, RackUnitReservation } from "../types";
import type { PlacementOptions } from "./useRackOperations";

const tr = (key: string) => String(i18n.global.t(key));
export const RackReservationsKey: InjectionKey<RackReservations> =
  Symbol("rack-reservations");

export function useRackReservations(
  c: RackSharedContext,
  revision: Ref<number>,
) {
  const visible = ref(false),
    loading = ref(false),
    busy = ref(false),
    uncertain = ref(false),
    coolingDown = ref(false);
  const rack = ref<Rack | null>(null),
    options = ref<PlacementOptions | null>(null);
  const rows = ref<RackUnitReservation[]>([]),
    total = ref(0),
    page = ref(1),
    status = ref("active");
  const start = ref<number | undefined>(1),
    height = ref<number | undefined>(1),
    purpose = ref(""),
    error = ref("");
  const end = computed(() => Number(start.value) + Number(height.value) - 1);
  const valid = computed(
    () =>
      !!rack.value &&
      options.value?.accepts_assets &&
      !loading.value &&
      !uncertain.value &&
      !coolingDown.value &&
      c.can("racks.manage") &&
      purpose.value.trim().length > 0 &&
      purpose.value.trim().length <= 200 &&
      Number.isInteger(start.value) &&
      Number.isInteger(height.value) &&
      Number(start.value) > 0 &&
      Number(height.value) > 0 &&
      !!options.value.available_ranges?.some(
        (span) =>
          Number(start.value) >= span.start_u && end.value <= span.end_u,
      ),
  );
  let generation = 0,
    writeGeneration = 0,
    alive = true;
  let controller: AbortController | null = null,
    timer: ReturnType<typeof setTimeout> | null = null;
  function cooldown(cause: unknown) {
    if (!(cause instanceof ApiError && cause.status === 503)) return;
    coolingDown.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => {
        coolingDown.value = false;
        timer = null;
      },
      Math.max(1000, cause.retryAfterMs),
    );
  }
  async function refresh() {
    if (!visible.value || !rack.value || busy.value || coolingDown.value)
      return;
    const id = rack.value.id,
      version = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    loading.value = true;
    error.value = "";
    options.value = null;
    rows.value = [];
    total.value = 0;
    try {
      const [detail, space, history] = await Promise.all([
        c.request<Rack>(`/racks/${id}/`, { signal }),
        c.request<PlacementOptions>(`/racks/${id}/placement-options/`, {
          signal,
        }),
        c.request<PageResult<RackUnitReservation>>(
          `/racks/${id}/reservations/?status=${status.value}&page=${page.value}&page_size=30`,
          { signal },
        ),
      ]);
      if (!alive || version !== generation) return;
      if (detail.occupancy_restricted)
        throw new Error(tr("dataScope.occupancyHint"));
      rack.value = detail;
      options.value = space;
      rows.value = pageItems(history);
      total.value = pageTotal(history);
      uncertain.value = false;
    } catch (cause) {
      if (alive && version === generation && !isAbortError(cause)) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        cooldown(cause);
      }
    } finally {
      if (version === generation) loading.value = false;
    }
  }
  async function open(value: Rack) {
    if (busy.value || !c.can("racks.view") || value.occupancy_restricted)
      return;
    rack.value = value;
    page.value = 1;
    status.value = "active";
    purpose.value = "";
    start.value = 1;
    height.value = 1;
    uncertain.value = false;
    visible.value = true;
    await refresh();
  }
  function close() {
    if (busy.value) return;
    visible.value = false;
    ++generation;
    controller?.abort();
    loading.value = false;
    options.value = null;
    rows.value = [];
    rack.value = null;
  }
  async function write(row?: RackUnitReservation) {
    if (
      !rack.value ||
      busy.value ||
      loading.value ||
      uncertain.value ||
      coolingDown.value ||
      !c.can("racks.manage") ||
      (!row && !valid.value)
    )
      return;
    const id = rack.value.id,
      account = c.currentUsername.value,
      version = ++writeGeneration;
    const current = () =>
      alive &&
      version === writeGeneration &&
      account === c.currentUsername.value;
    busy.value = true;
    error.value = "";
    try {
      await c.request(
        `/racks/${id}/reservations/${row ? `${row.id}/release/` : ""}`,
        {
          method: "POST",
          headers: revisionHeaders(row || rack.value),
          body: JSON.stringify(
            row
              ? {}
              : {
                  start_u: start.value,
                  end_u: end.value,
                  purpose: purpose.value.trim(),
                },
          ),
        },
      );
      if (!current()) return;
      revision.value += 1;
      ElMessage.success(
        tr(row ? "rackReserve.releasedMessage" : "rackReserve.createdMessage"),
      );
      if (!row) {
        purpose.value = "";
        page.value = 1;
        status.value = "active";
      }
      try {
        const [loaded, detail] = await Promise.all([
          c.loadRackView(),
          c.request<Rack>(`/racks/${id}/`),
        ]);
        if (current() && c.focusedRack.value?.id === id)
          c.focusRackDetail(detail);
        if (loaded === false) throw new Error();
      } catch {
        if (current()) ElMessage.warning(tr("rackOps.refreshFailed"));
      }
      if (current() && visible.value) {
        busy.value = false;
        await refresh();
      }
    } catch (cause) {
      if (!current()) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
      uncertain.value =
        !(cause instanceof ApiError) ||
        cause.status === 409 ||
        (cause.status >= 500 && cause.status !== 503);
      if (uncertain.value) error.value = tr("rackReserve.uncertain");
      cooldown(cause);
    } finally {
      if (current()) busy.value = false;
    }
  }
  function changePage(value: number) {
    if (!busy.value) {
      page.value = value;
      void refresh();
    }
  }
  function changeStatus() {
    if (!busy.value) {
      page.value = 1;
      void refresh();
    }
  }
  function reset() {
    ++writeGeneration;
    busy.value = false;
    close();
    uncertain.value = false;
    purpose.value = "";
    error.value = "";
    total.value = 0;
    if (timer) clearTimeout(timer);
    timer = null;
    coolingDown.value = false;
  }
  watch(
    [c.currentUsername, () => c.can("racks.view"), () => c.can("racks.manage")],
    reset,
    { flush: "sync" },
  );
  onBeforeUnmount(() => {
    alive = false;
    reset();
  });
  return {
    visible,
    loading,
    busy,
    uncertain,
    coolingDown,
    rack,
    options,
    rows,
    total,
    page,
    status,
    start,
    height,
    end,
    purpose,
    error,
    valid,
    open,
    close,
    refresh,
    create: () => write(),
    release: (row: RackUnitReservation) => write(row),
    changePage,
    changeStatus,
  };
}
export type RackReservations = ReturnType<typeof useRackReservations>;
