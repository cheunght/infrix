"""Asset configuration storage: placement, network, support records and custom values."""
from datetime import date
from decimal import Decimal, InvalidOperation
from ipaddress import ip_address

from django.core.exceptions import ValidationError
from django.core.validators import DecimalValidator
from django.db import IntegrityError, transaction

from rest_framework.exceptions import APIException

from .models import (
    Asset,
    AssetCustomValue,
    AssetNetworkAddress,
    AssetTag,
    DataCenter,
    MaintenanceContract,
    ProcurementRecord,
    Rack,
    ServerRoom,
    normalize_network_address,
)
from .custom_fields import (
    custom_field_storage_payload,
    custom_field_value_is_empty,
    validate_custom_field_value,
)
from .physical_location import lock_asset_location, place_asset, unrack_asset


class CustomFieldConflictError(Exception):
    def __init__(self, conflicts):
        super().__init__("custom field values are incompatible with the effective fieldset")
        self.conflicts = conflicts


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
    current_ids = set(
        AssetNetworkAddress.objects.select_for_update()
        .filter(asset_id=asset.pk)
        .values_list("pk", flat=True)
    )
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

        conflicts = AssetNetworkAddress.objects.filter(address=address)
        if current_ids:
            # A role relocation may submit an address that currently belongs
            # to another role of this same asset. All of the asset's old rows
            # are owned by this atomic configuration operation and must be
            # excluded from the cross-asset uniqueness check.
            conflicts = conflicts.exclude(pk__in=current_ids)
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
    # Configuration updates may remove an existing allocation even when the
    # submitted payload contains only supporting fields. Acquire the physical
    # graph before the network rows so callers cannot hold an asset lock while
    # a concurrent rack correction holds the rack/allocation locks.
    if asset.pk:
        lock_asset_location(
            asset_id=asset.pk,
            target_rack_id=data.get("rack_id") if isinstance(data, dict) else None,
        )
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
        place_asset(
            asset_id=asset.pk,
            rack_id=rack.pk,
            start_u=start_u,
            end_u=end_u,
        )
        asset.asset_data_center_id = rack.room.data_center_id
    else:
        unrack_asset(asset_id=asset.pk)

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


def apply_asset_custom_values(asset: Asset, values, *, submitted=True, discard_incompatible=False):
    """Validate and persist values against the asset's effective fieldset."""
    if values is None:
        values = {}
    if not isinstance(values, dict):
        raise ValidationError({"custom_values": "自定义字段值必须是对象"})

    fieldset = asset.resolved_fieldset
    items = list(
        fieldset.items.select_related("field").prefetch_related("field__options").order_by("sort_order", "id")
    ) if fieldset is not None else []
    fields = [item.field for item in items]
    item_by_field_id = {item.field_id: item for item in items}
    by_key = {field.key: field for field in fields}
    if values:
        unknown = [key for key in values if key not in by_key]
        if unknown:
            raise ValidationError({"custom_values": f"不存在或不属于当前字段集的字段：{'、'.join(str(key) for key in unknown)}"})

    allowed_field_ids = set(item_by_field_id)
    incompatible = list(
        AssetCustomValue.objects.filter(asset=asset)
        .exclude(field_id__in=allowed_field_ids)
        .select_related("field")
    )
    if incompatible and not discard_incompatible:
        raise CustomFieldConflictError([
            {"id": value.field_id, "key": value.field.key, "name": value.field.name}
            for value in incompatible
        ])
    if incompatible:
        AssetCustomValue.objects.filter(pk__in=[value.pk for value in incompatible]).delete()

    existing_values = {
        item.field_id: _stored_custom_value(item)
        for item in AssetCustomValue.objects.filter(
            asset_id=asset.pk,
            field_id__in=[field.id for field in fields],
        ).select_related("field")
    }

    missing = []
    for field in fields:
        item = item_by_field_id[field.pk]
        if not field.is_active or not item.required:
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


class CustomFieldConflictAPIException(APIException):
    status_code = 409
    default_code = "custom_field_conflict"

    def __init__(self, conflicts):
        super().__init__({
            "code": "custom_field_conflict",
            "detail": "当前自定义字段值与新的字段集不兼容",
            "fields": conflicts,
        })
