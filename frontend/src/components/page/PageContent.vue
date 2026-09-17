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
  <el-card
    v-if="surface"
    shadow="never"
    class="page-content page-content--surface"
    :style="{ '--page-content-min-height': minHeight }"
  >
    <slot />
  </el-card>
  <section
    v-else
    class="page-content"
    :style="{ '--page-content-min-height': minHeight }"
  >
    <slot />
  </section>
</template>
