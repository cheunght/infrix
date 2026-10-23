"""Shared inventory scope queries.

The inventory task creation flow and the read-only scope preview must use the
same location rules.  Keeping the query here prevents the two endpoints from
drifting apart as the inventory workflow evolves.
"""

from django.db.models import Count, Q, QuerySet
from rest_framework import serializers

from .models import Asset, DataCenter, ServerRoom


class InventoryLocationQuerySerializer(serializers.Serializer):
    data_center = serializers.IntegerField(min_value=1, required=False)
    server_room = serializers.IntegerField(min_value=1, required=False)
    rack = serializers.IntegerField(min_value=1, required=False)
    placement = serializers.ChoiceField(choices=("mounted", "unmounted", "unlocated"), required=False)


def filter_inventory_locations(queryset, params):
    query = InventoryLocationQuerySerializer(data=params)
    query.is_valid(raise_exception=True)
    for field in ("data_center", "server_room", "rack"):
        if field in query.validated_data:
            queryset = queryset.filter(**{f"system_snapshot__{field}_id": query.validated_data[field]})
    # JSON null and absent keys both mean that the snapshot has no such location.
    no_rack = Q(system_snapshot__rack_id=None) | Q(system_snapshot__rack_id__isnull=True)
    no_center = Q(system_snapshot__data_center_id=None) | Q(system_snapshot__data_center_id__isnull=True)
    placement = query.validated_data.get("placement")
    if placement == "mounted":
        queryset = queryset.exclude(no_rack)
    elif placement == "unmounted":
        queryset = queryset.filter(no_rack).exclude(no_center)
    elif placement == "unlocated":
        queryset = queryset.filter(no_rack, no_center)
    return queryset


def inventory_location_summary(queryset):
    fields = ("data_center_id", "data_center", "server_room_id", "server_room", "rack_id", "rack_code")
    rows = queryset.order_by().values(*(f"system_snapshot__{field}" for field in fields)).annotate(
        total=Count("pk"), pending=Count("pk", filter=Q(status="pending")),
        resolution_pending=Count("pk", filter=Q(resolution_status="pending")),
    )
    locations = []
    for row in rows:
        location = {field: row[f"system_snapshot__{field}"] for field in fields}
        location.update(total=row["total"], checked=row["total"] - row["pending"],
                        pending=row["pending"], resolution_pending=row["resolution_pending"])
        locations.append(location)
    locations.sort(key=lambda row: tuple(str(row[field] or "") for field in fields))
    return {"total": sum(row["total"] for row in locations), "locations": locations}


def get_inventory_scope_assets(
    data_center: DataCenter | None = None,
    server_room: ServerRoom | None = None,
    *,
    scope: str | None = None,
) -> QuerySet:
    """Return assets included in an inventory task for the requested scope.

    ``all_assets`` includes every unarchived asset in the ledger.  A whole-data-center
    inventory contains active-rack assets in active rooms plus unracked assets
    assigned directly to the data center.  Selecting a specific room
    intentionally narrows the scope to assets mounted in active racks in that
    room; direct data-center assignments are not included.

    The query deliberately does not filter ``Asset.status`` or rack ``status``
    beyond the existing ``is_active`` rule.  This preserves the current task
    creation semantics, including retired assets and active reserved racks.
    """

    queryset = Asset.objects.select_related(
        "asset_data_center", "owning_department",
        "asset_model__device_type",
        "standalone_device_type",
        "rack_allocation__rack__room__data_center",
    ).prefetch_related("network_addresses")

    if scope == "all_assets":
        return queryset.order_by("asset_no")

    if server_room is not None:
        return queryset.filter(
            rack_allocation__rack__room_id=server_room.id,
            rack_allocation__rack__is_active=True,
            rack_allocation__rack__room__is_active=True,
        ).order_by("asset_no")

    if data_center is None:
        raise ValueError("data_center is required for a location inventory scope")

    return queryset.filter(
        Q(
            rack_allocation__rack__room__data_center_id=data_center.id,
            rack_allocation__rack__is_active=True,
            rack_allocation__rack__room__is_active=True,
        )
        | Q(rack_allocation__isnull=True, asset_data_center_id=data_center.id)
    ).distinct().order_by("asset_no")
