<script setup lang="ts">
withDefaults(
  defineProps<{
    surface?: boolean;
    minHeight?: string;
  }>(),
  {
    surface: false,
    minHeight: "0px",
  },
);
</script>

<template>
  <section
    class="page-content"
    :class="{ 'page-content--surface': surface }"
    :style="{ '--page-content-min-height': minHeight }"
  >
    <slot />
  </section>
</template>
