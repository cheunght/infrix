"""Shared rack, room and data-center capacity aggregations."""

from ..enum_contracts import RACK_STATUS_LABELS
from ..models import Rack


def rack_effective_used_u(allocations, total_u=None):
    """Return allocated U plus one-U gaps between adjacent devices.

    General cooling space is not reserved. A one-U gap between two adjacent
    devices is the only implicit unavailable space, matching the existing
    capacity rule used by the U-position canvas.
    """
    ordered = sorted(
        allocations,
        key=lambda allocation: (allocation.start_u, allocation.end_u),
    )
    used_u = sum(allocation.units for allocation in ordered)
    for previous, current in zip(ordered, ordered[1:]):
        if current.start_u - previous.end_u - 1 == 1:
            used_u += 1
    return min(used_u, total_u) if total_u is not None else used_u


def build_rack_capacity_rows(racks, include_status=False):
    """Build reusable rack capacity rows and aggregate totals."""
    rows = []
    totals = {"total_u": 0, "used_u": 0, "device_count": 0}
    for rack in racks:
        allocations = list(rack.allocations.all())
        total_u = rack.total_u or 0
        used_u = rack_effective_used_u(allocations, rack.total_u)
        free_u = max(total_u - used_u, 0)
        row = {
            "id": rack.id,
            "code": rack.code,
            "data_center": rack.room.data_center.name,
            "data_center_id": rack.room.data_center_id,
            "server_room": rack.room.name,
            "server_room_id": rack.room_id,
            "total_u": total_u,
            "used_u": used_u,
            "free_u": free_u,
            "utilization": round(used_u / total_u * 100, 1) if total_u else 0,
            "device_count": len(allocations),
        }
        if include_status:
            row.update(
                {
                    "name": rack.name,
                    "status": rack.status,
                    "status_label": RACK_STATUS_LABELS.get(rack.status, rack.status),
                }
            )
        rows.append(row)
        totals["total_u"] += total_u
        totals["used_u"] += used_u
        totals["device_count"] += len(allocations)
    return rows, totals


def build_dashboard_capacity(scope):
    """Aggregate dashboard capacity data from one resolved location scope."""
    rack_rows, totals = build_rack_capacity_rows(scope.racks)

    room_capacity_map = {
        room.id: {
            "room_id": room.id,
            "data_center": room.data_center.name,
            "room": room.name,
            "used_u": 0,
            "total_u": 0,
        }
        for room in scope.rooms
    }
    data_center_capacity_map = {
        data_center.id: {
            "data_center_id": data_center.id,
            "data_center": data_center.name,
            "used_u": 0,
            "total_u": 0,
        }
        for data_center in scope.active_data_centers
    }

    for rack in rack_rows:
        room_capacity = room_capacity_map.setdefault(
            rack["server_room_id"],
            {
                "room_id": rack["server_room_id"],
                "data_center": rack["data_center"],
                "room": rack["server_room"],
                "used_u": 0,
                "total_u": 0,
            },
        )
        room_capacity["used_u"] += rack["used_u"]
        room_capacity["total_u"] += rack["total_u"]

        data_center_capacity = data_center_capacity_map.setdefault(
            rack["data_center_id"],
            {
                "data_center_id": rack["data_center_id"],
                "data_center": rack["data_center"],
                "used_u": 0,
                "total_u": 0,
            },
        )
        data_center_capacity["used_u"] += rack["used_u"]
        data_center_capacity["total_u"] += rack["total_u"]

    room_capacity = _finalize_capacity_rows(
        room_capacity_map.values(),
        sort_key=lambda item: (-item["utilization"], item["data_center"], item["room"]),
    )
    data_center_capacity = _finalize_capacity_rows(
        data_center_capacity_map.values(),
        sort_key=lambda item: (-item["utilization"], item["data_center"]),
    )

    data_center_overview_map = {
        data_center.id: {
            "data_center_id": data_center.id,
            "data_center": data_center.name,
            "room_count": 0,
            "asset_count": 0,
            "rack_count": 0,
            "total_u": 0,
            "used_u": 0,
            "free_u": 0,
            "utilization": 0,
        }
        for data_center in scope.active_data_centers
    }
    for room in scope.rooms:
        overview = data_center_overview_map.get(room.data_center_id)
        if overview is not None:
            overview["room_count"] += 1
    for asset in scope.asset_rows:
        allocation = getattr(asset, "rack_allocation", None)
        if allocation and not (
            allocation.rack.is_active
            and allocation.rack.room.is_active
            and allocation.rack.room.data_center.is_active
        ):
            continue
        data_center_id = (
            allocation.rack.room.data_center_id
            if allocation
            else asset.asset_data_center_id
        )
        if data_center_id in data_center_overview_map:
            data_center_overview_map[data_center_id]["asset_count"] += 1

    for rack in rack_rows:
        overview = data_center_overview_map.get(rack["data_center_id"])
        if overview is None:
            continue
        overview["rack_count"] += 1
        overview["total_u"] += rack["total_u"]
        overview["used_u"] += rack["used_u"]

    data_center_overview = []
    for overview in data_center_overview_map.values():
        overview["free_u"] = max(overview["total_u"] - overview["used_u"], 0)
        overview["utilization"] = (
            round(overview["used_u"] / overview["total_u"] * 100, 1)
            if overview["total_u"]
            else 0
        )
        data_center_overview.append(overview)

    rack_capacity = sorted(
        rack_rows,
        key=lambda item: (-item["utilization"], item["free_u"], item["code"]),
    )
    return {
        "used_u": totals["used_u"],
        "device_count": totals["device_count"],
        "room_capacity": room_capacity,
        "data_center_capacity": data_center_capacity,
        "data_center_overview": data_center_overview,
        "rack_capacity": rack_capacity,
    }


def _finalize_capacity_rows(rows, sort_key):
    finalized = []
    for row in rows:
        total_u = row["total_u"]
        row["utilization"] = (
            round(row["used_u"] / total_u * 100, 1) if total_u else 0
        )
        finalized.append(row)
    finalized.sort(key=sort_key)
    return finalized
