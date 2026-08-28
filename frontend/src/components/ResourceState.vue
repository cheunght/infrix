<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean;
    error?: string | null;
    empty?: boolean;
    emptyText?: string;
    loadingText?: string;
    retryable?: boolean;
  }>(),
  {
    loading: false,
    error: "",
    empty: false,
    emptyText: "暂无数据",
    loadingText: "正在加载...",
    retryable: true,
  },
);

const emit = defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div v-if="loading" class="resource-state resource-state--loading" role="status" aria-live="polite">
    <slot name="loading">
      <el-skeleton :rows="4" animated />
      <span class="resource-state__loading-text">{{ loadingText }}</span>
    </slot>
  </div>
  <div v-else-if="error" class="resource-state resource-state--error" role="alert">
    <slot name="error" :error="error">
      <el-alert title="数据加载失败" :description="error" type="error" :closable="false" show-icon />
      <el-button v-if="retryable" type="primary" @click="emit('retry')">重新加载</el-button>
    </slot>
  </div>
  <div v-else-if="empty" class="resource-state resource-state--empty" role="status">
    <slot name="empty">
      <el-empty :image-size="56" :description="emptyText" />
    </slot>
  </div>
  <slot v-else />
</template>

<style scoped>
.resource-state {
  box-sizing: border-box;
  min-width: 0;
  color: var(--color-text-secondary, #536481);
}

.resource-state--loading {
  display: grid;
  gap: 8px;
}

.resource-state__loading-text {
  color: var(--color-text-muted, #7183a0);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.resource-state--error {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 24px 16px;
  text-align: center;
}

.resource-state--empty {
  min-height: 112px;
}
</style>
