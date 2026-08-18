<script setup lang="ts">
const props = defineProps<{ context: Record<string, any> }>();
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
} = props.context;
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
    <div
      v-if="displayedRacks.length"
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
          `rack-status-${rack.status || (rack.is_active === false ? 'disabled' : 'in_use')}`,
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
          <button
            v-for="allocation in rack.allocations"
            :key="allocation.asset"
            type="button"
            class="device"
            :class="{ 'device-selected': detailAsset?.id === allocation.asset }"
            :style="rackAllocationStyle(rack, allocation)"
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
    <el-empty v-else description="暂无符合筛选条件的机柜" />
  </el-card>
</template>
