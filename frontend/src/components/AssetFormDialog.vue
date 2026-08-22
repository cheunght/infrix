<!-- UX Reference: standard create/edit form. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { AssetFormContext } from "../types/page-context";
import type { CustomFieldSchema, Tag } from "../types";
import DynamicFieldRenderer from "./fields/DynamicFieldRenderer.vue";

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
  activeBrands,
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
  updateAssetCustomFieldValue,
  tags,
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
</script>

<template>
  <el-dialog
    v-model="showAssetModal"
    class="asset-form-dialog"
    :title="assetModalMode === 'edit' ? '编辑资产' : assetModalMode === 'clone' ? '克隆资产' : '新增资产'"
    width="min(820px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!assetFormSaving"
    :show-close="!assetFormSaving"
    destroy-on-close
    @closed="handleDialogClosed"
  >
    <div v-if="assetFormLoading" class="asset-form-loading">
      <el-skeleton :rows="10" animated />
    </div>

    <div v-else-if="assetFormLoadError" class="asset-form-load-error">
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
      label-position="top"
      @submit.prevent="submitAsset"
    >
      <el-divider content-position="left">基础信息</el-divider>
      <div class="asset-form-grid">
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
        <el-form-item label="品牌" :error="fieldError('brand')">
          <el-select v-model="assetForm.brand" placeholder="未关联品牌" clearable>
            <el-option v-for="item in activeBrands" :key="item.id" :label="item.name" :value="String(item.id)" />
          </el-select>
        </el-form-item>
        <el-form-item label="型号" :error="fieldError('model')"><el-input v-model="assetForm.model" placeholder="请输入型号" /></el-form-item>
        <el-form-item label="序列号" :error="fieldError('serial_number')"><el-input v-model="assetForm.serial_number" /></el-form-item>
        <el-form-item label="用途" :error="fieldError('purpose')"><el-input v-model="assetForm.purpose" /></el-form-item>
        <el-form-item label="状态" prop="status" required :error="fieldError('status')">
          <el-select v-model="assetForm.status">
            <el-option label="在库" value="in_stock" />
            <el-option label="在用" value="in_use" />
            <el-option label="闲置" value="idle" />
            <el-option label="维修中" value="repair" />
            <el-option label="已报废" value="retired" />
          </el-select>
        </el-form-item>
        <el-form-item label="使用人" :error="fieldError('owner_name')"><el-input v-model="assetForm.owner_name" /></el-form-item>
      </div>

      <el-divider v-if="tags.length" content-position="left">标签</el-divider>
      <el-form-item v-if="tags.length" label="标签" class="asset-form-full" :error="fieldError('tags')">
        <el-select v-model="assetForm.tags" multiple clearable filterable placeholder="请选择标签">
          <el-option v-for="tag in tags.filter((item: Tag) => item.is_active || assetForm.tags.includes(String(item.id)))" :key="tag.id" :label="tag.name" :value="String(tag.id)" />
        </el-select>
      </el-form-item>
      <el-divider v-if="assetCustomSchemaLoading || assetCustomSchemaError || dynamicFieldGroups.length" content-position="left">扩展字段</el-divider>
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
          <div class="asset-form-grid">
            <el-form-item
              v-for="field in group.fields"
              :key="field.id"
              :label="field.name"
              :prop="`custom_values.${field.key}`"
              :required="field.required"
              :error="fieldError(`custom_values.${field.key}`)"
              :class="field.field_type === 'textarea' ? 'asset-form-full' : ''"
            >
              <DynamicFieldRenderer
                :field="field"
                :model-value="assetForm.custom_values[field.key]"
                :disabled="assetFormSaving || assetCustomSchemaLoading"
                @update:model-value="updateAssetCustomFieldValue(field.key, $event)"
              />
              <div v-if="field.help_text" class="asset-custom-field-help">{{ field.help_text }}</div>
            </el-form-item>
          </div>
        </section>
      </div>

      <el-divider content-position="left">机柜位置（可选）</el-divider>
      <el-form-item label="上架到机柜" class="asset-form-full rack-mounted-toggle">
        <el-switch v-model="assetForm.rack_mounted" active-text="是" inactive-text="否" @change="setAssetRackMounted" />
        <span class="form-hint">不上架设备无需选择数据中心、机房、机柜和 U 位。</span>
      </el-form-item>
      <el-form-item v-if="!assetForm.rack_mounted" label="所属数据中心（未上架，可选）" class="asset-form-full" :error="fieldError('asset_data_center')">
        <el-select v-model="assetForm.asset_data_center" placeholder="未选择数据中心" clearable>
          <el-option v-for="center in activeDataCenters" :key="center.id" :label="center.name" :value="String(center.id)" />
        </el-select>
      </el-form-item>
      <div v-if="assetForm.rack_mounted" class="asset-form-grid">
        <el-form-item label="数据中心" :error="fieldError('data_center')">
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
        <el-form-item label="机柜总 U 数" :error="fieldError('rack_total_u')"><el-input v-model="assetForm.rack_total_u" disabled type="number" min="1" /></el-form-item>
        <el-form-item label="起始 U 位" prop="rack_start_u" :error="fieldError('rack_start_u')"><el-input v-model="assetForm.rack_start_u" type="number" min="1" /></el-form-item>
        <el-form-item label="结束 U 位" prop="rack_end_u" :error="fieldError('rack_end_u')"><el-input v-model="assetForm.rack_end_u" type="number" min="1" /></el-form-item>
      </div>

      <el-divider content-position="left">网络地址</el-divider>
      <div class="asset-form-grid">
        <el-form-item label="业务 IP" prop="business_ip" :error="fieldError('business_ip')"><el-input v-model="assetForm.business_ip" placeholder="如：10.0.0.10" /></el-form-item>
        <el-form-item label="管理 IP" prop="management_ip" :error="fieldError('management_ip')"><el-input v-model="assetForm.management_ip" placeholder="如：10.0.1.10" /></el-form-item>
        <el-form-item label="带外 IP" prop="oob_ip" :error="fieldError('oob_ip')"><el-input v-model="assetForm.oob_ip" placeholder="如：10.0.2.10" /></el-form-item>
      </div>

      <el-divider content-position="left">采购与维保</el-divider>
      <div class="asset-form-grid">
        <el-form-item label="采购日期" prop="purchase_date" :error="fieldError('purchase_date')"><el-date-picker v-model="assetForm.purchase_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="供应商" :error="fieldError('supplier')"><el-input v-model="assetForm.supplier" /></el-form-item>
        <el-form-item label="采购单号" :error="fieldError('purchase_order_no')"><el-input v-model="assetForm.purchase_order_no" /></el-form-item>
        <el-form-item label="采购金额" :error="fieldError('purchase_amount')"><el-input v-model="assetForm.purchase_amount" type="number" min="0" step="0.01" /></el-form-item>
        <el-form-item label="维保厂商" :error="fieldError('maintenance_provider')"><el-input v-model="assetForm.maintenance_provider" /></el-form-item>
        <el-form-item label="维保合同号" :error="fieldError('maintenance_contract_no')"><el-input v-model="assetForm.maintenance_contract_no" /></el-form-item>
        <el-form-item label="维保开始日" prop="maintenance_start_date" :error="fieldError('maintenance_start_date')"><el-date-picker v-model="assetForm.maintenance_start_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="维保到期日" prop="maintenance_expiry_date" :error="fieldError('maintenance_expiry_date')"><el-date-picker v-model="assetForm.maintenance_expiry_date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="备注" class="asset-form-full" :error="fieldError('notes')"><el-input v-model="assetForm.notes" type="textarea" :rows="2" /></el-form-item>
      </div>
    </el-form>

    <template #footer>
      <el-button :disabled="assetFormSaving" @click="closeDialog">取消</el-button>
      <el-button type="primary" :loading="assetFormSaving" :disabled="assetFormLoading || !!assetFormLoadError || assetCustomSchemaLoading || !!assetCustomSchemaError" @click="submitAsset">
        {{ assetModalMode === "clone" ? "创建克隆" : assetModalMode === "edit" ? "保存修改" : "保存资产" }}
      </el-button>
    </template>
  </el-dialog>
</template>
