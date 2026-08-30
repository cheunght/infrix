<script setup lang="ts">
import { Loading, Search } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    ariaLabel?: string;
  }>(),
  {
    placeholder: "",
    disabled: false,
    loading: false,
    ariaLabel: "",
  },
);
const { t } = useI18n();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  search: [];
  clear: [];
}>();
</script>

<template>
  <el-input
    class="itam-search-field"
    :model-value="modelValue"
    :placeholder="props.placeholder || t('common.search')"
    :disabled="disabled"
    :aria-label="props.ariaLabel || t('common.search')"
    :prefix-icon="Search"
    :suffix-icon="loading ? Loading : undefined"
    clearable
    @update:model-value="emit('update:modelValue', $event)"
    @keyup.enter="emit('search')"
    @clear="() => { emit('clear'); emit('search'); }"
  />
</template>
