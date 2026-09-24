<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AssetAuditHistoryContext } from "../page-context";
import type { AssetTimelineChange, AssetTimelineEvent } from "../types";
import { formatSystemDate, formatSystemDateTime } from "../system-settings";
import { statusLabel } from "../status";
import DetailSection from "./DetailSection.vue";
import PagedTable from "./PagedTable.vue";
import ResourceState from "./ResourceState.vue";

const props = withDefaults(
  defineProps<{
    context: AssetAuditHistoryContext;
    collapsible?: boolean;
  }>(),
  { collapsible: false },
);

const { t } = useI18n();
const context = props.context;
const items = computed(() => context.assetAuditItems.value);
const loading = computed(() => context.assetAuditLoading.value);
const error = computed(() => context.assetAuditError.value);
const empty = computed(() => !loading.value && !error.value && items.value.length === 0);

const FIELD_LABEL_KEYS: Record<string, string> = {
  asset_no: "asset.code",
  name: "asset.name",
  status: "asset.status",
  assigned_person: "asset.assignedPerson",
  rack_allocation: "asset.rack",
  asset_data_center: "common.dataCenter",
  asset_model: "asset.model",
  serial_number: "asset.serialNumber",
  purpose: "asset.purpose",
  notes: "common.notes",
  warranty_months: "asset.warranty",
  depreciation_start_date: "asset.depreciationStart",
  depreciation_years: "asset.depreciationYears",
  residual_rate: "asset.residualRate",
  depreciation_method: "asset.depreciationMethod",
  network_addresses: "asset.networkAddress",
  procurement_records: "asset.procurementInfo",
  maintenance_contracts: "asset.maintenanceInfo",
  tags: "asset.tags",
  file_name: "attachment.fileName",
  category_label: "attachment.category",
  attachment_category: "attachment.category",
  note: "common.notes",
  size: "attachment.size",
  status_label: "asset.inventoryStatus",
  resolution_status_label: "asset.inventoryResolutionStatus",
  resolution_action_label: "asset.inventoryResolutionAction",
  inventory_status: "asset.inventoryStatus",
  inventory_resolution_status: "asset.inventoryResolutionStatus",
  inventory_resolution_action: "asset.inventoryResolutionAction",
  actual_data_center: "common.dataCenter",
  actual_server_room: "common.room",
  actual_rack_code: "asset.rack",
  actual_start_u: "asset.startU",
  actual_end_u: "asset.endU",
  checked_by_name: "asset.checkedBy",
  resolved_by_name: "asset.resolvedBy",
  resolution_note: "asset.resolutionNote",
  occurred_at: "fault.occurredAt",
  reason: "fault.reason",
  description: "common.description",
  is_closed: "fault.closed",
  resolved_at: "fault.resolvedAt",
  provider: "asset.maintenanceProvider",
  started_at: "fault.startedAt",
  finished_at: "fault.finishedAt",
  cost: "fault.cost",
  repair_part_source: "repair.partUsageSource",
  part_name: "repair.partUsagePart",
  part_code: "repair.partUsageCode",
  part_model: "repair.partUsageModel",
  spare_unit: "spare.unit",
  stock_location: "repair.partUsageOrigin",
  vendor_name: "repair.partUsageVendor",
  stock_operation_type: "spare.operationType",
  source_data_center: "common.dataCenter",
  source_server_room: "common.room",
  target_data_center: "common.dataCenter",
  target_server_room: "common.room",
  quantity: "spare.quantity",
  quantity_delta: "spare.changeQuantity",
  before_quantity: "spare.changedBefore",
  after_quantity: "spare.changedAfter",
  reference: "spare.referencePurpose",
};

const ENUM_LABEL_KEYS: Record<string, Record<string, string>> = {
  attachment_category: {
    photo: "attachment.categories.photo",
    invoice: "attachment.categories.invoice",
    contract: "attachment.categories.contract",
    warranty: "attachment.categories.warranty",
    maintenance_report: "attachment.categories.maintenance_report",
    other: "attachment.categories.other",
  },
  inventory_status: {
    pending: "status.pendingInventory",
    normal: "status.normal",
    location_mismatch: "status.locationMismatch",
    not_found: "status.notFound",
    info_mismatch: "status.infoMismatch",
    other: "status.otherException",
  },
  inventory_resolution_status: {
    not_required: "status.notRequired",
    pending: "status.pending",
    resolved: "status.resolved",
  },
  inventory_resolution_action: {
    update_asset: "inventory.updateAsset",
    keep_asset: "inventory.keepAsset",
    confirm_missing: "inventory.confirmMissing",
    ignore: "inventory.ignore",
  },
  repair_part_source: {
    internal_stock: "repair.internalStock",
    vendor_provided: "repair.vendorProvided",
  },
  stock_operation_type: {
    initial: "spare.initialOperation",
    inbound: "spare.inbound",
    outbound: "spare.outbound",
    transfer: "spare.transfer",
    adjustment: "spare.adjustment",
    scrap: "spare.scrap",
  },
  spare_unit: {
    piece: "units.piece",
    block: "units.block",
    stick: "units.stick",
    root: "units.root",
    set: "units.set",
    pair: "units.pair",
    box: "units.box",
  },
};

const EVENT_TONES: Record<AssetTimelineEvent["event_type"], "success" | "warning" | "danger" | "info"> = {
  created: "success",
  updated: "info",
  lifecycle: "warning",
  placement: "info",
  assignment: "success",
  maintenance: "warning",
  inventory: "info",
  attachment: "info",
  other: "info",
};

function eventLabel(item: AssetTimelineEvent): string {
  return t(item.title || `asset.timeline.eventTypes.${item.event_type}`);
}

function actionLabel(item: AssetTimelineEvent): string {
  const key = `asset.timeline.actions.${item.action}`;
  const translated = t(key);
  return translated === key
    ? t("asset.timeline.unknownAction", { action: item.action })
    : translated;
}

function summaryLabel(item: AssetTimelineEvent): string {
  const key = item.summary || `asset.timeline.summaries.${item.event_type}`;
  return t(key);
}

function actorName(item: AssetTimelineEvent): string {
  return item.actor?.display_name || item.actor?.username || t("asset.timeline.systemActor");
}

function fieldLabel(change: AssetTimelineChange): string {
  if (change.label) return change.label;
  if (change.field.startsWith("custom:")) return change.field.slice("custom:".length);
  const key = FIELD_LABEL_KEYS[change.field];
  return key ? t(key) : change.field;
}

function formatValue(value: unknown, field: string): string {
  if (value === null || value === undefined || value === "") return t("common.notAvailable");
  if (typeof value === "string") {
    const key = ENUM_LABEL_KEYS[field]?.[value];
    if (key) return t(key);
  }
  if (field === "status") return statusLabel(String(value));
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (Array.isArray(value)) return value.map((item) => formatValue(item, field)).join("、");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.values(record).slice(0, 4).map((item) => String(item ?? "")).filter(Boolean).join(" / ") || t("common.notAvailable");
  }
  return String(value);
}

function formatDateTime(value: string): string {
  return formatSystemDateTime(value) || value;
}

function disposalMetadata(item: AssetTimelineEvent): Record<string, unknown> | null {
  const value = item.metadata?.disposal;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function formatDisposalValue(key: string, value: unknown): string {
  if (key === "disposed_on" && value) return formatSystemDate(String(value)) || String(value);
  return formatValue(value, key);
}

function formatChange(change: AssetTimelineChange): string {
  return `${formatValue(change.before, change.field)} → ${formatValue(change.after, change.field)}`;
}

function retry() {
  void context.retryAssetAudit();
}

function changePage(page: number) {
  void context.changeAssetAuditPage(page);
}

function changePageSize(size: number) {
  void context.changeAssetAuditPageSize(size);
}
</script>

<template>
  <DetailSection
    class="asset-audit-history asset-timeline"
    :title="t('asset.history')"
    :summary="t('units.item', context.assetAuditTotal.value)"
    :collapsible="collapsible"
  >
    <ResourceState
      :loading="loading"
      :error="error"
      :empty="empty"
      :empty-text="t('asset.timelineEmpty')"
      @retry="retry"
    >
      <PagedTable
        :total="context.assetAuditTotal.value"
        :current-page="context.assetAuditPage.value"
        :page-size="context.assetAuditPageSize.value"
        :page-sizes="[20, 50, 100]"
        :disabled="loading"
        hide-on-single-page
        @update:current-page="changePage"
        @update:page-size="changePageSize"
      >
        <el-timeline class="asset-timeline__list">
          <el-timeline-item
            v-for="item in items"
            :key="item.id"
            :timestamp="formatDateTime(item.timestamp)"
            placement="top"
          >
            <article class="asset-timeline__event">
              <div class="asset-timeline__heading">
                <strong>{{ eventLabel(item) }}</strong>
                <el-tag size="small" :type="EVENT_TONES[item.event_type]">
                  {{ actionLabel(item) }}
                </el-tag>
              </div>
              <p class="asset-timeline__summary">{{ summaryLabel(item) }}</p>
              <div v-if="disposalMetadata(item)" class="asset-timeline__disposal">
                <span>{{ t("asset.disposedOn") }} · {{ formatDisposalValue("disposed_on", disposalMetadata(item)?.disposed_on) }}</span>
                <span>{{ t("asset.disposalReason") }} · {{ formatDisposalValue("reason", disposalMetadata(item)?.reason) }}</span>
                <span>{{ t("asset.disposalMethod") }} · {{ formatDisposalValue("method", disposalMetadata(item)?.method) }}</span>
                <span>{{ t("asset.disposalOperator") }} · {{ formatDisposalValue("operator_name", disposalMetadata(item)?.operator_name) }}</span>
              </div>
              <div v-if="item.changes.length === 1" class="asset-timeline__change">
                <span>{{ fieldLabel(item.changes[0]) }}</span>
                <strong>{{ formatChange(item.changes[0]) }}</strong>
              </div>
              <el-collapse v-else-if="item.changes.length > 1" class="asset-timeline__changes">
                <el-collapse-item :name="String(item.id)">
                  <template #title>
                    {{ t("asset.timeline.changeCount", { count: item.changes.length }) }}
                  </template>
                  <div v-for="change in item.changes" :key="`${item.id}-${change.field}`" class="asset-timeline__change">
                    <span>{{ fieldLabel(change) }}</span>
                    <strong>{{ formatChange(change) }}</strong>
                  </div>
                </el-collapse-item>
              </el-collapse>
              <div class="asset-timeline__meta">
                <span>{{ t("settings.actor") }} · {{ actorName(item) }}</span>
                <time :datetime="item.timestamp">{{ formatDateTime(item.timestamp) }}</time>
              </div>
            </article>
          </el-timeline-item>
        </el-timeline>
      </PagedTable>
    </ResourceState>
  </DetailSection>
</template>

<style scoped>
.asset-timeline__list {
  margin: 4px 0 0;
  padding-left: 4px;
}

.asset-timeline__event {
  min-width: 0;
  padding: 0 0 12px;
  overflow-wrap: anywhere;
}

.asset-timeline__heading,
.asset-timeline__meta,
.asset-timeline__change {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: baseline;
}

.asset-timeline__heading strong {
  font-weight: 600;
}

.asset-timeline__summary {
  margin: 6px 0;
  color: var(--el-text-color-regular);
}

.asset-timeline__change {
  justify-content: space-between;
  padding: 5px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.asset-timeline__change span,
.asset-timeline__meta {
  color: var(--el-text-color-secondary);
}

.asset-timeline__change strong {
  max-width: 72%;
  text-align: right;
  font-weight: 500;
}

.asset-timeline__changes {
  margin: 4px 0 8px;
  border-top: 0;
  border-bottom: 0;
}

.asset-timeline__meta {
  margin-top: 8px;
  font-size: 12px;
}

.asset-timeline__disposal {
  display: grid;
  gap: 4px;
  margin: 8px 0;
  padding: 8px 10px;
  border-left: 3px solid var(--el-color-warning);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 13px;
}
</style>
