<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { useInventory } from "../composables/useInventory";
import type { useInventoryFieldwork } from "../composables/useInventoryFieldwork";
import {
  businessOptionLabel,
  INVENTORY_ITEM_STATUS_OPTIONS,
} from "../business-enums";
import StatusTag from "./StatusTag.vue";

const props = defineProps<{
  inventory: ReturnType<typeof useInventory>;
  fieldwork: ReturnType<typeof useInventoryFieldwork>;
}>();
const { t } = useI18n();
const locationsExpanded = ref(false);
const {
  itemDataCenter,
  itemRoom,
  itemRack,
  itemPlacement,
  itemSearch,
  items,
  itemCount,
  itemListError,
} = props.inventory;
const {
  selectedItem,
  summary,
  summaryLoading,
  summaryError,
  navigationError,
  notice,
  busy,
  onlyPending,
  rangeSummary,
  centers,
  rooms,
  racks,
  position,
} = props.fieldwork;
const currentLocation = computed(() => {
  const location = selectedItem.value?.current_location;
  if (!location) return "—";
  return [
    location.data_center,
    location.server_room,
    location.rack_code,
    location.start_u != null
      ? `U${location.start_u}–U${location.end_u}`
      : t("inventory.unmounted"),
  ]
    .filter(Boolean)
    .join(" / ");
});
const locationLabel = computed(
  () =>
    racks.value.find((row) => row.value === itemRack.value)?.label ||
    rooms.value.find((row) => row.value === itemRoom.value)?.label ||
    centers.value.find((row) => row.value === itemDataCenter.value)?.label ||
    t("inventory.fieldAllLocations"),
);
function choose(id: number) {
  const item = items.value.find((row) => row.id === id);
  if (item) props.fieldwork.selectItem(item);
}
</script>

<template>
  <section class="inventory-fieldwork" :aria-label="t('inventory.fieldMode')">
    <aside class="inventory-fieldwork__locations">
      <h3>{{ t("inventory.fieldLocation") }}</h3>
      <el-button
        class="inventory-fieldwork__location-toggle"
        :aria-expanded="locationsExpanded"
        aria-controls="inventory-field-location-controls"
        @click="locationsExpanded = !locationsExpanded"
        >{{ locationLabel }} ·
        {{
          t(
            locationsExpanded
              ? "inventory.fieldHideFilters"
              : "asset.moreFilters",
          )
        }}</el-button
      >
      <div
        id="inventory-field-location-controls"
        class="inventory-fieldwork__location-controls"
        :class="{ 'is-expanded': locationsExpanded }"
      >
        <p>{{ t("inventory.fieldSnapshotHint") }}</p>
        <el-form label-position="top" :disabled="busy || summaryLoading">
          <el-form-item :label="t('common.dataCenter')">
            <el-select
              v-model="itemDataCenter"
              filterable
              @change="fieldwork.applyFilters('center')"
            >
              <el-option :label="t('inventory.fieldAllLocations')" value="" />
              <el-option
                v-for="option in centers"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('common.room')">
            <el-select
              v-model="itemRoom"
              filterable
              :disabled="
                itemPlacement === 'unmounted' || itemPlacement === 'unlocated'
              "
              @change="fieldwork.applyFilters('room')"
            >
              <el-option :label="t('inventory.fieldAllLocations')" value="" />
              <el-option
                v-for="option in rooms"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('location.rack')">
            <el-select
              v-model="itemRack"
              filterable
              :disabled="
                itemPlacement === 'unmounted' || itemPlacement === 'unlocated'
              "
              @change="fieldwork.applyFilters()"
            >
              <el-option :label="t('inventory.fieldAllLocations')" value="" />
              <el-option
                v-for="option in racks"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('inventory.fieldPlacement')">
            <el-select
              v-model="itemPlacement"
              @change="fieldwork.applyFilters('placement')"
            >
              <el-option :label="t('inventory.fieldAllLocations')" value="" />
              <el-option :label="t('inventory.mounted')" value="mounted" />
              <el-option :label="t('inventory.unmounted')" value="unmounted" />
              <el-option
                :label="t('inventory.placementUnlocated')"
                value="unlocated"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <el-button link :disabled="busy" @click="fieldwork.clearFilters()">{{
          t("common.clearFilters")
        }}</el-button>
      </div>
    </aside>
    <div class="inventory-fieldwork__work">
      <div class="inventory-fieldwork__range" role="status" aria-live="polite">
        <div>
          <span>{{ t("inventory.fieldRangeProgress") }}</span
          ><strong
            >{{ summary ? rangeSummary.checked : "—" }} /
            {{ summary ? rangeSummary.total : "—" }}</strong
          >
        </div>
        <div>
          <span>{{ t("inventory.notCheckedShort") }}</span
          ><strong>{{ summary ? rangeSummary.pending : "—" }}</strong>
        </div>
        <div>
          <span>{{ t("inventory.fieldUnresolved") }}</span
          ><strong>{{
            summary ? rangeSummary.resolution_pending : "—"
          }}</strong>
        </div>
      </div>
      <el-alert
        v-if="summaryError"
        :title="summaryError"
        type="error"
        :closable="false"
      >
        <el-button link @click="fieldwork.loadSummary()">{{
          t("common.retry")
        }}</el-button>
      </el-alert>
      <div class="inventory-fieldwork__search">
        <el-input
          v-model="itemSearch"
          clearable
          :disabled="busy"
          :placeholder="t('inventory.searchItems')"
          :aria-label="t('inventory.searchItems')"
          @keyup.enter="fieldwork.applyFilters()"
          @clear="fieldwork.applyFilters()"
        >
          <template #append
            ><el-button :disabled="busy" @click="fieldwork.applyFilters()">{{
              t("common.search")
            }}</el-button></template
          >
        </el-input>
        <el-checkbox
          v-model="onlyPending"
          :disabled="busy"
          @change="fieldwork.applyFilters()"
          >{{ t("inventory.fieldOnlyPending") }}</el-checkbox
        >
      </div>
      <el-alert
        v-if="navigationError || itemListError"
        :title="navigationError || itemListError"
        type="error"
        :closable="false"
      >
        <el-button link :disabled="busy" @click="fieldwork.applyFilters()">{{
          t("inventory.retryItems")
        }}</el-button>
      </el-alert>
      <div class="inventory-fieldwork__selector">
        <el-select
          :model-value="selectedItem?.id"
          filterable
          :placeholder="t('inventory.fieldChooseAsset')"
          :disabled="busy || Boolean(navigationError || itemListError)"
          @change="choose"
        >
          <el-option
            v-for="item in items"
            :key="item.id"
            :value="item.id"
            :label="`${item.asset_no} · ${item.asset_name}`"
          />
        </el-select>
        <span aria-live="polite">{{ position }} / {{ itemCount }}</span>
      </div>
      <article
        v-if="selectedItem"
        class="inventory-fieldwork__card"
        :aria-busy="busy"
      >
        <header>
          <div>
            <span class="inventory-fieldwork__number">{{
              selectedItem.asset_no
            }}</span>
            <h3>{{ selectedItem.asset_name }}</h3>
          </div>
          <StatusTag
            :tone="inventory.statusTagType(selectedItem.status)"
            :label="
              businessOptionLabel(
                INVENTORY_ITEM_STATUS_OPTIONS,
                selectedItem.status,
              )
            "
          />
        </header>
        <dl>
          <div>
            <dt>{{ t("asset.serialNumber") }}</dt>
            <dd>{{ selectedItem.serial_number || "—" }}</dd>
          </div>
          <div>
            <dt>{{ t("asset.deviceType") }}</dt>
            <dd>{{ selectedItem.device_type_name || "—" }}</dd>
          </div>
          <div class="inventory-fieldwork__expected">
            <dt>{{ t("inventory.fieldExpectedLocation") }}</dt>
            <dd>{{ inventory.locationText(selectedItem) }}</dd>
          </div>
        </dl>
        <el-alert
          v-if="selectedItem.current_location?.changed"
          type="warning"
          :closable="false"
          :title="t('inventory.fieldLocationChanged')"
          :description="currentLocation"
        />
        <p v-if="selectedItem.checked_at" class="inventory-fieldwork__checked">
          {{ selectedItem.checked_by_name || "—" }} ·
          {{ inventory.formatDateTime(selectedItem.checked_at) }}
        </p>
        <p v-if="selectedItem.notes" class="inventory-fieldwork__notes">
          {{ selectedItem.notes }}
        </p>
        <div
          v-if="inventory.canRecordInventory(selectedItem)"
          class="inventory-fieldwork__actions"
        >
          <el-button
            v-if="selectedItem.status === 'pending'"
            type="primary"
            :loading="inventory.scannedNormalSaving.value"
            :disabled="
              busy || Boolean(summaryError || navigationError || itemListError)
            "
            @click="fieldwork.confirmAndNext()"
            >{{ t("inventory.fieldConfirmNext") }}</el-button
          >
          <el-button
            :disabled="
              busy || Boolean(summaryError || navigationError || itemListError)
            "
            @click="inventory.openItem(selectedItem)"
            >{{
              t(
                selectedItem.status === "pending"
                  ? "inventory.recordResult"
                  : "inventory.editResult",
              )
            }}</el-button
          >
        </div>
        <el-alert
          v-else
          type="info"
          :closable="false"
          :title="t('inventory.fieldReadOnly')"
        />
      </article>
      <el-empty
        v-else
        :image-size="56"
        :description="
          notice ||
          (busy ? t('common.loading') : t('inventory.noMatchingItems'))
        "
      />
      <nav
        class="inventory-fieldwork__navigation"
        :aria-label="t('inventory.fieldNavigation')"
      >
        <el-button
          :disabled="
            busy || position <= 1 || Boolean(navigationError || itemListError)
          "
          @click="fieldwork.move(-1)"
          >{{ t("inventory.fieldPrevious") }}</el-button
        >
        <el-button
          :disabled="
            busy ||
            position === 0 ||
            position >= itemCount ||
            Boolean(navigationError || itemListError)
          "
          @click="fieldwork.move(1)"
          >{{ t("inventory.fieldNext") }}</el-button
        >
      </nav>
    </div>
  </section>
</template>

<style scoped>
.inventory-fieldwork {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 24px;
}
.inventory-fieldwork__locations {
  padding-right: 24px;
  border-right: 1px solid var(--el-border-color-light);
}
.inventory-fieldwork__locations h3 {
  margin: 0;
  font-size: 15px;
}
.inventory-fieldwork__location-toggle {
  display: none;
}
.inventory-fieldwork__locations p {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.inventory-fieldwork__locations .el-select {
  width: 100%;
}
.inventory-fieldwork__work {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 16px;
}
.inventory-fieldwork__range {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-light);
}
.inventory-fieldwork__range div {
  display: grid;
  gap: 4px;
}
.inventory-fieldwork__range span,
.inventory-fieldwork__checked {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.inventory-fieldwork__range strong {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
.inventory-fieldwork__search,
.inventory-fieldwork__selector {
  display: flex;
  align-items: center;
  gap: 16px;
}
.inventory-fieldwork__search .el-input,
.inventory-fieldwork__selector .el-select {
  flex: 1;
  min-width: 0;
}
.inventory-fieldwork__selector > span {
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.inventory-fieldwork__card {
  padding: 24px;
  border: 1px solid var(--el-border-color-light);
  border-top: 3px solid var(--el-color-primary);
  border-radius: var(--el-border-radius-base);
}
.inventory-fieldwork__card header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
}
.inventory-fieldwork__number {
  font-size: 22px;
  font-weight: 650;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.inventory-fieldwork__card h3 {
  margin: 4px 0 20px;
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.inventory-fieldwork__card dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 0 0 20px;
}
.inventory-fieldwork__card dt {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 5px;
}
.inventory-fieldwork__card dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.inventory-fieldwork__expected {
  grid-column: 1 / -1;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);
}
.inventory-fieldwork__notes {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.inventory-fieldwork__actions,
.inventory-fieldwork__navigation {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.inventory-fieldwork__actions .el-button + .el-button,
.inventory-fieldwork__navigation .el-button + .el-button {
  margin-left: 0;
}
.inventory-fieldwork__navigation {
  justify-content: space-between;
}
@media (max-width: 760px) {
  .inventory-fieldwork {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .inventory-fieldwork__locations {
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-light);
  }
  .inventory-fieldwork__location-toggle {
    display: block;
    max-width: 100%;
    margin-top: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .inventory-fieldwork__location-controls {
    display: none;
  }
  .inventory-fieldwork__location-controls.is-expanded {
    display: block;
  }
  .inventory-fieldwork__locations .el-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0 12px;
  }
  .inventory-fieldwork__locations .el-form-item {
    min-width: 0;
    margin-bottom: 10px;
  }
  .inventory-fieldwork__search {
    flex-wrap: wrap;
    gap: 4px;
  }
  .inventory-fieldwork__search .el-input {
    flex-basis: 100%;
  }
  .inventory-fieldwork__card {
    padding: 16px;
  }
  .inventory-fieldwork__number {
    font-size: 20px;
  }
}
</style>
