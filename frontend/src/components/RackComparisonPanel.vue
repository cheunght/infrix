<script setup lang="ts">
import { computed, proxyRefs } from "vue";
import { useI18n } from "vue-i18n";
import type { RackSharedContext } from "../page-context";
import type {
  RackComparisonEntry,
  RackComparison,
} from "../composables/useRackComparison";
import type { RackOperations } from "../composables/useRackOperations";
import RackLayoutCanvas from "./RackLayoutCanvas.vue";
import RackAssetInspector from "./RackAssetInspector.vue";
import StatusTag from "./StatusTag.vue";
import { rackStatusLabel, rackStatusTone } from "../business-enums";

const props = defineProps<{
  context: RackSharedContext;
  comparison: RackComparison;
  operations: RackOperations;
}>();
const { t } = useI18n();
const comparison = proxyRefs(props.comparison);
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
</script>

<template>
  <el-card
    class="resource-panel resource-detail-panel rack-comparison-panel"
    shadow="never"
  >
    <template #header>
      <div class="rack-comparison-heading">
        <strong>{{ t("rackCompare.title") }}</strong>
        <el-button
          :disabled="comparison.loading || comparison.coolingDown"
          @click="comparison.refresh"
          >{{ t("common.refresh") }}</el-button
        >
      </div>
    </template>
    <div class="rack-comparison-content">
      <p class="rack-comparison-hint">{{ t("rackCompare.previewHint") }}</p>
      <el-alert
        v-if="comparison.coolingDown"
        :title="t('rackCompare.maintenance')"
        type="warning"
        :closable="false"
      />
      <div class="rack-comparison-source">
        <span v-if="source"
          >{{ t("rackCompare.source") }}：<strong>{{ source.asset_no }}</strong>
          · {{ source.rack_allocation?.units }}U</span
        >
        <span v-else>{{ t("rackCompare.chooseSource") }}</span>
        <el-button
          v-if="context.can('assets.view')"
          @click="operations.openSearch"
          >{{ t("rackOps.findAsset") }}</el-button
        >
      </div>
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
            <strong>{{ entry.rack?.code || `#${entry.id}` }}</strong>
            <el-button
              text
              :aria-label="
                t('rackCompare.remove', {
                  rack: entry.rack?.code || `#${entry.id}`,
                })
              "
              @click="comparison.toggle(entry.id)"
              >×</el-button
            >
          </div>
          <p class="rack-comparison-location">
            {{
              [entry.rack?.data_center_name, entry.rack?.server_room_name]
                .filter(Boolean)
                .join(" / ")
            }}
          </p>
          <el-skeleton v-if="entry.loading" :rows="8" animated />
          <el-alert
            v-else-if="entry.failed"
            :title="t('rackCompare.unavailable')"
            type="warning"
            :closable="false"
          />
          <template v-else-if="entry.rack && entry.options">
            <StatusTag
              :label="rackStatusLabel(entry.rack.status, entry.rack.is_active)"
              :tone="rackStatusTone(entry.rack.status, entry.rack.is_active)"
              size="small"
            />
            <el-button
              v-if="context.can('assets.manage') && context.can('assets.view')"
              class="rack-comparison-move"
              :disabled="
                !canMove ||
                !entry.options.accepts_assets ||
                comparison.coolingDown
              "
              @click="operations.open('move', source, entry.rack)"
              >{{ t("rackCompare.moveHere") }}</el-button
            >
            <el-alert
              v-if="restricted(entry)"
              :title="t('dataScope.occupancyHint')"
              type="info"
              :closable="false"
            />
            <template v-else>
              <dl class="rack-comparison-metrics">
                <div>
                  <dt>{{ t("rack.totalU") }}</dt>
                  <dd>{{ entry.rack.total_u }}U</dd>
                </div>
                <div>
                  <dt>{{ t("rack.usedU") }}</dt>
                  <dd>{{ context.rackUsedU(entry.rack) }}U</dd>
                </div>
                <div>
                  <dt>{{ t("rack.availableU") }}</dt>
                  <dd>
                    {{
                      entry.rack.free_u ??
                      entry.rack.total_u - context.rackUsedU(entry.rack)
                    }}U
                  </dd>
                </div>
                <div>
                  <dt>{{ t("rackCompare.largest") }}</dt>
                  <dd>{{ longest(entry) }}U</dd>
                </div>
              </dl>
              <div class="rack-comparison-map">
                <RackLayoutCanvas
                  :context="context"
                  :racks="[entry.rack]"
                  preview-only
                />
              </div>
              <div class="rack-comparison-ranges">
                <p>
                  <strong>{{ t("rackOps.available") }}</strong
                  ><br />{{ ranges(entry) }}
                </p>
                <p>
                  <strong>{{ t("rackCompare.gaps") }}</strong
                  ><br />{{ gaps(entry) }}
                </p>
              </div>
            </template>
            <p
              v-if="!entry.options.accepts_assets"
              class="rack-comparison-hint"
            >
              {{ t("rackCompare.cannotReceive") }}
            </p>
          </template>
        </article>
      </div>
      <RackAssetInspector
        v-if="context.rackDetailOpen.value"
        :context="context"
      />
    </div>
  </el-card>
</template>
