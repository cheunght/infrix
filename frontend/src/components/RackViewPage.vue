<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CircleCheck, Grid, Histogram, MoreFilled, OfficeBuilding } from "@element-plus/icons-vue";
import RackAssetInspector from "./RackAssetInspector.vue";
import RackFilters from "./RackFilters.vue";
import RackFormDialog from "./RackFormDialog.vue";
import RackLayoutCanvas from "./RackLayoutCanvas.vue";
import RackListPanel from "./RackListPanel.vue";
import SearchField from "./SearchField.vue";
import StatisticCard from "./StatisticCard.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageHeader from "./page/PageHeader.vue";
import StatusTag from "./StatusTag.vue";
import type { DataCenter, Rack, RackStatus, ServerRoom } from "../types";
import type { RackSharedContext } from "../types/page-context";

const props = defineProps<{ context: RackSharedContext }>();
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
const deletingRackId = context.deletingRackId;
const updatingRackId = context.updatingRackId;

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

function rackStatusCode(rack: Rack): RackStatus {
  return rack.status === "reserved" || rack.status === "disabled" ? rack.status : "in_use";
}

function handleRackCommand(rack: Rack, command: string) {
  if (command === "delete") {
    void context.deleteRack(rack);
    return;
  }
  if (command === "in_use" || command === "reserved" || command === "disabled") {
    void context.updateRackStatus(rack, command);
  }
}
</script>

<template>
  <div class="itam-page racks-page facility-management-page">
    <template v-if="rackSection === 'view'">
      <PageContainer>
        <template #header><PageHeader description="按数据中心、机房和机柜查看设备 U 位占用" /></template>
        <PageContent>
          <RackFilters :context="context" />
          <section class="rack-view-layout" :class="{ 'has-inspector': rackDetailOpen }" :style="rackViewStyle">
            <RackListPanel :context="context" /><RackLayoutCanvas :context="context" /><RackAssetInspector :context="context" />
          </section>
        </PageContent>
      </PageContainer>
    </template>

    <template v-else-if="rackSection === 'rooms'">
      <PageContainer>
        <template #header><PageHeader description="维护数据中心、机房和机柜基础资源" /></template>
        <PageContent>
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
          <SearchField class="itam-filter-search" v-model="dataCenterSearch" placeholder="搜索数据中心" aria-label="搜索数据中心" />
          <div class="facility-list"><div v-for="center in filteredCenters" :key="center.id" class="facility-list-item" role="button" tabindex="0" :class="{ active: selectedCenter?.id === center.id }" @click="selectCenter(center)" @keydown.enter="selectCenter(center)" @keydown.space.prevent="selectCenter(center)"><span>{{ center.name }}</span><div class="facility-list-meta"><em>{{ center.rooms_count || 0 }}</em><el-button v-if="can('racks.manage')" link type="primary" @click.stop="openDataCenterModal(center)">编辑</el-button></div></div><el-empty v-if="!filteredCenters.length" description="暂无数据中心" /></div>
        </el-card>
        <el-card shadow="never" class="facility-panel facility-room-panel">
          <template #header><div class="facility-panel-header"><strong>机房列表<span v-if="selectedCenter">（{{ selectedCenter.name }}）</span></strong><el-button v-if="can('racks.manage')" type="primary" size="small" @click="openRoomModal()">新增机房</el-button></div></template>
          <SearchField class="itam-filter-search" v-model="roomSearch" placeholder="搜索机房名称" aria-label="搜索机房名称" />
          <el-table :data="pagedRooms" table-layout="fixed" class="facility-table" highlight-current-row @row-click="selectRoom">
            <el-table-column prop="name" label="机房名称" min-width="130" show-overflow-tooltip /><el-table-column prop="data_center_name" label="数据中心" min-width="120" show-overflow-tooltip /><el-table-column prop="racks_count" label="机柜" width="62" /><el-table-column prop="assets_count" label="设备" width="62" /><el-table-column label="状态" width="80"><template #default="{ row }"><StatusTag :type="row.is_active ? 'success' : 'info'" :label="row.is_active ? '使用中' : '停用'" /></template></el-table-column><el-table-column v-if="can('racks.manage')" label="操作" width="122" fixed="right"><template #default="{ row }"><div class="ep-table-actions"><el-button link type="primary" @click.stop="openRoomModal(row)">编辑</el-button><el-button link type="danger" @click.stop="context.deleteRoom(row)">删除</el-button></div></template></el-table-column>
          </el-table>
          <el-pagination v-model:current-page="roomPage" size="small" layout="total, prev, next" :total="filteredRooms.length" />
        </el-card>
        <el-card shadow="never" class="facility-panel facility-detail-panel">
          <template #header><div class="facility-panel-header"><strong>机房详情</strong><div class="facility-panel-header-actions"><el-button v-if="selectedRoom && can('racks.manage')" type="primary" plain size="small" :disabled="!selectedRoom.is_active" :title="selectedRoom.is_active ? '在当前机房新增机柜' : '停用机房不能新增机柜'" @click="context.openRackModal(undefined, selectedRoom)">新增机柜</el-button><el-button v-if="selectedRoom && can('racks.manage')" link type="primary" @click="openRoomModal(selectedRoom)">编辑机房</el-button></div></div></template>
          <template v-if="selectedRoom">
            <div class="facility-detail-grid"><div><span>机房名称</span><strong>{{ selectedRoom.name }}</strong></div><div><span>所属数据中心</span><strong>{{ selectedRoom.data_center_name }}</strong></div><div><span>机柜数量</span><strong>{{ selectedRoom.racks_count || 0 }}</strong></div><div><span>设备数量</span><strong>{{ selectedRoom.assets_count || 0 }}</strong></div><div><span>状态</span><StatusTag :type="selectedRoom.is_active ? 'success' : 'info'" :label="selectedRoom.is_active ? '使用中' : '停用'" /></div><div><span>创建时间</span><strong>{{ selectedRoom.created_at ? new Date(selectedRoom.created_at).toLocaleDateString('zh-CN') : '—' }}</strong></div><div><span>负责人</span><strong>{{ selectedRoom.owner_name || '—' }}</strong></div><div><span>联系电话</span><strong>{{ selectedRoom.contact_phone || '—' }}</strong></div><div class="full"><span>备注</span><strong>{{ selectedRoom.notes || '—' }}</strong></div></div>
            <div class="facility-subtitle">机柜布局图</div><div class="room-rack-layout"><div v-for="rack in roomRacks" :key="rack.id" class="room-rack-card-wrap"><button class="room-rack-card" :class="`status-${rackStatusCode(rack)}`" :title="`${rack.code} · ${rack.name || '未命名'} · 已用 ${rackUsed(rack)} U / ${rack.total_u} U · ${rack.allocations?.length || 0} 台设备`" @click="openRackFromRoom(rack)"><span class="room-rack-card-title"><strong>{{ rack.code }}</strong><small v-if="rack.name">{{ rack.name }}</small></span><small>{{ rackUsed(rack) }}/{{ rack.total_u }} U · {{ rack.allocations?.length || 0 }} 台</small><StatusTag :type="statusType(rack.status, rack.is_active)" :label="statusLabel(rack.status, rack.is_active)" /></button><div v-if="can('racks.manage')" class="room-rack-card-actions"><el-button link type="primary" size="small" :disabled="deletingRackId === rack.id || updatingRackId === rack.id" @click.stop="context.openRackModal(rack, selectedRoom || undefined)">编辑</el-button><el-dropdown trigger="click" :disabled="deletingRackId === rack.id || updatingRackId === rack.id" @command="(command: string) => handleRackCommand(rack, command)"><el-button link size="small" :disabled="deletingRackId === rack.id || updatingRackId === rack.id" @click.stop><span>更多</span><el-icon><MoreFilled /></el-icon></el-button><template #dropdown><el-dropdown-menu><el-dropdown-item v-if="rackStatusCode(rack) !== 'in_use'" command="in_use">设为使用中</el-dropdown-item><el-dropdown-item v-if="rackStatusCode(rack) !== 'reserved'" command="reserved">设为预留</el-dropdown-item><el-dropdown-item v-if="rackStatusCode(rack) !== 'disabled'" command="disabled">设为停用</el-dropdown-item><el-dropdown-item divided command="delete">删除</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></div><el-empty v-if="!roomRacks.length" description="该机房暂无机柜" /></div>
          </template><el-empty v-else description="请选择机房查看详情" />
        </el-card>
        </section>
        </PageContent>
      </PageContainer>
    </template>

    <RackFormDialog :context="context" />
  </div>
</template>
