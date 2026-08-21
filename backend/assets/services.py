from datetime import date
from decimal import Decimal, InvalidOperation
from ipaddress import ip_address

from django.core.exceptions import ValidationError
from django.db import transaction

from .models import (
    Asset,
    AssetCustomValue,
    AssetNetworkAddress,
    AssetTag,
    CustomField,
    DataCenter,
    FaultEvent,
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
        rack = Rack.objects.select_for_update().get(pk=rack.pk)
        list(RackUnitAllocation.objects.select_for_update().filter(rack=rack))
        if start_u < 1 or end_u < 1:
            raise ValidationError({"rack_start_u": "U 位必须大于等于 1"})
        if end_u > rack.total_u:
            raise ValidationError({"rack_end_u": f"结束 U 位不能超过机柜容量 U{rack.total_u}"})
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
        allocation, _ = RackUnitAllocation.objects.get_or_create(asset=asset, defaults={"rack": rack, "start_u": start_u, "end_u": end_u})
        allocation.rack, allocation.start_u, allocation.end_u = rack, start_u, end_u
        allocation.full_clean()
        allocation.save()
        # Keep the optional administrative data-center association aligned with
        # the physical rack while the asset is mounted.  It remains available
        # for inventory scoping after the asset is later unmounted.
        if asset.asset_data_center_id != data_center.id:
            asset.asset_data_center_id = data_center.id
            asset.save(update_fields=["asset_data_center", "updated_at"])
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
    if value is None:
        return True
    if field_type in {"text", "textarea", "date", "select"}:
        return str(value).strip() == ""
    if field_type == "multiselect":
        return not value
    return False


def _custom_date(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError("日期格式应为 YYYY-MM-DD") from exc


def apply_asset_custom_values(asset: Asset, values, *, submitted=True, is_create=False, old_device_type_id=None):
    """Validate and persist dynamic values for the asset's current device type."""
    values = values or {}
    if not isinstance(values, dict):
        raise ValidationError({"custom_values": "自定义字段值必须是对象"})

    if old_device_type_id and old_device_type_id != asset.device_type_id:
        AssetCustomValue.objects.filter(asset=asset).delete()

    fields = list(
        CustomField.objects.filter(device_type_id=asset.device_type_id)
        .prefetch_related("options")
        if asset.device_type_id
        else []
    )
    by_key = {field.key: field for field in fields}
    if values:
        unknown = [key for key in values if key not in by_key]
        if unknown:
            raise ValidationError({"custom_values": f"不存在或不属于当前设备类型的字段：{'、'.join(unknown)}"})

    if is_create:
        missing = [
            field.name for field in fields
            if field.is_active and field.required and (
                field.key not in values or _custom_field_value_is_empty(values.get(field.key), field.field_type)
            )
        ]
        if missing:
            raise ValidationError({"custom_values": f"必填自定义字段未填写：{'、'.join(missing)}"})

    for key, raw in values.items():
        field = by_key[key]
        if not field.is_active:
            raise ValidationError({f"custom_values.{key}": "该字段已停用，不能修改"})
        if _custom_field_value_is_empty(raw, field.field_type):
            AssetCustomValue.objects.filter(asset=asset, field=field).delete()
            continue

        payload = {
            "text_value": "",
            "number_value": None,
            "date_value": None,
            "boolean_value": None,
            "json_value": None,
        }
        try:
            if field.field_type in {"text", "textarea"}:
                if not isinstance(raw, str):
                    raise ValueError("必须是文本")
                payload["text_value"] = raw
            elif field.field_type == "number":
                payload["number_value"] = Decimal(str(raw))
            elif field.field_type == "date":
                payload["date_value"] = _custom_date(raw)
            elif field.field_type == "boolean":
                if not isinstance(raw, bool):
                    raise ValueError("必须是 true 或 false")
                payload["boolean_value"] = raw
            elif field.field_type in {"select", "multiselect"}:
                options = {option.value for option in field.options.all() if option.is_active}
                submitted_values = [raw] if field.field_type == "select" else raw
                if field.field_type == "multiselect" and not isinstance(submitted_values, list):
                    raise ValueError("必须是选项数组")
                if any(not isinstance(item, str) or item not in options for item in submitted_values):
                    raise ValueError("包含无效或已停用选项")
                if field.field_type == "select":
                    payload["text_value"] = raw
                else:
                    payload["json_value"] = submitted_values
        except (InvalidOperation, ValueError, TypeError) as exc:
            raise ValidationError({f"custom_values.{key}": str(exc)}) from exc

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


def sync_asset_fault_status(asset_id: int):
    """Derive asset status from whether it still has an open fault."""
    has_open_fault = FaultEvent.objects.filter(asset_id=asset_id, is_closed=False).exists()
    if has_open_fault:
        # A retired asset should not be silently brought back into the repair
        # lifecycle just because an old/protected fault was edited.
        Asset.objects.filter(pk=asset_id).exclude(status="retired").update(status="repair")
    else:
        # Only restore assets that this service previously marked as repairing;
        # preserve in-stock, idle and retired states owned by administrators.
        Asset.objects.filter(pk=asset_id, status="repair").update(status="in_use")


def sync_repair_completion(repair):
    """Keep repair completion, fault closure and asset status consistent."""
    finished_at = repair.finished_at
    FaultEvent.objects.filter(pk=repair.fault_id).update(is_closed=bool(finished_at), resolved_at=finished_at)
    sync_asset_fault_status(repair.fault.asset_id)


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
