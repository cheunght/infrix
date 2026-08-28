<script setup lang="ts">
import { ref, watch } from "vue";
import { Close } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { AssetDetail } from "../types";
import type { RackInspectorContext } from "../types/page-context";

const props = defineProps<{ context: RackInspectorContext }>();
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
          <strong>资产详情</strong>
          <span>{{ detailAsset?.asset_no || "加载中" }}</span>
        </div>
        <el-button
          class="rack-inspector-close"
          text
          circle
          :icon="Close"
          aria-label="关闭资产详情"
          title="关闭资产详情"
          @click="closeAssetDetail"
        />
      </div>
    </template>
    <AssetDetailContent
      :asset="displayedAsset"
      :loading="detailLoading && !displayedAsset"
      :error="detailError"
      :retry="retryAssetDetail"
      :description-columns="1"
    />
  </el-card>
</template>
