<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isAbortError, pageItems, type PageResult } from "../api";
import type { Asset } from "../types";
import type { RequestFn } from "../types/page-context";

export type AssetOption = Pick<Asset, "id" | "asset_no" | "name"> &
  Partial<Pick<Asset, "model" | "model_name" | "serial_number">>;

const props = withDefaults(defineProps<{
  modelValue: string | number | null;
  request: RequestFn;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  selectedAsset?: AssetOption | null;
  minSearchLength?: number;
  pageSize?: number;
}>(), {
  disabled: false,
  clearable: true,
  selectedAsset: null,
  minSearchLength: 2,
  pageSize: 20,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  select: [asset: AssetOption | null];
}>();
const { t } = useI18n();
const effectivePlaceholder = computed(() => props.placeholder || t("assetSelect.placeholder"));

const queryText = ref("");
const resultOptions = ref<AssetOption[]>([]);
const selectedOption = ref<AssetOption | null>(null);
const loading = ref(false);
const searchError = ref("");
const hydrationLoading = ref(false);
const hydrationError = ref("");
const lastLoadedQuery = ref<string | null>(null);

let requestSequence = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let hydrationSequence = 0;
let hydrationController: AbortController | null = null;

function normalizeId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? normalized : "";
}

function primaryText(asset: AssetOption) {
  return [asset.asset_no, asset.name].filter(Boolean).join(" · ");
}

function secondaryText(asset: AssetOption) {
  const parts: string[] = [];
  const serialNumber = asset.serial_number?.trim();
  const model = (asset.model || asset.model_name || "").trim();
  if (serialNumber) parts.push(`${t('asset.serialNumber')}：${serialNumber}`);
  if (model) parts.push(`${t('asset.model')}：${model}`);
  return parts.join(" · ");
}

const selectedValue = computed({
  get: () => normalizeId(props.modelValue),
  set: (value: string | number | null) => emit("update:modelValue", normalizeId(value)),
});

const options = computed(() => {
  const merged = new Map<number, AssetOption>();
  for (const asset of resultOptions.value) merged.set(asset.id, asset);
  if (props.selectedAsset) merged.set(props.selectedAsset.id, props.selectedAsset);
  if (selectedOption.value) merged.set(selectedOption.value.id, selectedOption.value);

  const selectedId = normalizeId(props.modelValue);
  return Array.from(merged.values()).sort((left, right) => {
    if (normalizeId(left.id) === selectedId) return -1;
    if (normalizeId(right.id) === selectedId) return 1;
    return 0;
  });
});

const emptyMessage = computed(() => {
  if (searchError.value) return searchError.value;
  if (hydrationError.value) return hydrationError.value;
  if (queryText.value && queryText.value.length < props.minSearchLength) {
    return t("assetSelect.minSearchLength", { count: props.minSearchLength });
  }
  return t("assetSelect.noMatch");
});

function cancelPendingSearch() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  controller?.abort();
  controller = null;
  requestSequence += 1;
  loading.value = false;
}

function cancelSelectedAssetHydration() {
  hydrationController?.abort();
  hydrationController = null;
  hydrationSequence += 1;
  hydrationLoading.value = false;
}

async function hydrateSelectedAsset(value: string | number | null) {
  const selectedId = normalizeId(value);
  cancelSelectedAssetHydration();
  hydrationError.value = "";

  if (!selectedId) return;

  const providedAsset = props.selectedAsset;
  if (providedAsset && normalizeId(providedAsset.id) === selectedId) {
    selectedOption.value = providedAsset;
    return;
  }
  if (selectedOption.value && normalizeId(selectedOption.value.id) === selectedId) return;

  selectedOption.value = null;
  const sequence = hydrationSequence;
  const nextController = new AbortController();
  hydrationController = nextController;
  hydrationLoading.value = true;

  try {
    const asset = await props.request<Asset>(`/assets/${selectedId}/`, {
      signal: nextController.signal,
    });
    if (
      sequence !== hydrationSequence ||
      nextController.signal.aborted ||
      normalizeId(props.modelValue) !== selectedId
    ) return;
    selectedOption.value = asset;
  } catch (error) {
    if (sequence !== hydrationSequence || nextController.signal.aborted || isAbortError(error)) return;
    hydrationError.value = t("assetSelect.hydrationFailed");
  } finally {
    if (sequence === hydrationSequence) {
      hydrationLoading.value = false;
      if (hydrationController === nextController) hydrationController = null;
    }
  }
}

async function fetchAssets(query: string, sequence: number) {
  const nextController = new AbortController();
  controller = nextController;
  loading.value = true;
  searchError.value = "";

  const params = new URLSearchParams({
    page_size: String(props.pageSize),
    compact: "1",
  });
  if (query) params.set("search", query);

  try {
    const payload = await props.request<PageResult<Asset> | Asset[]>(
      `/assets/?${params.toString()}`,
      { signal: nextController.signal },
    );
    if (sequence !== requestSequence) return;
    resultOptions.value = pageItems(payload);
    lastLoadedQuery.value = query;
  } catch (error) {
    if (sequence !== requestSequence || nextController.signal.aborted || isAbortError(error)) return;
    resultOptions.value = [];
    lastLoadedQuery.value = null;
    searchError.value = t("assetSelect.searchFailed");
  } finally {
    if (sequence === requestSequence) {
      loading.value = false;
      if (controller === nextController) controller = null;
    }
  }
}

function scheduleSearch(rawQuery: string) {
  const query = rawQuery.trim();
  queryText.value = query;
  searchError.value = "";
  hydrationError.value = "";
  lastLoadedQuery.value = null;
  resultOptions.value = [];
  cancelPendingSearch();
  const sequence = requestSequence;

  if (query && query.length < props.minSearchLength) {
    resultOptions.value = [];
    lastLoadedQuery.value = query;
    return;
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void fetchAssets(query, sequence);
  }, query ? 300 : 0);
}

function retrySearch() {
  if (hydrationError.value) {
    void hydrateSelectedAsset(props.modelValue);
    return;
  }
  scheduleSearch(queryText.value);
}

function handleVisibleChange(visible: boolean) {
  if (!visible) {
    cancelPendingSearch();
    cancelSelectedAssetHydration();
    return;
  }
  const selectedId = normalizeId(props.modelValue);
  if (selectedId && !selectedOption.value && !hydrationLoading.value) {
    void hydrateSelectedAsset(selectedId);
    return;
  }
  if (lastLoadedQuery.value === null && !loading.value && !hydrationLoading.value) scheduleSearch(queryText.value);
}

function handleChange(value: string | number | null) {
  cancelSelectedAssetHydration();
  hydrationError.value = "";
  const selectedId = normalizeId(value);
  const asset = options.value.find((item) => normalizeId(item.id) === selectedId) || null;
  selectedOption.value = asset;
  emit("select", asset);
}

function handleClear() {
  cancelSelectedAssetHydration();
  selectedOption.value = null;
  queryText.value = "";
  hydrationError.value = "";
  scheduleSearch("");
  emit("select", null);
}

watch(
  [() => props.modelValue, () => props.selectedAsset],
  ([value, asset]) => {
    const selectedId = normalizeId(value);
    if (asset && normalizeId(asset.id) === selectedId) {
      cancelSelectedAssetHydration();
      hydrationError.value = "";
      selectedOption.value = asset;
      return;
    }
    if (!selectedId) {
      cancelSelectedAssetHydration();
      hydrationError.value = "";
      selectedOption.value = null;
      return;
    }
    if (selectedOption.value && normalizeId(selectedOption.value.id) === selectedId) return;
    void hydrateSelectedAsset(selectedId);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  cancelPendingSearch();
  cancelSelectedAssetHydration();
});
</script>

<template>
  <el-select
    v-model="selectedValue"
    class="asset-select"
    filterable
    remote
    reserve-keyword
    :remote-method="scheduleSearch"
    :loading="loading || hydrationLoading"
    :loading-text="t('assetSelect.loading')"
    :no-data-text="emptyMessage"
    :no-match-text="emptyMessage"
    :placeholder="effectivePlaceholder"
    :disabled="disabled"
    :clearable="clearable"
    :validate-event="false"
    popper-class="asset-select-popper"
    @change="handleChange"
    @clear="handleClear"
    @visible-change="handleVisibleChange"
  >
    <el-option
      v-for="asset in options"
      :key="asset.id"
      :label="primaryText(asset)"
      :value="String(asset.id)"
    >
      <div class="asset-select__option">
        <span class="asset-select__option-primary">{{ primaryText(asset) }}</span>
        <span v-if="secondaryText(asset)" class="asset-select__option-secondary">{{ secondaryText(asset) }}</span>
      </div>
    </el-option>
    <template #empty>
      <div class="asset-select__empty" role="status">
        <span>{{ emptyMessage }}</span>
        <el-button v-if="searchError || hydrationError" link type="primary" @click.stop="retrySearch">{{ t('common.retry') }}</el-button>
      </div>
    </template>
  </el-select>
</template>
