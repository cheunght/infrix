<script setup lang="ts">
import { computed } from "vue";

export type { StatusTagType } from "../status";
import type { StatusTagType } from "../status";

const props = withDefaults(
  defineProps<{
    label: string;
    tone?: StatusTagType;
    size?: "small" | "default" | "large";
  }>(),
  {
    tone: undefined,
    size: "default",
  },
);

const resolvedType = computed<"primary" | "success" | "warning" | "danger" | "info" | undefined>(() => {
  if (!props.tone || props.tone === "neutral") return "info";
  return props.tone;
});
</script>

<template>
  <el-tag
    class="status-tag"
    :type="resolvedType"
    :size="size"
    effect="light"
  >
    {{ label }}
  </el-tag>
</template>
