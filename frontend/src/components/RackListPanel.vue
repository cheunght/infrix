<script setup lang="ts">
import { computed } from "vue";
import type { Rack } from "../types";
import type { RackListContext } from "../types/page-context";
import StatusTag from "./StatusTag.vue";
import ResourceState from "./ResourceState.vue";
import { rackStatusLabel, rackStatusTone, rackStatusValue } from "../business-enums";

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
  return rackStatusValue(rack.status, rack.is_active);
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
      <ResourceState
        :loading="rackListLoading && !visibleRacks.length"
        :error="rackListError"
        :empty="!visibleRacks.length"
        :empty-text="emptyDescription"
        @retry="retryRackView"
      >
        <el-table
          class="rack-list-table"
          v-loading="rackListLoading"
          :data="visibleRacks"
          row-key="id"
          table-layout="fixed"
          highlight-current-row
          :current-row-key="focusedRack?.id ?? undefined"
          aria-label="机柜列表"
          @row-click="selectRack"
        >
          <el-table-column label="机柜编号" width="90">
            <template #default="{ row }">
              <strong class="rack-list-code">{{ row.code }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <StatusTag
                :tone="rackStatusTone(rackStatus(row), row.is_active)"
                :label="rackStatusLabel(rackStatus(row), row.is_active)"
              />
            </template>
          </el-table-column>
          <el-table-column label="位置" min-width="150">
            <template #default="{ row }">
              {{ row.data_center_name || "—" }} · {{ row.server_room_name || "—" }}
            </template>
          </el-table-column>
          <el-table-column label="U 使用量" width="110" align="right">
            <template #default="{ row }">{{ rackUsedU(row) }} / {{ row.total_u }} U</template>
          </el-table-column>
          <el-table-column label="使用率" width="90" align="right">
            <template #default="{ row }">{{ rackUtilization(row) }}%</template>
          </el-table-column>
          <el-table-column label="设备数" width="90" align="right">
            <template #default="{ row }">{{ row.allocations.length }} 台</template>
          </el-table-column>
        </el-table>
      </ResourceState>
    </div>
    <el-pagination
      v-if="rackCount > rackPageSize"
      :current-page="rackPage"
      :disabled="rackListLoading"
      class="resource-pagination"
      size="small"
      layout="total, prev, pager, next"
      :page-size="rackPageSize"
      :total="rackCount"
      @current-change="changeRackPage"
    />
  </el-card>
</template>
