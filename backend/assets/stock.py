"""Inventory writes: stock admission, balance locks, immutable facts and audit.

HTTP callers submit through record_stock_transaction / record_repair_part_usage;
initial balances use create_spare_part_with_stock. All mutations and their audits
commit together. Repair consumption acquires stock locations before asset locks.
"""
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError
from rest_framework.response import Response

from .models import DataCenter, FaultEvent, RepairRecord, RepairPartUsage, ServerRoom, SparePart, SpareStock, SpareStockTransaction
from .asset_retention import active_asset_for_update
from .data_scope import require_center, require_object, scope_for
from .organization_access import can
from .enum_contracts import SPARE_UNIT_LABELS, STOCK_OPERATION_TYPE_VALUES, STOCK_INBOUND_OPERATION_TYPES, STOCK_OUTBOUND_OPERATION_TYPES, STOCK_SOURCE_OPERATION_TYPES, STOCK_TARGET_OPERATION_TYPES
from .audit import repair_part_usage_audit_snapshot, spare_part_audit_snapshot, spare_stock_transaction_audit_snapshot, write_audit_log
from .idempotency import execute_once


def _user_display_name(user):
    return user.get_full_name().strip() or user.username


def validate_stock_movement(attrs, *, submitted_fields=None):
    operation_type = attrs.get("operation_type")
    if operation_type not in STOCK_OPERATION_TYPE_VALUES:
        raise ValidationError({"operation_type": "不支持的库存操作类型"})
    quantity = attrs.get("quantity", 0)
    if operation_type != "adjustment" and quantity <= 0:
        raise ValidationError({"quantity": "数量必须大于 0"})
    if operation_type == "adjustment":
        if "quantity" in (attrs if submitted_fields is None else submitted_fields):
            raise ValidationError({"quantity": "盘点调整请使用 adjustment_quantity"})
        adjustment_quantity = attrs.get("adjustment_quantity")
        if adjustment_quantity is None:
            raise ValidationError({"adjustment_quantity": "盘点调整必须填写调整数量"})
        if adjustment_quantity == 0:
            raise ValidationError({"adjustment_quantity": "调整数量不能为 0"})
    elif "adjustment_quantity" in attrs:
        raise ValidationError({"adjustment_quantity": "只有盘点调整支持调整数量"})
    if operation_type in STOCK_SOURCE_OPERATION_TYPES and not attrs.get("source_data_center"):
        raise ValidationError({"source_data_center": "必须选择来源数据中心"})
    if operation_type in STOCK_TARGET_OPERATION_TYPES and not attrs.get("target_data_center"):
        raise ValidationError({"target_data_center": "必须选择目标数据中心"})
    if operation_type == "transfer" and not attrs.get("target_data_center"):
        raise ValidationError({"target_data_center": "调拨必须选择目标数据中心"})
    return attrs


def validate_repair_usage(attrs):
    source = attrs["source"]
    stock = attrs.get("spare_stock")
    attrs["part_code"] = str(attrs.get("part_code") or "").strip()
    attrs["part_name"] = str(attrs.get("part_name") or "").strip()
    attrs["part_model"] = str(attrs.get("part_model") or "").strip()
    vendor_name = str(attrs.get("vendor_name") or "").strip()
    attrs["vendor_name"] = vendor_name
    attrs["notes"] = str(attrs.get("notes") or "").strip()

    if source == RepairPartUsage.INTERNAL_STOCK:
        if stock is None:
            raise DRFValidationError({"spare_stock_id": "内部库存用件必须选择明确的库存位置"})
        if vendor_name:
            raise DRFValidationError({"vendor_name": "内部库存用件不能填写厂商名称"})
        if attrs.get("spare_part") is not None and stock.part_id != attrs["spare_part"].pk:
            raise DRFValidationError({"spare_stock_id": "所选库存备件与部件不一致"})
        attrs["spare_part"] = stock.part
        if (
            not stock.data_center.is_active
            or (stock.server_room is not None and not stock.server_room.is_active)
        ):
            raise DRFValidationError({"spare_stock_id": "停用的数据中心或机房不能作为用件库存位置"})
    else:
        if stock is not None:
            raise DRFValidationError({"spare_stock_id": "厂商提供的用件不能关联内部库存"})
        if not attrs["part_name"]:
            raise DRFValidationError({"part_name": "厂商提供的用件必须填写部件名称"})
    return attrs


@transaction.atomic
def create_repair_part_usage(*, fault_id, validated_data, operator, request):
    """Record one immutable repair part usage and, when applicable, consume stock.

    Internal consumption locks part -> centers -> rooms -> balance before
    fault -> repair -> asset. Facility writes never have to wait for an asset
    held by a consumer waiting on their location. Completion is checked while
    fault/repair rows are locked, before any balance or usage is written.
    """
    validated_data = validate_repair_usage(dict(validated_data))
    source = validated_data["source"]
    if source not in dict(RepairPartUsage.SOURCE_CHOICES):
        raise DRFValidationError({"source": "不支持的维修用件来源"})
    if not can(operator, "faults.manage"):
        raise PermissionDenied("记录维修用件需要 faults.manage 权限")
    if source == RepairPartUsage.INTERNAL_STOCK and not can(operator, "spares.manage"):
        raise PermissionDenied("记录内部库存用件需要 spares.manage 权限")
    quantity = int(validated_data["quantity"])
    if quantity <= 0:
        raise DRFValidationError({"quantity": "数量必须大于 0"})

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
        if data_center is not None:
            require_center(data_center.pk, user=operator)
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
        require_object(stock, user=operator)
    elif validated_data.get("spare_stock") is not None:
        raise DRFValidationError({"spare_stock_id": "厂商提供的用件不能关联内部库存"})

    fault = FaultEvent.objects.select_for_update().get(pk=fault_id)
    repair = RepairRecord.objects.select_for_update().filter(fault_id=fault_id).order_by("-round_number").first()
    if "repair_id" in validated_data and validated_data["repair_id"] != (repair.pk if repair else None):
        from .repair_writes import RepairRoundConflict
        raise RepairRoundConflict()
    if (repair is not None and repair.finished_at is not None) or fault.is_closed:
        raise DRFValidationError({"detail": "已完成的故障不能新增维修用件"})
    asset = active_asset_for_update(fault.asset_id)
    require_object(asset, user=operator)
    if asset.status == "retired":
        raise DRFValidationError({"detail": "已报废资产不能新增维修用件"})

    if source == RepairPartUsage.INTERNAL_STOCK:
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

    from .repair_writes import begin_usage_round
    repair = repair or begin_usage_round(fault, request=request, actor=operator)
    usage = RepairPartUsage.objects.create(
        fault=fault,
        repair=repair,
        round_link="linked",
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
            request, actor=operator,
            action="create",
            resource_type="spare_stock_transaction",
            resource_id=stock_transaction.pk,
            after=spare_stock_transaction_audit_snapshot(stock_transaction),
            extra={
                "source": "repair_part_usage",
                "asset_id": asset.pk,
                "fault_id": fault.pk,
                "repair_part_usage_id": usage.pk,
                "repair_id": repair.pk,
                "round_number": repair.round_number,
            },
        )
    write_audit_log(
        request, actor=operator,
        action="create",
        resource_type="repair_part_usage",
        resource_id=usage.pk,
        after=repair_part_usage_audit_snapshot(usage),
        extra={
            "source": "repair_part_usage",
            "asset_id": asset.pk,
            "fault_id": fault.pk,
            "repair_id": repair.pk,
            "round_number": repair.round_number,
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
def apply_spare_stock_transaction(validated_data, operator, *, request=None, audit_context=None):
    """Apply one immutable stock movement and return its ledger row.

    Data-center rows are locked in a stable order before balances are read so
    concurrent transfers cannot create negative or lost inventory. When the
    caller supplies ``audit_context``, transfer-side quantities are populated
    from the locked balances before the transaction returns.
    """
    validate_stock_movement(validated_data)
    if not can(operator, "spares.manage"):
        raise PermissionDenied("库存写入需要 spares.manage 权限")
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
    for center, _ in locations:
        require_center(center.pk, user=operator)
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
    write_audit_log(
        request, actor=operator, action="create", resource_type="spare_stock_transaction",
        resource_id=transaction_row.pk,
        after=spare_stock_transaction_audit_snapshot(transaction_row, transfer_context=transfer_audit_context),
    )
    return transaction_row


def _movement_permissions(data, operator):
    if not can(operator, "spares.manage"):
        raise PermissionDenied("库存写入需要 spares.manage 权限")
    for field in ("source_data_center", "target_data_center"):
        center = data.get(field)
        if center is not None:
            require_center(center.pk, user=operator)


def record_stock_transaction(request, validated_data):
    """Submit an authorized HTTP movement, including its immutable receipt."""
    from .serializers import SpareStockTransactionSerializer
    _movement_permissions(validated_data, request.user)
    def mutation():
        try:
            row = apply_spare_stock_transaction(validated_data, request.user, request=request)
        except ValidationError as exc:
            raise DRFValidationError(getattr(exc, "message_dict", None) or {"detail": "; ".join(exc.messages)}) from exc
        return Response(SpareStockTransactionSerializer(row, context={"request": request}).data, status=201)
    return execute_once(request, mutation)


def record_repair_part_usage(request, *, fault, validated_data):
    """Authorize replay as well as a new consumption, then commit it once."""
    from .serializers import RepairPartUsageSerializer
    operator = request.user
    if not can(operator, "faults.manage"):
        raise PermissionDenied("记录维修用件需要 faults.manage 权限")
    if validated_data["source"] == RepairPartUsage.INTERNAL_STOCK and not can(operator, "spares.manage"):
        raise PermissionDenied("记录内部库存用件需要 spares.manage 权限")
    require_object(fault, user=operator)
    stock = validated_data.get("spare_stock")
    if stock is not None:
        require_object(stock, user=operator)
    def mutation():
        row = create_repair_part_usage(fault_id=fault.pk, validated_data=validated_data, operator=operator, request=request)
        return Response(RepairPartUsageSerializer(row, context={"request": request}).data, status=201)
    return execute_once(request, mutation)


@transaction.atomic
def create_spare_part_with_stock(*, validated_data, operator, request):
    """Create shared part metadata, its optional initial balance and both audits."""
    if not can(operator, "spares.manage") or not scope_for(operator).global_write:
        raise PermissionDenied("共有备件创建需要全局写入授权")
    data = dict(validated_data)
    quantity = data.pop("initial_quantity", 0)
    center = data.pop("initial_data_center", None)
    room = data.pop("initial_server_room", None)
    part = SparePart.objects.create(**data)
    write_audit_log(request, actor=operator, action="create", resource_type="spare_part", resource_id=part.pk, after=spare_part_audit_snapshot(part))
    if quantity > 0:
        try:
            apply_spare_stock_transaction({"part": part, "operation_type": "initial", "quantity": quantity,
                "target_data_center": center, "target_server_room": room,
                "reference": "初始库存", "notes": "新增备件时登记的初始库存"}, operator, request=request)
        except ValidationError as exc:
            raise DRFValidationError(getattr(exc, "message_dict", None) or {"detail": "; ".join(exc.messages)}) from exc
    return part
