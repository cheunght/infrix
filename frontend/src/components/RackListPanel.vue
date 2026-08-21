<script setup lang="ts">
import type { Rack } from "../types";
import type { RackListContext } from "../types/page-context";
import StatusTag from "./StatusTag.vue";
const props = defineProps<{ context: RackListContext }>();
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
  changeRackPage,
  rackListLoading,
  rackListError,
  hasRackFilters,
  resetRackFilters,
  retryRackView,
} = context;

function rackStatus(rack: Rack) {
  return rack.status || (rack.is_active === false ? "disabled" : "in_use");
}

function rackStatusLabel(rack: Rack) {
  return rack.status_label || ({ in_use: "使用中", reserved: "预留", disabled: "停用" }[rackStatus(rack)] || "使用中");
}
</script>

<template>
  <el-card class="rack-list-panel" shadow="never">
    <div class="rack-view-panel-title">
      <div>
        <h2>机柜列表</h2>
        <span>共 {{ rackCount }} 个机柜</span>
      </div>
    </div>
    <div v-if="rackListLoading" class="rack-panel-state" role="status" aria-live="polite">
      <el-skeleton :rows="5" animated />
    </div>
    <div v-else-if="rackListError" class="rack-panel-state rack-panel-error" role="alert">
      <strong>机柜数据加载失败</strong>
      <span>{{ rackListError }}</span>
      <el-button type="primary" plain @click="retryRackView">重新加载</el-button>
    </div>
    <div v-else-if="visibleRacks.length" class="rack-list">
      <button
        v-for="rack in visibleRacks"
        :key="rack.id"
        type="button"
        class="rack-list-item"
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
        <div class="rack-util-track">
          <i
            :style="{
              width: `${rackUtilization(rack)}%`,
              background: rackUtilizationColor(rack),
            }"
          />
        </div>
        <div class="rack-list-usage">
          <span>{{ rackUsedU(rack) }}/{{ rack.total_u }} U</span>
          <span>{{ rackUtilization(rack) }}%</span>
        </div>
      </button>
    </div>
    <div v-else class="rack-panel-empty">
      <el-empty
        class="rack-list-empty"
        :description="hasRackFilters ? '没有符合筛选条件的机柜' : '暂无机柜'"
      />
      <el-button v-if="hasRackFilters" link type="primary" @click="resetRackFilters">清除筛选</el-button>
    </div>
    <el-pagination
      v-model:current-page="rackPage"
      class="rack-list-pagination"
      small
      layout="total, prev, pager, next"
      :total="rackCount"
      @current-change="changeRackPage"
    />
  </el-card>
</template>
