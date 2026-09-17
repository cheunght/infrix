<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Grid, Search } from "@element-plus/icons-vue";

const props = withDefaults(
  defineProps<{
    loading?: boolean;
    result?: string;
    error?: string;
    compact?: boolean;
  }>(),
  {
    loading: false,
    result: "",
    error: "",
    compact: false,
  },
);

const emit = defineEmits<{
  scan: [value: string];
  clear: [];
}>();

const { t } = useI18n();
const inputValue = ref("");
const inputRef = ref<{ focus: () => void } | null>(null);

function submit() {
  const value = inputValue.value.trim();
  if (!value) return;
  emit("scan", value);
}

function clear() {
  inputValue.value = "";
  emit("clear");
  void nextTick(() => inputRef.value?.focus());
}

function focus() {
  inputRef.value?.focus();
}

function clearInput() {
  inputValue.value = "";
}

defineExpose({ focus, clearInput });

if (!props.compact) {
  void nextTick(focus);
}
</script>

<template>
  <div
    class="asset-qr-scanner"
    :class="{ 'asset-qr-scanner--compact': props.compact }"
    role="search"
    :aria-label="t('inventory.scanAsset')"
  >
    <div class="asset-qr-scanner__intro">
      <el-icon aria-hidden="true"><Grid /></el-icon>
      <div>
        <strong>{{ t('inventory.scanAsset') }}</strong>
        <span>{{ t('inventory.scanAssetHint') }}</span>
      </div>
    </div>
    <el-input
      ref="inputRef"
      v-model="inputValue"
      clearable
      :placeholder="t('inventory.scanAssetPlaceholder')"
      :aria-label="t('inventory.scanAsset')"
      :disabled="loading"
      @keydown.enter.prevent="submit"
    >
      <template #append>
        <el-button :icon="Search" :loading="loading" :disabled="loading" @click="submit">
          {{ t('inventory.locateAsset') }}
        </el-button>
      </template>
    </el-input>
    <el-button v-if="result || error" link type="primary" :disabled="loading" @click="clear">
      {{ t('inventory.clearScan') }}
    </el-button>
    <span v-if="result && !error" class="asset-qr-scanner__result" role="status" aria-live="polite">{{ result }}</span>
    <span v-if="error" class="asset-qr-scanner__error" role="alert">{{ error }}</span>
    <div v-if="$slots.actions" class="asset-qr-scanner__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.asset-qr-scanner {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(300px, 1.5fr) auto;
  align-items: center;
  gap: var(--el-component-size-small);
  padding: 12px 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-lighter);
}

.asset-qr-scanner__intro {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
}

.asset-qr-scanner__intro > .el-icon {
  color: var(--el-color-primary);
  flex: 0 0 auto;
  font-size: 18px;
  margin-top: 2px;
}

.asset-qr-scanner__intro > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.asset-qr-scanner__intro strong,
.asset-qr-scanner__intro span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-qr-scanner__intro strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.asset-qr-scanner__intro span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.asset-qr-scanner__result,
.asset-qr-scanner__error {
  grid-column: 2 / -1;
  font-size: 12px;
  line-height: 1.4;
}

.asset-qr-scanner__result {
  color: var(--el-color-success);
}

.asset-qr-scanner__error {
  color: var(--el-color-danger);
}

.asset-qr-scanner--compact {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--el-component-size-small);
  padding: 0;
  border: 0;
  background: transparent;
}

.asset-qr-scanner--compact .asset-qr-scanner__intro,
.asset-qr-scanner--compact .asset-qr-scanner__result,
.asset-qr-scanner--compact .asset-qr-scanner__error,
.asset-qr-scanner--compact .asset-qr-scanner__actions {
  grid-column: 1 / -1;
}

.asset-qr-scanner__actions {
  min-width: 0;
}

@media (max-width: 760px) {
  .asset-qr-scanner {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .asset-qr-scanner__intro {
    grid-column: 1 / -1;
  }

  .asset-qr-scanner__result,
  .asset-qr-scanner__error {
    grid-column: 1 / -1;
  }
}
</style>
