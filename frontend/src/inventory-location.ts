import { i18n } from "./i18n";
import type { InventoryItem } from "./types";

export function inventoryLocationText(
  item: InventoryItem,
  source: "snapshot" | "observed" | "current" = "snapshot",
): string {
  const tr = (key: string) => String(i18n.global.t(key));
  if (source === "observed") {
    if (item.status === "not_found") return tr("inventory.notObservedLocation");
    if (item.actual_placement === "unlocated")
      return tr("inventory.placementUnlocated");
    if (!item.actual_placement && !item.actual_rack)
      return tr("inventory.placementUnknown");
  }
  if (source === "current" && !item.current_location)
    return tr("inventory.reviewUnavailable");
  const observed = source === "observed";
  const location =
    source === "current"
      ? item.current_location!
      : {
          data_center: observed
            ? item.actual_data_center
            : item.system_data_center,
          server_room: observed
            ? item.actual_server_room
            : item.system_server_room,
          rack_code: observed ? item.actual_rack_code : item.system_rack_code,
          start_u: observed ? item.actual_start_u : item.system_start_u,
          end_u: observed ? item.actual_end_u : item.system_end_u,
        };
  const text = [location.data_center, location.server_room, location.rack_code]
    .filter(Boolean)
    .join(" / ");
  const u =
    location.start_u != null
      ? `U${location.start_u}–U${location.end_u}`
      : tr("inventory.unmounted");
  if (!text && location.start_u == null)
    return tr("inventory.placementUnlocated");
  return text ? `${text} · ${u}` : u;
}
