<script setup lang="ts">
import { Close } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { RackInspectorContext } from "../types/page-context";

const props = defineProps<{ context: RackInspectorContext }>();
const { rackDetailOpen, detailAsset, detailLoading, detailError, retryAssetDetail, closeAssetDetail } = props.context;
</script>

<template>
  <el-card v-if="rackDetailOpen" class="rack-asset-inspector" shadow="never">
    <div class="drawer-header">
      <div>
        <small>资产详情</small>
        <h2>{{ detailAsset?.asset_no || "加载中" }}</h2>
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
    <AssetDetailContent
      :asset="detailAsset"
      :loading="detailLoading"
      :error="detailError"
      :retry="retryAssetDetail"
    />
  </el-card>
</template>
