<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Close } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { AssetDetail } from "../types";
import type { RackInspectorContext } from "../page-context";

const props = defineProps<{ context: RackInspectorContext }>();
const { t } = useI18n();
const { rackDetailOpen, detailAsset, detailLoading, detailError, retryAssetDetail, closeAssetDetail } = props.context;
const displayedAsset = ref<AssetDetail | null>(detailAsset.value);

watch(detailAsset, (asset) => {
  if (asset) displayedAsset.value = asset;
});

watch(rackDetailOpen, (open) => {
  if (!open) displayedAsset.value = null;
}, { immediate: true });
</script>

<template>
  <el-card v-show="rackDetailOpen" class="rack-asset-inspector" shadow="never">
    <template #header>
      <div class="rack-asset-inspector__header">
        <div class="rack-asset-inspector__heading">
          <strong>{{ t('rack.assetDetails') }}</strong>
          <span>{{ detailAsset?.asset_no || t('common.loading') }}</span>
        </div>
        <el-button
          class="rack-inspector-close"
          text
          circle
          :icon="Close"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="closeAssetDetail"
        />
      </div>
    </template>
    <AssetDetailContent
      variant="rack"
      :asset="displayedAsset"
      :loading="detailLoading && !displayedAsset"
      :error="detailError"
      :retry="retryAssetDetail"
      :description-columns="1"
      :responsibility-history-context="props.context"
      :inventory-history-context="props.context"
    />
  </el-card>
</template>
