<!-- UX Reference: standard detail drawer. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { Close, Edit } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { AssetDetail } from "../types";
import { statusLabel } from "../status";
import StatusTag from "./StatusTag.vue";

defineProps<{
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
          <p v-if="asset">{{ asset.asset_no }}</p>
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
