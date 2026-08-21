<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: "",
    description: "",
  },
);

// The shell already provides the page title on ordinary routes.  Only a
// header with a real description needs the two-line header rhythm.
const compact = computed(() => !props.description);
</script>

<template>
  <header class="page-header" :class="{ 'page-header--compact': compact }">
    <div class="page-header__leading">
      <div v-if="$slots.leading" class="page-header__leading-action">
        <slot name="leading" />
      </div>
      <div class="page-header__copy">
        <h2 v-if="title" class="page-header__title">{{ title }}</h2>
        <p v-if="description" class="page-header__description">{{ description }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>
