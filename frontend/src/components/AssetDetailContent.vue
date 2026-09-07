<script setup lang="ts">
import { computed, toRefs } from "vue";
import { useI18n } from "vue-i18n";
import { formatSystemDate, formatSystemDateTime } from "../system-settings";
import type {
  AssetInventoryHistoryContext,
  AssetResponsibilityContext,
  AssetResponsibilityHistoryContext,
} from "../page-context";
import type { AssetDetail, AssetNetwork, InventoryItem } from "../types";
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
  formatDepreciationProgress,
  formatMoneyDecimalString,
  formatResidualRate,
} from "../depreciation";
import StatusTag, { type StatusTagType } from "./StatusTag.vue";
import AssetInventoryHistory from "./AssetInventoryHistory.vue";
import AssetResponsibilityActions from "./AssetResponsibilityActions.vue";
import AssetResponsibilityHistory from "./AssetResponsibilityHistory.vue";
import DynamicFieldDisplay from "./fields/DynamicFieldDisplay.vue";
import DetailSection from "./DetailSection.vue";
import DescriptionList from "./DescriptionList.vue";

const props = withDefaults(defineProps<{
  asset: AssetDetail | null;
  loading: boolean;
  error: string;
  variant?: "drawer" | "rack";
  showSummary?: boolean;
  descriptionColumns?: 1 | 2;
  retry?: () => void | Promise<void>;
  responsibilityContext?: AssetResponsibilityContext | null;
  responsibilityHistoryContext?: AssetResponsibilityHistoryContext | null;
  inventoryHistoryContext?: AssetInventoryHistoryContext | null;
}>(), {
  variant: "drawer",
  descriptionColumns: 2,
});

const { asset, loading, error, showSummary, descriptionColumns } = toRefs(props);
const { t } = useI18n();
const isDrawer = computed(() => props.variant === "drawer");
const descriptionLayout = computed(() => isDrawer.value ? "stacked" as const : "horizontal" as const);
const responsibilityActionContext = computed<AssetResponsibilityContext | null>(
  () => props.responsibilityContext || null,
);
const responsibilityHistoryContext = computed<AssetResponsibilityHistoryContext | null>(
  () => props.responsibilityHistoryContext || null,
);
const inventoryHistoryContext = computed<AssetInventoryHistoryContext | null>(
  () => props.inventoryHistoryContext || null,
);
const showResponsibilityHistory = computed(
  () => responsibilityHistoryContext.value?.responsibilityHistoryCanView.value === true,
);
const showInventoryHistory = computed(
  () => inventoryHistoryContext.value?.inventoryHistoryCanView.value === true,
);

type DetailField = {
  key: string;
  label: string;
  raw: unknown;
  value: string;
  empty?: boolean;
  wide?: boolean;
  className?: string;
  title?: string;
};

type ProcurementRecord = NonNullable<AssetDetail["procurement_records"]>[number];
type MaintenanceRecord = NonNullable<AssetDetail["maintenance_contracts"]>[number];
type MaintenanceState = { label: string; status: string; type: StatusTagType };

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
  const empty = !hasContent(raw);
  const value = empty ? t("common.notAvailable") : formatter(raw);
  return {
    key,
    label,
    raw,
    value,
    empty,
    title: value,
  };
}

function formatDate(value: unknown): string {
  if (!hasContent(value)) return t("common.notAvailable");
  return formatSystemDate(String(value)) || t("common.notAvailable");
}

function formatDateTime(value: unknown): string {
  if (!hasContent(value)) return t("common.notAvailable");
  return formatSystemDateTime(String(value)) || String(value);
}

function formatU(value: unknown): string {
  return hasContent(value) ? `U${value}` : t("common.notAvailable");
}

function formatUnits(value: unknown): string {
  return hasContent(value) ? `${value}U` : t("common.notAvailable");
}

function inventoryStatusType(status: string): StatusTagType {
  return businessOptionTone(INVENTORY_ITEM_STATUS_OPTIONS, status, "info");
}

function inventoryRecordLabel(record: InventoryItem): string {
  const itemStatusLabel = businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, record.status);
  const resolution = record.resolution_status === "not_required"
    ? ""
    : businessOptionLabel(INVENTORY_RESOLUTION_STATUS_OPTIONS, record.resolution_status);
  return [itemStatusLabel, resolution].filter(Boolean).join(" · ");
}

function roleLabel(role: string): string {
  return ({ business: t("asset.businessIp"), management: t("asset.managementIp"), oob: t("asset.oobIp") } as Record<string, string>)[role] || role;
}

function networkStatusLabel(value: unknown): string {
  if (!hasContent(value)) return t("common.notAvailable");
  if (value === "active") return t("status.active");
  if (value === "inactive") return t("status.inactive");
  return String(value);
}

const basicFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const fields = isDrawer.value ? [
    makeField("manufacturer", t("asset.manufacturer"), current.manufacturer_name),
    makeField("model", t("asset.model"), current.model_name || current.model),
    makeField("purpose", t("asset.purpose"), current.purpose),
    makeField("department", t("asset.department"), current.department_name),
  ] : [
    makeField("device-type", t("asset.deviceType"), current.device_type_name),
    makeField("manufacturer", t("asset.manufacturer"), current.manufacturer_name),
    makeField("model", t("asset.model"), current.model_name || current.model),
    makeField("manufacturer-model", t("asset.manufacturerModel"), current.manufacturer_model),
    makeField("serial-number", t("asset.serialNumber"), current.serial_number),
    makeField("purpose", t("asset.purpose"), current.purpose),
    makeField("department", t("asset.department"), current.department_name),
  ];
  if (!props.responsibilityContext) {
    fields.push(makeField("responsible-user", t("asset.responsibleUser"), current.responsible_user_name));
  }
  return fields;
});

const locationFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const rack = current.rack_allocation;
  const dataCenter = rack?.data_center || current.asset_data_center_name || current.data_center;
  return [
    makeField("location-status", t("asset.locationStatus"), rack ? t("asset.mounted") : t("asset.unmounted")),
    makeField("data-center", t("common.dataCenter"), dataCenter),
    makeField("server-room", t("asset.room"), rack?.server_room),
    makeField("rack", t("asset.rack"), rack?.rack_code),
    makeField("start-u", t("asset.startU"), rack?.start_u, formatU),
    makeField("end-u", t("asset.endU"), rack?.end_u, formatU),
    makeField("occupied-u", t("asset.occupiedU"), rack?.units, formatUnits),
    makeField("rack-total-u", t("asset.rackTotalU"), rack?.rack_total_u, formatUnits),
  ];
});

const networkRows = computed<AssetNetwork[]>(() => asset.value?.network_addresses || []);
const primaryNetwork = computed<AssetNetwork | null>(() => {
  const rows = networkRows.value;
  return rows.find((row) => row.is_primary)
    || rows.find((row) => row.role === "business")
    || rows[0]
    || null;
});

function rackPositionLabel(current: AssetDetail): string {
  const rack = current.rack_allocation;
  if (!rack) return displayValue(current.u_range);
  if (rack.start_u === rack.end_u) return formatU(rack.start_u);
  return `${formatU(rack.start_u)}–${formatU(rack.end_u)}`;
}

const locatorFields = computed<DetailField[]>(() => {
  const current = asset.value;
  if (!current) return [];
  const rack = current.rack_allocation;
  const dataCenter = rack?.data_center || current.asset_data_center_name || current.data_center;
  const locationPath = [dataCenter, rack?.server_room || current.server_room, rack?.rack_code || current.rack_code]
    .filter(hasContent)
    .join(" / ");
  const brandModel = current.manufacturer_model
    || [current.manufacturer_name, current.model_name || current.model].filter(hasContent).join(" / ");
  return [
    makeField("locator-code", t("asset.code"), current.asset_no),
    makeField("locator-device-type", t("asset.deviceType"), current.device_type_name),
    makeField("locator-brand-model", t("asset.manufacturerModel"), brandModel),
    makeField("locator-serial-number", t("asset.serialNumber"), current.serial_number),
    { ...makeField("locator-location", t("asset.location"), locationPath), wide: true },
    makeField("locator-u-range", t("asset.uRange"), rackPositionLabel(current)),
    makeField(
      "locator-primary-ip",
      t("asset.primaryIp"),
      primaryNetwork.value?.address || current.business_ip || current.management_ip || current.oob_ip,
    ),
  ];
});
const emptyNetworkFields = computed<DetailField[]>(() => [
  makeField("network-address", t("asset.networkAddress"), null),
]);

const procurementRecords = computed(() => asset.value?.procurement_records || []);
const maintenanceRecords = computed(() => asset.value?.maintenance_contracts || []);
const procurementRecordCount = computed(() => {
  if (procurementRecords.value.length) return procurementRecords.value.length;
  const current = asset.value;
  return current && [current.purchase_date, current.supplier, current.purchase_order_no].some(hasContent) ? 1 : 0;
});

function itemCount(count: number): string {
  return t("units.item", count);
}

function procurementRecordFields(record: ProcurementRecord | null): DetailField[] {
  const current = asset.value;
  return [
    makeField("purchase-date", t("asset.purchaseDate"), record?.purchase_date || current?.purchase_date, formatDate),
    makeField("supplier", t("asset.supplier"), record?.supplier || current?.supplier),
    makeField("purchase-order", t("asset.purchaseOrder"), record?.order_no || current?.purchase_order_no),
    makeField("purchase-amount", t("asset.purchaseAmount"), record?.amount, formatMoneyDecimalString),
    { ...makeField("procurement-notes", t("asset.procurementNotes"), record?.notes), wide: true },
  ];
}

function maintenanceStateFor(expiry: unknown): MaintenanceState | null {
  if (!hasContent(expiry)) return null;
  const dateText = String(expiry).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  const expiryDate = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(expiryDate.getTime())) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysRemaining = Math.ceil((expiryDate.getTime() - todayStart.getTime()) / 86400000);
  if (daysRemaining < 0) return { label: t("status.expired"), status: "expired", type: "danger" };
  if (daysRemaining <= 30) return { label: t("status.expiring"), status: "expiring", type: "warning" };
  return { label: t("status.normal"), status: "normal", type: "success" };
}

function maintenanceStatusText(value: unknown): string {
  return maintenanceStateFor(value)?.label || displayValue(value);
}

function maintenanceRecordFields(record: MaintenanceRecord | null): DetailField[] {
  return [
    makeField("maintenance-provider", t("asset.maintenanceProvider"), record?.provider),
    makeField("maintenance-contract", t("asset.maintenanceContract"), record?.contract_no),
    makeField("maintenance-start", t("asset.maintenanceStart"), record?.start_date, formatDate),
    makeField("maintenance-expiry", t("asset.maintenanceExpiry"), record?.expiry_date, formatDate),
    makeField("maintenance-status", t("asset.maintenanceStatus"), record?.expiry_date, maintenanceStatusText),
    { ...makeField("maintenance-notes", t("asset.maintenanceNotes"), record?.notes), wide: true },
  ];
}

const depreciation = computed(() => asset.value?.depreciation || null);
const depreciationStatus = computed(() => depreciation.value?.status || "unconfigured");

function depreciationStatusTone(status: string): StatusTagType {
  if (status === "depreciating") return "success";
  if (status === "not_started") return "warning";
  if (status === "fully_depreciated") return "info";
  return "neutral";
}

const depreciationFields = computed<DetailField[]>(() => {
  const current = depreciation.value;
  return [
    makeField("depreciation-status", t("asset.depreciationStatus"), depreciationStatus.value, (value) => depreciationStatusLabel(String(value))),
    makeField("depreciation-method", t("asset.depreciationMethod"), current?.method, (value) => depreciationMethodLabel(String(value))),
    makeField("depreciation-start", t("asset.depreciationStart"), current?.start_date, formatDate),
    makeField("depreciation-years", t("asset.depreciationYears"), current?.years, (value) => `${value} ${t("common.years")}`),
    makeField("depreciation-rate", t("asset.residualRate"), current?.residual_rate, formatResidualRate),
    makeField("depreciation-original", t("asset.originalValue"), current?.original_value, formatMoneyDecimalString),
    makeField("depreciation-residual-value", t("asset.estimatedResidual"), current?.residual_value, formatMoneyDecimalString),
    makeField("depreciation-monthly", t("asset.monthlyDepreciation"), current?.monthly_depreciation, formatMoneyDecimalString),
    makeField("depreciation-accumulated", t("asset.accumulatedDepreciation"), current?.accumulated_depreciation, formatMoneyDecimalString),
    makeField("depreciation-net", t("asset.netBookValue"), current?.net_book_value, formatMoneyDecimalString),
    makeField("depreciation-elapsed-months", t("asset.elapsedMonths"), current?.elapsed_months, (value) => `${value} ${t("common.months")}`),
    makeField("depreciation-total-months", t("asset.totalMonths"), current?.total_months, (value) => `${value} ${t("common.months")}`),
    makeField("depreciation-progress", t("asset.depreciationProgress"), current?.progress, (value) => formatDepreciationProgress(value, current?.elapsed_months, current?.total_months)),
  ];
});

type AssetCustomField = NonNullable<AssetDetail["custom_fields"]>[number];
type DynamicFieldGroup = { name: string; fields: AssetCustomField[] };

function isCurrentScope(field: AssetCustomField): boolean {
  const currentDeviceType = asset.value?.device_type;
  return field.device_type == null || (currentDeviceType != null && String(field.device_type) === String(currentDeviceType));
}

function groupCurrentFields(fields: AssetCustomField[]): DynamicFieldGroup[] {
  const groups = new Map<string, AssetCustomField[]>();
  for (const field of fields) {
    const name = field.group?.trim() || t("asset.otherInfo");
    const group = groups.get(name) || [];
    group.push(field);
    groups.set(name, group);
  }
  return Array.from(groups, ([name, groupFields]) => ({ name, fields: groupFields }));
}

const currentFieldGroups = computed<DynamicFieldGroup[]>(() => {
  const fields = (asset.value?.custom_fields || []).filter(isCurrentScope);
  return groupCurrentFields(fields);
});
const customFieldCount = computed(() => currentFieldGroups.value.reduce((total, group) => total + group.fields.length, 0));

function fieldLabel(field: AssetCustomField): string {
  return `${field.name || field.key}${field.is_active === false ? ` (${t("status.inactive")})` : ""}`;
}

function dynamicFieldItems(fields: AssetCustomField[]): DetailField[] {
  return fields.map((field) => ({
    key: `field-${field.id}`,
    label: fieldLabel(field),
    raw: field.value,
    value: displayValue(field.value),
    empty: !hasContent(field.value),
    wide: field.field_type === "textarea" || field.field_type === "multiselect",
  }));
}

const tags = computed(() => asset.value?.tags || []);
const emptyTagsFields = computed<DetailField[]>(() => [
  makeField("tags", t("asset.tags"), null),
]);

const systemFields = computed<DetailField[]>(() => [
  makeField("created-at", t("asset.createdAt"), asset.value?.created_at, formatDateTime),
  makeField("updated-at", t("asset.updatedAt"), asset.value?.updated_at, formatDateTime),
]);

const inventoryRecordCount = computed(() => asset.value?.inventory_records_count ?? 0);
const latestInventoryRecord = computed(() => asset.value?.latest_inventory_record || null);
const relatedRecordFields = computed<DetailField[]>(() => [
  makeField("inventory-count", t("asset.inventoryRecords"), inventoryRecordCount.value, (value) => t("units.item", Number(value))),
  makeField("latest-inventory", t("asset.recentInventory"), latestInventoryRecord.value?.checked_at, formatDateTime),
]);

function recordTitle(label: string, index: number, total: number): string {
  return total > 1 ? `${label} ${index + 1}` : label;
}

function retryDetail() {
  void props.retry?.();
}
</script>

<template>
  <div
    class="drawer-content asset-detail-content"
    :class="`asset-detail-content--${variant}`"
  >
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
          <span>{{ t('asset.name') }}</span>
          <strong :title="displayValue(asset.name)">{{ displayValue(asset.name) }}</strong>
        </div>
        <div>
          <span>{{ t('asset.code') }}</span>
          <strong :title="displayValue(asset.asset_no)">{{ displayValue(asset.asset_no) }}</strong>
        </div>
        <div>
          <span>{{ t('asset.status') }}</span>
          <StatusTag :tone="statusTone(asset.status)" :label="statusLabel(asset.status)" />
        </div>
      </div>

      <section v-if="isDrawer" class="asset-locator-summary" :aria-label="t('asset.locationSnapshot')">
        <div class="asset-locator-summary__heading">
          <span>{{ t('asset.locationSnapshot') }}</span>
        </div>
        <DescriptionList
          class="asset-detail-description-list asset-locator-summary__list"
          :items="locatorFields"
          :columns="2"
          layout="stacked"
        >
          <template #value-locator-code="{ item }">
            <span class="asset-detail-technical">{{ item.value }}</span>
          </template>
          <template #value-locator-serial-number="{ item }">
            <span class="asset-detail-technical">{{ item.value }}</span>
          </template>
          <template #value-locator-primary-ip="{ item }">
            <span class="asset-detail-technical">{{ item.value }}</span>
          </template>
        </DescriptionList>
      </section>

      <DetailSection :title="t('asset.basicInfo')">
        <DescriptionList
          class="asset-detail-description-list"
          :items="basicFields"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        />
      </DetailSection>

      <DetailSection :title="t('asset.locationOwnership')">
        <DescriptionList
          class="asset-detail-description-list"
          :items="locationFields"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        />
      </DetailSection>

      <DetailSection :title="t('asset.network')">
        <el-table
          v-if="networkRows.length"
          :data="networkRows"
          class="asset-detail-record-table"
          size="small"
          border
          row-key="id"
        >
          <el-table-column prop="role" :label="t('asset.networkRole')" min-width="116">
            <template #default="{ row }">{{ roleLabel(row.role) }}</template>
          </el-table-column>
          <el-table-column prop="address" :label="t('asset.networkAddress')" min-width="150" show-overflow-tooltip />
          <el-table-column prop="is_primary" :label="t('asset.networkPrimary')" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.is_primary" type="success" size="small">{{ t('common.yes') }}</el-tag>
              <span v-else>{{ t('common.no') }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" :label="t('asset.networkStatus')" width="90">
            <template #default="{ row }">{{ networkStatusLabel(row.status) }}</template>
          </el-table-column>
          <el-table-column prop="notes" :label="t('asset.networkNotes')" min-width="160" show-overflow-tooltip />
        </el-table>
        <DescriptionList
          v-else
          class="asset-detail-description-list"
          :items="emptyNetworkFields"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        />
      </DetailSection>

      <DetailSection v-if="responsibilityActionContext" :title="t('asset.responsibility')">
        <AssetResponsibilityActions
          :asset="asset"
          :context="responsibilityActionContext"
        />
      </DetailSection>

      <AssetResponsibilityHistory
        v-if="responsibilityHistoryContext && showResponsibilityHistory"
        :context="responsibilityHistoryContext"
        :collapsible="isDrawer"
      />

      <DetailSection
        :title="t('asset.procurementInfo')"
        :collapsible="isDrawer"
        :summary="itemCount(procurementRecordCount)"
      >
        <div v-if="procurementRecords.length" class="asset-detail-record-list">
          <article
            v-for="(record, index) in procurementRecords"
            :key="record.id"
            class="asset-detail-record-card"
          >
            <h4 class="asset-detail-record-card__title">
              {{ recordTitle(t('asset.procurementInfo'), index, procurementRecords.length) }}
            </h4>
            <DescriptionList
              class="asset-detail-description-list"
              :items="procurementRecordFields(record)"
              :columns="descriptionColumns"
              :layout="descriptionLayout"
            />
          </article>
        </div>
        <DescriptionList
          v-else
          class="asset-detail-description-list"
          :items="procurementRecordFields(null)"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        />
      </DetailSection>

      <DetailSection
        :title="t('asset.maintenanceInfo')"
        :collapsible="isDrawer"
        :summary="itemCount(maintenanceRecords.length)"
      >
        <div v-if="maintenanceRecords.length" class="asset-detail-record-list">
          <article
            v-for="(record, index) in maintenanceRecords"
            :key="record.id"
            class="asset-detail-record-card"
          >
            <h4 class="asset-detail-record-card__title">
              {{ recordTitle(t('asset.maintenanceInfo'), index, maintenanceRecords.length) }}
            </h4>
            <DescriptionList
              class="asset-detail-description-list"
              :items="maintenanceRecordFields(record)"
              :columns="descriptionColumns"
              :layout="descriptionLayout"
            >
              <template #value-maintenance-status="{ item }">
                <StatusTag
                  v-if="maintenanceStateFor(item.raw)"
                  :tone="maintenanceStateFor(item.raw)!.type"
                  :label="maintenanceStateFor(item.raw)!.label"
                />
                <span v-else class="asset-detail-empty-value">{{ item.value }}</span>
              </template>
            </DescriptionList>
          </article>
        </div>
        <DescriptionList
          v-else
          class="asset-detail-description-list"
          :items="maintenanceRecordFields(null)"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        >
          <template #value-maintenance-status="{ item }">
            <StatusTag
              v-if="maintenanceStateFor(item.raw)"
              :tone="maintenanceStateFor(item.raw)!.type"
              :label="maintenanceStateFor(item.raw)!.label"
            />
            <span v-else class="asset-detail-empty-value">{{ item.value }}</span>
          </template>
        </DescriptionList>
      </DetailSection>

      <DetailSection
        :title="t('asset.depreciation')"
        :collapsible="isDrawer"
        :summary="depreciationStatusLabel(depreciationStatus)"
      >
        <DescriptionList
          class="asset-detail-description-list"
          :items="depreciationFields"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        >
          <template #value-depreciation-status>
            <StatusTag
              :tone="depreciationStatusTone(depreciationStatus)"
              :label="depreciationStatusLabel(depreciationStatus)"
            />
          </template>
        </DescriptionList>
      </DetailSection>

      <DetailSection
        :title="t('asset.tags')"
        :collapsible="isDrawer"
        :summary="itemCount(tags.length)"
      >
        <div v-if="tags.length" class="asset-detail-tags">
          <el-tag
            v-for="tag in tags"
            :key="tag.id"
            :type="tag.is_active ? undefined : 'info'"
          >
            {{ tag.name }}<template v-if="!tag.is_active"> ({{ t('status.inactive') }})</template>
          </el-tag>
        </div>
        <DescriptionList
          v-else
          class="asset-detail-description-list"
          :items="emptyTagsFields"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        />
      </DetailSection>

      <DetailSection
        :title="t('asset.customFields')"
        :collapsible="isDrawer"
        :summary="itemCount(customFieldCount)"
      >
        <div v-if="currentFieldGroups.length" class="asset-detail-custom-groups">
          <section v-for="group in currentFieldGroups" :key="group.name" class="asset-detail-custom-group">
            <h4>{{ group.name }}</h4>
            <DescriptionList
              class="asset-detail-description-list"
              :items="dynamicFieldItems(group.fields)"
              :columns="descriptionColumns"
              :layout="descriptionLayout"
            >
              <template v-for="field in group.fields" #[`value-field-${field.id}`]>
                <DynamicFieldDisplay :field="field" :value="field.value" />
              </template>
            </DescriptionList>
          </section>
        </div>
        <DescriptionList
          v-else
          class="asset-detail-description-list"
          :items="[makeField('custom-fields-empty', t('asset.customFields'), null)]"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        />
      </DetailSection>

      <DetailSection :title="t('common.notes')" :collapsible="isDrawer">
        <p :class="['detail-notes', { 'asset-detail-empty-value': !hasContent(asset.notes) }]">
          {{ displayValue(asset.notes) }}
        </p>
      </DetailSection>

      <DetailSection :title="t('asset.systemInfo')" :collapsible="isDrawer">
        <DescriptionList
          class="asset-detail-description-list"
          :items="systemFields"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        />
      </DetailSection>

      <DetailSection
        :title="t('asset.relatedRecords')"
        :collapsible="isDrawer"
        :summary="itemCount(inventoryRecordCount)"
      >
        <DescriptionList
          class="asset-detail-description-list"
          :items="relatedRecordFields"
          :columns="descriptionColumns"
          :layout="descriptionLayout"
        >
          <template #value-latest-inventory="{ item }">
            <span class="asset-detail-inline-value">
              <StatusTag
                v-if="latestInventoryRecord"
                :tone="inventoryStatusType(latestInventoryRecord.status)"
                :label="inventoryRecordLabel(latestInventoryRecord)"
              />
              <span v-if="latestInventoryRecord">{{ formatDateTime(latestInventoryRecord.checked_at) }}</span>
              <span v-else class="asset-detail-empty-value">{{ item.value }}</span>
            </span>
          </template>
        </DescriptionList>
      </DetailSection>

      <AssetInventoryHistory
        v-if="inventoryHistoryContext && showInventoryHistory"
        :context="inventoryHistoryContext"
        :collapsible="isDrawer"
      />
    </template>
  </div>
</template>
