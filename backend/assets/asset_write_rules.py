"""Shared asset write policy after field parsing; no HTTP response handling."""
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError

from .depreciation import DepreciationValidationError, validate_depreciation_configuration
from .lifecycle import validate_asset_status_transition
from .models import RackUnitAllocation

PLACEMENT_CONFIGURATION_KEYS = (
    "data_center", "server_room_id", "rack_id", "rack_start_u", "rack_end_u", "rack_total_u",
)
REQUIRED_PLACEMENT_CONFIGURATION_KEYS = frozenset(PLACEMENT_CONFIGURATION_KEYS[:5])
DERIVED_DEPRECIATION_FIELDS = {
    "depreciation", "original_value", "residual_value", "monthly_depreciation",
    "accumulated_depreciation", "net_book_value", "elapsed_months", "total_months", "progress",
}


def _stored_procurement_amount(instance):
    if not instance:
        return None
    cache = getattr(instance, "_prefetched_objects_cache", {})
    if "procurement_records" in cache:
        records = cache["procurement_records"]
        return records[0].amount if records else None
    return instance.procurement_records.order_by("-purchase_date", "-id").values_list("amount", flat=True).first()


def _submitted_procurement_amount(configuration):
    if not isinstance(configuration, dict):
        return None
    purchase_fields = (
        "purchase_date",
        "supplier",
        "purchase_order_no",
        "purchase_amount",
        "procurement_notes",
    )
    if not any(str(configuration.get(key) or "").strip() for key in purchase_fields):
        return None
    value = configuration.get("purchase_amount")
    if value is None or not str(value).strip():
        return None
    return value


def _prospective_procurement_amount(attrs, instance):
    if "configuration" in attrs:
        configuration = attrs.get("configuration")
        if isinstance(configuration, dict) and configuration:
            if "purchase_amount" not in configuration:
                return _stored_procurement_amount(instance)
        return _submitted_procurement_amount(configuration)
    return _stored_procurement_amount(instance)


def _validate_depreciation(attrs, instance):
    current = instance
    values = {
        field: attrs.get(field, getattr(current, field, None) if current else None)
        for field in (
            "depreciation_start_date",
            "depreciation_years",
            "residual_rate",
            "depreciation_method",
        )
    }
    if not any(value is not None and value != "" for value in values.values()):
        return
    try:
        validate_depreciation_configuration(
            **values,
            amount=_prospective_procurement_amount(attrs, instance),
        )
    except DepreciationValidationError as exc:
        raise DRFValidationError(exc.errors) from exc


def _configuration_includes_placement(configuration) -> bool:
    if not isinstance(configuration, dict):
        return False
    return any(
        key in configuration
        for key in (
            "data_center",
            "server_room_id",
            "server_room",
            "rack_id",
            "rack_code",
            "rack_start_u",
            "rack_end_u",
        )
    )


def _current_placement_configuration(instance):
    allocation = (
        RackUnitAllocation.objects.select_related("rack__room__data_center")
        .filter(asset=instance)
        .first()
    )
    if allocation is None:
        return {}
    return {
        "data_center": allocation.rack.room.data_center_id,
        "server_room_id": allocation.rack.room_id,
        "rack_id": allocation.rack_id,
        "rack_total_u": allocation.rack.total_u,
        "rack_start_u": allocation.start_u,
        "rack_end_u": allocation.end_u,
    }


def _merge_partial_placement_configuration(instance, configuration):
    if not isinstance(configuration, dict):
        return configuration
    current = _current_placement_configuration(instance)
    if not current:
        return configuration

    submitted_required = set(configuration).intersection(
        REQUIRED_PLACEMENT_CONFIGURATION_KEYS
    )
    if submitted_required == REQUIRED_PLACEMENT_CONFIGURATION_KEYS and all(
        not str(configuration.get(key) or "").strip()
        for key in REQUIRED_PLACEMENT_CONFIGURATION_KEYS
    ):
        # The form sends all five empty values to explicitly unmount an
        # asset.  Preserve that intent instead of restoring the current
        # allocation below.
        return configuration
    return {**current, **configuration}


def _validate_direct_asset_data_center(instance, requested_data_center) -> None:
    allocation = RackUnitAllocation.objects.select_related(
        "rack__room__data_center"
    ).filter(asset=instance).first()
    if allocation is not None and getattr(requested_data_center, "pk", None) != allocation.rack.room.data_center_id:
        raise DjangoValidationError({
            "asset_data_center": "已上架资产的数据中心由机柜位置决定，请通过机柜位置调整",
        })


def validate_asset_write(attrs, *, instance=None, initial_data=None):
    removed_fields = {
        "responsible_user", "responsible_user_id", "responsible_user_name",
        "responsibility_subject", "responsibility_subject_id", "assigned_to", "assignee", "target_user",
        "target_subject", "target_person", "assigned_person", "assigned_person_id",
        "department", "department_id", "owner_name",
        "model", "manufacturer_model", "manufacturer_id", "asset_model_name", "asset_model_number",
    }
    submitted_removed_fields = removed_fields.intersection((initial_data or {}))
    if submitted_removed_fields:
        field = sorted(submitted_removed_fields)[0]
        if field in {"model", "manufacturer_model", "manufacturer_id", "asset_model_name", "asset_model_number"}:
            message = "该资产型号字段已移除，请使用 asset_model，或使用 manufacturer、device_type 和 model_text"
        else:
            message = "该字段已移除，请使用 assignment 或使用人操作"
        raise DRFValidationError({field: message})
    derived_fields = DERIVED_DEPRECIATION_FIELDS & set((initial_data or {}))
    if derived_fields:
        field = sorted(derived_fields)[0]
        raise DRFValidationError({field: "折旧派生值只读，不能提交"})
    if "status_before_repair" in (initial_data or {}):
        raise DRFValidationError({"status_before_repair": "该字段由维修流程维护"})
    if "configuration" in attrs and not isinstance(attrs["configuration"], dict):
        raise DRFValidationError({"configuration": "配置必须是 JSON 对象"})
    asset_model = attrs.get("asset_model", instance.asset_model if instance else None)
    if asset_model is not None:
        current_model_id = instance.asset_model_id if instance else None
        if not asset_model.is_active and asset_model.pk != current_model_id:
            raise DRFValidationError({"asset_model": "停用的资产型号不能用于资产"})
        standalone_submitted = {
            "manufacturer": (initial_data or {}).get("manufacturer"),
            "device_type": (initial_data or {}).get("device_type"),
            "model_text": (initial_data or {}).get("model_text"),
        }
        if any(value not in (None, "") for value in standalone_submitted.values()):
            raise DRFValidationError({"asset_model": "选择标准型号后不能同时提交独立厂商、设备类型或历史型号文本"})
        attrs["standalone_manufacturer"] = None
        attrs["standalone_device_type"] = None
        attrs["model_text"] = ""
    else:
        manufacturer = attrs.get(
            "standalone_manufacturer",
            instance.standalone_manufacturer if instance and not instance.asset_model_id else None,
        )
        device_type = attrs.get(
            "standalone_device_type",
            instance.standalone_device_type if instance and not instance.asset_model_id else None,
        )
        if not device_type:
            raise DRFValidationError({"device_type": "未选择标准型号时设备类型不能为空"})
        if not device_type.is_active and (not instance or instance.device_type_id != device_type.pk):
            raise DRFValidationError({"device_type": "停用的设备类型不能用于新资产或修改资产"})
        if manufacturer and not manufacturer.is_active and (not instance or instance.manufacturer_id != manufacturer.pk):
            raise DRFValidationError({"manufacturer": "停用的厂商不能用于新资产或修改资产"})
        attrs["standalone_device_type"] = device_type
        attrs["standalone_manufacturer"] = manufacturer
    asset_data_center = attrs.get("asset_data_center")
    if asset_data_center and not asset_data_center.is_active:
        if not instance or instance.asset_data_center_id != asset_data_center.pk:
            raise DRFValidationError({"asset_data_center": "停用的数据中心不能用于资产"})
    if "serial_number" in attrs and not attrs["serial_number"]:
        attrs["serial_number"] = None
    if "status" in attrs:
        try:
            validate_asset_status_transition(instance, attrs["status"])
        except DjangoValidationError as exc:
            raise DRFValidationError(
                getattr(exc, "message_dict", {"status": exc.messages})
            ) from exc
    assignment = attrs.get("assignment")
    if assignment and assignment.get("action") == "transfer" and "status" in attrs:
        if instance is not None and attrs["status"] != instance.status:
            raise DRFValidationError({"status": "转交使用人不会改变资产状态"})
    _validate_depreciation(attrs, instance)
    return attrs

