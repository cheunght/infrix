<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { InventoryItem } from "../types";
import { inventoryLocationText } from "../inventory-location";
import {
  businessOptionLabel,
  INVENTORY_ITEM_STATUS_OPTIONS,
} from "../business-enums";
defineProps<{ item: InventoryItem }>();
const { t } = useI18n();
</script>

<template>
  <section
    class="inventory-comparison"
    :aria-label="t('inventory.reviewComparison')"
  >
    <div>
      <h4>{{ t("inventory.reviewSnapshot") }}</h4>
      <strong>{{ inventoryLocationText(item) }}</strong>
      <p>{{ item.asset_no }} · {{ item.asset_name }}</p>
      <p>{{ t("asset.serialNumber") }}: {{ item.serial_number || "—" }}</p>
    </div>
    <div>
      <h4>{{ t("inventory.reviewObserved") }}</h4>
      <strong>{{ inventoryLocationText(item, "observed") }}</strong>
      <p>
        {{ businessOptionLabel(INVENTORY_ITEM_STATUS_OPTIONS, item.status) }}
      </p>
      <p class="inventory-comparison__note">
        {{ item.notes || t("inventory.noInventoryNote") }}
      </p>
      <small>{{ t("inventory.reviewObservationHint") }}</small>
    </div>
    <div>
      <h4>{{ t("inventory.reviewCurrent") }}</h4>
      <strong>{{ inventoryLocationText(item, "current") }}</strong>
      <template v-if="item.current_asset">
        <p>{{ item.current_asset.asset_no }} · {{ item.current_asset.name }}</p>
        <p>
          {{ t("asset.serialNumber") }}:
          {{ item.current_asset.serial_number || "—" }}
        </p>
      </template>
      <p v-else>{{ t("inventory.reviewUnavailable") }}</p>
    </div>
  </section>
</template>

<style scoped>
.inventory-comparison {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.inventory-comparison > div {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
}
.inventory-comparison h4 {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.inventory-comparison strong {
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.inventory-comparison p {
  margin: 8px 0 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.inventory-comparison small {
  display: block;
  margin-top: 10px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.inventory-comparison__note {
  white-space: pre-wrap;
}
@media (max-width: 1100px) {
  .inventory-comparison {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
