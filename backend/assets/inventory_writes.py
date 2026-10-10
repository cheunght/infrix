"""Counting writes: task lists, observations, corrections and audit transactions.

HTTP callers retain their admitted maintenance/account locks. Location parents
precede assets, then task and item rows; every complete task is authorized again.
"""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError as DRFValidationError
from .models import Asset, DataCenter, Rack, InventoryTask, InventoryItem
from .asset_retention import active_asset_for_update
from .physical_location import lock_asset_location, lock_inventory_scope, place_asset, set_direct_asset_placement
from .data_scope import require_object, require_queryset, require_asset_destination, scope_for, scoped
from .organization_access import can
from .enum_contracts import INVENTORY_EXCEPTION_STATUS_VALUES, INVENTORY_RESOLUTION_ACTION_VALUES
from .audit import model_snapshot, write_audit_log
from .inventory import get_inventory_scope_assets
from .resource_revision import check_resource_revision
from . import operation_limits


def _require_inventory_manager(actor):
    if not can(actor, "inventory.manage"):
        raise PermissionDenied("盘点写入需要 inventory.manage 权限")


INVENTORY_EXCEPTION_STATUSES = frozenset(INVENTORY_EXCEPTION_STATUS_VALUES)


class InventoryObservationConflict(APIException):
    status_code = 409


def reset_inventory_resolution(item):
    """Reset the resolution lifecycle after a盘点结果 changes."""
    if item.status in {"pending", "normal"}:
        item.resolution_status = "not_required"
    else:
        item.resolution_status = "pending"
    item.resolution_action = None
    item.resolution_note = ""
    item.resolved_by = None
    item.resolved_at = None


def inventory_snapshot_location(item):
    """Resolve a task snapshot into the exact location used by a normal result."""
    snapshot = item.system_snapshot or {}
    rack_id = snapshot.get("rack_id")
    if rack_id in (None, ""):
        center_id = snapshot.get("data_center_id")
        if center_id and not DataCenter.objects.filter(pk=center_id, is_active=True).exists():
            raise DRFValidationError({"status": "系统快照对应的数据中心已不存在或停用，无法标记为正常"})
        return None, None, None

    try:
        rack = Rack.objects.select_related("room__data_center").get(pk=rack_id)
    except (Rack.DoesNotExist, TypeError, ValueError) as exc:
        raise DRFValidationError({"status": "任务创建时的系统机柜已不存在，无法标记为正常"}) from exc

    if (
        not snapshot.get("rack_code")
        or snapshot.get("server_room_id") is None
        or snapshot.get("data_center_id") is None
        or rack.code != snapshot.get("rack_code")
        or rack.room_id != snapshot.get("server_room_id")
        or rack.room.data_center_id != snapshot.get("data_center_id")
    ):
        raise DRFValidationError({"status": "任务创建时的系统位置已发生变化，无法标记为正常"})

    try:
        start_u = int(snapshot.get("start_u"))
        end_u = int(snapshot.get("end_u"))
    except (TypeError, ValueError) as exc:
        raise DRFValidationError({"status": "任务创建时的系统 U 位快照不完整，无法标记为正常"}) from exc

    if start_u < 1 or end_u < start_u or end_u > rack.total_u:
        raise DRFValidationError({"status": "任务创建时的系统 U 位快照无效，无法标记为正常"})
    if not rack.is_active or not rack.room.is_active or not rack.room.data_center.is_active:
        raise DRFValidationError({"status": "系统快照对应的机柜、机房或数据中心已停用，无法标记为正常"})
    return rack, start_u, end_u


@transaction.atomic
def confirm_inventory_item_normal(
    *,
    item_id,
    actor,
    request,
    require_pending=False,
    source="inventory_confirm_normal",
    notes=None,
):
    """Record a normal result from the immutable task snapshot."""
    _require_inventory_manager(actor)
    from .audit import write_audit_log
    from .serializers import InventoryItemSerializer

    admission = InventoryItem.objects.filter(pk=item_id).values("task_id", "asset_id", "system_snapshot").first()
    if admission is None:
        raise InventoryItem.DoesNotExist
    snapshot = admission["system_snapshot"] or {}
    lock_asset_location(asset_id=admission["asset_id"], target_rack_id=snapshot.get("rack_id"), target_data_center_id=snapshot.get("data_center_id"))
    active_asset_for_update(admission["asset_id"])
    task = InventoryTask.objects.select_for_update().get(pk=admission["task_id"])
    require_object(task, user=actor)
    item = InventoryItem.objects.select_for_update().get(pk=item_id)
    if task.status != "in_progress":
        raise DRFValidationError({"detail": "已完成的盘点任务不能批量标记为正常"})
    if require_pending and item.status != "pending":
        raise DRFValidationError({"detail": "该盘点项已被盘点，不能批量标记为正常"})

    rack, start_u, end_u = inventory_snapshot_location(item)
    from .data_scope import require_asset_destination
    # An explicit unlocated observation has no parent row to lock. Validate
    # its complete ownership/location pair here for all confirmation callers.
    require_asset_destination(item.asset_id, (item.system_snapshot or {}).get("data_center_id"), user=actor)
    before = InventoryItemSerializer(item).data
    item.status = "normal"
    item.actual_rack = rack
    item.actual_start_u = start_u
    item.actual_end_u = end_u
    center_id = (item.system_snapshot or {}).get("data_center_id")
    item.actual_data_center_ref_id = center_id if DataCenter.objects.filter(pk=center_id).exists() else None
    item.actual_placement = "mounted" if rack else ("data_center" if center_id else "unlocated")
    item.checked_by = actor
    item.checked_at = timezone.now()
    if notes is not None:
        item.notes = notes
    reset_inventory_resolution(item)
    item.save(update_fields=[
        "status",
        "actual_rack",
        "actual_start_u",
        "actual_end_u",
        "actual_data_center_ref",
        "actual_placement",
        "checked_by",
        "checked_at",
        "notes",
        "resolution_status",
        "resolution_action",
        "resolution_note",
        "resolved_by",
        "resolved_at",
        "updated_at",
    ])
    write_audit_log(
        request, actor=actor,
        action="update",
        resource_type="inventory_item",
        resource_id=item.pk,
        before=before,
        after=InventoryItemSerializer(item).data,
        extra={
            "source": source,
            "inventory_task_id": task.pk,
            "inventory_item_id": item.pk,
            "asset_id": item.asset_id,
            "status": "normal",
            "checked_by": actor.pk,
            "checked_at": item.checked_at,
        },
    )
    return item


def _inventory_task_items(task, items=None):
    if items is not None:
        return items
    prefetched = getattr(task, "_prefetched_objects_cache", {}).get("items")
    if prefetched is not None:
        return prefetched
    return task.items.only(
        "status",
        "resolution_status",
        "resolution_action",
        "resolution_note",
        "resolved_by",
        "resolved_at",
    ).all()


def inventory_task_delete_block_reason(task, items=None):
    """Return the business reason that prevents deleting an inventory task."""
    if task.status == "completed":
        return "已完成的盘点任务不能删除。"
    if task.status != "in_progress":
        return "当前状态的盘点任务不能删除。"

    task_items = _inventory_task_items(task, items)
    for item in task_items:
        if (
            item.resolution_status == "resolved"
            or item.resolved_by_id
            or item.resolved_at
            or item.resolution_action
            or str(item.resolution_note or "").strip()
        ):
            return "已有异常处理记录的任务不能删除，请保留盘点记录。"
    if any(item.status != "pending" for item in task_items):
        return "已经开始盘点的任务不能删除，请保留盘点记录。"
    return None


def inventory_task_can_delete(task, items=None):
    """Return whether a task is still an untouched, deletable draft."""
    return inventory_task_delete_block_reason(task, items) is None


def validate_inventory_resolution_request(action, note="", *, bulk=False):
    """Validate request-level resolution rules shared by single and bulk APIs."""
    if action not in INVENTORY_RESOLUTION_ACTION_VALUES:
        raise DRFValidationError({"action": "无效的盘点异常处理方式"})
    if bulk and action == "update_asset":
        raise DRFValidationError({"action": "批量处理不支持更新资产台账，请逐条处理位置异常。"})
    if action == "ignore" and not str(note or "").strip():
        raise DRFValidationError({"note": "忽略异常时必须填写处理备注"})


@transaction.atomic
def resolve_inventory_item(*, item_id, action, note, actor, request):
    """Resolve one inventory exception with the canonical row-level rules."""
    _require_inventory_manager(actor)
    validate_inventory_resolution_request(action, note)
    if action == "update_asset" and not can(actor, "assets.manage"):
        raise PermissionDenied("更新资产台账需要 assets.manage 权限")

    from .audit import asset_audit_snapshot, write_audit_log
    from .serializers import InventoryItemSerializer

    observation_fields = ("actual_placement", "actual_rack_id", "actual_data_center_ref_id", "actual_start_u", "actual_end_u")
    admission = InventoryItem.objects.filter(pk=item_id).values("task_id", "asset_id", *observation_fields).first()
    if admission is None:
        raise InventoryItem.DoesNotExist
    lock_asset_location(asset_id=admission["asset_id"], target_rack_id=admission["actual_rack_id"] if action == "update_asset" else None,
                        target_data_center_id=admission["actual_data_center_ref_id"] if action == "update_asset" else None)
    asset = active_asset_for_update(admission["asset_id"])
    task = InventoryTask.objects.select_for_update().get(pk=admission["task_id"])
    require_object(task, user=actor)
    item = InventoryItem.objects.select_for_update().get(pk=item_id)
    if any(admission[field] != getattr(item, field) for field in observation_fields):
        raise InventoryObservationConflict({"code": "inventory_observation_changed", "detail": "现场位置已被修改，请重新读取盘点结果后处理"})
    if item.status not in INVENTORY_EXCEPTION_STATUSES:
        raise DRFValidationError({"detail": "只有异常盘点项可以处理"})
    if item.resolution_status != "pending":
        raise DRFValidationError({
            "detail": "该异常已被处理",
            "code": "inventory_item_already_resolved",
        })
    if action == "confirm_missing" and item.status != "not_found":
        raise DRFValidationError({"action": "确认设备缺失只适用于未找到的资产"})
    if action == "update_asset" and item.status != "location_mismatch":
        raise DRFValidationError({"action": "更新资产台账目前只适用于位置不符"})

    if action == "update_asset":
        placement = item.actual_placement or ("mounted" if item.actual_rack_id else "")
        if placement not in {"mounted", "data_center", "unlocated"}:
            raise DRFValidationError({"action": "请先明确实际位置类型，再更新资产台账"})
        if placement == "mounted" and (item.actual_rack_id is None or item.actual_start_u is None or item.actual_end_u is None):
            raise DRFValidationError({"action": "已上架位置必须包含完整的实际机柜和起止 U 位"})
        if placement == "data_center" and item.actual_data_center_ref_id is None:
            raise DRFValidationError({"action": "实际数据中心缺失，请重新记录现场位置"})
        if placement == "mounted":
            rack = Rack.objects.select_related("room").get(pk=item.actual_rack_id)
            snapshot = item.actual_location_snapshot or {}
            if (rack.room_id != snapshot.get("server_room_id")
                    or rack.room.data_center_id != snapshot.get("data_center_id")):
                raise InventoryObservationConflict({"code": "inventory_observation_stale",
                    "detail": "实际机柜的机房或数据中心归属已改变，请重新记录现场位置后再纠正台账"})

    before_item = InventoryItemSerializer(item).data
    asset_changed = False
    if action == "update_asset":
        before_asset = asset_audit_snapshot(asset.pk)
        try:
            if placement == "mounted":
                asset_changed = place_asset(asset_id=asset.pk, rack_id=item.actual_rack_id,
                                            start_u=item.actual_start_u, end_u=item.actual_end_u)
            else:
                asset_changed = set_direct_asset_placement(asset_id=asset.pk,
                    data_center_id=item.actual_data_center_ref_id if placement == "data_center" else None)
        except ValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}
            raise DRFValidationError(detail) from exc
        if asset_changed:
            after_asset = asset_audit_snapshot(asset.pk)
            write_audit_log(
                request, actor=actor,
                action="update",
                resource_type="asset",
                resource_id=asset.pk,
                before=before_asset,
                after=after_asset,
                extra={
                    "source": "inventory_resolution",
                    "inventory_task_id": task.pk,
                    "inventory_item_id": item.pk,
                    "resolution_action": action,
                },
            )

    from django.utils import timezone

    now = timezone.now()
    item.resolution_status = "resolved"
    item.resolution_action = action
    item.resolution_note = note
    item.resolved_by = actor
    item.resolved_at = now
    item.save(update_fields=[
        "resolution_status",
        "resolution_action",
        "resolution_note",
        "resolved_by",
        "resolved_at",
        "updated_at",
    ])
    write_audit_log(
        request, actor=actor,
        action="resolve",
        resource_type="inventory_item",
        resource_id=item.pk,
        before=before_item,
        after=InventoryItemSerializer(item).data,
        extra={
            "inventory_task_id": task.pk,
            "inventory_item_id": item.pk,
            "asset_id": asset.pk,
            "exception_status": item.status,
            "resolution_action": action,
            "resolution_note": note,
            "resolved_by": actor.pk,
            "resolved_at": now,
            "asset_changed": asset_changed,
        },
    )
    return item


def _inventory_snapshot(asset):
    allocation = getattr(asset, "rack_allocation", None)
    network = {
        item.role: item.address
        for item in getattr(asset, "network_addresses", []).all()
    }
    if allocation:
        location = {
            "data_center_id": allocation.rack.room.data_center_id,
            "data_center": allocation.rack.room.data_center.name,
            "server_room_id": allocation.rack.room_id,
            "server_room": allocation.rack.room.name,
            "rack_id": allocation.rack_id,
            "rack_code": allocation.rack.code,
            "start_u": allocation.start_u,
            "end_u": allocation.end_u,
        }
    else:
        location = {
            "data_center_id": asset.asset_data_center_id,
            "data_center": asset.asset_data_center.name if asset.asset_data_center_id else "",
            "server_room_id": None,
            "server_room": "",
            "rack_id": None,
            "rack_code": "",
            "start_u": None,
            "end_u": None,
        }
    return {
        "asset_no": asset.asset_no,
        "owning_department_id": asset.owning_department_id,
        "owning_department": asset.owning_department.name if asset.owning_department_id else "",
        "name": asset.name,
        "device_type_name": asset.device_type.name if asset.device_type_id else "",
        "serial_number": asset.serial_number,
        "status": asset.status,
        "business_ip": network.get("business", ""),
        "management_ip": network.get("management", ""),
        "oob_ip": network.get("oob", ""),
        **location,
    }


def _inventory_scope_limit_error(asset_count):
    return DRFValidationError({
        "detail": (
            f"当前盘点范围包含 {asset_count} 台资产，"
            f"单次盘点任务最多支持 {operation_limits.MAX_INVENTORY_TASK_ASSETS} 台，"
            "请缩小盘点范围后重试。"
        ),
        "code": "inventory_scope_too_large",
        "count": asset_count,
        "max_assets": operation_limits.MAX_INVENTORY_TASK_ASSETS,
    })


def _materialize_inventory_assets_with_limit(data_center, server_room, scope, actor):
    """Count first, then materialize only a bounded candidate set."""
    queryset = get_inventory_scope_assets(data_center, server_room, scope=scope)
    require_queryset(queryset, user=actor)
    asset_count = queryset.count()
    if asset_count > operation_limits.MAX_INVENTORY_TASK_ASSETS:
        raise _inventory_scope_limit_error(asset_count)

    assets = list(queryset[:operation_limits.MAX_INVENTORY_TASK_ASSETS + 1])
    if len(assets) > operation_limits.MAX_INVENTORY_TASK_ASSETS:
        raise _inventory_scope_limit_error(max(asset_count, len(assets)))
    return assets


def validate_inventory_task(attrs, *, instance=None):
    if instance and instance.status == "completed":
        raise DRFValidationError({"detail": "已完成的盘点任务已锁定，请先重新打开任务"})
    data_center = attrs.get("data_center", instance.data_center if instance else None)
    server_room = attrs.get("server_room", instance.server_room if instance else None)
    scope = attrs.get("scope")
    start_at = attrs.get("start_at", instance.start_at if instance else None)
    end_at = attrs.get("end_at", instance.end_at if instance else None)
    if scope is None:
        if instance and "data_center" not in attrs and "server_room" not in attrs:
            scope = instance.scope
        elif server_room is not None:
            scope = "server_room"
        elif data_center is not None:
            scope = "data_center"
        else:
            raise DRFValidationError({"scope": "请选择盘点范围"})
        attrs["scope"] = scope

    if scope == "all_assets":
        if data_center is not None or server_room is not None:
            raise DRFValidationError({"scope": "全部资产范围不能同时指定数据中心或机房"})
    else:
        if data_center is None:
            raise DRFValidationError({"data_center": "指定位置范围必须选择数据中心"})
        if server_room and server_room.data_center_id != data_center.id:
            raise DRFValidationError({"server_room": "机房不属于所选数据中心"})
        if scope == "data_center" and server_room is not None:
            raise DRFValidationError({"server_room": "数据中心范围不能同时指定机房"})
        if scope == "server_room" and server_room is None:
            raise DRFValidationError({"server_room": "机房范围必须选择机房"})
    if start_at and end_at and end_at < start_at:
        raise DRFValidationError({"end_at": "结束时间不能早于开始时间"})
    if data_center and not data_center.is_active:
        raise DRFValidationError({"data_center": "停用的数据中心不能创建盘点任务"})
    if server_room and not server_room.is_active:
        raise DRFValidationError({"server_room": "停用的机房不能创建盘点任务"})
    if instance:
        if scope != instance.scope:
            raise DRFValidationError({"scope": "任务已经生成固定清单，不能修改盘点范围"})
        if "data_center" in attrs and (data_center.id if data_center else None) != instance.data_center_id:
            raise DRFValidationError({"data_center": "任务已经生成固定清单，不能修改数据中心范围"})
        if "server_room" in attrs and (server_room.id if server_room else None) != instance.server_room_id:
            raise DRFValidationError({"server_room": "任务已经生成固定清单，不能修改机房范围"})
    return attrs

def validate_inventory_observation(attrs, *, instance, submitted_fields, actor=None, task=None):
    protected_fields = {
        "resolution_status",
        "resolution_action",
        "resolution_note",
        "resolved_by",
        "resolved_at",
    }
    if any(field in submitted_fields for field in protected_fields):
        raise DRFValidationError({"detail": "异常处理字段只能通过专用处理接口修改"})
    task = instance.task if instance else task
    if task and task.status == "completed":
        raise DRFValidationError({"detail": "已完成的盘点任务已锁定，不能修改"})
    status = attrs.get("status", instance.status if instance else "pending")
    if status == "normal":
        if not instance:
            raise DRFValidationError({"status": "盘点项必须来自已生成的盘点任务"})
        try:
            snapshot_rack, snapshot_start_u, snapshot_end_u = inventory_snapshot_location(instance)
        except DRFValidationError as exc:
            raise DRFValidationError(exc.detail) from exc
        attrs["actual_rack"] = snapshot_rack
        attrs["actual_start_u"] = snapshot_start_u
        attrs["actual_end_u"] = snapshot_end_u
        center_id = (instance.system_snapshot or {}).get("data_center_id")
        attrs["actual_data_center_ref"] = DataCenter.objects.filter(pk=center_id).first() if center_id else None
        attrs["actual_placement"] = "mounted" if snapshot_rack else ("data_center" if center_id else "unlocated")
    actual_rack = attrs.get("actual_rack", instance.actual_rack if instance else None)
    start_u = attrs.get("actual_start_u", instance.actual_start_u if instance else None)
    end_u = attrs.get("actual_end_u", instance.actual_end_u if instance else None)
    if status in {"pending", "not_found"}:
        attrs["actual_rack"] = None
        attrs["actual_start_u"] = None
        attrs["actual_end_u"] = None
        attrs["actual_placement"] = ""
        attrs["actual_data_center_ref"] = None
    elif any(value is not None for value in (actual_rack, start_u, end_u)):
        if not actual_rack or start_u is None or end_u is None:
            raise DRFValidationError({"actual_rack": "实际机柜和起止 U 位必须填写完整"})
        if (
            not actual_rack.is_active
            or not actual_rack.room.is_active
            or not actual_rack.room.data_center.is_active
        ):
            raise DRFValidationError({"actual_rack": "实际机柜、机房或数据中心已停用，不能记录为现场位置"})
        if start_u < 1 or end_u < start_u:
            raise DRFValidationError({"actual_start_u": "实际 U 位范围不正确"})
        if end_u > actual_rack.total_u:
            raise DRFValidationError({"actual_end_u": f"实际结束 U 不能超过机柜容量 U{actual_rack.total_u}"})
    if status not in {"pending", "not_found", "normal"}:
        placement = attrs.get("actual_placement", instance.actual_placement if instance else "")
        center = attrs.get("actual_data_center_ref", instance.actual_data_center_ref if instance else None)
        if attrs.get("actual_rack") and "actual_placement" not in submitted_fields:
            placement = "mounted"
        if not placement and actual_rack and "actual_placement" not in submitted_fields:
            placement = "mounted"
        if placement == "mounted":
            if actual_rack is None:
                raise DRFValidationError({"actual_rack": "已上架位置必须填写机柜和 U 位"})
            if center and "actual_data_center_id" in submitted_fields and center.pk != actual_rack.room.data_center_id:
                raise DRFValidationError({"actual_data_center_id": "实际机柜不属于所选数据中心"})
            center = actual_rack.room.data_center
        elif placement == "data_center":
            if center is None:
                raise DRFValidationError({"actual_data_center_id": "仅归属数据中心必须选择数据中心"})
            if actual_rack or start_u is not None or end_u is not None:
                raise DRFValidationError({"actual_rack": "仅归属数据中心不能同时记录机柜或 U 位"})
        elif placement == "unlocated":
            if center or actual_rack or start_u is not None or end_u is not None:
                raise DRFValidationError({"actual_placement": "位置未指定不能同时记录数据中心、机柜或 U 位"})
        elif center or actual_rack or start_u is not None or end_u is not None:
            raise DRFValidationError({"actual_placement": "尚未确认位置不能同时记录数据中心、机柜或 U 位；请明确位置类型"})
        if center and not center.is_active:
            raise DRFValidationError({"actual_data_center_id": "实际数据中心已停用"})
        attrs["actual_placement"] = placement
        attrs["actual_data_center_ref"] = center
        if instance is not None and placement in {"mounted", "data_center", "unlocated"}:
            from .data_scope import require_asset_destination
            require_asset_destination(instance.asset_id, center.pk if center else None, user=actor)
    if status == "normal":
        snapshot = instance.system_snapshot if instance else {}
        from .data_scope import require_asset_destination
        require_asset_destination(instance.asset_id, snapshot.get("data_center_id"), user=actor)
        if not snapshot.get("rack_id") and actual_rack is None:
            same_location = True
        else:
            same_location = (
                actual_rack is not None
                and actual_rack.code == snapshot.get("rack_code")
                and actual_rack.room_id == snapshot.get("server_room_id")
                and actual_rack.room.data_center_id == snapshot.get("data_center_id")
                and start_u == snapshot.get("start_u")
                and end_u == snapshot.get("end_u")
            )
        if not same_location:
            raise DRFValidationError({"status": "实际位置与系统记录不一致，请选择“位置不符”"})
    return attrs


@transaction.atomic
def record_inventory_observation(*, item_id, validated_data, actor, request):
    from .serializers import InventoryItemSerializer
    _require_inventory_manager(actor)
    admission = InventoryItem.objects.select_related("actual_rack", "actual_data_center_ref").get(pk=item_id)
    # Lock physical parents before asset -> task -> item; joined FOR UPDATE
    # would implicitly lock the asset before its center and invert this.
    observed_rack = validated_data.get("actual_rack", admission.actual_rack)
    observed_center = validated_data.get("actual_data_center_ref", admission.actual_data_center_ref)
    lock_asset_location(asset_id=admission.asset_id,
        target_rack_id=observed_rack.pk if observed_rack else None,
        target_data_center_id=observed_center.pk if observed_center else None)
    active_asset_for_update(admission.asset_id)
    task = InventoryTask.objects.select_for_update().get(pk=admission.task_id)
    require_object(task, user=actor)
    item = InventoryItem.objects.select_for_update().get(pk=admission.pk)
    from .resource_revision import check_resource_revision
    check_resource_revision(item, request)
    locked_serializer = InventoryItemSerializer(
        item,
        data=request.data,
        partial=True, context={"request": request},
    )
    locked_serializer.is_valid(raise_exception=True)
    if task.status == "completed":
        raise DRFValidationError({"detail": "已完成的盘点任务已锁定，不能修改"})
    if locked_serializer.validated_data.get("status", item.status) == "normal":
        updated = confirm_inventory_item_normal(
            item_id=item.pk,
            actor=actor,
            request=request,
            notes=locked_serializer.validated_data.get("notes"),
            source="inventory_result",
        )
        return updated
    before_result = (
        item.status,
        item.actual_placement,
        item.actual_data_center_ref_id,
        item.actual_rack_id,
        item.actual_start_u,
        item.actual_end_u,
        item.notes,
    )
    before = InventoryItemSerializer(item).data
    updated = locked_serializer.save()
    if updated.status == "pending":
        updated.checked_by = None
        updated.checked_at = None
    else:
        updated.checked_by = actor
        updated.checked_at = timezone.now()
    after_result = (
        updated.status,
        updated.actual_placement,
        updated.actual_data_center_ref_id,
        updated.actual_rack_id,
        updated.actual_start_u,
        updated.actual_end_u,
        updated.notes,
    )
    resolution_reset = updated.status in {"pending", "normal"} or before_result != after_result
    if resolution_reset:
        reset_inventory_resolution(updated)
    update_fields = ["checked_by", "checked_at", "updated_at"]
    if resolution_reset:
        update_fields.extend([
            "resolution_status",
            "resolution_action",
            "resolution_note",
            "resolved_by",
            "resolved_at",
        ])
    updated.save(update_fields=update_fields)
    write_audit_log(
        request, actor=actor,
        action="update",
        resource_type="inventory_item",
        resource_id=updated.pk,
        before=before,
        after=InventoryItemSerializer(updated).data,
        extra={"asset_id": updated.asset_id},
    )
    return updated


@transaction.atomic
def create_inventory_task(*, validated_data, actor, request):
    _require_inventory_manager(actor)
    data = validate_inventory_task(dict(validated_data))
    if data["scope"] == "all_assets" and not scope_for(actor).global_write:
        raise PermissionDenied({"code": "data_scope_global_required", "detail": "全部资产盘点需要全局写入授权"})
    try:
        center, room = lock_inventory_scope(getattr(data.get("data_center"), "pk", None), getattr(data.get("server_room"), "pk", None))
    except ValidationError as exc:
        raise DRFValidationError(exc.message_dict) from exc
    if center: data["data_center"] = center
    if room: data["server_room"] = room
    # Recheck active parents after acquiring their locks.
    validate_inventory_task(data)
    assets = _materialize_inventory_assets_with_limit(center, room, data["scope"], actor)
    active_ids = set(Asset.objects.select_for_update().filter(pk__in=[asset.pk for asset in assets]).order_by("pk").values_list("pk", flat=True))
    assets = list(get_inventory_scope_assets(center, room, scope=data["scope"]).filter(pk__in=active_ids))
    require_queryset(Asset.objects.filter(pk__in=[asset.pk for asset in assets]), user=actor)
    data.setdefault("inspector", actor)
    task = InventoryTask.objects.create(**data)
    InventoryItem.objects.bulk_create([InventoryItem(task=task, asset=asset, system_snapshot=_inventory_snapshot(asset)) for asset in assets], batch_size=500)
    write_audit_log(request, actor=actor, action="create", resource_type="inventory_task", resource_id=task.pk, after={"task":model_snapshot(task), "items_created":len(assets)})
    return task


def _locked_task(task_id, actor):
    """Lock the fixed membership before checking complete task visibility."""
    _require_inventory_manager(actor)
    admission = InventoryTask.objects.get(pk=task_id)
    try:
        lock_inventory_scope(admission.data_center_id, admission.server_room_id)
    except ValidationError as exc:
        raise DRFValidationError(exc.message_dict) from exc
    asset_ids = InventoryItem.objects.filter(task_id=task_id).values_list("asset_id", flat=True)
    assets = list(Asset.all_objects.select_for_update().filter(pk__in=asset_ids).order_by("pk"))
    task = InventoryTask.objects.select_for_update().get(pk=task_id)
    require_object(task, user=actor)
    return task, assets


@transaction.atomic
def update_inventory_task(*, task_id, actor, request, partial=False):
    from .serializers import InventoryTaskSerializer
    task, _ = _locked_task(task_id, actor)
    check_resource_revision(task, request)
    fields = InventoryTaskSerializer(task, data=request.data, partial=partial, context={"request":request})
    fields.is_valid(raise_exception=True)
    before = model_snapshot(task)
    updated = fields.save()
    write_audit_log(request, actor=actor, action="update", resource_type="inventory_task", resource_id=task.pk, before=before, after=model_snapshot(updated))
    return updated


@transaction.atomic
def delete_inventory_task(*, task_id, actor, request):
    task, _ = _locked_task(task_id, actor)
    items = list(task.items.select_for_update().order_by("pk"))
    reason = inventory_task_delete_block_reason(task, items)
    if reason: raise DRFValidationError({"detail":reason})
    before = model_snapshot(task)
    task.delete()
    write_audit_log(request, actor=actor, action="delete", resource_type="inventory_task", resource_id=task_id, before=before)


@transaction.atomic
def change_inventory_task_status(*, task_id, action, actor, request):
    task, assets = _locked_task(task_id, actor)
    if action == "complete":
        if task.status == "completed": return task
        items = list(task.items.select_for_update().order_by("pk").only("status"))
        pending = sum(item.status == "pending" for item in items)
        if pending: raise DRFValidationError({"detail":f"还有 {pending} 台设备未盘点，不能完成任务"})
        task.status = "completed"
        task.completed_at = timezone.now()
        after = {"status":task.status, "completed_at":task.completed_at}
    elif action == "reopen":
        if any(asset.archived_at is not None for asset in assets):
            raise InventoryObservationConflict({"code":"asset_archived", "detail":"盘点包含已归档资产，请先恢复资产再重新打开任务"})
        if task.status != "completed":
            raise DRFValidationError({"code":"inventory_task_not_completed", "detail":"只有已完成的盘点任务才能重新打开"})
        task.status = "in_progress"
        task.completed_at = None
        after = {"status":task.status}
    else:
        raise DRFValidationError({"action":"不支持的盘点任务状态操作"})
    task.save(update_fields=["status","completed_at","updated_at"])
    write_audit_log(request, actor=actor, action=action, resource_type="inventory_task", resource_id=task.pk, after=after)
    return task


def _inventory_error_message(error, fallback):
    detail = getattr(error, "detail", error)

    def flatten(value):
        if isinstance(value, dict):
            return "；".join(flatten(child) for child in value.values())
        if isinstance(value, (list, tuple)):
            return "；".join(flatten(child) for child in value)
        return str(value or "")

    return flatten(detail) or fallback


def submit_inventory_batch(*, item_ids, action, note="", actor, request):
    """Each row commits independently; authorization failures reveal no identity."""
    _require_inventory_manager(actor)
    if action != "normal": validate_inventory_resolution_request(action, note, bulk=True)
    items = list(scoped(InventoryItem.objects.filter(pk__in=item_ids), user=actor, write=True).select_related("asset"))
    if len({item.task_id for item in items}) > 1:
        raise DRFValidationError({"item_ids":"所有盘点项必须属于同一个盘点任务"})
    by_id = {item.pk:item for item in items}
    results = []
    for item_id in item_ids:
        item = by_id.get(item_id)
        if item is None:
            results.append({"item_id":item_id,"asset_no":"","success":False,"reason":"盘点项不存在或不在完整任务写入范围内"})
            continue
        try:
            if action == "normal":
                result = confirm_inventory_item_normal(item_id=item_id, actor=actor, request=request, require_pending=True, source="inventory_bulk_confirm_normal")
            else:
                result = resolve_inventory_item(item_id=item_id, action=action, note=note, actor=actor, request=request)
        except PermissionDenied:
            row = {"item_id":item_id,"asset_no":"","success":False,"reason":"盘点项不在完整任务写入范围内"}
        except (DRFValidationError, InventoryObservationConflict) as exc:
            row = {"item_id":item_id,"asset_no":item.asset.asset_no,"success":False,"reason":_inventory_error_message(exc,"批量标记正常失败" if action == "normal" else "盘点异常处理失败")}
        except InventoryItem.DoesNotExist:
            row = {"item_id":item_id,"asset_no":item.asset.asset_no,"success":False,"reason":"盘点项不存在"}
        else:
            row = {"item_id":item_id,"asset_no":result.asset.asset_no,"success":True,"reason":""}
        results.append(row)
    succeeded = sum(row["success"] for row in results)
    return {"requested":len(item_ids),"succeeded":succeeded,"failed":len(item_ids)-succeeded,"results":results}
