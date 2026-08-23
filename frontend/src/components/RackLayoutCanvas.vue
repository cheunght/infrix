<script setup lang="ts">
import type { Rack } from "../types";
import type { RackCanvasContext } from "../types/page-context";
const props = defineProps<{ context: RackCanvasContext }>();
const context = props.context;
const {
  rackViewTitle,
  focusedRack,
  displayedRacks,
  rackDetailOpen,
  deviceTypes,
  rackUtilization,
  rackBodyStyle,
  rackGapUnavailable,
  rackAllocationStyle,
  focusedRackId,
  openRackAssetDetail,
  detailAsset,
  rackCanvasLoading,
  rackCanvasError,
  hasRackFilters,
  resetRackFilters,
  retryRackView,
} = context;

function rackStatus(rack: Rack) {
  return rack.status || (rack.is_active === false ? "disabled" : "in_use");
}
</script>

<template>
  <el-card class="rack-layout-panel" shadow="never">
    <div class="rack-layout-header">
      <div>
        <h2>{{ rackViewTitle }}</h2>
        <span v-if="focusedRack">
          {{ rackDetailOpen ? "当前设备所在机柜" : `已加载 ${displayedRacks.length} 个机柜` }}
        </span>
        <span v-else>请选择机柜查看 U 位</span>
      </div>
      <div class="category-legend rack-legend">
        <span>设备类型</span>
        <span v-for="deviceType in deviceTypes" :key="deviceType.id">
          <i :style="{ background: deviceType.color || '#1677EF' }" />{{ deviceType.name }}
        </span>
        <span><i class="default-color" />未分类</span>
        <span><i class="empty-color" />空闲 U 位</span>
      </div>
    </div>
    <div v-if="rackCanvasLoading" class="rack-panel-state" role="status" aria-live="polite">
      <el-skeleton :rows="8" animated />
    </div>
    <div v-else-if="rackCanvasError" class="rack-panel-state rack-panel-error" role="alert">
      <strong>机柜详情加载失败</strong>
      <span>{{ rackCanvasError }}</span>
      <el-button type="primary" plain @click="retryRackView">重新加载</el-button>
    </div>
    <div
      v-else-if="displayedRacks.length"
      class="rack-u-scroll"
      :class="{ 'single-rack': rackDetailOpen }"
    >
      <article
        v-for="rack in displayedRacks"
        :id="`rack-view-${rack.id}`"
        :key="rack.id"
        class="rack-u-card"
        :class="[
          { active: focusedRack?.id === rack.id },
          `rack-status-${rackStatus(rack)}`,
        ]"
        @click="focusedRackId = rack.id"
      >
        <div class="rack-u-head">
          <strong>{{ rack.code }}</strong>
          <span v-if="focusedRack?.id === rack.id" class="rack-current-tag">当前</span>
          <span>占用 {{ rackUtilization(rack) }}%</span>
        </div>
        <div class="rack-body" :style="rackBodyStyle(rack)">
          <div
            v-for="u in rack.total_u"
            :key="u"
            class="rack-row"
            :class="{
              'rack-row-unavailable': rackGapUnavailable(rack, rack.total_u - u + 1),
            }"
            >
            <b>{{ rack.total_u - u + 1 }}</b><span /><b>{{ rack.total_u - u + 1 }}</b>
          </div>
          <div v-if="!rack.allocations.length" class="rack-empty-hint">当前机柜暂无设备</div>
          <button
            v-for="allocation in rack.allocations"
            :key="allocation.asset"
            type="button"
            class="device"
            :class="{ 'device-selected': detailAsset?.id === allocation.asset }"
            :style="rackAllocationStyle(rack, allocation)"
            :aria-label="`${allocation.asset_name || allocation.asset_no}，资产编号 ${allocation.asset_no}，U${allocation.start_u} 至 U${allocation.end_u}`"
            :title="`${allocation.asset_name || allocation.asset_no} · ${allocation.asset_no} · U${allocation.start_u}–U${allocation.end_u}`"
            @click.stop="openRackAssetDetail(allocation.asset, rack.id)"
          >
            {{ allocation.asset_no }}
            <small>
              {{ allocation.asset_name }} · U{{ allocation.start_u }}–U{{ allocation.end_u }}
            </small>
          </button>
        </div>
      </article>
    </div>
    <div v-else class="rack-panel-empty">
      <el-empty :description="hasRackFilters ? '没有符合筛选条件的机柜' : '暂无机柜'" />
      <el-button v-if="hasRackFilters" link type="primary" @click="resetRackFilters">清除筛选</el-button>
    </div>
  </el-card>
</template>
