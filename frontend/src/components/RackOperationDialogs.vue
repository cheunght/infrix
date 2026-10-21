<script setup lang="ts">
import { computed, proxyRefs } from "vue";
import { useI18n } from "vue-i18n";
import FormDialogShell from "./FormDialogShell.vue";
import SearchableSelect, {
  type SearchableSelectOption,
  type SearchableSelectValue,
} from "./SearchableSelect.vue";
import SearchField from "./SearchField.vue";
import PagedTable from "./PagedTable.vue";
import type { RackOperations } from "../composables/useRackOperations";
import type { RackSharedContext } from "../page-context";
const props = defineProps<{
  context: RackSharedContext;
  operations: RackOperations;
}>();
const { t } = useI18n();
const o = proxyRefs(props.operations);
const title = computed(() => t(`rackOps.${o.mode}`));
function id(
  value: SearchableSelectValue | SearchableSelectValue[] | null | undefined,
) {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? Number(v) : null;
}
function selectAsset(
  value: SearchableSelectValue | SearchableSelectValue[] | null | undefined,
) {
  const selected = id(value);
  if (selected) void o.chooseAsset(selected);
  else o.asset = null;
}
function mapAsset(item: Record<string, unknown>): SearchableSelectOption {
  return {
    value: Number(item.id),
    label: `${item.asset_no} · ${item.name}`,
    secondary: String(item.serial_number || ""),
    disabled: item.status === "retired",
  };
}
function mapCenter(item: Record<string, unknown>): SearchableSelectOption {
  return { value: Number(item.id), label: String(item.name) };
}
function mapRoom(item: Record<string, unknown>): SearchableSelectOption {
  return {
    value: Number(item.id),
    label: String(item.name),
    secondary: String(item.data_center_name || ""),
  };
}
function mapRack(item: Record<string, unknown>): SearchableSelectOption {
  return {
    value: Number(item.id),
    label: String(item.code),
    secondary: String(item.name || ""),
    disabled: item.status !== "in_use" || item.is_active === false,
  };
}
const selectedAsset = computed(() =>
  o.asset ? mapAsset(o.asset as unknown as Record<string, unknown>) : null,
);
const selectedRack = computed(() =>
  o.targetRack
    ? mapRack(o.targetRack as unknown as Record<string, unknown>)
    : null,
);
const availableLabel = computed(
  () =>
    o.options?.available_ranges
      ?.map((span) => `U${span.start_u}–U${span.end_u}`)
      .join("、") || t("rackOps.noSpace"),
);
</script>
<template>
  <FormDialogShell
    v-model="o.findOpen"
    :title="t('rackOps.findAsset')"
    :error="o.searchError"
    size="large"
  >
    <SearchField
      v-model="o.search"
      :placeholder="t('rackOps.searchPlaceholder')"
      :loading="o.finding"
      @search="o.searchAssets(1)"
    />
    <el-button :loading="o.finding" @click="o.searchAssets(1)">{{
      t("common.search")
    }}</el-button>
    <PagedTable
      :current-page="o.searchPage"
      :page-size="20"
      :total="o.searchTotal"
      :disabled="o.finding"
      layout="total, prev, pager, next"
      @update:current-page="o.searchAssets"
    >
      <el-table :data="o.results" v-loading="o.finding">
        <el-table-column
          prop="asset_no"
          :label="t('asset.code')"
          min-width="130"
        />
        <el-table-column
          prop="name"
          :label="t('common.name')"
          min-width="150"
        />
        <el-table-column
          prop="serial_number"
          :label="t('asset.serialNumber')"
          min-width="130"
        />
        <el-table-column :label="t('common.location')" min-width="230"
          ><template #default="{ row }">{{
            o.mountedLocation(row)
          }}</template></el-table-column
        >
        <el-table-column :label="t('common.operation')" width="84" fixed="right"
          ><template #default="{ row }"
            ><el-button link type="primary" @click="o.locate(row.id)">{{
              t("rackOps.locate")
            }}</el-button></template
          ></el-table-column
        >
      </el-table>
    </PagedTable>
  </FormDialogShell>
  <FormDialogShell
    :model-value="o.dialogOpen"
    :title="title"
    :error="o.error"
    :saving="o.busy"
    :close-disabled="o.busy"
    size="medium"
    @update:model-value="!$event && o.close()"
  >
    <div class="rack-operation-form">
      <label
        v-if="o.mode === 'mount'"
        class="rack-operation-field rack-operation-full"
        ><span>{{ t("rackOps.asset") }}</span>
        <SearchableSelect
          :model-value="o.asset?.id"
          :request="context.request"
          endpoint="/assets/"
          :base-query="{ compact: true, rack_mounted: false }"
          :map-option="mapAsset"
          :selected-option="selectedAsset"
          :disabled="o.busy || o.preparing || o.uncertain"
          :placeholder="t('rackOps.chooseAsset')"
          :aria-label="t('rackOps.asset')"
          @update:model-value="selectAsset"
        />
      </label>
      <template v-if="o.mode !== 'unmount'">
        <label class="rack-operation-field"
          ><span>{{ t("location.dataCenter") }}</span
          ><SearchableSelect
            :model-value="o.centerId"
            :request="context.request"
            endpoint="/data-centers/"
            :base-query="{ is_active: true }"
            :map-option="mapCenter"
            :disabled="o.busy || o.uncertain || o.mode === 'adjust'"
            :aria-label="t('location.dataCenter')"
            @update:model-value="o.setCenter(id($event))"
        /></label>
        <label class="rack-operation-field"
          ><span>{{ t("location.room") }}</span
          ><SearchableSelect
            :key="`placement-room-${o.centerId}`"
            :model-value="o.roomId"
            :request="context.request"
            endpoint="/server-rooms/"
            :base-query="{ data_center: o.centerId, is_active: true }"
            :map-option="mapRoom"
            :disabled="
              !o.centerId || o.busy || o.uncertain || o.mode === 'adjust'
            "
            :aria-label="t('location.room')"
            @update:model-value="o.setRoom(id($event))"
        /></label>
        <label class="rack-operation-field rack-operation-full"
          ><span>{{ t("asset.rack") }}</span
          ><SearchableSelect
            :key="`placement-rack-${o.roomId}`"
            v-model="o.rackId"
            :request="context.request"
            endpoint="/racks/"
            :base-query="{ room: o.roomId, is_active: true, status: 'in_use' }"
            :map-option="mapRack"
            :selected-option="selectedRack"
            :disabled="
              !o.roomId || o.busy || o.uncertain || o.mode === 'adjust'
            "
            :aria-label="t('asset.rack')"
        /></label>
        <label v-if="context.can('racks.manage') && o.targetRack?.reservations?.length" class="rack-operation-field rack-operation-full">
          <span>{{ t('rackReserve.use') }}</span>
          <el-select :model-value="o.reservationId" clearable :disabled="o.busy || o.uncertain || o.optionsLoading" :aria-label="t('rackReserve.use')" @update:model-value="o.selectReservation($event || null)">
            <el-option v-for="row in o.targetRack.reservations" :key="row.id" :value="row.id" :label="`U${row.start_u}–U${row.end_u} · ${row.purpose}`" />
          </el-select>
        </label>
        <p v-if="o.reservationId" class="rack-operation-full">{{ t('rackReserve.consumeHint') }}</p>
        <label class="rack-operation-field"
          ><span>{{ t("asset.startU") }}</span
          ><el-input-number
            v-model="o.startU"
            :min="1"
            :max="o.options?.total_u || 32767"
            :precision="0"
            :disabled="o.busy || o.uncertain || !!o.reservationId"
            :aria-label="t('asset.startU')"
        /></label>
        <label class="rack-operation-field"
          ><span>{{ t("rackOps.height") }}</span
          ><el-input-number
            v-model="o.height"
            :min="1"
            :max="o.options?.total_u || 32767"
            :precision="0"
            :disabled="o.busy || o.uncertain || !!o.reservationId"
            :aria-label="t('rackOps.height')"
        /></label>
      </template>
      <label class="rack-operation-field rack-operation-full"
        ><span>{{ t("common.notes") }}</span
        ><el-input
          v-model="o.note"
          type="textarea"
          maxlength="1000"
          :disabled="o.busy || o.uncertain"
          :aria-label="t('common.notes')"
      /></label>
    </div>
    <p v-if="o.preparing || o.optionsLoading">{{ t("common.loadingData") }}</p>
    <template v-if="o.mode !== 'unmount' && o.options">
      <p v-if="o.options.occupancy_restricted">{{ t("rackOps.restricted") }}</p>
      <p v-else>{{ t("rackOps.available") }}：{{ availableLabel }}</p>
      <el-alert
        v-if="!o.positionValid && o.asset"
        :title="t('rackOps.invalidPosition')"
        type="warning"
        :closable="false"
      />
    </template>
    <section class="rack-operation-preview" :aria-label="t('rackOps.preview')">
      <p>
        <strong>{{ o.asset?.asset_no || t("rackOps.chooseAsset") }}</strong>
        {{ o.asset?.name }}
      </p>
      <p>{{ t("rackOps.original") }}：{{ o.mountedLocation(o.asset) }}</p>
      <p>{{ t("rackOps.target") }}：{{ o.targetLocation }}</p>
      <p>
        {{
          t(o.mode === "unmount" ? "rackOps.unmountHint" : "rackOps.heightHint")
        }}
      </p>
    </section>
    <template #footer>
      <el-button :disabled="o.busy" @click="o.close()">{{
        t("common.cancel")
      }}</el-button>
      <el-button
        v-if="o.uncertain"
        :loading="o.reconciling"
        @click="o.reconcile()"
        >{{ t("rackOps.reconcile") }}</el-button
      >
      <el-button
        type="primary"
        :loading="o.busy"
        :disabled="
          !o.positionValid ||
          o.preparing ||
          o.optionsLoading ||
          o.uncertain ||
          o.reconciling
        "
        @click="o.save()"
        >{{ t("rackOps.confirm") }}</el-button
      >
    </template>
  </FormDialogShell>
</template>
