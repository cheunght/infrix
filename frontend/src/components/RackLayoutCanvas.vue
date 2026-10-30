<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RackReservationsKey } from "../composables/useRackReservations";
import { RackOperationsKey } from "../composables/useRackOperations";
import { useI18n } from "vue-i18n";
import type { RackCanvasContext } from "../page-context";
import type { Rack } from "../types";
import RackHint from "./RackHint.vue";
const { t } = useI18n();
const props = withDefaults(
  defineProps<{
    context: RackCanvasContext;
    racks?: Rack[];
    previewOnly?: boolean;
    appearance?: "flat" | "cabinet";
    fitToHeight?: boolean;
  }>(),
  { fitToHeight: true },
);
const context = props.context;
const operations = inject(RackOperationsKey, null);
const reservations = inject(RackReservationsKey, null);
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
const canvasRacks = computed(() => props.racks ?? displayedRacks.value);
const cabinet = computed(() => props.appearance === "cabinet");
const fitCabinet = computed(() => cabinet.value && props.fitToHeight !== false);
const canvasRoot = ref<HTMLElement>();
const plotHeight = ref(0);
let resizeObserver: ResizeObserver | undefined;
function measurePlot() {
  if (fitCabinet.value)
    plotHeight.value =
      canvasRoot.value?.querySelector<HTMLElement>(".rack-body-scroll")
        ?.clientHeight || 0;
}
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(measurePlot);
    if (canvasRoot.value) resizeObserver.observe(canvasRoot.value);
  }
  measurePlot();
});
onBeforeUnmount(() => resizeObserver?.disconnect());
watch(
  [canvasRacks, fitCabinet, rackCanvasLoading, rackCanvasError],
  measurePlot,
  { flush: "post" },
);
function unitHeight(rack: Rack) {
  return Math.max(8, plotHeight.value / Math.max(1, rack.total_u));
}
function bodyStyle(rack: Rack) {
  return fitCabinet.value
    ? {
        height: `${unitHeight(rack) * rack.total_u}px`,
        "--rack-total-u": String(rack.total_u),
        "--rack-u-height": `${unitHeight(rack)}px`,
      }
    : rackBodyStyle(rack);
}
function blockHeight(rack: Rack, units: number) {
  if (!cabinet.value) return Infinity;
  const rowHeight = fitCabinet.value
    ? unitHeight(rack)
    : Number.parseFloat(String(rackBodyStyle(rack)["--rack-u-height"]));
  return rowHeight * units;
}
function revealSelectedDevice() {
  const device =
    canvasRoot.value?.querySelector<HTMLElement>(".device-selected");
  const viewport = device?.closest<HTMLElement>(".rack-body-scroll");
  if (!device || !viewport || !viewport.clientHeight) return;
  const block = device.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  if (block.top < view.top || block.height > view.height)
    viewport.scrollTop += block.top - view.top;
  else if (block.bottom > view.bottom)
    viewport.scrollTop += block.bottom - view.bottom;
}
watch(
  [() => detailAsset.value?.id, canvasRacks, plotHeight],
  revealSelectedDevice,
  { immediate: true, flush: "post" },
);
onMounted(revealSelectedDevice);
function displayName(allocation: Rack["allocations"][number]) {
  return cabinet.value
    ? allocation.asset_name?.trim() || allocationPrimary(allocation)
    : allocationPrimary(allocation);
}

function allocationPrimary(
  allocation: RackCanvasContext["displayedRacks"]["value"][number]["allocations"][number],
) {
  return (
    allocation.asset_no?.trim() ||
    allocation.asset_name?.trim() ||
    t("asset.unlisted")
  );
}

function allocationMeta(
  allocation: RackCanvasContext["displayedRacks"]["value"][number]["allocations"][number],
) {
  return [
    allocation.device_type_name || t("rack.unclassified"),
    `U${allocation.start_u}–U${allocation.end_u}`,
  ].join(" · ");
}

function allocationTooltip(
  allocation: RackCanvasContext["displayedRacks"]["value"][number]["allocations"][number],
) {
  return [
    ...new Set(
      [
        allocationPrimary(allocation),
        allocationMeta(allocation),
        allocation.asset_name?.trim(),
      ].filter(Boolean),
    ),
  ].join("，");
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
  <section
    ref="canvasRoot"
    class="rack-layout-panel"
    :class="{ 'rack-layout-panel--cabinet': cabinet }"
  >
    <div
      v-if="!props.racks && rackCanvasLoading"
      class="rack-panel-state"
      role="status"
      aria-live="polite"
    >
      <el-skeleton :rows="8" animated />
    </div>
    <div
      v-else-if="!props.racks && rackCanvasError"
      class="rack-panel-state rack-panel-error"
      role="alert"
    >
      <strong>{{ t("rack.rackLoadFailed") }}</strong>
      <span>{{ rackCanvasError }}</span>
      <el-button type="primary" plain @click="retryRackView">{{
        t("common.retry")
      }}</el-button>
    </div>
    <div v-else-if="canvasRacks.length" class="rack-u-stage">
      <el-card
        v-for="rack in canvasRacks"
        :id="`rack-view-${rack.id}`"
        :key="rack.id"
        class="rack-u-card"
        shadow="never"
        :class="{
          active: focusedRack?.id === rack.id,
          'rack-u-card--dense': fitCabinet && unitHeight(rack) < 14,
        }"
      >
        <template #header>
          <div class="rack-u-head">
            <span class="rack-u-head__label">{{ t("rack.uPosition") }}</span>
            <span class="rack-u-head__capacity">
              {{ rackUsedU(rack) }} / {{ rack.total_u }} U ·
              {{ rackUtilization(rack) }}%
            </span>
          </div>
        </template>
        <p v-if="!cabinet && rack.reserved_u" class="rack-reservation-legend">
          {{ t("rackReserve.legend", { count: rack.reserved_u }) }}
        </p>
        <div class="rack-body-scroll">
          <div class="rack-body" :style="bodyStyle(rack)">
            <div class="rack-u-scale" aria-hidden="true">
              <span
                v-for="u in rack.total_u"
                :key="u"
                class="rack-u-mark"
                :class="{ 'rack-u-mark--major': isMajorUnit(rack.total_u, u) }"
                >{{ rackUnitLabel(rack.total_u, u) }}</span
              >
            </div>
            <div
              class="rack-slot-area"
              :aria-label="`${rack.code} ${t('rack.uPosition')}`"
            >
              <div class="rack-slot-grid">
                <button
                  v-for="u in rack.total_u"
                  type="button"
                  :disabled="
                    previewOnly ||
                    rack.occupancy_restricted ||
                    !operations ||
                    !props.context.can?.('assets.manage') ||
                    !props.context.can?.('assets.view') ||
                    rack.status !== 'in_use' ||
                    rack.is_active === false ||
                    rackGapUnavailable(rack, rackUnitNumber(rack.total_u, u)) ||
                    rack.reservations?.some(
                      (item) =>
                        rackUnitNumber(rack.total_u, u) >= item.start_u &&
                        rackUnitNumber(rack.total_u, u) <= item.end_u,
                    ) ||
                    rack.allocations.some(
                      (item) =>
                        rackUnitNumber(rack.total_u, u) >= item.start_u &&
                        rackUnitNumber(rack.total_u, u) <= item.end_u,
                    )
                  "
                  :aria-label="
                    t('rackOps.mountAt', { u: rackUnitNumber(rack.total_u, u) })
                  "
                  @click="
                    operations?.open(
                      'mount',
                      null,
                      rack,
                      rackUnitNumber(rack.total_u, u),
                    )
                  "
                  :key="u"
                  class="rack-slot-row"
                  :class="{
                    'rack-slot-row--unavailable': rackGapUnavailable(
                      rack,
                      rackUnitNumber(rack.total_u, u),
                    ),
                    'rack-slot-row--major': isMajorUnit(rack.total_u, u),
                  }"
                />
              </div>
              <div class="rack-device-layer">
                <RackHint
                  v-for="row in rack.reservations || []"
                  :key="`reservation-${row.id}`"
                  class="rack-reservation-slot"
                  :style="{
                    gridRow: `${rack.total_u - row.end_u + 1} / span ${row.units}`,
                  }"
                  :heading="row.purpose"
                  :subtitle="t('rackReserve.active')"
                  :fields="[
                    {
                      label: t('rack.uPosition'),
                      value: `U${row.start_u}–U${row.end_u} · ${row.units}U`,
                    },
                  ]"
                >
                  <button
                    type="button"
                    class="rack-u-reservation"
                    :aria-label="`${t('rackReserve.active')} U${row.start_u}–U${row.end_u} · ${row.purpose}`"
                    :disabled="
                      !reservations ||
                      reservations.busy.value ||
                      operations?.busy.value
                    "
                    @click="reservations?.open(rack)"
                  >
                    <span v-if="blockHeight(rack, row.units) >= 16"
                      >{{ t("rackReserve.active") }} · {{ row.purpose }}</span
                    ><small
                      v-if="
                        row.units >= 2 && blockHeight(rack, row.units) >= 32
                      "
                      >U{{ row.start_u }}–U{{ row.end_u }}</small
                    >
                  </button>
                </RackHint>
                <div
                  v-for="allocation in rack.allocations"
                  :key="allocation.asset"
                  class="rack-device-slot"
                  :style="rackAllocationStyle(rack, allocation)"
                >
                  <span class="rack-device-tooltip">
                    <RackHint
                      :heading="
                        allocation.asset_name?.trim() ||
                        allocationPrimary(allocation)
                      "
                      :subtitle="allocation.asset_no?.trim()"
                      :disabled="
                        context.can ? !context.can('assets.view') : false
                      "
                      :fields="[
                        {
                          label: t('common.type'),
                          value:
                            allocation.device_type_name ||
                            t('rack.unclassified'),
                        },
                        {
                          label: t('rack.uPosition'),
                          value: `U${allocation.start_u}–U${allocation.end_u} · ${allocation.units}U`,
                        },
                      ]"
                    >
                      <el-button
                        text
                        native-type="button"
                        class="device"
                        :class="{
                          'device-selected':
                            detailAsset?.id === allocation.asset,
                          'rack-device--one-u': allocation.units === 1,
                        }"
                        :aria-label="allocationTooltip(allocation)"
                        :disabled="
                          context.can ? !context.can('assets.view') : false
                        "
                        @click.stop="
                          operations
                            ? operations.locate(allocation.asset)
                            : openRackAssetDetail(allocation.asset, rack.id)
                        "
                      >
                        <span class="rack-device__content">
                          <span
                            v-if="blockHeight(rack, allocation.units) >= 12"
                            class="rack-device__primary"
                            >{{ displayName(allocation) }}</span
                          >
                          <span
                            v-else
                            class="rack-device__occupied"
                            aria-hidden="true"
                          />
                          <span
                            v-if="
                              allocation.units >= 2 &&
                              blockHeight(rack, allocation.units) >= 32
                            "
                            class="rack-device__meta"
                            >{{ allocationMeta(allocation) }}</span
                          >
                        </span>
                      </el-button>
                    </RackHint>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-card>
    </div>
    <div v-else class="rack-panel-empty">
      <el-empty
        :description="
          hasRackFilters ? t('rack.noMatchingRacks') : t('rack.noRack')
        "
      />
      <el-button
        v-if="hasRackFilters"
        link
        type="primary"
        @click="resetRackFilters"
        >{{ t("common.clearFilters") }}</el-button
      >
    </div>
  </section>
</template>
