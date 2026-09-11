<!-- UX Reference: standard create/edit form. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { FormInstance, FormRules } from "element-plus";
import type { AssetFormContext } from "../page-context";
import type { AssetModel, CustomFieldSchema, CustomFieldSet, DataCenter, DictionaryItem, PersonOption, Rack, ServerRoom, Tag } from "../types";
import { normalizeApiError } from "../error-handling";
import { isPositiveDecimalString, percentageToRate } from "../depreciation";
import DynamicFieldRenderer from "./fields/DynamicFieldRenderer.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import MoneyInput from "./MoneyInput.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";
import { businessOptionLabel } from "../business-enums";
import {
  decimalStorageIssue,
  customFieldFormatMatches,
  CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES,
  isValidIsoDate,
} from "../custom-field-validation";
import { systemDatePickerFormat } from "../system-settings";

const props = defineProps<{ context: AssetFormContext }>();
const { t } = useI18n();
const context = props.context;
const {
  can,
  request,
  showAssetModal,
  assetModalMode,
  editingAsset,
  assetForm,
  assetStatusOptions,
  assetFormLoading,
  assetFormLoadError,
  assetFormSaving,
  assetFormFieldErrors,
  assetCloneCustomValueWarning,
  retryAssetFormLoad,
  clearAssetFormErrors,
  syncAssetDeviceType,
  assetModels,
  people,
  activeDataCenters,
  changeAssetDataCenter,
  changeAssetRoom,
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
  saveAsset,
} = context;

const showQuickModel = ref(false);
const quickModelSaving = ref(false);
const quickModelError = ref("");
const quickModelForm = ref({ name: "", model_number: "", manufacturer: "", device_type: "", fieldset: "" });

const formRef = ref<FormInstance>();
const visibleAssetCustomFields = computed(() =>
  assetCustomFieldSchema.value.filter((field) => field.is_active !== false && field.form_visible !== false),
);
type DynamicFieldGroup = { key: string; name: string; fields: CustomFieldSchema[] };
const dynamicFieldGroups = computed<DynamicFieldGroup[]>(() => {
  const groups = new Map<string, CustomFieldSchema[]>();
  for (const field of visibleAssetCustomFields.value) {
    const groupName = field.group?.trim() || "";
    const groupKey = groupName || "__default__";
    const fields = groups.get(groupKey) || [];
    fields.push(field);
    groups.set(groupKey, fields);
  }
  return Array.from(groups, ([key, fields]) => ({
    key,
    name: key === "__default__" ? "" : key,
    fields,
  }));
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

const selectedAssetModel = computed(() =>
  assetModels.value.find((item) => String(item.id) === assetForm.value.asset_model_id) || null,
);
const selectedAssetModelOption = computed<SearchableSelectOption | null>(() =>
  selectedAssetModel.value ? mapAssetModel(selectedAssetModel.value as unknown as Record<string, unknown>) : null,
);

const warrantyMonthsValue = computed<number | null>({
  get: () => numberFromText(assetForm.value.warranty_months),
  set: (value) => {
    assetForm.value.warranty_months = value == null ? "" : String(value);
  },
});

async function applyAssetModel(modelId: string | null) {
  const model = modelId ? assetModels.value.find((item) => String(item.id) === modelId) : null;
  if (!model) return;
  assetForm.value.manufacturer_id = model.manufacturer ? String(model.manufacturer) : "";
  assetForm.value.device_type = model.device_type ? String(model.device_type) : "";
  assetForm.value.model_text = "";
  if (!assetForm.value.warranty_months && model.default_warranty_months != null) {
    assetForm.value.warranty_months = String(model.default_warranty_months);
  }
  await syncAssetDeviceType();
}

async function openQuickModel() {
  if (!can("settings.manage")) return;
  quickModelError.value = "";
  quickModelForm.value = {
    name: "",
    model_number: "",
    manufacturer: assetForm.value.manufacturer_id,
    device_type: assetForm.value.device_type,
    fieldset: "",
  };
  showQuickModel.value = true;
}

async function saveQuickModel() {
  const value = quickModelForm.value;
  if (!value.name.trim() || !value.manufacturer || !value.device_type || quickModelSaving.value) return;
  quickModelSaving.value = true;
  quickModelError.value = "";
  try {
    const created = await request<AssetModel>("/asset-models/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: value.name.trim(),
        model_number: value.model_number.trim(),
        manufacturer: Number(value.manufacturer),
        device_type: Number(value.device_type),
        fieldset: value.fieldset ? Number(value.fieldset) : null,
        is_active: true,
      }),
    });
    if (!assetModels.value.some((item) => item.id === created.id)) {
      assetModels.value = [...assetModels.value, created];
    }
    assetForm.value.asset_model_id = String(created.id);
    await applyAssetModel(String(created.id));
    showQuickModel.value = false;
  } catch (error) {
    quickModelError.value = normalizeApiError(error).message || t("assetModel.saveFailed");
  } finally {
    quickModelSaving.value = false;
  }
}

function personMeta(person: PersonOption) {
  return [person.employee_no, person.department_name].filter(Boolean).join(" · ");
}

function mapAssetModel(item: Record<string, unknown>): SearchableSelectOption {
  const model = item as unknown as AssetModel;
  return {
    value: model.id,
    label: model.name,
    secondary: [model.model_number, model.manufacturer_name, model.device_type_name].filter(Boolean).join(" · "),
    data: model,
  };
}

function mapPerson(item: Record<string, unknown>): SearchableSelectOption {
  const person = item as unknown as PersonOption;
  return { value: person.id, label: person.name || person.display_name, secondary: personMeta(person), data: person };
}

function mapDictionary(item: Record<string, unknown>): SearchableSelectOption {
  const dictionary = item as unknown as DictionaryItem;
  return { value: dictionary.id, label: dictionary.name, secondary: dictionary.code || "", data: dictionary };
}

function mapDataCenter(item: Record<string, unknown>): SearchableSelectOption {
  const center = item as unknown as DataCenter;
  return { value: center.id, label: center.name, secondary: center.address || "", data: center };
}

function mapRoom(item: Record<string, unknown>): SearchableSelectOption {
  const room = item as unknown as ServerRoom;
  return { value: room.id, label: room.name, secondary: room.data_center_name || "", data: room };
}

function mapRack(item: Record<string, unknown>): SearchableSelectOption {
  const rack = item as unknown as Rack;
  return { value: rack.id, label: rack.code, secondary: [rack.name, rack.server_room_name, rack.data_center_name].filter(Boolean).join(" · "), data: rack };
}

function mapFieldset(item: Record<string, unknown>): SearchableSelectOption {
  const fieldset = item as unknown as CustomFieldSet;
  return { value: fieldset.id, label: fieldset.name, secondary: fieldset.description || "", data: fieldset };
}

function mapTag(item: Record<string, unknown>): SearchableSelectOption {
  const tag = item as unknown as Tag;
  return {
    value: String(tag.id),
    label: tag.name,
    secondary: tag.is_active === false ? t("status.inactive") : "",
    disabled: tag.is_active === false,
    data: tag,
  };
}

function handleAssetModelSelect(option: SearchableSelectOption | SearchableSelectOption[] | null) {
  const selected = Array.isArray(option) ? option[0] : option;
  const model = selected?.data as AssetModel | undefined;
  if (model && !assetModels.value.some((item) => item.id === model.id)) assetModels.value = [...assetModels.value, model];
  void applyAssetModel(model ? String(model.id) : null);
}

function handleRackSelect(option: SearchableSelectOption | SearchableSelectOption[] | null) {
  const selected = Array.isArray(option) ? option[0] : option;
  const rack = selected?.data as Rack | undefined;
  if (rack) assetForm.value.rack_total_u = String(rack.total_u || 45);
  void changeAssetRack();
}

const selectedPersonOption = computed<SearchableSelectOption | null>(() => {
  const person = people.value.find((item) => String(item.id) === assetForm.value.assigned_person);
  return person ? mapPerson(person as unknown as Record<string, unknown>) : null;
});

const selectedTagOptions = computed<SearchableSelectOption[]>(() => selectableTags.value
  .filter((tag) => assetForm.value.tags.includes(String(tag.id)))
  .map((tag) => mapTag(tag as unknown as Record<string, unknown>)));

const selectedDataCenterOption = computed<SearchableSelectOption | null>(() => {
  const id = assetForm.value.rack_mounted ? assetForm.value.data_center : assetForm.value.asset_data_center;
  const center = activeDataCenters.value.find((item) => String(item.id) === id);
  return center ? mapDataCenter(center as unknown as Record<string, unknown>) : null;
});

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

function existingInactiveOptionValues(field: CustomFieldSchema): Set<string> {
  const selected = new Set<string>();
  const currentValue = assetForm.value.custom_values[field.key];
  if (field.field_type === "select" && typeof currentValue === "string") selected.add(currentValue);
  if (field.field_type === "multiselect" && Array.isArray(currentValue)) {
    for (const value of currentValue) if (typeof value === "string") selected.add(value);
  }
  return new Set(
    (field.options || [])
      .filter((option) => !option.is_active && selected.has(option.value))
      .map((option) => option.value),
  );
}

function customFieldRule(field: CustomFieldSchema) {
  return {
    validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
      const empty = isCustomFieldEmpty(field, value);
      if (empty) return callback(field.required ? new Error(t("assetForm.fieldRequired", { field: field.name })) : undefined);

      const config = field.validation_config || {};
      if (field.field_type === "text" || field.field_type === "textarea") {
        if (!customFieldFormatMatches(String(value), config.format || "any", config.pattern)) {
          return callback(new Error(t("assetForm.fieldFormat", { field: field.name })));
        }
        const length = String(value).length;
        if (config.min_length != null && length < config.min_length) {
          return callback(new Error(t("assetForm.fieldMinLength", { field: field.name, count: config.min_length })));
        }
        if (config.max_length != null && length > config.max_length) {
          return callback(new Error(t("assetForm.fieldMaxLength", { field: field.name, count: config.max_length })));
        }
      }

      if (field.field_type === "number") {
        const precision = CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES;
        const storageIssue = decimalStorageIssue(value);
        if (storageIssue === "invalid") return callback(new Error(t("assetForm.fieldNumber", { field: field.name })));
        if (storageIssue === "integer") return callback(new Error(t("assetForm.fieldIntegerDigits", { field: field.name })));
        if (storageIssue === "precision") return callback(new Error(t("assetForm.fieldPrecision", { field: field.name, count: precision })));
      }

      if (field.field_type === "date") {
        const date = String(value);
        if (!isValidIsoDate(date)) return callback(new Error(t("assetForm.fieldDateFormat", { field: field.name })));
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
        for (const value of existingInactiveOptionValues(field)) activeValues.add(value);
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
        <el-form-item :label="t('assetForm.assetModel')" :error="fieldError('asset_model_id')">
          <SearchableSelect
            v-model="assetForm.asset_model_id"
            :request="request"
            endpoint="/asset-models/"
            :map-option="mapAssetModel"
            :placeholder="t('assetForm.selectAssetModel')"
            :selected-option="selectedAssetModelOption"
            :base-query="{ is_active: true }"
            @select="handleAssetModelSelect"
          />
          <el-button v-if="can('settings.manage')" class="asset-form-quick-model" link type="primary" @click="openQuickModel">{{ t('assetForm.quickAddModel') }}</el-button>
          <div v-if="selectedAssetModel" class="asset-model-metadata">
            <span class="asset-model-metadata__item">
              <strong>{{ t('assetModel.manufacturer') }}</strong>
              <span>{{ selectedAssetModel.manufacturer_name || t('assetForm.unsetMetadata') }}</span>
            </span>
            <span class="asset-model-metadata__item">
              <strong>{{ t('assetModel.category') }}</strong>
              <span>{{ selectedAssetModel.device_type_name || t('assetForm.unsetMetadata') }}</span>
            </span>
            <span v-if="selectedAssetModel.model_number" class="asset-model-metadata__item">
              <strong>{{ t('assetModel.modelNumber') }}</strong>
              <span>{{ selectedAssetModel.model_number }}</span>
            </span>
            <span class="asset-model-metadata__item">
              <strong>{{ t('assetModel.fieldset') }}</strong>
              <span>{{ selectedAssetModel.effective_fieldset?.name || t('assetForm.unsetMetadata') }}</span>
            </span>
            <span v-if="selectedAssetModel.default_warranty_months != null" class="asset-model-metadata__item">
              <strong>{{ t('assetModel.defaultWarranty') }}</strong>
              <span>{{ t('assetForm.defaultWarrantyMonths', { months: selectedAssetModel.default_warranty_months }) }}</span>
            </span>
            <span v-if="selectedAssetModel.expected_life_months != null" class="asset-model-metadata__item">
              <strong>{{ t('assetModel.expectedLife') }}</strong>
              <span>{{ t('assetForm.expectedLifeMonths', { months: selectedAssetModel.expected_life_months }) }}</span>
            </span>
          </div>
          <FieldHelp v-if="selectedAssetModel" :text="t('assetForm.assetModelSelectionHint')" />
        </el-form-item>
        <el-form-item v-if="!assetForm.asset_model_id" :label="t('assetForm.customModel')" :error="fieldError('model_text')">
          <el-input v-model="assetForm.model_text" :placeholder="t('assetForm.modelPlaceholder')" />
          <FieldHelp :text="t('assetForm.customModelHint')" />
        </el-form-item>
        <el-form-item v-if="!assetForm.asset_model_id" :label="t('asset.deviceType')" prop="device_type" required :error="fieldError('device_type')">
          <SearchableSelect
            v-model="assetForm.device_type"
            :request="request"
            endpoint="/device-types/"
            :map-option="mapDictionary"
            :placeholder="t('assetForm.unlinkedDeviceType')"
            :base-query="{ is_active: true }"
            @select="syncAssetDeviceType"
          />
        </el-form-item>
        <el-form-item v-if="!assetForm.asset_model_id" :label="t('asset.manufacturer')" :error="fieldError('manufacturer_id')">
          <SearchableSelect
            v-model="assetForm.manufacturer_id"
            :request="request"
            endpoint="/manufacturers/"
            :map-option="mapDictionary"
            :placeholder="t('assetForm.unlinkedManufacturer')"
            :base-query="{ is_active: true }"
          />
        </el-form-item>
        <el-form-item :label="t('asset.status')" prop="status" required :error="fieldError('status')">
          <el-select v-model="assetForm.status">
            <el-option v-for="option in assetStatusOptions" :key="option.value" :label="businessOptionLabel(assetStatusOptions, option.value)" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('assetForm.warrantyMonths')" :error="fieldError('warranty_months')">
          <el-input-number v-model="warrantyMonthsValue" :min="0" :precision="0" :step="1" :value-on-clear="null" />
          <FieldHelp :text="t('assetForm.warrantyMonthsHint')" />
        </el-form-item>
        <el-form-item :label="t('asset.serialNumber')" :error="fieldError('serial_number')"><el-input v-model="assetForm.serial_number" /></el-form-item>
        <el-form-item :label="t('asset.purpose')" :error="fieldError('purpose')"><el-input v-model="assetForm.purpose" /></el-form-item>
        <el-form-item :label="t('asset.assignedPerson')" :error="fieldError('assigned_person')">
          <SearchableSelect
            v-model="assetForm.assigned_person"
            :request="request"
            endpoint="/people/"
            :map-option="mapPerson"
            :placeholder="t('assetForm.selectAssignedPerson')"
            :selected-option="selectedPersonOption"
            :base-query="{ is_active: true }"
          />
        </el-form-item>
        <el-form-item :label="t('asset.assignmentReason')" :error="fieldError('assignment_reason')">
          <el-input
            v-model="assetForm.assignment_reason"
            type="textarea"
            :rows="2"
            :placeholder="t('assetForm.assignmentReasonPlaceholder')"
          />
        </el-form-item>
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
            <SearchableSelect
              v-model="assetForm.asset_data_center"
              :request="request"
              endpoint="/data-centers/"
              :map-option="mapDataCenter"
              :placeholder="t('assetForm.noDataCenter')"
              :selected-option="selectedDataCenterOption"
              :base-query="{ is_active: true }"
            />
          </el-form-item>
        </div>
        <div v-if="assetForm.rack_mounted" class="horizontal-form__rows">
        <el-form-item :label="t('common.dataCenter')" :error="fieldError('data_center')">
          <SearchableSelect
            v-model="assetForm.data_center"
            :request="request"
            endpoint="/data-centers/"
            :map-option="mapDataCenter"
            :placeholder="t('assetForm.noDataCenter')"
            :selected-option="selectedDataCenterOption"
            :base-query="{ is_active: true }"
            @update:model-value="changeAssetDataCenter"
          />
        </el-form-item>
        <el-form-item :label="t('common.room')" :error="fieldError('server_room_id')">
          <SearchableSelect
            v-model="assetForm.server_room_id"
            :request="request"
            endpoint="/server-rooms/"
            :map-option="mapRoom"
            :placeholder="t('assetForm.selectRoom')"
            :base-query="{ data_center: assetForm.data_center, is_active: true }"
            @update:model-value="changeAssetRoom"
          />
        </el-form-item>
        <el-form-item :label="t('rack.rackCode')" prop="rack_id" :error="fieldError('rack_id')">
          <SearchableSelect
            v-model="assetForm.rack_id"
            :request="request"
            endpoint="/racks/"
            :map-option="mapRack"
            :placeholder="t('assetForm.selectRack')"
            :base-query="{ room: assetForm.server_room_id, is_active: true, status: 'in_use' }"
            @select="handleRackSelect"
          />
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
        <el-form-item :label="t('asset.purchaseDate')" prop="purchase_date" :error="fieldError('purchase_date')"><el-date-picker v-model="assetForm.purchase_date" type="date" :format="systemDatePickerFormat()" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item :label="t('asset.supplier')" :error="fieldError('supplier')"><el-input v-model="assetForm.supplier" /></el-form-item>
        <el-form-item :label="t('asset.purchaseOrder')" :error="fieldError('purchase_order_no')"><el-input v-model="assetForm.purchase_order_no" /></el-form-item>
        <el-form-item :label="t('asset.purchaseAmount')" prop="purchase_amount" :error="fieldError('purchase_amount')">
          <MoneyInput v-model="purchaseAmountValue" :placeholder="t('assetForm.purchaseAmountPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('asset.procurementNotes')" :error="fieldError('procurement_notes')"><el-input v-model="assetForm.procurement_notes" type="textarea" :rows="2" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceProvider')" :error="fieldError('maintenance_provider')"><el-input v-model="assetForm.maintenance_provider" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceContract')" :error="fieldError('maintenance_contract_no')"><el-input v-model="assetForm.maintenance_contract_no" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceStart')" prop="maintenance_start_date" :error="fieldError('maintenance_start_date')"><el-date-picker v-model="assetForm.maintenance_start_date" type="date" :format="systemDatePickerFormat()" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceExpiry')" prop="maintenance_expiry_date" :error="fieldError('maintenance_expiry_date')"><el-date-picker v-model="assetForm.maintenance_expiry_date" type="date" :format="systemDatePickerFormat()" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item :label="t('asset.maintenanceNotes')" :error="fieldError('maintenance_notes')"><el-input v-model="assetForm.maintenance_notes" type="textarea" :rows="2" /></el-form-item>
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
              <el-date-picker v-model="assetForm.depreciation_start_date" type="date" :format="systemDatePickerFormat()" value-format="YYYY-MM-DD" @change="markDepreciationStartTouched" />
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
            <SearchableSelect
              v-model="assetForm.tags"
              :request="request"
              endpoint="/tags/"
              :map-option="mapTag"
              :selected-options="selectedTagOptions"
              :base-query="{ is_active: true }"
              multiple
              clearable
              collapse-tags
              :max-collapse-tags="3"
              :placeholder="t('assetForm.selectTags')"
              :aria-label="t('assetForm.tags')"
            />
          </el-form-item>
        </div>
        <div v-if="assetCustomSchemaLoading || assetCustomSchemaError || dynamicFieldGroups.length" class="form-dialog__subsection">
          <div class="form-dialog__section-title">{{ t('assetForm.dynamicFields') }}</div>
          <el-alert
            v-if="assetCloneCustomValueWarning"
            :title="assetCloneCustomValueWarning"
            type="warning"
            :closable="false"
            show-icon
            class="asset-custom-clone-warning"
          />
          <div v-if="assetCustomSchemaLoading" class="asset-custom-schema-state">
            <el-skeleton :rows="4" animated />
          </div>
          <div v-else-if="assetCustomSchemaError" class="asset-custom-schema-state">
            <el-alert :title="t('assetForm.extendedLoadFailed')" :description="assetCustomSchemaError" type="error" :closable="false" show-icon />
            <el-button type="primary" plain :disabled="assetFormSaving" @click="retryAssetCustomSchema">{{ t('assetForm.retry') }}</el-button>
          </div>
          <div v-else-if="dynamicFieldGroups.length" class="asset-custom-field-groups">
            <section v-for="group in dynamicFieldGroups" :key="group.key" class="asset-custom-field-group" :class="{ 'asset-custom-field-group--default': !group.name }">
              <div v-if="group.name" class="asset-custom-field-group__title">{{ group.name }}</div>
              <div class="horizontal-form__rows">
                <el-form-item
                  v-for="field in group.fields"
                  :key="field.id"
                  :label="field.name"
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

  <FormDialogShell v-model="showQuickModel" :title="t('assetModel.createTitle')" :description="t('assetForm.quickAddModelHint')" size="small" :saving="quickModelSaving" :close-disabled="quickModelSaving">
    <el-form class="horizontal-form" :model="quickModelForm" label-position="right" @submit.prevent="saveQuickModel">
      <el-alert v-if="quickModelError" :title="quickModelError" type="error" show-icon :closable="false" />
      <div class="horizontal-form__rows">
        <el-form-item :label="t('assetModel.name')" required><el-input v-model="quickModelForm.name" maxlength="160" /></el-form-item>
        <el-form-item :label="t('assetModel.modelNumber')"><el-input v-model="quickModelForm.model_number" maxlength="160" /></el-form-item>
        <el-form-item :label="t('assetModel.manufacturer')" required>
          <SearchableSelect v-model="quickModelForm.manufacturer" :request="request" endpoint="/manufacturers/" :map-option="mapDictionary" :base-query="{ is_active: true }" />
        </el-form-item>
        <el-form-item :label="t('assetModel.category')" required>
          <SearchableSelect v-model="quickModelForm.device_type" :request="request" endpoint="/device-types/" :map-option="mapDictionary" :base-query="{ is_active: true }" />
        </el-form-item>
        <el-form-item :label="t('assetModel.fieldset')">
          <SearchableSelect v-model="quickModelForm.fieldset" :request="request" endpoint="/custom-fieldsets/" :map-option="mapFieldset" :base-query="{ is_active: true }" :placeholder="t('assetModel.inheritFieldset')" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer><el-button :disabled="quickModelSaving" @click="showQuickModel = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="quickModelSaving" :disabled="!quickModelForm.name.trim() || !quickModelForm.manufacturer || !quickModelForm.device_type" @click="saveQuickModel">{{ t('common.save') }}</el-button></template>
  </FormDialogShell>
</template>
