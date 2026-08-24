<script setup lang="ts">
import { computed } from "vue";
import { Close } from "@element-plus/icons-vue";

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
  small: "520px",
  medium: "720px",
  large: "960px",
}[props.size]));
const dialogClass = computed(() => [
  "form-dialog",
  `form-dialog--${props.size}`,
]);
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :class="dialogClass"
    :width="dialogWidth"
    :destroy-on-close="destroyOnClose"
    :close-on-click-modal="closeOnClickModal && !saving"
    :close-on-press-escape="closeOnPressEscape && !closeDisabled && !saving"
    :show-close="false"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
    @closed="emit('closed')"
    @open="emit('open')"
    @opened="emit('opened')"
  >
    <template #header="{ close, titleId }">
      <div class="form-dialog__header">
        <div class="form-dialog__heading">
          <h2 :id="titleId">{{ title }}</h2>
          <p v-if="description" class="form-dialog__description">{{ description }}</p>
        </div>
        <el-button
          v-if="showClose"
          class="form-dialog__close"
          text
          circle
          :disabled="closeDisabled || saving"
          aria-label="关闭"
          title="关闭"
          @click="close"
        >
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </template>

    <div class="form-dialog__body" :aria-busy="loading || saving || undefined">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="form-dialog__alert" />
      <div v-if="loading" class="form-dialog__loading" role="status" aria-live="polite">
        <slot name="loading">
          <el-skeleton :rows="loadingRows" animated />
        </slot>
      </div>
      <slot v-else />
    </div>

    <template #footer>
      <div class="form-dialog__footer">
        <slot name="footer" />
      </div>
    </template>
  </el-dialog>
</template>
