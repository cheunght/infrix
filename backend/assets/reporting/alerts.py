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


ALERT_EXPIRY_DAYS = 30
ALERT_LIMIT = 100
_LEVEL_ORDER = {"critical": 0, "warning": 1, "notice": 2}


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


def _maintenance_alerts(today):
    expiry_limit = today + timedelta(days=ALERT_EXPIRY_DAYS)
    alerts = []
    contracts = (
        MaintenanceContract.objects.select_related("asset")
        .filter(expiry_date__isnull=False, expiry_date__lte=expiry_limit)
        .order_by("expiry_date", "asset__asset_no", "id")
    )
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


def _license_alerts(today):
    expiry_limit = today + timedelta(days=ALERT_EXPIRY_DAYS)
    alerts = []
    licenses = SoftwareLicense.objects.filter(
        Q(expiry_date__isnull=False, expiry_date__lte=expiry_limit)
        | Q(used_count__gt=F("authorized_count"))
    ).order_by("expiry_date", "name", "id")
    for license_row in licenses:
        if license_row.used_count > license_row.authorized_count:
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
        if license_row.expiry_date and license_row.expiry_date <= expiry_limit:
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


def _fault_alerts():
    alerts = []
    faults = (
        FaultEvent.objects.select_related("asset")
        .filter(is_closed=False)
        .order_by("occurred_at", "id")
    )
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


def _inventory_alerts(now):
    alerts = []
    tasks = (
        InventoryTask.objects.filter(status="in_progress", end_at__lt=now)
        .annotate(pending_count=Count("items", filter=Q(items__status="pending")))
        .order_by("end_at", "id")
    )
    for task in tasks:
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
                "days_overdue": max((now.date() - task.end_at.date()).days, 0),
                "pending_count": task.pending_count,
                "sort_key": task.end_at.isoformat(),
            }
        )
    return alerts


def _spare_alerts():
    alerts = []
    parts = (
        SparePart.objects.filter(safety_stock__gt=0)
        .annotate(total_quantity=Coalesce(Sum("stocks__quantity"), 0))
        .filter(total_quantity__lt=F("safety_stock"))
        .order_by("name", "id")
    )
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


def build_alerts_payload(
    *,
    include_assets=True,
    include_licenses=True,
    include_faults=True,
    include_inventory=True,
    include_spares=True,
):
    """Return active alerts while keeping source records unchanged.

    The capability flags are resolved by the HTTP layer. They prevent a role
    that can see the dashboard but not a particular module from receiving
    identifiers from that module.
    """
    today = timezone.localdate()
    now = timezone.now()
    alerts = []
    if include_assets:
        alerts.extend(_maintenance_alerts(today))
    if include_licenses:
        alerts.extend(_license_alerts(today))
    if include_faults:
        alerts.extend(_fault_alerts())
    if include_inventory:
        alerts.extend(_inventory_alerts(now))
    if include_spares:
        alerts.extend(_spare_alerts())

    alerts.sort(key=_alert_sort_key)
    public_alerts = [
        {key: value for key, value in alert.items() if key != "sort_key"}
        for alert in alerts[:ALERT_LIMIT]
    ]
    counts = Counter(alert["level"] for alert in alerts)
    return {
        "generated_at": now.isoformat(),
        "summary": {
            "total": len(alerts),
            "critical": counts.get("critical", 0),
            "warning": counts.get("warning", 0),
            "notice": counts.get("notice", 0),
        },
        "alerts": public_alerts,
    }
