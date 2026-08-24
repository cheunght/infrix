<script setup lang="ts">
import { ArrowRight, Loading, Search } from "@element-plus/icons-vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Asset, FaultEvent, Rack } from "../types";
import type { GlobalSearchModule, GlobalSearchState } from "../composables/useGlobalSearch";

const props = defineProps<{
  modelValue: string;
  state: GlobalSearchState;
}>();

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

const root = ref<HTMLElement | null>(null);
const activeIndex = ref(-1);
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
  ].filter(Boolean).join(" / ") || "未上架";
}

function rackLocation(rack: Rack) {
  return [rack.data_center_name, rack.server_room_name].filter(Boolean).join(" / ") || "未关联位置";
}

function rackStatus(rack: Rack) {
  return rack.status_label
    || (rack.status === "reserved" ? "预留" : rack.status === "disabled" || rack.is_active === false ? "停用" : "使用中");
}

function faultSummary(fault: FaultEvent) {
  return fault.reason?.trim() || fault.description?.trim() || "故障记录";
}

function faultDetail(fault: FaultEvent) {
  if (!fault.reason?.trim()) return fault.description?.trim() || "";
  if (!fault.description?.trim() || fault.description.trim() === fault.reason.trim()) return "";
  return fault.description.trim();
}

function faultStatus(fault: FaultEvent) {
  return fault.is_closed ? "已关闭" : "未关闭";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN");
}

function hasMore(module: GlobalSearchModule) {
  if (module === "assets") return props.state.assetTotal > props.state.assets.length;
  if (module === "racks") return props.state.rackTotal > props.state.racks.length;
  return props.state.faultTotal > props.state.faults.length;
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (target && !root.value?.contains(target)) emit("close");
}

function onFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget as Node | null;
  if (!nextTarget || !root.value?.contains(nextTarget)) emit("close");
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerDown));
</script>

<template>
  <div ref="root" class="ep-global-search global-search" @focusout="onFocusOut">
    <el-input
      class="global-search-input itam-search-field"
      :model-value="modelValue"
      placeholder="搜索资产 / 机柜 / 故障"
      aria-label="全局搜索资产、机柜或故障"
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

    <div
      v-if="state.open"
      id="global-search-results"
      class="global-search-panel"
      role="region"
      aria-label="搜索结果"
    >
      <div class="global-search-panel__header">
        <span>搜索结果</span>
        <span v-if="state.loading" class="global-search-panel__status">正在搜索…</span>
      </div>

      <div v-if="state.loading" class="global-search-panel__loading" role="status">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>正在搜索资产、机柜和故障</span>
      </div>

      <section
        v-if="state.allowed.assets && (state.assets.length || state.assetError)"
        class="global-search-section"
      >
        <div class="global-search-section__header">
          <span>资产</span>
          <button v-if="hasMore('assets')" type="button" @click="emit('view-all', 'assets')">查看全部资产结果</button>
        </div>
        <button
          v-for="(asset, index) in state.assets"
          :id="optionId(entryIndex('assets', index))"
          :key="asset.id"
          type="button"
          class="global-search-result"
          :class="{ 'is-active': activeIndex === entryIndex('assets', index) }"
          role="option"
          :aria-selected="activeIndex === entryIndex('assets', index)"
          @mouseenter="activeIndex = entryIndex('assets', index)"
          @click="emit('select-asset', asset)"
        >
          <span class="global-search-result__marker global-search-result__marker--asset">资产</span>
          <span class="global-search-result__body">
            <strong>{{ asset.asset_no }} · {{ asset.name }}</strong>
            <small>{{ asset.device_type_name || asset.asset_type || "未分类" }} · {{ assetLocation(asset) }}</small>
          </span>
          <el-icon class="global-search-result__arrow"><ArrowRight /></el-icon>
        </button>
        <div v-if="state.assetError" class="global-search-section__error" role="alert">
          资产结果加载失败：{{ state.assetError }}
        </div>
      </section>

      <section
        v-if="state.allowed.racks && (state.racks.length || state.rackError)"
        class="global-search-section"
      >
        <div class="global-search-section__header">
          <span>机柜</span>
          <button v-if="hasMore('racks')" type="button" @click="emit('view-all', 'racks')">查看全部机柜结果</button>
        </div>
        <button
          v-for="(rack, index) in state.racks"
          :id="optionId(entryIndex('racks', index))"
          :key="rack.id"
          type="button"
          class="global-search-result"
          :class="{ 'is-active': activeIndex === entryIndex('racks', index) }"
          role="option"
          :aria-selected="activeIndex === entryIndex('racks', index)"
          @mouseenter="activeIndex = entryIndex('racks', index)"
          @click="emit('select-rack', rack)"
        >
          <span class="global-search-result__marker global-search-result__marker--rack">机柜</span>
          <span class="global-search-result__body">
            <strong>{{ rack.code }}<template v-if="rack.name"> · {{ rack.name }}</template></strong>
            <small>{{ rackLocation(rack) }} · {{ rackStatus(rack) }}</small>
          </span>
          <el-icon class="global-search-result__arrow"><ArrowRight /></el-icon>
        </button>
        <div v-if="state.rackError" class="global-search-section__error" role="alert">
          机柜结果加载失败：{{ state.rackError }}
        </div>
      </section>

      <section
        v-if="state.allowed.faults && (state.faults.length || state.faultError)"
        class="global-search-section"
      >
        <div class="global-search-section__header">
          <span>故障</span>
          <button v-if="hasMore('faults')" type="button" @click="emit('view-all', 'faults')">查看全部故障结果</button>
        </div>
        <button
          v-for="(fault, index) in state.faults"
          :id="optionId(entryIndex('faults', index))"
          :key="fault.id"
          type="button"
          class="global-search-result"
          :class="{ 'is-active': activeIndex === entryIndex('faults', index) }"
          role="option"
          :aria-selected="activeIndex === entryIndex('faults', index)"
          @mouseenter="activeIndex = entryIndex('faults', index)"
          @click="emit('select-fault', fault)"
        >
          <span class="global-search-result__marker global-search-result__marker--fault">故障</span>
          <span class="global-search-result__body">
            <strong>{{ faultSummary(fault) }}</strong>
            <small>{{ fault.asset_no }} · {{ fault.asset_name }}<template v-if="faultDetail(fault)"> · {{ faultDetail(fault) }}</template></small>
            <small>{{ faultStatus(fault) }} · {{ formatDateTime(fault.occurred_at) }}</small>
          </span>
          <el-icon class="global-search-result__arrow"><ArrowRight /></el-icon>
        </button>
        <div v-if="state.faultError" class="global-search-section__error" role="alert">
          故障结果加载失败：{{ state.faultError }}
        </div>
      </section>

      <div
        v-if="!state.loading && state.hasSearched && !hasResults && !hasErrors"
        class="global-search-panel__empty"
      >
        未找到与“{{ state.query }}”相关的资产、机柜或故障
      </div>
    </div>
  </div>
</template>
