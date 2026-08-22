<script setup lang="ts">
import { computed, proxyRefs, ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ArrowDown } from "@element-plus/icons-vue";
import type { CustomFieldContext } from "../types/page-context";
import type { CustomField, CustomFieldValidationConfig } from "../types";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{ context: CustomFieldContext }>();
const c = proxyRefs(props.context);
const customFieldFormRef = ref<FormInstance>();
const customFieldOptionFormRef = ref<FormInstance>();
const customFieldAdvancedExpanded = ref(false);
const validationConfig = computed(() => c.customFieldForm.validation_config as CustomFieldValidationConfig);
const customFieldValidationKeysByType: Record<string, string[]> = {
  text: ["min_length", "max_length"],
  textarea: ["min_length", "max_length"],
  number: ["min", "max", "precision"],
  date: ["min_date", "max_date"],
  multiselect: ["min_items", "max_items"],
  select: [],
  boolean: [],
};
const customFieldAdvancedErrorFields = new Set([
  "default_value",
  "sort_order",
  "group",
  "placeholder",
  "help_text",
  "form_visible",
  "detail_visible",
  "list_visible",
  "filterable",
  "validation_config",
  "is_active",
]);
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
  customFieldAdvancedExpanded.value = false;
}

function openEditCustomField(field: CustomField) {
  c.openCustomFieldModal(field);
  customFieldAdvancedExpanded.value = true;
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
  const valid = await customFieldFormRef.value?.validate().catch(() => {
    customFieldAdvancedExpanded.value = true;
    return false;
  });
  if (valid !== true) return;
  await c.saveCustomField();
  if (Object.keys(c.customFieldFormErrors).some((field) => customFieldAdvancedErrorFields.has(field))) {
    customFieldAdvancedExpanded.value = true;
  }
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
        <el-select class="itam-filter-select" v-model="c.customFieldDeviceType" placeholder="全部设备类型" clearable :disabled="c.customFieldListLoading" @change="c.loadCustomFields()">
          <el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
        </el-select>
        <el-select class="itam-filter-select" v-model="c.customFieldActive" placeholder="状态" :disabled="c.customFieldListLoading" @change="c.loadCustomFields()">
          <el-option label="全部状态" value="all" /><el-option label="启用" value="true" /><el-option label="停用" value="false" />
        </el-select>
        <template #actions>
          <el-button type="primary" :disabled="!c.can('custom_fields.manage') || c.customFieldSaving" @click="openCreateCustomField">新增字段</el-button>
        </template>
      </PageToolbar>
    </template>
    <PageContent surface>
      <div v-if="c.customFieldListError" class="settings-state settings-state--error" role="alert">
        <div class="settings-state__copy"><strong>自定义字段数据加载失败</strong><span>{{ c.customFieldListError }}</span></div>
        <el-button type="primary" plain :loading="c.customFieldListLoading" @click="c.retryCustomFieldList">重新加载</el-button>
      </div>
      <el-table v-else v-loading="c.customFieldListLoading" :data="c.customFields">
        <template #empty>
          <div class="settings-empty">
            <span>{{ c.customFieldDeviceType || (c.customFieldActive && c.customFieldActive !== 'all') ? '没有符合当前筛选条件的自定义字段' : '暂无自定义字段' }}</span>
            <el-button v-if="c.customFieldDeviceType || (c.customFieldActive && c.customFieldActive !== 'all')" link type="primary" @click="c.customFieldDeviceType = ''; c.customFieldActive = 'all'; c.loadCustomFields()">清除筛选</el-button>
          </div>
        </template>
        <el-table-column prop="name" label="字段名称" min-width="150" />
        <el-table-column prop="key" label="编码" min-width="150" />
        <el-table-column label="适用范围" min-width="120"><template #default="{ row }">{{ row.device_type_name || '全部资产' }}</template></el-table-column>
        <el-table-column label="分组" min-width="100"><template #default="{ row }">{{ row.group || '其它' }}</template></el-table-column>
        <el-table-column prop="field_type_label" label="类型" width="110" />
        <el-table-column label="必填" width="70"><template #default="{ row }"><el-tag size="small" :type="row.required ? 'warning' : 'info'">{{ row.required ? '是' : '否' }}</el-tag></template></el-table-column>
        <el-table-column label="选项" min-width="180"><template #default="{ row }"><template v-if="['select','multiselect'].includes(row.field_type)"><el-tag v-for="option in (row.options || [])" :key="option.id" size="small" class="field-option-tag">{{ option.label }}</el-tag><el-button link type="primary" :disabled="!c.can('custom_fields.manage') || c.customFieldOptionLoading" @click="c.openCustomFieldOptionModal(row)">管理选项</el-button></template><span v-else>—</span></template></el-table-column>
        <el-table-column prop="assets_count" label="引用资产" width="100" />
        <el-table-column label="状态" width="80"><template #default="{ row }"><StatusTag size="small" :type="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template></el-table-column>
        <el-table-column label="操作" width="220" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><el-button link type="primary" :disabled="!c.can('custom_fields.manage') || c.customFieldActionId === row.id || c.customFieldSaving" @click="openEditCustomField(row)">编辑</el-button><el-button link :disabled="!c.can('custom_fields.manage') || c.customFieldActionId === row.id" @click="c.toggleCustomField(row)">{{ row.is_active ? '停用' : '启用' }}</el-button><el-button link type="danger" :disabled="!c.can('custom_fields.manage') || c.customFieldActionId === row.id || (row.assets_count || 0) > 0" @click="c.deleteCustomField(row)">删除</el-button></div></template></el-table-column>
      </el-table>
    </PageContent>
  </PageContainer>

  <el-dialog v-model="c.showCustomFieldModal" class="custom-field-dialog" :title="c.editingCustomField ? '编辑自定义字段' : '新增自定义字段'" width="620px" destroy-on-close :show-close="!c.customFieldSaving" :close-on-click-modal="!c.customFieldSaving" :close-on-press-escape="!c.customFieldSaving">
    <el-form ref="customFieldFormRef" class="custom-field-form" :model="c.customFieldForm" :rules="customFieldFormRules" label-position="top" :validate-on-rule-change="false" @submit.prevent="submitCustomField">
      <section class="custom-field-form-section custom-field-form-section--basic">
        <div class="custom-field-section-title">基本信息</div>
        <div class="custom-field-basic-grid">
          <el-form-item label="字段名称" prop="name" required :error="c.customFieldFormErrors.name"><el-input v-model="c.customFieldForm.name" maxlength="120" /></el-form-item>
          <el-form-item label="字段编码" prop="key" required :error="c.customFieldFormErrors.key">
            <el-input v-model="c.customFieldForm.key" :disabled="!!c.editingCustomField" placeholder="例如 operating_system" />
            <div class="custom-field-form-help">用于系统识别和 API，创建后不可修改。</div>
          </el-form-item>
          <el-form-item label="适用范围" prop="device_type" required :error="c.customFieldFormErrors.device_type">
            <el-select v-model="c.customFieldForm.device_type" :disabled="!!c.editingCustomField" clearable placeholder="全部资产">
              <el-option label="全部资产" value="" />
              <el-option v-for="item in c.deviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
            </el-select>
            <div class="custom-field-form-help">{{ customFieldScopeHint }}</div>
            <div v-if="c.editingCustomField" class="custom-field-form-help">适用范围创建后不可修改。</div>
          </el-form-item>
          <el-form-item label="字段类型" prop="field_type" required :error="c.customFieldFormErrors.field_type">
            <el-select v-model="c.customFieldForm.field_type" :disabled="!!c.editingCustomField" @change="handleCustomFieldTypeChange"><el-option label="单行文本" value="text" /><el-option label="多行文本" value="textarea" /><el-option label="数字" value="number" /><el-option label="日期" value="date" /><el-option label="单选" value="select" /><el-option label="多选" value="multiselect" /><el-option label="是/否" value="boolean" /></el-select>
          </el-form-item>
        </div>
        <el-checkbox v-model="c.customFieldForm.required" class="custom-field-required" @change="ensureFormVisible">必填</el-checkbox>
      </section>

      <button type="button" class="custom-field-advanced-toggle" :aria-expanded="customFieldAdvancedExpanded" @click="customFieldAdvancedExpanded = !customFieldAdvancedExpanded">
        <span>更多配置</span>
        <el-icon :class="{ 'is-expanded': customFieldAdvancedExpanded }"><ArrowDown /></el-icon>
      </button>

      <div v-show="customFieldAdvancedExpanded" class="custom-field-advanced-config">
        <section class="custom-field-form-section">
          <div class="custom-field-section-title">输入配置</div>
          <div class="custom-field-advanced-grid">
            <el-form-item label="分组" prop="group" :error="c.customFieldFormErrors.group"><el-input v-model="c.customFieldForm.group" maxlength="80" placeholder="例如：硬件配置" /></el-form-item>
            <el-form-item label="显示顺序" prop="sort_order" :error="c.customFieldFormErrors.sort_order"><el-input-number v-model="c.customFieldForm.sort_order" class="custom-field-sort-order" :min="0" :step="1" /></el-form-item>
            <el-form-item label="默认值" prop="default_value" :error="c.customFieldFormErrors.default_value">
              <el-input v-model="c.customFieldForm.default_value" maxlength="255" :disabled="customFieldDefaultValueDisabled" />
              <div class="custom-field-form-help">{{ customFieldDefaultValueDisabled ? "请先保存字段并配置选项。" : "新建资产时自动带入的初始值。" }}</div>
            </el-form-item>
            <el-form-item label="输入提示" prop="placeholder" :error="c.customFieldFormErrors.placeholder">
              <el-input v-model="c.customFieldForm.placeholder" maxlength="255" placeholder="输入框提示文字" />
              <div class="custom-field-form-help">显示在资产编辑输入框中的提示文字。</div>
            </el-form-item>
            <el-form-item label="帮助文字" prop="help_text" :error="c.customFieldFormErrors.help_text" class="custom-field-form-full"><el-input v-model="c.customFieldForm.help_text" type="textarea" :rows="2" maxlength="1000" show-word-limit placeholder="向资产编辑人员解释字段含义" /></el-form-item>
          </div>
          <div v-if="isCustomFieldOptionType" class="custom-field-form-help custom-field-option-hint">保存字段后可配置选项。</div>
        </section>

        <section class="custom-field-form-section">
          <div class="custom-field-section-title">显示配置</div>
          <div class="custom-field-visibility-row">
            <el-checkbox v-model="c.customFieldForm.is_active">启用</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.form_visible" :disabled="c.customFieldForm.required">表单显示</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.detail_visible">详情显示</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.list_visible">台账可选列</el-checkbox>
            <el-checkbox v-model="c.customFieldForm.filterable">可筛选</el-checkbox>
          </div>
          <div class="custom-field-form-help">允许用户在资产台账的“显示列”中选择该字段。</div>
          <div class="custom-field-form-help">允许用户在资产台账“更多筛选”中使用该字段。</div>
        </section>

        <section v-if="hasCustomFieldValidationRules" class="custom-field-form-section">
          <div class="custom-field-section-title">校验规则</div>
          <el-form-item prop="validation_config" :error="c.customFieldFormErrors.validation_config" class="custom-field-validation">
            <div v-if="['text', 'textarea'].includes(c.customFieldForm.field_type)" class="custom-field-validation-grid">
              <el-input-number v-model="validationConfig.min_length" :min="0" :step="1" controls-position="right" placeholder="最小长度" />
              <el-input-number v-model="validationConfig.max_length" :min="0" :step="1" controls-position="right" placeholder="最大长度" />
            </div>
            <div v-else-if="c.customFieldForm.field_type === 'number'" class="custom-field-validation-grid">
              <el-input v-model="validationConfig.min" placeholder="最小值" />
              <el-input v-model="validationConfig.max" placeholder="最大值" />
              <el-input-number v-model="validationConfig.precision" :min="0" :max="6" :step="1" controls-position="right" placeholder="小数位" />
            </div>
            <div v-else-if="c.customFieldForm.field_type === 'date'" class="custom-field-validation-grid">
              <el-date-picker v-model="validationConfig.min_date" type="date" value-format="YYYY-MM-DD" placeholder="最早日期" />
              <el-date-picker v-model="validationConfig.max_date" type="date" value-format="YYYY-MM-DD" placeholder="最晚日期" />
            </div>
            <div v-else class="custom-field-validation-grid">
              <el-input-number v-model="validationConfig.min_items" :min="0" :step="1" controls-position="right" placeholder="最少选择" />
              <el-input-number v-model="validationConfig.max_items" :min="0" :step="1" controls-position="right" placeholder="最多选择" />
            </div>
          </el-form-item>
        </section>
      </div>
    </el-form>
    <template #footer><el-button :disabled="c.customFieldSaving" @click="c.showCustomFieldModal = false">取消</el-button><el-button type="primary" :loading="c.customFieldSaving" :disabled="c.customFieldSaving" @click="submitCustomField">{{ c.editingCustomField ? '保存' : '创建' }}</el-button></template>
  </el-dialog>

  <el-dialog v-model="c.showCustomFieldOptionModal" :title="'管理字段选项' + (c.editingCustomField ? '：' + c.editingCustomField.name : '')" width="680px" destroy-on-close :show-close="!c.customFieldOptionSaving" :close-on-click-modal="!c.customFieldOptionSaving" :close-on-press-escape="!c.customFieldOptionSaving">
    <div v-if="c.customFieldOptionError" class="settings-state settings-state--error" role="alert">
      <div class="settings-state__copy"><strong>字段选项加载失败</strong><span>{{ c.customFieldOptionError }}</span></div>
      <el-button type="primary" plain :loading="c.customFieldOptionLoading" @click="c.retryCustomFieldOptions">重新加载</el-button>
    </div>
    <el-table v-else v-loading="c.customFieldOptionLoading" :data="c.editingCustomField?.options || []" size="small">
      <template #empty><div class="settings-empty"><span>暂无选项</span></div></template>
      <el-table-column prop="value" label="稳定值" /><el-table-column prop="label" label="显示名称" /><el-table-column prop="sort_order" label="顺序" width="70" /><el-table-column label="状态" width="80"><template #default="{ row }"><StatusTag size="small" :type="row.is_active ? 'success' : 'info'" :label="row.is_active ? '启用' : '停用'" /></template></el-table-column><el-table-column label="操作" width="160"><template #default="{ row }"><el-button link type="primary" :disabled="c.customFieldOptionActionId === row.id || c.customFieldOptionSaving" @click="c.openCustomFieldOptionModal(c.editingCustomField, row)">编辑</el-button><el-button link type="danger" :disabled="c.customFieldOptionActionId === row.id || c.customFieldOptionSaving" @click="c.deleteCustomFieldOption(row)">删除</el-button></template></el-table-column>
    </el-table>
    <el-divider />
    <el-form ref="customFieldOptionFormRef" :model="c.customFieldOptionForm" :rules="customFieldOptionFormRules" label-position="top" class="form-grid" :validate-on-rule-change="false" @submit.prevent="submitCustomFieldOption">
      <el-form-item label="稳定值" prop="value" required :error="c.customFieldOptionFormErrors.value"><el-input v-model="c.customFieldOptionForm.value" maxlength="120" /></el-form-item>
      <el-form-item label="显示名称" prop="label" required :error="c.customFieldOptionFormErrors.label"><el-input v-model="c.customFieldOptionForm.label" maxlength="120" /></el-form-item>
      <el-form-item label="顺序" prop="sort_order" :error="c.customFieldOptionFormErrors.sort_order"><el-input-number v-model="c.customFieldOptionForm.sort_order" :min="0" :step="1" /></el-form-item>
      <el-checkbox v-model="c.customFieldOptionForm.is_active">启用</el-checkbox>
    </el-form>
    <template #footer><el-button :disabled="c.customFieldOptionSaving" @click="c.showCustomFieldOptionModal = false">关闭</el-button><el-button type="primary" :loading="c.customFieldOptionSaving" :disabled="c.customFieldOptionSaving" @click="submitCustomFieldOption">保存选项</el-button></template>
  </el-dialog>
</template>
