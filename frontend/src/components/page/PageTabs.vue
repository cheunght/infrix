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
  <div class="page-tabs-row">
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
    <div v-if="$slots.actions" class="page-tabs-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
