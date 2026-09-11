"""Read-only operational alerts assembled from existing business records."""

from collections import Counter
from datetime import timedelta
from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from ..models import (
    FaultEvent,
    InventoryTask,
    MaintenanceContract,
    SoftwareLicense,
    SparePart,
)
from ..system_settings import get_system_settings, system_now


ALERT_EXPIRY_DAYS = 30
ALERT_LIMIT = 100
_LEVEL_ORDER = {"critical": 0, "warning": 1, "notice": 2}


def _system_now(setting):
    """Use the deployment timezone for alert date boundaries."""

    return system_now(setting)


def _alert_sort_key(alert):
    return (
        _LEVEL_ORDER.get(alert["level"], 9),
        alert.get("sort_key", ""),
        alert["id"],
    )


def _due_alert_state(expiry_date, today):
    if expiry_date < today:
        return "expired", "critical"
    return "expiring", "warning"


def _maintenance_alerts(today, expiry_days=ALERT_EXPIRY_DAYS, limit=None):
    expiry_limit = today + timedelta(days=max(0, int(expiry_days)))
    alerts = []
    contracts = (
        MaintenanceContract.objects.select_related("asset")
        .filter(expiry_date__isnull=False, expiry_date__lte=expiry_limit)
        .order_by("expiry_date", "asset__asset_no", "id")
    )
    if limit is not None:
        contracts = contracts[:limit]
    for contract in contracts:
        state, level = _due_alert_state(contract.expiry_date, today)
        alerts.append(
            {
                "id": f"maintenance:{contract.id}",
                "kind": "maintenance",
                "state": state,
                "level": level,
                "entity_id": contract.id,
                "asset_id": contract.asset_id,
                "asset_no": contract.asset.asset_no,
                "asset_name": contract.asset.name,
                "reference": contract.contract_no or contract.provider or "",
                "due_date": contract.expiry_date.isoformat(),
                "days_remaining": (contract.expiry_date - today).days,
                "sort_key": contract.expiry_date.isoformat(),
            }
        )
    return alerts


def _license_alerts(today, expiry_days=ALERT_EXPIRY_DAYS, include_expiry=True, limit=None):
    expiry_limit = today + timedelta(days=max(0, int(expiry_days)))
    alerts = []
    over_limit_licenses = SoftwareLicense.objects.filter(
        used_count__gt=F("authorized_count"),
    ).order_by("id")
    if limit is not None:
        over_limit_licenses = over_limit_licenses[:limit]
    for license_row in over_limit_licenses:
        alerts.append(
            {
                "id": f"license-over-limit:{license_row.id}",
                "kind": "license",
                "state": "over_limit",
                "level": "critical",
                "entity_id": license_row.id,
                "name": license_row.name,
                "reference": license_row.name,
                "used_count": license_row.used_count,
                "authorized_count": license_row.authorized_count,
                "sort_key": "0000-00-00",
            }
        )
    if not include_expiry:
        return alerts

    expiry_licenses = SoftwareLicense.objects.filter(
        expiry_date__isnull=False,
        expiry_date__lte=expiry_limit,
    ).order_by("expiry_date", "name", "id")
    if limit is not None:
        expiry_licenses = expiry_licenses[:limit]
    for license_row in expiry_licenses:
        if license_row.expiry_date:
            state, level = _due_alert_state(license_row.expiry_date, today)
            alerts.append(
                {
                    "id": f"license:{license_row.id}",
                    "kind": "license",
                    "state": state,
                    "level": level,
                    "entity_id": license_row.id,
                    "name": license_row.name,
                    "reference": license_row.name,
                    "due_date": license_row.expiry_date.isoformat(),
                    "days_remaining": (license_row.expiry_date - today).days,
                    "used_count": license_row.used_count,
                    "authorized_count": license_row.authorized_count,
                    "sort_key": license_row.expiry_date.isoformat(),
                }
            )
    return alerts


def _fault_alerts(limit=None):
    alerts = []
    faults = (
        FaultEvent.objects.select_related("asset")
        .filter(is_closed=False)
        .order_by("occurred_at", "id")
    )
    if limit is not None:
        faults = faults[:limit]
    for fault in faults:
        reason = (fault.reason or fault.description or "").splitlines()[0][:160]
        alerts.append(
            {
                "id": f"fault:{fault.id}",
                "kind": "fault",
                "state": "open",
                "level": "critical",
                "entity_id": fault.id,
                "asset_id": fault.asset_id,
                "asset_no": fault.asset.asset_no,
                "asset_name": fault.asset.name,
                "reference": reason,
                "occurred_at": fault.occurred_at.isoformat(),
                "sort_key": fault.occurred_at.isoformat(),
            }
        )
    return alerts


def _inventory_alerts(now, limit=None):
    alerts = []
    tasks = (
        InventoryTask.objects.filter(status="in_progress", end_at__lt=now)
        .annotate(pending_count=Count("items", filter=Q(items__status="pending")))
        .order_by("end_at", "id")
    )
    if limit is not None:
        tasks = tasks[:limit]
    for task in tasks:
        task_end_date = timezone.localtime(task.end_at, now.tzinfo).date()
        alerts.append(
            {
                "id": f"inventory:{task.id}",
                "kind": "inventory",
                "state": "overdue",
                "level": "critical",
                "entity_id": task.id,
                "name": task.name,
                "reference": task.name,
                "due_at": task.end_at.isoformat(),
                "days_overdue": max((now.date() - task_end_date).days, 0),
                "pending_count": task.pending_count,
                "sort_key": task.end_at.isoformat(),
            }
        )
    return alerts


def _spare_alerts(limit=None):
    alerts = []
    parts = (
        SparePart.objects.filter(safety_stock__gt=0)
        .annotate(total_quantity=Coalesce(Sum("stocks__quantity"), 0))
        .filter(total_quantity__lt=F("safety_stock"))
        .order_by("name", "id")
    )
    if limit is not None:
        parts = parts[:limit]
    for part in parts:
        alerts.append(
            {
                "id": f"spare:{part.id}",
                "kind": "spare",
                "state": "below_safety_stock",
                "level": "warning",
                "entity_id": part.id,
                "code": part.code,
                "name": part.name,
                "reference": part.name,
                "quantity": part.total_quantity,
                "safety_stock": part.safety_stock,
                "sort_key": part.name,
            }
        )
    return alerts


def _alert_counts(*, today, now, setting, include_assets, include_licenses, include_faults, include_inventory, include_spares):
    """Count all active alerts without materializing rows for the summary."""
    counts = Counter()
    if include_assets and setting.notify_maintenance:
        expiry_limit = today + timedelta(days=max(0, int(setting.maintenance_expiry_days)))
        maintenance = MaintenanceContract.objects.filter(
            expiry_date__isnull=False,
            expiry_date__lte=expiry_limit,
        )
        counts["critical"] += maintenance.filter(expiry_date__lt=today).count()
        counts["warning"] += maintenance.filter(expiry_date__gte=today).count()

    if include_licenses:
        counts["critical"] += SoftwareLicense.objects.filter(
            used_count__gt=F("authorized_count"),
        ).count()
        if setting.notify_license_expiry:
            expiry_limit = today + timedelta(days=max(0, int(setting.license_expiry_days)))
            expiry = SoftwareLicense.objects.filter(
                expiry_date__isnull=False,
                expiry_date__lte=expiry_limit,
            )
            counts["critical"] += expiry.filter(expiry_date__lt=today).count()
            counts["warning"] += expiry.filter(expiry_date__gte=today).count()

    if include_faults and setting.notify_open_faults:
        counts["critical"] += FaultEvent.objects.filter(is_closed=False).count()

    if include_inventory and setting.notify_overdue_inventory:
        counts["critical"] += InventoryTask.objects.filter(
            status="in_progress",
            end_at__lt=now,
        ).count()

    if include_spares and setting.notify_low_spare_stock:
        counts["warning"] += (
            SparePart.objects.filter(safety_stock__gt=0)
            .annotate(total_quantity=Coalesce(Sum("stocks__quantity"), 0))
            .filter(total_quantity__lt=F("safety_stock"))
            .count()
        )
    return counts


def build_alerts_payload(
    *,
    include_assets=True,
    include_licenses=True,
    include_faults=True,
    include_inventory=True,
    include_spares=True,
    setting=None,
):
    """Return active alerts while keeping source records unchanged.

    The capability flags are resolved by the HTTP layer. They prevent a role
    that can see the dashboard but not a particular module from receiving
    identifiers from that module.
    """
    setting = setting or get_system_settings()
    now = _system_now(setting)
    today = now.date()
    alerts = []
    if include_assets and setting.notify_maintenance:
        alerts.extend(_maintenance_alerts(today, setting.maintenance_expiry_days, limit=ALERT_LIMIT))
    if include_licenses:
        alerts.extend(
            _license_alerts(
                today,
                setting.license_expiry_days,
                include_expiry=setting.notify_license_expiry,
                limit=ALERT_LIMIT,
            )
        )
    if include_faults and setting.notify_open_faults:
        alerts.extend(_fault_alerts(limit=ALERT_LIMIT))
    if include_inventory and setting.notify_overdue_inventory:
        alerts.extend(_inventory_alerts(now, limit=ALERT_LIMIT))
    if include_spares and setting.notify_low_spare_stock:
        alerts.extend(_spare_alerts(limit=ALERT_LIMIT))

    alerts.sort(key=_alert_sort_key)
    public_alerts = [
        {key: value for key, value in alert.items() if key != "sort_key"}
        for alert in alerts[:ALERT_LIMIT]
    ]
    counts = _alert_counts(
        today=today,
        now=now,
        setting=setting,
        include_assets=include_assets,
        include_licenses=include_licenses,
        include_faults=include_faults,
        include_inventory=include_inventory,
        include_spares=include_spares,
    )
    total = sum(counts.values())
    return {
        "generated_at": now.isoformat(),
        "summary": {
            "total": total,
            "critical": counts.get("critical", 0),
            "warning": counts.get("warning", 0),
            "notice": counts.get("notice", 0),
        },
        "alerts": public_alerts,
    }
