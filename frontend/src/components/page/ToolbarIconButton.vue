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
    <span class="page-toolbar-icon-action__wrapper">
      <el-button
        class="page-toolbar-icon-action"
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
