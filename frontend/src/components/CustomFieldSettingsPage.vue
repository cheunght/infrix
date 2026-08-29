<script setup lang="ts">
import { computed, proxyRefs, ref } from "vue";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import type { CustomFieldContext } from "../types/page-context";
import type { CustomField, CustomFieldValidationConfig } from "../types";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import PagedTable from "./PagedTable.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import TableIconButton from "./TableIconButton.vue";

const props = defineProps<{ context: CustomFieldContext }>();
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
  return c.deviceTypes.find((item) => String(item.id) === String(c.customFieldForm.device_type))?.name || "指定设备类型";
});
const customFieldScopeHint = computed(() => customFieldScopeName.value
  ? `该字段仅在“${customFieldScopeName.value}”资产中使用。`
  : "该字段适用于所有设备类型。");
const customFieldScopeHelp = computed(() => [
  customFieldScopeHint.value,
  c.editingCustomField ? "适用范围创建后不可修改。" : "",
].filter(Boolean).join(" "));
const customFieldTypeHelp = computed(() => isCustomFieldOptionType.value ? "保存字段后可配置选项。" : "");
const customFieldKeyHelp = "用于系统识别和 API，创建后不可修改。";
const customFieldDefaultHelp = computed(() => customFieldDefaultValueDisabled.value ? "请先保存字段并配置选项。" : "新建资产时自动带入的初始值。");
const customFieldPlaceholderHelp = "显示在资产编辑输入框中的提示文字。";
const listVisibleHelp = "允许用户在资产台账的“显示列”中选择该字段。";
const filterableHelp = "允许资产台账将该字段作为筛选条件。";

const customFieldFormRules: FormRules = {
  key: [
    { required: true, message: "请输入字段编码", trigger: "blur" },
    { pattern: /^[a-z][a-z0-9_]*$/, message: "字段编码只能包含小写字母、数字和下划线，且必须以字母开头", trigger: ["blur", "change"] },
    { max: 80, message: "字段编码不能超过 80 个字符", trigger: "blur" },
  ],
  name: [
    { required: true, whitespace: true, message: "请输入字段名称", trigger: "blur" },
    { max: 120, message: "字段名称不能超过 120 个字符", trigger: "blur" },
  ],
  field_type: [{ required: true, message: "请选择字段类型", trigger: "change" }],
  sort_order: [{
    validator: (_rule, value, callback) => {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 0) callback(new Error("显示顺序必须是非负整数"));
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
        callback(new Error("数字字段的默认值必须能解析为数字"));
        return;
      }
      if (c.customFieldForm.field_type === "date") {
        const date = new Date(normalized + "T00:00:00");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(date.getTime())) {
          callback(new Error("日期字段的默认值必须是有效日期"));
          return;
        }
      }
      if (c.customFieldForm.field_type === "boolean" && !["true", "false"].includes(normalized)) {
        callback(new Error("是/否字段的默认值只能是 true 或 false"));
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
          callback(new Error(key === "precision" ? "小数位必须是 0-6 的整数" : "数量必须是非负整数"));
          return;
        }
      }
      const minKey = type === "text" || type === "textarea" ? "min_length" : type === "multiselect" ? "min_items" : "";
      const maxKey = type === "text" || type === "textarea" ? "max_length" : type === "multiselect" ? "max_items" : "";
      const minValue = minKey ? config[minKey as keyof CustomFieldValidationConfig] : undefined;
      const maxValue = maxKey ? config[maxKey as keyof CustomFieldValidationConfig] : undefined;
      if (minKey && maxKey && minValue !== undefined && minValue !== null && minValue !== "" && maxValue !== undefined && maxValue !== null && maxValue !== "" && Number(minValue) > Number(maxValue)) {
        callback(new Error("最小值不能大于最大值"));
        return;
      }
      if (type === "number") {
        for (const key of ["min", "max"] as const) {
          const value = config[key];
          if (value !== undefined && value !== null && value !== "" && !Number.isFinite(Number(value))) {
            callback(new Error("数字范围必须是有效数字"));
            return;
          }
        }
        if (config.min !== undefined && config.min !== null && config.min !== "" && config.max !== undefined && config.max !== null && config.max !== "" && Number(config.min) > Number(config.max)) {
          callback(new Error("最小值不能大于最大值"));
          return;
        }
      }
      if (type === "date" && config.min_date && config.max_date && config.min_date > config.max_date) {
        callback(new Error("最早日期不能晚于最晚日期"));
        return;
      }
      callback();
    },
    trigger: ["blur", "change"],
  }],
};

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

const customFieldOptionFormRules: FormRules = {
  value: [
    { required: true, whitespace: true, message: "请输入稳定值", trigger: "blur" },
    { max: 120, message: "稳定值不能超过 120 个字符", trigger: "blur" },
  ],
  label: [
    { required: true, whitespace: true, message: "请输入显示名称", trigger: "blur" },
    { max: 120, message: "显示名称不能超过 120 个字符", trigger: "blur" },
  ],
  sort_order: [{
    validator: (_rule, value, callback) => {
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 0) callback(new Error("顺序必须是非负整数"));
      else callback();
    },
    trigger: ["blur", "change"],
  }],
};

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
            <el-select v-model="c.customFieldDeviceType" placeholder="全部设备类型" clearable :disabled="c.customFieldListLoading" @change="c.refreshCustomFieldList()">
              <el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
            </el-select>
            <el-select v-model="c.customFieldActive" placeholder="全部状态" clearable :disabled="c.customFieldListLoading" @change="c.refreshCustomFieldList()">
              <el-option label="启用" value="true" /><el-option label="停用" value="false" />
            </el-select>
          </div>
        </template>
        <template #primary>
          <el-button v-if="c.can('custom_fields.manage')" class="page-primary-action" type="primary" :disabled="c.customFieldSaving" @click="openCreateCustomField">新增字段</el-button>
        </template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <el-alert v-if="c.customFieldListError" title="自定义字段数据加载失败" type="error" show-icon :closable="false">
        <template #default>
          <span>{{ c.customFieldListError }}</span>
          <el-button link type="danger" :loading="c.customFieldListLoading" @click="c.retryCustomFieldList">重新加载</el-button>
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
        <el-table v-loading="c.customFieldListLoading" :data="c.customFieldTableItems">
        <template #empty>
          <el-empty :image-size="56" :description="c.customFieldDeviceType || c.customFieldActive ? '没有符合当前筛选条件的自定义字段' : '暂无自定义字段'">
            <el-button v-if="c.customFieldDeviceType || c.customFieldActive" link type="primary" @click="c.customFieldDeviceType = ''; c.customFieldActive = ''; c.refreshCustomFieldList()">清除筛选</el-button>
          </el-empty>
        </template>
        <el-table-column prop="name" label="字段名称" min-width="150" />
        <el-table-column prop="key" label="编码" min-width="150" />
        <el-table-column label="适用范围" min-width="120"><template #default="{ row }">{{ row.device_type_name || '全部资产' }}</template></el-table-column>
        <el-table-column label="分组" min-width="100"><template #default="{ row }">{{ row.group || '其它' }}</template></el-table-column>
        <el-table-column prop="field_type_label" label="类型" width="110" />
        <el-table-column label="必填" width="70"><template #default="{ row }"><el-tag size="small" :type="row.required ? 'warning' : 'info'">{{ row.required ? '是' : '否' }}</el-tag></template></el-table-column>
        <el-table-column label="选项" min-width="180"><template #default="{ row }"><template v-if="['select','multiselect'].includes(row.field_type)"><el-tag v-for="option in (row.options || [])" :key="option.id" size="small" class="field-option-tag">{{ option.label }}</el-tag><el-button link type="primary" :disabled="!c.can('custom_fields.manage') || c.customFieldOptionLoading" @click="c.openCustomFieldOptionModal(row)">管理选项</el-button></template><span v-else>—</span></template></el-table-column>
        <el-table-column prop="assets_count" label="引用资产" width="100" />
        <el-table-column label="状态" width="80"><template #default="{ row }"><StatusTag size="small" :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template></el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <TableIconButton
                :icon="Edit"
                label="编辑"
                type="primary"
                :disabled="!c.can('custom_fields.manage') || c.customFieldActionId === row.id || c.customFieldSaving"
                @click="openEditCustomField(row)"
              />
              <TableIconButton
                :icon="row.is_active ? CircleClose : CircleCheck"
                :label="row.is_active ? '停用' : '启用'"
                :disabled="!c.can('custom_fields.manage') || c.customFieldActionId === row.id"
                @click="c.toggleCustomField(row)"
              />
              <TableIconButton
                :icon="Delete"
                label="删除"
                type="danger"
                :disabled="!c.can('custom_fields.manage') || c.customFieldActionId === row.id || (row.assets_count || 0) > 0"
                @click="c.deleteCustomField(row)"
              />
            </div>
          </template>
        </el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell v-model="c.showCustomFieldModal" class="custom-field-dialog" :title="c.editingCustomField ? '编辑字段' : '新增字段'" description="配置字段定义、适用范围和显示规则" size="large" :saving="c.customFieldSaving" :show-close="!c.customFieldSaving" :close-disabled="c.customFieldSaving" :close-on-click-modal="!c.customFieldSaving" :close-on-press-escape="!c.customFieldSaving">
    <el-form ref="customFieldFormRef" class="horizontal-form custom-field-form" :model="c.customFieldForm" :rules="customFieldFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitCustomField">
      <section class="form-dialog__section custom-field-form-section custom-field-form-section--basic">
        <h3 class="form-dialog__section-title">字段定义</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="字段名称" prop="name" required :error="c.customFieldFormErrors.name"><el-input v-model="c.customFieldForm.name" maxlength="120" /></el-form-item>
          <el-form-item label="字段编码" prop="key" required :error="c.customFieldFormErrors.key">
            <el-input v-model="c.customFieldForm.key" :disabled="!!c.editingCustomField" placeholder="例如 operating_system" />
            <FieldHelp :text="customFieldKeyHelp" />
          </el-form-item>
          <el-form-item label="字段类型" prop="field_type" required :error="c.customFieldFormErrors.field_type">
            <el-select v-model="c.customFieldForm.field_type" :disabled="!!c.editingCustomField" @change="handleCustomFieldTypeChange"><el-option label="单行文本" value="text" /><el-option label="多行文本" value="textarea" /><el-option label="数字" value="number" /><el-option label="日期" value="date" /><el-option label="单选" value="select" /><el-option label="多选" value="multiselect" /><el-option label="是/否" value="boolean" /></el-select>
            <FieldHelp v-if="customFieldTypeHelp" :text="customFieldTypeHelp" />
          </el-form-item>
        </div>
      </section>

      <section class="form-dialog__section custom-field-form-section">
        <h3 class="form-dialog__section-title">适用范围</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="设备类型" prop="device_type" required :error="c.customFieldFormErrors.device_type">
            <el-select v-model="c.customFieldForm.device_type" :disabled="!!c.editingCustomField" clearable placeholder="全部资产">
              <el-option label="全部资产" value="" />
              <el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
            </el-select>
            <FieldHelp :text="customFieldScopeHelp" />
          </el-form-item>
          <el-form-item label="字段要求">
            <el-checkbox v-model="c.customFieldForm.required" @change="ensureFormVisible">必填</el-checkbox>
          </el-form-item>
        </div>
      </section>

        <section class="form-dialog__section custom-field-form-section">
          <h3 class="form-dialog__section-title">输入配置</h3>
          <div class="horizontal-form__rows">
            <el-form-item label="分组" prop="group" :error="c.customFieldFormErrors.group"><el-input v-model="c.customFieldForm.group" maxlength="80" placeholder="例如：硬件配置" /></el-form-item>
            <el-form-item label="显示顺序" prop="sort_order" :error="c.customFieldFormErrors.sort_order"><el-input-number v-model="customFieldSortOrderValue" :min="0" :step="1" :precision="0" :value-on-clear="null" aria-label="显示顺序" /></el-form-item>
            <el-form-item label="默认值" prop="default_value" :error="c.customFieldFormErrors.default_value">
              <el-input v-model="c.customFieldForm.default_value" maxlength="255" :disabled="customFieldDefaultValueDisabled" />
              <FieldHelp :text="customFieldDefaultHelp" />
            </el-form-item>
            <el-form-item label="输入提示" prop="placeholder" :error="c.customFieldFormErrors.placeholder">
              <el-input v-model="c.customFieldForm.placeholder" maxlength="255" placeholder="输入框提示文字" />
              <FieldHelp :text="customFieldPlaceholderHelp" />
            </el-form-item>
            <el-form-item label="帮助文字" prop="help_text" :error="c.customFieldFormErrors.help_text"><el-input v-model="c.customFieldForm.help_text" type="textarea" :rows="2" maxlength="1000" show-word-limit placeholder="向资产编辑人员解释字段含义" /></el-form-item>
          </div>
        </section>

        <section class="form-dialog__section custom-field-form-section">
          <h3 class="form-dialog__section-title">显示配置</h3>
          <div class="custom-field-visibility-row">
            <el-checkbox v-model="c.customFieldForm.is_active">启用</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.form_visible" :disabled="c.customFieldForm.required">表单显示</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.detail_visible">详情显示</el-checkbox>
            <div class="custom-field-visibility-option">
              <div class="custom-field-visibility-control">
                <el-checkbox v-model="c.customFieldForm.list_visible">台账可选列</el-checkbox>
              </div>
              <FieldHelp :text="listVisibleHelp" />
            </div>
            <div class="custom-field-visibility-option">
              <div class="custom-field-visibility-control">
                <el-checkbox v-model="c.customFieldForm.filterable">可筛选</el-checkbox>
              </div>
              <FieldHelp :text="filterableHelp" />
            </div>
          </div>
        </section>

        <section v-if="hasCustomFieldValidationRules" class="form-dialog__section custom-field-form-section">
          <h3 class="form-dialog__section-title">校验规则</h3>
          <div class="horizontal-form__rows">
          <el-form-item label="校验参数" prop="validation_config" :error="c.customFieldFormErrors.validation_config" class="custom-field-validation">
            <div v-if="['text', 'textarea'].includes(c.customFieldForm.field_type)" class="custom-field-validation-grid">
              <el-input-number v-model="minLengthValue" :min="0" :step="1" :precision="0" :value-on-clear="null" placeholder="最小长度" aria-label="最小长度" />
              <el-input-number v-model="maxLengthValue" :min="0" :step="1" :precision="0" :value-on-clear="null" placeholder="最大长度" aria-label="最大长度" />
            </div>
            <div v-else-if="c.customFieldForm.field_type === 'number'" class="custom-field-validation-grid">
              <el-input v-model="validationConfig.min" placeholder="最小值" />
              <el-input v-model="validationConfig.max" placeholder="最大值" />
              <el-input-number v-model="precisionValue" :min="0" :max="6" :step="1" :precision="0" :value-on-clear="null" placeholder="小数位" aria-label="小数位" />
            </div>
            <div v-else-if="c.customFieldForm.field_type === 'date'" class="custom-field-validation-grid">
              <el-date-picker v-model="validationConfig.min_date" type="date" value-format="YYYY-MM-DD" placeholder="最早日期" />
              <el-date-picker v-model="validationConfig.max_date" type="date" value-format="YYYY-MM-DD" placeholder="最晚日期" />
            </div>
            <div v-else class="custom-field-validation-grid">
              <el-input-number v-model="minItemsValue" :min="0" :step="1" :precision="0" :value-on-clear="null" placeholder="最少选择" aria-label="最少选择" />
              <el-input-number v-model="maxItemsValue" :min="0" :step="1" :precision="0" :value-on-clear="null" placeholder="最多选择" aria-label="最多选择" />
            </div>
          </el-form-item>
          </div>
        </section>
    </el-form>
    <template #footer><el-button :disabled="c.customFieldSaving" @click="c.showCustomFieldModal = false">取消</el-button><el-button type="primary" :loading="c.customFieldSaving" :disabled="c.customFieldSaving" @click="submitCustomField">保存字段</el-button></template>
  </FormDialogShell>

  <FormDialogShell v-model="c.showCustomFieldOptionModal" class="custom-field-option-dialog" :title="'管理字段选项' + (c.editingCustomField ? '：' + c.editingCustomField.name : '')" description="维护可选值、显示名称和排序" size="medium" :saving="c.customFieldOptionSaving" :show-close="!c.customFieldOptionSaving" :close-disabled="c.customFieldOptionSaving" :close-on-click-modal="!c.customFieldOptionSaving" :close-on-press-escape="!c.customFieldOptionSaving">
    <section class="form-dialog__section">
      <h3 class="form-dialog__section-title">已有选项</h3>
      <el-alert v-if="c.customFieldOptionError" title="字段选项加载失败" type="error" show-icon :closable="false">
        <template #default>
          <span>{{ c.customFieldOptionError }}</span>
          <el-button link type="danger" :loading="c.customFieldOptionLoading" @click="c.retryCustomFieldOptions">重新加载</el-button>
        </template>
      </el-alert>
      <el-table v-else v-loading="c.customFieldOptionLoading" :data="c.editingCustomField?.options || []" size="small">
        <template #empty><el-empty :image-size="48" description="暂无选项" /></template>
        <el-table-column prop="value" label="稳定值" /><el-table-column prop="label" label="显示名称" /><el-table-column prop="sort_order" label="顺序" width="70" /><el-table-column label="状态" width="80"><template #default="{ row }"><StatusTag size="small" :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template></el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <TableIconButton
                :icon="Edit"
                label="编辑"
                type="primary"
                :disabled="c.customFieldOptionActionId === row.id || c.customFieldOptionSaving"
                @click="c.openCustomFieldOptionModal(c.editingCustomField, row)"
              />
              <TableIconButton
                :icon="Delete"
                label="删除"
                type="danger"
                :disabled="c.customFieldOptionActionId === row.id || c.customFieldOptionSaving"
                @click="c.deleteCustomFieldOption(row)"
              />
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>
    <section class="form-dialog__section custom-field-option-form-section">
      <h3 class="form-dialog__section-title">选项信息</h3>
      <el-form ref="customFieldOptionFormRef" :model="c.customFieldOptionForm" :rules="customFieldOptionFormRules" label-position="right" class="horizontal-form horizontal-form__rows" :validate-on-rule-change="false" @submit.prevent="submitCustomFieldOption">
        <el-form-item label="稳定值" prop="value" required :error="c.customFieldOptionFormErrors.value"><el-input v-model="c.customFieldOptionForm.value" maxlength="120" /></el-form-item>
        <el-form-item label="显示名称" prop="label" required :error="c.customFieldOptionFormErrors.label"><el-input v-model="c.customFieldOptionForm.label" maxlength="120" /></el-form-item>
        <el-form-item label="顺序" prop="sort_order" :error="c.customFieldOptionFormErrors.sort_order"><el-input-number v-model="customFieldOptionSortOrderValue" :min="0" :step="1" :precision="0" :value-on-clear="null" aria-label="顺序" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="c.customFieldOptionForm.is_active" aria-label="状态">
            <el-option label="启用" :value="true" />
            <el-option label="停用" :value="false" />
          </el-select>
        </el-form-item>
      </el-form>
    </section>
    <template #footer><el-button :disabled="c.customFieldOptionSaving" @click="c.showCustomFieldOptionModal = false">取消</el-button><el-button type="primary" :loading="c.customFieldOptionSaving" :disabled="c.customFieldOptionSaving" @click="submitCustomFieldOption">保存选项</el-button></template>
  </FormDialogShell>
</template>
