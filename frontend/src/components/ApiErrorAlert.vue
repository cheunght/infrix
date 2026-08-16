<script setup lang="ts">
defineProps<{
  message?: string;
  title?: string;
}>();
</script>

<template>
  <el-alert
    v-if="message"
    class="api-error-alert"
    :title="title || '操作失败'"
    :description="message"
    type="error"
    show-icon
    closable
  />
</template>
