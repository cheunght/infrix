<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { statusLabel } from "../status";

type DonutItem = {
  label: string;
  count: number;
  color: string;
  key?: string;
  status?: string;
  type?: string;
};

const props = withDefaults(
  defineProps<{
    items: DonutItem[];
    total: number;
    centerLabel?: string;
    selectable?: boolean;
  }>(),
  { selectable: false },
);
const { t } = useI18n();
defineEmits<{ select: [item: DonutItem] }>();

const centerLabel = computed(() => props.centerLabel || t("common.totalCount"));

function displayLabel(item: DonutItem): string {
  return item.status ? statusLabel(item.status) : item.label;
}

const radius = 43;
const circumference = 2 * Math.PI * radius;
const segments = computed(() => {
  let offset = 0;
  return props.items
    .filter((item) => item.count > 0)
    .map((item) => {
      const length = props.total ? (item.count / props.total) * circumference : 0;
      const segment = { ...item, length, offset };
      offset += length;
      return segment;
    });
});
</script>

<template>
  <div v-if="items.length > 0 && total > 0" class="dashboard-donut-layout">
    <div class="dashboard-donut" :aria-label="`${centerLabel} ${total}`">
      <svg viewBox="0 0 112 112" role="img" aria-hidden="true">
        <circle class="dashboard-donut-track" cx="56" cy="56" :r="radius" />
        <circle
          v-for="segment in segments"
          :key="segment.key || segment.label"
          class="dashboard-donut-segment"
          cx="56"
          cy="56"
          :r="radius"
          :stroke="segment.color"
          :stroke-dasharray="`${segment.length} ${circumference - segment.length}`"
          :stroke-dashoffset="-segment.offset"
        />
      </svg>
      <div class="dashboard-donut-center">
        <strong>{{ total }}</strong>
        <span>{{ centerLabel }}</span>
      </div>
    </div>
    <div class="dashboard-donut-legend">
      <div class="dashboard-legend-header dashboard-list-header" aria-hidden="true">
        <span></span>
        <span>{{ t('common.status') }}</span>
        <span>{{ t('common.quantity') }}</span>
        <span>{{ t('common.percentage') }}</span>
      </div>
      <component
        v-for="item in items"
        :key="item.key || item.label"
        :is="selectable ? 'button' : 'div'"
        :type="selectable ? 'button' : undefined"
        class="dashboard-legend-item"
        :class="{ 'is-selectable': selectable }"
        @click="selectable && $emit('select', item)"
      >
        <i :style="{ backgroundColor: item.color }" aria-hidden="true"></i>
        <span>{{ displayLabel(item) }}</span>
        <strong>{{ item.count }}</strong>
        <small>{{ total ? ((item.count / total) * 100).toFixed(1) : "0.0" }}%</small>
      </component>
    </div>
  </div>
  <div v-else class="dashboard-donut-empty" role="status">
    <el-empty :description="t('common.noData')" :image-size="42" />
  </div>
</template>
