<script setup lang="ts">
import { Search } from "@element-plus/icons-vue";
import type { RackFiltersContext } from "../types/page-context";
const props = defineProps<{ context: RackFiltersContext }>();
const context = props.context;
const {
  dataCenters,
  selectedDataCenter,
  changeDataCenter,
  selectedRoom,
  changeRoom,
  roomOptions,
  selectedRack,
  changeRackFilter,
  selectedRackDeviceType,
  deviceTypes,
  resetRackFilters,
  exportRackLayout,
} = context;
</script>

<template>
  <section class="ep-toolbar rack-view-toolbar">
    <el-select
      v-model="selectedDataCenter"
      class="itam-filter-select"
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
      class="itam-filter-select"
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
    <el-input
      v-model="selectedRack"
      class="rack-code-filter"
      aria-label="机柜编号"
      placeholder="输入机柜编号"
      :prefix-icon="Search"
      clearable
      @keyup.enter="changeRackFilter"
      @clear="changeRackFilter"
    />
    <el-select
      v-model="selectedRackDeviceType"
      class="itam-filter-select"
      aria-label="设备类型"
      placeholder="全部设备类型"
      clearable
      @change="changeRackFilter"
    >
      <el-option label="全部设备类型" value="" />
      <el-option
        v-for="deviceType in deviceTypes"
        :key="deviceType.id"
        :label="deviceType.name"
        :value="deviceType.name"
      />
    </el-select>
    <span class="ep-toolbar-spacer" />
    <div class="ep-toolbar-actions">
      <el-button @click="resetRackFilters">重置</el-button>
      <el-button @click="exportRackLayout">导出机柜放置图</el-button>
    </div>
  </section>
</template>
