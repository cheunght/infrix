<script setup lang="ts">
import { computed } from "vue";
import type { Rack } from "../types";
import { rackStatusLabel, rackStatusTone, rackStatusValue } from "../business-enums";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{
  rack: Rack;
  usedU: number;
  utilization: number;
  utilizationColor: string;
}>();

const rackStatus = computed(() => rackStatusValue(props.rack.status, props.rack.is_active));
const statusLabel = computed(() => rackStatusLabel(rackStatus.value, props.rack.is_active));
const statusTone = computed(() => rackStatusTone(rackStatus.value, props.rack.is_active));
const locationLabel = computed(() =>
  [props.rack.data_center_name, props.rack.server_room_name].filter(Boolean).join(" / ") || "—",
);
const freeU = computed(() => props.rack.free_u ?? Math.max(props.rack.total_u - props.usedU, 0));
const assetsCount = computed(() => props.rack.assets_count ?? props.rack.allocations.length);

function displayValue(value?: string | null) {
  return value?.trim() || "—";
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}
</script>

<template>
  <el-card class="rack-summary-panel" shadow="never">
    <template #header>
      <div class="rack-summary-panel__header">
        <strong>机柜详情</strong>
      </div>
    </template>

    <el-descriptions class="rack-summary-descriptions" :column="1">
      <el-descriptions-item label="机柜编号">{{ rack.code }}</el-descriptions-item>
      <el-descriptions-item label="机柜名称">{{ displayValue(rack.name) }}</el-descriptions-item>
      <el-descriptions-item label="位置">
        <span class="rack-summary-value rack-summary-value--ellipsis" :title="locationLabel">{{ locationLabel }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="类型">{{ displayValue(rack.rack_type) }}</el-descriptions-item>
      <el-descriptions-item label="总 U">{{ rack.total_u }} U</el-descriptions-item>
      <el-descriptions-item label="已用 U">{{ usedU }} U</el-descriptions-item>
      <el-descriptions-item label="可用 U">{{ freeU }} U</el-descriptions-item>
      <el-descriptions-item label="使用率">
        <div class="rack-summary-utilization">
          <span>{{ utilization }}%</span>
          <el-progress
            :percentage="utilization"
            :color="utilizationColor"
            :stroke-width="5"
            :show-text="false"
          />
        </div>
      </el-descriptions-item>
      <el-descriptions-item label="资产数">{{ assetsCount }} 台</el-descriptions-item>
      <el-descriptions-item label="状态">
        <StatusTag :tone="statusTone" :label="statusLabel" />
      </el-descriptions-item>
      <el-descriptions-item label="负责人">{{ displayValue(rack.owner_name) }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ formatDate(rack.created_at) }}</el-descriptions-item>
      <el-descriptions-item label="更新时间">{{ formatDate(rack.updated_at) }}</el-descriptions-item>
      <el-descriptions-item label="备注">
        <span class="rack-summary-value rack-summary-value--notes">{{ displayValue(rack.notes) }}</span>
      </el-descriptions-item>
    </el-descriptions>
  </el-card>
</template>
