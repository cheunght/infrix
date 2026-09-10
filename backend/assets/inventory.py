"""Shared inventory scope queries.

The inventory task creation flow and the read-only scope preview must use the
same location rules.  Keeping the query here prevents the two endpoints from
drifting apart as the inventory workflow evolves.
"""

from django.db.models import Q, QuerySet

from .models import Asset, DataCenter, ServerRoom


def get_inventory_scope_assets(
    data_center: DataCenter | None = None,
    server_room: ServerRoom | None = None,
    *,
    scope: str | None = None,
) -> QuerySet:
    """Return assets included in an inventory task for the requested scope.

    ``all_assets`` includes every asset in the ledger.  A whole-data-center
    inventory contains active-rack assets in active rooms plus unracked assets
    assigned directly to the data center.  Selecting a specific room
    intentionally narrows the scope to assets mounted in active racks in that
    room; direct data-center assignments are not included.

    The query deliberately does not filter ``Asset.status`` or rack ``status``
    beyond the existing ``is_active`` rule.  This preserves the current task
    creation semantics, including retired assets and active reserved racks.
    """

    queryset = Asset.objects.select_related(
        "asset_data_center",
        "device_type",
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
