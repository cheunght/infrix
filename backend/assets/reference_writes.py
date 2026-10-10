"""Shared catalog transactions, reference protection and member replacement.

Serializers are field adapters. Policy and persistence stay in this module and
reference_rules; HTTP callers retain maintenance/authorization admission.
"""
from django.db import transaction
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError

from .audit import model_snapshot, spare_part_audit_snapshot, software_license_audit_snapshot, write_audit_log
from .data_scope import require_object, scope_for
from .fieldsets import replace_fieldset_items
from .models import (
    AssetCustomValue, AssetModel, CustomField, CustomFieldOption, CustomFieldSet,
    CustomFieldSetItem, Department, DeviceType, Manufacturer, Person,
    SoftwareLicense, SparePart, SparePartCategory, SystemSetting, Tag,
)
from .organization_access import require_capability
from .reference_rules import _default_references_option
from .resource_revision import check_resource_revision
from .system_settings import ensure_system_settings


def _admit_write(request, resource):
    capability = {"custom_field": "custom_fields.manage", "custom_fieldset": "custom_fields.manage",
        "custom_field_option": "custom_fields.manage", "tag": "tags.manage",
        "spare_part": "spares.manage", "software_license": "licenses.manage"}.get(resource, "settings.manage")
    require_capability(request.user, capability)
    if not scope_for(request.user).global_write:
        raise PermissionDenied({"code": "data_scope_global_required", "detail": "共有主数据修改需要全局写入授权"})


def _lock_hierarchy(model):
    if model is Department:
        # A stable existing row coordinates edits before any department row
        # or parent relationship is read. It is not modified by this lock.
        ensure_system_settings()
        SystemSetting.objects.select_for_update().get(pk=SystemSetting.SINGLETON_ID)


def _lock_option_field(model, *, instance=None, data=None):
    if model is not CustomFieldOption:
        return
    raw = instance.field_id if instance is not None else (data or {}).get("field")
    if isinstance(raw, (str, int)) and str(raw).isdecimal():
        # Field policy edits and option changes share the parent-first order.
        # Missing/invalid selectors retain the field adapter's normal errors.
        CustomField.objects.select_for_update().filter(pk=int(raw)).first()


def reference_snapshot(instance):
    if isinstance(instance, SparePart):
        return spare_part_audit_snapshot(instance)
    if isinstance(instance, SoftwareLicense):
        return software_license_audit_snapshot(instance)
    result = model_snapshot(instance)
    if isinstance(instance, CustomFieldSet):
        result["items"] = [{"field_id": item.field_id, "field_key": item.field.key,
            "field_name": item.field.name, "required": item.required, "group": item.group,
            "sort_order": item.sort_order} for item in CustomFieldSetItem.objects.select_related("field")
            .filter(fieldset=instance).order_by("sort_order", "id")]
    return result


@transaction.atomic
def persist_fieldset(validated_data, *, instance=None):
    values = dict(validated_data)
    items = values.pop("items", None)
    if instance is None:
        instance = CustomFieldSet.objects.create(**values)
    else:
        instance = get_object_or_404(CustomFieldSet.objects.select_for_update(), pk=instance.pk)
        for key, value in values.items():
            setattr(instance, key, value)
        instance.save()
    if items is not None:
        instance = replace_fieldset_items(instance, items)
    return instance


@transaction.atomic
def save_reference(request, serializer, resource):
    _admit_write(request, resource)
    before = None
    action = "create" if serializer.instance is None else "update"
    model = serializer.Meta.model
    _lock_hierarchy(model)
    _lock_option_field(model, instance=serializer.instance, data=serializer.initial_data)
    if serializer.instance is not None:
        instance = get_object_or_404(model.objects.select_for_update(), pk=serializer.instance.pk)
        require_object(instance, user=request.user)
        check_resource_revision(instance, request)
        serializer.instance = instance
        # The caller normally parsed under the same row lock. Direct adapters
        # also recheck current business policy before persistence.
        serializer.validate(dict(serializer.validated_data))
        before = reference_snapshot(instance)
    instance = serializer.save()
    write_audit_log(request, action=action, resource_type=resource, resource_id=instance.pk,
        before=before, after=reference_snapshot(instance))
    return instance


def _protect_delete(instance):
    if isinstance(instance, SparePart):
        if instance.transactions.exists(): raise ValidationError("该备件已有库存流水，无法删除。")
        if instance.repair_part_usages.exists(): raise ValidationError("该备件已有维修用件记录，无法删除。")
        # Part-before-stock order matches all movement writers. Zero balances
        # without historical facts may still be removed as before.
        instance.stocks.all().delete()
    if isinstance(instance, Person) and instance.assigned_assets.exists():
        raise ValidationError("人员仍被资产使用，不能删除，请先归还或转交资产")
    if isinstance(instance, Department) and instance.people.exists():
        raise ValidationError("部门仍被人员使用，不能删除，请先调整人员资料")
    if isinstance(instance, Manufacturer) and (instance.standalone_assets.exists()
        or instance.asset_models.filter(assets__isnull=False).exists()
        or instance.software_licenses.exists() or instance.spare_parts.exists()):
        raise ValidationError("厂商正在被资产、软件许可或备件使用，不能删除，请先停用")
    if isinstance(instance, SparePartCategory) and instance.spare_parts.exists():
        raise ValidationError("备件类型正在被备件使用，不能删除，请先停用")
    if isinstance(instance, DeviceType) and (instance.standalone_assets.exists()
        or instance.asset_models.filter(assets__isnull=False).exists()):
        raise ValidationError("设备类型正在被资产使用，不能删除，请先停用")
    if isinstance(instance, AssetModel) and instance.assets.exists():
        raise ValidationError("字典项正在被资产使用，不能删除，请先停用")
    if isinstance(instance, CustomFieldSet) and (instance.asset_models.exists() or instance.default_for_device_types.exists()):
        raise ValidationError("字段集正在被资产型号或设备类型引用，不能删除，请先停用")
    if isinstance(instance, CustomField):
        if instance.asset_values.exists(): raise ValidationError("字段已有资产值，不能删除，请先停用")
        if instance.fieldset_items.exists(): raise ValidationError("字段正在被字段集引用，不能删除，请先停用")
        if instance.options.exists(): raise ValidationError("字段仍有选项，不能删除，请先删除选项")
    if isinstance(instance, CustomFieldOption):
        if _default_references_option(instance.field, instance.value):
            raise ValidationError("选项被字段默认值引用，不能删除")
        for text, value in AssetCustomValue.objects.filter(field_id=instance.field_id).values_list("text_value", "json_value"):
            if text == instance.value or isinstance(value, list) and instance.value in value:
                raise ValidationError("选项已有资产使用，不能删除，请先停用")
    if isinstance(instance, Tag) and instance.asset_tags.exists():
        raise ValidationError("标签正在被资产使用，不能删除，请先停用")


@transaction.atomic
def delete_reference(request, instance, resource):
    _admit_write(request, resource)
    model = type(instance)
    _lock_hierarchy(model)
    _lock_option_field(model, instance=instance)
    instance = get_object_or_404(model.objects.select_for_update(), pk=instance.pk)
    require_object(instance, user=request.user)
    _protect_delete(instance)
    before = reference_snapshot(instance)
    pk = instance.pk
    try:
        instance.delete()
    except ProtectedError as exc:
        messages = {Department: "部门仍有子部门使用，不能删除，请先调整部门层级",
            DeviceType: "设备类型仍被业务数据使用，不能删除，请先停用"}
        raise ValidationError(messages.get(model, "字典项仍被当前或归档业务记录引用，不能删除，请先停用")) from exc
    write_audit_log(request, action="delete", resource_type=resource, resource_id=pk, before=before)


@transaction.atomic
def edit_fieldset_items(request, fieldset_id, items):
    _admit_write(request, "custom_fieldset")
    fieldset = get_object_or_404(CustomFieldSet.objects.select_for_update(), pk=fieldset_id)
    check_resource_revision(fieldset, request)
    before = reference_snapshot(fieldset)
    fieldset = replace_fieldset_items(fieldset, items)
    fieldset._prefetched_objects_cache = {}
    write_audit_log(request, action="update", resource_type="custom_fieldset", resource_id=fieldset.pk,
        before=before, after=reference_snapshot(fieldset))
    return fieldset


class SharedReferenceWriteMixin:
    """Field-adapter dispatch shared by both catalog HTTP surfaces."""
    @transaction.atomic
    def create(self, request, *args, **kwargs):
        _lock_hierarchy(self.queryset.model)
        _lock_option_field(self.queryset.model, data=request.data)
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        _lock_hierarchy(self.queryset.model)
        if self.queryset.model is CustomFieldOption:
            _lock_option_field(self.queryset.model, instance=self.get_object())
        return super().update(request, *args, **kwargs)

    def perform_create(self, serializer):
        save_reference(self.request, serializer, self.audit_resource)

    def perform_update(self, serializer):
        save_reference(self.request, serializer, self.audit_resource)

    def perform_destroy(self, instance):
        delete_reference(self.request, instance, self.audit_resource)
