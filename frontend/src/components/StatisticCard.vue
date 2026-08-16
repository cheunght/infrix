<script setup lang="ts">
import type { Component } from "vue";

type StatisticTone = "blue" | "green" | "purple" | "orange" | "red" | "gray";

withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    unit?: string;
    subtitle?: string;
    tone?: StatisticTone;
    icon?: Component;
    iconImage?: string;
    iconAlt?: string;
    clickable?: boolean;
  }>(),
  {
    tone: "blue",
    unit: "",
    subtitle: "",
    iconAlt: "",
    clickable: false,
  },
);

const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <el-card
    shadow="never"
    class="statistic-card"
    :class="[`statistic-card--${tone}`, { 'is-clickable': clickable }]"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="clickable && emit('click')"
    @keydown.enter="clickable && emit('click')"
    @keydown.space.prevent="clickable && emit('click')"
  >
    <div class="statistic-card__body">
      <div class="statistic-card__icon" aria-hidden="true">
        <img v-if="iconImage" :src="iconImage" :alt="iconAlt" />
        <el-icon v-else-if="icon"><component :is="icon" /></el-icon>
      </div>
      <div class="statistic-card__content">
        <span class="statistic-card__label">{{ label }}</span>
        <div class="statistic-card__value">
          <strong>{{ value }}</strong>
          <small v-if="unit">{{ unit }}</small>
        </div>
        <span v-if="subtitle" class="statistic-card__subtitle">{{ subtitle }}</span>
      </div>
      <slot />
    </div>
  </el-card>
</template>
