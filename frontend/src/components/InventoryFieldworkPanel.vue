<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
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
  itemPage,
  itemPageSize,
} = props.inventory;
const searchInput = ref<{ focus: () => void } | null>(null);
const searchDraft = ref(itemSearch.value);
watch(itemSearch, (value) => {
  searchDraft.value = value;
});
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
  if (busy.value || navigationError.value || itemListError.value) return;
  const item = items.value.find((row) => row.id === id);
  if (item) props.fieldwork.selectItem(item);
}
async function focusSelected() {
  await nextTick();
  panel.value
    ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
    ?.focus({ preventScroll: true });
}
async function confirmAndNext() {
  await props.fieldwork.confirmAndNext();
  await focusSelected();
}
watch(props.inventory.showItemDialog, (visible) => {
  if (!visible) void focusSelected();
});
async function search(event?: Event) {
  if (
    busy.value ||
    (event instanceof KeyboardEvent &&
      (event.isComposing || event.keyCode === 229))
  )
    return;
  itemSearch.value = searchDraft.value.trim();
  await props.fieldwork.applyFilters();
  await nextTick();
  const selected = panel.value?.querySelector<HTMLButtonElement>(
    '[aria-current="true"]',
  );
  if (selected) selected.focus({ preventScroll: true });
  else searchInput.value?.focus();
}
async function handleKeydown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    props.inventory.showItemDialog.value ||
    props.inventory.showResolutionDialog.value ||
    event.ctrlKey ||
    event.metaKey ||
    busy.value
  )
    return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"]',
    )
  )
    return;
  if (event.key === "/" && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    searchInput.value?.focus();
    return;
  }
  if (navigationError.value || itemListError.value || summaryError.value)
    return;
  if (
    event.altKey &&
    !event.shiftKey &&
    ["ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    event.preventDefault();
    if (
      position.value === 0 ||
      (event.key === "ArrowUp"
        ? position.value <= 1
        : position.value >= itemCount.value)
    )
      return;
    await props.fieldwork.move(event.key === "ArrowUp" ? -1 : 1);
    await nextTick();
    // Keep keyboard navigation inside the list after crossing a server page.
    panel.value
      ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
      ?.focus({ preventScroll: true });
  } else if (
    event.altKey &&
    !event.shiftKey &&
    (event.code === "KeyR" || event.key.toLowerCase() === "r") &&
    selectedItem.value &&
    props.inventory.canRecordInventory(selectedItem.value)
  ) {
    event.preventDefault();
    void props.inventory.openItem(selectedItem.value);
  }
}
const panel = ref<HTMLElement | null>(null);
watch(
  () => selectedItem.value?.id,
  async () => {
    await nextTick();
    const button = panel.value?.querySelector<HTMLButtonElement>(
      '[aria-current="true"]',
    );
    const list = button?.closest("ul");
    if (!button || !list) return;
    if (button.offsetTop < list.scrollTop) list.scrollTop = button.offsetTop;
    else if (
      button.offsetTop + button.offsetHeight >
      list.scrollTop + list.clientHeight
    )
      list.scrollTop =
        button.offsetTop + button.offsetHeight - list.clientHeight;
  },
);
</script>

<template>
  <section
    ref="panel"
    class="inventory-fieldwork"
    :aria-label="t('inventory.fieldMode')"
    @keydown="handleKeydown"
  >
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
          ref="searchInput"
          v-model="searchDraft"
          clearable
          :disabled="busy"
          :placeholder="t('inventory.searchItems')"
          :aria-label="t('inventory.searchItems')"
          @keyup.enter="search"
          @clear="search"
        >
          <template #append
            ><el-button :disabled="busy" @click="search">{{
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
      <p class="inventory-fieldwork__shortcuts">
        {{ t("inventory.fieldKeyboardHint") }}
      </p>
      <div class="inventory-fieldwork__workspace">
        <section
          class="inventory-fieldwork__queue"
          :aria-label="t('inventory.fieldDeviceList')"
          :aria-busy="busy"
        >
          <header>
            <strong>{{ t("inventory.fieldDeviceList") }}</strong
            ><span aria-live="polite">{{ position }} / {{ itemCount }}</span>
          </header>
          <ul>
            <li v-for="item in items" :key="item.id">
              <button
                type="button"
                :aria-current="
                  item.id === selectedItem?.id ? 'true' : undefined
                "
                :tabindex="
                  item.id === selectedItem?.id ||
                  (!selectedItem && item.id === items[0]?.id)
                    ? 0
                    : -1
                "
                :disabled="busy || Boolean(navigationError || itemListError)"
                @click="choose(item.id)"
              >
                <strong>{{ item.asset_no }}</strong>
                <StatusTag
                  :tone="inventory.statusTagType(item.status)"
                  :label="
                    businessOptionLabel(
                      INVENTORY_ITEM_STATUS_OPTIONS,
                      item.status,
                    )
                  "
                />
                <span>{{ item.asset_name }}</span>
                <small>{{ item.serial_number || "—" }}</small>
              </button>
            </li>
          </ul>
          <el-empty
            v-if="!items.length"
            :image-size="40"
            :description="
              busy ? t('common.loading') : t('inventory.noMatchingItems')
            "
          />
          <el-pagination
            v-if="itemCount > itemPageSize"
            size="small"
            layout="prev, pager, next"
            :pager-count="5"
            :current-page="itemPage"
            :page-size="itemPageSize"
            :total="itemCount"
            :disabled="busy"
            @current-change="fieldwork.goToPage($event)"
          />
        </section>
        <div class="inventory-fieldwork__detail">
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
            <p
              v-if="selectedItem.checked_at"
              class="inventory-fieldwork__checked"
            >
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
                  busy ||
                  Boolean(summaryError || navigationError || itemListError)
                "
                @click="confirmAndNext"
                >{{ t("inventory.fieldConfirmNext") }}</el-button
              >
              <el-button
                :disabled="
                  busy ||
                  Boolean(summaryError || navigationError || itemListError)
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
                busy ||
                position <= 1 ||
                Boolean(navigationError || itemListError)
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
      </div>
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
.inventory-fieldwork__search {
  display: flex;
  align-items: center;
  gap: 16px;
}
.inventory-fieldwork__search .el-input {
  flex: 1;
  min-width: 0;
}
.inventory-fieldwork__queue header > span {
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.inventory-fieldwork__shortcuts {
  margin: -4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.inventory-fieldwork__workspace {
  display: grid;
  grid-template-columns: minmax(210px, 0.7fr) minmax(0, 1.6fr);
  align-items: start;
  gap: 20px;
}
.inventory-fieldwork__queue {
  min-width: 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  overflow: hidden;
}
.inventory-fieldwork__queue header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  background: var(--el-fill-color-light);
  font-size: 13px;
}
.inventory-fieldwork__queue ul {
  position: relative;
  list-style: none;
  max-height: 520px;
  overflow-y: auto;
  padding: 0;
  margin: 0;
}
.inventory-fieldwork__queue li + li {
  border-top: 1px solid var(--el-border-color-lighter);
}
.inventory-fieldwork__queue li > button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 8px;
  width: 100%;
  padding: 12px;
  border: 0;
  border-left: 3px solid transparent;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.inventory-fieldwork__queue li > button > strong,
.inventory-fieldwork__queue li > button > span,
.inventory-fieldwork__queue li > button > small {
  overflow-wrap: anywhere;
  min-width: 0;
}
.inventory-fieldwork__queue li > button > span:not(.el-tag),
.inventory-fieldwork__queue li > button > small {
  grid-column: 1 / -1;
  color: var(--el-text-color-secondary);
}
.inventory-fieldwork__queue li > button:hover,
.inventory-fieldwork__queue li > button[aria-current="true"] {
  background: var(--el-color-primary-light-9);
}
.inventory-fieldwork__queue li > button[aria-current="true"] {
  border-left-color: var(--el-color-primary);
}
.inventory-fieldwork__queue li > button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -3px;
}
.inventory-fieldwork__queue li > button:disabled {
  cursor: default;
  opacity: 0.65;
}
.inventory-fieldwork__queue .el-pagination {
  justify-content: center;
  padding: 12px 4px;
  border-top: 1px solid var(--el-border-color-light);
}
.inventory-fieldwork__detail {
  min-width: 0;
  display: grid;
  gap: 16px;
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
@media (max-width: 1200px) {
  .inventory-fieldwork {
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 16px;
  }
  .inventory-fieldwork__locations {
    padding-right: 16px;
  }
  .inventory-fieldwork__workspace {
    grid-template-columns: minmax(190px, 0.8fr) minmax(0, 1.4fr);
    gap: 12px;
  }
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
  .inventory-fieldwork__workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .inventory-fieldwork__queue ul {
    max-height: 240px;
  }
}
</style>
