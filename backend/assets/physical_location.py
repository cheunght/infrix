"""Deep module for asset placement and physical-location corrections.

The physical location graph is locked in one deterministic order:
data center -> server room -> rack -> rack allocation -> asset.

``RackUnitAllocation`` is the source of truth for a mounted asset's rack and
U coordinates.  ``Asset.asset_data_center`` is a denormalized copy that is
kept in sync when a mounted rack or server room moves.  Unracking intentionally
retains that direct data-center copy; clearing the complete placement removes
it as well.
"""

from collections.abc import Mapping

from django.core.exceptions import ValidationError
from django.db import transaction

from .models import Asset, DataCenter, Rack, RackUnitAllocation, ServerRoom


def _ids(values):
    return {int(value) for value in values if value not in (None, "")}


def _optional_id(value):
    if value in (None, ""):
        return None
    try:
        value = int(value)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _rack_location_ids(rack_ids):
    rack_ids = tuple(_ids(rack_ids))
    rows = list(
        Rack.objects.filter(pk__in=rack_ids).values(
            "pk",
            "room_id",
            "room__data_center_id",
        )
    )
    return (
        {
            row["room__data_center_id"]
            for row in rows
            if row["room__data_center_id"] is not None
        },
        {row["room_id"] for row in rows if row["room_id"] is not None},
    )


def _lock_physical_location_graph(
    *,
    data_center_ids=(),
    room_ids=(),
    rack_ids=(),
    allocation_rack_ids=(),
    asset_ids=(),
):
    """Lock every affected row in the canonical physical-location order."""

    data_center_ids = _ids(data_center_ids)
    room_ids = _ids(room_ids)
    rack_ids = _ids(rack_ids)
    allocation_rack_ids = _ids(allocation_rack_ids) or set(rack_ids)
    asset_ids = _ids(asset_ids)

    list(
        DataCenter.objects.select_for_update()
        .filter(pk__in=sorted(data_center_ids))
        .order_by("pk")
    )
    list(
        ServerRoom.objects.select_for_update()
        .filter(pk__in=sorted(room_ids))
        .order_by("pk")
    )
    list(
        Rack.objects.select_for_update()
        .filter(pk__in=sorted(rack_ids))
        .order_by("pk")
    )
    allocations = list(
        RackUnitAllocation.objects.select_for_update()
        .filter(rack_id__in=sorted(allocation_rack_ids))
        .order_by("pk")
    )
    asset_ids.update(item.asset_id for item in allocations)
    list(
        Asset.objects.select_for_update()
        .filter(pk__in=sorted(asset_ids))
        .order_by("pk")
    )
    return allocations


def lock_asset_location(*, asset_id: int, target_rack_id: int | None = None) -> None:
    """Lock the current and requested rack ancestry before an asset write."""

    current_rack_id = (
        RackUnitAllocation.objects.filter(asset_id=asset_id)
        .values_list("rack_id", flat=True)
        .first()
    )
    target_rack_id = _optional_id(target_rack_id)
    affected_rack_ids = {
        value
        for value in (current_rack_id, target_rack_id)
        if value is not None
    }
    data_center_ids, room_ids = _rack_location_ids(affected_rack_ids)
    _lock_physical_location_graph(
        data_center_ids=data_center_ids,
        room_ids=room_ids,
        rack_ids=affected_rack_ids,
        allocation_rack_ids=affected_rack_ids,
        asset_ids=(asset_id,),
    )


def lock_rack_location(*, rack_id: int, target_room_id: int | None = None) -> Rack:
    """Lock a rack and its current/requested ancestry before an update."""

    current_rack = Rack.objects.select_related("room__data_center").get(pk=rack_id)
    target_room_id = _optional_id(target_room_id) or current_rack.room_id
    source_data_center_id = current_rack.room.data_center_id
    target_data_center_id = (
        ServerRoom.objects.filter(pk=target_room_id)
        .values_list("data_center_id", flat=True)
        .first()
    )
    _lock_physical_location_graph(
        data_center_ids=(source_data_center_id, target_data_center_id),
        room_ids=(current_rack.room_id, target_room_id),
        rack_ids=(rack_id,),
        allocation_rack_ids=(rack_id,),
    )
    return Rack.objects.select_for_update().select_related(
        "room__data_center"
    ).get(pk=rack_id)


def lock_server_room_location(
    *,
    room_id: int,
    target_data_center_id: int | None = None,
) -> ServerRoom:
    """Lock a server room and every mounted asset below it before an update."""

    current_room = ServerRoom.objects.select_related("data_center").get(pk=room_id)
    target_data_center_id = (
        _optional_id(target_data_center_id) or current_room.data_center_id
    )
    rack_ids = tuple(
        Rack.objects.filter(room_id=room_id).values_list("pk", flat=True)
    )
    _lock_physical_location_graph(
        data_center_ids=(current_room.data_center_id, target_data_center_id),
        room_ids=(room_id,),
        rack_ids=rack_ids,
        allocation_rack_ids=rack_ids,
    )
    return ServerRoom.objects.select_for_update().select_related(
        "data_center"
    ).get(pk=room_id)


@transaction.atomic
def place_asset(*, asset_id: int, rack_id: int, start_u: int, end_u: int) -> bool:
    """Place an asset in a rack using the canonical placement rules."""

    lock_asset_location(asset_id=asset_id, target_rack_id=rack_id)
    rack = Rack.objects.select_for_update().select_related("room__data_center").get(
        pk=rack_id
    )
    locked_asset = Asset.objects.select_for_update().get(pk=asset_id)

    if locked_asset.status == "retired":
        allocation = RackUnitAllocation.objects.filter(asset_id=locked_asset.pk).first()
        if allocation and (
            allocation.rack_id == rack.pk
            and allocation.start_u == start_u
            and allocation.end_u == end_u
        ):
            return False
        raise ValidationError({
            "configuration": "已报废资产不能新增或调整机柜位置，请先保持下架",
        })

    if (
        not rack.is_active
        or not rack.room.is_active
        or not rack.room.data_center.is_active
        or getattr(rack, "status", "in_use") != "in_use"
    ):
        raise ValidationError({"rack_id": "预留或停用的机柜不能用于资产"})
    if start_u < 1 or end_u < 1:
        raise ValidationError({"rack_start_u": "U 位必须大于等于 1"})
    if end_u < start_u:
        raise ValidationError({"rack_start_u": "起始 U 位不能大于结束 U 位"})
    if end_u > rack.total_u:
        raise ValidationError({"rack_end_u": f"结束 U 位不能超过机柜容量 U{rack.total_u}"})

    conflicts = (
        RackUnitAllocation.objects.select_for_update()
        .select_related("asset")
        .filter(
            rack_id=rack.pk,
            start_u__lte=end_u,
            end_u__gte=start_u,
        )
        .exclude(asset_id=locked_asset.pk)
    )
    conflict = conflicts.order_by("start_u", "id").first()
    if conflict:
        raise ValidationError({
            "configuration": (
                f"机柜 {rack.code} 的 U{start_u}-U{end_u} 与资产 "
                f"{conflict.asset.asset_no}（U{conflict.start_u}-U{conflict.end_u}）冲突"
            )
        })

    allocation = (
        RackUnitAllocation.objects.select_for_update()
        .filter(asset_id=locked_asset.pk)
        .first()
    )
    changed = not (
        allocation
        and allocation.rack_id == rack.pk
        and allocation.start_u == start_u
        and allocation.end_u == end_u
        and locked_asset.asset_data_center_id == rack.room.data_center_id
    )
    if allocation is None:
        allocation = RackUnitAllocation(asset=locked_asset)
    allocation.rack = rack
    allocation.start_u = start_u
    allocation.end_u = end_u
    if changed:
        allocation.full_clean()
        allocation.save()
    if locked_asset.asset_data_center_id != rack.room.data_center_id:
        locked_asset.asset_data_center_id = rack.room.data_center_id
        locked_asset.save(update_fields=["asset_data_center", "updated_at"])
        changed = True
    return changed


@transaction.atomic
def unrack_asset(*, asset_id: int) -> None:
    """Remove rack/U coordinates while retaining the direct data-center copy."""

    lock_asset_location(asset_id=asset_id)
    RackUnitAllocation.objects.filter(asset_id=asset_id).delete()


@transaction.atomic
def clear_asset_placement(*, asset_id: int) -> None:
    """Clear the complete physical location, including the data center."""

    lock_asset_location(asset_id=asset_id)
    RackUnitAllocation.objects.filter(asset_id=asset_id).delete()
    asset = Asset.objects.select_for_update().get(pk=asset_id)
    if asset.asset_data_center_id is not None:
        asset.asset_data_center_id = None
        asset.save(update_fields=["asset_data_center", "updated_at"])


def _synchronize_asset_location_hierarchy_locked(*, rack_ids, data_center_id) -> int:
    rack_ids = tuple(_ids(rack_ids))
    if not rack_ids:
        return 0

    assets = (
        Asset.objects.select_for_update()
        .filter(rack_allocation__rack_id__in=rack_ids)
        .order_by("pk")
    )
    changed = 0
    for asset in assets:
        if asset.asset_data_center_id == data_center_id:
            continue
        asset.asset_data_center_id = data_center_id
        asset.save(update_fields=["asset_data_center", "updated_at"])
        changed += 1
    return changed


def _update_parented_location(
    *,
    changes: Mapping[str, object],
    parent_field: str,
    lock_location,
    load_parent,
    validate_parent,
    current_parent_id,
    synchronize,
):
    changes = dict(changes)
    requested_parent = changes.get(parent_field)
    target_parent_id = (
        _optional_id(getattr(requested_parent, "pk", requested_parent))
        if requested_parent is not None
        else None
    )
    locked_location = lock_location(target_parent_id)

    target_parent = None
    if requested_parent is not None:
        target_parent = load_parent(target_parent_id)
        validate_parent(target_parent, locked_location)
        changes[parent_field] = target_parent

    moved = (
        target_parent is not None
        and target_parent.pk != current_parent_id(locked_location)
    )
    for field, value in changes.items():
        setattr(locked_location, field, value)
    locked_location.save()

    if moved:
        synchronize(locked_location, target_parent)
    return locked_location


def _validate_rack_target_room(target_room, locked_rack):
    if not target_room.is_active and target_room.pk != locked_rack.room_id:
        raise ValidationError({"room": "停用的机房不能新增或接收机柜"})
    if (
        not target_room.data_center.is_active
        and target_room.pk != locked_rack.room_id
    ):
        raise ValidationError({"room": "停用的数据中心不能新增或接收机柜"})


def _validate_server_room_target_data_center(target_data_center, locked_room):
    if (
        not target_data_center.is_active
        and target_data_center.pk != locked_room.data_center_id
    ):
        raise ValidationError({
            "data_center": "停用的数据中心不能新增或接收机房",
        })


@transaction.atomic
def update_rack(*, rack_id: int, changes: Mapping[str, object]) -> Rack:
    """Update a rack and synchronize assets when its room changes."""

    return _update_parented_location(
        changes=changes,
        parent_field="room",
        lock_location=lambda target_id: lock_rack_location(
            rack_id=rack_id,
            target_room_id=target_id,
        ),
        load_parent=lambda target_id: ServerRoom.objects.select_for_update()
        .select_related("data_center")
        .get(pk=target_id),
        validate_parent=_validate_rack_target_room,
        current_parent_id=lambda locked_rack: locked_rack.room_id,
        synchronize=lambda locked_rack, target_room: _synchronize_asset_location_hierarchy_locked(
            rack_ids=(locked_rack.pk,),
            data_center_id=target_room.data_center_id,
        ),
    )


@transaction.atomic
def update_server_room(
    *,
    room_id: int,
    changes: Mapping[str, object],
) -> ServerRoom:
    """Update a server room and synchronize every mounted asset below it."""

    return _update_parented_location(
        changes=changes,
        parent_field="data_center",
        lock_location=lambda target_id: lock_server_room_location(
            room_id=room_id,
            target_data_center_id=target_id,
        ),
        load_parent=lambda target_id: DataCenter.objects.select_for_update().get(
            pk=target_id
        ),
        validate_parent=_validate_server_room_target_data_center,
        current_parent_id=lambda locked_room: locked_room.data_center_id,
        synchronize=lambda locked_room, target_data_center: _synchronize_asset_location_hierarchy_locked(
            rack_ids=Rack.objects.filter(room_id=locked_room.pk).values_list(
                "pk",
                flat=True,
            ),
            data_center_id=target_data_center.pk,
        ),
    )
