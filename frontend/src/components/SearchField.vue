<script setup lang="ts">
import { Loading, Search } from "@element-plus/icons-vue";
import { ref, watch } from "vue";
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
const showLoading = ref(false);
watch(
  () => props.loading,
  (loading, _previous, onCleanup) => {
    showLoading.value = false;
    if (!loading) return;
    const timer = setTimeout(() => {
      showLoading.value = true;
    }, 150);
    onCleanup(() => clearTimeout(timer));
  },
  { immediate: true },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  search: [];
  clear: [];
}>();
</script>

<template>
  <el-input
    class="infrix-search-field"
    :model-value="modelValue"
    :placeholder="props.placeholder || t('common.search')"
    :disabled="disabled"
    :aria-label="props.ariaLabel || t('common.search')"
    :aria-busy="loading"
    clearable
    @update:model-value="emit('update:modelValue', $event)"
    @keyup.enter="emit('search')"
    @clear="() => { emit('clear'); emit('search'); }"
  >
    <template #prefix>
      <el-icon class="el-input__icon" :class="{ 'is-loading': showLoading }">
        <Loading v-if="showLoading" /><Search v-else />
      </el-icon>
    </template>
  </el-input>
</template>
