<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { RackCanvasContext } from "../types/page-context";
const { t } = useI18n();
const props = defineProps<{ context: RackCanvasContext }>();
const context = props.context;
const {
  focusedRack,
  displayedRacks,
  rackUsedU,
  rackUtilization,
  rackBodyStyle,
  rackGapUnavailable,
  rackAllocationStyle,
  openRackAssetDetail,
  detailAsset,
  rackCanvasLoading,
  rackCanvasError,
  hasRackFilters,
  resetRackFilters,
  retryRackView,
} = context;

function allocationPrimary(allocation: RackCanvasContext["displayedRacks"]["value"][number]["allocations"][number]) {
  return allocation.asset_no?.trim() || allocation.asset_name?.trim() || t("asset.unlisted");
}

function allocationMeta(allocation: RackCanvasContext["displayedRacks"]["value"][number]["allocations"][number]) {
  return [allocation.device_type_name || t("rack.unclassified"), `U${allocation.start_u}–U${allocation.end_u}`].join(" · ");
}

function allocationTooltip(allocation: RackCanvasContext["displayedRacks"]["value"][number]["allocations"][number]) {
  return [allocationPrimary(allocation), allocationMeta(allocation)].join(" · ");
}

function rackUnitNumber(totalU: number, rowIndex: number) {
  return totalU - rowIndex + 1;
}

function rackUnitLabel(totalU: number, rowIndex: number) {
  return String(rackUnitNumber(totalU, rowIndex));
}

function isMajorUnit(totalU: number, rowIndex: number) {
  const unit = rackUnitNumber(totalU, rowIndex);
  return unit % 5 === 0 || unit === 1;
}
</script>

<template>
  <section class="rack-layout-panel">
    <div v-if="rackCanvasLoading" class="rack-panel-state" role="status" aria-live="polite">
      <el-skeleton :rows="8" animated />
    </div>
    <div v-else-if="rackCanvasError" class="rack-panel-state rack-panel-error" role="alert">
      <strong>{{ t('rack.rackLoadFailed') }}</strong>
      <span>{{ rackCanvasError }}</span>
      <el-button type="primary" plain @click="retryRackView">{{ t('common.retry') }}</el-button>
    </div>
    <div
      v-else-if="displayedRacks.length"
      class="rack-u-stage"
    >
      <el-card
        v-for="rack in displayedRacks"
        :id="`rack-view-${rack.id}`"
        :key="rack.id"
        class="rack-u-card"
        shadow="never"
        :class="{ active: focusedRack?.id === rack.id }"
      >
        <template #header>
          <div class="rack-u-head">
            <strong>{{ rack.code }}</strong>
            <span class="rack-u-head__capacity">
              {{ rackUsedU(rack) }} / {{ rack.total_u }} U · {{ rackUtilization(rack) }}%
            </span>
          </div>
        </template>
        <div class="rack-body-scroll">
          <div class="rack-body" :style="rackBodyStyle(rack)">
            <div class="rack-u-scale" aria-hidden="true">
              <span
                v-for="u in rack.total_u"
                :key="u"
                class="rack-u-mark"
                :class="{ 'rack-u-mark--major': isMajorUnit(rack.total_u, u) }"
              >{{ rackUnitLabel(rack.total_u, u) }}</span>
            </div>
            <div class="rack-slot-area" :aria-label="`${rack.code} ${t('rack.uPosition')}`">
              <div class="rack-slot-grid" aria-hidden="true">
                <span
                  v-for="u in rack.total_u"
                  :key="u"
                  class="rack-slot-row"
                  :class="{
                    'rack-slot-row--unavailable': rackGapUnavailable(rack, rackUnitNumber(rack.total_u, u)),
                    'rack-slot-row--major': isMajorUnit(rack.total_u, u),
                  }"
                />
              </div>
              <div class="rack-device-layer">
                <div
                  v-for="allocation in rack.allocations"
                  :key="allocation.asset"
                  class="rack-device-slot"
                  :style="rackAllocationStyle(rack, allocation)"
                >
                  <span class="rack-device-tooltip">
                    <el-tooltip
                      :content="allocationTooltip(allocation)"
                      placement="top"
                    >
                      <el-button
                        text
                        native-type="button"
                        class="device"
                        :class="{ 'device-selected': detailAsset?.id === allocation.asset, 'rack-device--one-u': allocation.units === 1 }"
                        :aria-label="`${allocationPrimary(allocation)}，${allocationMeta(allocation)}`"
                        @click.stop="openRackAssetDetail(allocation.asset, rack.id)"
                      >
                        <span class="rack-device__content">
                          <span class="rack-device__primary">{{ allocationPrimary(allocation) }}</span>
                          <span v-if="allocation.units >= 2" class="rack-device__meta">{{ allocationMeta(allocation) }}</span>
                        </span>
                      </el-button>
                    </el-tooltip>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-card>
    </div>
    <div v-else class="rack-panel-empty">
      <el-empty :description="hasRackFilters ? t('rack.noMatchingRacks') : t('rack.noRack')" />
      <el-button v-if="hasRackFilters" link type="primary" @click="resetRackFilters">{{ t('common.clearFilters') }}</el-button>
    </div>
  </section>
</template>
