<script setup lang="ts">
export interface PageTabItem {
  label: string;
  value: string;
  disabled?: boolean;
  status?: "error" | "warning";
  statusLabel?: string;
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
        :name="item.value"
        :disabled="item.disabled"
      >
        <template #label>
          <span class="page-tabs__label">
            <span>{{ item.label }}</span>
            <el-badge
              v-if="item.status"
              is-dot
              :type="item.status"
              :title="item.statusLabel"
              :aria-label="item.statusLabel"
            />
          </span>
        </template>
      </el-tab-pane>
    </el-tabs>
    <div v-if="$slots.actions" class="page-tabs-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
