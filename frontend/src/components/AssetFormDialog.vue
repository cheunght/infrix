<!-- UX Reference: standard create/edit form. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import type { AssetFormContext } from "../types/page-context";
import type { CustomFieldOption, Tag } from "../types";

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
  tags,
  saveAsset,
} = context;

const formRef = ref<FormInstance>();

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

  for (const field of assetCustomFieldSchema.value) {
    if (!field.required) continue;
    rules[`custom_values.${field.key}`] = [{
      validator: (_rule: unknown, value: unknown, callback: (error?: Error) => void) => {
        const empty = value === null || value === undefined || value === "" ||
          (Array.isArray(value) && value.length === 0);
        callback(empty ? new Error(`请输入${field.name}`) : undefined);
      },
      trigger: "submit",
    }];
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
  if (assetFormLoading.value || assetFormLoadError.value || assetFormSaving.value || !formRef.value) return;
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

      <el-divider v-if="assetCustomFieldSchema.length || tags.length" content-position="left">标签与自定义字段</el-divider>
      <el-form-item v-if="tags.length" label="标签" class="asset-form-full" :error="fieldError('tags')">
        <el-select v-model="assetForm.tags" multiple clearable filterable placeholder="请选择标签">
          <el-option v-for="tag in tags.filter((item: Tag) => item.is_active || assetForm.tags.includes(String(item.id)))" :key="tag.id" :label="tag.name" :value="String(tag.id)" />
        </el-select>
      </el-form-item>
      <div v-if="assetCustomFieldSchema.length" class="asset-form-grid">
        <el-form-item
          v-for="field in assetCustomFieldSchema"
          :key="field.id"
          :label="field.name"
          :prop="`custom_values.${field.key}`"
          :required="field.required"
          :error="fieldError(`custom_values.${field.key}`)"
          :class="field.field_type === 'textarea' ? 'asset-form-full' : ''"
        >
          <el-input v-if="field.field_type === 'text'" v-model="assetForm.custom_values[field.key]" :placeholder="field.default_value || ''" />
          <el-input v-else-if="field.field_type === 'textarea'" v-model="assetForm.custom_values[field.key]" type="textarea" :rows="3" :placeholder="field.default_value || ''" />
          <el-input-number v-else-if="field.field_type === 'number'" v-model="assetForm.custom_values[field.key] as number" :placeholder="field.default_value || ''" />
          <el-date-picker v-else-if="field.field_type === 'date'" v-model="assetForm.custom_values[field.key] as string" type="date" value-format="YYYY-MM-DD" :placeholder="field.default_value || '请选择日期'" />
          <el-select v-else-if="field.field_type === 'select'" v-model="assetForm.custom_values[field.key]" clearable :placeholder="field.default_value || '请选择'">
            <el-option v-for="option in (field.options || []).filter((item: CustomFieldOption) => item.is_active)" :key="option.id" :label="option.label" :value="option.value" />
          </el-select>
          <el-select v-else-if="field.field_type === 'multiselect'" v-model="assetForm.custom_values[field.key]" multiple clearable :placeholder="field.default_value || '请选择'">
            <el-option v-for="option in (field.options || []).filter((item: CustomFieldOption) => item.is_active)" :key="option.id" :label="option.label" :value="option.value" />
          </el-select>
          <el-switch v-else-if="field.field_type === 'boolean'" v-model="assetForm.custom_values[field.key] as boolean" />
        </el-form-item>
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
      <el-button type="primary" :loading="assetFormSaving" :disabled="assetFormLoading || !!assetFormLoadError" @click="submitAsset">
        {{ assetModalMode === "clone" ? "创建克隆" : assetModalMode === "edit" ? "保存修改" : "保存资产" }}
      </el-button>
    </template>
  </el-dialog>
</template>
