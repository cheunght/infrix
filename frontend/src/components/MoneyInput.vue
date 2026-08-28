<script setup lang="ts">
import { computed } from "vue";
import { Money } from "@element-plus/icons-vue";

type CurrencyCode = "CNY" | "USD" | "EUR" | "GBP" | "JPY" | "HKD";

const currencySymbols: Record<CurrencyCode, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
};

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    currency?: CurrencyCode;
    symbol?: string;
    /** @deprecated Use currency or symbol. Kept for existing callers. */
    prefix?: string;
    suffix?: string;
    maxlength?: string | number;
  }>(),
  {
    modelValue: null,
    placeholder: "",
    disabled: false,
    readonly: false,
    currency: "CNY",
    symbol: "",
    prefix: "",
    suffix: "",
    maxlength: undefined,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
}>();

function handleUpdate(value: string) {
  emit("update:modelValue", value === "" ? null : value);
}

const currencySymbol = computed(() => props.symbol || props.prefix || currencySymbols[props.currency]);
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
      <span :aria-label="`币种 ${currencySymbol}`">{{ currencySymbol }}</span>
    </template>
    <template v-if="suffix" #suffix><span aria-hidden="true">{{ suffix }}</span></template>
  </el-input>
</template>
