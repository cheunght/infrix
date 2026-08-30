<script setup lang="ts">
import { ArrowRight, Loading, Search } from "@element-plus/icons-vue";
import { computed, ref, watch } from "vue";
import type { Asset, FaultEvent, Rack } from "../types";
import type { GlobalSearchModule, GlobalSearchState } from "../composables/useGlobalSearch";
import { rackStatusLabel } from "../business-enums";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  modelValue: string;
  state: GlobalSearchState;
}>();
const { t, locale } = useI18n();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  focus: [];
  close: [];
  "select-asset": [asset: Asset];
  "select-rack": [rack: Rack];
  "select-fault": [fault: FaultEvent];
  "view-all": [module: GlobalSearchModule];
}>();

type SearchEntry =
  | { module: "assets"; item: Asset }
  | { module: "racks"; item: Rack }
  | { module: "faults"; item: FaultEvent };

const activeIndex = ref(-1);
const popoverVisible = computed({
  get: () => props.state.open,
  set: (visible: boolean) => {
    if (visible) emit("focus");
    else emit("close");
  },
});
const activeEntries = computed<SearchEntry[]>(() => [
  ...(props.state.allowed.assets
    ? props.state.assets.map((item) => ({ module: "assets" as const, item }))
    : []),
  ...(props.state.allowed.racks
    ? props.state.racks.map((item) => ({ module: "racks" as const, item }))
    : []),
  ...(props.state.allowed.faults
    ? props.state.faults.map((item) => ({ module: "faults" as const, item }))
    : []),
]);
const hasResults = computed(() => activeEntries.value.length > 0);
const hasErrors = computed(() => Boolean(
  (props.state.allowed.assets && props.state.assetError)
  || (props.state.allowed.racks && props.state.rackError)
  || (props.state.allowed.faults && props.state.faultError),
));

watch(
  () => [
    props.state.query,
    props.state.loading,
    props.state.assets.length,
    props.state.racks.length,
    props.state.faults.length,
  ],
  () => {
    activeIndex.value = -1;
  },
);

function optionId(index: number) {
  return `global-search-option-${index}`;
}

function entryIndex(module: SearchEntry["module"], index: number) {
  if (module === "assets") return index;
  if (module === "racks") return props.state.assets.length + index;
  return props.state.assets.length + props.state.racks.length + index;
}

function moveActive(step: number) {
  if (!activeEntries.value.length) return;
  const next = activeIndex.value + step;
  activeIndex.value = (next + activeEntries.value.length) % activeEntries.value.length;
}

function activateActive() {
  const entry = activeEntries.value[activeIndex.value] || activeEntries.value[0];
  if (!entry) return;
  if (entry.module === "assets") emit("select-asset", entry.item);
  if (entry.module === "racks") emit("select-rack", entry.item);
  if (entry.module === "faults") emit("select-fault", entry.item);
}

function closeWithEscape() {
  emit("close");
}

function assetLocation(asset: Asset) {
  const allocation = asset.rack_allocation;
  return [
    asset.data_center || allocation?.data_center,
    asset.server_room || allocation?.server_room,
    asset.rack_code || allocation?.rack_code,
  ].filter(Boolean).join(" / ") || t("globalSearch.notMounted");
}

function rackLocation(rack: Rack) {
  return [rack.data_center_name, rack.server_room_name].filter(Boolean).join(" / ") || t("globalSearch.noLocation");
}

function rackStatus(rack: Rack) {
  return rackStatusLabel(rack.status, rack.is_active);
}

function faultSummary(fault: FaultEvent) {
  return fault.reason?.trim() || fault.description?.trim() || t("globalSearch.faultRecord");
}

function faultDetail(fault: FaultEvent) {
  if (!fault.reason?.trim()) return fault.description?.trim() || "";
  if (!fault.description?.trim() || fault.description.trim() === fault.reason.trim()) return "";
  return fault.description.trim();
}

function faultStatus(fault: FaultEvent) {
  return fault.is_closed ? t("globalSearch.closed") : t("globalSearch.open");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("common.notAvailable") : date.toLocaleString(locale.value);
}

function hasMore(module: GlobalSearchModule) {
  if (module === "assets") return props.state.assetTotal > props.state.assets.length;
  if (module === "racks") return props.state.rackTotal > props.state.racks.length;
  return props.state.faultTotal > props.state.faults.length;
}

</script>

<template>
  <el-popover
    v-model:visible="popoverVisible"
    class="ep-global-search global-search"
    placement="bottom-end"
    :width="520"
    effect="light"
    popper-class="global-search-popover"
    :persistent="false"
  >
    <template #reference>
      <el-input
        class="global-search-input itam-search-field"
        :model-value="modelValue"
        :placeholder="t('globalSearch.placeholder')"
        :aria-label="t('globalSearch.ariaLabel')"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="state.open ? 'true' : 'false'"
        :aria-controls="state.open ? 'global-search-results' : undefined"
        :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
        clearable
        @update:model-value="emit('update:modelValue', String($event ?? ''))"
        @focus="emit('focus')"
        @keydown.down.stop.prevent="moveActive(1)"
        @keydown.up.stop.prevent="moveActive(-1)"
        @keydown.enter.stop.prevent="activateActive()"
        @keydown.esc.stop.prevent="closeWithEscape()"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
        <template #suffix>
          <el-icon v-if="state.loading" class="global-search-loading"><Loading /></el-icon>
        </template>
      </el-input>
    </template>

    <div
      id="global-search-results"
      class="global-search-panel"
      role="region"
      :aria-label="t('globalSearch.results')"
    >
      <div class="global-search-panel__header">
        <span>{{ t('globalSearch.results') }}</span>
        <span v-if="state.loading" class="global-search-panel__status">{{ t('globalSearch.searching') }}</span>
      </div>

      <div v-if="state.loading" class="global-search-panel__loading" role="status">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>{{ t('globalSearch.searchAssetsRacksFaults') }}</span>
      </div>

      <section
        v-if="state.allowed.assets && (state.assets.length || state.assetError)"
        class="global-search-section"
      >
        <div class="global-search-section__header">
          <span>{{ t('globalSearch.asset') }}</span>
          <el-button v-if="hasMore('assets')" link class="global-search-section__view-all" @click="emit('view-all', 'assets')">{{ t('globalSearch.viewAllAssets') }}</el-button>
        </div>
        <el-button
          v-for="(asset, index) in state.assets"
          :id="optionId(entryIndex('assets', index))"
          :key="asset.id"
          text
          native-type="button"
          class="global-search-result"
          :class="{ 'is-active': activeIndex === entryIndex('assets', index) }"
          role="option"
          :aria-selected="activeIndex === entryIndex('assets', index)"
          @mouseenter="activeIndex = entryIndex('assets', index)"
          @click="emit('select-asset', asset)"
        >
          <span class="global-search-result__marker global-search-result__marker--asset">{{ t('globalSearch.asset') }}</span>
          <span class="global-search-result__body">
            <strong>{{ asset.asset_no }} · {{ asset.name }}</strong>
            <small>{{ asset.device_type_name || t('common.unknown') }} · {{ assetLocation(asset) }}</small>
          </span>
          <el-icon class="global-search-result__arrow"><ArrowRight /></el-icon>
        </el-button>
        <div v-if="state.assetError" class="global-search-section__error" role="alert">
          {{ t('globalSearch.asset') }}: {{ state.assetError }}
        </div>
      </section>

      <section
        v-if="state.allowed.racks && (state.racks.length || state.rackError)"
        class="global-search-section"
      >
        <div class="global-search-section__header">
          <span>{{ t('globalSearch.rack') }}</span>
          <el-button v-if="hasMore('racks')" link class="global-search-section__view-all" @click="emit('view-all', 'racks')">{{ t('globalSearch.viewAllRacks') }}</el-button>
        </div>
        <el-button
          v-for="(rack, index) in state.racks"
          :id="optionId(entryIndex('racks', index))"
          :key="rack.id"
          text
          native-type="button"
          class="global-search-result"
          :class="{ 'is-active': activeIndex === entryIndex('racks', index) }"
          role="option"
          :aria-selected="activeIndex === entryIndex('racks', index)"
          @mouseenter="activeIndex = entryIndex('racks', index)"
          @click="emit('select-rack', rack)"
        >
          <span class="global-search-result__marker global-search-result__marker--rack">{{ t('globalSearch.rack') }}</span>
          <span class="global-search-result__body">
            <strong>{{ rack.code }}<template v-if="rack.name"> · {{ rack.name }}</template></strong>
            <small>{{ rackLocation(rack) }} · {{ rackStatus(rack) }}</small>
          </span>
          <el-icon class="global-search-result__arrow"><ArrowRight /></el-icon>
        </el-button>
        <div v-if="state.rackError" class="global-search-section__error" role="alert">
          {{ t('globalSearch.rack') }}: {{ state.rackError }}
        </div>
      </section>

      <section
        v-if="state.allowed.faults && (state.faults.length || state.faultError)"
        class="global-search-section"
      >
        <div class="global-search-section__header">
          <span>{{ t('globalSearch.fault') }}</span>
          <el-button v-if="hasMore('faults')" link class="global-search-section__view-all" @click="emit('view-all', 'faults')">{{ t('globalSearch.viewAllFaults') }}</el-button>
        </div>
        <el-button
          v-for="(fault, index) in state.faults"
          :id="optionId(entryIndex('faults', index))"
          :key="fault.id"
          text
          native-type="button"
          class="global-search-result"
          :class="{ 'is-active': activeIndex === entryIndex('faults', index) }"
          role="option"
          :aria-selected="activeIndex === entryIndex('faults', index)"
          @mouseenter="activeIndex = entryIndex('faults', index)"
          @click="emit('select-fault', fault)"
        >
          <span class="global-search-result__marker global-search-result__marker--fault">{{ t('globalSearch.fault') }}</span>
          <span class="global-search-result__body">
            <strong>{{ faultSummary(fault) }}</strong>
            <small>{{ fault.asset_no }} · {{ fault.asset_name }}<template v-if="faultDetail(fault)"> · {{ faultDetail(fault) }}</template></small>
            <small>{{ faultStatus(fault) }} · {{ formatDateTime(fault.occurred_at) }}</small>
          </span>
          <el-icon class="global-search-result__arrow"><ArrowRight /></el-icon>
        </el-button>
        <div v-if="state.faultError" class="global-search-section__error" role="alert">
          {{ t('globalSearch.fault') }}: {{ state.faultError }}
        </div>
      </section>

      <div
        v-if="!state.loading && state.hasSearched && !hasResults && !hasErrors"
        class="global-search-panel__empty"
      >
        {{ t('globalSearch.noResults', { query: state.query }) }}
      </div>
    </div>
  </el-popover>
</template>
