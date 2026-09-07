<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Money } from "@element-plus/icons-vue";
import type { CurrencyCode } from "../types";
import { currencySymbol, systemSettingsState } from "../system-settings";

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    currency?: CurrencyCode;
    symbol?: string;
    suffix?: string;
    maxlength?: string | number;
  }>(),
  {
    modelValue: null,
    placeholder: "",
    disabled: false,
    readonly: false,
    currency: undefined,
    symbol: "",
    suffix: "",
    maxlength: undefined,
  },
);
const { t } = useI18n();

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
}>();

function handleUpdate(value: string) {
  emit("update:modelValue", value === "" ? null : value);
}

const displayedCurrencySymbol = computed(() => props.symbol || currencySymbol(props.currency || systemSettingsState.currency));
</script>

<template>
  <el-input
    class="money-input"
    :model-value="modelValue ?? ''"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :maxlength="maxlength"
    type="text"
    inputmode="decimal"
    autocomplete="off"
    @update:model-value="handleUpdate"
  >
    <template #prefix>
      <el-icon aria-hidden="true"><Money /></el-icon>
      <span :aria-label="`${t('common.currency')} ${displayedCurrencySymbol}`">{{ displayedCurrencySymbol }}</span>
    </template>
    <template v-if="suffix" #suffix><span aria-hidden="true">{{ suffix }}</span></template>
  </el-input>
</template>
