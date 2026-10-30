<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatSystemDate } from "../system-settings";
import type { Rack } from "../types";
import { rackStatusLabel, rackStatusTone } from "../business-enums";
import StatusTag from "./StatusTag.vue";
import RackHint from "./RackHint.vue";

const props = defineProps<{
  rack: Rack;
  usedU: number;
  utilization: number;
  utilizationColor: string;
  canViewAssets?: boolean;
  selectedAssetId?: number | null;
}>();
const emit = defineEmits<{ "select-asset": [id: number] }>();
const { t } = useI18n();
const location = computed(() => [props.rack.data_center_name, props.rack.server_room_name].filter(Boolean).join(" / ") || t("common.notAvailable"));
const devices = computed(() => [...props.rack.allocations].sort((a, b) => b.end_u - a.end_u));
const freeU = computed(() => props.rack.free_u ?? Math.max(props.rack.total_u - props.usedU, 0));
const unavailable = () => t("common.notAvailable");
const expanded = ref(false);
watch(() => props.rack.id, () => { expanded.value = false; });
</script>

<template>
  <section class="rack-overview">
    <el-card class="rack-overview-card" shadow="never">
      <template #header>
        <div class="rack-overview-heading"><strong>{{ t('rack.basicInfo') }}</strong><el-button link type="primary" size="small" :aria-expanded="expanded" :aria-controls="`rack-basic-${rack.id}`" @click="expanded = !expanded">{{ t(expanded ? 'rack.collapseInfo' : 'rack.expandInfo') }}</el-button></div>
      </template>
      <dl :id="`rack-basic-${rack.id}`" class="rack-basic-info">
        <div><dt>{{ t('common.type') }}</dt><dd>{{ rack.rack_type || unavailable() }}</dd></div>
        <div><dt>{{ t('rack.owner') }}</dt><dd>{{ rack.owner_name || unavailable() }}</dd></div>
        <div v-if="rack.notes?.trim()"><dt>{{ t('common.notes') }}</dt><dd :class="{ 'rack-basic-info__notes--collapsed': !expanded }">{{ rack.notes }}</dd></div>
        <template v-if="expanded">
          <div><dt>{{ t('rack.rackCode') }}</dt><dd>{{ rack.code }}</dd></div>
          <div><dt>{{ t('rack.rackName') }}</dt><dd>{{ rack.name || unavailable() }}</dd></div>
          <div><dt>{{ t('common.location') }}</dt><dd class="rack-basic-info__location" :title="location">{{ location }}</dd></div>
          <div><dt>{{ t('rack.totalU') }}</dt><dd>{{ rack.total_u }} U</dd></div>
          <div><dt>{{ t('common.status') }}</dt><dd><StatusTag :tone="rackStatusTone(rack.status, rack.is_active)" :label="rackStatusLabel(rack.status, rack.is_active)" size="small" /></dd></div>
          <div><dt>{{ t('rack.createdAt') }}</dt><dd>{{ rack.created_at ? formatSystemDate(rack.created_at) : unavailable() }}</dd></div>
        </template>
      </dl>
    </el-card>
    <el-card class="rack-overview-card rack-occupancy-card" shadow="never">
      <template #header>
        <div class="rack-overview-heading"><strong>{{ t('rack.occupancy') }}</strong><span v-if="!rack.occupancy_restricted">{{ usedU }} / {{ rack.total_u }} U ({{ utilization }}%)</span></div>
      </template>
      <span v-if="rack.occupancy_restricted">{{ t('dataScope.notAuthorized') }}</span>
      <template v-else>
        <el-progress :percentage="utilization" :color="utilizationColor" :stroke-width="8" :show-text="false" />
        <div class="rack-overview-capacity"><span>{{ t('rack.availableU') }} {{ freeU }}U</span><span>{{ t('rackReserve.reservedU') }} {{ rack.reserved_u ?? 0 }}U</span></div>
      </template>
    </el-card>
    <el-card v-if="canViewAssets" class="rack-overview-card rack-installed-card" shadow="never">
      <template #header><strong>{{ t(rack.occupancy_restricted ? 'rack.visibleDevices' : 'rack.installedDevices') }} ({{ devices.length }})</strong></template>
      <div v-if="devices.length" class="rack-installed-scroll" tabindex="0" :aria-label="t('rack.installedDevices')">
        <table class="rack-installed-table">
          <thead><tr><th>{{ t('rack.uPosition') }}</th><th>{{ t('common.name') }}</th><th>{{ t('common.type') }}</th></tr></thead>
          <tbody><tr v-for="device in devices" :key="device.asset" :class="{ 'is-selected': selectedAssetId === device.asset }">
            <td>U{{ device.start_u }}–U{{ device.end_u }}</td>
            <td><RackHint :heading="device.asset_name || device.asset_no" :subtitle="device.asset_no" :fields="[{ label: t('common.type'), value: device.device_type_name || unavailable() }, { label: t('rack.uPosition'), value: `U${device.start_u}–U${device.end_u} · ${device.units}U` }]"><el-button link type="primary" @click="emit('select-asset', device.asset)">{{ device.asset_name || device.asset_no }}</el-button></RackHint></td>
            <td>{{ device.device_type_name || unavailable() }}</td>
          </tr></tbody>
        </table>
      </div>
      <el-empty v-else :image-size="40" :description="t(rack.occupancy_restricted ? 'rack.noVisibleDevices' : 'rack.noInstalledDevices')" />
    </el-card>
  </section>
</template>
