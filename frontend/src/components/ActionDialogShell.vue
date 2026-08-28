<script setup lang="ts">
import { computed } from "vue";

type ActionDialogSize = "small" | "medium" | "large";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  title: string;
  description?: string;
  size?: ActionDialogSize;
  loading?: boolean;
  loadingRows?: number;
  pending?: boolean;
  error?: string;
  closeOnClickModal?: boolean;
  closeOnPressEscape?: boolean;
  showClose?: boolean;
  closeDisabled?: boolean;
  destroyOnClose?: boolean;
}>(), {
  description: "",
  size: "medium",
  loading: false,
  loadingRows: 5,
  pending: false,
  error: "",
  closeOnClickModal: true,
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

const busy = computed(() => props.loading || props.pending);
const dialogClass = computed(() => ["action-dialog", `action-dialog--${props.size}`]);
const dialogWidth = computed(() => ({
  small: "480px",
  medium: "640px",
  large: "840px",
}[props.size]));

function canClose() {
  return !props.closeDisabled && !busy.value;
}

function beforeClose(done: () => void) {
  if (canClose()) done();
}

function handleUpdate(value: boolean) {
  if (value || canClose()) emit("update:modelValue", value);
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
    @update:model-value="handleUpdate"
    @close="emit('close')"
    @closed="emit('closed')"
    @open="emit('open')"
    @opened="emit('opened')"
  >
    <template #header="{ titleId }">
      <div class="action-dialog__header">
        <div class="action-dialog__heading">
          <span :id="titleId" class="el-dialog__title">{{ title }}</span>
          <p v-if="description" class="action-dialog__description">{{ description }}</p>
        </div>
      </div>
    </template>

    <div class="action-dialog__body" :aria-busy="busy || undefined">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="action-dialog__alert action-dialog__error" />
      <div v-if="loading" class="action-dialog__loading">
        <slot name="loading">
          <el-skeleton animated :rows="loadingRows" />
        </slot>
      </div>
      <template v-else>
        <slot />
      </template>
    </div>

    <template #footer>
      <div class="action-dialog__footer">
        <div class="action-dialog__footer-state">
          <slot name="footer-state" />
        </div>
        <div class="action-dialog__footer-actions">
          <slot name="footer" />
        </div>
      </div>
    </template>
  </el-dialog>
</template>
