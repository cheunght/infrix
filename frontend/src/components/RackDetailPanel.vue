<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatSystemDate } from "../system-settings";
import type { Rack } from "../types";
import { rackStatusLabel, rackStatusTone, rackStatusValue } from "../business-enums";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{
  rack: Rack;
  usedU: number;
  utilization: number;
  utilizationColor: string;
}>();
const { t } = useI18n();

const rackStatus = computed(() => rackStatusValue(props.rack.status, props.rack.is_active));
const statusLabel = computed(() => rackStatusLabel(rackStatus.value, props.rack.is_active));
const statusTone = computed(() => rackStatusTone(rackStatus.value, props.rack.is_active));
const locationLabel = computed(() =>
  [props.rack.data_center_name, props.rack.server_room_name].filter(Boolean).join(" / ") || t("common.notAvailable"),
);
const freeU = computed(() => props.rack.free_u ?? Math.max(props.rack.total_u - props.usedU, 0));
const assetsCount = computed(() => props.rack.assets_count ?? props.rack.allocations.length);

function displayValue(value?: string | null) {
  return value?.trim() || t("common.notAvailable");
}

function formatDate(value?: string) {
  if (!value) return t("common.notAvailable");
  return formatSystemDate(value) || t("common.notAvailable");
}
</script>

<template>
  <el-card class="rack-summary-panel" shadow="never">
    <template #header>
      <div class="rack-summary-panel__header">
        <strong>{{ t('rack.rackDetails') }}</strong>
      </div>
    </template>

    <el-descriptions class="rack-summary-descriptions" :column="1">
      <el-descriptions-item :label="t('rack.rackCode')">{{ rack.code }}</el-descriptions-item>
      <el-descriptions-item :label="t('rack.rackName')">{{ displayValue(rack.name) }}</el-descriptions-item>
      <el-descriptions-item :label="t('common.location')">
        <span class="rack-summary-value rack-summary-value--ellipsis" :title="locationLabel">{{ locationLabel }}</span>
      </el-descriptions-item>
      <el-descriptions-item :label="t('common.type')">{{ displayValue(rack.rack_type) }}</el-descriptions-item>
      <el-descriptions-item :label="t('rack.totalU')">{{ rack.total_u }} U</el-descriptions-item>
      <el-descriptions-item :label="t('rack.usedU')">{{ usedU }} U</el-descriptions-item>
      <el-descriptions-item :label="t('rack.availableU')">{{ freeU }} U</el-descriptions-item>
      <el-descriptions-item :label="t('rack.utilization')">
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
      <el-descriptions-item :label="t('rack.assetCount')">{{ t('common.deviceCount', assetsCount) }}</el-descriptions-item>
      <el-descriptions-item :label="t('common.status')">
        <StatusTag :tone="statusTone" :label="statusLabel" />
      </el-descriptions-item>
      <el-descriptions-item :label="t('rack.owner')">{{ displayValue(rack.owner_name) }}</el-descriptions-item>
      <el-descriptions-item :label="t('rack.createdAt')">{{ formatDate(rack.created_at) }}</el-descriptions-item>
      <el-descriptions-item :label="t('common.updatedAt')">{{ formatDate(rack.updated_at) }}</el-descriptions-item>
      <el-descriptions-item :label="t('common.notes')">
        <span class="rack-summary-value rack-summary-value--notes">{{ displayValue(rack.notes) }}</span>
      </el-descriptions-item>
    </el-descriptions>
  </el-card>
</template>
