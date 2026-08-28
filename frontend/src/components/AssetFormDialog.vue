<!-- UX Reference: standard create/edit form. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { AssetFormContext } from "../types/page-context";
import type { CustomFieldSchema, Tag } from "../types";
import { isPositiveDecimalString, percentageToRate } from "../depreciation";
import DynamicFieldRenderer from "./fields/DynamicFieldRenderer.vue";
import FieldHelp from "./FieldHelp.vue";
import FormDialogShell from "./FormDialogShell.vue";
import MoneyInput from "./MoneyInput.vue";
import { ASSET_STATUS_OPTIONS } from "../business-enums";

const props = defineProps<{ context: AssetFormContext }>();
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
    const groupName = field.group?.trim() || "其它";
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

const rackPlacementHelp = "不上架设备无需选择数据中心、机房、机柜和 U 位。";
const depreciationHelp = "折旧方法：直线法";
const residualRateHelp = "填写 0～100，例如 5 表示 5%。";

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
  message: `请输入${label}`,
  trigger: "submit",
});

const ipRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!value) return callback();
    const input = String(value).trim();
    const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}$/;
    const ipv6 = /^[0-9a-f:]+$/i;
    if (ipv4.test(input) || (input.includes(":") && ipv6.test(input))) return callback();
    callback(new Error("请输入有效的 IP 地址"));
  },
  trigger: "submit",
};

const dateRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return callback();
    callback(new Error("日期格式应为 YYYY-MM-DD"));
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
      return callback(new Error("请选择完整的机柜位置"));
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return callback(new Error("请输入有效的起止 U 位"));
    }
    if (total > 0 && end > total) return callback(new Error(`结束 U 位不能超过 ${total}U`));
    callback();
  },
  trigger: "submit",
};

const depreciationPurchaseAmountRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (!isPositiveDecimalString(value)) return callback(new Error("请先填写有效的采购金额后再配置折旧"));
    callback();
  },
  trigger: "submit",
};

const depreciationStartDateRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (!value) return callback(new Error("请输入折旧起算日"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return callback(new Error("折旧起算日格式应为 YYYY-MM-DD"));
    callback();
  },
  trigger: "submit",
};

const depreciationYearsRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (!Number.isInteger(value) || Number(value) < 1) return callback(new Error("折旧年限必须是大于等于 1 的整数"));
    callback();
  },
  trigger: "submit",
};

const residualRateRule = {
  validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
    if (!assetForm.value.depreciation_enabled) return callback();
    if (String(value ?? "").trim() === "") return callback(new Error("请输入残值率"));
    if (percentageToRate(value) === null) return callback(new Error("残值率必须填写 0～100 之间的百分数，最多 2 位小数"));
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
      if (empty) return callback(field.required ? new Error(`请输入${field.name}`) : undefined);

      const config = field.validation_config || {};
      if (field.field_type === "text" || field.field_type === "textarea") {
        const length = String(value).length;
        if (config.min_length != null && length < config.min_length) {
          return callback(new Error(`${field.name}至少需要 ${config.min_length} 个字符`));
        }
        if (config.max_length != null && length > config.max_length) {
          return callback(new Error(`${field.name}不能超过 ${config.max_length} 个字符`));
        }
      }

      if (field.field_type === "number") {
        const number = Number(value);
        if (!Number.isFinite(number)) return callback(new Error(`${field.name}必须是有效数字`));
        const min = finiteConfigNumber(config.min);
        const max = finiteConfigNumber(config.max);
        if (min !== undefined && number < min) return callback(new Error(`${field.name}不能小于 ${min}`));
        if (max !== undefined && number > max) return callback(new Error(`${field.name}不能大于 ${max}`));
        const precision = finiteConfigNumber(config.precision);
        if (precision !== undefined && Number.isInteger(precision) && precision >= 0) {
          const factor = 10 ** precision;
          if (Number.isFinite(factor) && Math.abs(number * factor - Math.round(number * factor)) > 1e-8) {
            return callback(new Error(`${field.name}最多保留 ${precision} 位小数`));
          }
        }
      }

      if (field.field_type === "date") {
        const date = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return callback(new Error(`${field.name}日期格式应为 YYYY-MM-DD`));
        if (config.min_date && date < config.min_date) return callback(new Error(`${field.name}不能早于 ${config.min_date}`));
        if (config.max_date && date > config.max_date) return callback(new Error(`${field.name}不能晚于 ${config.max_date}`));
      }

      if (field.field_type === "multiselect") {
        if (!Array.isArray(value)) return callback(new Error(`${field.name}必须是选项数组`));
        if (config.min_items != null && value.length < config.min_items) {
          return callback(new Error(`${field.name}至少选择 ${config.min_items} 项`));
        }
        if (config.max_items != null && value.length > config.max_items) {
          return callback(new Error(`${field.name}最多选择 ${config.max_items} 项`));
        }
      }

      if (field.field_type === "select" || field.field_type === "multiselect") {
        const activeValues = new Set((field.options || []).filter((option) => option.is_active).map((option) => option.value));
        const submittedValues = field.field_type === "select" ? [value] : (Array.isArray(value) ? value : []);
        if (submittedValues.some((item) => typeof item !== "string" || !activeValues.has(item))) {
          return callback(new Error(`${field.name}包含无效或已停用选项`));
        }
      }

      callback();
    },
    trigger: "submit",
  };
}

const assetRules = computed<FormRules>(() => {
  const rules: FormRules = {
    asset_no: [requiredRule("资产编号")],
    name: [requiredRule("资产名称")],
    device_type: [requiredRule("设备类型")],
    status: [requiredRule("资产状态")],
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
    :title="assetModalMode === 'edit' ? '编辑资产' : assetModalMode === 'clone' ? '克隆资产' : '新增资产'"
    description="填写资产基础资料和业务配置"
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
      <el-alert title="资产信息加载失败" :description="assetFormLoadError" type="error" :closable="false" show-icon />
      <el-button type="primary" plain @click="retryAssetFormLoad">重新加载</el-button>
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
        <h3 class="form-dialog__section-title">基本信息</h3>
        <div class="horizontal-form__rows">
        <el-form-item label="资产编号" prop="asset_no" required :error="fieldError('asset_no')">
          <el-input v-model="assetForm.asset_no" :disabled="!!editingAsset" autocomplete="off" />
        </el-form-item>
        <el-form-item label="资产名称" prop="name" required :error="fieldError('name')">
          <el-input v-model="assetForm.name" />
        </el-form-item>
        <el-form-item label="设备类型" prop="device_type" required :error="fieldError('device_type')">
          <el-select v-model="assetForm.device_type" placeholder="未关联设备类型" clearable @change="syncAssetDeviceType">
            <el-option v-for="item in activeDeviceTypes" :key="item.id" :label="item.name" :value="String(item.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="厂商" :error="fieldError('manufacturer_id')">
          <el-select v-model="assetForm.manufacturer_id" placeholder="未关联厂商" clearable>
            <el-option v-for="item in manufacturerOptions" :key="item.id" :label="item.name" :value="String(item.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status" required :error="fieldError('status')">
          <el-select v-model="assetForm.status">
            <el-option v-for="option in ASSET_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="型号" :error="fieldError('model')"><el-input v-model="assetForm.model" placeholder="请输入型号" /></el-form-item>
        <el-form-item label="序列号" :error="fieldError('serial_number')"><el-input v-model="assetForm.serial_number" /></el-form-item>
        <el-form-item label="用途" :error="fieldError('purpose')"><el-input v-model="assetForm.purpose" /></el-form-item>
        <el-form-item label="使用人" :error="fieldError('owner_name')"><el-input v-model="assetForm.owner_name" /></el-form-item>
        </div>
      </section>

      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">位置与网络</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="上架到机柜">
            <el-select v-model="rackMountedSelectValue" placeholder="请选择上架状态">
              <el-option label="不上架" value="unmounted" />
              <el-option label="上架" value="mounted" />
            </el-select>
            <FieldHelp :text="rackPlacementHelp" />
          </el-form-item>
          <el-form-item v-if="!assetForm.rack_mounted" label="所属数据中心" :error="fieldError('asset_data_center')">
            <el-select v-model="assetForm.asset_data_center" placeholder="未选择数据中心" clearable>
              <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
            </el-select>
          </el-form-item>
        </div>
        <div v-if="assetForm.rack_mounted" class="horizontal-form__rows">
        <el-form-item label="所属数据中心" :error="fieldError('data_center')">
          <el-select v-model="assetForm.data_center" placeholder="未选择数据中心" clearable @change="changeAssetDataCenter">
            <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="机房" :error="fieldError('server_room_id')">
          <el-select v-model="assetForm.server_room_id" placeholder="请选择已有机房" clearable @change="changeAssetRoom">
            <el-option v-for="room in assetRoomOptions" :key="room.id" :label="room.name" :value="String(room.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="机柜编号" prop="rack_id" :error="fieldError('rack_id')">
          <el-select v-model="assetForm.rack_id" placeholder="请选择已有机柜" clearable @change="changeAssetRack">
            <el-option v-for="rack in assetRackOptions" :key="rack.id" :label="rack.code" :value="String(rack.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="机柜总 U 数" :error="fieldError('rack_total_u')"><el-input v-model="assetForm.rack_total_u" disabled /></el-form-item>
        <el-form-item label="起始 U 位" prop="rack_start_u" :error="fieldError('rack_start_u')">
          <el-input-number v-model="rackStartUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" aria-label="起始 U 位">
            <template #suffix>U</template>
          </el-input-number>
        </el-form-item>
        <el-form-item label="结束 U 位" prop="rack_end_u" :error="fieldError('rack_end_u')">
          <el-input-number v-model="rackEndUValue" :min="1" :step="1" :precision="0" :value-on-clear="null" aria-label="结束 U 位">
            <template #suffix>U</template>
          </el-input-number>
        </el-form-item>
        </div>
        <div class="form-dialog__subsection-title">网络地址</div>
        <div class="horizontal-form__rows">
          <el-form-item label="业务 IP" prop="business_ip" :error="fieldError('business_ip')"><el-input v-model="assetForm.business_ip" placeholder="如：10.0.0.10" /></el-form-item>
          <el-form-item label="管理 IP" prop="management_ip" :error="fieldError('management_ip')"><el-input v-model="assetForm.management_ip" placeholder="如：10.0.1.10" /></el-form-item>
          <el-form-item label="带外 IP" prop="oob_ip" :error="fieldError('oob_ip')"><el-input v-model="assetForm.oob_ip" placeholder="如：10.0.2.10" /></el-form-item>
        </div>
      </section>

      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">采购、维保与折旧</h3>
        <div class="horizontal-form__rows">
        <el-form-item label="采购日期" prop="purchase_date" :error="fieldError('purchase_date')"><el-date-picker v-model="assetForm.purchase_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="供应商" :error="fieldError('supplier')"><el-input v-model="assetForm.supplier" /></el-form-item>
        <el-form-item label="采购单号" :error="fieldError('purchase_order_no')"><el-input v-model="assetForm.purchase_order_no" /></el-form-item>
        <el-form-item label="采购金额" prop="purchase_amount" :error="fieldError('purchase_amount')">
          <MoneyInput v-model="purchaseAmountValue" currency="CNY" placeholder="请输入采购金额" />
        </el-form-item>
        <el-form-item label="维保厂商" :error="fieldError('maintenance_provider')"><el-input v-model="assetForm.maintenance_provider" /></el-form-item>
        <el-form-item label="维保合同号" :error="fieldError('maintenance_contract_no')"><el-input v-model="assetForm.maintenance_contract_no" /></el-form-item>
        <el-form-item label="维保开始日" prop="maintenance_start_date" :error="fieldError('maintenance_start_date')"><el-date-picker v-model="assetForm.maintenance_start_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="维保到期日" prop="maintenance_expiry_date" :error="fieldError('maintenance_expiry_date')"><el-date-picker v-model="assetForm.maintenance_expiry_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="备注" :error="fieldError('notes')"><el-input v-model="assetForm.notes" type="textarea" :rows="2" /></el-form-item>
        </div>
        <div class="form-dialog__subsection">
          <div class="form-dialog__subsection-title">折旧配置</div>
          <div class="horizontal-form__rows">
            <el-form-item label="启用折旧" :error="fieldError('configuration')">
              <el-select v-model="depreciationSelectValue" placeholder="请选择折旧配置">
                <el-option label="不配置" value="disabled" />
                <el-option label="启用" value="enabled" />
              </el-select>
              <FieldHelp :text="depreciationHelp" />
            </el-form-item>
          </div>
          <div v-if="assetForm.depreciation_enabled" class="horizontal-form__rows">
            <el-form-item label="折旧起算日" prop="depreciation_start_date" :error="fieldError('depreciation_start_date')">
              <el-date-picker v-model="assetForm.depreciation_start_date" type="date" value-format="YYYY-MM-DD" @change="markDepreciationStartTouched" />
            </el-form-item>
            <el-form-item label="折旧年限" prop="depreciation_years" :error="fieldError('depreciation_years')">
              <el-input-number v-model="assetForm.depreciation_years" :min="1" :step="1" :precision="0" :value-on-clear="null" placeholder="请输入年限" aria-label="折旧年限">
                <template #suffix>年</template>
              </el-input-number>
            </el-form-item>
            <el-form-item label="残值率" prop="residual_rate" :error="fieldError('residual_rate')">
              <el-input-number v-model="residualRateValue" :min="0" :max="100" :step="0.01" :precision="2" :value-on-clear="null" placeholder="例如 5" aria-label="残值率">
                <template #suffix>%</template>
              </el-input-number>
              <FieldHelp :text="residualRateHelp" />
            </el-form-item>
          </div>
        </div>
      </section>

      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">扩展信息</h3>
        <div class="horizontal-form__rows">
          <el-form-item label="资产标签" :error="fieldError('tags')">
            <el-select v-model="assetForm.tags" multiple clearable filterable :loading="tagListLoading" :disabled="tagListLoading" placeholder="请选择标签">
              <el-option
                v-for="tag in selectableTags"
                :key="tag.id"
                :label="tag.is_active ? tag.name : `${tag.name}（已停用）`"
                :value="String(tag.id)"
              />
            </el-select>
            <div v-if="tagListError" class="asset-form-tag-state asset-form-tag-state--error">
              <span>{{ tagListError }}</span>
              <el-button link type="primary" :disabled="tagListLoading" @click="retryTagList">重试</el-button>
            </div>
            <div v-else-if="!tagListLoading && !selectableTags.length" class="asset-form-tag-state">暂无可用标签，请先在标签管理中维护。</div>
          </el-form-item>
        </div>
        <div v-if="assetCustomSchemaLoading || assetCustomSchemaError || dynamicFieldGroups.length" class="form-dialog__subsection">
          <div class="form-dialog__subsection-title">动态字段</div>
          <div v-if="assetCustomSchemaLoading" class="asset-custom-schema-state">
            <el-skeleton :rows="4" animated />
          </div>
          <div v-else-if="assetCustomSchemaError" class="asset-custom-schema-state">
            <el-alert title="扩展字段加载失败" :description="assetCustomSchemaError" type="error" :closable="false" show-icon />
            <el-button type="primary" plain :disabled="assetFormSaving" @click="retryAssetCustomSchema">重试</el-button>
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
      <el-button :disabled="assetFormSaving" @click="closeDialog">取消</el-button>
      <el-button type="primary" :loading="assetFormSaving" :disabled="assetFormLoading || !!assetFormLoadError || assetCustomSchemaLoading || !!assetCustomSchemaError" @click="submitAsset">
        保存资产
      </el-button>
    </template>
  </FormDialogShell>
</template>
