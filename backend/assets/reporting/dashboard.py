"""Dashboard payload assembly.

This module deliberately contains read-only aggregation code.  The HTTP view
only resolves the request scope and delegates here, keeping reporting rules
out of the large API view module.
"""

from collections import defaultdict
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from ..models import AuditLog, FaultEvent, InventoryTask, MaintenanceContract, Rack
from .capacity import build_dashboard_capacity
from .constants import (
    AUDIT_ACTION_LABELS,
    DASHBOARD_LIMITS,
    EXPIRY_WINDOWS,
    STATUS_METADATA,
    TYPE_PALETTE,
)


def build_dashboard_payload(scope):
    """Build the complete backwards-compatible dashboard response."""
    asset_distributions = _build_asset_distributions(scope)
    capacity = build_dashboard_capacity(scope)
    expiry = _build_expiry_data(scope)
    alerts = _build_alert_data(scope)
    inventory_summary = _build_inventory_summary(scope)
    recent_changes = _build_recent_changes(scope)

    return {
        "assets": {
            "total": asset_distributions["asset_total"],
            "in_use": asset_distributions["status_counts"].get("in_use", 0),
            "in_stock": asset_distributions["status_counts"].get("in_stock", 0),
            "repair": asset_distributions["status_counts"].get("repair", 0),
            "idle": asset_distributions["status_counts"].get("idle", 0),
            "retired": asset_distributions["status_counts"].get("retired", 0),
        },
        "racks": {
            "total": len(scope.racks),
            "used_u": capacity["used_u"],
            "free_u": max(
                sum(rack.total_u for rack in scope.racks) - capacity["used_u"],
                0,
            ),
            "device_count": capacity["device_count"],
        },
        "alerts": {"open_faults": alerts["open_faults"]},
        "expiring": expiry["counts"],
        "status_distribution": asset_distributions["status_distribution"],
        "type_distribution": asset_distributions["type_distribution"],
        "data_center_capacity": capacity["data_center_capacity"],
        "room_capacity": capacity["room_capacity"],
        "recent_alerts": alerts["recent_alerts"],
        "upcoming_expirations": expiry["upcoming_expirations"],
        "data_centers": {"total": len(capacity["data_center_overview"])},
        "data_center_overview": capacity["data_center_overview"],
        "rack_capacity": capacity["rack_capacity"],
        "inventory_summary": inventory_summary,
        "recent_changes": recent_changes,
    }


def _build_asset_distributions(scope):
    status_counts = dict(
        scope.asset_queryset.values("status")
        .annotate(count=Count("id"))
        .values_list("status", "count")
    )
    asset_total = sum(status_counts.values())
    status_distribution = [
        {
            "status": status,
            "label": label,
            "count": status_counts.get(status, 0),
            "color": color,
        }
        for status, label, color in STATUS_METADATA
    ]

    type_counts = defaultdict(int)
    for asset in scope.asset_rows:
        type_name = asset.device_type.name if asset.device_type_id and asset.device_type else "其他设备"
        type_counts[type_name] += 1
    type_distribution = [
        {
            "type": name,
            "label": name,
            "count": count,
            "color": TYPE_PALETTE[index % len(TYPE_PALETTE)],
        }
        for index, (name, count) in enumerate(
            sorted(type_counts.items(), key=lambda item: (-item[1], item[0]))
        )
    ]
    return {
        "asset_total": asset_total,
        "status_counts": status_counts,
        "status_distribution": status_distribution,
        "type_distribution": type_distribution,
    }


def _build_expiry_data(scope):
    today = timezone.localdate()
    contracts = MaintenanceContract.objects.filter(asset_id__in=scope.asset_ids)
    expiry_30 = today + timedelta(days=EXPIRY_WINDOWS["within_30_days"])
    expiry_60 = today + timedelta(days=EXPIRY_WINDOWS["within_60_days"])
    expiry_90 = today + timedelta(days=EXPIRY_WINDOWS["within_90_days"])
    counts = {
        "expired": contracts.filter(expiry_date__lt=today).count(),
        "within_30_days": contracts.filter(
            expiry_date__gte=today, expiry_date__lte=expiry_30
        ).count(),
        "within_60_days": contracts.filter(
            expiry_date__gte=today, expiry_date__lte=expiry_60
        ).count(),
        "within_90_days": contracts.filter(
            expiry_date__gte=today, expiry_date__lte=expiry_90
        ).count(),
    }
    upcoming_expirations = []
    expiring_contracts = (
        MaintenanceContract.objects.select_related("asset")
        .filter(
            asset_id__in=scope.asset_ids,
            expiry_date__gte=today,
            expiry_date__lte=expiry_90,
        )
        .order_by("expiry_date", "asset__asset_no")
    )
    for contract in expiring_contracts[: DASHBOARD_LIMITS["upcoming_expirations"]]:
        upcoming_expirations.append(
            {
                "asset_id": contract.asset_id,
                "asset_no": contract.asset.asset_no,
                "asset_name": contract.asset.name,
                "expiry_date": contract.expiry_date,
                "days_remaining": (contract.expiry_date - today).days,
                "label": "设备保修",
            }
        )
    return {"counts": counts, "upcoming_expirations": upcoming_expirations}


def _build_alert_data(scope):
    open_faults = FaultEvent.objects.filter(
        is_closed=False, asset_id__in=scope.asset_ids
    )
    recent_alerts = []
    for fault in open_faults.select_related("asset").order_by("-occurred_at")[
        : DASHBOARD_LIMITS["recent_alerts"]
    ]:
        title = (fault.reason or fault.description or "设备故障").splitlines()[0][:120]
        recent_alerts.append(
            {
                "id": fault.id,
                "asset_id": fault.asset_id,
                "asset_no": fault.asset.asset_no,
                "asset_name": fault.asset.name,
                "title": title,
                "occurred_at": fault.occurred_at,
                "level": "warning",
            }
        )
    return {"open_faults": open_faults.count(), "recent_alerts": recent_alerts}


def _build_inventory_summary(scope):
    inventory_queryset = InventoryTask.objects.all()
    if scope.selected_data_center is not None:
        inventory_queryset = inventory_queryset.filter(
            data_center_id=scope.selected_data_center.id
        )
    if scope.selected_server_room is not None:
        inventory_queryset = inventory_queryset.filter(
            server_room_id=scope.selected_server_room.id
        )
    latest_inventory = (
        inventory_queryset.select_related("inspector")
        .order_by("-created_at", "-id")
        .first()
    )
    if latest_inventory is None:
        return None

    inventory_counts = dict(
        latest_inventory.items.values("status")
        .annotate(count=Count("id"))
        .values_list("status", "count")
    )
    total_items = sum(inventory_counts.values())
    checked_items = total_items - inventory_counts.get("pending", 0)
    inventory_rack_queryset = Rack.objects.filter(
        is_active=True,
        room__is_active=True,
        room__data_center__is_active=True,
        room__data_center_id=latest_inventory.data_center_id,
    )
    if latest_inventory.server_room_id:
        inventory_rack_queryset = inventory_rack_queryset.filter(
            room_id=latest_inventory.server_room_id
        )
    inventory_scope_rack_ids = set(inventory_rack_queryset.values_list("id", flat=True))
    checked_rack_ids = set()
    checked_item_rows = latest_inventory.items.filter(status__isnull=False).values(
        "status", "system_snapshot", "actual_rack_id"
    )
    for item in checked_item_rows:
        if item["status"] == "pending":
            continue
        rack_id = item.get("actual_rack_id")
        if rack_id is None:
            snapshot = item.get("system_snapshot") or {}
            rack_id = snapshot.get("rack_id")
            try:
                rack_id = int(rack_id) if rack_id is not None else None
            except (TypeError, ValueError):
                rack_id = None
        if rack_id in inventory_scope_rack_ids:
            checked_rack_ids.add(rack_id)

    return {
        "task_id": latest_inventory.id,
        "task_name": latest_inventory.name,
        "status": latest_inventory.status,
        "total": total_items,
        "checked": checked_items,
        "pending": inventory_counts.get("pending", 0),
        "normal": inventory_counts.get("normal", 0),
        "abnormal": sum(
            value
            for key, value in inventory_counts.items()
            if key not in {"pending", "normal"}
        ),
        "completion_rate": round(checked_items / total_items * 100, 1)
        if total_items
        else 0,
        "checked_racks": len(checked_rack_ids),
        "total_racks": len(inventory_scope_rack_ids),
        "latest_date": latest_inventory.completed_at or latest_inventory.updated_at,
    }


def _build_recent_changes(scope):
    asset_by_id = {asset.id: asset for asset in scope.asset_rows}
    audit_queryset = (
        AuditLog.objects.filter(
            resource_type="asset",
            resource_id__in=[str(asset_id) for asset_id in scope.asset_ids],
        )
        .select_related("actor")
        .order_by("-created_at", "-id")[: DASHBOARD_LIMITS["recent_audit_rows"]]
    )
    recent_changes = []
    for log in audit_queryset:
        try:
            asset_id = int(log.resource_id)
        except (TypeError, ValueError):
            continue
        asset = asset_by_id.get(asset_id)
        if asset is None:
            continue
        before = (log.payload or {}).get("before") or {}
        after = (log.payload or {}).get("after") or {}
        action_label = AUDIT_ACTION_LABELS.get(log.action, log.action)
        before_rack = before.get("rack_allocation") if isinstance(before, dict) else None
        after_rack = after.get("rack_allocation") if isinstance(after, dict) else None
        if log.action == "update" and before.get("status") != after.get("status"):
            action_label = "状态变化"
        elif log.action == "update" and before_rack != after_rack:
            if not before_rack and after_rack:
                action_label = "上架"
            elif before_rack and not after_rack:
                action_label = "下架"
            else:
                action_label = "迁移"

        allocation = getattr(asset, "rack_allocation", None)
        if allocation:
            location = (
                f"{allocation.rack.room.data_center.name} / "
                f"{allocation.rack.room.name} / {allocation.rack.code}"
            )
        elif asset.asset_data_center_id:
            location = asset.asset_data_center.name
        else:
            location = "未上架"
        actor_name = (
            (log.actor.get_full_name() or log.actor.username)
            if log.actor_id
            else "系统"
        )
        recent_changes.append(
            {
                "id": log.id,
                "action": action_label,
                "asset_id": asset.id,
                "asset_no": asset.asset_no,
                "asset_name": asset.name,
                "location": location,
                "actor_name": actor_name,
                "created_at": log.created_at,
            }
        )
        if len(recent_changes) >= DASHBOARD_LIMITS["recent_changes"]:
            break
    return recent_changes
