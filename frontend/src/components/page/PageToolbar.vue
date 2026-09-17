<script setup lang="ts">
import { computed, useSlots } from "vue";

const slots = useSlots();

// Slot presence, rather than invoking slot functions in setup, keeps
// conditional slots reactive when a page changes section/tab.  The wrapper
// groups below keep the left filter rail and right action rail independent.
const hasSearch = computed(() => Boolean(slots.search));
const hasFilters = computed(() => Boolean(slots.filters));
const hasActions = computed(() => Boolean(slots.actions));
const hasPrimary = computed(() => Boolean(slots.primary));
const hasLeftContent = computed(() => hasSearch.value || hasFilters.value);
const hasRightContent = computed(() => hasActions.value || hasPrimary.value);
</script>

<template>
  <div class="ep-toolbar page-toolbar">
    <div v-if="hasLeftContent" class="page-toolbar__left">
      <div v-if="hasSearch" class="toolbar-slot toolbar-search">
        <slot name="search" />
      </div>
      <div v-if="hasFilters" class="toolbar-slot toolbar-filters">
        <slot name="filters" />
      </div>
    </div>
    <div v-if="hasRightContent" class="page-toolbar__right">
      <div v-if="hasActions" class="toolbar-slot toolbar-secondary-actions">
        <div class="page-toolbar__actions">
          <slot name="actions" />
        </div>
      </div>
      <div v-if="hasPrimary" class="toolbar-slot toolbar-primary-action">
        <div class="page-toolbar__actions">
          <slot name="primary" />
        </div>
      </div>
    </div>
  </div>
</template>
