<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  message?: string;
  title?: string;
}>();
const { t } = useI18n();
</script>

<template>
  <el-alert
    v-if="message"
    class="api-error-alert"
    :title="title || t('common.operationFailed')"
    :description="message"
    type="error"
    show-icon
    closable
  />
</template>
