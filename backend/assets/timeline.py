"""Asset-scoped timeline projection over the existing audit stream.

The timeline deliberately remains a read model.  AuditLog is the source of
truth; this module only scopes, classifies, and projects safe historical
snapshots for one asset.
"""

from collections.abc import Mapping
from typing import Any

from django.db import connection
from django.db.models import CharField, Q, QuerySet, Subquery
from django.db.models.functions import Cast, Collate

from .audit import json_value
from .models import AuditLog, FaultEvent, RepairRecord


TIMELINE_EVENT_TYPES = (
    "created",
    "updated",
    "lifecycle",
    "placement",
    "assignment",
    "maintenance",
    "inventory",
    "attachment",
    "other",
)

_MAX_VALUE_LENGTH = 800
_MAX_COLLECTION_ITEMS = 20
_MYSQL_RESOURCE_ID_COLLATION = "utf8mb4_unicode_ci"


def _legacy_resource_id_subquery(queryset):
    """Build a portable string-ID subquery for legacy audit rows.

    ``AuditLog.resource_id`` is a character column.  On MariaDB, a plain
    ``CAST(pk AS CHAR)`` inherits ``collation_connection`` and can therefore
    compare with a different implicit collation from ``resource_id``.  That
    makes the whole timeline query fail with error 1267.  Keep SQLite's
    compiler untouched while making the production MySQL/MariaDB comparison
    explicit.
    """

    resource_id_text = Cast("pk", output_field=CharField())
    if connection.vendor == "mysql":
        resource_id_text = Collate(resource_id_text, _MYSQL_RESOURCE_ID_COLLATION)
    return queryset.annotate(resource_id_text=resource_id_text).values("resource_id_text")


def asset_timeline_queryset(asset_id: int) -> QuerySet[AuditLog]:
    """Return only audit rows that can be attributed to ``asset_id``.

    Direct asset rows use the indexed resource pair.  Related business audit
    rows carry an asset id in their existing ``extra`` metadata.  The two
    relational subqueries retain compatibility with older fault/repair audit
    rows whose metadata predates that small enrichment.
    """

    asset_id = int(asset_id)
    asset_resource = Q(resource_type="asset", resource_id=str(asset_id))
    attachment_resource = Q(
        resource_type="attachment",
        payload__extra__asset_id=asset_id,
        payload__extra__repair_id=None,
    )
    inventory_resource = Q(
        resource_type="inventory_item",
        payload__extra__asset_id=asset_id,
    )
    fault_resource = Q(
        resource_type="fault_event",
        payload__extra__asset_id=asset_id,
    )
    repair_resource = Q(
        resource_type="repair_record",
        payload__extra__asset_id=asset_id,
    )
    repair_part_usage_resource = Q(
        resource_type="repair_part_usage",
        payload__extra__asset_id=asset_id,
    )
    spare_stock_transaction_resource = Q(
        resource_type="spare_stock_transaction",
        payload__extra__asset_id=asset_id,
    )

    # Existing rows written before the related audit metadata was enriched can
    # still be scoped without loading all audit logs into Python.
    fault_ids = _legacy_resource_id_subquery(FaultEvent.objects.filter(asset_id=asset_id))
    repair_ids = _legacy_resource_id_subquery(RepairRecord.objects.filter(fault__asset_id=asset_id))
    legacy_fault_resource = Q(
        resource_type="fault_event",
        resource_id__in=Subquery(fault_ids),
    )
    legacy_repair_resource = Q(
        resource_type="repair_record",
        resource_id__in=Subquery(repair_ids),
    )

    return (
        AuditLog.objects.select_related("actor")
        .filter(
            asset_resource
            | attachment_resource
            | inventory_resource
            | fault_resource
            | repair_resource
            | repair_part_usage_resource
            | spare_stock_transaction_resource
            | legacy_fault_resource
            | legacy_repair_resource
        )
        .order_by("-created_at", "-id")
    )


def _mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _safe_payload(value: Any) -> Any:
    return _bounded(json_value(value), 0)


def _bounded(value: Any, depth: int, *, preserve_mapping_keys: bool = False) -> Any:
    """Keep an audit value useful without returning an unbounded JSON blob."""

    if depth >= 3:
        return "…" if isinstance(value, (Mapping, list, tuple)) else value
    if isinstance(value, Mapping):
        items = list(value.items())
        if not (preserve_mapping_keys and depth <= 1):
            items = items[:_MAX_COLLECTION_ITEMS]
        return {
            str(key): _bounded(item, depth + 1, preserve_mapping_keys=preserve_mapping_keys)
            for key, item in items
        }
    if isinstance(value, (list, tuple)):
        return [
            _bounded(item, depth + 1, preserve_mapping_keys=preserve_mapping_keys)
            for item in value[:_MAX_COLLECTION_ITEMS]
        ]
    if isinstance(value, str) and len(value) > _MAX_VALUE_LENGTH:
        return f"{value[:_MAX_VALUE_LENGTH]}…"
    return value


def _payload(log: AuditLog) -> dict[str, Any]:
    # Preserve the known top-level snapshot keys while still bounding nested
    # arbitrary values.  Bounding the whole payload first can discard
    # whitelisted fields such as a nested rack allocation merely because they
    # occur after the first 20 mapping keys.  Every value copied into the
    # public DTO is still bounded at its output boundary below.
    value = _bounded(json_value(log.payload or {}), 0, preserve_mapping_keys=True)
    return _mapping(value)


def _extra(payload: Mapping[str, Any]) -> dict[str, Any]:
    return _mapping(payload.get("extra"))


def _snapshot(payload: Mapping[str, Any], key: str) -> dict[str, Any]:
    return _mapping(payload.get(key))


def _person_value(snapshot: Mapping[str, Any]) -> Any:
    person = _mapping(snapshot.get("assigned_person"))
    if not person:
        return None
    return (
        person.get("display_name")
        or person.get("name")
        or person.get("employee_no")
        or None
    )


def _rack_value(snapshot: Mapping[str, Any]) -> Any:
    allocation = _mapping(snapshot.get("rack_allocation"))
    if not allocation:
        return None
    location = [
        allocation.get("data_center"),
        allocation.get("server_room"),
        allocation.get("rack_code"),
    ]
    location = [str(item) for item in location if item not in (None, "")]
    start_u = allocation.get("start_u")
    end_u = allocation.get("end_u")
    if start_u is not None and end_u is not None:
        location.append(f"U{start_u}-{end_u}")
    return " / ".join(location) or None


def _names_value(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    names = []
    for item in value[:_MAX_COLLECTION_ITEMS]:
        if isinstance(item, Mapping):
            name = item.get("name") or item.get("label") or item.get("file_name")
            names.append(str(name) if name not in (None, "") else str(item.get("id", "")))
        elif item not in (None, ""):
            names.append(str(item))
    return ", ".join(item for item in names if item)


def _compact_records(value: Any, fields: tuple[str, ...]) -> Any:
    if not isinstance(value, list):
        return value
    rows = []
    for item in value[:_MAX_COLLECTION_ITEMS]:
        record = _mapping(item)
        parts = [str(record[field]) for field in fields if record.get(field) not in (None, "")]
        if parts:
            rows.append(" / ".join(parts))
    return "; ".join(rows)


def _asset_field_value(snapshot: Mapping[str, Any], field: str) -> Any:
    if field == "assigned_person":
        return _person_value(snapshot)
    if field == "rack_allocation":
        return _rack_value(snapshot)
    if field == "asset_data_center":
        return snapshot.get("asset_data_center_name")
    if field == "asset_model":
        return snapshot.get("model_name") or snapshot.get("model_text")
    if field == "tags":
        return _names_value(snapshot.get("tags") or snapshot.get("tag_names"))
    if field == "network_addresses":
        addresses = []
        for item in snapshot.get("network_addresses") or []:
            row = _mapping(item)
            role = row.get("role")
            address = row.get("address")
            if role or address:
                addresses.append(" / ".join(str(value) for value in (role, address) if value not in (None, "")))
        return "; ".join(addresses)
    if field == "procurement_records":
        return _compact_records(snapshot.get(field), ("supplier", "order_no", "purchase_date"))
    if field == "maintenance_contracts":
        return _compact_records(snapshot.get(field), ("provider", "contract_no", "expiry_date"))
    return snapshot.get(field)


_ASSET_FIELDS = (
    "asset_no",
    "name",
    "status",
    "assigned_person",
    "rack_allocation",
    "asset_data_center",
    "asset_model",
    "serial_number",
    "purpose",
    "notes",
    "warranty_months",
    "depreciation_start_date",
    "depreciation_years",
    "residual_rate",
    "depreciation_method",
    "network_addresses",
    "procurement_records",
    "maintenance_contracts",
    "tags",
)

_ASSET_CREATE_DELETE_FIELDS = (
    "asset_no",
    "name",
    "status",
    "assigned_person",
    "rack_allocation",
)

_RELATED_FIELDS = {
    "attachment": (
        ("file_name", "file_name"),
        ("category", "attachment_category"),
        ("note", "note"),
        ("size", "size"),
    ),
    "inventory_item": (
        ("status", "inventory_status"),
        ("resolution_status", "inventory_resolution_status"),
        ("resolution_action", "inventory_resolution_action"),
        ("actual_data_center", "actual_data_center"),
        ("actual_server_room", "actual_server_room"),
        ("actual_rack_code", "actual_rack_code"),
        ("actual_start_u", "actual_start_u"),
        ("actual_end_u", "actual_end_u"),
        ("checked_by_name", "checked_by_name"),
        ("resolved_by_name", "resolved_by_name"),
        ("notes", "notes"),
        ("resolution_note", "resolution_note"),
    ),
    "fault_event": tuple((field, field) for field in ("occurred_at", "reason", "description", "is_closed", "resolved_at")),
    "repair_record": tuple((field, field) for field in ("provider", "started_at", "finished_at", "cost", "notes")),
    "repair_part_usage": (
        ("source", "repair_part_source"),
        ("part_name", "part_name"),
        ("part_code", "part_code"),
        ("part_model", "part_model"),
        ("unit", "spare_unit"),
        ("stock_location", "stock_location"),
        ("vendor_name", "vendor_name"),
        ("quantity", "quantity"),
        ("notes", "notes"),
    ),
    "spare_stock_transaction": (
        ("operation_type", "stock_operation_type"),
        ("part_name", "part_name"),
        ("part_code", "part_code"),
        ("unit", "spare_unit"),
        ("source_data_center_name", "source_data_center"),
        ("source_server_room_name", "source_server_room"),
        ("target_data_center_name", "target_data_center"),
        ("target_server_room_name", "target_server_room"),
        ("quantity", "quantity"),
        ("quantity_delta", "quantity_delta"),
        ("before_quantity", "before_quantity"),
        ("after_quantity", "after_quantity"),
        ("reference", "reference"),
        ("notes", "notes"),
    ),
}


def _meaningful_changes(
    log: AuditLog,
    payload: Mapping[str, Any],
) -> list[dict[str, Any]]:
    before = _snapshot(payload, "before")
    after = _snapshot(payload, "after")
    if log.resource_type == "asset":
        asset_fields = _ASSET_CREATE_DELETE_FIELDS if log.action in {"create", "delete"} else _ASSET_FIELDS
        fields = tuple((field, field) for field in asset_fields)
    else:
        fields = _RELATED_FIELDS.get(log.resource_type, ())

    changes = []
    for source_field, output_field in fields:
        old_value = _asset_field_value(before, source_field) if log.resource_type == "asset" else before.get(source_field)
        new_value = _asset_field_value(after, source_field) if log.resource_type == "asset" else after.get(source_field)
        if old_value == new_value:
            continue
        changes.append({
            "field": output_field,
            "label": None,
            "before": _safe_payload(old_value),
            "after": _safe_payload(new_value),
        })

    if log.resource_type == "asset":
        old_custom = {
            item.get("key"): item
            for item in before.get("custom_value_snapshot") or []
            if isinstance(item, Mapping) and item.get("key")
        }
        new_custom = {
            item.get("key"): item
            for item in after.get("custom_value_snapshot") or []
            if isinstance(item, Mapping) and item.get("key")
        }
        for key in sorted(set(old_custom) | set(new_custom)):
            old_item = old_custom.get(key) or {}
            new_item = new_custom.get(key) or {}
            old_value = old_item.get("value")
            new_value = new_item.get("value")
            if old_value == new_value:
                continue
            changes.append({
                "field": f"custom:{key}",
                "label": new_item.get("name") or old_item.get("name") or key,
                "before": _safe_payload(old_value),
                "after": _safe_payload(new_value),
            })

    return changes[:_MAX_COLLECTION_ITEMS]


def _changed(payload: Mapping[str, Any], field: str) -> bool:
    before = _snapshot(payload, "before")
    after = _snapshot(payload, "after")
    return _asset_field_value(before, field) != _asset_field_value(after, field)


def _event_type(log: AuditLog, payload: Mapping[str, Any]) -> str:
    extra = _extra(payload)
    if log.resource_type == "attachment":
        return "attachment"
    if log.resource_type in {"inventory_item"}:
        return "inventory"
    if log.resource_type in {"fault_event", "repair_record", "repair_part_usage", "spare_stock_transaction"}:
        return "maintenance"
    if log.resource_type != "asset":
        return "other"
    if log.action == "create":
        return "created"
    if log.action == "dispose" or extra.get("source") == "asset_disposal":
        return "lifecycle"
    if log.action in {"assign", "return", "transfer"} or extra.get("source") == "asset_assignment":
        return "assignment"
    if extra.get("source") in {"fault_status_sync", "repair_record", "fault_event"} or any(
        key in extra for key in ("fault_id", "repair_id")
    ):
        return "maintenance"
    if extra.get("source") == "inventory_resolution":
        return "inventory"
    if extra.get("source") == "asset_bulk_edit" and "location" in (extra.get("changed_fields") or []):
        return "placement"
    if _changed(payload, "rack_allocation") or _changed(payload, "asset_data_center"):
        return "placement"
    if _changed(payload, "status"):
        return "lifecycle"
    if log.action == "update" or log.action == "bulk_update":
        return "updated"
    return "other"


def _metadata(log: AuditLog, payload: Mapping[str, Any]) -> dict[str, Any]:
    extra = _extra(payload)
    allowed = {
        "source",
        "transition",
        "reason",
        "resolution_action",
        "resolution_status",
        "exception_status",
        "category",
        "fault_id",
        "repair_id",
        "repair_part_usage_id",
        "inventory_task_id",
        "inventory_item_id",
        "assignment_event_id",
        "asset_disposal_id",
        "asset_changed",
    }
    metadata = {
        key: _safe_payload(extra[key])
        for key in sorted(allowed)
        if key in extra and extra[key] not in (None, "", {}, [])
    }
    disposal = _mapping(extra.get("disposal"))
    if disposal:
        metadata["disposal"] = {
            key: _safe_payload(disposal[key])
            for key in ("disposed_on", "reason", "method", "operator_name", "notes")
            if disposal.get(key) not in (None, "")
        }
    return metadata


def _summary_key(log: AuditLog, event_type: str) -> str:
    if event_type == "maintenance":
        if log.resource_type == "repair_part_usage":
            return "asset.timeline.summaries.maintenancePartUsage"
        if log.resource_type == "spare_stock_transaction":
            return "asset.timeline.summaries.maintenanceStockTransaction"
    return f"asset.timeline.summaries.{event_type}"


def timeline_event(log: AuditLog) -> dict[str, Any]:
    """Project one AuditLog into the stable public timeline DTO."""

    payload = _payload(log)
    event_type = _event_type(log, payload)
    actor = None
    if log.actor_id and log.actor is not None:
        actor = {
            "id": log.actor_id,
            "username": log.actor.username,
            "display_name": log.actor.get_full_name().strip() or log.actor.username,
        }
    return {
        "id": log.pk,
        "timestamp": log.created_at,
        "event_type": event_type,
        "action": str(log.action or "other")[:80],
        # These are stable frontend i18n keys, not user-visible hardcoded text.
        "title": f"asset.timeline.eventTypes.{event_type}",
        "summary": _summary_key(log, event_type),
        "actor": actor,
        "changes": _meaningful_changes(log, payload),
        "metadata": _metadata(log, payload),
    }


def serialize_timeline(logs) -> list[dict[str, Any]]:
    return [timeline_event(log) for log in logs]
