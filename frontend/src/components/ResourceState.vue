<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
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
    emptyText: "",
    loadingText: "",
    retryable: true,
  },
);

const { t } = useI18n();
const resolvedEmptyText = computed(() => props.emptyText || t("common.noData"));
const resolvedLoadingText = computed(() => props.loadingText || t("common.loadingData"));

const emit = defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div v-if="loading" class="resource-state resource-state--loading" role="status" aria-live="polite">
    <slot name="loading">
      <el-skeleton :rows="4" animated />
      <span class="resource-state__loading-text">{{ resolvedLoadingText }}</span>
    </slot>
  </div>
  <div v-else-if="error" class="resource-state resource-state--error" role="alert">
    <slot name="error" :error="error">
      <el-alert :title="t('common.dataLoadFailed')" :description="error" type="error" :closable="false" show-icon />
      <el-button v-if="retryable" type="primary" @click="emit('retry')">{{ t('common.retry') }}</el-button>
    </slot>
  </div>
  <div v-else-if="empty" class="resource-state resource-state--empty" role="status">
    <slot name="empty">
      <el-empty :image-size="56" :description="resolvedEmptyText" />
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
