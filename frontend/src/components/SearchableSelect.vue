<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isAbortError, pageItems, type PageResult } from "../api";
import type { RequestFn } from "../page-context";

export type SearchableSelectValue = string | number;

export type SearchableSelectOption = {
  value: SearchableSelectValue;
  label: string;
  secondary?: string;
  disabled?: boolean;
  data?: unknown;
};

type SelectModel = SearchableSelectValue | SearchableSelectValue[] | null | undefined;
type QueryValue = string | number | boolean | null | undefined;

const props = withDefaults(defineProps<{
  modelValue: SelectModel;
  request: RequestFn;
  endpoint: string;
  mapOption: (item: Record<string, unknown>) => SearchableSelectOption;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  multiple?: boolean;
  selectedOption?: SearchableSelectOption | null;
  selectedOptions?: SearchableSelectOption[];
  staticOptions?: SearchableSelectOption[];
  baseQuery?: Record<string, QueryValue>;
  minSearchLength?: number;
  pageSize?: number;
  ariaLabel?: string;
}>(), {
  disabled: false,
  clearable: true,
  multiple: false,
  selectedOption: null,
  selectedOptions: () => [],
  staticOptions: () => [],
  baseQuery: () => ({}),
  minSearchLength: 2,
  pageSize: 20,
  ariaLabel: "",
});

const emit = defineEmits<{
  "update:modelValue": [value: SelectModel];
  select: [value: SearchableSelectOption | SearchableSelectOption[] | null];
}>();

const { t } = useI18n();
const queryText = ref("");
const initialOptions = ref<SearchableSelectOption[]>([]);
const resultOptions = ref<SearchableSelectOption[]>([]);
const hydratedOptions = ref<SearchableSelectOption[]>([]);
const initialLoading = ref(false);
const loading = ref(false);
const hydrating = ref(false);
const errorMessage = ref("");
type ErrorKind = "initial" | "search" | "selected" | "";
const errorKind = ref<ErrorKind>("");
const initialLoadedKey = ref("");
const initialLoadingKey = ref("");
const isOpen = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let requestSequence = 0;
let initialController: AbortController | null = null;
let initialSequence = 0;
let hydrationController: AbortController | null = null;
let hydrationSequence = 0;

function normalizedValue(value: unknown): string {
  return String(value ?? "").trim();
}

function selectedValues(): string[] {
  const value = props.modelValue;
  if (Array.isArray(value)) return value.map(normalizedValue).filter(Boolean);
  const normalized = normalizedValue(value);
  return normalized ? [normalized] : [];
}

const selectedValue = computed({
  get: () => {
    if (props.multiple) return Array.isArray(props.modelValue) ? props.modelValue : [];
    return Array.isArray(props.modelValue) ? props.modelValue[0] ?? "" : props.modelValue ?? "";
  },
  set: (value: SelectModel) => emit("update:modelValue", value),
});

function mergeOptions(...groups: SearchableSelectOption[][]): SearchableSelectOption[] {
  const merged = new Map<string, SearchableSelectOption>();
  for (const group of groups) {
    for (const option of group) {
      const key = normalizedValue(option.value);
      if (key) merged.set(key, option);
    }
  }
  const selected = new Set(selectedValues());
  return Array.from(merged.values()).sort((left, right) => {
    const leftSelected = selected.has(normalizedValue(left.value));
    const rightSelected = selected.has(normalizedValue(right.value));
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    return 0;
  });
}

const currentOptions = computed(() => mergeOptions(
  props.staticOptions,
  hydratedOptions.value,
  props.selectedOption ? [props.selectedOption] : [],
  props.selectedOptions,
  queryText.value ? resultOptions.value : initialOptions.value,
));

const emptyMessage = computed(() => {
  if (errorMessage.value) return errorMessage.value;
  if (queryText.value && queryText.value.length < props.minSearchLength) {
    return t("searchableSelect.minSearchLength", { count: props.minSearchLength });
  }
  if (!queryText.value) return t("searchableSelect.initialNoOptions");
  return t("searchableSelect.noMatch");
});

function endpointPath(id?: string): string {
  const endpoint = props.endpoint.endsWith("/") ? props.endpoint : `${props.endpoint}/`;
  return id ? `${endpoint}${encodeURIComponent(id)}/` : endpoint;
}

function buildParams(query: string, includeSearch = true) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(props.baseQuery)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  }
  if (includeSearch) params.set("search", query);
  params.set("page", "1");
  params.set("page_size", String(props.pageSize));
  params.set("compact", "1");
  return params;
}

function initialOptionsKey() {
  return `${endpointPath()}?${buildParams("", false).toString()}`;
}

function clearError() {
  errorMessage.value = "";
  errorKind.value = "";
}

function cancelSearch() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  controller?.abort();
  controller = null;
  requestSequence += 1;
  loading.value = false;
}

function cancelInitial() {
  initialController?.abort();
  initialController = null;
  initialSequence += 1;
  initialLoading.value = false;
  initialLoadingKey.value = "";
}

function cancelHydration() {
  hydrationController?.abort();
  hydrationController = null;
  hydrationSequence += 1;
  hydrating.value = false;
}

async function fetchOptions(query: string, sequence: number) {
  const nextController = new AbortController();
  controller = nextController;
  loading.value = true;
  clearError();
  try {
    const payload = await props.request<PageResult<Record<string, unknown>> | Record<string, unknown>[]>(
      `${endpointPath()}?${buildParams(query).toString()}`,
      { signal: nextController.signal },
    );
    if (sequence !== requestSequence || nextController.signal.aborted) return;
    resultOptions.value = pageItems(payload).map(props.mapOption);
  } catch (error) {
    if (sequence !== requestSequence || nextController.signal.aborted || isAbortError(error)) return;
    resultOptions.value = [];
    errorMessage.value = t("searchableSelect.searchFailed");
    errorKind.value = "search";
  } finally {
    if (sequence === requestSequence) {
      loading.value = false;
      if (controller === nextController) controller = null;
    }
  }
}

async function loadInitialOptions(force = false) {
  if (!isOpen.value && !force) return;
  const key = initialOptionsKey();
  if (!force && (initialLoadedKey.value === key || initialLoadingKey.value === key)) return;

  cancelInitial();
  const nextController = new AbortController();
  initialController = nextController;
  const sequence = ++initialSequence;
  initialLoadingKey.value = key;
  initialLoading.value = true;
  clearError();
  try {
    const payload = await props.request<PageResult<Record<string, unknown>> | Record<string, unknown>[]>(
      `${endpointPath()}?${buildParams("", false).toString()}`,
      { signal: nextController.signal },
    );
    if (sequence !== initialSequence || nextController.signal.aborted) return;
    initialOptions.value = pageItems(payload).map(props.mapOption);
    initialLoadedKey.value = key;
  } catch (error) {
    if (sequence !== initialSequence || nextController.signal.aborted || isAbortError(error)) return;
    initialOptions.value = [];
    initialLoadedKey.value = "";
    errorMessage.value = t("searchableSelect.initialLoadFailed");
    errorKind.value = "initial";
  } finally {
    if (sequence === initialSequence) {
      initialLoading.value = false;
      initialLoadingKey.value = "";
      if (initialController === nextController) initialController = null;
    }
  }
}

function scheduleSearch(rawQuery: string) {
  const query = rawQuery.trim();
  queryText.value = query;
  clearError();
  cancelSearch();
  if (query) cancelInitial();
  if (!query || query.length < props.minSearchLength) {
    resultOptions.value = [];
    if (!query && isOpen.value) void loadInitialOptions();
    return;
  }
  const sequence = requestSequence;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void fetchOptions(query, sequence);
  }, 300);
}

async function hydrateSelectedOptions() {
  const known = new Set(currentOptions.value.map((option) => normalizedValue(option.value)));
  const missing = selectedValues().filter((value) => !known.has(value));
  if (!missing.length) return;

  cancelHydration();
  const nextController = new AbortController();
  hydrationController = nextController;
  const sequence = hydrationSequence;
  const loaded: SearchableSelectOption[] = [];
  hydrating.value = true;
  try {
    for (const id of missing) {
      const payload = await props.request<Record<string, unknown>>(endpointPath(id), { signal: nextController.signal });
      if (sequence !== hydrationSequence || nextController.signal.aborted) return;
      loaded.push(props.mapOption(payload));
    }
    hydratedOptions.value = mergeOptions(hydratedOptions.value, loaded);
  } catch (error) {
    if (!isAbortError(error) && sequence === hydrationSequence && !nextController.signal.aborted) {
      errorMessage.value = t("searchableSelect.selectedLoadFailed");
    }
  } finally {
    if (sequence === hydrationSequence) hydrating.value = false;
    if (sequence === hydrationSequence && hydrationController === nextController) {
      hydrationController = null;
    }
  }
}

function handleChange(value: SelectModel) {
  const values = Array.isArray(value) ? value.map(normalizedValue) : [normalizedValue(value)];
  const selected = currentOptions.value.filter((option) => values.includes(normalizedValue(option.value)));
  if (props.multiple) emit("select", selected);
  else emit("select", selected[0] || null);
}

function handleVisibleChange(visible: boolean) {
  isOpen.value = visible;
  if (!visible) {
    cancelSearch();
    cancelInitial();
    cancelHydration();
    queryText.value = "";
    resultOptions.value = [];
    return;
  }
  void hydrateSelectedOptions();
  if (!queryText.value || queryText.value.length < props.minSearchLength) {
    void loadInitialOptions();
  }
}

function retry() {
  if (errorKind.value === "initial") {
    void loadInitialOptions(true);
    return;
  }
  if (errorKind.value === "search" && queryText.value.length >= props.minSearchLength) {
    scheduleSearch(queryText.value);
    return;
  }
  void hydrateSelectedOptions();
}

watch(
  [() => props.modelValue, () => props.selectedOption, () => props.selectedOptions],
  () => {
    void hydrateSelectedOptions();
  },
  { deep: true, immediate: true },
);

watch(
  () => props.baseQuery,
  () => {
    cancelSearch();
    cancelInitial();
    initialOptions.value = [];
    initialLoadedKey.value = "";
    resultOptions.value = [];
    clearError();
    if (queryText.value.length >= props.minSearchLength) {
      scheduleSearch(queryText.value);
    } else if (isOpen.value && !queryText.value) {
      void loadInitialOptions();
    }
  },
  { deep: true },
);

onBeforeUnmount(() => {
  cancelSearch();
  cancelInitial();
  cancelHydration();
});
</script>

<template>
  <el-select
    v-model="selectedValue"
    class="searchable-select"
    filterable
    remote
    reserve-keyword
    :remote-method="scheduleSearch"
    :loading="initialLoading || loading || hydrating"
    :loading-text="t(initialLoading ? 'searchableSelect.initialLoading' : 'searchableSelect.loading')"
    :no-data-text="emptyMessage"
    :no-match-text="emptyMessage"
    :placeholder="placeholder || t('searchableSelect.prompt')"
    :disabled="disabled"
    :clearable="clearable"
    :multiple="multiple"
    :aria-label="ariaLabel || placeholder || t('searchableSelect.prompt')"
    :validate-event="false"
    :fallback-placements="['bottom-start', 'top-start']"
    popper-class="searchable-select-popper"
    @change="handleChange"
    @visible-change="handleVisibleChange"
  >
    <el-option
      v-for="option in currentOptions"
      :key="String(option.value)"
      :label="option.label"
      :value="option.value"
      :disabled="option.disabled"
    >
      <div class="searchable-select__option">
        <span class="searchable-select__option-primary">{{ option.label }}</span>
        <span v-if="option.secondary" class="searchable-select__option-secondary">{{ option.secondary }}</span>
      </div>
    </el-option>
    <template #empty>
      <div class="searchable-select__empty" role="status">
        <span>{{ emptyMessage }}</span>
        <el-button v-if="errorMessage" link type="primary" @click.stop="retry">{{ t("common.retry") }}</el-button>
      </div>
    </template>
  </el-select>
</template>

<style scoped>
.searchable-select__option {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  line-height: 1.35;
  white-space: normal;
}

.searchable-select__option-primary,
.searchable-select__option-secondary {
  min-width: 0;
  overflow-wrap: anywhere;
}

.searchable-select__option-primary {
  color: var(--el-text-color-primary);
}

.searchable-select__option-secondary {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.searchable-select__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  color: var(--el-text-color-secondary);
  white-space: normal;
}
</style>
