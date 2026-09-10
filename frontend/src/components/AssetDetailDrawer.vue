<!-- UX Reference: standard detail drawer. Reuse interaction patterns, not asset-specific fields. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
watch(
  () => props.asset?.id,
  () => {
    showQrDialog.value = false;
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  closed: [];
  edit: [];
}>();

const assetIdentityMeta = computed(() => {
  const asset = props.asset;
  if (!asset) return "";
  const parts = [asset.asset_no ? `${t("asset.code")} ${asset.asset_no}` : ""];
  return parts.filter(Boolean).join(" · ");
});
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    class="asset-detail-drawer"
    size="min(880px, 94vw)"
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
              {{ asset?.name || t("asset.assetDetail") }}
            </h2>
            <StatusTag
              v-if="asset"
              :tone="statusTone(asset.status)"
              :label="statusLabel(asset.status)"
            />
          </div>
          <p
            v-if="assetIdentityMeta"
            class="asset-drawer-meta"
            :title="assetIdentityMeta"
          >
            {{ assetIdentityMeta }}
          </p>
        </div>
        <div v-if="asset" class="asset-drawer-actions">
          <el-button
            v-if="canEdit"
            text
            type="primary"
            :icon="Edit"
            @click="emit('edit')"
            >{{ t("common.edit") }}</el-button
          >
          <el-button
            text
            type="primary"
            :icon="Grid"
            @click="showQrDialog = true"
            >{{ t("asset.printLabels") }}</el-button
          >
        </div>
      </div>
    </template>
    <AssetDetailContent
      :key="asset?.id ?? 'loading'"
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

<style>
.asset-detail-drawer .asset-history-record {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  padding: 16px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  overflow-wrap: anywhere;
}
.asset-detail-drawer .asset-history-record strong,
.asset-detail-drawer .asset-history-record p {
  flex-basis: 100%;
  margin: 0;
}
.asset-detail-drawer .asset-history-record strong {
  font-weight: 500;
}
.asset-detail-drawer .asset-history-record span,
.asset-detail-drawer .asset-history-record time {
  color: var(--el-text-color-secondary);
}
.asset-detail-drawer .el-drawer__header {
  margin-bottom: 0;
  padding: 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.asset-detail-drawer .el-drawer__body {
  padding: 8px 24px 24px;
}
.asset-detail-drawer .asset-drawer-heading {
  flex-wrap: wrap;
}
.asset-detail-drawer .asset-drawer-identity {
  flex: 1 1 260px;
}
.asset-detail-drawer .asset-drawer-meta {
  font-size: 12px;
  margin-top: 6px;
}
.asset-detail-drawer .detail-section-shell {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 20px 0;
}
.asset-detail-drawer .detail-section-shell--collapsible {
  padding: 0;
  border-bottom: 0;
}
.asset-detail-drawer .detail-section-shell h3 {
  font-size: 14px;
  font-weight: 600;
}
.asset-detail-drawer .el-descriptions {
  font-size: 14px;
  font-weight: 400;
}
.asset-detail-drawer .asset-responsibility-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  margin-top: 12px;
}
.asset-detail-drawer .asset-responsibility-panel__owner {
  justify-content: flex-start;
  padding: 0;
  border: 0;
  background: none;
}
.asset-detail-drawer .asset-responsibility-panel__owner strong {
  font-weight: 400;
  white-space: normal;
  overflow-wrap: anywhere;
}
.asset-detail-drawer .asset-responsibility-panel__actions {
  margin-left: auto;
}
.asset-network-list {
  display: grid;
  gap: 8px;
}
.asset-network-row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px 16px;
  padding: 10px 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.asset-network-row > * {
  min-width: 0;
}
.asset-network-row + .asset-network-row {
  border-top: 1px solid var(--el-border-color-lighter);
}
.asset-network-row__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.asset-network-row p {
  grid-column: 2 / -1;
  margin: 0;
  white-space: pre-wrap;
  color: var(--el-text-color-secondary);
}
.asset-detail-footnote,
.asset-detail-footer {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
}
.asset-detail-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  padding-top: 20px;
}
@media (max-width: 767px) {
  .asset-detail-drawer {
    width: 100% !important;
  }
  .asset-detail-drawer .el-drawer__header {
    padding: 16px;
    align-items: flex-start;
  }
  .asset-detail-drawer .el-drawer__body {
    padding: 4px 16px 16px;
  }
  .asset-detail-drawer .asset-drawer-identity {
    flex-basis: 100%;
  }
  .asset-network-row {
    grid-template-columns: 80px minmax(0, 1fr);
  }
  .asset-network-row__flags {
    grid-column: 2;
  }
  .asset-detail-drawer .asset-responsibility-panel__actions {
    margin-left: 0;
  }
}
</style>
