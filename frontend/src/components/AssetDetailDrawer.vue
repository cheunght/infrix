<!-- UX Reference: standard detail drawer. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed } from "vue";
import { Close, Edit } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { AssetDetail } from "../types";
import { statusLabel } from "../status";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{
  modelValue: boolean;
  asset: AssetDetail | null;
  loading: boolean;
  error: string;
  canEdit?: boolean;
  retry?: () => void | Promise<void>;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  closed: [];
  edit: [];
}>();

function cleanText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function textParts(values: unknown[]): string[] {
  return values.map(cleanText).filter(Boolean);
}

function positionText(asset: AssetDetail | null): string {
  if (!asset) return "";
  const rack = asset.rack_allocation;
  const dataCenter = rack?.data_center || asset.asset_data_center_name || asset.data_center;
  const parts = rack
    ? textParts([dataCenter, rack.server_room, rack.rack_code])
    : textParts([dataCenter]);
  const hasU = rack && rack.start_u != null && rack.end_u != null;
  const uText = hasU
    ? `U${rack.start_u}–U${rack.end_u}${rack.units ? ` (${rack.units}U)` : ""}`
    : "";
  if (uText) return parts.length ? `${parts.join(" / ")} · ${uText}` : uText;
  return parts.join(" / ") || "未上架";
}

const assetIdentityMeta = computed(() => {
  const asset = props.asset;
  return asset ? textParts([asset.asset_no, asset.device_type_name || asset.asset_type]).join(" · ") : "";
});
const assetLocation = computed(() => positionText(props.asset));
const assetOwner = computed(() => cleanText(props.asset?.owner_name));
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    class="asset-detail-drawer"
    size="min(640px, 92vw)"
    :show-close="false"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header>
      <div class="asset-drawer-heading">
        <div class="asset-drawer-identity">
          <span class="asset-drawer-kicker">资产详情</span>
          <div class="asset-drawer-title-row">
            <h2>{{ asset?.name || "资产详情" }}</h2>
            <StatusTag
              v-if="asset"
              :status="asset.status"
              :label="statusLabel(asset.status)"
            />
          </div>
          <p v-if="assetIdentityMeta" class="asset-drawer-meta">{{ assetIdentityMeta }}</p>
          <div v-if="asset" class="asset-drawer-context">
            <div class="asset-drawer-context-row">
              <span>当前位置</span>
              <strong :title="assetLocation">{{ assetLocation }}</strong>
            </div>
            <div v-if="assetOwner" class="asset-drawer-context-row">
              <span>使用人</span>
              <strong>{{ assetOwner }}</strong>
            </div>
          </div>
        </div>
        <div class="asset-drawer-actions">
          <el-button
            v-if="canEdit && asset"
            text
            type="primary"
            :icon="Edit"
            @click="emit('edit')"
          >编辑</el-button>
          <el-button
            text
            circle
            class="asset-drawer-close"
            aria-label="关闭资产详情"
            title="关闭资产详情"
            @click="emit('update:modelValue', false)"
          >
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
      </div>
    </template>
    <AssetDetailContent
      :asset="asset"
      :loading="loading"
      :error="error"
      :retry="retry"
      :show-summary="false"
    />
  </el-drawer>
</template>
