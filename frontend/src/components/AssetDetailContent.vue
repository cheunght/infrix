<script setup lang="ts">
import { computed, toRefs } from "vue";
import type { AssetDetail, InventoryItem } from "../types";
import { statusLabel, statusTone } from "../status";
import {
  businessOptionLabel,
  businessOptionTone,
  INVENTORY_ITEM_STATUS_OPTIONS,
  INVENTORY_RESOLUTION_STATUS_OPTIONS,
} from "../business-enums";
import {
  depreciationMethodLabel,
  depreciationStatusLabel,
  formatMoneyDecimalString,
  formatResidualRate,
} from "../depreciation";
import StatusTag, { type StatusTagType } from "./StatusTag.vue";
import DynamicFieldDisplay from "./fields/DynamicFieldDisplay.vue";
import DetailSection from "./DetailSection.vue";
import DescriptionList from "./DescriptionList.vue";

const props = withDefaults(defineProps<{
  asset: AssetDetail | null;
  loading: boolean;
  error: string;
  showSummary?: boolean;
  descriptionColumns?: 1 | 2;
  retry?: () => void | Promise<void>;
}>(), {
  descriptionColumns: 2,
});

const { asset, loading, error, showSummary, descriptionColumns } = toRefs(props);

type DetailField = {
  key: string;
  label: string;
  raw: unknown;
  value: string;
  wide?: boolean;
  className?: string;
  title?: string;
};

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function displayValue(value: unknown): string {
  if (!hasContent(value)) return "—";
  if (Array.isArray(value)) return value.map((item) => displayValue(item)).join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function makeField(
  key: string,
  label: string,
  raw: unknown,
  formatter: (value: unknown) => string = displayValue,
): DetailField {
  return {
    key,
    label,
    raw,
    value: hasContent(raw) ? formatter(raw) : "—",
  };
}

function fieldsWithContent(fields: DetailField[]): DetailField[] {
  return fields.filter((field) => hasContent(field.raw));
}

function formatDate(value: unknown): string {
  if (!hasContent(value)) return "—";
  const text = String(value);
  return text.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || text;
}

function formatDateTime(value: unknown): string {
  if (!hasContent(value)) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function inventoryStatusType(status: string): StatusTagType {
  return businessOptionTone(INVENTORY_ITEM_STATUS_OPTIONS, status, "info");
}

function inventoryRecordLabel(record: InventoryItem): string {
  const statusLabel = record.status_label || businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, record.status);
  const resolution = record.resolution_status === "not_required"
    ? ""
    : businessOptionLabel(INVENTORY_RESOLUTION_STATUS_OPTIONS, record.resolution_status);
  return [statusLabel, resolution].filter(Boolean).join(" · ");
}

function networkValue(role: string): string {
  const current = asset.value;
  if (!current) return "";
  const compact = role === "business"
    ? current.business_ip
    : role === "management"
      ? current.management_ip
      : current.oob_ip;
  return compact || current.network_addresses?.find((item) => item.role === role)?.address || "";
}

function roleLabel(role: string): string {
  return ({ business: "业务 IP", management: "管理 IP", oob: "带外 IP" } as Record<string, string>)[role] || role;
}

const basicFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  return [
    makeField("device-type", "设备类型", current.device_type_name),
    makeField("manufacturer", "厂商", current.manufacturer_name),
    makeField("model", "型号", current.model_name || current.model || current.manufacturer_model),
    makeField("serial-number", "序列号", current.serial_number),
    makeField("purpose", "用途", current.purpose),
    makeField("owner", "使用人", current.owner_name),
  ];
});

const locationFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const rack = current.rack_allocation;
  const dataCenter = rack?.data_center || current.asset_data_center_name || current.data_center;

  if (!rack) {
    return [
      makeField("placement-status", "位置状态", "未上架"),
      ...(hasContent(dataCenter) ? [makeField("data-center", "数据中心", dataCenter)] : []),
    ];
  }

  const uRange = rack.start_u != null && rack.end_u != null
    ? `U${rack.start_u}–U${rack.end_u} (${rack.units}U)`
    : null;
  return [
    makeField("data-center", "数据中心", dataCenter),
    makeField("server-room", "机房", rack.server_room),
    makeField("rack", "机柜", rack.rack_code),
    makeField("u-position", "U 位", uRange),
  ];
});

const networkFields = computed<DetailField[]>(() => [
  "business",
  "management",
  "oob",
].map((role) => ({
  ...makeField(role, roleLabel(role), networkValue(role)),
  className: "asset-detail-technical",
})));

const procurementFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const procurement = current.procurement_records?.[0];
  const maintenance = current.maintenance_contracts?.[0];
  return [
    makeField("purchase-date", "采购日期", procurement?.purchase_date || current.purchase_date, formatDate),
    makeField("supplier", "供应商", procurement?.supplier || current.supplier),
    makeField("purchase-order", "采购单号", procurement?.order_no || current.purchase_order_no),
    makeField("purchase-amount", "采购金额", procurement?.amount, formatMoneyDecimalString),
    makeField("maintenance-provider", "维保厂商", maintenance?.provider || current.maintenance_provider),
    makeField("maintenance-contract", "维保合同", maintenance?.contract_no),
    makeField("maintenance-start", "维保开始日", maintenance?.start_date, formatDate),
    makeField("maintenance-expiry", "维保到期", maintenance?.expiry_date || current.maintenance_expiry_date, formatDate),
  ];
});

const visibleBasicFields = computed(() => fieldsWithContent(basicFields.value));
const visibleLocationFields = computed(() => fieldsWithContent(locationFields.value));
const visibleNetworkFields = computed(() => fieldsWithContent(networkFields.value));
const visibleProcurementFields = computed(() => fieldsWithContent(procurementFields.value));
const hasBasicFields = computed(() => visibleBasicFields.value.length > 0);
const hasLocationFields = computed(() => visibleLocationFields.value.length > 0);
const hasNetworkFields = computed(() => visibleNetworkFields.value.length > 0);
const hasNotes = computed(() => hasContent(asset.value?.notes));

const depreciation = computed(() => asset.value?.depreciation || null);
const depreciationStatus = computed(() => depreciation.value?.status || "unconfigured");

function depreciationStatusTone(status: string): StatusTagType {
  if (status === "depreciating") return "success";
  if (status === "not_started") return "warning";
  if (status === "fully_depreciated") return "info";
  return "neutral";
}

const depreciationConfigFields = computed<DetailField[]>(() => {
  const current = depreciation.value;
  if (!current || current.status === "unconfigured") return [];
  return [
    makeField("depreciation-status", "状态", current.status, (value) => depreciationStatusLabel(String(value))),
    makeField("depreciation-method", "折旧方法", current.method, (value) => depreciationMethodLabel(String(value))),
    makeField("depreciation-start", "起算日", current.start_date, formatDate),
    makeField("depreciation-years", "折旧年限", current.years, (value) => `${value} 年`),
    makeField("depreciation-rate", "残值率", current.residual_rate, formatResidualRate),
    makeField("depreciation-residual-value", "预计残值", current.residual_value, formatMoneyDecimalString),
  ];
});
const visibleDepreciationConfigFields = computed(() => fieldsWithContent(depreciationConfigFields.value));
const depreciationMetricFields = computed<DetailField[]>(() => {
  const current = depreciation.value;
  if (!current || current.status === "unconfigured") return [];
  return [
    makeField("depreciation-original", "资产原值", current.original_value, formatMoneyDecimalString),
    makeField("depreciation-accumulated", "累计折旧", current.accumulated_depreciation, formatMoneyDecimalString),
    makeField("depreciation-net", "当前净值", current.net_book_value, formatMoneyDecimalString),
  ];
});

const maintenanceExpiry = computed(() => {
  const current = asset.value;
  const maintenance = current?.maintenance_contracts?.[0];
  return maintenance?.expiry_date || current?.maintenance_expiry_date || null;
});

const maintenanceState = computed<{ label: string; status: string; type: StatusTagType } | null>(() => {
  const expiry = maintenanceExpiry.value;
  const dateText = expiry ? String(expiry).slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const expiryDate = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(expiryDate.getTime())) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysRemaining = Math.ceil((expiryDate.getTime() - todayStart.getTime()) / 86400000);
  if (daysRemaining < 0) return { label: "已过期", status: "expired", type: "danger" };
  if (daysRemaining <= 30) return { label: "即将到期", status: "expiring", type: "warning" };
  return { label: "正常", status: "normal", type: "success" };
});

const procurementDetailFields = computed<DetailField[]>(() => {
  const state = maintenanceState.value;
  return state
    ? [...visibleProcurementFields.value, makeField("maintenance-status", "维保状态", state.status, () => state.label)]
    : visibleProcurementFields.value;
});

type AssetCustomField = NonNullable<AssetDetail["custom_fields"]>[number];
type DynamicFieldGroup = { name: string; fields: AssetCustomField[] };
type HistoricalFieldGroup = { key: string; deviceTypeName: string; fields: AssetCustomField[] };

function isCurrentScope(field: AssetCustomField): boolean {
  const currentDeviceType = asset.value?.device_type;
  return field.device_type == null || (currentDeviceType != null && String(field.device_type) === String(currentDeviceType));
}

function isHistoricalField(field: AssetCustomField): boolean {
  // A disabled device-type field is no longer part of the active runtime
  // scope, but its stored value remains useful historical information.
  return !isCurrentScope(field) || (field.is_active === false && field.device_type != null);
}

function groupCurrentFields(fields: AssetCustomField[]): DynamicFieldGroup[] {
  const groups = new Map<string, AssetCustomField[]>();
  for (const field of fields) {
    if (!hasContent(field.value)) continue;
    const name = field.group?.trim() || "其它信息";
    const group = groups.get(name) || [];
    group.push(field);
    groups.set(name, group);
  }
  return Array.from(groups, ([name, groupFields]) => ({ name, fields: groupFields }))
    .filter((group) => group.fields.some((field) => hasContent(field.value)));
}

function historicalFieldSort(a: AssetCustomField, b: AssetCustomField): number {
  const aName = a.device_type_name || "";
  const bName = b.device_type_name || "";
  return aName.localeCompare(bName, "zh-CN") ||
    (a.device_type || 0) - (b.device_type || 0) ||
    a.sort_order - b.sort_order ||
    a.id - b.id;
}

const currentFieldGroups = computed<DynamicFieldGroup[]>(() => {
  const fields = (asset.value?.custom_fields || []).filter((field) =>
    isCurrentScope(field) && !isHistoricalField(field) && field.detail_visible === true,
  );
  return groupCurrentFields(fields);
});

const historicalFieldGroups = computed<HistoricalFieldGroup[]>(() => {
  const fields = (asset.value?.custom_fields || [])
    .filter((field) => isHistoricalField(field) && hasContent(field.value))
    .sort(historicalFieldSort);
  const groups = new Map<string, HistoricalFieldGroup>();
  for (const field of fields) {
    const deviceTypeName = field.device_type_name || `设备类型 #${field.device_type ?? "?"}`;
    const key = `${field.device_type ?? "none"}:${deviceTypeName}`;
    const group = groups.get(key) || { key, deviceTypeName, fields: [] };
    group.fields.push(field);
    groups.set(key, group);
  }
  return Array.from(groups.values());
});

function fieldLabel(field: AssetCustomField): string {
  return `${field.name || field.key}${field.is_active ? "" : "（已停用）"}`;
}

function dynamicFieldItems(fields: AssetCustomField[]): DetailField[] {
  return fields.map((field) => ({
    key: `field-${field.id}`,
    label: fieldLabel(field),
    raw: field.value,
    value: displayValue(field.value),
    wide: field.field_type === "textarea" || field.field_type === "multiselect",
  }));
}

const inventoryRecords = computed(() => asset.value?.inventory_records || []);
const recentInventoryRecords = computed(() => [...inventoryRecords.value]
  .filter((record) => Boolean(record.checked_at))
  .sort((a, b) => {
    const timeDifference = new Date(b.checked_at || 0).getTime() - new Date(a.checked_at || 0).getTime();
    return timeDifference || b.id - a.id;
  }));
const latestInventoryRecord = computed(() => recentInventoryRecords.value[0] || null);
const relatedRecordFields = computed<DetailField[]>(() => {
  if (!inventoryRecords.value.length) return [];
  const latest = latestInventoryRecord.value;
  return [
    makeField("inventory-count", "盘点记录", inventoryRecords.value.length, (value) => `${value} 次`),
    ...(latest ? [makeField("latest-inventory", "最近盘点", latest.checked_at, formatDateTime)] : []),
  ];
});

function retryDetail() {
  void props.retry?.();
}
</script>

<template>
  <div class="drawer-content asset-detail-content">
    <div v-if="loading" class="drawer-state asset-detail-state" role="status" aria-live="polite">
      <el-skeleton :rows="8" animated />
    </div>
    <div v-else-if="error" class="drawer-state drawer-error asset-detail-state" role="alert">
      <strong>资产详情加载失败</strong>
      <span>{{ error }}</span>
      <el-button v-if="retry" type="primary" plain @click="retryDetail">重新加载</el-button>
    </div>
    <template v-else-if="asset">
      <div v-if="showSummary !== false" class="asset-detail-summary">
        <div>
          <span>资产编号</span>
          <strong>{{ asset.asset_no }}</strong>
        </div>
        <div>
          <span>当前状态</span>
          <StatusTag :tone="statusTone(asset.status)" :label="statusLabel(asset.status)" />
        </div>
      </div>

      <DetailSection v-if="hasBasicFields" title="基本信息">
        <DescriptionList :items="visibleBasicFields" :columns="descriptionColumns" />
      </DetailSection>

      <DetailSection v-if="hasLocationFields" title="位置与归属">
        <DescriptionList :items="visibleLocationFields" :columns="descriptionColumns" />
      </DetailSection>

      <DetailSection v-if="hasNetworkFields" title="网络信息">
        <DescriptionList :items="visibleNetworkFields" :columns="descriptionColumns" />
      </DetailSection>

      <DetailSection v-if="procurementDetailFields.length" title="采购与维保">
        <DescriptionList :items="procurementDetailFields" :columns="descriptionColumns">
          <template #value-maintenance-status>
            <StatusTag
              v-if="maintenanceState"
              :tone="maintenanceState.type"
              :label="maintenanceState.label"
            />
          </template>
        </DescriptionList>
      </DetailSection>

      <DetailSection title="折旧信息">
        <p v-if="depreciationStatus === 'unconfigured'" class="asset-depreciation-empty">
          未配置折旧
        </p>
        <template v-else>
          <div class="asset-depreciation-metrics">
            <div v-for="field in depreciationMetricFields" :key="field.key" class="asset-depreciation-metric">
              <span>{{ field.label }}</span>
              <strong>{{ field.value }}</strong>
            </div>
          </div>
          <DescriptionList
            v-if="visibleDepreciationConfigFields.length"
            :items="visibleDepreciationConfigFields"
            :columns="descriptionColumns"
            class="asset-depreciation-config"
          >
            <template #value-depreciation-status>
              <StatusTag
                :tone="depreciationStatusTone(depreciationStatus)"
                :label="depreciationStatusLabel(depreciationStatus)"
              />
            </template>
          </DescriptionList>
        </template>
      </DetailSection>

      <DetailSection v-if="asset.tags?.length" title="标签">
        <div class="asset-detail-tags">
          <el-tag
            v-for="tag in asset.tags"
            :key="tag.id"
            :type="tag.is_active ? undefined : 'info'"
          >
            {{ tag.name }}<template v-if="!tag.is_active">（已停用）</template>
          </el-tag>
        </div>
      </DetailSection>

      <DetailSection v-for="group in currentFieldGroups" :key="group.name" :title="group.name">
        <DescriptionList :items="dynamicFieldItems(group.fields)" :columns="descriptionColumns">
          <template v-for="field in group.fields" #[`value-field-${field.id}`]>
            <DynamicFieldDisplay :field="field" :value="field.value" />
          </template>
        </DescriptionList>
      </DetailSection>

      <DetailSection v-if="historicalFieldGroups.length" title="历史扩展字段">
        <div v-for="group in historicalFieldGroups" :key="group.key" class="asset-detail-custom-group">
          <h4>历史扩展字段 · {{ group.deviceTypeName }}</h4>
          <DescriptionList :items="dynamicFieldItems(group.fields)" :columns="descriptionColumns">
            <template v-for="field in group.fields" #[`value-field-${field.id}`]>
              <DynamicFieldDisplay :field="field" :value="field.value" />
            </template>
          </DescriptionList>
        </div>
      </DetailSection>

      <DetailSection v-if="hasNotes" title="备注">
        <p class="detail-notes">{{ asset.notes }}</p>
      </DetailSection>

      <DetailSection v-if="relatedRecordFields.length" title="关联记录">
        <DescriptionList :items="relatedRecordFields" :columns="descriptionColumns">
          <template #value-latest-inventory>
            <span class="asset-detail-inline-value">
              <StatusTag
                v-if="latestInventoryRecord"
                :tone="inventoryStatusType(latestInventoryRecord.status)"
                :label="inventoryRecordLabel(latestInventoryRecord)"
              />
              <span v-if="latestInventoryRecord">{{ formatDateTime(latestInventoryRecord.checked_at) }}</span>
            </span>
          </template>
        </DescriptionList>
      </DetailSection>
    </template>
  </div>
</template>
