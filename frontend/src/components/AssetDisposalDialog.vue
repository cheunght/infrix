<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { useI18n } from "vue-i18n";
import type { AssetDetail, AssetDisposalInput } from "../types";
import { formatSystemDate, systemDateKey, systemDatePickerFormat } from "../system-settings";
import FormDialogShell from "./FormDialogShell.vue";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  asset: AssetDetail | null;
  saving?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}>(), {
  saving: false,
  error: "",
  fieldErrors: () => ({}),
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  submit: [payload: AssetDisposalInput];
}>();

const { t } = useI18n();
const formRef = ref<FormInstance>();
const form = reactive<AssetDisposalInput>({
  disposed_on: systemDateKey(),
  reason: "",
  method: "",
  notes: "",
});

const description = computed(() => {
  if (!props.asset) return t("asset.disposalDescription");
  return t("asset.disposalDescriptionWithAsset", {
    asset: [props.asset.name, props.asset.asset_no].filter(Boolean).join(" · "),
  });
});

const rules = computed<FormRules>(() => ({
  disposed_on: [{ required: true, message: t("asset.disposedOnRequired"), trigger: "change" }],
  reason: [{ required: true, message: t("asset.disposalReasonRequired"), trigger: "blur" }],
  method: [{ required: true, message: t("asset.disposalMethodRequired"), trigger: "blur" }],
}));

function resetForm() {
  form.disposed_on = systemDateKey();
  form.reason = "";
  form.method = "";
  form.notes = "";
  void formRef.value?.clearValidate();
}

watch(
  () => [props.modelValue, props.asset?.id] as const,
  ([open, assetId], previous) => {
    if (open && (!previous || assetId !== previous[1] || !previous[0])) resetForm();
  },
  { immediate: true },
);

function disabledDate(value: Date) {
  return systemDateKey(value) > systemDateKey();
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  emit("submit", {
    disposed_on: form.disposed_on,
    reason: form.reason.trim(),
    method: form.method.trim(),
    notes: form.notes?.trim() || "",
  });
}
</script>

<template>
  <FormDialogShell
    :model-value="modelValue"
    :title="t('asset.disposeAssetTitle')"
    :description="description"
    :error="error"
    size="medium"
    :saving="saving"
    :close-disabled="saving"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-alert
      :title="t('asset.disposalWarning')"
      type="warning"
      :closable="false"
      show-icon
      class="asset-disposal-dialog__warning"
    />
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
      <el-form-item :label="t('asset.disposedOn')" prop="disposed_on" :error="fieldErrors.disposed_on">
        <el-date-picker
          v-model="form.disposed_on"
          type="date"
          :format="systemDatePickerFormat()"
          value-format="YYYY-MM-DD"
          :disabled-date="disabledDate"
          :placeholder="t('common.selectDate')"
          class="asset-disposal-dialog__control"
        />
        <div class="asset-disposal-dialog__help">{{ t('asset.disposedOnHelp', { today: formatSystemDate(systemDateKey()) }) }}</div>
      </el-form-item>
      <el-form-item :label="t('asset.disposalReason')" prop="reason" :error="fieldErrors.reason">
        <el-input v-model="form.reason" maxlength="500" show-word-limit />
      </el-form-item>
      <el-form-item :label="t('asset.disposalMethod')" prop="method" :error="fieldErrors.method">
        <el-input v-model="form.method" maxlength="100" show-word-limit />
      </el-form-item>
      <el-form-item :label="t('asset.disposalNotes')" prop="notes" :error="fieldErrors.notes">
        <el-input v-model="form.notes" type="textarea" :rows="4" maxlength="2000" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="emit('update:modelValue', false)">{{ t("common.cancel") }}</el-button>
      <el-button type="danger" :loading="saving" :disabled="saving" @click="submit">{{ t("asset.disposeAsset") }}</el-button>
    </template>
  </FormDialogShell>
</template>

<style scoped>
.asset-disposal-dialog__warning {
  margin-bottom: 18px;
}

.asset-disposal-dialog__control {
  width: 100%;
}

.asset-disposal-dialog__help {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
