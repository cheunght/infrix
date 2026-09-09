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
    <div class="rack-list-paged-table">
      <div class="resource-list-area">
        <ResourceState
          :loading="rackListLoading && !visibleRacks.length"
          :error="rackListError"
          :empty="!visibleRacks.length"
          :empty-text="emptyDescription"
          @retry="retryRackView"
        >
          <div class="rack-list-rows" v-loading="rackListLoading" :aria-label="t('rack.list')">
            <button
              v-for="rack in visibleRacks"
              :key="rack.id"
              type="button"
              class="rack-list-row"
              :class="{ 'is-current': focusedRack?.id === rack.id }"
              :aria-label="`${rack.code}, ${rackStatusLabel(rackStatus(rack), rack.is_active)}, ${t('rack.usedU')} ${rackUsedU(rack)} / ${rack.total_u} U, ${t('rack.utilization')} ${rackUtilization(rack)}%`"
              :aria-pressed="focusedRack?.id === rack.id"
              @click="selectRack(rack)"
            >
              <span class="rack-list-row__main">
                <strong class="rack-list-row__code" :title="rack.code">{{ rack.code }}</strong>
                <span class="rack-list-row__status">
                  <StatusTag
                    size="small"
                    :tone="rackStatusTone(rackStatus(rack), rack.is_active)"
                    :label="rackStatusLabel(rackStatus(rack), rack.is_active)"
                  />
                </span>
                <span class="rack-list-row__capacity">{{ rackUsedU(rack) }} / {{ rack.total_u }} U</span>
                <span class="rack-list-row__utilization">{{ rackUtilization(rack) }}%</span>
              </span>
            </button>
          </div>
        </ResourceState>
      </div>
      <div v-if="rackCount > rackPageSize" class="paged-table__footer">
        <el-pagination
          :current-page="rackPage"
          :disabled="rackListLoading"
          :page-size="rackPageSize"
          :total="rackCount"
          layout="total, prev, pager, next"
          size="small"
          @current-change="changeRackPage"
        />
      </div>
    </div>
  </el-card>
</template>
