<script setup lang="ts">
import { computed, useSlots } from "vue";

const slots = useSlots();
const hasActions = computed(() => Boolean(slots.actions));
</script>

<template>
  <div class="ep-toolbar page-toolbar">
    <slot />
    <span v-if="hasActions" class="ep-toolbar-spacer" aria-hidden="true" />
    <div v-if="hasActions" class="ep-toolbar-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
