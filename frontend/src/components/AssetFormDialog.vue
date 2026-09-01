<!-- UX Reference: standard create/edit form. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { FormInstance, FormRules } from "element-plus";
import type { AssetFormContext } from "../page-context";
import type { CustomFieldSchema, Tag } from "../types";
import { isPositiveDecimalString, percentageToRate } from "../depreciation";
import DynamicFieldRenderer from "./fields/DynamicFieldRenderer.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import MoneyInput from "./MoneyInput.vue";
import { ASSET_STATUS_OPTIONS, businessOptionLabel } from "../business-enums";

const props = defineProps<{ context: AssetFormContext }>();
const { t } = useI18n();
const context = props.context;
const {
  showAssetModal,
  assetModalMode,
  editingAsset,
  assetForm,
  assetFormLoading,
  assetFormLoadError,
  assetFormSaving,
  assetFormFieldErrors,
  retryAssetFormLoad,
  clearAssetFormErrors,
  activeDeviceTypes,
  syncAssetDeviceType,
  manufacturerOptions,
  activeDataCenters,
  changeAssetDataCenter,
  assetRoomOptions,
  changeAssetRoom,
  assetRackOptions,
  changeAssetRack,
  setAssetRackMounted,
  assetCustomFieldSchema,
  assetCustomSchemaLoading,
  assetCustomSchemaError,
  retryAssetCustomSchema,
  enableDepreciation,
  markDepreciationStartTouched,
  syncDepreciationStartFromPurchase,
  updateAssetCustomFieldValue,
  tags,
  tagListLoading,
  tagListError,
  retryTagList,
  saveAsset,
} = context;

const formRef = ref<FormInstance>();
const visibleAssetCustomFields = computed(() =>
  assetCustomFieldSchema.value.filter((field) => field.is_active !== false && field.form_visible !== false),
);
type DynamicFieldGroup = { name: string; fields: CustomFieldSchema[] };
const dynamicFieldGroups = computed<DynamicFieldGroup[]>(() => {
  const groups = new Map<string, CustomFieldSchema[]>();
  for (const field of visibleAssetCustomFields.value) {
    const groupName = field.group?.trim() || t("asset.otherInfo");
    const fields = groups.get(groupName) || [];
    fields.push(field);
    groups.set(groupName, fields);
  }
  return Array.from(groups, ([name, fields]) => ({ name, fields }));
});

const selectableTags = computed<Tag[]>(() => {
  const selectedIds = new Set(assetForm.value.tags.map(String));
  const currentTags = (editingAsset.value?.tags || []) as Tag[];
  const merged = new Map<number, Tag>();
  for (const tag of [...tags.value, ...currentTags]) merged.set(tag.id, tag);
  return Array.from(merged.values()).filter((tag) => tag.is_active || selectedIds.has(String(tag.id)));
});

const rackPlacementHelp = computed(() => t("assetForm.rackPlacementHelp"));
const depreciationHelp = computed(() => t("assetForm.depreciationHelp"));
const residualRateHelp = computed(() => t("assetForm.residualRateHelp"));

const rackMountedSelectValue = computed({
  get: () => (assetForm.value.rack_mounted ? "mounted" : "unmounted"),
  set: (value: string) => setAssetRackMounted(value === "mounted"),
});

const depreciationSelectValue = computed({
  get: () => (assetForm.value.depreciation_enabled ? "enabled" : "disabled"),
  set: (value: string) => {
    const enabled = value === "enabled";
    assetForm.value.depreciation_enabled = enabled;
    if (enabled) enableDepreciation();
  },
});

const purchaseAmountValue = computed<string | null>({
  get: () => assetForm.value.purchase_amount || null,
  set: (value) => {
    assetForm.value.purchase_amount = value ?? "";
  },
});

function numberFromText(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const rackStartUValue = computed<number | null>({
  get: () => numberFromText(assetForm.value.rack_start_u),
  set: (value) => {
    assetForm.value.rack_start_u = value == null ? "" : String(value);
  },
});

const rackEndUValue = computed<number | null>({
  get: () => numberFromText(assetForm.value.rack_end_u),
  set: (value) => {
    assetForm.value.rack_end_u = value == null ? "" : String(value);
  },
});

const residualRateValue = computed<number | null>({
  get: () => numberFromText(assetForm.value.residual_rate),
  set: (value) => {
    assetForm.value.residual_rate = value == null ? "" : String(value);
  },
});

const requiredRule = (label: string) => ({
  required: true,
  message: t("assetForm.fieldRequired", { field: label }),
  trigger: "submit",
});

const ipRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!value) return callback();
    const input = String(value).trim();
    const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}$/;
    const ipv6 = /^[0-9a-f:]+$/i;
    if (ipv4.test(input) || (input.includes(":") && ipv6.test(input))) return callback();
    callback(new Error(t("assetForm.validIp")));
  },
  trigger: "submit",
};

const dateRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return callback();
    callback(new Error(t("assetForm.dateFormat")));
  },
  trigger: "submit",
};

const rackLocationRule = {
  validator: (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.rack_mounted) return callback();
    const start = Number(assetForm.value.rack_start_u);
    const end = Number(assetForm.value.rack_end_u);
    const total = Number(assetForm.value.rack_total_u);
    if (!assetForm.value.data_center || !assetForm.value.server_room_id || !assetForm.value.rack_id) {
      return callback(new Error(t("assetForm.completeRackLocation")));
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return callback(new Error(t("assetForm.validURange")));
    }
    if (total > 0 && end > total) return callback(new Error(t("assetForm.endUExceeded", { count: total })));
    callback();
  },
  trigger: "submit",
};

const depreciationPurchaseAmountRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (!isPositiveDecimalString(value)) return callback(new Error(t("assetForm.purchaseAmountRequired")));
    callback();
  },
  trigger: "submit",
};

const depreciationStartDateRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (!value) return callback(new Error(t("assetForm.depreciationStartRequired")));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return callback(new Error(t("assetForm.depreciationStartFormat")));
    callback();
  },
  trigger: "submit",
};

const depreciationYearsRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (!Number.isInteger(value) || Number(value) < 1) return callback(new Error(t("assetForm.depreciationYears")));
    callback();
  },
  trigger: "submit",
};

const residualRateRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (String(value ?? "").trim() === "") return callback(new Error(t("assetForm.residualRateRequired")));
    if (percentageToRate(value) === null) return callback(new Error(t("assetForm.residualRateInvalid")));
    callback();
  },
  trigger: "submit",
};

function isCustomFieldEmpty(field: CustomFieldSchema, value: unknown) {
  if (field.field_type === "text" || field.field_type === "textarea") return value === "" || value === null || value === undefined;
  if (field.field_type === "number") return value === "" || value === null || value === undefined;
  if (field.field_type === "date" || field.field_type === "select") return value === "" || value === null || value === undefined;
  if (field.field_type === "multiselect") return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
  return value === null || value === undefined;
}

function finiteConfigNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function customFieldRule(field: CustomFieldSchema) {
  return {
    validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
      const empty = isCustomFieldEmpty(field, value);
      if (empty) return callback(field.required ? new Error(t("assetForm.fieldRequired", { field: field.name })) : undefined);

      const config = field.validation_config || {};
      if (field.field_type === "text" || field.field_type === "textarea") {
        const length = String(value).length;
        if (config.min_length != null && length < config.min_length) {
          return callback(new Error(t("assetForm.fieldMinLength", { field: field.name, count: config.min_length })));
        }
        if (config.max_length != null && length > config.max_length) {
          return callback(new Error(t("assetForm.fieldMaxLength", { field: field.name, count: config.max_length })));
        }
      }

      if (field.field_type === "number") {
        const number = Number(value);
        if (!Number.isFinite(number)) return callback(new Error(t("assetForm.fieldNumber", { field: field.name })));
        const min = finiteConfigNumber(config.min);
        const max = finiteConfigNumber(config.max);
        if (min !== undefined && number < min) return callback(new Error(t("assetForm.fieldMin", { field: field.name, count: min })));
        if (max !== undefined && number > max) return callback(new Error(t("assetForm.fieldMax", { field: field.name, count: max })));
        const precision = finiteConfigNumber(config.precision);
        if (precision !== undefined && Number.isInteger(precision) && precision >= 0) {
          const factor = 10 ** precision;
          if (Number.isFinite(factor) && Math.abs(number * factor - Math.round(number * factor)) > 1e-8) {
            return callback(new Error(t("assetForm.fieldPrecision", { field: field.name, count: precision })));
          }
        }
      }

      if (field.field_type === "date") {
        const date = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return callback(new Error(t("assetForm.fieldDateFormat", { field: field.name })));
        if (config.min_date && date < config.min_date) return callback(new Error(t("assetForm.fieldDateMin", { field: field.name, date: config.min_date })));
        if (config.max_date && date > config.max_date) return callback(new Error(t("assetForm.fieldDateMax", { field: field.name, date: config.max_date })));
      }

      if (field.field_type === "multiselect") {
        if (!Array.isArray(value)) return callback(new Error(t("assetForm.fieldArray", { field: field.name })));
        if (config.min_items != null && value.length < config.min_items) {
          return callback(new Error(t("assetForm.fieldMinItems", { field: field.name, count: config.min_items })));
        }
        if (config.max_items != null && value.length > config.max_items) {
          return callback(new Error(t("assetForm.fieldMaxItems", { field: field.name, count: config.max_items })));
        }
      }

      if (field.field_type === "select" || field.field_type === "multiselect") {
        const activeValues = new Set((field.options || []).filter((option) => option.is_active).map((option) => option.value));
        const submittedValues = field.field_type === "select" ? [value] : (Array.isArray(value) ? value : []);
        if (submittedValues.some((item) => typeof item !== "string" || !activeValues.has(item))) {
          return callback(new Error(t("assetForm.fieldInvalidOptions", { field: field.name })));
        }
      }

      callback();
    },
    trigger: "submit",
  };
}

const assetRules = computed<FormRules>(() => {
  const rules: FormRules = {
    asset_no: [requiredRule(t("asset.code"))],
    name: [requiredRule(t("asset.name"))],
    device_type: [requiredRule(t("asset.deviceType"))],
    status: [requiredRule(t("asset.status"))],
    business_ip: [ipRule],
    management_ip: [ipRule],
    oob_ip: [ipRule],
    purchase_date: [dateRule],
    purchase_amount: [depreciationPurchaseAmountRule],
    depreciation_start_date: [depreciationStartDateRule],
    depreciation_years: [depreciationYearsRule],
    residual_rate: [residualRateRule],
    maintenance_start_date: [dateRule],
    maintenance_expiry_date: [dateRule],
    rack_id: [rackLocationRule],
    rack_start_u: [rackLocationRule],
    rack_end_u: [rackLocationRule],
  };

  for (const field of visibleAssetCustomFields.value) {
    rules[`custom_values.${field.key}`] = [customFieldRule(field)];
  }
  return rules;
});

function fieldError(field: string): string | undefined {
  return assetFormFieldErrors.value[field];
}

function closeDialog() {
  if (assetFormSaving.value) return;
  showAssetModal.value = false;
  editingAsset.value = null;
  clearAssetFormErrors();
}

function handleDialogClosed() {
  editingAsset.value = null;
  assetFormLoadError.value = "";
  clearAssetFormErrors();
}

async function submitAsset() {
  if (assetFormLoading.value || assetFormLoadError.value || assetCustomSchemaLoading.value || assetCustomSchemaError.value || assetFormSaving.value || !formRef.value) return;
  clearAssetFormErrors();
  const valid = await formRef.value.validate().catch(() => false);
  if (valid === false) return;
  await saveAsset();
}

watch(showAssetModal, (open) => {
  if (open) nextTick(() => formRef.value?.clearValidate());
});

watch(() => assetForm.value.purchase_date, () => {
  syncDepreciationStartFromPurchase();
});
</script>

<template>
  <FormDialogShell
    v-model="showAssetModal"
    class="asset-form-dialog"
    :title="assetModalMode === 'edit' ? t('assetForm.editTitle') : assetModalMode === 'clone' ? t('assetForm.cloneTitle') : t('assetForm.createTitle')"
    :description="t('assetForm.description')"
    size="large"
    :loading="assetFormLoading"
    :loading-rows="10"
    :saving="assetFormSaving"
    :close-on-click-modal="false"
    :close-on-press-escape="!assetFormSaving"
    :show-close="!assetFormSaving"
    :close-disabled="assetFormSaving"
    @close="closeDialog"
    @closed="handleDialogClosed"
  >
    <div v-if="assetFormLoadError" class="asset-form-load-error">
      <el-alert :title="t('assetForm.loadFailed')" :description="assetFormLoadError" type="error" :closable="false" show-icon />
      <el-button type="primary" plain @click="retryAssetFormLoad">{{ t('common.retry') }}</el-button>
    </div>

    <el-form
      v-else
      ref="formRef"
      :model="assetForm"
      :rules="assetRules"
      :validate-on-rule-change="false"
      :scroll-to-error="true"
      label-position="right"
      class="horizontal-form"
      @submit.prevent="submitAsset"
    >
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('assetForm.basicInfo') }}</h3>
        <div class="horizontal-form__rows">
        <el-form-item :label="t('asset.code')" prop="asset_no" required :error="fieldError('asset_no')">
          <el-input v-model="assetForm.asset_no" :disabled="!!editingAsset" autocomplete="off" />
        </el-form-item>
        <el-form-item :label="t('asset.name')" prop="name" required :error="fieldError('name')">
          <el-input v-model="assetForm.name" />
        </el-form-item>
        <el-form-item :label="t('asset.deviceType')" prop="device_type" required :error="fieldError('device_type')">
          <el-select v-model="assetForm.device_type" :placeholder="t('assetForm.unlinkedDeviceType')" clearable @change="syncAssetDeviceType">
            <el-option v-for="item in activeDeviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('asset.manufacturer')" :error="fieldError('manufacturer_id')">
          <el-select v-model="assetForm.manufacturer_id" :placeholder="t('assetForm.unlinkedManufacturer')" clearable>
            <el-option v-for="item in manufacturerOptions" :key="item.id" :label="item.name" :value="String(item.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('asset.status')" prop="status" required :error="fieldError('status')">
          <el-select v-model="assetForm.status">
            <el-option v-for="option in ASSET_STATUS_OPTIONS" :key="option.value" :label="businessOptionLabel(ASSET_STATUS_OPTIONS, option.value)" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('asset.model')" :error="fieldError('model')"><el-input v-model="assetForm.model" :placeholder="t('assetForm.modelPlaceholder')" /></el-form-item>
        <el-form-item :label="t('asset.serialNumber')" :error="fieldError('serial_number')"><el-input v-model="assetForm.serial_number" /></el-form-item>
        <el-form-item :label="t('asset.purpose')" :error="fieldError('purpose')"><el-input v-model="assetForm.purpose" /></el-form-item>
        <el-form-item :label="t('asset.owner')" :error="fieldError('owner_name')"><el-input v-model="assetForm.owner_name" /></el-form-item>
        </div>
      </section>

      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('assetForm.rackAndNetwork') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('assetForm.rackMounted')">
            <el-select v-model="rackMountedSelectValue" :placeholder="t('assetForm.selectRackStatus')">
              <el-option :label="t('assetForm.unmounted')" value="unmounted" />
              <el-option :label="t('assetForm.mounted')" value="mounted" />
            </el-select>
            <FieldHelp :text="rackPlacementHelp" />
          </el-form-item>
          <el-form-item v-if="!assetForm.rack_mounted" :label="t('common.dataCenter')" :error="fieldError('asset_data_center')">
            <el-select v-model="assetForm.asset_data_center" :placeholder="t('assetForm.noDataCenter')" clearable>
              <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
            </el-select>
          </el-form-item>
        </div>
        <div v-if="assetForm.rack_mounted" class="horizontal-form__rows">
        <el-form-item :label="t('common.dataCenter')" :error="fieldError('data_center')">
          <el-select v-model="assetForm.data_center" :placeholder="t('assetForm.noDataCenter')" clearable @change="changeAssetDataCenter">
            <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('common.room')" :error="fieldError('server_room_id')">
          <el-select v-model="assetForm.server_room_id" :placeholder="t('assetForm.selectRoom')" clearable @change="changeAssetRoom">
            <el-option v-for="room in assetRoomOptions" :key="room.id" :label="room.name" :value="String(room.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('rack.rackCode')" prop="rack_id" :error="fieldError('rack_id')">
          <el-select v-model="assetForm.rack_id" :placeholder="t('assetForm.selectRack')" clearable @change="changeAssetRack">
            <el-option v-for="rack in assetRackOptions" :key="rack.id" :label="rack.code" :value="String(rack.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('assetForm.totalRackU')" :error="fieldError('rack_total_u')"><el-input v-model="assetForm.rack_total_u" disabled /></el-form-item>
        <el-form-item :label="t('assetForm.startU')" prop="rack_start_u" :error="fieldError('rack_start_u')">
          <el-input-number v-model="rackStartUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('assetForm.startU')">
            <template #suffix>U</template>
          </el-input-number>
        </el-form-item>
        <el-form-item :label="t('assetForm.endU')" prop="rack_end_u" :error="fieldError('rack_end_u')">
          <el-input-number v-model="rackEndUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('assetForm.endU')">
            <template #suffix>U</template>
          </el-input-number>
        </el-form-item>
        </div>
        <div class="form-dialog__subsection-title">{{ t('assetForm.networkAddress') }}</div>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('asset.businessIp')" prop="business_ip" :error="fieldError('business_ip')"><el-input v-model="assetForm.business_ip" placeholder="10.0.0.10" /></el-form-item>
          <el-form-item :label="t('asset.managementIp')" prop="management_ip" :error="fieldError('management_ip')"><el-input v-model="assetForm.management_ip" placeholder="10.0.1.10" /></el-form-item>
          <el-form-item :label="t('asset.oobIp')" prop="oob_ip" :error="fieldError('oob_ip')"><el-input v-model="assetForm.oob_ip" placeholder="10.0.2.10" /></el-form-item>
        </div>
      </section>

      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('assetForm.procurementMaintenanceDepreciation') }}</h3>
        <div class="horizontal-form__rows">
        <el-form-item :label="t('asset.purchaseDate')" prop="purchase_date" :error="fieldError('purchase_date')"><el-date-picker v-model="assetForm.purchase_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item :label="t('asset.supplier')" :error="fieldError('supplier')"><el-input v-model="assetForm.supplier" /></el-form-item>
        <el-form-item :label="t('asset.purchaseOrder')" :error="fieldError('purchase_order_no')"><el-input v-model="assetForm.purchase_order_no" /></el-form-item>
        <el-form-item :label="t('asset.purchaseAmount')" prop="purchase_amount" :error="fieldError('purchase_amount')">
          <MoneyInput v-model="purchaseAmountValue" currency="CNY" :placeholder="t('assetForm.purchaseAmountPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('asset.maintenanceProvider')" :error="fieldError('maintenance_provider')"><el-input v-model="assetForm.maintenance_provider" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceContract')" :error="fieldError('maintenance_contract_no')"><el-input v-model="assetForm.maintenance_contract_no" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceStart')" prop="maintenance_start_date" :error="fieldError('maintenance_start_date')"><el-date-picker v-model="assetForm.maintenance_start_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceExpiry')" prop="maintenance_expiry_date" :error="fieldError('maintenance_expiry_date')"><el-date-picker v-model="assetForm.maintenance_expiry_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item :label="t('common.notes')" :error="fieldError('notes')"><el-input v-model="assetForm.notes" type="textarea" :rows="2" /></el-form-item>
        </div>
        <div class="form-dialog__subsection">
          <div class="form-dialog__subsection-title">{{ t('assetForm.depreciationConfig') }}</div>
          <div class="horizontal-form__rows">
            <el-form-item :label="t('assetForm.depreciationEnabled')" :error="fieldError('configuration')">
              <el-select v-model="depreciationSelectValue" :placeholder="t('assetForm.selectDepreciation')">
                <el-option :label="t('assetForm.depreciationDisabled')" value="disabled" />
                <el-option :label="t('assetForm.depreciationEnabledOption')" value="enabled" />
              </el-select>
              <FieldHelp :text="depreciationHelp" />
            </el-form-item>
          </div>
          <div v-if="assetForm.depreciation_enabled" class="horizontal-form__rows">
            <el-form-item :label="t('assetForm.depreciationStart')" prop="depreciation_start_date" :error="fieldError('depreciation_start_date')">
              <el-date-picker v-model="assetForm.depreciation_start_date" type="date" value-format="YYYY-MM-DD" @change="markDepreciationStartTouched" />
            </el-form-item>
            <el-form-item :label="t('asset.depreciationYears')" prop="depreciation_years" :error="fieldError('depreciation_years')">
              <el-input-number v-model="assetForm.depreciation_years" :min="1" :step="1" :precision="0" :value-on-clear="null" :placeholder="t('assetForm.yearsPlaceholder')" :aria-label="t('asset.depreciationYears')">
                <template #suffix>{{ t('common.years') }}</template>
              </el-input-number>
            </el-form-item>
            <el-form-item :label="t('asset.residualRate')" prop="residual_rate" :error="fieldError('residual_rate')">
              <el-input-number v-model="residualRateValue" :min="0" :max="100" :step="0.01" :precision="2" :value-on-clear="null" :placeholder="t('assetForm.residualRateExample')" :aria-label="t('asset.residualRate')">
                <template #suffix>%</template>
              </el-input-number>
              <FieldHelp :text="residualRateHelp" />
            </el-form-item>
          </div>
        </div>
      </section>

      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t('assetForm.extendedInfo') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('assetForm.tags')" :error="fieldError('tags')">
            <el-select v-model="assetForm.tags" multiple clearable filterable :loading="tagListLoading" :disabled="tagListLoading" :placeholder="t('assetForm.selectTags')">
              <el-option
                v-for="tag in selectableTags"
                :key="tag.id"
                :label="tag.is_active ? tag.name : `${tag.name}（${t('status.inactive')}）`"
                :value="String(tag.id)"
              />
            </el-select>
            <div v-if="tagListError" class="asset-form-tag-state asset-form-tag-state--error">
              <span>{{ tagListError }}</span>
              <el-button link type="primary" :disabled="tagListLoading" @click="retryTagList">{{ t('assetForm.retry') }}</el-button>
            </div>
            <div v-else-if="!tagListLoading && !selectableTags.length" class="asset-form-tag-state">{{ t('assetForm.noAvailableTags') }}</div>
          </el-form-item>
        </div>
        <div v-if="assetCustomSchemaLoading || assetCustomSchemaError || dynamicFieldGroups.length" class="form-dialog__subsection">
          <div class="form-dialog__subsection-title">{{ t('assetForm.dynamicFields') }}</div>
          <div v-if="assetCustomSchemaLoading" class="asset-custom-schema-state">
            <el-skeleton :rows="4" animated />
          </div>
          <div v-else-if="assetCustomSchemaError" class="asset-custom-schema-state">
            <el-alert :title="t('assetForm.extendedLoadFailed')" :description="assetCustomSchemaError" type="error" :closable="false" show-icon />
            <el-button type="primary" plain :disabled="assetFormSaving" @click="retryAssetCustomSchema">{{ t('assetForm.retry') }}</el-button>
          </div>
          <div v-else-if="dynamicFieldGroups.length" class="asset-custom-field-groups">
            <section v-for="group in dynamicFieldGroups" :key="group.name" class="asset-custom-field-group">
              <div class="asset-custom-field-group__title">{{ group.name }}</div>
              <div class="horizontal-form__rows">
                <el-form-item
                  v-for="field in group.fields"
                  :key="field.id"
                  :prop="`custom_values.${field.key}`"
                  :required="field.required"
                  :error="fieldError(`custom_values.${field.key}`)"
                >
                  <DynamicFieldRenderer
                    :field="field"
                    :model-value="assetForm.custom_values[field.key]"
                    :disabled="assetFormSaving || assetCustomSchemaLoading"
                    @update:model-value="updateAssetCustomFieldValue(field.key, $event)"
                  />
                  <FieldHelp v-if="field.help_text" :text="field.help_text" />
                </el-form-item>
              </div>
            </section>
          </div>
        </div>
      </section>
    </el-form>

    <template #footer>
      <el-button :disabled="assetFormSaving" @click="closeDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="assetFormSaving" :disabled="assetFormLoading || !!assetFormLoadError || assetCustomSchemaLoading || !!assetCustomSchemaError" @click="submitAsset">
        {{ t('assetForm.save') }}
      </el-button>
    </template>
  </FormDialogShell>
</template>
