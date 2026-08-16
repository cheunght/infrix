<script setup lang="ts">
const props = defineProps<{ context: Record<string, any> }>();
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
  changeRackPageSize,
} = props.context;
</script>

<template>
  <el-card class="rack-list-panel" shadow="never">
    <div class="rack-view-panel-title">
      <div>
        <h2>机柜列表</h2>
        <span>{{ visibleRacks.length }} 个机柜</span>
      </div>
    </div>
    <div v-if="visibleRacks.length" class="rack-list">
      <button
        v-for="rack in visibleRacks"
        :key="rack.id"
        type="button"
        class="rack-list-item"
        :class="{ active: focusedRack?.id === rack.id }"
        :aria-current="focusedRack?.id === rack.id ? 'true' : undefined"
        @click="selectRack(rack)"
      >
        <div class="rack-list-row">
          <strong>{{ rack.code }}</strong>
          <span :style="{ color: rackUtilizationColor(rack) }">{{ rackUtilization(rack) }}%</span>
        </div>
        <div class="rack-util-track">
          <i
            :style="{
              width: `${rackUtilization(rack)}%`,
              background: rackUtilizationColor(rack),
            }"
          />
        </div>
        <small>
          {{ rack.server_room_name || "—" }} · {{ rackUsedU(rack) }}/{{ rack.total_u }} U
        </small>
      </button>
    </div>
    <el-empty v-else class="rack-list-empty" description="暂无符合筛选条件的机柜" />
    <el-pagination
      v-model:current-page="rackPage"
      v-model:page-size="rackPageSize"
      class="rack-list-pagination"
      small
      layout="total, sizes, prev, next"
      :total="rackCount"
      :page-sizes="[20, 50, 100]"
      @current-change="changeRackPage"
      @size-change="changeRackPageSize"
    />
  </el-card>
</template>
