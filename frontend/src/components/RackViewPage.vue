<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CircleCheck, Grid, Histogram, OfficeBuilding } from "@element-plus/icons-vue";
import RackAssetInspector from "./RackAssetInspector.vue";
import RackFilters from "./RackFilters.vue";
import RackLayoutCanvas from "./RackLayoutCanvas.vue";
import RackListPanel from "./RackListPanel.vue";
import SearchField from "./SearchField.vue";
import StatisticCard from "./StatisticCard.vue";
import type { DataCenter, Rack, ServerRoom } from "../types";

const props = defineProps<{ context: Record<string, any> }>();
const context = props.context;
const rackSection = context.rackSection;
const dataCenters = context.dataCenters;
const serverRooms = context.serverRooms;
const racks = context.racks;
const facilitySummary = context.facilitySummary;
const can = context.can;
const openDataCenterModal = context.openDataCenterModal;
const openRoomModal = context.openRoomModal;
const openRackSection = context.openRackSection;
const focusViewRack = context.selectRack;
const rackDetailOpen = context.rackDetailOpen;
const rackViewStyle = context.rackViewStyle;
const detailAsset = context.detailAsset;
const detailLoading = context.detailLoading;
const detailError = context.detailError;
const closeAssetDetail = context.closeAssetDetail;

const dataCenterSearch = ref("");
const roomSearch = ref("");
const selectedDataCenterId = ref<number | null>(null);
const selectedRoomId = ref<number | null>(null);
const roomPage = ref(1);
const pageSize = ref(20);

const centers = computed<DataCenter[]>(() => dataCenters.value || []);
const rooms = computed<ServerRoom[]>(() => serverRooms.value || []);
const rackRows = computed<Rack[]>(() => racks.value || []);
const filteredCenters = computed(() => {
  const keyword = dataCenterSearch.value.trim().toLowerCase();
  return centers.value.filter((item) => !keyword || item.name.toLowerCase().includes(keyword));
});
const selectedCenter = computed(() => centers.value.find((item) => item.id === selectedDataCenterId.value) || filteredCenters.value[0] || null);
const filteredRooms = computed(() => {
  const keyword = roomSearch.value.trim().toLowerCase();
  return rooms.value.filter((item) =>
    (!selectedDataCenterId.value || item.data_center === selectedDataCenterId.value) &&
    (!keyword || item.name.toLowerCase().includes(keyword)),
  );
});
const pagedRooms = computed(() => filteredRooms.value.slice((roomPage.value - 1) * pageSize.value, roomPage.value * pageSize.value));
const selectedRoom = computed(() => rooms.value.find((item) => item.id === selectedRoomId.value) || filteredRooms.value[0] || null);
const roomRacks = computed(() => rackRows.value.filter((rack) => rack.room === selectedRoom.value?.id));
const statusLabel = (status?: string, active = true) => status === "reserved" ? "预留" : status === "disabled" || !active ? "停用" : "使用中";
const statusType = (status?: string, active = true) => status === "reserved" ? "warning" : status === "disabled" || !active ? "info" : "success";
const rackUsed = (rack: Rack) => rack.used_u ?? context.rackUsedU(rack);
const rackFree = (rack: Rack) => rack.free_u ?? Math.max(rack.total_u - rackUsed(rack), 0);
const summary = computed(() => facilitySummary.value || {
  rooms_total: rooms.value.length,
  rooms_in_use: rooms.value.filter((r) => r.is_active).length,
  rooms_disabled: rooms.value.filter((r) => !r.is_active).length,
  racks_total: rackRows.value.length,
  racks_in_use: rackRows.value.filter((r) => (r.status || (r.is_active === false ? "disabled" : "in_use")) === "in_use").length,
  total_u: rackRows.value.reduce((sum, rack) => sum + rack.total_u, 0),
  used_u: rackRows.value.reduce((sum, rack) => sum + rackUsed(rack), 0),
  free_u: rackRows.value.reduce((sum, rack) => sum + rackFree(rack), 0),
  rooms: [], racks: [],
});
const overallUtilization = computed(() => summary.value.total_u ? Math.round(summary.value.used_u / summary.value.total_u * 1000) / 10 : 0);

watch([centers, filteredCenters, rackSection], () => {
  if (!selectedDataCenterId.value || !filteredCenters.value.some((item) => item.id === selectedDataCenterId.value)) selectedDataCenterId.value = filteredCenters.value[0]?.id || null;
}, { immediate: true });
watch([filteredRooms, rackSection], () => {
  if (!selectedRoomId.value || !filteredRooms.value.some((item) => item.id === selectedRoomId.value)) selectedRoomId.value = filteredRooms.value[0]?.id || null;
  roomPage.value = Math.min(roomPage.value, Math.max(1, Math.ceil(filteredRooms.value.length / pageSize.value)));
}, { immediate: true });
function selectCenter(center: DataCenter) {
  closeAssetDetail();
  selectedDataCenterId.value = center.id;
  selectedRoomId.value = null;
  roomPage.value = 1;
}
function selectRoom(room: ServerRoom) {
  closeAssetDetail();
  selectedRoomId.value = room.id;
}
function openRackFromRoom(rack: Rack) {
  closeAssetDetail();
  selectedRoomId.value = rack.room;
  focusViewRack?.(rack);
  openRackSection("view");
}
</script>

<template>
  <div class="itam-page racks-page facility-management-page">
    <template v-if="rackSection === 'view'">
      <RackFilters :context="context" />
      <section class="rack-view-layout" :class="{ 'has-inspector': rackDetailOpen }" :style="rackViewStyle">
        <RackListPanel :context="context" /><RackLayoutCanvas :context="context" /><RackAssetInspector :context="context" />
      </section>
    </template>

    <template v-else-if="rackSection === 'rooms'">
      <section class="facility-stat-grid statistic-card-grid">
        <StatisticCard
          label="机房总数"
          :value="summary.rooms_total"
          subtitle="当前维护范围"
          tone="blue"
          :icon="OfficeBuilding"
        />
        <StatisticCard
          label="机柜总数"
          :value="summary.racks_total"
          :subtitle="`使用中 ${summary.racks_in_use} · 停用 ${summary.racks_total - summary.racks_in_use}`"
          tone="purple"
          :icon="Grid"
        />
        <StatisticCard
          label="机柜使用率"
          :value="`${overallUtilization}%`"
          :subtitle="`已用 ${summary.used_u} U · 可用 ${summary.free_u} U`"
          tone="green"
          :icon="Histogram"
        />
        <StatisticCard
          label="总 U 位数"
          :value="summary.total_u"
          unit="U"
          :subtitle="`已用 ${summary.used_u} U · 可用 ${summary.free_u} U`"
          tone="orange"
          :icon="CircleCheck"
        />
      </section>
      <section class="facility-three-column">
        <el-card shadow="never" class="facility-panel facility-center-panel">
          <template #header><div class="facility-panel-header"><strong>数据中心列表</strong><el-button v-if="can('racks.manage')" type="primary" size="small" @click="openDataCenterModal()">新增数据中心</el-button></div></template>
          <SearchField v-model="dataCenterSearch" placeholder="搜索数据中心" aria-label="搜索数据中心" />
          <div class="facility-list"><div v-for="center in filteredCenters" :key="center.id" class="facility-list-item" role="button" tabindex="0" :class="{ active: selectedCenter?.id === center.id }" @click="selectCenter(center)" @keydown.enter="selectCenter(center)" @keydown.space.prevent="selectCenter(center)"><span>{{ center.name }}</span><div class="facility-list-meta"><em>{{ center.rooms_count || 0 }}</em><el-button v-if="can('racks.manage')" link type="primary" @click.stop="openDataCenterModal(center)">编辑</el-button></div></div><el-empty v-if="!filteredCenters.length" description="暂无数据中心" /></div>
        </el-card>
        <el-card shadow="never" class="facility-panel facility-room-panel">
          <template #header><div class="facility-panel-header"><strong>机房列表<span v-if="selectedCenter">（{{ selectedCenter.name }}）</span></strong><el-button v-if="can('racks.manage')" type="primary" size="small" @click="openRoomModal()">新增机房</el-button></div></template>
          <SearchField v-model="roomSearch" placeholder="搜索机房名称" aria-label="搜索机房名称" />
          <el-table :data="pagedRooms" table-layout="fixed" class="facility-table" highlight-current-row @row-click="selectRoom">
            <el-table-column prop="name" label="机房名称" min-width="130" show-overflow-tooltip /><el-table-column prop="data_center_name" label="数据中心" min-width="120" show-overflow-tooltip /><el-table-column prop="racks_count" label="机柜" width="62" /><el-table-column prop="assets_count" label="设备" width="62" /><el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.is_active ? 'success' : 'info'" size="small">{{ row.is_active ? '使用中' : '停用' }}</el-tag></template></el-table-column><el-table-column v-if="can('racks.manage')" label="操作" width="122" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><el-button link type="primary" @click.stop="openRoomModal(row)">编辑</el-button><el-button link type="danger" @click.stop="context.deleteRoom(row)">删除</el-button></div></template></el-table-column>
          </el-table>
          <el-pagination v-model:current-page="roomPage" small layout="total, prev, next" :total="filteredRooms.length" />
        </el-card>
        <el-card shadow="never" class="facility-panel facility-detail-panel">
          <template #header><div class="facility-panel-header"><strong>机房详情</strong><el-button v-if="selectedRoom && can('racks.manage')" link type="primary" @click="openRoomModal(selectedRoom)">编辑</el-button></div></template>
          <template v-if="selectedRoom">
            <div class="facility-detail-grid"><div><span>机房名称</span><strong>{{ selectedRoom.name }}</strong></div><div><span>所属数据中心</span><strong>{{ selectedRoom.data_center_name }}</strong></div><div><span>机柜数量</span><strong>{{ selectedRoom.racks_count || 0 }}</strong></div><div><span>设备数量</span><strong>{{ selectedRoom.assets_count || 0 }}</strong></div><div><span>状态</span><el-tag :type="selectedRoom.is_active ? 'success' : 'info'">{{ selectedRoom.is_active ? '使用中' : '停用' }}</el-tag></div><div><span>创建时间</span><strong>{{ selectedRoom.created_at ? new Date(selectedRoom.created_at).toLocaleDateString('zh-CN') : '—' }}</strong></div><div><span>负责人</span><strong>{{ selectedRoom.owner_name || '—' }}</strong></div><div><span>联系电话</span><strong>{{ selectedRoom.contact_phone || '—' }}</strong></div><div class="full"><span>备注</span><strong>{{ selectedRoom.notes || '—' }}</strong></div></div>
            <div class="facility-subtitle">机柜布局图</div><div class="room-rack-layout"><button v-for="rack in roomRacks" :key="rack.id" class="room-rack-card" :class="`status-${rack.status || 'in_use'}`" :title="`${rack.code} · 已用 ${rackUsed(rack)} U / ${rack.total_u} U · ${rack.allocations?.length || 0} 台设备`" @click="openRackFromRoom(rack)"><strong>{{ rack.code }}</strong><small>{{ rackUsed(rack) }}/{{ rack.total_u }} U · {{ rack.allocations?.length || 0 }} 台</small></button><el-empty v-if="!roomRacks.length" description="该机房暂无机柜" /></div>
          </template><el-empty v-else description="请选择机房查看详情" />
        </el-card>
      </section>
    </template>

  </div>
</template>
