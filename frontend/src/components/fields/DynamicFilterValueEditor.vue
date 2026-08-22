<script setup lang="ts">
import { computed } from "vue";
import type { CustomFieldSchema } from "../../types";

const props = defineProps<{
  field: CustomFieldSchema;
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const activeOptions = computed(() => (props.field.options || []).filter((option) => option.is_active));

function update(value: unknown) {
  emit("update:modelValue", value === null || value === undefined ? "" : String(value));
}
</script>

<template>
  <el-input
    v-if="field.field_type === 'text'"
    :model-value="modelValue"
    placeholder="输入值"
    clearable
    @update:model-value="update"
  />
  <el-input
    v-else-if="field.field_type === 'textarea'"
    :model-value="modelValue"
    type="textarea"
    :rows="1"
    placeholder="输入值"
    @update:model-value="update"
  />
  <el-input
    v-else-if="field.field_type === 'number'"
    :model-value="modelValue"
    type="number"
    inputmode="decimal"
    placeholder="输入数字"
    clearable
    @update:model-value="update"
  />
  <el-date-picker
    v-else-if="field.field_type === 'date'"
    :model-value="modelValue || null"
    type="date"
    value-format="YYYY-MM-DD"
    placeholder="选择日期"
    clearable
    @update:model-value="update"
  />
  <el-select
    v-else-if="field.field_type === 'boolean'"
    :model-value="modelValue || null"
    placeholder="选择"
    clearable
    @update:model-value="update"
  >
    <el-option label="是" value="true" />
    <el-option label="否" value="false" />
  </el-select>
  <el-select
    v-else
    :model-value="modelValue || null"
    placeholder="选择选项"
    clearable
    filterable
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
