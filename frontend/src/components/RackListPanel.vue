<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Rack } from "../types";
import type { RackListContext } from "../page-context";
import StatusTag from "./StatusTag.vue";
import ResourceState from "./ResourceState.vue";
import RackHint from "./RackHint.vue";
import {
  rackStatusLabel,
  rackStatusTone,
  rackStatusValue,
} from "../business-enums";

const props = defineProps<{
  comparisonIds?: number[];
  comparisonLimit?: number;
  context: RackListContext & {
    selectedRack?: { value: string };
    selectedRoom?: { value: number | null };
  };
}>();
const emit = defineEmits<{ compare: [id: number] }>();
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
function rackSummary(rack: Rack) {
  const status = rackStatusLabel(rackStatus(rack), rack.is_active);
  return rack.occupancy_restricted
    ? `${rack.code}, ${status}, ${t("dataScope.notAuthorized")}`
    : `${rack.code}, ${status}, ${t("rack.usedU")} ${rackUsedU(rack)} / ${rack.total_u} U, ${t("rack.utilization")} ${rackUtilization(rack)}%`;
}
</script>

<template>
  <el-card
    class="resource-panel resource-master-panel rack-list-panel"
    shadow="never"
  >
    <template #header>
      <div class="resource-panel-header">
        <div class="resource-panel-heading">
          <strong>{{ t("rack.list") }}</strong>
          <span>{{ t("common.itemCount", rackCount) }}</span>
        </div>
        <slot name="actions" />
      </div>
      <slot name="comparison" />
    </template>
    <div class="rack-list-paged-table">
      <div class="resource-list-area">
        <ResourceState :error="rackListError" @retry="retryRackView">
          <div
            class="rack-list-rows"
            v-loading="rackListLoading"
            :aria-label="t('rack.list')"
          >
            <span
              v-if="rackListLoading && !visibleRacks.length"
              role="status"
              >{{ t("common.loadingData") }}</span
            >
            <el-empty
              v-else-if="!visibleRacks.length"
              :image-size="56"
              :description="emptyDescription"
            />
            <div
              v-for="rack in visibleRacks"
              :key="rack.id"
              class="rack-list-choice"
            >
              <input
                v-if="comparisonIds"
                type="checkbox"
                class="rack-comparison-checkbox"
                :checked="comparisonIds.includes(rack.id)"
                :disabled="
                  !comparisonIds.includes(rack.id) &&
                  comparisonIds.length >= (comparisonLimit || 4)
                "
                :aria-label="t('rackCompare.select', { rack: rack.code })"
                @change="emit('compare', rack.id)"
              />
              <RackHint
                :heading="rack.code"
                :subtitle="rack.name"
                placement="bottom-start"
                fit-to-anchor
                :fields="[
                  {
                    label: t('common.status'),
                    value: rackStatusLabel(rackStatus(rack), rack.is_active),
                  },
                  {
                    label: t('rack.occupancy'),
                    value: rack.occupancy_restricted
                      ? t('dataScope.notAuthorized')
                      : `${rackUsedU(rack)} / ${rack.total_u} U · ${rackUtilization(rack)}%`,
                  },
                ]"
              >
                <button
                  type="button"
                  class="rack-list-row"
                  :class="{ 'is-current': focusedRack?.id === rack.id }"
                  :aria-label="rackSummary(rack)"
                  :aria-pressed="focusedRack?.id === rack.id"
                  @click="selectRack(rack)"
                >
                  <span
                    class="rack-list-row__main"
                    :class="{
                      'rack-list-row__main--status':
                        rackStatus(rack) !== 'in_use',
                    }"
                  >
                    <strong class="rack-list-row__code">{{ rack.code }}</strong>
                    <span
                      v-if="rackStatus(rack) !== 'in_use'"
                      class="rack-list-row__status"
                    >
                      <StatusTag
                        size="small"
                        :tone="rackStatusTone(rackStatus(rack), rack.is_active)"
                        :label="
                          rackStatusLabel(rackStatus(rack), rack.is_active)
                        "
                      />
                    </span>
                    <span class="rack-list-row__capacity">{{
                      rack.occupancy_restricted
                        ? t("dataScope.notAuthorized")
                        : `${rackUsedU(rack)} / ${rack.total_u} U`
                    }}</span>
                  </span>
                </button>
              </RackHint>
            </div>
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
