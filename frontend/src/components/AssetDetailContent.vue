<script setup lang="ts">
import { computed, toRefs } from "vue";
import { useI18n } from "vue-i18n";
import { currentLocale } from "../i18n";
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
const { t } = useI18n();

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
  if (!hasContent(value)) return t("common.notAvailable");
  if (Array.isArray(value)) return value.map((item) => displayValue(item)).join("、");
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
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
    value: hasContent(raw) ? formatter(raw) : t("common.notAvailable"),
  };
}

function fieldsWithContent(fields: DetailField[]): DetailField[] {
  return fields.filter((field) => hasContent(field.raw));
}

function formatDate(value: unknown): string {
  if (!hasContent(value)) return t("common.notAvailable");
  const text = String(value);
  return text.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || text;
}

function formatDateTime(value: unknown): string {
  if (!hasContent(value)) return t("common.notAvailable");
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(currentLocale.value, {
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
  const statusLabel = businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, record.status);
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
  return ({ business: t("asset.businessIp"), management: t("asset.managementIp"), oob: t("asset.oobIp") } as Record<string, string>)[role] || role;
}

const basicFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  return [
    makeField("device-type", t("asset.deviceType"), current.device_type_name),
    makeField("manufacturer", t("asset.manufacturer"), current.manufacturer_name),
    makeField("model", t("asset.model"), current.model_name || current.model || current.manufacturer_model),
    makeField("serial-number", t("asset.serialNumber"), current.serial_number),
    makeField("purpose", t("asset.purpose"), current.purpose),
    makeField("owner", t("asset.owner"), current.owner_name),
  ];
});

const locationFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const rack = current.rack_allocation;
  const dataCenter = rack?.data_center || current.asset_data_center_name || current.data_center;

  if (!rack) {
    return [
      makeField("placement-status", t("asset.locationStatus"), t("inventory.unmounted")),
      ...(hasContent(dataCenter) ? [makeField("data-center", t("common.dataCenter"), dataCenter)] : []),
    ];
  }

  const uRange = rack.start_u != null && rack.end_u != null
    ? `U${rack.start_u}–U${rack.end_u} (${rack.units}U)`
    : null;
  return [
    makeField("data-center", t("common.dataCenter"), dataCenter),
    makeField("server-room", t("asset.room"), rack.server_room),
    makeField("rack", t("asset.rack"), rack.rack_code),
    makeField("u-position", t("asset.uPosition"), uRange),
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
    makeField("purchase-date", t("asset.purchaseDate"), procurement?.purchase_date || current.purchase_date, formatDate),
    makeField("supplier", t("asset.supplier"), procurement?.supplier || current.supplier),
    makeField("purchase-order", t("asset.purchaseOrder"), procurement?.order_no || current.purchase_order_no),
    makeField("purchase-amount", t("asset.purchaseAmount"), procurement?.amount, formatMoneyDecimalString),
    makeField("maintenance-provider", t("asset.maintenanceProvider"), maintenance?.provider || current.maintenance_provider),
    makeField("maintenance-contract", t("asset.maintenanceContract"), maintenance?.contract_no),
    makeField("maintenance-start", t("asset.maintenanceStart"), maintenance?.start_date, formatDate),
    makeField("maintenance-expiry", t("asset.maintenanceExpiry"), maintenance?.expiry_date || current.maintenance_expiry_date, formatDate),
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
    makeField("depreciation-status", t("common.status"), current.status, (value) => depreciationStatusLabel(String(value))),
    makeField("depreciation-method", t("asset.depreciationMethod"), current.method, (value) => depreciationMethodLabel(String(value))),
    makeField("depreciation-start", t("asset.depreciationStart"), current.start_date, formatDate),
    makeField("depreciation-years", t("asset.depreciationYears"), current.years, (value) => `${value} ${t("common.years")}`),
    makeField("depreciation-rate", t("asset.residualRate"), current.residual_rate, formatResidualRate),
    makeField("depreciation-residual-value", t("asset.estimatedResidual"), current.residual_value, formatMoneyDecimalString),
  ];
});
const visibleDepreciationConfigFields = computed(() => fieldsWithContent(depreciationConfigFields.value));
const depreciationMetricFields = computed<DetailField[]>(() => {
  const current = depreciation.value;
  if (!current || current.status === "unconfigured") return [];
  return [
    makeField("depreciation-original", t("asset.originalValue"), current.original_value, formatMoneyDecimalString),
    makeField("depreciation-accumulated", t("asset.accumulatedDepreciation"), current.accumulated_depreciation, formatMoneyDecimalString),
    makeField("depreciation-net", t("asset.netBookValue"), current.net_book_value, formatMoneyDecimalString),
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
  if (daysRemaining < 0) return { label: t("status.expired"), status: "expired", type: "danger" };
  if (daysRemaining <= 30) return { label: t("status.expiring"), status: "expiring", type: "warning" };
  return { label: t("status.normal"), status: "normal", type: "success" };
});

const procurementDetailFields = computed<DetailField[]>(() => {
  const state = maintenanceState.value;
  return state
    ? [...visibleProcurementFields.value, makeField("maintenance-status", t("asset.maintenanceStatus"), state.status, () => state.label)]
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
    const name = field.group?.trim() || t("asset.otherInfo");
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
    const deviceTypeName = field.device_type_name || `${t("common.deviceType")} #${field.device_type ?? "?"}`;
    const key = `${field.device_type ?? "none"}:${deviceTypeName}`;
    const group = groups.get(key) || { key, deviceTypeName, fields: [] };
    group.fields.push(field);
    groups.set(key, group);
  }
  return Array.from(groups.values());
});

function fieldLabel(field: AssetCustomField): string {
  return `${field.name || field.key}${field.is_active ? "" : ` (${t("status.inactive")})`}`;
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
    makeField("inventory-count", t("asset.inventoryRecords"), inventoryRecords.value.length, (value) => t("units.item", Number(value))),
    ...(latest ? [makeField("latest-inventory", t("asset.recentInventory"), latest.checked_at, formatDateTime)] : []),
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
      <strong>{{ t('asset.assetDetailLoadFailed') }}</strong>
      <span>{{ error }}</span>
      <el-button v-if="retry" type="primary" plain @click="retryDetail">{{ t('common.retry') }}</el-button>
    </div>
    <template v-else-if="asset">
      <div v-if="showSummary !== false" class="asset-detail-summary">
        <div>
          <span>{{ t('asset.code') }}</span>
          <strong>{{ asset.asset_no }}</strong>
        </div>
        <div>
          <span>{{ t('asset.status') }}</span>
          <StatusTag :tone="statusTone(asset.status)" :label="statusLabel(asset.status)" />
        </div>
      </div>

      <DetailSection v-if="hasBasicFields" :title="t('asset.basicInfo')">
        <DescriptionList
          class="asset-detail-description-list"
          :items="visibleBasicFields"
          :columns="descriptionColumns"
        />
      </DetailSection>

      <DetailSection v-if="hasLocationFields" :title="t('asset.locationOwnership')">
        <DescriptionList
          class="asset-detail-description-list"
          :items="visibleLocationFields"
          :columns="descriptionColumns"
        />
      </DetailSection>

      <DetailSection v-if="hasNetworkFields" :title="t('asset.network')">
        <DescriptionList
          class="asset-detail-description-list"
          :items="visibleNetworkFields"
          :columns="descriptionColumns"
        />
      </DetailSection>

      <DetailSection v-if="procurementDetailFields.length" :title="t('asset.procurement')">
        <DescriptionList
          class="asset-detail-description-list"
          :items="procurementDetailFields"
          :columns="descriptionColumns"
        >
          <template #value-maintenance-status>
            <StatusTag
              v-if="maintenanceState"
              :tone="maintenanceState.type"
              :label="maintenanceState.label"
            />
          </template>
        </DescriptionList>
      </DetailSection>

      <DetailSection :title="t('asset.depreciation')">
        <p v-if="depreciationStatus === 'unconfigured'" class="asset-depreciation-empty">
          {{ t('asset.unconfiguredDepreciation') }}
        </p>
        <template v-else>
          <div class="asset-depreciation-metrics">
            <div v-for="field in depreciationMetricFields" :key="field.key" class="asset-depreciation-metric">
              <span>{{ field.label }}</span>
              <strong>{{ field.value }}</strong>
            </div>
          </div>
          <DescriptionList
            class="asset-detail-description-list asset-depreciation-config"
            v-if="visibleDepreciationConfigFields.length"
            :items="visibleDepreciationConfigFields"
            :columns="descriptionColumns"
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

      <DetailSection v-if="asset.tags?.length" :title="t('nav.tags')">
        <div class="asset-detail-tags">
          <el-tag
            v-for="tag in asset.tags"
            :key="tag.id"
            :type="tag.is_active ? undefined : 'info'"
          >
            {{ tag.name }}<template v-if="!tag.is_active"> ({{ t('status.inactive') }})</template>
          </el-tag>
        </div>
      </DetailSection>

      <DetailSection v-for="group in currentFieldGroups" :key="group.name" :title="group.name">
        <DescriptionList
          class="asset-detail-description-list"
          :items="dynamicFieldItems(group.fields)"
          :columns="descriptionColumns"
        >
          <template v-for="field in group.fields" #[`value-field-${field.id}`]>
            <DynamicFieldDisplay :field="field" :value="field.value" />
          </template>
        </DescriptionList>
      </DetailSection>

      <DetailSection v-if="historicalFieldGroups.length" :title="t('asset.historicalExtendedFields')">
        <div v-for="group in historicalFieldGroups" :key="group.key" class="asset-detail-custom-group">
          <h4>{{ t('asset.historicalExtendedFields') }} · {{ group.deviceTypeName }}</h4>
          <DescriptionList
            class="asset-detail-description-list"
            :items="dynamicFieldItems(group.fields)"
            :columns="descriptionColumns"
          >
            <template v-for="field in group.fields" #[`value-field-${field.id}`]>
              <DynamicFieldDisplay :field="field" :value="field.value" />
            </template>
          </DescriptionList>
        </div>
      </DetailSection>

      <DetailSection v-if="hasNotes" :title="t('common.notes')">
        <p class="detail-notes">{{ asset.notes }}</p>
      </DetailSection>

      <DetailSection v-if="relatedRecordFields.length" :title="t('asset.relatedRecords')">
        <DescriptionList
          class="asset-detail-description-list"
          :items="relatedRecordFields"
          :columns="descriptionColumns"
        >
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
