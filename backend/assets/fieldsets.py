from __future__ import annotations

from django.db import transaction
from django.db.models import Prefetch, Q, QuerySet
from rest_framework.exceptions import APIException, ValidationError as DRFValidationError

from .custom_fields import custom_field_value_is_empty
from .models import Asset, AssetCustomValue, AssetModel, CustomFieldOption, CustomFieldSet, CustomFieldSetItem, DeviceType


class FieldsetConflictAPIException(APIException):
    status_code = 409
    default_code = "custom_field_conflict"

    def __init__(self, *, detail, assets_count, incompatible_fields=None, missing_required_fields=None):
        super().__init__({
            "code": "custom_field_conflict",
            "detail": detail,
            "assets_count": assets_count,
            "incompatible_fields": list(incompatible_fields or []),
            "missing_required_fields": list(missing_required_fields or []),
            "fields": list(dict.fromkeys([
                *(incompatible_fields or []),
                *(missing_required_fields or []),
            ])),
        })


def resolve_fieldset(
    *,
    asset: Asset | None = None,
    asset_model: AssetModel | None = None,
    device_type: DeviceType | None = None,
) -> CustomFieldSet | None:
    """Resolve the single effective fieldset for an asset input scope."""
    supplied = sum(value is not None for value in (asset, asset_model, device_type))
    if supplied != 1:
        raise ValueError("exactly one fieldset scope is required")
    if asset is not None:
        return asset.resolved_fieldset
    if asset_model is not None:
        return asset_model.fieldset or asset_model.device_type.default_fieldset
    return device_type.default_fieldset


def fieldset_items_queryset(*, include_inactive_options: bool = False) -> QuerySet[CustomFieldSetItem]:
    options = CustomFieldOption.objects.order_by("sort_order", "id")
    if not include_inactive_options:
        options = options.filter(is_active=True)
    return CustomFieldSetItem.objects.select_related("field", "fieldset").prefetch_related(
        Prefetch("field__options", queryset=options)
    ).order_by("sort_order", "id")


def effective_field_ids(asset: Asset) -> set[int]:
    fieldset = asset.resolved_fieldset
    if fieldset is None:
        return set()
    return set(fieldset.items.values_list("field_id", flat=True))


def assets_using_fieldset(fieldset: CustomFieldSet) -> QuerySet[Asset]:
    return Asset.objects.filter(
        Q(asset_model__fieldset=fieldset)
        | Q(asset_model__fieldset__isnull=True, asset_model__device_type__default_fieldset=fieldset)
        | Q(asset_model__isnull=True, standalone_device_type__default_fieldset=fieldset)
    ).distinct()


def _custom_value_is_empty(value: AssetCustomValue) -> bool:
    if value.field.field_type in {"text", "textarea", "date", "select"}:
        raw = value.text_value
    elif value.field.field_type == "number":
        raw = value.number_value
    elif value.field.field_type == "boolean":
        raw = value.boolean_value
    else:
        raw = value.json_value
    return custom_field_value_is_empty(raw, value.field.field_type)


def fieldset_asset_conflicts(assets: QuerySet[Asset], items) -> dict[str, object]:
    """Return values that would be invalid under a prospective fieldset."""
    field_by_id = {item["field"].pk: item for item in items}
    allowed_ids = set(field_by_id)
    asset_ids = list(assets.values_list("id", flat=True))
    if not asset_ids:
        return {"assets_count": 0, "incompatible_fields": [], "missing_required_fields": []}

    values = AssetCustomValue.objects.filter(asset_id__in=asset_ids).select_related("field")
    incompatible_fields = sorted({value.field.name for value in values if value.field_id not in allowed_ids})
    required_ids = {field_id for field_id, item in field_by_id.items() if item.get("required")}
    present = {
        (value.asset_id, value.field_id)
        for value in values
        if value.field_id in required_ids and not _custom_value_is_empty(value)
    }
    missing_required_fields = sorted({
        field_by_id[field_id]["field"].name
        for asset_id in asset_ids
        for field_id in required_ids
        if (asset_id, field_id) not in present
    })
    return {
        "assets_count": len(set(asset_ids)),
        "incompatible_fields": incompatible_fields,
        "missing_required_fields": missing_required_fields,
    }


def raise_if_fieldset_conflicts(assets: QuerySet[Asset], items, *, detail: str) -> None:
    conflicts = fieldset_asset_conflicts(assets, items)
    if conflicts["incompatible_fields"] or conflicts["missing_required_fields"]:
        raise FieldsetConflictAPIException(detail=detail, **conflicts)


def validate_fieldset_items(items) -> None:
    field_ids = [item["field"].pk for item in items]
    if len(field_ids) != len(set(field_ids)):
        raise DRFValidationError("同一字段不能在字段集中重复出现")
    for item in items:
        if item["required"] and not item["field"].form_visible:
            raise DRFValidationError(f"必填字段“{item['field'].name}”必须在资产表单中显示")


@transaction.atomic
def replace_fieldset_items(fieldset: CustomFieldSet, items):
    """Validate and replace members while preserving existing asset values."""
    validate_fieldset_items(items)
    existing_ids = set(fieldset.items.values_list("field_id", flat=True))
    inactive = [
        item["field"].name
        for item in items
        if not item["field"].is_active and item["field"].pk not in existing_ids
    ]
    if inactive:
        raise DRFValidationError({"items": f"停用字段不能新增到字段集：{'、'.join(inactive)}"})

    raise_if_fieldset_conflicts(
        assets_using_fieldset(fieldset),
        items,
        detail="修改字段集会使现有资产值失去归属或缺少必填字段",
    )
    fieldset.items.all().delete()
    CustomFieldSetItem.objects.bulk_create([
        CustomFieldSetItem(fieldset=fieldset, **item) for item in items
    ])
    return fieldset
