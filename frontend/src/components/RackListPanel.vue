<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Rack } from "../types";
import type { RackListContext } from "../page-context";
import StatusTag from "./StatusTag.vue";
import ResourceState from "./ResourceState.vue";
import { rackStatusLabel, rackStatusTone, rackStatusValue } from "../business-enums";

const props = defineProps<{ context: RackListContext & {
  selectedRack?: { value: string };
  selectedRoom?: { value: string };
} }>();
const { t } = useI18n();
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
  if (selectedRack?.value.trim()) return t("rack.noMatchingRacks");
  if (selectedRoom?.value) return t("rack.noRacksInRoom");
  return t("rack.noRooms");
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
          <strong>{{ t("rack.list") }}</strong>
          <span>{{ t("common.itemCount", rackCount) }}</span>
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
          :aria-label="t('rack.list')"
          @row-click="selectRack"
        >
          <el-table-column :label="t('rack.rackCode')" width="96">
            <template #default="{ row }">
              <strong class="rack-list-code">{{ row.code }}</strong>
            </template>
          </el-table-column>
          <el-table-column :label="t('common.status')" width="90" align="center">
            <template #default="{ row }">
              <StatusTag
                :tone="rackStatusTone(rackStatus(row), row.is_active)"
                :label="rackStatusLabel(rackStatus(row), row.is_active)"
              />
            </template>
          </el-table-column>
          <el-table-column :label="t('common.location')" min-width="150">
            <template #default="{ row }">
              {{ row.data_center_name || t('common.notAvailable') }} · {{ row.server_room_name || t('common.notAvailable') }}
            </template>
          </el-table-column>
          <el-table-column :label="`${t('rack.usedU')} / ${t('rack.totalU')}`" width="110" align="right">
            <template #default="{ row }">{{ rackUsedU(row) }} / {{ row.total_u }} U</template>
          </el-table-column>
          <el-table-column :label="t('rack.utilization')" width="90" align="right">
            <template #default="{ row }">{{ rackUtilization(row) }}%</template>
          </el-table-column>
          <el-table-column :label="t('rack.assetCount')" width="90" align="right">
            <template #default="{ row }">{{ t('common.deviceCount', row.allocations.length) }}</template>
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
