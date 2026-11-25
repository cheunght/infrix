"""Stable attribution rules for the asset audit index and its historical backfill."""

from collections.abc import Mapping


LEGACY_ASSET_RELATIONS = {
    "fault_event": ("FaultEvent", "asset_id"),
    "repair_record": ("RepairRecord", "fault__asset_id"),
}
RELATED_ASSET_EVENTS = {
    "attachment", "inventory_item", "fault_event", "repair_record",
    "repair_part_usage", "spare_stock_transaction",
}


def audit_resource_pk(value):
    if not isinstance(value, str) or len(value) > 19 or not value.isascii() or not value.isdecimal():
        return None
    pk = int(value)
    return pk if 0 < pk <= 2**63 - 1 and str(pk) == value else None


def recorded_asset_id(resource_type, resource_id, payload):
    if resource_type == "asset":
        return audit_resource_pk(resource_id)
    if resource_type not in RELATED_ASSET_EVENTS or not isinstance(payload, Mapping):
        return None
    extra = payload.get("extra")
    if not isinstance(extra, Mapping):
        return None
    if resource_type == "attachment" and ("repair_id" not in extra or extra["repair_id"] is not None):
        return None
    value = extra.get("asset_id")
    return value if type(value) is int and 0 < value <= 2**63 - 1 else None
