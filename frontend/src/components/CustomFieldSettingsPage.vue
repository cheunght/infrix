<script setup lang="ts">
import { computed, proxyRefs, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import type { CustomFieldContext } from "../page-context";
import type { CustomField, CustomFieldValidationConfig } from "../types";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import PagedTable from "./PagedTable.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import { systemDatePickerFormat } from "../system-settings";

const props = defineProps<{ context: CustomFieldContext }>();
const { t } = useI18n();
const c = proxyRefs(props.context);
const customFieldFormRef = ref<FormInstance>();
const customFieldOptionFormRef = ref<FormInstance>();
const validationConfig = computed(() => c.customFieldForm.validation_config as CustomFieldValidationConfig);

type NumericValidationKey = "min_length" | "max_length" | "precision" | "min_items" | "max_items";

function validationNumberValue(key: NumericValidationKey) {
  return computed<number | null>({
    get: () => {
      const value = validationConfig.value[key];
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    },
    set: (value) => {
      const config = validationConfig.value as unknown as Record<string, unknown>;
      config[key] = value == null ? undefined : value;
    },
  });
}

const minLengthValue = validationNumberValue("min_length");
const maxLengthValue = validationNumberValue("max_length");
const precisionValue = validationNumberValue("precision");
const minItemsValue = validationNumberValue("min_items");
const maxItemsValue = validationNumberValue("max_items");

const customFieldSortOrderValue = computed<number | null>({
  get: () => {
    const value = Number(c.customFieldForm.sort_order);
    return Number.isFinite(value) ? value : null;
  },
  set: (value) => {
    if (value != null) c.customFieldForm.sort_order = value;
  },
});

const customFieldOptionSortOrderValue = computed<number | null>({
  get: () => {
    const value = Number(c.customFieldOptionForm.sort_order);
    return Number.isFinite(value) ? value : null;
  },
  set: (value) => {
    if (value != null) c.customFieldOptionForm.sort_order = value;
  },
});
const customFieldValidationKeysByType: Record<string, string[]> = {
  text: ["min_length", "max_length"],
  textarea: ["min_length", "max_length"],
  number: ["min", "max", "precision"],
  date: ["min_date", "max_date"],
  multiselect: ["min_items", "max_items"],
  select: [],
  boolean: [],
};
const hasCustomFieldValidationRules = computed(() => (customFieldValidationKeysByType[c.customFieldForm.field_type] || []).length > 0);
const isCustomFieldOptionType = computed(() => ["select", "multiselect"].includes(c.customFieldForm.field_type));
const customFieldDefaultValueDisabled = computed(() => isCustomFieldOptionType.value && (!c.editingCustomField || !(c.editingCustomField.options || []).length));
const customFieldScopeName = computed(() => {
  if (!c.customFieldForm.device_type) return "";
  return c.deviceTypes.find((item) => String(item.id) === String(c.customFieldForm.device_type))?.name || t("customField.fieldType");
});
const customFieldScopeHint = computed(() => customFieldScopeName.value
  ? t("customField.scopeSpecificHelp", { name: customFieldScopeName.value })
  : t("customField.scopeAllHelp"));
const customFieldScopeHelp = computed(() => [
  customFieldScopeHint.value,
  c.editingCustomField ? t("customField.scopeLockedHelp") : "",
].filter(Boolean).join(" "));
const customFieldTypeHelp = computed(() => isCustomFieldOptionType.value ? t("customField.typeHelp") : "");
const customFieldKeyHelp = computed(() => t("customField.keyHelp"));
const customFieldDefaultHelp = computed(() => customFieldDefaultValueDisabled.value ? t("customField.defaultDisabledHelp") : t("customField.defaultHelp"));
const customFieldPlaceholderHelp = computed(() => t("customField.placeholderHelp"));
const listVisibleHelp = computed(() => t("customField.listVisibleHelp"));
const filterableHelp = computed(() => t("customField.filterableHelp"));

const customFieldFormRules = computed<FormRules>(() => ({
  key: [
    { required: true, message: t("customField.requiredKey"), trigger: "blur" },
    { pattern: /^[a-z][a-z0-9_]*$/, message: t("customField.keyPattern"), trigger: ["blur", "change"] },
    { max: 80, message: t("customField.keyMax"), trigger: "blur" },
  ],
  name: [
    { required: true, whitespace: true, message: t("customField.nameRequired"), trigger: "blur" },
    { max: 120, message: t("customField.nameMax"), trigger: "blur" },
  ],
  field_type: [{ required: true, message: t("customField.typeRequired"), trigger: "change" }],
  sort_order: [{
    validator: (_rule, value, callback) => {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 0) callback(new Error(t("customField.orderInteger")));
      else callback();
    },
    trigger: ["blur", "change"],
  }],
  default_value: [{
    validator: (_rule, value, callback) => {
      const normalized = String(value ?? "").trim();
      if (!normalized) {
        callback();
        return;
      }
      if (c.customFieldForm.field_type === "number" && !Number.isFinite(Number(normalized))) {
        callback(new Error(t("customField.numberDefault")));
        return;
      }
      if (c.customFieldForm.field_type === "date") {
        const date = new Date(normalized + "T00:00:00");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(date.getTime())) {
          callback(new Error(t("customField.dateDefault")));
          return;
        }
      }
      if (c.customFieldForm.field_type === "boolean" && !["true", "false"].includes(normalized)) {
        callback(new Error(t("customField.booleanDefault")));
        return;
      }
      callback();
    },
    trigger: ["blur", "change"],
  }],
  validation_config: [{
    validator: (_rule, _value, callback) => {
      const config = validationConfig.value;
      const type = c.customFieldForm.field_type;
      const integerKeys = type === "number"
        ? ["precision"]
        : type === "text" || type === "textarea"
          ? ["min_length", "max_length"]
          : type === "multiselect"
            ? ["min_items", "max_items"]
            : [];
      for (const key of integerKeys) {
        const value = config[key as keyof CustomFieldValidationConfig];
        if (value === undefined || value === null || value === "") continue;
        if (!Number.isInteger(Number(value)) || Number(value) < 0 || (key === "precision" && Number(value) > 6)) {
          callback(new Error(key === "precision" ? t("customField.precisionInteger") : t("customField.nonNegativeInteger")));
          return;
        }
      }
      const minKey = type === "text" || type === "textarea" ? "min_length" : type === "multiselect" ? "min_items" : "";
      const maxKey = type === "text" || type === "textarea" ? "max_length" : type === "multiselect" ? "max_items" : "";
      const minValue = minKey ? config[minKey as keyof CustomFieldValidationConfig] : undefined;
      const maxValue = maxKey ? config[maxKey as keyof CustomFieldValidationConfig] : undefined;
      if (minKey && maxKey && minValue !== undefined && minValue !== null && minValue !== "" && maxValue !== undefined && maxValue !== null && maxValue !== "" && Number(minValue) > Number(maxValue)) {
        callback(new Error(t("customField.minGreaterThanMax")));
        return;
      }
      if (type === "number") {
        for (const key of ["min", "max"] as const) {
          const value = config[key];
          if (value !== undefined && value !== null && value !== "" && !Number.isFinite(Number(value))) {
            callback(new Error(t("customField.validNumber")));
            return;
          }
        }
        if (config.min !== undefined && config.min !== null && config.min !== "" && config.max !== undefined && config.max !== null && config.max !== "" && Number(config.min) > Number(config.max)) {
          callback(new Error(t("customField.minGreaterThanMax")));
          return;
        }
      }
      if (type === "date" && config.min_date && config.max_date && config.min_date > config.max_date) {
        callback(new Error(t("customField.earliestAfterLatest")));
        return;
      }
      callback();
    },
    trigger: ["blur", "change"],
  }],
}));

function ensureFormVisible(value: boolean) {
  if (value) c.customFieldForm.form_visible = true;
}

function openCreateCustomField() {
  c.openCustomFieldModal();
  c.customFieldForm.device_type = "";
}

function openEditCustomField(field: CustomField) {
  c.openCustomFieldModal(field);
}

function handleCustomFieldTypeChange(type: string) {
  const allowedKeys = new Set(customFieldValidationKeysByType[type] || []);
  const config = c.customFieldForm.validation_config || {};
  c.customFieldForm.validation_config = Object.fromEntries(
    Object.entries(config).filter(([key]) => allowedKeys.has(key)),
  );
  customFieldFormRef.value?.clearValidate("validation_config");
}

const customFieldOptionFormRules = computed<FormRules>(() => ({
  value: [
    { required: true, whitespace: true, message: t("customField.stableRequired"), trigger: "blur" },
    { max: 120, message: t("customField.stableMax"), trigger: "blur" },
  ],
  label: [
    { required: true, whitespace: true, message: t("customField.displayRequired"), trigger: "blur" },
    { max: 120, message: t("customField.displayMax"), trigger: "blur" },
  ],
  sort_order: [{
    validator: (_rule, value, callback) => {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 0) callback(new Error(t("customField.orderRequired")));
      else callback();
    },
    trigger: ["blur", "change"],
  }],
}));

async function submitCustomField() {
  const valid = await customFieldFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await c.saveCustomField();
}

async function submitCustomFieldOption() {
  const valid = await customFieldOptionFormRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await c.saveCustomFieldOption();
}
</script>

<template>
  <PageContainer>
    <template #toolbar>
      <PageToolbar>
        <template #filters>
          <div class="page-toolbar__filter-group">
            <el-select v-model="c.customFieldDeviceType" :placeholder="t('customField.allDeviceTypes')" clearable :disabled="c.customFieldListLoading" @change="c.refreshCustomFieldList()">
              <el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
            </el-select>
            <el-select v-model="c.customFieldActive" :placeholder="t('customField.allStatuses')" clearable :disabled="c.customFieldListLoading" @change="c.refreshCustomFieldList()">
              <el-option :label="t('status.active')" value="true" /><el-option :label="t('status.inactive')" value="false" />
            </el-select>
          </div>
        </template>
        <template #primary>
          <el-button v-if="c.can('custom_fields.manage')" class="page-primary-action" type="primary" :disabled="c.customFieldSaving" @click="openCreateCustomField">{{ t('customField.add') }}</el-button>
        </template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-alert v-if="c.customFieldListError" :title="t('customField.loadFailed')" type="error" show-icon :closable="false">
        <template #default>
          <span>{{ c.customFieldListError }}</span>
          <el-button link type="danger" :loading="c.customFieldListLoading" @click="c.retryCustomFieldList">{{ t('customField.retry') }}</el-button>
        </template>
      </el-alert>
      <PagedTable
        v-else
        v-model:current-page="c.customFieldPage"
        v-model:page-size="c.customFieldPageSize"
        :total="c.customFieldCount"
        @update:current-page="c.changeCustomFieldPage"
        @update:page-size="c.changeCustomFieldPageSize"
      >
        <el-table class="settings-custom-field-table" v-loading="c.customFieldListLoading" :data="c.customFieldTableItems" table-layout="fixed">
        <template #empty>
          <el-empty :image-size="56" :description="c.customFieldDeviceType || c.customFieldActive ? t('customField.noMatching') : t('customField.noFields')">
            <el-button v-if="c.customFieldDeviceType || c.customFieldActive" link type="primary" @click="c.customFieldDeviceType = ''; c.customFieldActive = ''; c.refreshCustomFieldList()">{{ t('common.clearFilters') }}</el-button>
          </el-empty>
        </template>
        <el-table-column prop="name" :label="t('customField.fieldName')" min-width="180" show-overflow-tooltip />
        <el-table-column prop="key" :label="t('customField.code')" width="92" show-overflow-tooltip />
        <el-table-column :label="t('customField.scope')" width="92" show-overflow-tooltip><template #default="{ row }">{{ row.device_type_name || t('customField.allAssets') }}</template></el-table-column>
        <el-table-column :label="t('customField.group')" width="72" show-overflow-tooltip><template #default="{ row }">{{ row.group || t('common.none') }}</template></el-table-column>
        <el-table-column prop="field_type_label" :label="t('common.type')" width="70" show-overflow-tooltip />
        <el-table-column :label="t('customField.required')" width="84"><template #default="{ row }"><el-tag size="small" :type="row.required ? 'warning' : 'info'">{{ row.required ? t('common.yes') : t('common.no') }}</el-tag></template></el-table-column>
        <el-table-column :label="t('customField.options')" min-width="145"><template #default="{ row }"><template v-if="['select','multiselect'].includes(row.field_type)"><el-tag v-for="option in (row.options || [])" :key="option.id" size="small" class="field-option-tag">{{ option.label }}</el-tag><el-button v-if="c.can('custom_fields.manage')" link type="primary" :disabled="c.customFieldOptionLoading" @click="c.openCustomFieldOptionModal(row)">{{ t('customField.manageOptions') }}</el-button></template><span v-else>—</span></template></el-table-column>
        <el-table-column prop="assets_count" :label="t('customField.referencedAssets')" width="142" />
        <el-table-column :label="t('common.status')" width="84"><template #default="{ row }"><StatusTag size="small" :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template></el-table-column>
        <el-table-column v-if="c.can('custom_fields.manage')" :label="t('common.operation')" width="132" fixed="right">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <TableIconButton
                :icon="Edit"
                :label="t('common.edit')"
                type="primary"
                :disabled="c.customFieldActionId === row.id || c.customFieldSaving"
                @click="openEditCustomField(row)"
              />
              <TableIconButton
                :icon="row.is_active ? CircleClose : CircleCheck"
                :label="row.is_active ? t('status.inactive') : t('status.active')"
                :disabled="c.customFieldActionId === row.id"
                @click="c.toggleCustomField(row)"
              />
              <TableIconButton
                :icon="Delete"
                :label="t('common.delete')"
                type="danger"
                :disabled="c.customFieldActionId === row.id || (row.assets_count || 0) > 0"
                @click="c.deleteCustomField(row)"
              />
            </div>
          </template>
        </el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell v-model="c.showCustomFieldModal" class="custom-field-dialog" :title="c.editingCustomField ? t('customField.editTitle') : t('customField.createTitle')" :description="t('customField.description')" size="large" :saving="c.customFieldSaving" :show-close="!c.customFieldSaving" :close-disabled="c.customFieldSaving" :close-on-click-modal="!c.customFieldSaving" :close-on-press-escape="!c.customFieldSaving">
    <el-form ref="customFieldFormRef" class="horizontal-form custom-field-form" :model="c.customFieldForm" :rules="customFieldFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitCustomField">
      <section class="form-dialog__section custom-field-form-section custom-field-form-section--basic">
        <h3 class="form-dialog__section-title">{{ t('customField.definition') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('customField.fieldName')" prop="name" required :error="c.customFieldFormErrors.name"><el-input v-model="c.customFieldForm.name" maxlength="120" /></el-form-item>
          <el-form-item :label="t('customField.fieldCode')" prop="key" required :error="c.customFieldFormErrors.key">
            <el-input v-model="c.customFieldForm.key" :disabled="!!c.editingCustomField" :placeholder="t('customField.keyPlaceholder')" />
            <FieldHelp :text="customFieldKeyHelp" />
          </el-form-item>
          <el-form-item :label="t('customField.fieldType')" prop="field_type" required :error="c.customFieldFormErrors.field_type">
            <el-select v-model="c.customFieldForm.field_type" :disabled="!!c.editingCustomField" @change="handleCustomFieldTypeChange"><el-option :label="t('customField.singleLineText')" value="text" /><el-option :label="t('customField.multiLineText')" value="textarea" /><el-option :label="t('customField.number')" value="number" /><el-option :label="t('customField.date')" value="date" /><el-option :label="t('customField.select')" value="select" /><el-option :label="t('customField.multiSelect')" value="multiselect" /><el-option :label="t('customField.boolean')" value="boolean" /></el-select>
            <FieldHelp v-if="customFieldTypeHelp" :text="customFieldTypeHelp" />
          </el-form-item>
        </div>
      </section>

      <section class="form-dialog__section custom-field-form-section">
        <h3 class="form-dialog__section-title">{{ t('customField.scopeSection') }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="t('common.deviceType')" prop="device_type" required :error="c.customFieldFormErrors.device_type">
            <el-select v-model="c.customFieldForm.device_type" :disabled="!!c.editingCustomField" clearable :placeholder="t('customField.allAssets')">
              <el-option :label="t('customField.allAssets')" value="" />
              <el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
            </el-select>
            <FieldHelp :text="customFieldScopeHelp" />
          </el-form-item>
          <el-form-item :label="t('customField.fieldRequirement')">
            <el-checkbox v-model="c.customFieldForm.required" @change="ensureFormVisible">{{ t('customField.required') }}</el-checkbox>
          </el-form-item>
        </div>
      </section>

        <section class="form-dialog__section custom-field-form-section">
          <h3 class="form-dialog__section-title">{{ t('customField.inputConfig') }}</h3>
          <div class="horizontal-form__rows">
            <el-form-item :label="t('customField.group')" prop="group" :error="c.customFieldFormErrors.group"><el-input v-model="c.customFieldForm.group" maxlength="80" :placeholder="t('customField.groupPlaceholder')" /></el-form-item>
            <el-form-item :label="t('customField.sortOrder')" prop="sort_order" :error="c.customFieldFormErrors.sort_order"><el-input-number v-model="customFieldSortOrderValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('customField.sortOrder')" /></el-form-item>
            <el-form-item :label="t('customField.defaultValue')" prop="default_value" :error="c.customFieldFormErrors.default_value">
              <el-input v-model="c.customFieldForm.default_value" maxlength="255" :disabled="customFieldDefaultValueDisabled" />
              <FieldHelp :text="customFieldDefaultHelp" />
            </el-form-item>
            <el-form-item :label="t('customField.inputPlaceholder')" prop="placeholder" :error="c.customFieldFormErrors.placeholder">
              <el-input v-model="c.customFieldForm.placeholder" maxlength="255" :placeholder="t('customField.inputHintPlaceholder')" />
              <FieldHelp :text="customFieldPlaceholderHelp" />
            </el-form-item>
            <el-form-item :label="t('customField.helpText')" prop="help_text" :error="c.customFieldFormErrors.help_text"><el-input v-model="c.customFieldForm.help_text" type="textarea" :rows="2" maxlength="1000" show-word-limit :placeholder="t('customField.helpTextPlaceholder')" /></el-form-item>
          </div>
        </section>

        <section class="form-dialog__section custom-field-form-section">
          <h3 class="form-dialog__section-title">{{ t('customField.displayConfig') }}</h3>
          <div class="custom-field-visibility-row">
            <el-checkbox v-model="c.customFieldForm.is_active">{{ t('customField.enabled') }}</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.form_visible" :disabled="c.customFieldForm.required">{{ t('customField.formVisible') }}</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.detail_visible">{{ t('customField.detailVisible') }}</el-checkbox>
            <div class="custom-field-visibility-option">
              <div class="custom-field-visibility-control">
                <el-checkbox v-model="c.customFieldForm.list_visible">{{ t('customField.listVisible') }}</el-checkbox>
              </div>
              <FieldHelp :text="listVisibleHelp" />
            </div>
            <div class="custom-field-visibility-option">
              <div class="custom-field-visibility-control">
                <el-checkbox v-model="c.customFieldForm.filterable">{{ t('customField.filterable') }}</el-checkbox>
              </div>
              <FieldHelp :text="filterableHelp" />
            </div>
          </div>
        </section>

        <section v-if="hasCustomFieldValidationRules" class="form-dialog__section custom-field-form-section">
          <h3 class="form-dialog__section-title">{{ t('customField.validationRules') }}</h3>
          <div class="horizontal-form__rows">
          <el-form-item :label="t('customField.validationParams')" prop="validation_config" :error="c.customFieldFormErrors.validation_config" class="custom-field-validation">
            <div v-if="['text', 'textarea'].includes(c.customFieldForm.field_type)" class="custom-field-validation-grid">
              <el-input-number v-model="minLengthValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :placeholder="t('customField.minLength')" :aria-label="t('customField.minLength')" />
              <el-input-number v-model="maxLengthValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :placeholder="t('customField.maxLength')" :aria-label="t('customField.maxLength')" />
            </div>
            <div v-else-if="c.customFieldForm.field_type === 'number'" class="custom-field-validation-grid">
              <el-input v-model="validationConfig.min" :placeholder="t('customField.minValue')" />
              <el-input v-model="validationConfig.max" :placeholder="t('customField.maxValue')" />
              <el-input-number v-model="precisionValue" :min="0" :max="6" :step="1" :precision="0" :value-on-clear="null" :placeholder="t('customField.precision')" :aria-label="t('customField.precision')" />
            </div>
            <div v-else-if="c.customFieldForm.field_type === 'date'" class="custom-field-validation-grid">
              <el-date-picker v-model="validationConfig.min_date" type="date" :format="systemDatePickerFormat()" value-format="YYYY-MM-DD" :placeholder="t('customField.earliestDate')" />
              <el-date-picker v-model="validationConfig.max_date" type="date" :format="systemDatePickerFormat()" value-format="YYYY-MM-DD" :placeholder="t('customField.latestDate')" />
            </div>
            <div v-else class="custom-field-validation-grid">
              <el-input-number v-model="minItemsValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :placeholder="t('customField.minItems')" :aria-label="t('customField.minItems')" />
              <el-input-number v-model="maxItemsValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :placeholder="t('customField.maxItems')" :aria-label="t('customField.maxItems')" />
            </div>
          </el-form-item>
          </div>
        </section>
    </el-form>
    <template #footer><el-button :disabled="c.customFieldSaving" @click="c.showCustomFieldModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="c.customFieldSaving" :disabled="c.customFieldSaving" @click="submitCustomField">{{ t('customField.saveField') }}</el-button></template>
  </FormDialogShell>

  <FormDialogShell v-model="c.showCustomFieldOptionModal" class="custom-field-option-dialog" :title="t('customField.optionTitle') + (c.editingCustomField ? `: ${c.editingCustomField.name}` : '')" :description="t('customField.optionDescription')" size="medium" :saving="c.customFieldOptionSaving" :show-close="!c.customFieldOptionSaving" :close-disabled="c.customFieldOptionSaving" :close-on-click-modal="!c.customFieldOptionSaving" :close-on-press-escape="!c.customFieldOptionSaving">
    <section class="form-dialog__section">
      <h3 class="form-dialog__section-title">{{ t('customField.existingOptions') }}</h3>
      <el-alert v-if="c.customFieldOptionError" :title="t('customField.optionLoadFailed')" type="error" show-icon :closable="false">
        <template #default>
          <span>{{ c.customFieldOptionError }}</span>
          <el-button link type="danger" :loading="c.customFieldOptionLoading" @click="c.retryCustomFieldOptions">{{ t('customField.retry') }}</el-button>
        </template>
      </el-alert>
      <PagedTable
        v-else
        v-model:current-page="c.customFieldOptionPage"
        v-model:page-size="c.customFieldOptionPageSize"
        :total="c.customFieldOptionTotal"
        @update:current-page="c.changeCustomFieldOptionPage"
        @update:page-size="c.changeCustomFieldOptionPageSize"
      >
        <el-table v-loading="c.customFieldOptionLoading" :data="c.editingCustomField?.options || []" size="small">
          <template #empty><el-empty :image-size="48" :description="t('customField.noOptions')" /></template>
          <el-table-column prop="value" :label="t('customField.stableValue')" /><el-table-column prop="label" :label="t('customField.displayName')" /><el-table-column prop="sort_order" :label="t('customField.order')" width="70" /><el-table-column :label="t('common.status')" width="80"><template #default="{ row }"><StatusTag size="small" :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" /></template></el-table-column>
          <el-table-column :label="t('common.operation')" width="132">
            <template #default="{ row }">
              <div class="ep-table-actions">
                <TableIconButton
                  :icon="Edit"
                  :label="t('common.edit')"
                  type="primary"
                  :disabled="c.customFieldOptionActionId === row.id || c.customFieldOptionSaving"
                  @click="c.openCustomFieldOptionModal(c.editingCustomField, row)"
                />
                <TableIconButton
                  :icon="Delete"
                  :label="t('common.delete')"
                  type="danger"
                  :disabled="c.customFieldOptionActionId === row.id || c.customFieldOptionSaving"
                  @click="c.deleteCustomFieldOption(row)"
                />
              </div>
            </template>
          </el-table-column>
        </el-table>
      </PagedTable>
    </section>
    <section class="form-dialog__section custom-field-option-form-section">
      <h3 class="form-dialog__section-title">{{ t('customField.optionInfo') }}</h3>
      <el-form ref="customFieldOptionFormRef" :model="c.customFieldOptionForm" :rules="customFieldOptionFormRules" label-position="right" class="horizontal-form horizontal-form__rows" :validate-on-rule-change="false" @submit.prevent="submitCustomFieldOption">
        <el-form-item :label="t('customField.stableValue')" prop="value" required :error="c.customFieldOptionFormErrors.value"><el-input v-model="c.customFieldOptionForm.value" maxlength="120" /></el-form-item>
        <el-form-item :label="t('customField.displayName')" prop="label" required :error="c.customFieldOptionFormErrors.label"><el-input v-model="c.customFieldOptionForm.label" maxlength="120" /></el-form-item>
        <el-form-item :label="t('customField.order')" prop="sort_order" :error="c.customFieldOptionFormErrors.sort_order"><el-input-number v-model="customFieldOptionSortOrderValue" :min="0" :step="1" :precision="0" :value-on-clear="null" :aria-label="t('customField.order')" /></el-form-item>
        <el-form-item :label="t('common.status')">
          <el-select v-model="c.customFieldOptionForm.is_active" :aria-label="t('common.status')">
            <el-option :label="t('status.active')" :value="true" />
            <el-option :label="t('status.inactive')" :value="false" />
          </el-select>
        </el-form-item>
      </el-form>
    </section>
    <template #footer><el-button :disabled="c.customFieldOptionSaving" @click="c.showCustomFieldOptionModal = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="c.customFieldOptionSaving" :disabled="c.customFieldOptionSaving" @click="submitCustomFieldOption">{{ t('customField.saveOption') }}</el-button></template>
  </FormDialogShell>
</template>
