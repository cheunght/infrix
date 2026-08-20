<script setup lang="ts">
import { computed } from "vue";

export type StatusTagType = "success" | "warning" | "danger" | "info" | "primary";

const props = withDefaults(
  defineProps<{
    label: string;
    status?: string;
    type?: StatusTagType;
  }>(),
  {
    status: "",
    type: undefined,
  },
);

const statusTypeMap: Record<string, StatusTagType> = {
  active: "success",
  enabled: "success",
  in_use: "success",
  in_stock: "info",
  normal: "success",
  completed: "success",
  expiring: "warning",
  pending: "warning",
  reserved: "warning",
  repair: "warning",
  idle: "info",
  in_progress: "warning",
  expired: "danger",
  over_limit: "danger",
  fault: "danger",
  disabled: "info",
  inactive: "info",
  retired: "info",
};

const resolvedType = computed<StatusTagType>(() => {
  return props.type || statusTypeMap[props.status] || "info";
});
</script>

<template>
  <el-tag :type="resolvedType">{{ label }}</el-tag>
</template>
