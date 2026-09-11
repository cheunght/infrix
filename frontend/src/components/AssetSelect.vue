<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Asset } from "../types";
import type { RequestFn } from "../page-context";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";

export type AssetOption = Pick<Asset, "id" | "asset_no" | "name"> &
  Partial<Pick<Asset, "model_name" | "model_text" | "serial_number">>;

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

function primaryText(asset: AssetOption) {
  return [asset.asset_no, asset.name].filter(Boolean).join(" · ");
}

function secondaryText(asset: AssetOption) {
  const parts: string[] = [];
  const serialNumber = asset.serial_number?.trim();
  const model = (asset.model_name || asset.model_text || "").trim();
  if (serialNumber) parts.push(`${t("asset.serialNumber")}：${serialNumber}`);
  if (model) parts.push(`${t("asset.model")}：${model}`);
  return parts.join(" · ");
}

function mapAsset(item: Record<string, unknown>): SearchableSelectOption {
  const asset = item as unknown as AssetOption;
  return {
    value: asset.id,
    label: primaryText(asset),
    secondary: secondaryText(asset),
    data: asset,
  };
}

const selectedOption = computed<SearchableSelectOption | null>(() => {
  if (!props.selectedAsset) return null;
  return mapAsset(props.selectedAsset as unknown as Record<string, unknown>);
});

function handleUpdate(value: string | number | (string | number)[] | null | undefined) {
  const next = Array.isArray(value) ? value[0] : value;
  emit("update:modelValue", next == null ? "" : String(next));
}

function handleSelect(option: SearchableSelectOption | SearchableSelectOption[] | null) {
  const selected = Array.isArray(option) ? option[0] : option;
  emit("select", (selected?.data as AssetOption | undefined) || null);
}
</script>

<template>
  <SearchableSelect
    :model-value="modelValue"
    :request="request"
    endpoint="/assets/"
    :map-option="mapAsset"
    :placeholder="placeholder || t('assetSelect.placeholder')"
    :disabled="disabled"
    :clearable="clearable"
    :selected-option="selectedOption"
    :min-search-length="minSearchLength"
    :page-size="pageSize"
    :aria-label="placeholder || t('assetSelect.placeholder')"
    @update:model-value="handleUpdate"
    @select="handleSelect"
  />
</template>
