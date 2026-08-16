<script setup lang="ts">
import { Search } from "@element-plus/icons-vue";

withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    ariaLabel?: string;
  }>(),
  {
    placeholder: "请输入关键词",
    disabled: false,
    loading: false,
    ariaLabel: "搜索",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  search: [];
  clear: [];
}>();
</script>

<template>
  <el-input
    class="itam-search-field"
    :model-value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="ariaLabel"
    clearable
    @update:model-value="emit('update:modelValue', $event)"
    @keyup.enter="emit('search')"
    @clear="() => { emit('clear'); emit('search'); }"
  >
    <template #append>
      <el-button
        class="itam-search-button"
        :icon="Search"
        :loading="loading"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :title="ariaLabel"
        @click="emit('search')"
      />
    </template>
  </el-input>
</template>
