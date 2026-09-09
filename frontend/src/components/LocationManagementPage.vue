<script setup lang="ts">
import { computed, ref } from "vue";
import type { TableInstance, TableColumnCtx } from "element-plus";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit, FolderAdd, Grid } from "@element-plus/icons-vue";
import ResourceState from "./ResourceState.vue";
import StatusTag from "./StatusTag.vue";
import TableIconButton from "./TableIconButton.vue";
import type { DataCenter, ServerRoom } from "../types";
import type { RackSharedContext } from "../page-context";

const props = defineProps<{ context: RackSharedContext }>();
const { t } = useI18n();
const context = props.context;
const dataCenters = context.dataCenters;
const serverRooms = context.serverRooms;
const facilitySummary = context.facilitySummary;
const can = context.can;
const locationSearch = context.locationSearch;
const locationType = context.locationType;
const locationStatus = context.locationStatus;
const locationDataCenter = context.locationDataCenter;
const locationManagementLoading = context.locationManagementLoading;
const locationManagementError = context.locationManagementError;
const dataCenterActionId = context.dataCenterActionId;
const updatingRoomId = context.updatingRoomId;

type LocationNodeType = "data-center" | "room";
type LocationTreeRow = {
  key: string;
  id: number;
  nodeType: LocationNodeType;
  name: string;
  address?: string;
  data_center?: number;
  data_center_name?: string;
  is_active: boolean;
  rooms_count?: number;
  racks_count?: number;
  assets_count?: number;
  total_u?: number;
  used_u?: number;
  children?: LocationTreeRow[];
};

const treeProps = { children: "children" };
const locationTable = ref<TableInstance>();

function toggleLocationRow(row: LocationTreeRow, column: TableColumnCtx<LocationTreeRow>, event: MouseEvent) {
  if (!row.children?.length || column?.columnKey === "actions") return;
  if (event.target instanceof Element && event.target.closest(".el-table__expand-icon, button, a, input")) return;
  locationTable.value?.toggleRowExpansion(row);
}

function locationRowClass({ row }: { row: LocationTreeRow }) {
  return row.children?.length ? "location-row--expandable" : "";
}

const roomCapacityById = computed(() => new Map(
  (facilitySummary.value?.rooms || []).map((room) => [
    room.id,
    {
      total: room.total_u == null ? undefined : Number(room.total_u),
      used: room.used_u == null ? undefined : Number(room.used_u),
    },
  ]),
));

const locationRows = computed<LocationTreeRow[]>(() => {
  const search = locationSearch.value.trim().toLocaleLowerCase();
  const roomsByDataCenter = new Map<number, ServerRoom[]>();
  for (const room of serverRooms.value) {
    const rows = roomsByDataCenter.get(room.data_center) || [];
    rows.push(room);
    roomsByDataCenter.set(room.data_center, rows);
  }

  const matchesText = (values: Array<string | undefined>) =>
    !search || values.some((value) => String(value || "").toLocaleLowerCase().includes(search));
  const matchesStatus = (isActive: boolean) =>
    !locationStatus.value || (locationStatus.value === "active" ? isActive : !isActive);

  return dataCenters.value.flatMap((center) => {
    if (locationDataCenter.value && String(center.id) !== locationDataCenter.value) return [];
    const centerMatchesText = matchesText([center.name, center.address]);
    const centerMatchesStatus = matchesStatus(center.is_active);
    const availableRooms = (roomsByDataCenter.get(center.id) || []).filter((room) => matchesStatus(room.is_active));
    const matchingRooms = availableRooms.filter((room) => matchesText([room.name, room.data_center_name]));
    const visibleRooms = centerMatchesText ? availableRooms : matchingRooms;

    if (locationType.value === "data-center" && (!centerMatchesText || !centerMatchesStatus)) return [];
    if (locationType.value === "room" && !visibleRooms.length) return [];
    if (!locationType.value && !((centerMatchesText && centerMatchesStatus) || matchingRooms.length)) return [];

    const children = locationType.value === "data-center"
      ? undefined
      : visibleRooms.map((room): LocationTreeRow => {
          const capacity = roomCapacityById.value.get(room.id);
          return {
            key: `room:${room.id}`,
            id: room.id,
            nodeType: "room",
            name: room.name,
            data_center: room.data_center,
            data_center_name: room.data_center_name,
            is_active: room.is_active,
            racks_count: room.racks_count,
            assets_count: room.assets_count,
            ...(capacity?.total == null ? {} : { total_u: capacity.total }),
            ...(capacity?.used == null ? {} : { used_u: capacity.used }),
          };
        });

    return [{
      key: `data-center:${center.id}`,
      id: center.id,
      nodeType: "data-center",
      name: center.name,
      address: center.address,
      is_active: center.is_active,
      rooms_count: center.rooms_count,
      assets_count: center.assets_count,
      ...(children?.length ? { children } : {}),
    }];
  });
});

  const hasLocationFilters = computed(() => Boolean(
    locationSearch.value.trim() ||
    locationType.value ||
    locationStatus.value ||
    locationDataCenter.value,
  ));
const emptyDescription = computed(() =>
  hasLocationFilters.value ? t("location.noMatchingLocations") : t("location.noLocations"),
);

function locationAssetCount(row: LocationTreeRow) {
  return row.assets_count == null ? "—" : row.assets_count;
}

function locationCapacity(row: LocationTreeRow) {
  if (row.nodeType === "data-center") return t("location.roomsCount", { count: row.rooms_count ?? 0 });
  if (!row.is_active || row.total_u == null || row.used_u == null) return "—";
  return `${row.used_u} / ${row.total_u} U`;
}

function roomHasAssociations(row: LocationTreeRow) {
  return Boolean(row.racks_count || row.assets_count);
}

function dataCenterHasAssociations(row: LocationTreeRow) {
  return Boolean(row.rooms_count || row.assets_count);
}

function findDataCenter(row: LocationTreeRow) {
  return dataCenters.value.find((center) => center.id === row.id) || null;
}

function findRoom(row: LocationTreeRow) {
  return serverRooms.value.find((room) => room.id === row.id) || null;
}

function handleDataCenterCommand(row: LocationTreeRow, command: string) {
  const center = findDataCenter(row);
  if (!center) return;
  if (command === "new-room") {
    context.openRoomModal(undefined, center.id);
  } else if (command === "enable" || command === "disable") {
    void context.updateDataCenterStatus(center, command === "enable");
  } else if (command === "delete" && !dataCenterHasAssociations(row)) {
    void context.deleteDataCenter(center);
  }
}

function handleRoomCommand(row: LocationTreeRow, command: string) {
  const room = findRoom(row);
  if (!room) return;
  if (command === "view-racks") {
    context.openRackSection("view", {
      data_center: String(room.data_center),
      room: String(room.id),
    });
  } else if (command === "edit") {
    context.openRoomModal(room);
  } else if (command === "enable" || command === "disable") {
    void context.updateRoomStatus(room, command === "enable");
  } else if (command === "delete" && !roomHasAssociations(row)) {
    void context.deleteRoom(room);
  }
}
</script>

<template>
    <section class="location-management-workspace" :aria-label="t('location.title')">
    <ResourceState
      :error="locationManagementError"
      @retry="context.retryLocationManagement"
    >
      <el-table
        ref="locationTable"
        class="location-management-table"
        v-loading="locationManagementLoading"
        :data="locationRows"
        row-key="key"
        :tree-props="treeProps"
        :row-class-name="locationRowClass"
        @row-click="toggleLocationRow"
      >
        <template #empty>
          <el-empty :image-size="56" :description="emptyDescription">
            <el-button v-if="hasLocationFilters" link type="primary" @click="context.resetLocationFilters">{{ t('common.clearFilters') }}</el-button>
          </el-empty>
        </template>
        <el-table-column :label="t('common.name')" min-width="210">
          <template #default="{ row }">
            <span :class="row.nodeType === 'data-center' ? 'location-name location-name--parent' : 'location-name'">
              {{ row.name }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.type')" width="112">
          <template #default="{ row }">
            <span class="location-management-type">
              {{ row.nodeType === "data-center" ? t('location.dataCenter') : t('location.room') }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="`${t('common.location')} / ${t('common.address')}`" min-width="200">
          <template #default="{ row }">
            <span
              class="location-management-location"
              :title="row.nodeType === 'data-center' ? (row.address || '—') : (row.data_center_name || '—')"
            >
              {{ row.nodeType === "data-center" ? (row.address || "—") : (row.data_center_name || "—") }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('location.capacityOverview')" width="150">
          <template #default="{ row }">{{ locationCapacity(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('location.assetCount')" width="84" align="right">
          <template #default="{ row }">{{ locationAssetCount(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="96" align="center">
          <template #default="{ row }">
            <StatusTag size="small" :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" />
          </template>
        </el-table-column>
        <el-table-column :label="t('common.operation')" column-key="actions" width="132" fixed="right">
          <template #default="{ row }">
            <div class="ep-table-actions" @click.stop>
              <template v-if="row.nodeType === 'data-center'">
                <template v-if="can('racks.manage')">
                  <TableIconButton
                    :icon="Edit"
                    :label="t('common.edit')"
                    type="primary"
                    :disabled="dataCenterActionId === row.id"
                    @click="context.openDataCenterModal(findDataCenter(row) || undefined)"
                  />
                  <TableIconButton
                    :icon="FolderAdd"
                    :label="t('location.createRoom')"
                    :disabled="dataCenterActionId === row.id"
                    @click="handleDataCenterCommand(row, 'new-room')"
                  />
                  <TableIconButton
                    :icon="row.is_active ? CircleClose : CircleCheck"
                    :label="row.is_active ? t('status.inactive') : t('status.active')"
                    :disabled="dataCenterActionId === row.id"
                    @click="handleDataCenterCommand(row, row.is_active ? 'disable' : 'enable')"
                  />
                  <TableIconButton
                    :icon="Delete"
                    :label="t('common.delete')"
                    type="danger"
                    :disabled="dataCenterActionId === row.id || dataCenterHasAssociations(row)"
                    @click="handleDataCenterCommand(row, 'delete')"
                  />
                </template>
                <span v-else>—</span>
              </template>
              <template v-else>
                <TableIconButton :icon="Grid" :label="t('location.viewRacks')" type="primary" @click="handleRoomCommand(row, 'view-racks')" />
                <template v-if="can('racks.manage')">
                  <TableIconButton
                    :icon="Edit"
                    :label="t('common.edit')"
                    type="primary"
                    :disabled="updatingRoomId === row.id"
                    @click="handleRoomCommand(row, 'edit')"
                  />
                  <TableIconButton
                    :icon="row.is_active ? CircleClose : CircleCheck"
                    :label="row.is_active ? t('status.inactive') : t('status.active')"
                    :disabled="updatingRoomId === row.id"
                    @click="handleRoomCommand(row, row.is_active ? 'disable' : 'enable')"
                  />
                  <TableIconButton
                    :icon="Delete"
                    :label="t('common.delete')"
                    type="danger"
                    :disabled="updatingRoomId === row.id || roomHasAssociations(row)"
                    @click="handleRoomCommand(row, 'delete')"
                  />
                </template>
              </template>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </ResourceState>
  </section>
</template>
