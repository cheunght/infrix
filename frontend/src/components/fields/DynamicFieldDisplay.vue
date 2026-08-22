<script setup lang="ts">
import { computed } from "vue";
import type { CustomFieldOption, CustomFieldSchema } from "../../types";

const props = defineProps<{
  field: CustomFieldSchema;
  value: unknown;
  options?: CustomFieldOption[];
}>();

const fieldOptions = computed(() => props.options || props.field.options || []);

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.trim() === "";
}

function normalizeNumber(value: unknown): string {
  const text = String(value);
  if (!/^[+-]?\d+\.\d+$/.test(text)) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

function optionLabel(value: unknown): string {
  const raw = String(value);
  const option = fieldOptions.value.find((item) => item.value === raw);
  if (!option) return `${raw}（选项不存在）`;
  return `${option.label || raw}${option.is_active ? "" : "（已停用）"}`;
}

function multiselectValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [value];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
}

const displayText = computed(() => {
  const value = props.value;
  if (isEmpty(value)) return "—";

  if (props.field.field_type === "boolean") {
    if (value === true) return "是";
    if (value === false) return "否";
    return "—";
  }
  if (props.field.field_type === "number") return normalizeNumber(value);
  if (props.field.field_type === "date") {
    const text = String(value);
    const date = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    return date || text;
  }
  if (props.field.field_type === "select") return optionLabel(value);
  if (props.field.field_type === "multiselect") {
    return multiselectValues(value).map(optionLabel).join("、");
  }
  return String(value);
});

const displayClass = computed(() => [
  "dynamic-field-display",
  `dynamic-field-display--${props.field.field_type}`,
  displayText.value === "—" ? "dynamic-field-display--empty" : "",
]);
</script>

<template>
  <span :class="displayClass" :title="displayText">
    {{ displayText }}
  </span>
</template>
