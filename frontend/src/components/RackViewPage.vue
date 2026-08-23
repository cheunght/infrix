<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowRight, Box, MoreFilled } from "@element-plus/icons-vue";
import RackAssetInspector from "./RackAssetInspector.vue";
import RackFormDialog from "./RackFormDialog.vue";
import RackLayoutCanvas from "./RackLayoutCanvas.vue";
import RackListPanel from "./RackListPanel.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import type { Rack, RackStatus, ServerRoom } from "../types";
import type { RackSharedContext } from "../types/page-context";

const props = defineProps<{ context: RackSharedContext }>();
const context = props.context;
const rackSection = context.rackSection;
const serverRooms = context.serverRooms;
const racks = context.racks;
const can = context.can;
const dataCenters = context.dataCenters;
const roomManagementSearch = context.roomManagementSearch;
const roomManagementDataCenter = context.roomManagementDataCenter;
const roomManagementPage = context.roomManagementPage;
const roomManagementPageSize = context.roomManagementPageSize;
const roomManagementCount = context.roomManagementCount;
const rackManagementLoading = context.rackManagementLoading;
const roomManagementError = context.roomManagementError;
const rackManagementError = context.rackManagementError;
const facilitySummary = context.facilitySummary;
const updatingRoomId = context.updatingRoomId;
const selectedDataCenter = context.selectedDataCenter;
const selectedRoom = context.selectedRoom;
const selectedRack = context.selectedRack;
const selectedRackDeviceType = context.selectedRackDeviceType;
const roomOptions = context.roomOptions;
const deviceTypes = context.deviceTypes;
const rackViewStyle = context.rackViewStyle;
const rackListLoading = context.rackListLoading;
const rackListError = context.rackListError;
const deletingRackId = context.deletingRackId;
const updatingRackId = context.updatingRackId;

const rooms = computed<ServerRoom[]>(() => serverRooms.value || []);
const rackRows = computed<Rack[]>(() => racks.value || []);
const selectedRoomId = ref<number | null>(null);
const showRackInfo = ref(false);

const managementRoom = computed(() =>
  rooms.value.find((room) => room.id === selectedRoomId.value) || null,
);
const viewRoom = computed(() =>
  rooms.value.find((room) => String(room.id) === context.selectedRoom.value)
    || (context.focusedRack.value
      ? rooms.value.find((room) => room.id === context.focusedRack.value?.room)
      : null)
    || null,
);
const roomRacks = computed(() =>
  rackRows.value.filter((rack) => rack.room === managementRoom.value?.id),
);
const roomCapacityById = computed(() => {
  const capacity = new Map<number, { total: number; used: number; free: number }>();
  for (const room of rooms.value) {
    const roomRackRows = rackRows.value.filter((rack) => rack.room === room.id);
    const total = roomRackRows.reduce((sum, rack) => sum + Number(rack.total_u || 0), 0);
    const used = roomRackRows.reduce((sum, rack) => sum + context.rackUsedU(rack), 0);
    capacity.set(room.id, { total, used, free: Math.max(total - used, 0) });
  }
  for (const room of facilitySummary.value?.rooms || []) {
    const total = Number(room.total_u || 0);
    const used = Number(room.used_u || 0);
    capacity.set(room.id, { total, used, free: Math.max(total - used, 0) });
  }
  return capacity;
});
const currentRack = context.focusedRack;
const currentRackHasAssets = computed(() => Boolean(
  currentRack.value?.assets_count || currentRack.value?.allocations?.length,
));

const statusLabel = (status?: string, active = true) =>
  status === "reserved" ? "预留" : status === "disabled" || !active ? "停用" : "使用中";
const statusType = (status?: string, active = true) =>
  status === "reserved" ? "warning" : status === "disabled" || !active ? "info" : "success";
const rackUsed = (rack: Rack) => rack.used_u ?? context.rackUsedU(rack);
const rackUtilization = (rack: Rack) =>
  rack.total_u > 0 ? Math.min(100, Math.round((rackUsed(rack) / rack.total_u) * 100)) : 0;
const relationDeleteHint = "请先迁移/移除关联资源后再删除";
const rackDeleteHint = "该机柜仍有资产占用，请先迁移或解除资产位置后再删除";

function roomCapacity(room: ServerRoom) {
  return roomCapacityById.value.get(room.id) || { total: 0, used: 0, free: 0 };
}

function rackStatusCode(rack: Rack): RackStatus {
  return rack.status === "reserved" || rack.status === "disabled" ? rack.status : "in_use";
}

function rackStatusActionLabel(rack: Rack) {
  return rackStatusCode(rack) === "disabled" ? "启用" : "停用";
}

function rackStatusAction(rack: Rack): RackStatus {
  return rackStatusCode(rack) === "disabled" ? "in_use" : "disabled";
}

function rackLocationLabel(rack: Rack | null) {
  return [rack?.data_center_name, rack?.server_room_name].filter(Boolean).join(" / ") || "未关联位置";
}

function roomStatusAction(room: ServerRoom) {
  return room.is_active ? "停用" : "启用";
}

function formatRackDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}

watch(
  [rooms, rackSection],
  () => {
    if (rackSection.value !== "rooms") return;
    const stillVisible = rooms.value.some((room) => room.id === selectedRoomId.value);
    const nextId = stillVisible ? selectedRoomId.value : rooms.value[0]?.id || null;
    if (nextId !== selectedRoomId.value) {
      selectedRoomId.value = nextId;
      context.closeAssetDetail();
    }
  },
  { immediate: true },
);

watch(currentRack, () => {
  showRackInfo.value = false;
});

function selectRoom(room: ServerRoom) {
  selectedRoomId.value = room.id;
  context.closeAssetDetail();
}

function openRackFromRoom(rack: Rack) {
  context.selectedDataCenter.value = "";
  context.selectedRoom.value = String(rack.room);
  context.selectedRack.value = "";
  context.rackPage.value = 1;
  context.selectRack(rack);
  context.openRackSection("view", {
    room: String(rack.room),
    rack: String(rack.id),
    rack_code: rack.code,
  });
}

function changeViewRoom(value: string | number | null | undefined) {
  const roomId = value == null ? "" : String(value);
  context.selectedRoom.value = roomId;
  context.selectedRack.value = "";
  context.focusedRackId.value = null;
  context.rackPage.value = 1;
  context.openRackSection("view", roomId ? { room: roomId } : {});
}

function handleRoomCommand(command: string) {
  const room = managementRoom.value;
  if (!room) return;
  if (command === "edit") {
    context.openRoomModal(room);
    return;
  }
  if (command === "delete") {
    if (!room.racks_count && !room.assets_count) void context.deleteRoom(room);
    return;
  }
  if (command === "enable" || command === "disable") {
    void context.updateRoomStatus(room, command === "enable");
  }
}

function handleRackCommand(rack: Rack, command: string) {
  if (command === "view") {
    openRackFromRoom(rack);
    return;
  }
  if (command === "delete") {
    if (!rack.allocations.length) void context.deleteRack(rack);
    return;
  }
  if (command === "in_use" || command === "reserved" || command === "disabled") {
    void context.updateRackStatus(rack, command);
  }
}

function handleCurrentRackCommand(command: string) {
  const rack = currentRack.value;
  if (!rack) return;
  if (command === "info") {
    showRackInfo.value = true;
    return;
  }
  if (command === "export") {
    void context.exportRackLayout();
    return;
  }
  if (command === "delete") {
    if (!currentRackHasAssets.value) void context.deleteRack(rack);
    return;
  }
  if (command === "in_use" || command === "reserved" || command === "disabled") {
    void context.updateRackStatus(rack, command);
  }
}
</script>

<template>
  <div class="itam-page racks-page facility-management-page">
    <PageContainer class="racks-module-page" :toolbar-visible="rackSection !== 'rooms'">
      <template #toolbar>
        <PageToolbar class="racks-resource-toolbar">
          <el-select
            v-model="selectedDataCenter"
            class="resource-toolbar-select"
            placeholder="数据中心"
            aria-label="按数据中心筛选机柜"
            clearable
            @change="context.changeDataCenter"
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
            class="resource-toolbar-select"
            placeholder="机房"
            aria-label="选择机房"
            :disabled="!roomOptions.length"
            @change="changeViewRoom"
          >
            <el-option label="全部机房" value="" />
            <el-option
              v-for="room in roomOptions"
              :key="room.id"
              :label="room.name"
              :value="room.id"
            />
          </el-select>
          <SearchField
            v-model="selectedRack"
            class="resource-toolbar-search"
            placeholder="搜索机柜"
            aria-label="搜索机柜名称或编号"
            @search="context.changeRackFilter"
          />
          <el-select
            v-model="selectedRackDeviceType"
            class="resource-toolbar-select resource-toolbar-select--device"
            placeholder="设备类型"
            aria-label="按设备类型筛选机柜"
            clearable
            @change="context.changeRackFilter"
          >
            <el-option label="全部设备类型" value="" />
            <el-option
              v-for="deviceType in deviceTypes"
              :key="deviceType.id"
              :label="deviceType.name"
              :value="deviceType.name"
            />
          </el-select>
          <template #actions>
            <el-button
              v-if="viewRoom && can('racks.manage')"
              type="primary"
              plain
              @click="context.openRackModal(undefined, viewRoom)"
            >
              新增机柜
            </el-button>
          </template>
        </PageToolbar>
      </template>

      <PageContent min-height="0">
        <section
          v-if="rackSection === 'rooms'"
          class="resource-workspace resource-workspace--rooms"
          aria-label="机房资源管理"
        >
          <el-card class="resource-panel resource-master-panel resource-room-master" shadow="never">
            <template #header>
              <div class="resource-panel-header">
                <div class="resource-panel-heading">
                  <strong>机房列表</strong>
                </div>
                <el-button
                  v-if="can('racks.manage')"
                  type="primary"
                  size="small"
                  @click="context.openRoomModal()"
                >新增</el-button>
              </div>
            </template>
            <div class="resource-room-master-controls">
              <el-select
                v-model="roomManagementDataCenter"
                class="resource-room-filter"
                placeholder="数据中心"
                aria-label="按数据中心筛选机房"
                clearable
                @change="context.changeRoomManagementDataCenter"
              >
                <el-option label="全部数据中心" value="" />
                <el-option
                  v-for="center in dataCenters"
                  :key="center.id"
                  :label="center.name"
                  :value="String(center.id)"
                />
              </el-select>
              <span class="resource-room-count">共 {{ roomManagementCount }} 个机房</span>
              <SearchField
                v-model="roomManagementSearch"
                class="resource-room-search"
                placeholder="搜索机房名称或编号"
                aria-label="搜索机房名称或编号"
                @search="context.changeRoomManagementSearch"
              />
            </div>
            <div class="resource-list-area">
              <template v-if="rackManagementLoading">
                <el-skeleton :rows="6" animated />
              </template>
              <div v-else-if="roomManagementError" class="resource-panel-state resource-panel-error" role="alert">
                <strong>机房加载失败</strong>
                <span>{{ roomManagementError }}</span>
                <el-button type="primary" plain size="small" @click="context.retryRackManagement">重新加载</el-button>
              </div>
              <div v-else-if="!rooms.length" class="resource-panel-empty">
                <el-empty :image-size="56" description="暂无机房" />
              </div>
              <div v-else class="resource-list resource-room-card-list" role="listbox" aria-label="机房列表">
                <button
                  v-for="room in rooms"
                  :key="room.id"
                  type="button"
                  class="resource-room-card"
                  :class="{ active: managementRoom?.id === room.id }"
                  :aria-current="managementRoom?.id === room.id ? 'true' : undefined"
                  @click="selectRoom(room)"
                >
                  <div class="resource-room-card-content">
                    <div class="resource-room-card-title">
                      <strong>{{ room.name }}</strong>
                      <StatusTag :type="room.is_active ? 'success' : 'info'" :label="room.is_active ? '使用中' : '停用'" />
                    </div>
                    <span>总 U 数：{{ roomCapacity(room).total }}U</span>
                    <div class="resource-room-card-capacity">
                      <span>已用：{{ roomCapacity(room).used }}U</span>
                      <span>可用：{{ roomCapacity(room).free }}U</span>
                    </div>
                  </div>
                  <el-icon class="resource-room-card-icon"><Box /></el-icon>
                  <el-icon class="resource-room-card-arrow"><ArrowRight /></el-icon>
                </button>
              </div>
            </div>
            <el-pagination
              v-if="roomManagementCount > roomManagementPageSize"
              v-model:current-page="roomManagementPage"
              class="resource-pagination"
              size="small"
              layout="prev, pager, next"
              :page-size="roomManagementPageSize"
              :total="roomManagementCount"
              @current-change="context.changeRoomManagementPage"
            />
          </el-card>

          <el-card class="resource-panel resource-detail-panel resource-room-detail" shadow="never">
            <template #header>
              <div class="resource-detail-header">
                <div class="resource-detail-title">
                  <strong>{{ managementRoom?.name || "机房详情" }}</strong>
                </div>
                <div v-if="managementRoom && can('racks.manage')" class="resource-detail-actions">
                  <el-button
                    link
                    type="primary"
                    :disabled="updatingRoomId === managementRoom.id"
                    @click="context.openRoomModal(managementRoom)"
                  >编辑</el-button>
                  <el-dropdown
                    trigger="click"
                    :disabled="updatingRoomId === managementRoom.id"
                    @command="handleRoomCommand"
                  >
                    <el-button link :disabled="updatingRoomId === managementRoom.id">
                      更多<el-icon><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item :command="managementRoom.is_active ? 'disable' : 'enable'">
                          {{ roomStatusAction(managementRoom) }}
                        </el-dropdown-item>
                        <el-dropdown-item
                          divided
                          command="delete"
                          :disabled="Boolean(managementRoom.racks_count || managementRoom.assets_count)"
                          :title="(managementRoom.racks_count || managementRoom.assets_count) ? relationDeleteHint : undefined"
                        >删除</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </template>

            <div class="resource-detail-body">
              <template v-if="rackManagementLoading">
                <el-skeleton :rows="8" animated />
              </template>
              <div v-else-if="rackManagementError" class="resource-panel-state resource-panel-error" role="alert">
                <strong>机柜加载失败</strong>
                <span>{{ rackManagementError }}</span>
                <el-button type="primary" plain size="small" @click="context.retryRackManagement">重新加载</el-button>
              </div>
              <div v-else-if="!managementRoom" class="resource-panel-empty">
                <el-empty :image-size="56" description="请选择机房查看详情" />
              </div>
              <template v-else>
                <div class="facility-room-summary">
                  <div class="facility-room-summary-context">
                    <span>{{ managementRoom.data_center_name || "未关联数据中心" }}</span>
                    <span aria-hidden="true">·</span>
                    <StatusTag :type="managementRoom.is_active ? 'success' : 'info'" :label="managementRoom.is_active ? '使用中' : '停用'" />
                  </div>
                  <div class="facility-room-summary-contact">
                    <span>负责人：{{ managementRoom.owner_name || "—" }}</span>
                    <span>联系电话：{{ managementRoom.contact_phone || "—" }}</span>
                  </div>
                  <div v-if="managementRoom.notes" class="facility-room-summary-notes">备注：{{ managementRoom.notes }}</div>
                </div>

                <div class="facility-subtitle facility-rack-heading">
                  <strong>机柜（{{ roomRacks.length }}）</strong>
                  <el-button
                    v-if="can('racks.manage')"
                    type="primary"
                    size="small"
                    :disabled="!managementRoom.is_active"
                    :title="managementRoom.is_active ? '在当前机房新增机柜' : '停用机房不能新增机柜'"
                    @click="context.openRackModal(undefined, managementRoom)"
                  >新增机柜</el-button>
                </div>
                <div v-if="roomRacks.length" class="facility-rack-list">
                  <article v-for="rack in roomRacks" :key="rack.id" class="facility-rack-row">
                    <button type="button" class="facility-rack-main" @click="openRackFromRoom(rack)">
                      <div class="facility-rack-title">
                        <strong>{{ rack.code }}</strong>
                        <span v-if="rack.name">{{ rack.name }}</span>
                        <StatusTag :type="statusType(rack.status, rack.is_active)" :label="statusLabel(rack.status, rack.is_active)" />
                      </div>
                      <div class="facility-rack-meta">
                        {{ rackUsed(rack) }} / {{ rack.total_u }} U · {{ rackUtilization(rack) }}% · {{ rack.allocations.length }} 台设备
                      </div>
                      <div class="facility-util-track" aria-hidden="true"><i :style="{ width: `${rackUtilization(rack)}%` }" /></div>
                    </button>
                    <div v-if="can('racks.manage')" class="facility-rack-actions">
                      <el-button
                        link
                        type="primary"
                        size="small"
                        :disabled="deletingRackId === rack.id || updatingRackId === rack.id"
                        @click="context.openRackModal(rack, managementRoom || undefined)"
                      >编辑</el-button>
                      <el-dropdown
                        trigger="click"
                        :disabled="deletingRackId === rack.id || updatingRackId === rack.id"
                        @command="(command: string) => handleRackCommand(rack, command)"
                      >
                        <el-button link size="small" :disabled="deletingRackId === rack.id || updatingRackId === rack.id" @click.stop>
                          更多<el-icon><MoreFilled /></el-icon>
                        </el-button>
                        <template #dropdown>
                          <el-dropdown-menu>
                            <el-dropdown-item command="view">查看 U 位</el-dropdown-item>
                            <el-dropdown-item :command="rackStatusCode(rack) === 'disabled' ? 'in_use' : 'disabled'">
                              {{ rackStatusCode(rack) === "disabled" ? "启用" : "停用" }}
                            </el-dropdown-item>
                            <el-dropdown-item v-if="rackStatusCode(rack) !== 'reserved'" command="reserved">设为预留</el-dropdown-item>
                            <el-dropdown-item v-else command="in_use">设为使用中</el-dropdown-item>
                            <el-dropdown-item
                              divided
                              command="delete"
                              :disabled="Boolean(rack.allocations.length)"
                              :title="rack.allocations.length ? rackDeleteHint : undefined"
                            >删除</el-dropdown-item>
                          </el-dropdown-menu>
                        </template>
                      </el-dropdown>
                    </div>
                  </article>
                </div>
                <div v-else class="resource-panel-empty resource-panel-empty--inline">
                  <el-empty :image-size="48" description="该机房暂无机柜" />
                </div>
              </template>
            </div>
          </el-card>
        </section>

        <section
          v-else
          class="resource-workspace resource-workspace--rack"
          :style="rackViewStyle"
          aria-label="机柜视图工作台"
        >
          <RackListPanel :context="context" />

          <el-card class="resource-panel resource-detail-panel resource-rack-detail" shadow="never">
            <template #header>
              <div class="resource-detail-header">
                <div class="resource-detail-title">
                  <strong>{{ currentRack?.code || "机柜视图" }}</strong>
                  <span v-if="currentRack">{{ rackLocationLabel(currentRack) }}</span>
                  <span v-else>请选择左侧机柜查看 U 位</span>
                </div>
                <div v-if="currentRack && (can('racks.manage') || can('racks.export'))" class="resource-detail-actions">
                  <el-button
                    v-if="can('racks.manage')"
                    link
                    type="primary"
                    :disabled="deletingRackId === currentRack.id || updatingRackId === currentRack.id"
                    @click="context.openRackModal(currentRack, viewRoom || undefined)"
                  >编辑</el-button>
                  <el-dropdown
                    trigger="click"
                    :disabled="deletingRackId === currentRack.id || updatingRackId === currentRack.id"
                    @command="handleCurrentRackCommand"
                  >
                    <el-button link :disabled="deletingRackId === currentRack.id || updatingRackId === currentRack.id">
                      更多<el-icon><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="info">查看机柜信息</el-dropdown-item>
                        <template v-if="can('racks.manage')">
                          <el-dropdown-item :command="rackStatusAction(currentRack)">
                            {{ rackStatusActionLabel(currentRack) }}
                          </el-dropdown-item>
                          <el-dropdown-item v-if="rackStatusCode(currentRack) !== 'reserved'" command="reserved">设为预留</el-dropdown-item>
                          <el-dropdown-item v-else command="in_use">设为使用中</el-dropdown-item>
                        </template>
                        <el-dropdown-item v-if="can('racks.export')" divided command="export">导出布局</el-dropdown-item>
                        <el-dropdown-item
                          v-if="can('racks.manage')"
                          divided
                          command="delete"
                          :disabled="currentRackHasAssets"
                          :title="currentRackHasAssets ? rackDeleteHint : undefined"
                        >删除</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </div>
            </template>

            <div class="resource-detail-body">
              <template v-if="rackListLoading && !currentRack">
                <el-skeleton :rows="8" animated />
              </template>
              <div v-else-if="rackListError && !currentRack" class="resource-panel-state resource-panel-error" role="alert">
                <strong>机柜加载失败</strong>
                <span>{{ rackListError }}</span>
                <el-button type="primary" plain @click="context.retryRackView">重新加载</el-button>
              </div>
              <div v-else-if="!currentRack" class="resource-panel-empty">
                <el-empty :image-size="56" :description="selectedRoom ? '当前机房暂无机柜' : '请选择机房查看机柜'" />
              </div>
              <template v-else>
                <div class="rack-detail-meta-line">
                  <span>{{ currentRack.rack_type || "标准机柜" }}</span>
                  <StatusTag :type="statusType(currentRack.status, currentRack.is_active)" :label="statusLabel(currentRack.status, currentRack.is_active)" />
                  <span>{{ rackUsed(currentRack) }} / {{ currentRack.total_u }} U</span>
                  <span>{{ rackUtilization(currentRack) }}%</span>
                </div>
                <div class="rack-canvas-shell">
                  <RackLayoutCanvas :context="context" />
                  <div class="rack-canvas-footer" aria-label="机柜容量摘要">
                    <span>已用 {{ rackUsed(currentRack) }}U</span>
                    <span>可用 {{ currentRack.free_u ?? Math.max(currentRack.total_u - rackUsed(currentRack), 0) }}U</span>
                    <span>利用率 {{ rackUtilization(currentRack) }}%</span>
                  </div>
                </div>
                <RackAssetInspector :context="context" />
              </template>
            </div>
          </el-card>
        </section>
      </PageContent>
    </PageContainer>

    <el-drawer v-model="showRackInfo" title="机柜信息" size="360px">
      <dl v-if="currentRack" class="rack-info-list">
        <div><dt>机柜编号</dt><dd>{{ currentRack.code }}</dd></div>
        <div><dt>所属位置</dt><dd>{{ rackLocationLabel(currentRack) }}</dd></div>
        <div><dt>机柜类型</dt><dd>{{ currentRack.rack_type || "—" }}</dd></div>
        <div><dt>负责人</dt><dd>{{ currentRack.owner_name || "—" }}</dd></div>
        <div><dt>创建时间</dt><dd>{{ formatRackDate(currentRack.created_at) }}</dd></div>
        <div class="rack-info-list-wide"><dt>备注</dt><dd>{{ currentRack.notes || "—" }}</dd></div>
      </dl>
    </el-drawer>

    <RackFormDialog :context="context" />
  </div>
</template>
