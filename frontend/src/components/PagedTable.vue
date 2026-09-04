<script setup lang="ts">
defineProps<{
  total: number;
  currentPage: number;
  pageSize: number;
  pageSizes?: number[];
  disabled?: boolean;
  hideOnSinglePage?: boolean;
  layout?: string;
  size?: "large" | "default" | "small";
}>();

const emit = defineEmits<{
  "update:currentPage": [value: number];
  "update:pageSize": [value: number];
}>();
</script>

<template>
  <div class="paged-table">
    <slot />
    <div v-if="!hideOnSinglePage || total > pageSize" class="paged-table__footer">
      <el-pagination
        :current-page="currentPage"
        :disabled="disabled"
        :hide-on-single-page="hideOnSinglePage"
        :page-size="pageSize"
        :total="total"
        :page-sizes="pageSizes || [20, 50, 100]"
        :layout="layout || 'total, sizes, prev, pager, next'"
        :size="size"
        @update:current-page="emit('update:currentPage', $event)"
        @update:page-size="emit('update:pageSize', $event)"
      />
    </div>
  </div>
</template>
