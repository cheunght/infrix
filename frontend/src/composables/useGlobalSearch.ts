import { computed, onBeforeUnmount, ref, watch } from "vue";
import { isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type { Asset, FaultEvent, Rack } from "../types";
import type { RequestFn } from "../types/page-context";
import { i18n } from "../i18n";

const tr = (key: string): string => String(i18n.global.t(key));

export type GlobalSearchModule = "assets" | "racks" | "faults";

export type GlobalSearchState = {
  query: string;
  open: boolean;
  loading: boolean;
  hasSearched: boolean;
  allowed: Record<GlobalSearchModule, boolean>;
  assets: Asset[];
  assetTotal: number;
  assetError: string;
  racks: Rack[];
  rackTotal: number;
  rackError: string;
  faults: FaultEvent[];
  faultTotal: number;
  faultError: string;
};

export interface GlobalSearchDeps {
  request: RequestFn;
  can: (capability: string) => boolean;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

type SearchJob = {
  module: GlobalSearchModule;
  promise: Promise<unknown>;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useGlobalSearch(deps: GlobalSearchDeps) {
  const query = ref("");
  const open = ref(false);
  const loading = ref(false);
  const hasSearched = ref(false);
  const assets = ref<Asset[]>([]);
  const assetTotal = ref(0);
  const assetError = ref("");
  const racks = ref<Rack[]>([]);
  const rackTotal = ref(0);
  const rackError = ref("");
  const faults = ref<FaultEvent[]>([]);
  const faultTotal = ref(0);
  const faultError = ref("");
  const requestSequence = ref(0);
  const allowed = computed<Record<GlobalSearchModule, boolean>>(() => ({
    assets: deps.can("assets.view"),
    racks: deps.can("racks.view"),
    faults: deps.can("faults.view"),
  }));

  let controller: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function cancelActiveRequest() {
    controller?.abort();
    controller = null;
    requestSequence.value += 1;
  }

  function clearResults() {
    assets.value = [];
    assetTotal.value = 0;
    assetError.value = "";
    racks.value = [];
    rackTotal.value = 0;
    rackError.value = "";
    faults.value = [];
    faultTotal.value = 0;
    faultError.value = "";
    hasSearched.value = false;
  }

  function scheduleSearch() {
    clearTimer();
    const value = query.value.trim();
    if (value.length < MIN_QUERY_LENGTH) {
      cancelActiveRequest();
      clearResults();
      loading.value = false;
      open.value = false;
      return;
    }

    open.value = true;
    cancelActiveRequest();
    clearResults();
    loading.value = true;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSearch(value);
    }, DEBOUNCE_MS);
  }

  async function runSearch(value: string) {
    if (value !== query.value.trim() || value.length < MIN_QUERY_LENGTH) return;

    const sequence = ++requestSequence.value;
    const nextController = new AbortController();
    controller = nextController;
    const jobs: SearchJob[] = [];
    const encodedQuery = encodeURIComponent(value);
    const requestOptions: RequestInit = { signal: nextController.signal };

    if (allowed.value.assets) {
      jobs.push({
        module: "assets",
        promise: deps.request<PageResult<Asset> | Asset[]>(
          `/assets/?search=${encodedQuery}&page_size=5&compact=1`,
          requestOptions,
        ),
      });
    }
    if (allowed.value.racks) {
      jobs.push({
        module: "racks",
        promise: deps.request<PageResult<Rack> | Rack[]>(
          `/racks/?search=${encodedQuery}&page_size=5`,
          requestOptions,
        ),
      });
    }
    if (allowed.value.faults) {
      jobs.push({
        module: "faults",
        promise: deps.request<PageResult<FaultEvent> | FaultEvent[]>(
          `/fault-events/?search=${encodedQuery}&is_closed=false&page_size=5`,
          requestOptions,
        ),
      });
    }

    if (!jobs.length) {
      loading.value = false;
      hasSearched.value = true;
      return;
    }

    const settled = await Promise.allSettled(jobs.map((job) => job.promise));
    if (sequence !== requestSequence.value || value !== query.value.trim()) return;

    settled.forEach((result, index) => {
      const module = jobs[index].module;
      if (result.status === "fulfilled") {
        if (module === "assets") {
          const payload = result.value as PageResult<Asset> | Asset[];
          assets.value = pageItems(payload);
          assetTotal.value = pageTotal(payload);
        } else if (module === "racks") {
          const payload = result.value as PageResult<Rack> | Rack[];
          racks.value = pageItems(payload);
          rackTotal.value = pageTotal(payload);
        } else {
          const payload = result.value as PageResult<FaultEvent> | FaultEvent[];
          faults.value = pageItems(payload);
          faultTotal.value = pageTotal(payload);
        }
        return;
      }

      if (isAbortError(result.reason)) return;
      const fallback = module === "assets"
        ? tr("globalSearch.assetLoadFailed")
        : module === "racks"
          ? tr("globalSearch.rackLoadFailed")
          : tr("globalSearch.faultLoadFailed");
      if (module === "assets") assetError.value = errorMessage(result.reason, fallback);
      if (module === "racks") rackError.value = errorMessage(result.reason, fallback);
      if (module === "faults") faultError.value = errorMessage(result.reason, fallback);
    });

    if (sequence === requestSequence.value) {
      loading.value = false;
      hasSearched.value = true;
      controller = null;
    }
  }

  function focus() {
    if (query.value.trim().length < MIN_QUERY_LENGTH) return;
    open.value = true;
    if (!loading.value && !hasSearched.value) scheduleSearch();
  }

  function close() {
    clearTimer();
    cancelActiveRequest();
    loading.value = false;
    open.value = false;
  }

  watch(query, scheduleSearch);

  onBeforeUnmount(() => {
    clearTimer();
    cancelActiveRequest();
  });

  const state = computed<GlobalSearchState>(() => ({
    query: query.value,
    open: open.value,
    loading: loading.value,
    hasSearched: hasSearched.value,
    allowed: allowed.value,
    assets: assets.value,
    assetTotal: assetTotal.value,
    assetError: assetError.value,
    racks: racks.value,
    rackTotal: rackTotal.value,
    rackError: rackError.value,
    faults: faults.value,
    faultTotal: faultTotal.value,
    faultError: faultError.value,
  }));

  return { query, state, focus, close };
}
