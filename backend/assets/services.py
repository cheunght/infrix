from datetime import date
from decimal import Decimal, InvalidOperation
from ipaddress import ip_address

from django.core.exceptions import ValidationError
from django.core.validators import DecimalValidator
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.contrib.auth.models import User
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError
from django.utils import timezone

from .models import (
    Asset,
    AssetCustomValue,
    AssetNetworkAddress,
    AssetAssignmentEvent,
    Person,
    AssetTag,
    CustomField,
    DataCenter,
    FaultEvent,
    InventoryItem,
    InventoryTask,
    MaintenanceContract,
    normalize_network_address,
    ProcurementRecord,
    Rack,
    RackUnitAllocation,
    RepairPartUsage,
    RepairRecord,
    ServerRoom,
    SparePart,
    SpareStock,
    SpareStockTransaction,
    Tag,
)
from .enum_contracts import (
    ASSET_STATUS_VALUES,
    INVENTORY_EXCEPTION_STATUS_VALUES,
    INVENTORY_RESOLUTION_ACTION_VALUES,
    SPARE_UNIT_LABELS,
    STOCK_INBOUND_OPERATION_TYPES,
    STOCK_OUTBOUND_OPERATION_TYPES,
    STOCK_SOURCE_OPERATION_TYPES,
    STOCK_TARGET_OPERATION_TYPES,
)
from .custom_fields import (
    custom_field_storage_payload,
    custom_field_value_is_empty,
    validate_custom_field_value,
)
from .lifecycle import (
    ASSET_REPAIR_RESTORE_STATUS_VALUES,
    transition_asset_status,
)
from .roles import user_has_capability


def _value(data, key):
    value = data.get(key)
    return str(value).strip() if value is not None else ""


NETWORK_CONFIGURATION_FIELDS = (
    ("business", "business_ip"),
    ("management", "management_ip"),
    ("oob", "oob_ip"),
)


def _network_address_kind(address):
    return "IPv4" if ip_address(address).version == 4 else "IPv6"


def _network_address_duplicate_message(address, *, same_asset=False):
    kind = _network_address_kind(address)
    if same_asset:
        return f"{kind} 地址不能在同一资产的多个网络角色中重复"
    return f"{kind} 地址已被其他资产使用"


def _validated_network_configuration(asset, data):
    """Normalize all submitted IPs and reject duplicate current addresses."""
    entries = []
    seen = {}
    for role, key in NETWORK_CONFIGURATION_FIELDS:
        raw_address = _value(data, key)
        if not raw_address:
            continue
        try:
            address = normalize_network_address(raw_address)
        except ValidationError as exc:
            raise ValidationError({key: "IP 地址格式不正确"}) from exc

        previous_key = seen.get(address)
        if previous_key:
            raise ValidationError({
                key: _network_address_duplicate_message(address, same_asset=True),
            })

        current_id = (
            AssetNetworkAddress.objects.filter(asset_id=asset.pk, role=role)
            .values_list("pk", flat=True)
            .first()
        )
        conflicts = AssetNetworkAddress.objects.filter(address=address)
        if current_id is not None:
            conflicts = conflicts.exclude(pk=current_id)
        conflict = conflicts.select_related("asset").first()
        if conflict:
            raise ValidationError({
                key: _network_address_duplicate_message(
                    address,
                    same_asset=conflict.asset_id == asset.pk,
                ),
            })

        seen[address] = key
        entries.append((role, key, address))
    return entries


def _merge_current_supporting_configuration(asset, data):
    """Preserve omitted supporting fields during a non-empty partial update.

    ``configuration`` is a JSON object nested inside an Asset PATCH/PUT.  A
    caller may update just one supporting field, so only keys that are
    actually present can express a replacement or clear operation.  The
    frontend still sends a complete snapshot, which keeps its explicit blank
    values as clear instructions.
    """
    if not isinstance(data, dict) or not data:
        return data

    merged = dict(data)
    current_network = {
        item.role: item.address
        for item in AssetNetworkAddress.objects.filter(asset_id=asset.pk)
    }
    for role, key in NETWORK_CONFIGURATION_FIELDS:
        if role in current_network:
            merged.setdefault(key, current_network[role])

    procurement = asset.procurement_records.order_by("-purchase_date", "-id").first()
    if procurement is not None:
        for key, value in (
            ("purchase_date", procurement.purchase_date),
            ("supplier", procurement.supplier),
            ("purchase_order_no", procurement.order_no),
            ("purchase_amount", procurement.amount),
            ("procurement_notes", procurement.notes),
        ):
            merged.setdefault(key, value)

    maintenance = asset.maintenance_contracts.order_by("-updated_at", "-id").first()
    if maintenance is not None:
        for key, value in (
            ("maintenance_provider", maintenance.provider),
            ("maintenance_contract_no", maintenance.contract_no),
            ("maintenance_start_date", maintenance.start_date),
            ("maintenance_expiry_date", maintenance.expiry_date),
            ("maintenance_notes", maintenance.notes),
        ):
            merged.setdefault(key, value)
    return merged


def _optional_date(data, key):
    value = _value(data, key)
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError({key: "日期格式应为 YYYY-MM-DD"}) from exc


INVENTORY_EXCEPTION_STATUSES = frozenset(INVENTORY_EXCEPTION_STATUS_VALUES)


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

    task_id = InventoryItem.objects.filter(pk=item_id).values_list("task_id", flat=True).first()
    if task_id is None:
        raise InventoryItem.DoesNotExist
    task = InventoryTask.objects.select_for_update().get(pk=task_id)
    item = InventoryItem.objects.select_for_update().select_related(
        "asset",
        "checked_by",
        "resolved_by",
        "actual_rack__room__data_center",
    ).get(pk=item_id)
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
    if action not in INVENTORY_RESOLUTION_ACTION_VALUES:
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

    task_id = InventoryItem.objects.filter(pk=item_id).values_list("task_id", flat=True).first()
    if task_id is None:
        raise InventoryItem.DoesNotExist
    task = InventoryTask.objects.select_for_update().get(pk=task_id)
    item = InventoryItem.objects.select_for_update().select_related(
        "asset",
        "checked_by",
        "resolved_by",
        "actual_rack__room__data_center",
    ).get(pk=item_id)
    asset = Asset.objects.select_for_update().get(pk=item.asset_id)

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
    # A retired asset may still contain a legacy allocation that needs a
    # corrective unmount through ``configure_asset``.  It must not be mounted
    # or moved, however.  Check this before taking the rack lock so a retired
    # placement request cannot deadlock with the normal rack -> allocation ->
    # asset lock order used below.
    current_status = Asset.objects.filter(pk=asset.pk).values_list("status", flat=True).first()
    if current_status == "retired":
        locked_asset = Asset.objects.select_for_update().get(pk=asset.pk)
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

    rack = Rack.objects.select_related("room__data_center").select_for_update().get(pk=rack.pk)
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

    # Lock all allocations in the target rack before checking for overlap.
    list(RackUnitAllocation.objects.select_for_update().filter(rack=rack))
    # Keep this as a locking read as well as locking the parent rack.  On
    # MySQL's default REPEATABLE READ isolation, a plain SELECT could reuse a
    # snapshot taken before another placement committed while this transaction
    # was waiting for the rack row lock.
    conflicts = RackUnitAllocation.objects.select_for_update().select_related("asset").filter(
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

    locked_asset = Asset.objects.select_for_update().get(pk=asset.pk)
    if locked_asset.status == "retired":
        allocation = RackUnitAllocation.objects.select_for_update().filter(asset=locked_asset).first()
        if allocation and (
            allocation.rack_id == rack.pk
            and allocation.start_u == start_u
            and allocation.end_u == end_u
        ):
            return False
        raise ValidationError({
            "configuration": "已报废资产不能新增或调整机柜位置，请先保持下架",
        })

    allocation = RackUnitAllocation.objects.select_for_update().filter(asset=locked_asset).first()
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
        asset.asset_data_center_id = locked_asset.asset_data_center_id
        changed = True
    return changed


@transaction.atomic
def synchronize_asset_location_hierarchy(*, rack_ids, data_center_id) -> int:
    """Keep the persisted data-center copy aligned with mounted rack ancestry.

    Rack/room edits are correction operations, not asset moves.  The rack and
    allocation rows are locked by their caller (and locked again here for
    direct service use) before the affected assets are updated.  This follows
    the rack -> allocation -> asset lock order used by placement writes.
    """
    rack_ids = tuple(rack_ids)
    if not rack_ids:
        return 0

    list(
        RackUnitAllocation.objects.select_for_update()
        .filter(rack_id__in=rack_ids)
        .order_by("asset_id")
    )
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


def _assignment_error(code, message):
    raise DRFValidationError({"code": code, "detail": message})


def _user_display_name(user):
    if user is None:
        return ""
    return user.get_full_name().strip() or user.username


def _person_display_name(person):
    if person is None:
        return ""
    return person.display_name()


def _person_snapshot(person):
    if person is None:
        return {
            "employee_no": "",
            "name": "",
            "department": "",
            "organization": "",
            "contact": "",
        }
    return {
        "employee_no": person.employee_no or "",
        "name": _person_display_name(person),
        "department": person.department.name if person.department_id and person.department else "",
        "organization": person.organization or "",
        "contact": person.contact or "",
    }


def _locked_person(person_id):
    if person_id in (None, ""):
        _assignment_error("assignment_target_required", "必须选择使用人")
    try:
        person = Person.objects.select_for_update().select_related("department").get(pk=person_id)
    except (Person.DoesNotExist, TypeError, ValueError) as exc:
        raise DRFValidationError({"code": "assignment_target_not_found", "detail": "使用人不存在"}) from exc
    if not person.is_active:
        _assignment_error("assignment_target_inactive", "停用人员不能被指定为资产使用人")
    return person


def _apply_assignment_status(asset, target_status):
    if target_status is None or asset.status == target_status:
        return False
    try:
        return transition_asset_status(asset, target_status, source="direct")
    except ValidationError as exc:
        message_dict = getattr(exc, "message_dict", None)
        message = "；".join(
            str(value)
            for values in (message_dict or {"status": exc.messages}).values()
            for value in (values if isinstance(values, (list, tuple)) else [values])
        )
        raise DRFValidationError({
            "code": "asset_status_transition_blocked",
            "detail": message or "资产状态不允许随使用人动作变更",
        }) from exc


@transaction.atomic
def _change_asset_assignment(*, asset_id, action, target_person_id=None, actor, request, reason=""):
    from .audit import asset_audit_snapshot, write_audit_log

    asset = Asset.objects.select_for_update().select_related("assigned_person__department").get(pk=asset_id)
    if asset.status == "retired" and action in {"assign", "transfer"}:
        _assignment_error("asset_retired", "已报废资产不能指定或转交使用人")
    if asset.status == "repair":
        _assignment_error("asset_in_repair", "维修中资产由故障维修流程维护，不能执行使用人操作")
    if FaultEvent.objects.filter(asset_id=asset.pk, is_closed=False).exists():
        _assignment_error("asset_has_open_fault", "存在未关闭故障时，资产使用关系由维修流程维护")

    current_person = asset.assigned_person
    target_person = None
    target_status = None
    if action == "assign":
        if current_person is not None:
            _assignment_error("asset_already_assigned", "资产已有使用人，请使用转交使用人操作")
        target_person = _locked_person(target_person_id)
        target_status = "in_use" if asset.status != "in_use" else None
    elif action == "return":
        if current_person is None:
            _assignment_error("asset_not_assigned", "资产当前没有使用人，不能归还")
        # Keep retired terminal while allowing legacy inconsistent data to be
        # corrected by clearing its current assignee and recording the return.
        target_status = None if asset.status == "retired" else "in_stock"
    elif action == "transfer":
        if current_person is None:
            _assignment_error("asset_not_assigned", "资产当前没有使用人，不能转交")
        target_person = _locked_person(target_person_id)
        if target_person.pk == current_person.pk:
            _assignment_error("same_assignee", "转交目标不能与当前使用人相同")
        # A transfer changes only the person and the history.  In particular,
        # an asset in idle/in_stock/repair-compatible legacy state keeps its
        # exact current status.
    else:
        raise ValueError(f"unsupported assignment action: {action}")

    before = asset_audit_snapshot(asset.pk)
    status_changed = _apply_assignment_status(asset, target_status)
    from_person = current_person if action in {"return", "transfer"} else None
    to_person = target_person if action in {"assign", "transfer"} else None
    asset.assigned_person = to_person
    update_fields = ["assigned_person", "updated_at"]
    if status_changed:
        update_fields.append("status")
    asset.save(update_fields=update_fields)

    from_snapshot = _person_snapshot(from_person)
    to_snapshot = _person_snapshot(to_person)
    event = AssetAssignmentEvent.objects.create(
        asset=asset,
        action=action,
        from_person=from_person,
        from_person_employee_no=from_snapshot["employee_no"],
        from_person_name=from_snapshot["name"],
        from_person_department=from_snapshot["department"],
        from_person_organization=from_snapshot["organization"],
        from_person_contact=from_snapshot["contact"],
        to_person=to_person,
        to_person_employee_no=to_snapshot["employee_no"],
        to_person_name=to_snapshot["name"],
        to_person_department=to_snapshot["department"],
        to_person_organization=to_snapshot["organization"],
        to_person_contact=to_snapshot["contact"],
        operator=actor,
        operator_name=_user_display_name(actor),
        reason=str(reason or "").strip(),
    )
    after = asset_audit_snapshot(asset.pk)
    write_audit_log(
        request,
        action=action,
        resource_type="asset",
        resource_id=asset.pk,
        before=before,
        after=after,
        extra={
            "source": "asset_assignment",
            "assignment_event_id": event.pk,
            "from_person": from_person.pk if from_person else None,
            "to_person": to_person.pk if to_person else None,
            "operator": actor.pk if actor else None,
            "reason": event.reason,
            "occurred_at": event.created_at,
        },
    )
    return asset, event


def assign_asset(*, asset_id, target_person_id, actor, request, reason=""):
    return _change_asset_assignment(
        asset_id=asset_id,
        action="assign",
        target_person_id=target_person_id,
        actor=actor,
        request=request,
        reason=reason,
    )


def return_asset(*, asset_id, actor, request, reason=""):
    return _change_asset_assignment(
        asset_id=asset_id,
        action="return",
        actor=actor,
        request=request,
        reason=reason,
    )


def transfer_asset(*, asset_id, target_person_id, actor, request, reason=""):
    return _change_asset_assignment(
        asset_id=asset_id,
        action="transfer",
        target_person_id=target_person_id,
        actor=actor,
        request=request,
        reason=reason,
    )

@transaction.atomic
def configure_asset(asset: Asset, data):
    """Apply rack, IP, procurement and maintenance details for an asset.

    A non-empty configuration is partial-update safe: omitted supporting
    fields are filled from the current snapshot, while submitted blank values
    remain explicit clear instructions.  An empty configuration intentionally
    clears the non-placement supporting records; placement keeps its existing
    partial-configuration compatibility rule in the serializer.
    """
    data = _merge_current_supporting_configuration(asset, data or {})
    network_entries = _validated_network_configuration(asset, data)
    data_center_value = _value(data, "data_center")
    room_id = _value(data, "server_room_id")
    rack_id = _value(data, "rack_id")
    # ``rack_total_u`` is a display-only value supplied by the form.  It is
    # intentionally not part of the completeness check, otherwise a new
    # non-rack-mounted asset (whose default capacity is 45) would be treated
    # as a partially configured rack placement.
    start_u_value = _value(data, "rack_start_u")
    end_u_value = _value(data, "rack_end_u")
    location_values = [data_center_value, room_id, rack_id, start_u_value, end_u_value]
    if any(location_values):
        if not all(location_values):
            missing = [
                label
                for label, value in (
                    ("数据中心", data_center_value),
                    ("机房", room_id),
                    ("机柜", rack_id),
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
        try:
            data_center = DataCenter.objects.filter(pk=int(data_center_value)).first()
        except (TypeError, ValueError):
            data_center = None
        if not data_center:
            raise ValidationError({"data_center": "数据中心必须从数据字典中选择"})
        if not data_center.is_active:
            raise ValidationError({"data_center": "停用的数据中心不能用于资产"})
        try:
            room = ServerRoom.objects.filter(pk=int(room_id), data_center=data_center).first()
        except (TypeError, ValueError):
            room = None
        if not room:
            raise ValidationError({"server_room_id": "未找到所选机房，请先在机房机柜维护中创建"})
        if not room.is_active:
            raise ValidationError({"server_room_id": "停用的机房不能用于资产"})
        try:
            rack = Rack.objects.filter(pk=int(rack_id), room=room).first()
        except (TypeError, ValueError):
            rack = None
        if not rack:
            raise ValidationError({"rack_id": "未找到所选机柜，请先在机房机柜维护中创建"})
        if not rack.is_active or getattr(rack, "status", "in_use") != "in_use":
            raise ValidationError({"rack_id": "预留或停用的机柜不能用于资产"})
        update_asset_placement(asset, rack=rack, start_u=start_u, end_u=end_u)
    else:
        RackUnitAllocation.objects.filter(asset=asset).delete()

    submitted_network_roles = {role for role, _key, _address in network_entries}
    for role, _key in NETWORK_CONFIGURATION_FIELDS:
        if role not in submitted_network_roles:
            AssetNetworkAddress.objects.filter(asset=asset, role=role).delete()

    for role, key, address in network_entries:
        try:
            with transaction.atomic():
                AssetNetworkAddress.objects.update_or_create(
                    asset=asset,
                    role=role,
                    defaults={"address": address, "is_primary": True},
                )
        except IntegrityError as exc:
            raise ValidationError({
                key: _network_address_duplicate_message(address),
            }) from exc

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
            except (InvalidOperation, TypeError, ValueError) as exc:
                raise ValidationError({"purchase_amount": "采购金额格式不正确"}) from exc
            if not amount.is_finite():
                raise ValidationError({"purchase_amount": "采购金额必须是有限数字"})
            if amount < 0:
                raise ValidationError({"purchase_amount": "采购金额不能小于 0"})
            try:
                DecimalValidator(max_digits=14, decimal_places=2)(amount)
            except ValidationError as exc:
                raise ValidationError({"purchase_amount": "采购金额最多支持 2 位小数，且总位数不能超过 14 位"}) from exc
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


def _existing_inactive_option_values(field, value):
    """Return disabled option values already stored on this asset.

    A disabled option remains readable and may be retained by an edit, but it
    must not become a way to add that option to a different asset or replace
    an asset's current value with a new disabled value.
    """
    if field.field_type == "select":
        candidates = {value} if isinstance(value, str) and value else set()
    elif field.field_type == "multiselect":
        candidates = {
            item for item in value
            if isinstance(item, str)
        } if isinstance(value, list) else set()
    else:
        return set()
    if not candidates:
        return set()
    return {
        option.value
        for option in field.options.all()
        if not option.is_active and option.value in candidates
    }


def apply_asset_custom_values(asset: Asset, values, *, submitted=True):
    """Validate and persist values for the asset's current device type."""
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

    # A device type change starts a new current-field set. Values scoped to
    # another device type are not part of that set and are removed.
    AssetCustomValue.objects.filter(asset=asset).exclude(
        Q(field__device_type__isnull=True) | Q(field__device_type_id=asset.device_type_id)
    ).delete()

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
        if custom_field_value_is_empty(candidate, field.field_type):
            missing.append(field.name)
    if missing:
        raise ValidationError({"custom_values": f"必填自定义字段未填写：{'、'.join(missing)}"})

    operations = []
    for key, raw in values.items():
        field = by_key[key]
        if not field.is_active:
            raise ValidationError({f"custom_values.{key}": "该字段已停用，不能修改"})
        if custom_field_value_is_empty(raw, field.field_type):
            operations.append((field, None))
            continue

        try:
            normalized = validate_custom_field_value(
                field,
                raw,
                allowed_inactive_options=_existing_inactive_option_values(
                    field,
                    existing_values.get(field.id),
                ),
            )
            payload = custom_field_storage_payload(field, normalized)
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


REPAIR_RESTORE_STATUSES = ASSET_REPAIR_RESTORE_STATUS_VALUES


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
        if asset.status == "retired":
            raise DRFValidationError({
                "code": "asset_retired",
                "detail": "已报废资产不能新建或重开未关闭故障",
            })
        if asset.status != "repair":
            if not other_open_fault and asset.status_before_repair is None and asset.status in REPAIR_RESTORE_STATUSES:
                asset.status_before_repair = asset.status
                update_fields.append("status_before_repair")
            if transition_asset_status(asset, "repair", source="fault"):
                update_fields.append("status")
    elif asset.status == "repair":
        if asset.status_before_repair in REPAIR_RESTORE_STATUSES:
            if transition_asset_status(asset, asset.status_before_repair, source="fault"):
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


@transaction.atomic
def reopen_repair(*, repair_id: int, request=None):
    """Reopen one finished repair without deleting its historical record."""
    from .audit import model_snapshot, write_audit_log

    repair = RepairRecord.objects.select_for_update().get(pk=repair_id)
    if repair.finished_at is None:
        raise DRFValidationError({
            "detail": "未完成的维修不能重新打开。",
            "code": "repair_not_finished",
        })

    before = model_snapshot(repair)
    repair.finished_at = None
    repair.save(update_fields=["finished_at", "updated_at"])
    after = model_snapshot(repair)
    if request is not None:
        write_audit_log(
            request,
            action="reopen",
            resource_type="repair_record",
            resource_id=repair.pk,
            before=before,
            after=after,
            extra={"source": "repair_record_action", "fault_id": repair.fault_id},
        )

    # Keep the existing completion service as the single Fault/Asset lifecycle
    # writer. It also enforces the retired-asset and multiple-open-fault rules.
    sync_repair_completion(repair, request=request)
    return repair


@transaction.atomic
def create_repair_part_usage(*, fault_id, validated_data, operator, request):
    """Record one immutable repair part usage and, when applicable, consume stock.

    Permission is checked before any row lock. The repair row is then locked
    before the fault row so completion and usage paths share one lock order;
    the completion timestamp is checked directly while both lifecycle rows are
    protected. Internal stock uses the same part -> location -> balance lock
    order as the stock movement service.
    """
    from .audit import repair_part_usage_audit_snapshot, spare_stock_transaction_audit_snapshot, write_audit_log
    from .serializers import RepairPartUsageSerializer

    source = validated_data["source"]
    if source not in dict(RepairPartUsage.SOURCE_CHOICES):
        raise DRFValidationError({"source": "不支持的维修用件来源"})
    if not user_has_capability(operator, "faults.manage"):
        raise PermissionDenied("记录维修用件需要 faults.manage 权限")
    if source == RepairPartUsage.INTERNAL_STOCK and not user_has_capability(operator, "spares.manage"):
        raise PermissionDenied("记录内部库存用件需要 spares.manage 权限")
    quantity = int(validated_data["quantity"])
    if quantity <= 0:
        raise DRFValidationError({"quantity": "数量必须大于 0"})

    repair = RepairRecord.objects.select_for_update().filter(fault_id=fault_id).first()
    fault = FaultEvent.objects.select_for_update().get(pk=fault_id)
    if (repair is not None and repair.finished_at is not None) or fault.is_closed:
        raise DRFValidationError({"detail": "已完成的故障不能新增维修用件"})
    asset = Asset.objects.select_for_update().get(pk=fault.asset_id)
    if asset.status == "retired":
        raise DRFValidationError({"detail": "已报废资产不能新增维修用件"})

    part = None
    if validated_data.get("spare_part") is not None:
        part_id = validated_data["spare_part"].pk
        part = SparePart.objects.select_for_update().filter(pk=part_id).first()
        if part is None:
            raise DRFValidationError({"spare_part_id": "备件不存在"})

    stock = None
    stock_transaction = None
    before_quantity = None
    after_quantity = None
    if source == RepairPartUsage.INTERNAL_STOCK:
        if part is None:
            raise DRFValidationError({"spare_part_id": "内部库存用件必须选择系统备件"})
        selected_stock = validated_data.get("spare_stock")
        if selected_stock is None:
            raise DRFValidationError({"spare_stock_id": "内部库存用件必须选择明确的库存位置"})
        if selected_stock.part_id != part.pk:
            raise DRFValidationError({"spare_stock_id": "所选库存备件与部件不一致"})

        locked_stock_meta = SpareStock.objects.filter(pk=selected_stock.pk).values(
            "part_id", "data_center_id", "server_room_id"
        ).first()
        if locked_stock_meta is None:
            raise DRFValidationError({"spare_stock_id": "库存记录不存在"})
        data_center = DataCenter.objects.select_for_update().filter(
            pk=locked_stock_meta["data_center_id"]
        ).first()
        if data_center is None or not data_center.is_active:
            raise DRFValidationError({"spare_stock_id": "库存所在数据中心不存在或已停用"})
        server_room = None
        if locked_stock_meta["server_room_id"] is not None:
            server_room = ServerRoom.objects.select_for_update().filter(
                pk=locked_stock_meta["server_room_id"],
                data_center_id=data_center.pk,
            ).first()
            if server_room is None or not server_room.is_active:
                raise DRFValidationError({"spare_stock_id": "库存所在机房不存在或已停用"})

        stock = SpareStock.objects.select_for_update().select_related(
            "part", "data_center", "server_room"
        ).filter(pk=selected_stock.pk).first()
        if stock is None:
            raise DRFValidationError({"spare_stock_id": "库存记录不存在"})
        if stock.part_id != part.pk:
            raise DRFValidationError({"spare_stock_id": "所选库存备件与部件不一致"})
        if stock.quantity < quantity:
            raise DRFValidationError({
                "quantity": f"备件“{part.name}”库存不足，当前仅有 {stock.quantity}，最多可用 {stock.quantity}",
            })

        before_quantity = stock.quantity
        stock.quantity -= quantity
        stock.save(update_fields=["quantity", "updated_at"])
        after_quantity = stock.quantity
        stock_transaction = SpareStockTransaction.objects.create(
            part=part,
            operation_type="outbound",
            quantity=quantity,
            quantity_delta=-quantity,
            source_data_center=stock.data_center,
            source_server_room=stock.server_room,
            before_quantity=before_quantity,
            after_quantity=after_quantity,
            operator=operator,
            reference=f"fault:{fault.pk}",
            notes=str(validated_data.get("notes") or "").strip(),
        )
    elif validated_data.get("spare_stock") is not None:
        raise DRFValidationError({"spare_stock_id": "厂商提供的用件不能关联内部库存"})

    if source == RepairPartUsage.VENDOR_PROVIDED:
        part_name = str(validated_data.get("part_name") or "").strip()
        if not part_name:
            raise DRFValidationError({"part_name": "厂商提供的用件必须填写部件名称"})
        part_code = str(validated_data.get("part_code") or "").strip()
        part_model = str(validated_data.get("part_model") or "").strip()
        part_unit = part.unit if part is not None else ""
    else:
        part_code = part.code
        part_name = part.name
        part_model = part.model
        part_unit = part.unit

    usage = RepairPartUsage.objects.create(
        fault=fault,
        source=source,
        spare_part=part,
        spare_stock=stock,
        part_code=part_code,
        part_name=part_name,
        part_model=part_model,
        part_unit=part_unit,
        vendor_name=str(validated_data.get("vendor_name") or "").strip(),
        stock_data_center_name=stock.data_center.name if stock else "",
        stock_server_room_name=stock.server_room.name if stock and stock.server_room else "",
        quantity=quantity,
        operator=operator,
        operator_name=_user_display_name(operator),
        notes=str(validated_data.get("notes") or "").strip(),
    )

    if stock_transaction is not None:
        write_audit_log(
            request,
            action="create",
            resource_type="spare_stock_transaction",
            resource_id=stock_transaction.pk,
            after=spare_stock_transaction_audit_snapshot(stock_transaction),
            extra={
                "source": "repair_part_usage",
                "fault_id": fault.pk,
                "repair_part_usage_id": usage.pk,
            },
        )
    write_audit_log(
        request,
        action="create",
        resource_type="repair_part_usage",
        resource_id=usage.pk,
        after=repair_part_usage_audit_snapshot(usage),
        extra={
            "source": "repair_part_usage",
            "fault_id": fault.pk,
            "stock_before_quantity": before_quantity,
            "stock_after_quantity": after_quantity,
        },
    )
    return usage


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
def apply_spare_stock_transaction(validated_data, operator, *, audit_context=None):
    """Apply one immutable stock movement and return its ledger row.

    Data-center rows are locked in a stable order before balances are read so
    concurrent transfers cannot create negative or lost inventory. When the
    caller supplies ``audit_context``, transfer-side quantities are populated
    from the locked balances before the transaction returns.
    """
    operation_type = validated_data["operation_type"]
    part = SparePart.objects.select_for_update().filter(pk=validated_data["part"].pk).first()
    if part is None:
        raise ValidationError({"part": "备件不存在"})

    source_dc_id = getattr(validated_data.get("source_data_center"), "pk", None)
    source_room_id = getattr(validated_data.get("source_server_room"), "pk", None)
    target_dc_id = getattr(validated_data.get("target_data_center"), "pk", None)
    target_room_id = getattr(validated_data.get("target_server_room"), "pk", None)

    if operation_type in STOCK_SOURCE_OPERATION_TYPES:
        source_dc, source_room = _spare_location(source_dc_id, source_room_id, role="source_data_center")
    else:
        source_dc = source_room = None
    if operation_type in STOCK_TARGET_OPERATION_TYPES:
        target_dc, target_room = _spare_location(
            target_dc_id,
            target_room_id,
            role="target_data_center",
        )
    else:
        target_dc = target_room = None

    adjustment_quantity = validated_data.get("adjustment_quantity")
    if operation_type == "adjustment" and adjustment_quantity is None:
        raise ValidationError({"adjustment_quantity": "盘点调整必须填写调整数量"})
    quantity = int(validated_data.get("quantity") or 0)
    if operation_type != "adjustment" and quantity <= 0:
        raise ValidationError({"quantity": "数量必须大于 0"})
    if operation_type == "adjustment" and int(adjustment_quantity) == 0:
        raise ValidationError({"adjustment_quantity": "调整数量不能为 0"})
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
    if source_stock and operation_type in STOCK_SOURCE_OPERATION_TYPES and source_stock.quantity < quantity:
        source_label = source_dc.name if source_dc else "来源地点"
        if source_room:
            source_label = f"{source_label} / {source_room.name}"
        raise ValidationError({
            "quantity": f"备件“{part.name}”在{source_label}库存不足，当前仅有 {source_stock.quantity}{SPARE_UNIT_LABELS.get(part.unit, part.unit)}，最多可操作 {source_stock.quantity}{SPARE_UNIT_LABELS.get(part.unit, part.unit)}",
        })

    before_quantity = 0
    after_quantity = 0
    quantity_delta = 0
    transfer_audit_context = None
    if operation_type in STOCK_INBOUND_OPERATION_TYPES:
        before_quantity = target_stock.quantity
        target_stock.quantity += quantity
        target_stock.save(update_fields=["quantity", "updated_at"])
        after_quantity = target_stock.quantity
        quantity_delta = quantity
    elif operation_type in STOCK_OUTBOUND_OPERATION_TYPES:
        before_quantity = source_stock.quantity
        source_stock.quantity -= quantity
        source_stock.save(update_fields=["quantity", "updated_at"])
        after_quantity = source_stock.quantity
        quantity_delta = -quantity
    elif operation_type == "transfer":
        before_quantity = source_stock.quantity
        target_before_quantity = target_stock.quantity
        source_stock.quantity -= quantity
        target_stock.quantity += quantity
        source_stock.save(update_fields=["quantity", "updated_at"])
        target_stock.save(update_fields=["quantity", "updated_at"])
        after_quantity = source_stock.quantity
        quantity_delta = -quantity
        transfer_audit_context = {
            "transfer_quantity": quantity,
            "source_before_quantity": before_quantity,
            "source_after_quantity": after_quantity,
            "target_before_quantity": target_before_quantity,
            "target_after_quantity": target_stock.quantity,
        }
    else:
        before_quantity = target_stock.quantity
        after_quantity = before_quantity + int(adjustment_quantity)
        if after_quantity < 0:
            raise ValidationError({"adjustment_quantity": "调整后库存不能小于 0"})
        target_stock.quantity = after_quantity
        target_stock.save(update_fields=["quantity", "updated_at"])
        quantity = abs(int(adjustment_quantity))
        quantity_delta = int(adjustment_quantity)

    transaction_row = SpareStockTransaction.objects.create(
        part=part,
        operation_type=operation_type,
        quantity=quantity,
        quantity_delta=quantity_delta,
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
    if audit_context is not None and transfer_audit_context is not None:
        audit_context.update(transfer_audit_context)
    return transaction_row
