<script setup lang="ts">
import { computed, useSlots } from "vue";

const slots = useSlots();
const toolbarSlotNames = ["search", "primary-filter", "secondary-filter", "extra-filter", "actions"] as const;

// Slot presence, rather than invoking slot functions in setup, keeps
// conditional slots reactive when a page changes section/tab.  A declared
// slot that currently renders nothing simply leaves its grid track empty.
const hasSearch = computed(() => Boolean(slots.search));
const hasPrimaryFilter = computed(() => Boolean(slots["primary-filter"]));
const hasSecondaryFilter = computed(() => Boolean(slots["secondary-filter"]));
const hasExtraFilter = computed(() => Boolean(slots["extra-filter"]));
const hasActions = computed(() => Boolean(slots.actions));
const hasNamedSlots = computed(() => toolbarSlotNames.some((name) => Boolean(slots[name])));
const hasLegacyDefault = computed(() => Boolean(slots.default) && !hasNamedSlots.value);
</script>

<template>
  <div class="ep-toolbar page-toolbar">
    <div v-if="hasSearch" class="toolbar-slot toolbar-search">
      <slot name="search" />
    </div>
    <div v-if="hasPrimaryFilter" class="toolbar-slot toolbar-filter-primary">
      <slot name="primary-filter" />
    </div>
    <div v-if="hasSecondaryFilter" class="toolbar-slot toolbar-filter-secondary">
      <slot name="secondary-filter" />
    </div>
    <div v-if="hasExtraFilter" class="toolbar-slot toolbar-filter-extra">
      <slot name="extra-filter" />
    </div>
    <div class="toolbar-slot toolbar-spacer" aria-hidden="true" />
    <div v-if="hasActions" class="toolbar-slot toolbar-primary-action">
      <div class="page-toolbar__actions">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="hasLegacyDefault" class="toolbar-legacy">
      <slot />
    </div>
  </div>
</template>
