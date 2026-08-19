<script setup lang="ts">
export interface PageTabItem {
  label: string;
  value: string;
  disabled?: boolean;
}

defineProps<{
  modelValue: string;
  items: PageTabItem[];
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <el-tabs
    class="page-tabs"
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-tab-pane
      v-for="item in items"
      :key="item.value"
      :label="item.label"
      :name="item.value"
      :disabled="item.disabled"
    />
  </el-tabs>
</template>
