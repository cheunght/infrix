<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CustomFieldSchema } from "../../types";

const props = defineProps<{
  field: CustomFieldSchema;
  modelValue: string;
}>();
const { t } = useI18n();

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
    :placeholder="t('common.enterValue')"
    clearable
    @update:model-value="update"
  />
  <el-input
    v-else-if="field.field_type === 'textarea'"
    :model-value="modelValue"
    type="textarea"
    :rows="1"
    :placeholder="t('common.enterValue')"
    @update:model-value="update"
  />
  <el-input
    v-else-if="field.field_type === 'number'"
    :model-value="modelValue"
    inputmode="decimal"
    :placeholder="t('common.enterNumber')"
    clearable
    @update:model-value="update"
  />
  <el-date-picker
    v-else-if="field.field_type === 'date'"
    :model-value="modelValue || null"
    type="date"
    value-format="YYYY-MM-DD"
    :placeholder="t('common.selectDate')"
    clearable
    @update:model-value="update"
  />
  <el-select
    v-else-if="field.field_type === 'boolean'"
    :model-value="modelValue || null"
    :placeholder="t('common.select')"
    clearable
    @update:model-value="update"
  >
    <el-option :label="t('common.yes')" value="true" />
    <el-option :label="t('common.no')" value="false" />
  </el-select>
  <el-select
    v-else
    :model-value="modelValue || null"
    :placeholder="t('common.selectOption')"
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
