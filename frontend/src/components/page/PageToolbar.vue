<template>
  <div class="ep-toolbar page-toolbar">
    <div v-if="$slots.search || $slots.filters" class="page-toolbar__left">
      <div v-if="$slots.search" class="toolbar-slot toolbar-search">
        <slot name="search" />
      </div>
      <div v-if="$slots.filters" class="toolbar-slot toolbar-filters">
        <slot name="filters" />
      </div>
    </div>
    <div v-if="$slots.actions || $slots.primary" class="page-toolbar__right">
      <div v-if="$slots.actions" class="toolbar-slot toolbar-secondary-actions">
        <div class="page-toolbar__actions">
          <slot name="actions" />
        </div>
      </div>
      <div v-if="$slots.primary" class="toolbar-slot toolbar-primary-action">
        <div class="page-toolbar__actions">
          <slot name="primary" />
        </div>
      </div>
    </div>
  </div>
</template>
