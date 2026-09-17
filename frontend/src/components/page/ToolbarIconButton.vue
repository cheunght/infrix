<script setup lang="ts">
import type { ButtonProps } from "element-plus";

const props = withDefaults(
  defineProps<{
    icon: NonNullable<ButtonProps["icon"]>;
    label: string;
    type?: ButtonProps["type"];
    disabled?: boolean;
    loading?: boolean;
    badge?: number;
  }>(),
  {
    type: undefined,
    disabled: false,
    loading: false,
    badge: 0,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <el-tooltip :content="props.label" placement="top">
    <el-badge v-if="props.badge" :value="props.badge" class="toolbar-icon-button__badge">
      <span class="toolbar-icon-button__wrapper">
        <el-button
          class="toolbar-icon-button"
          :type="props.type"
          :icon="props.icon"
          :loading="props.loading"
          :disabled="props.disabled"
          :aria-label="props.label"
          :title="props.label"
          @click="emit('click', $event)"
        />
      </span>
    </el-badge>
    <span v-else class="toolbar-icon-button__wrapper">
      <el-button
        class="toolbar-icon-button"
        :type="props.type"
        :icon="props.icon"
        :loading="props.loading"
        :disabled="props.disabled"
        :aria-label="props.label"
        :title="props.label"
        @click="emit('click', $event)"
      />
    </span>
  </el-tooltip>
</template>

<style scoped>
.toolbar-icon-button {
  width: var(--el-component-size, 32px);
  min-width: var(--el-component-size, 32px);
  height: var(--el-component-size, 32px);
  min-height: var(--el-component-size, 32px);
  padding: 0;
  justify-content: center;
}
</style>
