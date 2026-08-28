<script setup lang="ts">
defineProps<{
  total: number;
  currentPage: number;
  pageSize: number;
  pageSizes?: number[];
}>();

const emit = defineEmits<{
  "update:currentPage": [value: number];
  "update:pageSize": [value: number];
}>();
</script>

<template>
  <div class="paged-table">
    <slot />
    <div class="paged-table__footer">
      <el-pagination
        :current-page="currentPage"
        :page-size="pageSize"
        :total="total"
        :page-sizes="pageSizes || [20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @update:current-page="emit('update:currentPage', $event)"
        @update:page-size="emit('update:pageSize', $event)"
      />
    </div>
  </div>
</template>
