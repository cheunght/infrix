"""Shared reference policy after parsing: fieldsets, catalog types and people."""
import json
from django.db.models import Q
from rest_framework.exceptions import ValidationError as DRFValidationError
from .models import Asset, AssetModel, CustomField, CustomFieldSetItem
from .custom_fields import validate_custom_field_value, normalize_validation_config as _normalize_validation_config
from .fieldsets import validate_fieldset_items, raise_if_fieldset_conflicts


def _validate_default_value(field, value, active_options):
    if not isinstance(value, str):
        raise ValueError("默认值必须是字符串")
    if not value.strip():
        return ""
    field_type = field.field_type
    candidate = value if field_type in {"text", "textarea"} else value.strip()
    if field_type == "boolean":
        if candidate not in {"true", "false"}:
            raise ValueError("是/否字段的默认值只能是 true 或 false")
        candidate = candidate == "true"
    elif field_type == "multiselect":
        try:
            candidate = json.loads(candidate)
        except (TypeError, ValueError) as exc:
            raise ValueError("多选字段的默认值必须是 JSON 字符串数组") from exc

    normalized = validate_custom_field_value(
        field,
        candidate,
        allowed_option_values=active_options,
        validate_empty=True,
    )
    if field_type == "boolean":
        return "true" if normalized else "false"
    if field_type == "multiselect":
        return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    return normalized


def _default_references_option(field, option_value):
    default_value = (field.default_value or "").strip()
    if not default_value:
        return False
    if field.field_type == "select":
        return default_value == option_value
    if field.field_type == "multiselect":
        try:
            values = json.loads(default_value)
        except (TypeError, ValueError):
            return False
        return isinstance(values, list) and option_value in values
    return False


def validate_device_type(attrs, *, instance=None, initial_data=None):
    fieldset = attrs.get("default_fieldset", instance.default_fieldset if instance else None)
    if fieldset is not None and not fieldset.is_active:
        current_id = instance.default_fieldset_id if instance else None
        if fieldset.pk != current_id:
            raise DRFValidationError({"default_fieldset": "停用的字段集不能设为默认字段集"})
    if instance and "default_fieldset" in attrs and attrs["default_fieldset"] != instance.default_fieldset:
        affected_assets = Asset.objects.filter(
            Q(asset_model__device_type=instance, asset_model__fieldset__isnull=True)
            | Q(asset_model__isnull=True, standalone_device_type=instance)
        ).distinct()
        prospective_items = list(fieldset.items.all().values("field_id", "required")) if fieldset else []
        prospective_items = [
            {"field": CustomField.objects.get(pk=item["field_id"]), "required": item["required"]}
            for item in prospective_items
        ]
        raise_if_fieldset_conflicts(
            affected_assets,
            prospective_items,
            detail="修改默认字段集会使现有资产值失去归属或缺少必填字段",
        )
    return attrs


def validate_asset_model(attrs, *, instance=None, initial_data=None):
    manufacturer = attrs.get("manufacturer", instance.manufacturer if instance else None)
    device_type = attrs.get("device_type", instance.device_type if instance else None)
    if manufacturer is None:
        raise DRFValidationError({"manufacturer": "厂商不能为空"})
    if device_type is None:
        raise DRFValidationError({"device_type": "设备类型不能为空"})
    for field in ("manufacturer", "device_type"):
        value = attrs.get(field, getattr(instance, field, None) if instance else None)
        if value is not None and not value.is_active:
            current_id = getattr(instance, f"{field}_id", None) if instance else None
            if current_id != value.pk:
                raise DRFValidationError({field: "停用的选项不能用于资产型号"})
    fieldset = attrs.get("fieldset", instance.fieldset if instance else None)
    if fieldset is not None and not fieldset.is_active:
        current_id = instance.fieldset_id if instance else None
        if fieldset.pk != current_id:
            raise DRFValidationError({"fieldset": "停用的字段集不能用于资产型号"})
    name = attrs.get("name", instance.name if instance else "")
    duplicate_name = AssetModel.objects.filter(manufacturer=manufacturer, name__iexact=name)
    if instance:
        duplicate_name = duplicate_name.exclude(pk=instance.pk)
    if duplicate_name.exists():
        raise DRFValidationError({"name": "同一厂商下型号名称不能重复"})
    model_number = attrs.get("model_number", instance.model_number if instance else "")
    if model_number:
        duplicate_number = AssetModel.objects.filter(manufacturer=manufacturer, model_number__iexact=model_number)
        if instance:
            duplicate_number = duplicate_number.exclude(pk=instance.pk)
        if duplicate_number.exists():
            raise DRFValidationError({"model_number": "同一厂商下型号编号不能重复"})
    for field in ("default_warranty_months", "expected_life_months"):
        value = attrs.get(field)
        if value is not None and value < 0:
            raise DRFValidationError({field: "月数不能为负数"})
    if instance:
        prospective_fieldset = fieldset or device_type.default_fieldset
        effective_changed = (
            prospective_fieldset.pk if prospective_fieldset else None
        ) != (
            (instance.fieldset or instance.device_type.default_fieldset).pk
            if (instance.fieldset or instance.device_type.default_fieldset) else None
        )
        if effective_changed:
            prospective_items = list(prospective_fieldset.items.all().values("field_id", "required")) if prospective_fieldset else []
            prospective_items = [
                {"field": CustomField.objects.get(pk=item["field_id"]), "required": item["required"]}
                for item in prospective_items
            ]
            raise_if_fieldset_conflicts(
                Asset.objects.filter(asset_model=instance),
                prospective_items,
                detail="修改型号字段集会使现有资产值失去归属或缺少必填字段",
            )
    return attrs


def validate_custom_field_option(attrs, *, instance=None, initial_data=None):
    field = attrs.get("field", instance.field if instance else None)
    if field and field.field_type not in {"select", "multiselect"}:
        raise DRFValidationError({"field": "只有下拉单选或多选字段可以配置选项"})
    if instance:
        if "field" in attrs and attrs["field"].pk != instance.field_id:
            raise DRFValidationError({"field": "选项创建后不能修改所属字段"})
        if "value" in attrs and attrs["value"] != instance.value:
            raise DRFValidationError({"value": "选项值创建后不能修改"})
        if "is_active" in attrs and not attrs["is_active"] and _default_references_option(instance.field, instance.value):
            raise DRFValidationError({"is_active": "选项被字段默认值引用，不能停用"})
    return attrs


def validate_custom_field(attrs, *, instance=None, initial_data=None):
    initial_data = initial_data or {}
    field_type = attrs.get("field_type", instance.field_type if instance else None)
    effective_form_visible = attrs.get(
        "form_visible",
        instance.form_visible if instance else True,
    )
    if (
        instance
        and instance.form_visible
        and not effective_form_visible
        and CustomFieldSetItem.objects.filter(field_id=instance.pk, required=True).exists()
    ):
        raise DRFValidationError({
            "form_visible": "字段已在字段集中设为必填，不能隐藏；请先取消必填或移出字段集",
        })
    if instance and "field_type" in attrs and attrs["field_type"] != instance.field_type:
        if instance.asset_values.exists() or instance.options.exists():
            raise DRFValidationError({"field_type": "字段已有资产值或选项，不能修改字段类型"})
        if "validation_config" not in attrs:
            attrs["validation_config"] = {}
    config = attrs.get("validation_config", instance.validation_config if instance else {})
    try:
        attrs["validation_config"] = _normalize_validation_config(field_type, config)
    except ValueError as exc:
        raise DRFValidationError({"validation_config": str(exc)}) from exc

    default_value = attrs.get("default_value", instance.default_value if instance else "")
    if "default_value" in initial_data and not isinstance(initial_data["default_value"], str):
        raise DRFValidationError({"default_value": "默认值必须是字符串"})
    active_options = set()
    if instance:
        active_options = set(instance.options.filter(is_active=True).values_list("value", flat=True))
    validation_field = CustomField(
        name=attrs.get("name", instance.name if instance else "自定义字段"),
        field_type=field_type,
        validation_config=attrs["validation_config"],
    )
    try:
        attrs["default_value"] = _validate_default_value(validation_field, default_value, active_options)
    except ValueError as exc:
        raise DRFValidationError({"default_value": str(exc)}) from exc
    return attrs


def validate_custom_field_set(attrs, *, instance=None, initial_data=None):
    items = attrs.get("items")
    if items is not None:
        validate_fieldset_items(items)
    return attrs


def validate_person(attrs, *, instance=None, initial_data=None):
    current_active = instance.is_active if instance else True
    target_active = attrs.get("is_active", current_active)
    if current_active and not target_active and instance and instance.assigned_assets.exists():
        raise DRFValidationError({"is_active": "该人员仍有资产，处理名下资产后才能停用"})
    for field in ("organization", "contact"):
        if field in attrs:
            attrs[field] = (attrs[field] or "").strip()
    return attrs


def validate_software_license(attrs, *, instance=None, initial_data=None):
    authorized_count = attrs.get("authorized_count", instance.authorized_count if instance else 0)
    used_count = attrs.get("used_count", instance.used_count if instance else 0)
    if authorized_count < 0 or used_count < 0:
        raise DRFValidationError("授权数和已用数不能为负数")
    manufacturer = attrs.get("manufacturer")
    if manufacturer and not manufacturer.is_active and (
        not instance or instance.manufacturer_id != manufacturer.pk
    ):
        raise DRFValidationError({"manufacturer_id": "停用的厂商不能用于新许可或修改许可"})
    return attrs


def validate_department_parent(value, *, instance=None):
    if not value or not instance:
        return value
    current = value
    visited = set()
    while current is not None and current.pk not in visited:
        if current.pk == instance.pk:
            raise DRFValidationError("部门层级不能形成循环")
        visited.add(current.pk)
        current = current.parent
    return value
