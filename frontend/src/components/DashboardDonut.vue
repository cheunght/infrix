<script setup lang="ts">
import { computed } from "vue";

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
  }>(),
  { centerLabel: "总数" },
);
defineEmits<{ select: [item: DonutItem] }>();

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
  <div class="dashboard-donut-layout">
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
      <div class="dashboard-legend-header" aria-hidden="true">
        <span></span>
        <span>状态</span>
        <span>数量</span>
        <span>占比</span>
      </div>
      <button
        v-for="item in items"
        :key="item.key || item.label"
        type="button"
        class="dashboard-legend-item"
        @click="$emit('select', item)"
      >
        <i :style="{ backgroundColor: item.color }" aria-hidden="true"></i>
        <span>{{ item.label }}</span>
        <strong>{{ item.count }}</strong>
        <small>{{ total ? ((item.count / total) * 100).toFixed(1) : "0.0" }}%</small>
      </button>
      <el-empty v-if="!items.length || !total" description="暂无数据" :image-size="42" />
    </div>
  </div>
</template>
