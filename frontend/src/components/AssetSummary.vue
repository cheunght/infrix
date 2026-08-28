<script setup lang="ts">
import { computed } from "vue";
import { statusLabel, statusTone } from "../status";
import StatusTag from "./StatusTag.vue";

export type AssetSummaryAsset = {
  asset_no: string;
  name?: string | null;
  asset_name?: string | null;
  device_type_name?: string | null;
  manufacturer_name?: string | null;
  status?: string | null;
  status_label?: string | null;
  serial_number?: string | null;
  data_center?: string | null;
  server_room?: string | null;
  rack_code?: string | null;
  u_range?: string | null;
  location?: string | null;
  location_label?: string | null;
  rack_allocation?: {
    data_center?: string | null;
    server_room?: string | null;
    rack_code?: string | null;
    start_u?: number | null;
    end_u?: number | null;
  } | null;
};

const props = withDefaults(
  defineProps<{
    asset: AssetSummaryAsset;
    compact?: boolean;
    showStatus?: boolean;
    showLocation?: boolean;
  }>(),
  {
    compact: false,
    showStatus: true,
    showLocation: false,
  },
);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

type NormalizedAssetSummary = {
  assetNo: string;
  name: string;
  type: string;
  manufacturer: string;
  status: string;
  statusLabel: string;
  serialNumber: string;
  location: string;
};

function normalizeAssetSummary(asset: AssetSummaryAsset): NormalizedAssetSummary {
  const rack = asset.rack_allocation;
  const dataCenter = text(rack?.data_center || asset.data_center);
  const room = text(rack?.server_room || asset.server_room);
  const rackCode = text(rack?.rack_code || asset.rack_code);
  const uRange = text(asset.u_range) || (
    rack?.start_u != null && rack?.end_u != null ? `U${rack.start_u}–U${rack.end_u}` : ""
  );
  const status = text(asset.status);

  return {
    assetNo: text(asset.asset_no),
    name: text(asset.name || asset.asset_name) || "未命名资产",
    type: text(asset.device_type_name),
    manufacturer: text(asset.manufacturer_name),
    status,
    statusLabel: text(asset.status_label) || statusLabel(status),
    serialNumber: text(asset.serial_number),
    location: text(asset.location_label || asset.location) || [dataCenter, room, rackCode, uRange].filter(Boolean).join(" / "),
  };
}

const normalizedAsset = computed(() => normalizeAssetSummary(props.asset));
const primaryText = computed(() => [normalizedAsset.value.assetNo, normalizedAsset.value.name].filter(Boolean).join(" · "));
const secondaryText = computed(() => [
  normalizedAsset.value.type,
  normalizedAsset.value.manufacturer,
  normalizedAsset.value.serialNumber ? `SN：${normalizedAsset.value.serialNumber}` : "",
].filter(Boolean).join(" · "));
const hasStatus = computed(() => Boolean(props.showStatus && normalizedAsset.value.status));
</script>

<template>
  <div class="asset-summary" :class="{ 'asset-summary--compact': compact }">
    <div class="asset-summary__primary">
      <strong :title="primaryText">{{ primaryText }}</strong>
    </div>
    <div v-if="secondaryText || hasStatus" class="asset-summary__secondary">
      <span v-if="secondaryText" :title="secondaryText">{{ secondaryText }}</span>
      <StatusTag v-if="hasStatus" size="small" :tone="statusTone(normalizedAsset.status)" :label="normalizedAsset.statusLabel" />
    </div>
    <div v-if="showLocation && normalizedAsset.location" class="asset-summary__location" :title="normalizedAsset.location">
      位置：{{ normalizedAsset.location }}
    </div>
  </div>
</template>

<style scoped>
.asset-summary {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-soft, #edf1f6);
  border-radius: var(--el-border-radius-base, 4px);
  background: var(--color-surface, #fff);
}

.asset-summary--compact {
  padding: 8px 10px;
}

.asset-summary__primary,
.asset-summary__secondary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.asset-summary__primary strong,
.asset-summary__secondary span,
.asset-summary__location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-summary__primary strong {
  color: var(--color-text-primary, #172033);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.asset-summary__secondary,
.asset-summary__location {
  color: var(--color-text-secondary, #536481);
  font-size: 12px;
  line-height: 18px;
}

.asset-summary__secondary .status-tag {
  flex: 0 0 auto;
}
</style>
