<script setup lang="ts">
import { computed } from "vue";
import type { CustomFieldSchema } from "../../types";

const props = withDefaults(
  defineProps<{
    field: CustomFieldSchema;
    modelValue: unknown;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  "update:modelValue": [value: unknown];
}>();

const textValue = computed(() => {
  if (typeof props.modelValue === "string") return props.modelValue;
  if (props.modelValue === null || props.modelValue === undefined) return "";
  return String(props.modelValue);
});

const numberValue = computed<number | null>(() => {
  if (props.modelValue === null || props.modelValue === undefined || props.modelValue === "") return null;
  const value = Number(props.modelValue);
  return Number.isFinite(value) ? value : null;
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

const inputPlaceholder = computed(() => props.field.placeholder || `请输入${props.field.name}`);
const selectPlaceholder = computed(() => props.field.placeholder || `请选择${props.field.name}`);
const activeOptions = computed(() => (props.field.options || []).filter((option) => option.is_active));

function update(value: unknown) {
  emit("update:modelValue", value);
}

function updateNumber(value: number | null | undefined) {
  emit("update:modelValue", value ?? null);
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
  <el-input-number
    v-else-if="field.field_type === 'number'"
    :model-value="numberValue"
    :disabled="disabled"
    :placeholder="inputPlaceholder"
    :aria-label="field.name"
    :value-on-clear="null"
    @update:model-value="updateNumber"
  />
  <el-date-picker
    v-else-if="field.field_type === 'date'"
    :model-value="dateValue"
    type="date"
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
      v-for="option in activeOptions"
      :key="option.id"
      :label="option.label"
      :value="option.value"
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
      v-for="option in activeOptions"
      :key="option.id"
      :label="option.label"
      :value="option.value"
    />
  </el-select>
</template>
