<!-- UX Reference: standard detail drawer. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed } from "vue";
import { Edit } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { AssetDetail } from "../types";
import { statusLabel, statusTone } from "../status";
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

const assetIdentityMeta = computed(() => {
  const asset = props.asset;
  if (!asset) return "";
  const parts = [
    asset.asset_no ? `资产编号 ${asset.asset_no}` : "",
    asset.device_type_name ? `设备类型 ${asset.device_type_name}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
});
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    class="asset-detail-drawer"
    size="min(780px, 92vw)"
    show-close
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header>
      <div class="asset-drawer-heading">
        <div class="asset-drawer-identity">
          <span class="asset-drawer-kicker">资产详情</span>
          <div class="asset-drawer-title-row">
            <h2 class="el-drawer__title">{{ asset?.name || "资产详情" }}</h2>
            <StatusTag
              v-if="asset"
              :tone="statusTone(asset.status)"
              :label="statusLabel(asset.status)"
            />
          </div>
          <p v-if="assetIdentityMeta" class="asset-drawer-meta">{{ assetIdentityMeta }}</p>
        </div>
        <div v-if="canEdit && asset" class="asset-drawer-actions">
          <el-button
            text
            type="primary"
            :icon="Edit"
            @click="emit('edit')"
          >编辑</el-button>
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
