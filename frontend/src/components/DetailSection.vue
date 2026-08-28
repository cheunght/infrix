<template>
  <section class="detail-section-shell">
    <div class="detail-section-shell__header">
      <h3>{{ title }}</h3>
      <div v-if="$slots.action" class="detail-section-shell__action">
        <slot name="action" />
      </div>
    </div>
    <div class="detail-section-shell__body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<style scoped>
.detail-section-shell {
  padding: 18px 0;
}

.detail-section-shell__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.detail-section-shell__header h3 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.detail-section-shell__action {
  flex: 0 0 auto;
}
</style>
