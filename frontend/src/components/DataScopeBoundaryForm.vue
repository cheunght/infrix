<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { DataScopeBoundary } from "../types";
import type { RequestFn } from "../page-context";
import SearchableSelect from "./SearchableSelect.vue";

const props = defineProps<{ boundary: DataScopeBoundary; request: RequestFn;
  centerOptions: {id:number;name:string}[]; departmentOptions: {id:number;name:string}[] }>();
const { t } = useI18n();
const option = (item: Record<string, unknown>) => ({value:Number(item.id),label:String(item.name)});
const selected = (values: number[], options: {id:number;name:string}[]) => options.filter(item=>values.includes(item.id)).map(item=>({value:item.id,label:item.name}));
</script>

<template>
  <el-form-item :label="t('dataScope.readCenters')"><SearchableSelect v-model="props.boundary.read_data_centers" :selected-options="selected(boundary.read_data_centers, centerOptions)" :request="request" endpoint="/data-centers/" :map-option="option" :base-query="{is_active:'all'}" multiple clearable /></el-form-item>
  <el-form-item :label="t('dataScope.writeCenters')"><SearchableSelect v-model="props.boundary.write_data_centers" :selected-options="selected(boundary.write_data_centers, centerOptions)" :request="request" endpoint="/data-centers/" :map-option="option" :base-query="{is_active:'all'}" multiple clearable /></el-form-item>
  <el-form-item><el-checkbox v-model="props.boundary.unlocated_read">{{ t('dataScope.unlocatedRead') }}</el-checkbox><el-checkbox v-model="props.boundary.unlocated_write">{{ t('dataScope.unlocatedWrite') }}</el-checkbox></el-form-item>
  <el-form-item :label="t('dataScope.readDepartments')"><SearchableSelect v-model="props.boundary.read_departments" :selected-options="selected(boundary.read_departments, departmentOptions)" :request="request" endpoint="/departments/" :map-option="option" multiple clearable /></el-form-item>
  <el-form-item :label="t('dataScope.writeDepartments')"><SearchableSelect v-model="props.boundary.write_departments" :selected-options="selected(boundary.write_departments, departmentOptions)" :request="request" endpoint="/departments/" :map-option="option" multiple clearable /></el-form-item>
  <el-form-item><el-checkbox v-model="props.boundary.all_departments_read">{{ t('dataScope.allDepartmentsRead') }}</el-checkbox><el-checkbox v-model="props.boundary.all_departments_write">{{ t('dataScope.allDepartmentsWrite') }}</el-checkbox></el-form-item>
  <el-form-item><el-checkbox v-model="props.boundary.unowned_read">{{ t('dataScope.unownedRead') }}</el-checkbox><el-checkbox v-model="props.boundary.unowned_write">{{ t('dataScope.unownedWrite') }}</el-checkbox></el-form-item>
</template>
