<script setup lang="ts">
import { computed } from "vue";

type FormDialogSize = "small" | "medium" | "large";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  title: string;
  description?: string;
  error?: string;
  size?: FormDialogSize;
  loading?: boolean;
  loadingRows?: number;
  saving?: boolean;
  closeOnClickModal?: boolean;
  closeOnPressEscape?: boolean;
  showClose?: boolean;
  closeDisabled?: boolean;
  destroyOnClose?: boolean;
}>(), {
  description: "",
  error: "",
  size: "medium",
  loading: false,
  loadingRows: 6,
  saving: false,
  closeOnClickModal: false,
  closeOnPressEscape: true,
  showClose: true,
  closeDisabled: false,
  destroyOnClose: true,
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [];
  closed: [];
  open: [];
  opened: [];
}>();

const dialogWidth = computed(() => ({
  small: "480px",
  medium: "680px",
  large: "820px",
}[props.size]));
const dialogClass = computed(() => [
  "form-dialog",
  `form-dialog--${props.size}`,
]);

function canClose() {
  return !props.closeDisabled && !props.saving;
}

function beforeClose(done: () => void) {
  if (canClose()) done();
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :class="dialogClass"
    :width="dialogWidth"
    :destroy-on-close="destroyOnClose"
    :close-on-click-modal="closeOnClickModal && canClose()"
    :close-on-press-escape="closeOnPressEscape && canClose()"
    :show-close="showClose"
    :before-close="beforeClose"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
    @closed="emit('closed')"
    @open="emit('open')"
    @opened="emit('opened')"
  >
    <template #header="{ titleId }">
      <div class="form-dialog__header">
        <div class="form-dialog__heading">
          <span :id="titleId" class="el-dialog__title">{{ title }}</span>
          <p v-if="description" class="form-dialog__description">{{ description }}</p>
        </div>
      </div>
    </template>

    <div class="form-dialog__body" :aria-busy="loading || saving || undefined">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="form-dialog__alert" />
      <div v-if="loading" class="form-dialog__loading" role="status" aria-live="polite">
        <slot name="loading">
          <el-skeleton :rows="loadingRows" animated />
        </slot>
      </div>
      <div v-else class="form-dialog__form-container">
        <slot />
      </div>
    </div>

    <template #footer>
      <div class="form-dialog__footer">
        <slot name="footer" />
      </div>
    </template>
  </el-dialog>
</template>
