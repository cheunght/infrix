<!-- UX Reference: standard detail drawer. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Edit, Grid } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import AssetQrDialog from "./AssetQrDialog.vue";
import type { AssetDetail } from "../types";
import type {
  AssetInventoryHistoryContext,
  AssetResponsibilityContext,
  AssetResponsibilityHistoryContext,
} from "../page-context";
import { statusLabel, statusTone } from "../status";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{
  modelValue: boolean;
  asset: AssetDetail | null;
  loading: boolean;
  error: string;
  canEdit?: boolean;
  retry?: () => void | Promise<void>;
  responsibilityContext?: AssetResponsibilityContext | null;
  responsibilityHistoryContext?: AssetResponsibilityHistoryContext | null;
  inventoryHistoryContext?: AssetInventoryHistoryContext | null;
}>();
const { t } = useI18n();
const showQrDialog = ref(false);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  closed: [];
  edit: [];
}>();

const assetIdentityMeta = computed(() => {
  const asset = props.asset;
  if (!asset) return "";
  const parts = [
    asset.asset_no ? `${t('asset.code')} ${asset.asset_no}` : "",
    asset.device_type_name ? `${t('asset.deviceType')} ${asset.device_type_name}` : "",
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
          <div class="asset-drawer-title-row">
            <h2
              class="el-drawer__title asset-drawer-title"
              :title="asset?.name || t('asset.assetDetail')"
            >
              {{ asset?.name || t('asset.assetDetail') }}
            </h2>
            <StatusTag
              v-if="asset"
              :tone="statusTone(asset.status)"
              :label="statusLabel(asset.status)"
            />
          </div>
          <p v-if="assetIdentityMeta" class="asset-drawer-meta" :title="assetIdentityMeta">{{ assetIdentityMeta }}</p>
        </div>
        <div v-if="asset" class="asset-drawer-actions">
          <el-button
            text
            type="primary"
            :icon="Grid"
            @click="showQrDialog = true"
          >{{ t('asset.generateQr') }}</el-button>
          <el-button
            v-if="canEdit"
            text
            type="primary"
            :icon="Edit"
            @click="emit('edit')"
          >{{ t('common.edit') }}</el-button>
        </div>
      </div>
    </template>
    <AssetDetailContent
      variant="drawer"
      :asset="asset"
      :loading="loading"
      :error="error"
      :retry="retry"
      :show-summary="false"
      :responsibility-context="responsibilityContext"
      :responsibility-history-context="responsibilityHistoryContext"
      :inventory-history-context="inventoryHistoryContext"
    />
  </el-drawer>
  <AssetQrDialog v-if="asset" v-model="showQrDialog" :assets="[asset]" />
</template>
