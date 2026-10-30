<script setup lang="ts">
import PageHeader from "./PageHeader.vue";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    contentClass?: string;
    compactControls?: boolean;
    toolbarVisible?: boolean;
  }>(),
  {
    title: "",
    description: "",
    contentClass: "",
    compactControls: false,
    toolbarVisible: true,
  },
);

</script>

<template>
  <section
    class="page-container"
    :class="{
      'page-container--with-subnav': Boolean($slots.subnav),
      'page-container--with-toolbar': (props.toolbarVisible && Boolean($slots.toolbar)),
      'page-container--compact-controls': props.compactControls && Boolean($slots.subnav) && (props.toolbarVisible && Boolean($slots.toolbar)),
    }"
  >
    <div v-if="($slots.header || props.title || props.description)" class="page-container__header">
      <slot name="header">
        <PageHeader :title="title" :description="description" />
      </slot>
    </div>
    <div v-if="Boolean($slots.subnav)" class="page-container__subnav">
      <slot name="subnav" />
    </div>
    <div v-if="(props.toolbarVisible && Boolean($slots.toolbar))" class="page-container__toolbar">
      <slot name="toolbar" />
    </div>
    <div class="page-container__body" :class="contentClass">
      <slot />
    </div>
  </section>
</template>
