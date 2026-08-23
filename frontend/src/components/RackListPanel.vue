<script setup lang="ts">
import { computed } from "vue";
import type { Rack } from "../types";
import type { RackListContext } from "../types/page-context";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{ context: RackListContext & {
  selectedRack?: { value: string };
  selectedRoom?: { value: string };
} }>();
const context = props.context;
const {
  visibleRacks,
  focusedRack,
  selectRack,
  rackUtilization,
  rackUtilizationColor,
  rackUsedU,
  rackCount,
  rackPage,
  rackPageSize,
  changeRackPage,
  rackListLoading,
  rackListError,
  retryRackView,
  selectedRack,
  selectedRoom,
} = context;

const emptyDescription = computed(() => {
  if (selectedRack?.value.trim()) return "没有符合条件的机柜";
  if (selectedRoom?.value) return "当前机房暂无机柜";
  return "暂无机房";
});

function rackStatus(rack: Rack) {
  return rack.status || (rack.is_active === false ? "disabled" : "in_use");
}

function rackStatusLabel(rack: Rack) {
  return rack.status_label || ({ in_use: "使用中", reserved: "预留", disabled: "停用" }[rackStatus(rack)] || "使用中");
}
</script>

<template>
  <el-card class="resource-panel resource-master-panel rack-list-panel" shadow="never">
    <template #header>
      <div class="resource-panel-header">
        <div class="resource-panel-heading">
          <strong>机柜</strong>
          <span>共 {{ rackCount }} 个</span>
        </div>
      </div>
    </template>
    <div class="resource-list-area">
      <div v-if="rackListLoading" class="resource-panel-state" role="status" aria-live="polite">
        <el-skeleton :rows="5" animated />
      </div>
      <div v-else-if="rackListError" class="resource-panel-state resource-panel-error" role="alert">
        <strong>机柜加载失败</strong>
        <span>{{ rackListError }}</span>
        <el-button type="primary" plain @click="retryRackView">重新加载</el-button>
      </div>
      <div v-else-if="visibleRacks.length" class="rack-list" role="listbox" aria-label="机柜列表">
        <button
          v-for="rack in visibleRacks"
          :key="rack.id"
          type="button"
          class="rack-list-item resource-list-item"
          :class="{ active: focusedRack?.id === rack.id }"
          :aria-current="focusedRack?.id === rack.id ? 'true' : undefined"
          :title="`${rack.server_room_name || rack.data_center_name || '未知位置'} · ${rack.code}${rack.name ? ` · ${rack.name}` : ''}`"
          @click="selectRack(rack)"
        >
          <div class="rack-list-row">
            <strong>{{ rack.code }}<small v-if="rack.name"> · {{ rack.name }}</small></strong>
            <StatusTag :status="rackStatus(rack)" :label="rackStatusLabel(rack)" />
          </div>
          <div class="rack-list-room" :title="`${rack.data_center_name || '—'} · ${rack.server_room_name || '—'}`">
            {{ rack.data_center_name || "—" }} · {{ rack.server_room_name || "—" }}
          </div>
          <div class="rack-list-usage">
            <span>{{ rackUsedU(rack) }}/{{ rack.total_u }} U · {{ rackUtilization(rack) }}%</span>
            <span>{{ rack.allocations.length }} 台设备</span>
          </div>
          <div class="rack-util-track" aria-hidden="true">
            <i
              :style="{
                width: `${rackUtilization(rack)}%`,
                background: rackUtilizationColor(rack),
              }"
            />
          </div>
        </button>
      </div>
      <div v-else class="resource-panel-empty">
        <el-empty :image-size="56" :description="emptyDescription" />
      </div>
    </div>
    <el-pagination
      v-if="rackCount > rackPageSize"
      v-model:current-page="rackPage"
      class="resource-pagination"
      size="small"
      layout="total, prev, pager, next"
      :page-size="rackPageSize"
      :total="rackCount"
      @current-change="changeRackPage"
    />
  </el-card>
</template>
