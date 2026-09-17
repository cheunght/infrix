<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: "",
    description: "",
  },
);
</script>

<template>
  <section class="page-section">
    <header v-if="title || description || $slots.actions" class="page-section__header">
      <div class="page-section__copy">
        <h3 v-if="title" class="page-section__title">{{ title }}</h3>
        <p v-if="description" class="page-section__description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="page-section__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="page-section__content">
      <slot />
    </div>
  </section>
</template>
