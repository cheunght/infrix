<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { MoreFilled } from "@element-plus/icons-vue";
import RackAssetInspector from "./RackAssetInspector.vue";
import RackDetailPanel from "./RackDetailPanel.vue";
import RackFormDialog from "./RackFormDialog.vue";
import RackLayoutCanvas from "./RackLayoutCanvas.vue";
import RackListPanel from "./RackListPanel.vue";
import LocationManagementPage from "./LocationManagementPage.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import type { Rack, RackStatus, ServerRoom } from "../types";
import type { RackSharedContext } from "../types/page-context";
import { rackStatusValue } from "../business-enums";

const props = defineProps<{ context: RackSharedContext }>();
const context = props.context;
const rackSection = context.rackSection;
const serverRooms = context.serverRooms;
const can = context.can;
const dataCenters = context.dataCenters;
const locationSearch = context.locationSearch;
const locationType = context.locationType;
const locationStatus = context.locationStatus;
const locationDataCenter = context.locationDataCenter;
const locationManagementLoading = context.locationManagementLoading;
const selectedDataCenter = context.selectedDataCenter;
const selectedRoom = context.selectedRoom;
const selectedRack = context.selectedRack;
const roomOptions = context.roomOptions;
const rackListLoading = context.rackListLoading;
const rackListError = context.rackListError;
const rackDetailOpen = context.rackDetailOpen;
const deletingRackId = context.deletingRackId;
const updatingRackId = context.updatingRackId;
const rackUsedU = context.rackUsedU;
const rackUtilization = context.rackUtilization;
const rackUtilizationColor = context.rackUtilizationColor;

const rooms = computed<ServerRoom[]>(() => serverRooms.value || []);
const showRackInfo = ref(false);

const viewRoom = computed(() =>
  rooms.value.find((room) => String(room.id) === context.selectedRoom.value)
    || (context.focusedRack.value
      ? rooms.value.find((room) => room.id === context.focusedRack.value?.room)
      : null)
    || null,
);
const currentRack = context.focusedRack;
const currentRackHasAssets = computed(() => Boolean(
  currentRack.value?.assets_count || currentRack.value?.allocations?.length,
));

const rackDeleteHint = "该机柜仍有资产占用，请先迁移或解除资产位置后再删除";

function rackStatusCode(rack: Rack): RackStatus {
  return rackStatusValue(rack.status, rack.is_active);
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

function formatRackDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}

watch(currentRack, () => {
  showRackInfo.value = false;
});

function changeViewRoom(value: string | number | null | undefined) {
  const roomId = value == null ? "" : String(value);
  context.selectedRoom.value = roomId;
  context.selectedRack.value = "";
  context.selectedRackDeviceTypeId.value = "";
  context.focusedRackId.value = null;
  context.rackPage.value = 1;
  context.openRackSection("view", {
    ...(context.selectedDataCenter.value ? { data_center: context.selectedDataCenter.value } : {}),
    ...(roomId ? { room: roomId } : {}),
  });
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
  <div class="itam-page racks-page">
    <PageContainer class="racks-module-page">
      <template #toolbar>
        <PageToolbar>
          <template v-if="rackSection === 'locations'" #search>
            <SearchField
              v-model="locationSearch"
              :loading="locationManagementLoading"
              placeholder="搜索名称或地址"
              aria-label="搜索数据中心或机房名称、地址"
              @search="context.changeLocationSearch"
            />
          </template>
          <template v-else #search>
            <SearchField
              v-model="selectedRack"
              placeholder="搜索机柜"
              aria-label="搜索机柜名称或编号"
              @search="context.changeRackFilter"
            />
          </template>
          <template v-if="rackSection === 'locations'" #filters>
            <div class="page-toolbar__filter-group">
              <el-select
                v-model="locationType"
                placeholder="类型"
                aria-label="按类型筛选位置"
                @change="context.changeLocationType"
              >
                <el-option label="全部类型" value="all" />
                <el-option label="数据中心" value="data-center" />
                <el-option label="机房" value="room" />
              </el-select>
              <el-select
                v-model="locationDataCenter"
                placeholder="数据中心"
                aria-label="按数据中心筛选位置"
                clearable
                @change="context.changeLocationDataCenter"
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
                v-model="locationStatus"
                placeholder="状态"
                aria-label="按状态筛选位置"
                @change="context.changeLocationStatus"
              >
                <el-option label="全部状态" value="all" />
                <el-option label="启用" value="active" />
                <el-option label="停用" value="inactive" />
              </el-select>
              <el-button v-if="locationSearch.trim() || locationType !== 'all' || locationStatus !== 'all' || locationDataCenter" link @click="context.resetLocationFilters">清除筛选</el-button>
            </div>
          </template>
          <template v-else-if="rackSection === 'view'" #filters>
            <div class="page-toolbar__filter-group">
              <el-select
              v-model="selectedDataCenter"
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
            </div>
          </template>
          <template #primary>
            <el-button v-if="can('racks.manage') && rackSection === 'locations'" class="page-primary-action" type="primary" @click="context.openDataCenterModal()">
              新增数据中心
            </el-button>
            <el-button v-else-if="can('racks.manage') && rackSection === 'view'" class="page-primary-action" type="primary" @click="context.openRackModal()">
              新增机柜
            </el-button>
          </template>
        </PageToolbar>
      </template>

      <PageContent v-if="rackSection === 'locations'" surface>
        <LocationManagementPage :context="context" />
      </PageContent>

      <PageContent v-else min-height="0">
        <section
          class="resource-workspace resource-workspace--rack"
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
                          <el-dropdown-item v-else command="in_use">设为在用</el-dropdown-item>
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
                <div class="rack-detail-grid">
                  <div class="rack-detail-grid__canvas">
                    <div class="rack-canvas-shell">
                      <RackLayoutCanvas :context="context" />
                    </div>
                  </div>
                  <div class="rack-detail-grid__side">
                    <RackAssetInspector :context="context" />
                    <RackDetailPanel
                      v-show="!rackDetailOpen"
                      :rack="currentRack"
                      :used-u="rackUsedU(currentRack)"
                      :utilization="rackUtilization(currentRack)"
                      :utilization-color="rackUtilizationColor(currentRack)"
                    />
                  </div>
                </div>
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
