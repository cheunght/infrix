<script setup lang="ts">
import { computed, proxyRefs, ref } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import type { CustomFieldContext } from "../page-context";
import type { CustomField, CustomFieldFormat, CustomFieldValidationConfig } from "../types";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import SearchField from "./SearchField.vue";
import StatusTag from "./StatusTag.vue";
import PagedTable from "./PagedTable.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";
import {
  decimalStorageIssue,
  customFieldFormatMatches,
  customFieldFormatPatternError,
  isCustomFieldFormat,
  isValidIsoDate,
  CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES,
} from "../custom-field-validation";

const props = defineProps<{ context: CustomFieldContext }>();
const { t } = useI18n();
const c = proxyRefs(props.context);
const customFieldFormRef = ref<FormInstance>();
const customFieldOptionFormRef = ref<FormInstance>();
const validationConfig = computed(() => c.customFieldForm.validation_config as CustomFieldValidationConfig);

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
  text: ["format", "pattern", "min_length", "max_length"],
  textarea: ["format", "pattern", "min_length", "max_length"],
  number: [],
  date: [],
  multiselect: ["min_items", "max_items"],
  select: [],
  boolean: [],
};
const customFieldFormat = computed<CustomFieldFormat>({
  get: () => isCustomFieldFormat(validationConfig.value.format) ? validationConfig.value.format : "any",
  set: (value) => {
    const config = validationConfig.value as unknown as Record<string, unknown>;
    config.format = value;
    if (value !== "regex") delete config.pattern;
  },
});
const isCustomFieldOptionType = computed(() => ["select", "multiselect"].includes(c.customFieldForm.field_type));
const customFieldDefaultValueDisabled = computed(() => isCustomFieldOptionType.value && (!c.editingCustomField || !(c.editingCustomField.options || []).length));
const customFieldTypeHelp = computed(() => isCustomFieldOptionType.value ? t("customField.typeHelp") : "");
const customFieldKeyHelp = computed(() => t("customField.keyHelp"));
const customFieldDefaultHelp = computed(() => customFieldDefaultValueDisabled.value ? t("customField.defaultDisabledHelp") : t("customField.defaultHelp"));
const customFieldPlaceholderHelp = computed(() => t("customField.placeholderHelp"));
const listVisibleHelp = computed(() => t("customField.listVisibleHelp"));
const filterableHelp = computed(() => t("customField.filterableHelp"));

function activeCustomFieldOptionValues() {
  return new Set((c.editingCustomField?.options || []).filter((option) => option.is_active).map((option) => option.value));
}

function optionSummary(field: CustomField): string {
  const options = field.options || [];
  const preview = options.slice(0, 2).map((option) => option.label).join("、");
  return t("customField.optionSummary", { count: options.length, preview: preview ? ` · ${preview}` : "" });
}

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
  default_value: [{
    validator: (_rule, value, callback) => {
      const normalized = String(value ?? "").trim();
      if (!normalized) {
        callback();
        return;
      }
      const type = c.customFieldForm.field_type;
      const config = validationConfig.value;
      if (type === "text" || type === "textarea") {
        if (!customFieldFormatMatches(normalized, customFieldFormat.value, config.pattern)) {
          callback(new Error(t("customField.defaultFormat")));
          return;
        }
        if (config.min_length != null && normalized.length < config.min_length) {
          callback(new Error(t("customField.defaultMinLength", { count: config.min_length })));
          return;
        }
        if (config.max_length != null && normalized.length > config.max_length) {
          callback(new Error(t("customField.defaultMaxLength", { count: config.max_length })));
          return;
        }
      }
      if (type === "number") {
        const issue = decimalStorageIssue(normalized);
        if (issue === "invalid") {
          callback(new Error(t("customField.numberDefault")));
          return;
        }
        if (issue === "integer") {
          callback(new Error(t("customField.numberDefaultInteger")));
          return;
        }
        if (issue === "precision") {
          callback(new Error(t("customField.numberDefaultPrecision", { count: CUSTOM_FIELD_NUMBER_MAX_DECIMAL_PLACES })));
          return;
        }
      }
      if (type === "date") {
        if (!isValidIsoDate(normalized)) {
          callback(new Error(t("customField.dateDefault")));
          return;
        }
      }
      if (type === "boolean" && !["true", "false"].includes(normalized)) {
        callback(new Error(t("customField.booleanDefault")));
        return;
      }
      if (type === "select" && !activeCustomFieldOptionValues().has(normalized)) {
        callback(new Error(t("customField.defaultOption")));
        return;
      }
      if (type === "multiselect") {
        let values: unknown;
        try {
          values = JSON.parse(normalized);
        } catch {
          callback(new Error(t("customField.multiselectDefault")));
          return;
        }
        if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
          callback(new Error(t("customField.multiselectDefault")));
          return;
        }
        if (config.min_items != null && values.length < config.min_items) {
          callback(new Error(t("customField.defaultMinItems", { count: config.min_items })));
          return;
        }
        if (config.max_items != null && values.length > config.max_items) {
          callback(new Error(t("customField.defaultMaxItems", { count: config.max_items })));
          return;
        }
        const options = activeCustomFieldOptionValues();
        if (values.some((value) => !options.has(value))) {
          callback(new Error(t("customField.defaultOption")));
          return;
        }
      }
      callback();
    },
    trigger: ["blur", "change"],
  }],
  validation_config: [{
    validator: (_rule, _value, callback) => {
      const config = validationConfig.value;
      const type = c.customFieldForm.field_type;
      const integerKeys = type === "text" || type === "textarea"
          ? ["min_length", "max_length"]
          : type === "multiselect"
            ? ["min_items", "max_items"]
            : [];
      for (const key of integerKeys) {
        const value = config[key as keyof CustomFieldValidationConfig];
        if (value === undefined || value === null || value === "") continue;
        if (!Number.isInteger(Number(value)) || Number(value) < 0) {
          callback(new Error(t("customField.nonNegativeInteger")));
          return;
        }
      }
      if (type === "text" || type === "textarea") {
        if (!isCustomFieldFormat(config.format || "any")) {
          callback(new Error(t("customField.invalidFormat")));
          return;
        }
        if (config.format === "regex") {
          const patternError = customFieldFormatPatternError(config.pattern);
          if (patternError === "required") {
            callback(new Error(t("customField.regexRequired")));
            return;
          }
          if (patternError === "too_long" || patternError === "invalid") {
            callback(new Error(t("customField.regexInvalid")));
            return;
          }
        } else if (config.pattern) {
          callback(new Error(t("customField.regexFormatOnly")));
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
      callback();
    },
    trigger: ["blur", "change"],
  }],
}));

function openCreateCustomField() {
  c.openCustomFieldModal();
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
        <template #search>
          <SearchField v-model="c.customFieldSearch" :loading="c.customFieldListLoading" :placeholder="t('customField.searchPlaceholder')" @search="c.refreshCustomFieldList" />
        </template>
        <template #filters>
          <div class="page-toolbar__filter-group">
            <el-select v-model="c.customFieldType" clearable :placeholder="t('common.type')" :disabled="c.customFieldListLoading" @change="c.refreshCustomFieldList">
              <el-option :label="t('customField.singleLineText')" value="text" /><el-option :label="t('customField.multiLineText')" value="textarea" /><el-option :label="t('customField.number')" value="number" /><el-option :label="t('customField.date')" value="date" /><el-option :label="t('customField.select')" value="select" /><el-option :label="t('customField.multiSelect')" value="multiselect" /><el-option :label="t('customField.boolean')" value="boolean" />
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
          <el-empty :image-size="56" :description="c.customFieldActive || c.customFieldSearch || c.customFieldType ? t('customField.noMatching') : t('customField.noFields')">
            <el-button v-if="c.customFieldActive || c.customFieldSearch || c.customFieldType" link type="primary" @click="c.customFieldActive = ''; c.customFieldSearch = ''; c.customFieldType = ''; c.refreshCustomFieldList()">{{ t('common.clearFilters') }}</el-button>
          </el-empty>
        </template>
        <el-table-column prop="name" :label="t('customField.fieldName')" min-width="180" show-overflow-tooltip />
        <el-table-column prop="key" :label="t('customField.code')" width="92" show-overflow-tooltip />
        <el-table-column prop="field_type_label" :label="t('common.type')" width="70" show-overflow-tooltip />
        <el-table-column :label="t('customField.options')" min-width="145"><template #default="{ row }"><template v-if="['select','multiselect'].includes(row.field_type)"><span class="custom-field-option-summary">{{ optionSummary(row) }}</span><el-button v-if="c.can('custom_fields.manage')" link type="primary" :disabled="c.customFieldOptionLoading" @click="c.openCustomFieldOptionModal(row)">{{ t('customField.manageOptions') }}</el-button></template><span v-else>—</span></template></el-table-column>
        <el-table-column prop="fieldsets_count" :label="t('customField.referencedFieldsets')" width="132" />
        <el-table-column prop="assets_count" :label="t('customField.referencedAssets')" width="120" />
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
                :disabled="c.customFieldActionId === row.id || (row.assets_count || 0) > 0 || (row.fieldsets_count || 0) > 0"
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
          <h3 class="form-dialog__section-title">{{ t('customField.inputConfig') }}</h3>
          <div class="horizontal-form__rows">
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
            <el-checkbox v-model="c.customFieldForm.form_visible">{{ t('customField.formVisible') }}</el-checkbox>
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
