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

from .models import Asset, DataCenter, InventoryTask, Rack, RackUnitAllocation, ServerRoom
from .data_scope import require_center, require_object, require_queryset, location_assets, serialization_scope, require_asset_destination, require_assets_destination, KEEP_DEPARTMENT, scoped


class RoomReparentBlocked(ValueError):
    """A room's current operational associations prevent changing its parent."""


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


def lock_asset_location(*, asset_id: int, target_rack_id: int | None = None, target_data_center_id: int | None = None, target_department_id=KEEP_DEPARTMENT) -> None:
    """Lock the current and requested rack ancestry before an asset write."""

    current_rack_id = (
        RackUnitAllocation.objects.filter(asset_id=asset_id)
        .values_list("rack_id", flat=True)
        .first()
    )
    target_rack_id = _optional_id(target_rack_id)
    if target_rack_id and serialization_scope() is not None and not scoped(Rack.objects.filter(pk=target_rack_id), write=True).exists():
        raise ValidationError({"rack_id": "请选择授权范围内的机柜"})
    affected_rack_ids = {
        value
        for value in (current_rack_id, target_rack_id)
        if value is not None
    }
    data_center_ids, room_ids = _rack_location_ids(affected_rack_ids)
    data_center_ids.update(_ids((target_data_center_id, Asset.all_objects.filter(pk=asset_id).values_list("asset_data_center_id", flat=True).first())))
    _lock_physical_location_graph(
        data_center_ids=data_center_ids,
        room_ids=room_ids,
        rack_ids=affected_rack_ids,
        allocation_rack_ids=affected_rack_ids,
        asset_ids=(asset_id,),
    )
    require_object(Asset.all_objects.get(pk=asset_id))
    if target_rack_id:
        center_id = Rack.objects.filter(pk=target_rack_id).values_list("room__data_center_id", flat=True).first()
        if center_id is None:
            raise ValidationError({"rack_id": "所选机柜已不存在，请重新选择"})
        require_asset_destination(asset_id, center_id, department_id=target_department_id)
    if target_data_center_id is not None:
        require_asset_destination(asset_id, int(target_data_center_id), department_id=target_department_id)


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
    require_object(Rack.objects.get(pk=rack_id))
    require_queryset(location_assets(Rack.objects.get(pk=rack_id)))
    require_center(ServerRoom.objects.values_list("data_center_id", flat=True).get(pk=target_room_id))
    require_assets_destination(location_assets(current_rack), ServerRoom.objects.values_list("data_center_id", flat=True).get(pk=target_room_id))
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
    require_object(ServerRoom.objects.get(pk=room_id))
    require_queryset(location_assets(ServerRoom.objects.get(pk=room_id)))
    require_center(target_data_center_id)
    require_assets_destination(location_assets(current_room), target_data_center_id)
    return ServerRoom.objects.select_for_update().select_related(
        "data_center"
    ).get(pk=room_id)



def rack_position_ranges(allocations, total_u, *, exclude_asset_id=None):
    """One capacity rule for presentation, preview and locked placement writes."""
    rows = sorted((row for row in allocations if row.asset_id != exclude_asset_id), key=lambda row: (row.start_u, row.end_u))
    occupied = [{"start_u": row.start_u, "end_u": row.end_u} for row in rows]
    gaps = [{"start_u": left.end_u + 1, "end_u": left.end_u + 1}
            for left, right in zip(rows, rows[1:]) if right.start_u - left.end_u == 2]
    available, cursor = [], 1
    for span in sorted(occupied + gaps, key=lambda span: span["start_u"]):
        if cursor < span["start_u"]:
            available.append({"start_u": cursor, "end_u": min(total_u, span["start_u"] - 1)})
        cursor = max(cursor, span["end_u"] + 1)
    if cursor <= total_u:
        available.append({"start_u": cursor, "end_u": total_u})
    return {"occupied_ranges": occupied, "gap_ranges": gaps, "available_ranges": available}


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
        from .data_scope import scoped
        scope = serialization_scope()
        visible = scope is None or scoped(Asset.all_objects.filter(pk=conflict.asset_id)).exists()
        message = (
            f"机柜 {rack.code} 的 U{start_u}-U{end_u} 与资产 "
            f"{conflict.asset.asset_no}（U{conflict.start_u}-U{conflict.end_u}）冲突"
        ) if visible else "所选 U 位无法使用，请联系设施管理员"
        raise ValidationError({"configuration": message})

    current = RackUnitAllocation.objects.filter(asset_id=locked_asset.pk).first()
    if (current and current.rack_id == rack.pk and current.start_u == start_u and current.end_u == end_u
            and locked_asset.asset_data_center_id == rack.room.data_center_id):
        return False

    ranges = rack_position_ranges(rack.allocations.all(), rack.total_u, exclude_asset_id=locked_asset.pk)
    if any(start_u <= gap["end_u"] and end_u >= gap["start_u"] for gap in ranges["gap_ranges"]):
        scope = serialization_scope()
        visible = scope is None or scope.full_department_access(center_id=rack.room.data_center_id)
        raise ValidationError({"rack_start_u": "所选 U 位包含不可用的设备间 1U 间隙" if visible else "所选 U 位无法使用，请联系设施管理员"})

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
def set_direct_asset_placement(*, asset_id: int, data_center_id: int | None) -> bool:
    """Remove rack occupancy and set a direct center or an unlocated state."""
    require_center(data_center_id)
    lock_asset_location(asset_id=asset_id, target_data_center_id=data_center_id)
    from .asset_retention import active_asset_for_update
    asset = active_asset_for_update(asset_id)
    require_asset_destination(asset_id, data_center_id)
    center = DataCenter.objects.select_for_update().get(pk=data_center_id) if data_center_id else None
    if center and not center.is_active:
        raise ValidationError({"actual_data_center_id": "停用的数据中心不能用于位置纠正"})
    changed = RackUnitAllocation.objects.filter(asset=asset).exists() or asset.asset_data_center_id != data_center_id
    RackUnitAllocation.objects.filter(asset=asset).delete()
    if asset.asset_data_center_id != data_center_id:
        asset.asset_data_center_id = data_center_id
        asset.save(update_fields=["asset_data_center", "updated_at"])
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
    require_center(None)
    RackUnitAllocation.objects.filter(asset_id=asset_id).delete()
    asset = Asset.objects.select_for_update().get(pk=asset_id)
    require_asset_destination(asset_id, None)
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
    require_queryset(assets)
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
    if target_data_center.pk != locked_room.data_center_id:
        if locked_room.spare_stocks.exists():
            raise RoomReparentBlocked("机房存在备件库存记录（包括零余额），不能直接更换数据中心")
        if InventoryTask.objects.filter(server_room=locked_room, status="in_progress").exists():
            raise RoomReparentBlocked("机房存在进行中的盘点任务，不能直接更换数据中心")
    if (
        not target_data_center.is_active
        and target_data_center.pk != locked_room.data_center_id
    ):
        raise ValidationError({
            "data_center": "停用的数据中心不能新增或接收机房",
        })


def lock_inventory_scope(data_center_id, room_id):
    """Serialize scoped task creation/reopening with room reparenting."""
    center = DataCenter.objects.select_for_update().get(pk=data_center_id) if data_center_id else None
    room = ServerRoom.objects.select_for_update().get(pk=room_id) if room_id else None
    if room and (not center or room.data_center_id != center.pk):
        raise ValidationError({"server_room": "机房已更换数据中心，请刷新盘点范围"})
    return center, room


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
