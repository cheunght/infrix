<script setup lang="ts">
import { computed, useSlots } from "vue";
import PageHeader from "./PageHeader.vue";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    contentClass?: string;
  }>(),
  {
    title: "",
    description: "",
    contentClass: "",
  },
);

const slots = useSlots();
const hasHeader = computed(() => Boolean(slots.header || props.title || props.description));
const hasSubnav = computed(() => Boolean(slots.subnav));
const hasToolbar = computed(() => Boolean(slots.toolbar));
</script>

<template>
  <section
    class="page-container"
    :class="{
      'page-container--with-subnav': hasSubnav,
      'page-container--with-toolbar': hasToolbar,
      'page-container--compact-controls': hasSubnav && hasToolbar,
    }"
  >
    <div v-if="hasHeader" class="page-container__header">
      <slot name="header">
        <PageHeader :title="title" :description="description" />
      </slot>
    </div>
    <div v-if="hasSubnav" class="page-container__subnav">
      <slot name="subnav" />
    </div>
    <div v-if="hasToolbar" class="page-container__toolbar">
      <slot name="toolbar" />
    </div>
    <div class="page-container__body" :class="contentClass">
      <slot />
    </div>
  </section>
</template>
