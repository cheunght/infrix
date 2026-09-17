<script setup lang="ts">
import { Help } from "@element-plus/icons-vue";

defineProps<{ text: string }>();
</script>

<template>
  <span class="horizontal-form__help">
    <el-icon class="horizontal-form__help-icon" aria-hidden="true"><Help /></el-icon>
    <span class="horizontal-form__help-text">{{ text }}</span>
  </span>
</template>
