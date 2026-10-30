<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  proxyRefs,
  ref,
  watch,
} from "vue";
import { InfoFilled } from "@element-plus/icons-vue";
import type { PopoverInstance } from "element-plus";
import { RackReservationsKey } from "../composables/useRackReservations";
import { useI18n } from "vue-i18n";
import type { RackSharedContext } from "../page-context";
import type {
  RackComparisonEntry,
  RackComparison,
} from "../composables/useRackComparison";
import type { RackOperations } from "../composables/useRackOperations";
import RackLayoutCanvas from "./RackLayoutCanvas.vue";
import RackAssetInspector from "./RackAssetInspector.vue";
import RackHint from "./RackHint.vue";
import { useRackHints } from "../composables/useRackHints";
import StatusTag from "./StatusTag.vue";
import { rackStatusLabel, rackStatusTone } from "../business-enums";

const props = defineProps<{
  context: RackSharedContext;
  comparison: RackComparison;
  operations: RackOperations;
}>();
const { t } = useI18n();
const reservations = inject(RackReservationsKey, null);
const comparison = proxyRefs(props.comparison);
const content = ref<HTMLElement>();
watch(
  () => props.operations.locatedAsset?.value,
  (asset) => {
    if (asset?.rack_allocation && content.value) content.value.scrollTop = 0;
  },
  { flush: "post" },
);
const panelHeight = ref(0);
const capacityPopovers = ref<PopoverInstance[]>([]);
const capacityContents = ref<HTMLElement[]>([]);
const hints = useRackHints();
function hideCapacity() {
  capacityPopovers.value.forEach((popover) => popover.hide());
}
function scrollCapacity(event: Event) {
  if (
    !(event.target instanceof Element) ||
    !event.target.closest(".rack-comparison-capacity-popper")
  )
    hideCapacity();
}
watch(hints.active, (active) => {
  if (active) hideCapacity();
});
watch(() => props.comparison.entries.value, hideCapacity);
function focusCapacity(id: number) {
  capacityContents.value
    .find((node) => node.dataset.rackId === String(id))
    ?.focus();
}
function closeCapacity(id: number) {
  hideCapacity();
  content.value
    ?.querySelector<HTMLElement>(`[data-capacity-rack="${id}"]`)
    ?.focus();
}
let observer: ResizeObserver | undefined;
function measurePanel() {
  const panel = content.value?.closest<HTMLElement>(".rack-comparison-panel");
  if (!panel) return;
  const scroller = panel.closest<HTMLElement>(".ep-main");
  const top =
    panel.getBoundingClientRect().top +
    (scroller?.scrollTop || 0) +
    window.scrollY;
  panelHeight.value = Math.max(360, window.innerHeight - top - 24);
}
onMounted(() => {
  measurePanel();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(measurePanel);
    const panel = content.value?.closest(".rack-comparison-panel");
    const page = panel?.closest(".page-container");
    if (panel) observer.observe(panel);
    if (page) observer.observe(page);
  }
  window.addEventListener("resize", measurePanel);
  window.addEventListener("resize", hideCapacity);
  window.addEventListener("blur", hideCapacity);
  window.addEventListener("scroll", scrollCapacity, true);
  document.addEventListener("visibilitychange", hideCapacity);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", measurePanel);
  window.removeEventListener("resize", hideCapacity);
  window.removeEventListener("blur", hideCapacity);
  window.removeEventListener("scroll", scrollCapacity, true);
  document.removeEventListener("visibilitychange", hideCapacity);
});
const source = computed(() => {
  const asset = props.context.detailAsset.value;
  return !props.context.detailLoading.value &&
    !props.context.detailError.value &&
    asset?.rack_allocation
    ? asset
    : null;
});
const canMove = computed(
  () =>
    props.context.can("assets.view") &&
    props.context.can("assets.manage") &&
    source.value &&
    source.value.status !== "retired" &&
    !props.operations.busy.value,
);
function restricted(entry: RackComparisonEntry) {
  return (
    entry.rack?.occupancy_restricted || entry.options?.occupancy_restricted
  );
}
function longest(entry: RackComparisonEntry) {
  return Math.max(
    0,
    ...(entry.options?.available_ranges || []).map(
      (span) => span.end_u - span.start_u + 1,
    ),
  );
}
function ranges(entry: RackComparisonEntry) {
  return (
    entry.options?.available_ranges
      ?.map((span) => `U${span.start_u}–U${span.end_u}`)
      .join("、") || t("rackOps.noSpace")
  );
}
function gaps(entry: RackComparisonEntry) {
  return (
    entry.options?.gap_ranges?.map((span) => `U${span.start_u}`).join("、") ||
    t("common.notAvailable")
  );
}
function fullLocation(entry: RackComparisonEntry) {
  return (
    [entry.rack?.data_center_name, entry.rack?.server_room_name]
      .filter(Boolean)
      .join(" / ") || t("common.notAvailable")
  );
}
function locationLabel(entry: RackComparisonEntry) {
  return props.context.selectedDataCenter?.value ===
    entry.options?.data_center_id &&
    props.context.selectedRoom?.value === entry.rack?.room &&
    entry.rack?.server_room_name
    ? entry.rack.server_room_name
    : fullLocation(entry);
}
function moveHint(entry: RackComparisonEntry) {
  if (comparison.coolingDown) return t("rackCompare.maintenance");
  if (entry.loading) return t("common.loading");
  if (!entry.options?.accepts_assets) return t("rackCompare.cannotReceive");
  return source.value ? "" : t("rackCompare.chooseSource");
}
</script>

<template>
  <el-card
    class="resource-panel resource-detail-panel rack-comparison-panel"
    shadow="never"
    :style="panelHeight ? { height: `${panelHeight}px` } : undefined"
  >
    <template #header>
      <div class="rack-comparison-heading">
        <div class="rack-comparison-title">
          <strong>{{ t("rackCompare.title") }}</strong>
          <RackHint
            :heading="t('rackCompare.title')"
            :subtitle="t('rackCompare.previewHint')"
            placement="bottom-start"
          >
            <el-button
              text
              circle
              size="small"
              :icon="InfoFilled"
              :aria-label="t('rackCompare.previewHint')"
            />
          </RackHint>
        </div>
        <RackHint
          v-if="source"
          class="rack-comparison-source-hint"
          :heading="source.name || source.asset_no"
          :subtitle="source.asset_no"
          :fields="[
            {
              label: t('rack.uPosition'),
              value: `U${source.rack_allocation?.start_u}–U${source.rack_allocation?.end_u} · ${source.rack_allocation?.units}U`,
            },
          ]"
          placement="bottom-start"
        >
          <span class="rack-comparison-source" tabindex="0"
            >{{ t("rackCompare.source") }}：<strong>{{
              source.asset_no
            }}</strong>
            · {{ source.rack_allocation?.units }}U</span
          >
        </RackHint>
        <el-button
          size="small"
          :disabled="comparison.loading || comparison.coolingDown"
          @click="comparison.refresh"
          >{{ t("common.refresh") }}</el-button
        >
      </div>
    </template>
    <div ref="content" class="rack-comparison-content">
      <div class="rack-comparison-workspace">
        <el-alert
          v-if="comparison.coolingDown"
          :title="t('rackCompare.maintenance')"
          type="warning"
          :closable="false"
        />
        <div
          class="rack-comparison-columns"
          tabindex="0"
          :aria-label="t('rackCompare.title')"
        >
          <article
            v-for="entry in comparison.entries"
            :key="entry.id"
            class="rack-comparison-column"
            :aria-label="entry.rack?.code || `#${entry.id}`"
          >
            <div class="rack-comparison-card-heading">
              <strong :title="entry.rack?.code">{{
                entry.rack?.code || `#${entry.id}`
              }}</strong>
              <span
                v-if="source?.rack_allocation?.rack === entry.id"
                class="rack-comparison-current"
                >{{ t("rackCompare.currentRack") }}</span
              >
              <StatusTag
                v-if="entry.rack"
                :label="
                  rackStatusLabel(entry.rack.status, entry.rack.is_active)
                "
                :tone="rackStatusTone(entry.rack.status, entry.rack.is_active)"
                size="small"
              />
              <el-button
                class="rack-comparison-remove"
                text
                size="small"
                :aria-label="
                  t('rackCompare.remove', {
                    rack: entry.rack?.code || `#${entry.id}`,
                  })
                "
                @click="comparison.toggle(entry.id)"
                >×</el-button
              >
            </div>
            <RackHint
              :heading="fullLocation(entry)"
              class="rack-comparison-location-hint"
              placement="bottom-start"
            >
              <p class="rack-comparison-location" tabindex="0">
                {{ locationLabel(entry) }}
              </p>
            </RackHint>
            <el-skeleton
              v-if="entry.loading && (!entry.rack || !entry.options)"
              class="rack-comparison-state"
              :rows="8"
              animated
            />
            <el-alert
              v-else-if="entry.failed"
              :title="t('rackCompare.unavailable')"
              type="warning"
              :closable="false"
              class="rack-comparison-state"
            />
            <template v-else-if="entry.rack && entry.options">
              <el-alert
                v-if="restricted(entry)"
                :title="t('dataScope.occupancyHint')"
                type="info"
                :closable="false"
                class="rack-comparison-state"
              />
              <template v-else>
                <dl
                  class="rack-comparison-metrics rack-comparison-metrics--compact"
                >
                  <div>
                    <dt>{{ t("rackCompare.freeCompact") }}</dt>
                    <dd>
                      {{
                        entry.rack.free_u ??
                        entry.rack.total_u - context.rackUsedU(entry.rack)
                      }}U
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t("rackCompare.largestCompact") }}</dt>
                    <dd>{{ longest(entry) }}U</dd>
                  </div>
                </dl>
                <div class="rack-comparison-map">
                  <RackLayoutCanvas
                    :context="context"
                    :racks="[entry.rack]"
                    appearance="cabinet"
                    :fit-to-height="false"
                    preview-only
                  />
                </div>
              </template>
              <div class="rack-comparison-actions">
                <el-popover
                  v-if="!restricted(entry)"
                  ref="capacityPopovers"
                  :key="String(entry.loading)"
                  trigger="click"
                  placement="top-start"
                  :width="320"
                  :persistent="false"
                  transition="rack-hint"
                  :hide-after="0"
                  :disabled="entry.loading || comparison.coolingDown"
                  popper-class="rack-comparison-capacity-popper"
                  :title="t('rackCompare.capacityDetails')"
                  @before-enter="hints.hide()"
                  @after-enter="focusCapacity(entry.id)"
                >
                  <template #reference
                    ><el-button
                      class="rack-comparison-capacity"
                      :data-capacity-rack="entry.id"
                      size="small"
                      link
                      :disabled="entry.loading || comparison.coolingDown"
                      @keydown.esc.stop="closeCapacity(entry.id)"
                      >{{ t("rackCompare.capacityDetails") }}</el-button
                    ></template
                  >
                  <template #default>
                    <div
                      ref="capacityContents"
                      :data-rack-id="entry.id"
                      class="rack-comparison-capacity-content"
                      tabindex="0"
                      @keydown.esc.stop="closeCapacity(entry.id)"
                    >
                      <dl class="rack-comparison-secondary">
                        <div>
                          <dt>{{ t("rack.totalU") }}</dt>
                          <dd>{{ entry.rack.total_u }}U</dd>
                        </div>
                        <div>
                          <dt>{{ t("rack.usedU") }}</dt>
                          <dd>{{ context.rackUsedU(entry.rack) }}U</dd>
                        </div>
                        <div>
                          <dt>{{ t("rackReserve.reservedU") }}</dt>
                          <dd>{{ entry.rack.reserved_u ?? 0 }}U</dd>
                        </div>
                      </dl>
                      <p>
                        <strong>{{ t("rackOps.available") }}</strong
                        ><br />{{ ranges(entry) }}
                      </p>
                      <p>
                        <strong>{{ t("rackCompare.gaps") }}</strong
                        ><br />{{ gaps(entry) }}
                      </p>
                      <el-button
                        size="small"
                        link
                        @click="closeCapacity(entry.id)"
                        >{{ t("common.close") }}</el-button
                      >
                    </div>
                  </template>
                </el-popover>
                <el-button
                  size="small"
                  v-if="reservations"
                  :aria-label="t('rackReserve.title')"
                  :disabled="
                    entry.loading ||
                    restricted(entry) ||
                    reservations.busy.value ||
                    operations.busy.value ||
                    comparison.coolingDown
                  "
                  @click="reservations.open(entry.rack)"
                  >{{ t("rackCompare.reserveAction") }}</el-button
                >
                <RackHint
                  v-if="
                    context.can('assets.manage') && context.can('assets.view')
                  "
                  :heading="t('rackCompare.moveHere')"
                  :subtitle="moveHint(entry)"
                  :disabled="!moveHint(entry)"
                  placement="bottom-start"
                >
                  <span
                    class="rack-comparison-move-target"
                    :tabindex="moveHint(entry) ? 0 : undefined"
                    :aria-label="moveHint(entry) || undefined"
                  >
                    <el-button
                      class="rack-comparison-move"
                      size="small"
                      type="primary"
                      plain
                      :disabled="
                        !canMove ||
                        entry.loading ||
                        !entry.options.accepts_assets ||
                        comparison.coolingDown
                      "
                      @click="operations.open('move', source, entry.rack)"
                      >{{ t("rackCompare.moveHere") }}</el-button
                    >
                  </span>
                </RackHint>
              </div>
            </template>
          </article>
        </div>
      </div>
      <RackAssetInspector
        v-if="context.rackDetailOpen.value"
        :context="context"
      />
    </div>
  </el-card>
</template>
