<script setup lang="ts">
import { Close } from "@element-plus/icons-vue";
import AssetDetailContent from "./AssetDetailContent.vue";
import type { AssetDetail } from "../types";

defineProps<{
  modelValue: boolean;
  asset: AssetDetail | null;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  closed: [];
}>();
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    class="asset-detail-drawer"
    size="520px"
    :show-close="false"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header>
      <div class="asset-drawer-heading">
        <div>
          <span class="asset-drawer-kicker">资产详情</span>
          <h2>{{ asset?.asset_no || "加载中" }}</h2>
          <p>{{ asset?.name || "正在读取资产信息" }}</p>
        </div>
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
    </template>
    <AssetDetailContent :asset="asset" :loading="loading" :error="error" />
  </el-drawer>
</template>
