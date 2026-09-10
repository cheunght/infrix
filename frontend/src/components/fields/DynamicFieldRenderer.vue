<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CustomFieldOption, CustomFieldSchema } from "../../types";
import { systemDatePickerFormat } from "../../system-settings";

const props = withDefaults(
  defineProps<{
    field: CustomFieldSchema;
    modelValue: unknown;
    disabled?: boolean;
  }>(),
  { disabled: false },
);
const { t } = useI18n();

const emit = defineEmits<{
  "update:modelValue": [value: unknown];
}>();

const textValue = computed(() => {
  if (typeof props.modelValue === "string") return props.modelValue;
  if (props.modelValue === null || props.modelValue === undefined) return "";
  return String(props.modelValue);
});

const numberTextValue = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === "") return "";
  return String(props.modelValue);
});

const dateValue = computed(() =>
  typeof props.modelValue === "string" ? props.modelValue : null,
);

const booleanValue = computed(() => props.modelValue === true);

const selectValue = computed(() =>
  typeof props.modelValue === "string" && props.modelValue ? props.modelValue : null,
);

const multiselectValue = computed(() =>
  Array.isArray(props.modelValue)
    ? props.modelValue.filter((value): value is string => typeof value === "string")
    : [],
);

const inputPlaceholder = computed(() => props.field.placeholder || `${t('common.enter')}${props.field.name}`);
const selectPlaceholder = computed(() => props.field.placeholder || `${t('common.select')}${props.field.name}`);
const selectedValues = computed(() =>
  props.field.field_type === "multiselect"
    ? multiselectValue.value
    : selectValue.value
      ? [selectValue.value]
      : [],
);
const selectableOptions = computed(() => {
  const selected = new Set(selectedValues.value);
  return (props.field.options || []).filter((option) => option.is_active || selected.has(option.value));
});

function optionLabel(option: CustomFieldOption) {
  return option.is_active ? option.label : `${option.label} (${t("status.inactive")})`;
}

function update(value: unknown) {
  emit("update:modelValue", value);
}

function updateNumber(value: string | number | null | undefined) {
  emit("update:modelValue", value ?? "");
}
</script>

<template>
  <el-input
    v-if="field.field_type === 'text'"
    :model-value="textValue"
    :disabled="disabled"
    :placeholder="inputPlaceholder"
    @update:model-value="update"
  />
  <el-input
    v-else-if="field.field_type === 'textarea'"
    :model-value="textValue"
    type="textarea"
    :rows="3"
    :disabled="disabled"
    :placeholder="inputPlaceholder"
    @update:model-value="update"
  />
  <el-input
    v-else-if="field.field_type === 'number'"
    :model-value="numberTextValue"
    :disabled="disabled"
    inputmode="decimal"
    :placeholder="inputPlaceholder"
    :aria-label="field.name"
    @update:model-value="updateNumber"
  />
  <el-date-picker
    v-else-if="field.field_type === 'date'"
    :model-value="dateValue"
    type="date"
    :format="systemDatePickerFormat()"
    value-format="YYYY-MM-DD"
    :disabled="disabled"
    :placeholder="selectPlaceholder"
    @update:model-value="update"
  />
  <el-switch
    v-else-if="field.field_type === 'boolean'"
    :model-value="booleanValue"
    :disabled="disabled"
    @update:model-value="update"
  />
  <el-select
    v-else-if="field.field_type === 'select'"
    :model-value="selectValue"
    clearable
    :disabled="disabled"
    :placeholder="selectPlaceholder"
    @update:model-value="update"
  >
    <el-option
      v-for="option in selectableOptions"
      :key="option.id"
      :label="optionLabel(option)"
      :value="option.value"
      :disabled="!option.is_active"
    />
  </el-select>
  <el-select
    v-else-if="field.field_type === 'multiselect'"
    :model-value="multiselectValue"
    multiple
    clearable
    :disabled="disabled"
    :placeholder="selectPlaceholder"
    @update:model-value="update"
  >
    <el-option
      v-for="option in selectableOptions"
      :key="option.id"
      :label="optionLabel(option)"
      :value="option.value"
      :disabled="!option.is_active"
    />
  </el-select>
</template>
