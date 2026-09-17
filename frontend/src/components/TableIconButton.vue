<script setup lang="ts">
import type { ButtonProps } from "element-plus";

const props = withDefaults(
  defineProps<{
    icon: NonNullable<ButtonProps["icon"]>;
    label: string;
    type?: ButtonProps["type"];
    disabled?: boolean;
    loading?: boolean;
  }>(),
  {
    type: undefined,
    disabled: false,
    loading: false,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <el-tooltip :content="props.label" placement="top">
    <el-button
      class="table-icon-action"
      link
      :type="props.type"
      :icon="props.icon"
      :disabled="props.disabled"
      :loading="props.loading"
      :aria-label="props.label"
      :title="props.label"
      @click.stop="emit('click', $event)"
    />
  </el-tooltip>
</template>

<style scoped>
.table-icon-action {
  min-width: 32px;
  margin: 0;
}
</style>
