<template>
  <section v-if="!collapsible" class="detail-section-shell">
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
  <section v-else class="detail-section-shell detail-section-shell--collapsible">
    <el-collapse v-model="activeNames" class="detail-section-collapse">
      <el-collapse-item name="content">
        <template #title>
          <div class="detail-section-collapse__heading">
            <h3>{{ title }}</h3>
            <span v-if="summary" class="detail-section-collapse__summary">{{ summary }}</span>
          </div>
        </template>
        <div class="detail-section-shell__body detail-section-collapse__body">
          <slot />
        </div>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";

const props = withDefaults(defineProps<{
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  summary?: string;
}>(), {
  collapsible: false,
  defaultOpen: false,
  summary: "",
});

const activeNames = ref<string[]>(props.defaultOpen ? ["content"] : []);
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

.detail-section-shell--collapsible {
  padding: 0;
}

.detail-section-collapse {
  border-top: 0;
}

.detail-section-collapse__heading {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-right: 8px;
}

.detail-section-collapse__heading h3 {
  min-width: 0;
  overflow-wrap: anywhere;
}

.detail-section-collapse__summary {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small);
  font-weight: 400;
}

.detail-section-collapse__body {
  padding: 4px 0 14px;
}

.detail-section-collapse :deep(.el-collapse-item__header) {
  min-height: 48px;
  height: auto;
  color: var(--el-text-color-primary);
  line-height: var(--el-line-height-primary);
}

.detail-section-collapse :deep(.el-collapse-item__wrap) {
  border-bottom-color: var(--el-border-color-lighter);
}

.detail-section-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}
</style>
