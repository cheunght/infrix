from datetime import date
from decimal import Decimal, InvalidOperation
from ipaddress import ip_address

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError
from django.utils import timezone

from .models import (
    Asset,
    AssetCustomValue,
    AssetNetworkAddress,
    AssetTag,
    CustomField,
    DataCenter,
    FaultEvent,
    InventoryItem,
    InventoryTask,
    MaintenanceContract,
    ProcurementRecord,
    Rack,
    RackUnitAllocation,
    ServerRoom,
    SparePart,
    SpareStock,
    SpareStockTransaction,
    Tag,
)
from .roles import user_has_capability


def _value(data, key):
    value = data.get(key)
    return str(value).strip() if value is not None else ""


def _optional_date(data, key):
    value = _value(data, key)
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError({key: "日期格式应为 YYYY-MM-DD"}) from exc


INVENTORY_EXCEPTION_STATUSES = frozenset({
    "location_mismatch",
    "not_found",
    "info_mismatch",
    "other",
})


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
    from .audit import write_audit_log
    from .serializers import InventoryItemSerializer

    item = InventoryItem.objects.select_for_update().select_related(
        "asset",
        "checked_by",
        "resolved_by",
        "actual_rack__room__data_center",
    ).get(pk=item_id)
    task = InventoryTask.objects.select_for_update().get(pk=item.task_id)
    if task.status != "in_progress":
        raise DRFValidationError({"detail": "已完成的盘点任务不能批量标记为正常"})
    if require_pending and item.status != "pending":
        raise DRFValidationError({"detail": "该盘点项已被盘点，不能批量标记为正常"})

    rack, start_u, end_u = inventory_snapshot_location(item)
    before = InventoryItemSerializer(item).data
    item.status = "normal"
    item.actual_rack = rack
    item.actual_start_u = start_u
    item.actual_end_u = end_u
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
        request,
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
    if action not in dict(InventoryItem.RESOLUTION_ACTION):
        raise DRFValidationError({"action": "无效的盘点异常处理方式"})
    if bulk and action == "update_asset":
        raise DRFValidationError({"action": "批量处理不支持更新资产台账，请逐条处理位置异常。"})
    if action == "ignore" and not str(note or "").strip():
        raise DRFValidationError({"note": "忽略异常时必须填写处理备注"})


@transaction.atomic
def resolve_inventory_item(*, item_id, action, note, actor, request):
    """Resolve one inventory exception with the canonical row-level rules."""
    validate_inventory_resolution_request(action, note)
    if action == "update_asset" and not user_has_capability(actor, "assets.manage"):
        raise PermissionDenied("更新资产台账需要 assets.manage 权限")

    from .audit import asset_audit_snapshot, write_audit_log
    from .serializers import InventoryItemSerializer

    item = InventoryItem.objects.select_for_update().select_related(
        "asset",
        "checked_by",
        "resolved_by",
        "actual_rack__room__data_center",
    ).get(pk=item_id)
    task = InventoryTask.objects.select_for_update().get(pk=item.task_id)
    asset = Asset.objects.select_for_update().get(pk=item.asset_id)

    if item.status not in INVENTORY_EXCEPTION_STATUSES:
        raise DRFValidationError({"detail": "只有异常盘点项可以处理"})
    if item.resolution_status != "pending":
        raise DRFValidationError({"detail": "该异常已被处理"})
    if action == "confirm_missing" and item.status != "not_found":
        raise DRFValidationError({"action": "确认设备缺失只适用于未找到的资产"})
    if action == "update_asset" and item.status != "location_mismatch":
        raise DRFValidationError({"action": "更新资产台账目前只适用于位置不符"})

    before_item = InventoryItemSerializer(item).data
    asset_changed = False
    if action == "update_asset":
        if (
            item.actual_rack_id is None
            or item.actual_start_u is None
            or item.actual_end_u is None
        ):
            raise DRFValidationError({"action": "位置不符必须包含完整的实际机柜和起止 U 位"})
        before_asset = asset_audit_snapshot(asset.pk)
        try:
            asset_changed = update_asset_placement(
                asset,
                rack=item.actual_rack,
                start_u=item.actual_start_u,
                end_u=item.actual_end_u,
            )
        except ValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") else {"detail": exc.messages}
            raise DRFValidationError(detail) from exc
        if asset_changed:
            after_asset = asset_audit_snapshot(asset.pk)
            write_audit_log(
                request,
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
        request,
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


def update_asset_placement(asset: Asset, *, rack: Rack, start_u: int, end_u: int) -> bool:
    """Update only an asset's rack placement using the canonical placement rules."""
    rack = Rack.objects.select_related("room__data_center").select_for_update().get(pk=rack.pk)
    if (
        not rack.is_active
        or not rack.room.is_active
        or not rack.room.data_center.is_active
        or getattr(rack, "status", "in_use") != "in_use"
    ):
        raise ValidationError({"rack_code": "预留或停用的机柜不能用于资产"})
    if start_u < 1 or end_u < 1:
        raise ValidationError({"rack_start_u": "U 位必须大于等于 1"})
    if end_u < start_u:
        raise ValidationError({"rack_start_u": "起始 U 位不能大于结束 U 位"})
    if end_u > rack.total_u:
        raise ValidationError({"rack_end_u": f"结束 U 位不能超过机柜容量 U{rack.total_u}"})

    # Lock all allocations in the target rack before checking for overlap.
    list(RackUnitAllocation.objects.select_for_update().filter(rack=rack))
    conflicts = RackUnitAllocation.objects.select_related("asset").filter(
        rack=rack,
        start_u__lte=end_u,
        end_u__gte=start_u,
    ).exclude(asset_id=asset.pk)
    conflict = conflicts.order_by("start_u", "id").first()
    if conflict:
        raise ValidationError({
            "configuration": (
                f"机柜 {rack.code} 的 U{start_u}-U{end_u} 与资产 "
                f"{conflict.asset.asset_no}（U{conflict.start_u}-U{conflict.end_u}）冲突"
            )
        })

    allocation = RackUnitAllocation.objects.select_for_update().filter(asset=asset).first()
    changed = not (
        allocation
        and allocation.rack_id == rack.pk
        and allocation.start_u == start_u
        and allocation.end_u == end_u
        and asset.asset_data_center_id == rack.room.data_center_id
    )
    if allocation is None:
        allocation = RackUnitAllocation(asset=asset)
    allocation.rack = rack
    allocation.start_u = start_u
    allocation.end_u = end_u
    if changed:
        allocation.full_clean()
        allocation.save()
    if asset.asset_data_center_id != rack.room.data_center_id:
        asset.asset_data_center_id = rack.room.data_center_id
        asset.save(update_fields=["asset_data_center", "updated_at"])
        changed = True
    return changed


def configure_asset(asset: Asset, data):
    """Replace rack, IP, procurement and maintenance details for an asset."""
    data = data or {}
    data_center_value = _value(data, "data_center")
    room_id, room_name = _value(data, "server_room_id"), _value(data, "server_room")
    rack_id, rack_code = _value(data, "rack_id"), _value(data, "rack_code")
    room_value, rack_value = room_id or room_name, rack_id or rack_code
    # ``rack_total_u`` is a display-only value supplied by the form.  It is
    # intentionally not part of the completeness check, otherwise a new
    # non-rack-mounted asset (whose default capacity is 45) would be treated
    # as a partially configured rack placement.
    start_u_value = _value(data, "rack_start_u")
    end_u_value = _value(data, "rack_end_u")
    location_values = [data_center_value, room_value, rack_value, start_u_value, end_u_value]
    if any(location_values):
        if not all(location_values):
            missing = [
                label
                for label, value in (
                    ("数据中心", data_center_value),
                    ("机房", room_value),
                    ("机柜编号", rack_value),
                    ("起始 U", start_u_value),
                    ("结束 U", end_u_value),
                )
                if not value
            ]
            raise ValidationError({
                "configuration": f"机柜位置未填写完整，请补充：{'、'.join(missing)}"
            })
        try:
            start_u, end_u = int(_value(data, "rack_start_u")), int(_value(data, "rack_end_u"))
        except ValueError as exc:
            raise ValidationError("U 位必须是数字") from exc
        data_center = DataCenter.objects.filter(pk=int(data_center_value)).first() if data_center_value.isdigit() else DataCenter.objects.filter(name=data_center_value).first()
        if not data_center:
            raise ValidationError({"data_center": "数据中心必须从数据字典中选择"})
        if not data_center.is_active:
            raise ValidationError({"data_center": "停用的数据中心不能用于资产"})
        if room_id:
            room = ServerRoom.objects.filter(pk=room_id, data_center=data_center).first()
        else:
            room = ServerRoom.objects.filter(data_center=data_center, name__iexact=room_name).first()
        if not room:
            raise ValidationError({"server_room": "未找到所选机房，请先在机房机柜维护中创建"})
        if not room.is_active:
            raise ValidationError({"server_room": "停用的机房不能用于资产"})
        if rack_id:
            rack = Rack.objects.filter(pk=rack_id, room=room).first()
        else:
            rack = Rack.objects.filter(room=room, code__iexact=rack_code).first()
        if not rack:
            raise ValidationError({"rack_code": "未找到所选机柜，请先在机房机柜维护中创建"})
        if not rack.is_active or getattr(rack, "status", "in_use") != "in_use":
            raise ValidationError({"rack_code": "预留或停用的机柜不能用于资产"})
        update_asset_placement(asset, rack=rack, start_u=start_u, end_u=end_u)
    else:
        RackUnitAllocation.objects.filter(asset=asset).delete()

    for role, key in (("business", "business_ip"), ("management", "management_ip"), ("oob", "oob_ip")):
        address = _value(data, key)
        if not address:
            AssetNetworkAddress.objects.filter(asset=asset, role=role).delete()
            continue
        try:
            ip_address(address)
        except ValueError as exc:
            raise ValidationError({key: "IP 地址格式不正确"}) from exc
        AssetNetworkAddress.objects.update_or_create(asset=asset, role=role, defaults={"address": address, "is_primary": True})

    purchase_fields = ("purchase_date", "supplier", "purchase_order_no", "purchase_amount", "procurement_notes")
    if any(_value(data, key) for key in purchase_fields):
        purchase_date = _optional_date(data, "purchase_date")
        if not purchase_date:
            raise ValidationError({"purchase_date": "填写采购信息时必须填写采购日期"})
        amount = None
        amount_value = _value(data, "purchase_amount")
        if amount_value:
            try:
                amount = Decimal(amount_value)
            except InvalidOperation as exc:
                raise ValidationError({"purchase_amount": "采购金额格式不正确"}) from exc
            if amount < 0:
                raise ValidationError({"purchase_amount": "采购金额不能小于 0"})
        ProcurementRecord.objects.update_or_create(asset=asset, defaults={"purchase_date": purchase_date, "supplier": _value(data, "supplier"), "order_no": _value(data, "purchase_order_no"), "amount": amount, "notes": _value(data, "procurement_notes")})
    else:
        ProcurementRecord.objects.filter(asset=asset).delete()

    maintenance_values = [_value(data, key) for key in ("maintenance_provider", "maintenance_contract_no", "maintenance_start_date", "maintenance_expiry_date", "maintenance_notes")]
    if any(maintenance_values):
        start_date = _optional_date(data, "maintenance_start_date")
        expiry_date = _optional_date(data, "maintenance_expiry_date")
        if start_date and expiry_date and expiry_date < start_date:
            raise ValidationError({"maintenance_expiry_date": "维保到期日不能早于开始日"})
        MaintenanceContract.objects.update_or_create(asset=asset, defaults={"provider": _value(data, "maintenance_provider"), "contract_no": _value(data, "maintenance_contract_no"), "start_date": start_date, "expiry_date": expiry_date, "notes": _value(data, "maintenance_notes")})
    else:
        MaintenanceContract.objects.filter(asset=asset).delete()


def _custom_field_value_is_empty(value, field_type):
    if field_type in {"text", "textarea", "date", "select"}:
        return value is None or (isinstance(value, str) and value.strip() == "")
    if field_type == "number":
        return value is None or (isinstance(value, str) and value.strip() == "")
    if field_type == "boolean":
        return value is None
    if field_type == "multiselect":
        return value is None or value == []
    return value is None


def _custom_date(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError("日期格式应为 YYYY-MM-DD") from exc


def _stored_custom_value(value):
    field_type = value.field.field_type
    if field_type in {"text", "textarea", "select"}:
        return value.text_value
    if field_type == "number":
        return value.number_value
    if field_type == "date":
        return value.date_value
    if field_type == "boolean":
        return value.boolean_value
    return value.json_value


def _custom_value_payload(field, raw):
    payload = {
        "text_value": "",
        "number_value": None,
        "date_value": None,
        "boolean_value": None,
        "json_value": None,
    }
    if field.field_type in {"text", "textarea"}:
        if not isinstance(raw, str):
            raise ValueError("必须是文本")
        payload["text_value"] = raw
    elif field.field_type == "number":
        number = Decimal(str(raw))
        if not number.is_finite():
            raise ValueError("必须是有效数字")
        payload["number_value"] = number
    elif field.field_type == "date":
        payload["date_value"] = _custom_date(raw)
    elif field.field_type == "boolean":
        if not isinstance(raw, bool):
            raise ValueError("必须是 true 或 false")
        payload["boolean_value"] = raw
    elif field.field_type in {"select", "multiselect"}:
        options = {option.value for option in field.options.all() if option.is_active}
        if field.field_type == "select":
            if not isinstance(raw, str):
                raise ValueError("必须是选项值")
            submitted_values = [raw]
        else:
            if not isinstance(raw, list):
                raise ValueError("必须是选项数组")
            submitted_values = raw
        if any(not isinstance(item, str) or item not in options for item in submitted_values):
            raise ValueError("包含无效或已停用选项")
        if field.field_type == "select":
            payload["text_value"] = raw
        else:
            payload["json_value"] = submitted_values
    return payload


def apply_asset_custom_values(asset: Asset, values, *, submitted=True, is_create=False, old_device_type_id=None):
    """Validate and persist partial values for the asset's current device type.

    Values belonging to another device type are historical data.  They are not
    part of the current validation set and must never be deleted on a device
    type change.
    """
    if values is None:
        values = {}
    if not isinstance(values, dict):
        raise ValidationError({"custom_values": "自定义字段值必须是对象"})

    scope = Q(device_type__isnull=True)
    if asset.device_type_id:
        scope |= Q(device_type_id=asset.device_type_id)
    fields = list(CustomField.objects.filter(scope).prefetch_related("options"))
    by_key = {field.key: field for field in fields}
    if values:
        unknown = [key for key in values if key not in by_key]
        if unknown:
            raise ValidationError({"custom_values": f"不存在或不属于当前设备类型的字段：{'、'.join(str(key) for key in unknown)}"})

    existing_values = {
        item.field_id: _stored_custom_value(item)
        for item in AssetCustomValue.objects.filter(
            asset_id=asset.pk,
            field_id__in=[field.id for field in fields],
        ).select_related("field")
    }

    missing = []
    for field in fields:
        if not field.is_active or not field.required:
            continue
        if submitted and field.key in values:
            candidate = values[field.key]
        else:
            candidate = existing_values.get(field.id)
        if _custom_field_value_is_empty(candidate, field.field_type):
            missing.append(field.name)
    if missing:
        raise ValidationError({"custom_values": f"必填自定义字段未填写：{'、'.join(missing)}"})

    operations = []
    for key, raw in values.items():
        field = by_key[key]
        if not field.is_active:
            raise ValidationError({f"custom_values.{key}": "该字段已停用，不能修改"})
        if _custom_field_value_is_empty(raw, field.field_type):
            operations.append((field, None))
            continue

        try:
            payload = _custom_value_payload(field, raw)
        except (InvalidOperation, ValueError, TypeError) as exc:
            raise ValidationError({f"custom_values.{key}": str(exc)}) from exc
        operations.append((field, payload))

    for field, payload in operations:
        if payload is None:
            AssetCustomValue.objects.filter(asset=asset, field=field).delete()
        else:
            AssetCustomValue.objects.update_or_create(asset=asset, field=field, defaults=payload)


def apply_asset_tags(asset: Asset, tags, *, submitted=True):
    """Replace asset tags while allowing existing disabled tags to remain visible."""
    if tags is None:
        return
    tag_objects = list(tags)
    existing_ids = set(AssetTag.objects.filter(asset=asset).values_list("tag_id", flat=True))
    invalid = [tag.name for tag in tag_objects if not tag.is_active and tag.pk not in existing_ids]
    if invalid:
        raise ValidationError({"tags": f"停用的标签不能用于资产：{'、'.join(invalid)}"})
    AssetTag.objects.filter(asset=asset).delete()
    AssetTag.objects.bulk_create([AssetTag(asset=asset, tag=tag) for tag in tag_objects])


REPAIR_RESTORE_STATUSES = frozenset({"in_stock", "in_use", "idle"})


def _write_fault_status_audit(
    *,
    request,
    asset,
    old_status,
    new_status,
    old_snapshot,
    new_snapshot,
    fault_id=None,
    repair_id=None,
    transition=None,
):
    if request is None or old_status == new_status:
        return

    from .audit import write_audit_log

    transition = transition or ("enter_repair" if new_status == "repair" else "restore")
    write_audit_log(
        request,
        action="update",
        resource_type="asset",
        resource_id=asset.pk,
        before={
            "status": old_status,
            "status_before_repair": old_snapshot,
        },
        after={
            "status": new_status,
            "status_before_repair": new_snapshot,
        },
        extra={
            "source": "fault_status_sync",
            "transition": transition,
            "asset_id": asset.pk,
            "fault_id": fault_id,
            "repair_id": repair_id,
            "old_status": old_status,
            "new_status": new_status,
            "status_before_repair": new_snapshot if new_status == "repair" else old_snapshot,
        },
    )


@transaction.atomic
def sync_asset_fault_status(asset_id: int, *, request=None, fault_id=None, repair_id=None, transition=None):
    """Synchronize one asset's repair lifecycle and restore snapshot."""
    asset = Asset.objects.select_for_update().get(pk=asset_id)
    open_faults = FaultEvent.objects.filter(asset_id=asset_id, is_closed=False)
    has_open_fault = open_faults.exists()
    other_open_fault = open_faults.exclude(pk=fault_id).exists() if fault_id is not None else has_open_fault
    old_status = asset.status
    old_snapshot = asset.status_before_repair
    update_fields = []

    if has_open_fault:
        if asset.status != "retired":
            if asset.status != "repair":
                if not other_open_fault and asset.status_before_repair is None and asset.status in REPAIR_RESTORE_STATUSES:
                    asset.status_before_repair = asset.status
                    update_fields.append("status_before_repair")
                asset.status = "repair"
                update_fields.append("status")
    elif asset.status == "repair":
        if asset.status_before_repair in REPAIR_RESTORE_STATUSES:
            asset.status = asset.status_before_repair
            asset.status_before_repair = None
            update_fields.extend(["status", "status_before_repair"])
    elif asset.status_before_repair is not None:
        # Clear only a stale internal snapshot; never infer a replacement status.
        asset.status_before_repair = None
        update_fields.append("status_before_repair")

    if update_fields:
        asset.save(update_fields=[*update_fields, "updated_at"])
        _write_fault_status_audit(
            request=request,
            asset=asset,
            old_status=old_status,
            new_status=asset.status,
            old_snapshot=old_snapshot,
            new_snapshot=asset.status_before_repair,
            fault_id=fault_id,
            repair_id=repair_id,
            transition=transition,
        )
    return asset


@transaction.atomic
def sync_fault_completion(*, fault_id: int, finished_at, request=None, repair_id=None):
    """Make FaultEvent completion state derive only from RepairRecord.finished_at."""
    from .audit import write_audit_log

    fault = FaultEvent.objects.select_for_update().get(pk=fault_id)
    next_is_closed = bool(finished_at)
    before = {"is_closed": fault.is_closed, "resolved_at": fault.resolved_at}
    after = {"is_closed": next_is_closed, "resolved_at": finished_at}
    if before != after:
        FaultEvent.objects.filter(pk=fault.pk).update(
            is_closed=next_is_closed,
            resolved_at=finished_at,
        )
        if request is not None:
            write_audit_log(
                request,
                action="close" if next_is_closed else "reopen",
                resource_type="fault_event",
                resource_id=fault.pk,
                before=before,
                after=after,
                extra={
                    "source": "repair_record",
                    "repair_id": repair_id,
                    "fault_id": fault.pk,
                },
            )

    sync_asset_fault_status(
        fault.asset_id,
        request=request,
        fault_id=fault.pk,
        repair_id=repair_id,
        transition="reopen" if not next_is_closed else None,
    )
    return fault


def sync_repair_completion(repair, *, request=None):
    """Keep RepairRecord, FaultEvent and Asset status consistent."""
    return sync_fault_completion(
        fault_id=repair.fault_id,
        finished_at=repair.finished_at,
        request=request,
        repair_id=repair.pk,
    )


def _spare_location(data_center_id, server_room_id, *, role):
    """Validate and return one active data-center/optional-room pair."""
    if not data_center_id:
        raise ValidationError({role: "必须选择数据中心"})
    data_center = DataCenter.objects.filter(pk=data_center_id, is_active=True).first()
    if not data_center:
        raise ValidationError({role: "数据中心不存在或已停用"})
    room = None
    if server_room_id:
        room = ServerRoom.objects.filter(
            pk=server_room_id,
            data_center_id=data_center.id,
            is_active=True,
        ).first()
        if not room:
            raise ValidationError({role: "机房不存在、已停用或不属于所选数据中心"})
    return data_center, room


def _locked_spare_stock(part, data_center, room):
    """Get or create one stock balance while the data-center row is locked."""
    stock = SpareStock.objects.select_for_update().filter(
        part=part,
        data_center=data_center,
        server_room=room,
    ).first()
    if stock:
        return stock
    return SpareStock.objects.create(
        part=part,
        data_center=data_center,
        server_room=room,
        quantity=0,
    )


def _validate_locked_spare_location(data_center, room, *, role):
    """Re-check a location after its rows have been locked.

    The initial validation happens before the location locks are acquired. A
    concurrent deactivation can therefore race with that read; validating the
    locked rows closes that window before a balance is changed.
    """
    if not data_center.is_active:
        raise ValidationError({role: "数据中心不存在或已停用"})
    if room and (not room.is_active or room.data_center_id != data_center.id):
        raise ValidationError({role: "机房不存在、已停用或不属于所选数据中心"})


@transaction.atomic
def apply_spare_stock_transaction(validated_data, operator):
    """Apply one immutable stock movement and return its ledger row.

    Data-center rows are locked in a stable order before balances are read so
    concurrent transfers cannot create negative or lost inventory.
    """
    operation_type = validated_data["operation_type"]
    part = SparePart.objects.select_for_update().filter(pk=validated_data["part"].pk).first()
    if part is None:
        raise ValidationError({"part": "备件不存在"})
    if not part.is_active:
        raise ValidationError({"part": "停用的备件不能进行库存操作"})

    source_dc_id = getattr(validated_data.get("source_data_center"), "pk", None)
    source_room_id = getattr(validated_data.get("source_server_room"), "pk", None)
    target_dc_id = getattr(validated_data.get("target_data_center"), "pk", None)
    target_room_id = getattr(validated_data.get("target_server_room"), "pk", None)

    if operation_type in {"outbound", "scrap", "transfer"}:
        source_dc, source_room = _spare_location(source_dc_id, source_room_id, role="source_data_center")
    else:
        source_dc = source_room = None
    if operation_type in {"inbound", "transfer", "adjustment"}:
        target_dc, target_room = _spare_location(
            target_dc_id,
            target_room_id,
            role="target_data_center",
        )
    else:
        target_dc = target_room = None

    if operation_type == "adjustment" and validated_data.get("target_quantity") is None:
        raise ValidationError({"target_quantity": "盘点调整必须填写调整后库存"})
    quantity = int(validated_data.get("quantity") or 0)
    if operation_type != "adjustment" and quantity <= 0:
        raise ValidationError({"quantity": "数量必须大于 0"})
    if operation_type == "adjustment" and int(validated_data["target_quantity"]) < 0:
        raise ValidationError({"target_quantity": "调整后库存不能小于 0"})
    if operation_type == "transfer" and (
        source_dc.id == target_dc.id and (source_room.id if source_room else None) == (target_room.id if target_room else None)
    ):
        raise ValidationError({"target_data_center": "调拨的来源和目标地点不能相同"})

    locations = []
    if source_dc:
        locations.append((source_dc, source_room))
    if target_dc:
        locations.append((target_dc, target_room))
    # Lock each data center once. This also serializes the nullable-room stock
    # lookup and avoids duplicate zero balances for central (room-less) stock.
    locked_centers = {}
    for center_id in sorted({center.id for center, _ in locations}):
        locked_centers[center_id] = DataCenter.objects.select_for_update().get(pk=center_id)
    if source_dc:
        source_dc = locked_centers[source_dc.id]
    if target_dc:
        target_dc = locked_centers[target_dc.id]

    # Lock rooms after data centers, matching the stable center -> room order.
    # This also serializes location deactivation with stock mutations.
    locked_rooms = {}
    for room_id in sorted({room.id for _, room in locations if room}):
        locked_rooms[room_id] = ServerRoom.objects.select_for_update().get(pk=room_id)
    if source_room:
        source_room = locked_rooms[source_room.id]
    if target_room:
        target_room = locked_rooms[target_room.id]

    if source_dc:
        _validate_locked_spare_location(source_dc, source_room, role="source_data_center")
    if target_dc:
        _validate_locked_spare_location(target_dc, target_room, role="target_data_center")

    source_stock = _locked_spare_stock(part, source_dc, source_room) if source_dc else None
    target_stock = _locked_spare_stock(part, target_dc, target_room) if target_dc else None
    if source_stock and operation_type in {"outbound", "scrap", "transfer"} and source_stock.quantity < quantity:
        source_label = source_dc.name if source_dc else "来源地点"
        if source_room:
            source_label = f"{source_label} / {source_room.name}"
        raise ValidationError({
            "quantity": f"备件“{part.name}”在{source_label}库存不足，当前仅有 {source_stock.quantity}{part.unit}，最多可操作 {source_stock.quantity}{part.unit}",
        })

    before_quantity = 0
    after_quantity = 0
    if operation_type == "inbound":
        before_quantity = target_stock.quantity
        target_stock.quantity += quantity
        target_stock.save(update_fields=["quantity", "updated_at"])
        after_quantity = target_stock.quantity
    elif operation_type in {"outbound", "scrap"}:
        before_quantity = source_stock.quantity
        source_stock.quantity -= quantity
        source_stock.save(update_fields=["quantity", "updated_at"])
        after_quantity = source_stock.quantity
    elif operation_type == "transfer":
        before_quantity = source_stock.quantity
        source_stock.quantity -= quantity
        target_stock.quantity += quantity
        source_stock.save(update_fields=["quantity", "updated_at"])
        target_stock.save(update_fields=["quantity", "updated_at"])
        after_quantity = source_stock.quantity
    else:
        before_quantity = target_stock.quantity
        after_quantity = int(validated_data["target_quantity"])
        if after_quantity == before_quantity:
            raise ValidationError({"target_quantity": "调整后库存与当前库存一致，无需调整"})
        target_stock.quantity = after_quantity
        target_stock.save(update_fields=["quantity", "updated_at"])
        quantity = abs(after_quantity - before_quantity)

    return SpareStockTransaction.objects.create(
        part=part,
        operation_type=operation_type,
        quantity=quantity,
        source_data_center=source_dc,
        source_server_room=source_room,
        target_data_center=target_dc,
        target_server_room=target_room,
        before_quantity=before_quantity,
        after_quantity=after_quantity,
        operator=operator,
        reference=str(validated_data.get("reference") or "").strip(),
        notes=str(validated_data.get("notes") or "").strip(),
    )
