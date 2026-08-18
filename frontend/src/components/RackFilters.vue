<script setup lang="ts">
const props = defineProps<{ context: Record<string, any> }>();
const {
  dataCenters,
  selectedDataCenter,
  changeDataCenter,
  selectedRoom,
  changeRoom,
  roomOptions,
  selectedRack,
  changeRackFilter,
  rackOptions,
  selectedRackCategory,
  categories,
  resetRackFilters,
  exportRackLayout,
} = props.context;
</script>

<template>
  <section class="filters rack-filters">
    <el-select
      v-model="selectedDataCenter"
      class="rack-filter-select itam-filter-select"
      aria-label="数据中心"
      placeholder="全部数据中心"
      clearable
      @change="changeDataCenter"
    >
      <el-option label="全部数据中心" value="" />
      <el-option
        v-for="center in dataCenters"
        :key="center.id"
        :label="center.name"
        :value="String(center.id)"
      />
    </el-select>
    <el-select
      v-model="selectedRoom"
      class="rack-filter-select itam-filter-select"
      aria-label="机房"
      placeholder="全部机房"
      clearable
      @change="changeRoom"
    >
      <el-option label="全部机房" value="" />
      <el-option
        v-for="room in roomOptions"
        :key="room.id"
        :label="room.name"
        :value="room.id"
      />
    </el-select>
    <el-select
      v-model="selectedRack"
      class="rack-filter-select itam-filter-select"
      aria-label="机柜编号"
      placeholder="全部机柜"
      clearable
      @change="changeRackFilter"
    >
      <el-option label="全部机柜" value="" />
      <el-option v-for="code in rackOptions" :key="code" :label="code" :value="code" />
    </el-select>
    <el-select
      v-model="selectedRackCategory"
      class="rack-filter-select itam-filter-select"
      aria-label="设备分类"
      placeholder="全部分类"
      clearable
      @change="changeRackFilter"
    >
      <el-option label="全部分类" value="" />
      <el-option
        v-for="category in categories"
        :key="category.id"
        :label="category.name"
        :value="category.name"
      />
    </el-select>
    <div class="rack-filter-actions">
      <el-button class="rack-reset-button" @click="resetRackFilters">重置</el-button>
      <el-button class="rack-export-button" @click="exportRackLayout">导出机柜放置图</el-button>
    </div>
  </section>
</template>
