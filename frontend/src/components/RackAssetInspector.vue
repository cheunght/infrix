<script setup lang="ts">
import { inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowLeft, Close } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { AssetDetail } from "../types";
import type { RackInspectorContext } from "../page-context";
import { RackOperationsKey } from "../composables/useRackOperations";

const props = defineProps<{ context: RackInspectorContext; backToOverview?: boolean }>();
const { t } = useI18n();
const operations = inject(RackOperationsKey, null);
const { rackDetailOpen, detailAsset, detailLoading, detailError, retryAssetDetail, closeAssetDetail } = props.context;
const displayedAsset = ref<AssetDetail | null>(detailAsset.value);

watch(detailAsset, (asset) => {
  if (asset) displayedAsset.value = asset;
});

watch(detailError, (error) => { if (error) displayedAsset.value = null; });

watch(rackDetailOpen, (open) => {
  if (!open) displayedAsset.value = null;
}, { immediate: true });
</script>

<template>
  <el-card v-show="rackDetailOpen" class="rack-asset-inspector" shadow="never" :aria-busy="detailLoading">
    <template #header>
      <div class="rack-asset-inspector__header">
        <div class="rack-asset-inspector__heading">
          <strong>{{ t('rack.assetDetails') }}</strong>
          <span>{{ detailError ? t('common.dataLoadFailed') : displayedAsset?.asset_no || t('common.loading') }}</span>
        </div>
        <el-button
          class="rack-inspector-close"
          text
          circle
          :icon="backToOverview ? ArrowLeft : Close"
          :aria-label="t(backToOverview ? 'rack.backToOverview' : 'common.close')"
          :title="t(backToOverview ? 'rack.backToOverview' : 'common.close')"
          @click="operations ? operations.closeDetail() : closeAssetDetail()"
        />
      </div>
    </template>
    <div
      v-if="operations?.canManage.value && displayedAsset?.rack_allocation && !detailError"
      class="rack-placement-actions"
    >
      <el-button
        :disabled="detailLoading || operations.busy.value || displayedAsset.status === 'retired'"
        @click="operations.open('adjust', displayedAsset)"
      >{{ t('rackOps.adjust') }}</el-button>
      <el-button
        :disabled="detailLoading || operations.busy.value || displayedAsset.status === 'retired'"
        @click="operations.open('move', displayedAsset)"
      >{{ t('rackOps.move') }}</el-button>
      <el-button
        :disabled="detailLoading || operations.busy.value"
        @click="operations.open('unmount', displayedAsset)"
      >{{ t('rackOps.unmount') }}</el-button>
    </div>
    <AssetDetailContent
      variant="rack"
      :asset="displayedAsset"
      :loading="detailLoading && !displayedAsset"
      :error="detailError"
      :retry="retryAssetDetail"
      :description-columns="1"
      :responsibility-history-context="props.context"
      :inventory-history-context="props.context"
      :audit-history-context="props.context"
    />
  </el-card>
</template>
