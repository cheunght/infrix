<script setup lang="ts">
import { computed, toRefs } from "vue";
import type { AssetDetail, InventoryItem } from "../types";
import { statusLabel } from "../status";
import StatusTag, { type StatusTagType } from "./StatusTag.vue";
import DynamicFieldDisplay from "./fields/DynamicFieldDisplay.vue";

const props = defineProps<{
  asset: AssetDetail | null;
  loading: boolean;
  error: string;
  showSummary?: boolean;
  retry?: () => void | Promise<void>;
}>();

const { asset, loading, error, showSummary, retry } = toRefs(props);

type DetailField = {
  label: string;
  raw: unknown;
  value: string;
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

function makeField(label: string, raw: unknown): DetailField {
  return { label, raw, value: displayValue(raw) };
}

function fieldsWithContent(fields: DetailField[]): DetailField[] {
  return fields.filter((field) => hasContent(field.raw));
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function inventoryStatusType(status: string): StatusTagType {
  if (status === "normal") return "success";
  if (status === "pending") return "warning";
  if (["location_mismatch", "not_found", "info_mismatch", "other"].includes(status)) return "danger";
  return "info";
}

function inventoryRecordLabel(record: InventoryItem): string {
  const resolution = record.resolution_status === "resolved"
    ? "已处理"
    : record.resolution_status === "pending"
      ? "待处理"
      : "";
  return [record.status_label, resolution].filter(Boolean).join(" · ");
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
    makeField("设备类型", current.device_type_name || current.asset_type),
    makeField("品牌", current.brand_name),
    makeField("型号", current.model_name || current.model || current.brand_model),
    makeField("序列号", current.serial_number),
    makeField("用途", current.purpose),
    makeField("使用人", current.owner_name),
  ];
});

const locationFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const rack = current.rack_allocation;
  const dataCenter = rack?.data_center || current.asset_data_center_name || current.data_center;
  const room = rack?.server_room;
  const rackCode = rack?.rack_code;
  const uRange = rack && rack.start_u != null && rack.end_u != null
    ? `U${rack.start_u}–U${rack.end_u} (${rack.units}U)`
    : null;
  return [
    makeField("数据中心", dataCenter),
    makeField("机房", room),
    makeField("机柜", rackCode),
    makeField("U 位", uRange),
  ];
});

const networkFields = computed<DetailField[]>(() =>
  ["business", "management", "oob"].map((role) => makeField(roleLabel(role), networkValue(role))),
);

const procurementFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const procurement = current.procurement_records?.[0];
  const maintenance = current.maintenance_contracts?.[0];
  return [
    makeField("采购日期", procurement?.purchase_date || current.purchase_date),
    makeField("供应商", procurement?.supplier || current.supplier),
    makeField("采购单号", procurement?.order_no || current.purchase_order_no),
    makeField("采购金额", procurement?.amount),
    makeField("维保厂商", maintenance?.provider || current.maintenance_provider),
    makeField("维保合同", maintenance?.contract_no),
    makeField("维保开始日", maintenance?.start_date),
    makeField("维保到期", maintenance?.expiry_date || current.maintenance_expiry_date),
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
const inventoryRecords = computed(() => asset.value?.inventory_records || []);

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

const hasTags = computed(() => Boolean(asset.value?.tags?.length));

const recentInventoryRecords = computed(() => [...inventoryRecords.value]
  .filter((record) => Boolean(record.checked_at))
  .sort((a, b) => {
    const timeDifference = new Date(b.checked_at || 0).getTime() - new Date(a.checked_at || 0).getTime();
    return timeDifference || b.id - a.id;
  })
  .slice(0, 5));
const latestInventoryRecord = computed(() => recentInventoryRecords.value[0] || null);

function fieldLabel(field: AssetCustomField): string {
  return field.name || field.key;
}

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
          <StatusTag :status="asset.status" :label="statusLabel(asset.status)" />
        </div>
      </div>

      <section v-if="hasBasicFields" class="asset-detail-section">
        <h3>基本信息</h3>
        <dl class="asset-detail-fields">
          <template v-for="field in visibleBasicFields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="hasLocationFields" class="asset-detail-section">
        <h3>位置与归属</h3>
        <dl class="asset-detail-fields">
          <template v-for="field in visibleLocationFields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="hasNetworkFields" class="asset-detail-section">
        <h3>网络信息</h3>
        <dl class="asset-detail-fields">
          <template v-for="field in visibleNetworkFields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd class="asset-detail-technical">{{ field.value }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="visibleProcurementFields.length || maintenanceState" class="asset-detail-section">
        <h3>采购与维保</h3>
        <dl class="asset-detail-fields">
          <template v-for="field in visibleProcurementFields" :key="field.label">
            <dt>{{ field.label }}</dt>
            <dd>{{ field.value }}</dd>
          </template>
          <template v-if="maintenanceState">
            <dt>维保状态</dt>
            <dd class="asset-detail-inline-value">
              <StatusTag :status="maintenanceState.status" :type="maintenanceState.type" :label="maintenanceState.label" />
            </dd>
          </template>
        </dl>
      </section>

      <section v-if="latestInventoryRecord" class="asset-detail-section">
        <h3>业务状态</h3>
        <dl class="asset-detail-fields">
          <dt>最近盘点</dt>
          <dd class="asset-detail-inline-value">
            <StatusTag
              :status="latestInventoryRecord.status"
              :type="inventoryStatusType(latestInventoryRecord.status)"
              :label="inventoryRecordLabel(latestInventoryRecord)"
            />
            <span>{{ formatDateTime(latestInventoryRecord.checked_at) }}</span>
          </dd>
        </dl>
      </section>

      <section v-if="hasTags" class="asset-detail-section">
        <h3>标签</h3>
        <div v-if="asset.tags?.length" class="asset-detail-tags">
          <el-tag v-for="tag in asset.tags" :key="tag.id" size="small" :type="tag.is_active ? undefined : 'info'">
            {{ tag.name }}
          </el-tag>
        </div>
      </section>

      <section v-for="group in currentFieldGroups" :key="group.name" class="asset-detail-section asset-detail-custom-section">
        <h3>{{ group.name }}</h3>
        <dl class="asset-detail-fields asset-detail-custom-fields">
          <template v-for="field in group.fields" :key="field.id">
            <dt>{{ fieldLabel(field) }}<small v-if="!field.is_active">（已停用）</small></dt>
            <dd><DynamicFieldDisplay :field="field" :value="field.value" /></dd>
          </template>
        </dl>
      </section>

      <section v-if="historicalFieldGroups.length" class="asset-detail-section asset-detail-custom-section asset-detail-custom-section--historical">
        <h3>历史扩展字段</h3>
        <div v-for="group in historicalFieldGroups" :key="group.key" class="asset-detail-custom-group">
          <h4>历史扩展字段 · {{ group.deviceTypeName }}</h4>
          <dl class="asset-detail-fields asset-detail-custom-fields">
            <template v-for="field in group.fields" :key="field.id">
              <dt>{{ fieldLabel(field) }}<small v-if="!field.is_active">（已停用）</small></dt>
              <dd><DynamicFieldDisplay :field="field" :value="field.value" /></dd>
            </template>
          </dl>
        </div>
      </section>

      <section v-if="hasNotes" class="asset-detail-section">
        <h3>备注</h3>
        <p class="detail-notes">{{ asset.notes }}</p>
      </section>

      <section v-if="recentInventoryRecords.length" class="asset-detail-section">
        <h3>最近动态</h3>
        <div class="asset-detail-activity-list">
          <div v-for="record in recentInventoryRecords" :key="record.id" class="asset-detail-activity-item">
            <time>{{ formatDateTime(record.checked_at) }}</time>
            <div>
              <strong>盘点结果：{{ record.status_label }}</strong>
              <span v-if="record.resolution_status === 'resolved'"> · 异常已处理</span>
              <span v-else-if="record.resolution_status === 'pending'"> · 异常待处理</span>
              <small v-if="record.task_name">{{ record.task_name }}</small>
              <p v-if="record.notes">{{ record.notes }}</p>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
