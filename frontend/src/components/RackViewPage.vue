<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { MoreFilled } from "@element-plus/icons-vue";
import RackAssetInspector from "./RackAssetInspector.vue";
import RackDetailPanel from "./RackDetailPanel.vue";
import RackFormDialog from "./RackFormDialog.vue";
import RackLayoutCanvas from "./RackLayoutCanvas.vue";
import RackListPanel from "./RackListPanel.vue";
import LocationManagementPage from "./LocationManagementPage.vue";
import SearchField from "./SearchField.vue";
import DescriptionList from "./DescriptionList.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageToolbar from "./page/PageToolbar.vue";
import type { Rack, RackStatus, ServerRoom } from "../types";
import type { RackSharedContext } from "../page-context";
import { rackStatusValue } from "../business-enums";
import { formatSystemDate } from "../system-settings";

const props = defineProps<{ context: RackSharedContext }>();
const { t } = useI18n();
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
const exportingRackLayout = context.exportingRackLayout;
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
const rackInfoItems = computed(() => {
  const rack = currentRack.value;
  if (!rack) return [];
  return [
    { key: "rackCode", label: t("rack.rackCode"), value: rack.code },
    { key: "location", label: t("rack.belongsToLocation"), value: rackLocationLabel(rack) },
    { key: "deviceType", label: t("rack.deviceType"), value: rack.rack_type },
    { key: "owner", label: t("rack.owner"), value: rack.owner_name },
    { key: "createdAt", label: t("rack.createdAt"), value: formatRackDate(rack.created_at) },
    {
      key: "notes",
      label: t("common.notes"),
      value: rack.notes,
      className: "rack-info-description__notes",
    },
  ];
});

const rackDeleteHint = computed(() => t("rack.rackOccupiedDeleteHint"));

function rackStatusCode(rack: Rack): RackStatus {
  return rackStatusValue(rack.status, rack.is_active);
}

function rackStatusActionLabel(rack: Rack) {
  return rackStatusCode(rack) === "disabled" ? t("status.active") : t("status.inactive");
}

function rackStatusAction(rack: Rack): RackStatus {
  return rackStatusCode(rack) === "disabled" ? "in_use" : "disabled";
}

function rackLocationLabel(rack: Rack | null) {
  return [rack?.data_center_name, rack?.server_room_name].filter(Boolean).join(" / ") || t("rack.unlinkedLocation");
}

function formatRackDate(value?: string) {
  if (!value) return "—";
  return formatSystemDate(value) || t("common.notAvailable");
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
    if (!can("racks.view")) return;
    showRackInfo.value = true;
    return;
  }
  if (command === "export") {
    if (!can("racks.export")) return;
    void context.exportRackLayout();
    return;
  }
  if (command === "delete") {
    if (!can("racks.manage")) return;
    if (!currentRackHasAssets.value) void context.deleteRack(rack);
    return;
  }
  if (command === "in_use" || command === "reserved" || command === "disabled") {
    if (!can("racks.manage")) return;
    void context.updateRackStatus(rack, command);
  }
}
</script>

<template>
  <div class="infrix-page racks-page">
    <PageContainer class="racks-module-page">
      <template #toolbar>
        <PageToolbar>
          <template v-if="rackSection === 'locations'" #search>
            <SearchField
              v-model="locationSearch"
              :loading="locationManagementLoading"
              :placeholder="t('location.searchPlaceholder')"
              :aria-label="t('rack.searchLocationNameOrAddress')"
              @search="context.changeLocationSearch"
            />
          </template>
          <template v-else #search>
            <SearchField
              v-model="selectedRack"
              :placeholder="t('rack.search')"
              :aria-label="t('rack.searchRackNameOrCode')"
              @search="context.changeRackFilter"
            />
          </template>
          <template v-if="rackSection === 'locations'" #filters>
            <div class="page-toolbar__filter-group">
              <el-select
                v-model="locationType"
                :placeholder="t('location.allTypes')"
                :aria-label="t('common.type')"
                clearable
                @change="context.changeLocationType"
              >
                <el-option :label="t('location.dataCenter')" value="data-center" />
                <el-option :label="t('location.room')" value="room" />
              </el-select>
              <el-select
                v-model="locationDataCenter"
                :placeholder="t('location.dataCenter')"
                :aria-label="t('location.dataCenter')"
                clearable
                @change="context.changeLocationDataCenter"
              >
                <el-option :label="t('location.allDataCenters')" value="" />
                <el-option
                  v-for="center in dataCenters"
                  :key="center.id"
                  :label="center.name"
                  :value="String(center.id)"
                />
              </el-select>
              <el-select
                v-model="locationStatus"
                :placeholder="t('location.allStatuses')"
                :aria-label="t('common.status')"
                clearable
                @change="context.changeLocationStatus"
              >
                <el-option :label="t('status.active')" value="active" />
                <el-option :label="t('status.inactive')" value="inactive" />
              </el-select>
            </div>
          </template>
          <template v-else-if="rackSection === 'view'" #filters>
            <div class="page-toolbar__filter-group">
              <el-select
              v-model="selectedDataCenter"
              :placeholder="t('location.dataCenter')"
              :aria-label="t('location.dataCenter')"
              clearable
              @change="context.changeDataCenter"
            >
              <el-option :label="t('location.allDataCenters')" value="" />
              <el-option
                v-for="center in dataCenters"
                :key="center.id"
                :label="center.name"
                :value="String(center.id)"
              />
              </el-select>
              <el-select
              v-model="selectedRoom"
              :placeholder="t('location.room')"
              :aria-label="t('location.room')"
              clearable
              :disabled="!roomOptions.length"
              @change="changeViewRoom"
            >
              <el-option :label="t('location.allRooms')" value="" />
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
              {{ t('location.createDataCenter') }}
            </el-button>
            <el-button v-else-if="can('racks.manage') && rackSection === 'view'" class="page-primary-action" type="primary" @click="context.openRackModal()">
              {{ t('rack.addRack') }}
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
          :aria-label="t('rack.locationWorkspace')"
        >
          <RackListPanel :context="context" />

          <el-card class="resource-panel resource-detail-panel resource-rack-detail" shadow="never">
            <template #header>
              <div class="resource-detail-header">
                <div class="resource-detail-title">
                  <strong>{{ currentRack?.code || t('rack.title') }}</strong>
                  <span v-if="currentRack">{{ rackLocationLabel(currentRack) }}</span>
                  <span v-else>{{ t('rack.selectRackHint') }}</span>
                </div>
                <div v-if="currentRack && can('racks.view')" class="resource-detail-actions">
                  <el-button
                    v-if="can('racks.manage')"
                    link
                    type="primary"
                    :disabled="deletingRackId === currentRack.id || updatingRackId === currentRack.id"
                    @click="context.openRackModal(currentRack, viewRoom || undefined)"
                  >{{ t('common.edit') }}</el-button>
                  <el-dropdown
                    trigger="click"
                    :disabled="deletingRackId === currentRack.id || updatingRackId === currentRack.id || exportingRackLayout"
                    @command="handleCurrentRackCommand"
                  >
                    <el-button
                      link
                      :loading="exportingRackLayout"
                      :disabled="deletingRackId === currentRack.id || updatingRackId === currentRack.id || exportingRackLayout"
                    >
                      {{ t('common.more') }}<el-icon><MoreFilled /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="info">{{ t('rack.viewRackInfo') }}</el-dropdown-item>
                        <template v-if="can('racks.manage')">
                          <el-dropdown-item :command="rackStatusAction(currentRack)">
                            {{ rackStatusActionLabel(currentRack) }}
                          </el-dropdown-item>
                          <el-dropdown-item v-if="rackStatusCode(currentRack) !== 'reserved'" command="reserved">{{ t('rack.setReserved') }}</el-dropdown-item>
                          <el-dropdown-item v-else command="in_use">{{ t('rack.setInUse') }}</el-dropdown-item>
                        </template>
                        <el-dropdown-item v-if="can('racks.export')" divided command="export" :disabled="exportingRackLayout">{{ t('rack.exportLayout') }}</el-dropdown-item>
                        <el-dropdown-item
                          v-if="can('racks.manage')"
                          divided
                          command="delete"
                          :disabled="currentRackHasAssets"
                          :title="currentRackHasAssets ? rackDeleteHint : undefined"
                        >{{ t('common.delete') }}</el-dropdown-item>
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
                <strong>{{ t('rack.rackLoadFailed') }}</strong>
                <span>{{ rackListError }}</span>
                <el-button type="primary" plain @click="context.retryRackView">{{ t('common.retry') }}</el-button>
              </div>
              <div v-else-if="!currentRack" class="resource-panel-empty">
                <el-empty :image-size="56" :description="selectedRoom ? t('rack.noRacksInRoom') : t('rack.selectRoomHint')" />
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

    <el-drawer v-model="showRackInfo" :title="t('rack.rackInfo')" size="360px">
      <DescriptionList
        v-if="currentRack"
        class="rack-info-descriptions"
        :items="rackInfoItems"
        :columns="1"
        size="small"
      />
    </el-drawer>

    <RackFormDialog :context="context" />
  </div>
</template>
