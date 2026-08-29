import { reactive } from "vue";
import type { AssetStatus, SystemSettings } from "./types";

/** Small shared snapshot for defaults consumed by more than one composable. */
export const systemSettingsState = reactive({
  defaultPageSize: 50,
  defaultAssetStatus: "in_stock" as AssetStatus,
  loaded: false,
});

export function applySystemSettings(settings: SystemSettings): void {
  if (Number.isFinite(settings.default_page_size)) {
    systemSettingsState.defaultPageSize = settings.default_page_size;
  }
  if (typeof settings.default_asset_status === "string") {
    systemSettingsState.defaultAssetStatus = settings.default_asset_status;
  }
  systemSettingsState.loaded = true;
}
