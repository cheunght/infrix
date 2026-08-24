from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from collections import Counter
from django.db.models import Count, Q
from rest_framework import serializers
from rest_framework.exceptions import ValidationError as DRFValidationError
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any
import json
import re
from .models import AuditLog, Asset, AssetCustomValue, AssetNetworkAddress, AssetTag, CustomField, CustomFieldOption, DataCenter, DeviceType, FaultEvent, InventoryItem, InventoryTask, MaintenanceContract, Manufacturer, ProcurementRecord, Rack, RackUnitAllocation, RepairRecord, ServerRoom, SoftwareLicense, SparePart, SpareStock, SpareStockTransaction, Tag, UserSecurityProfile
from .depreciation import DepreciationValidationError, calculate_asset_depreciation, validate_depreciation_configuration
from .license_status import license_status_value
from .services import apply_asset_custom_values, apply_asset_tags, apply_spare_stock_transaction, configure_asset, inventory_snapshot_location, inventory_task_can_delete, validate_inventory_resolution_request
from .roles import ROLE_AUDITOR, ROLE_DEFINITIONS, ROLE_NAME_TO_CODE, preset_group_for_code, user_role_code


class GroupSerializer(serializers.ModelSerializer):
    user_count = serializers.IntegerField(read_only=True)
    code = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    system_managed = serializers.BooleanField(read_only=True, default=True)

    def get_code(self, obj) -> str | None:
        return ROLE_NAME_TO_CODE.get(obj.name)

    def get_description(self, obj) -> str:
        code = ROLE_NAME_TO_CODE.get(obj.name)
        return ROLE_DEFINITIONS.get(code, {}).get("description", "")

    class Meta:
        model = Group
        fields = ["id", "code", "name", "description", "system_managed", "user_count"]


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    password = serializers.CharField(
        write_only=True,
        required=False,
        min_length=8,
        error_messages={"min_length": "密码至少需要 8 位"},
    )
    groups = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    role_code = serializers.ChoiceField(
        choices=list(ROLE_DEFINITIONS), required=False, write_only=True
    )
    assigned_role_code = serializers.SerializerMethodField()
    assigned_role_name = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        return obj.get_full_name() or obj.username

    def get_assigned_role_code(self, obj) -> str | None:
        return user_role_code(obj)

    def get_assigned_role_name(self, obj) -> str:
        code = user_role_code(obj)
        return ROLE_DEFINITIONS.get(code, {}).get("name", "只读审计员")

    def get_extra_kwargs(self):
        extra_kwargs = super().get_extra_kwargs()
        if self.instance is not None:
            extra_kwargs["username"] = {"read_only": True}
        return extra_kwargs

    def validate_first_name(self, value):
        return value.strip()

    def validate_last_name(self, value):
        return value.strip()

    def validate_email(self, value):
        return value.strip()

    def validate(self, attrs):
        if self.instance is not None and "password" in attrs:
            raise serializers.ValidationError({"password": "请使用独立的重置密码操作"})
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": "新用户必须设置至少 8 位密码"})
        password = attrs.get("password")
        if password:
            password_user = self.instance or User(username=attrs.get("username", ""))
            try:
                validate_password(password, user=password_user)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        role_code = validated_data.pop("role_code", ROLE_AUDITOR)
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        UserSecurityProfile.objects.update_or_create(
            user=user,
            defaults={"must_change_password": True, "password_changed_at": None},
        )
        group = preset_group_for_code(role_code)
        if group:
            user.groups.set([group])
        return user

    def update(self, instance, validated_data):
        role_code = validated_data.pop("role_code", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        if role_code is not None:
            group = preset_group_for_code(role_code)
            if group:
                instance.groups.set([group])
        return instance

    class Meta:
        model = User
        fields = ["id", "username", "display_name", "first_name", "last_name", "email", "is_active", "is_staff", "is_superuser", "groups", "role_code", "assigned_role_code", "assigned_role_name", "password", "last_login", "date_joined"]
        read_only_fields = ["id", "display_name", "is_staff", "is_superuser", "groups", "assigned_role_code", "assigned_role_name", "last_login", "date_joined"]


class CurrentUserProfileSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150, trim_whitespace=True)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150, trim_whitespace=True)
    email = serializers.EmailField(required=False, allow_blank=True, max_length=254, trim_whitespace=True)

    class Meta:
        model = User
        fields = ["first_name", "last_name", "email"]


class AdminPasswordResetSerializer(serializers.Serializer):
    new_password = serializers.CharField(write_only=True, min_length=8, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "两次输入的密码不一致"})
        try:
            validate_password(attrs["new_password"], user=self.context.get("user"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        return attrs


class InventoryInspectorSerializer(serializers.Serializer):
    """Schema-only representation for users who can perform an inventory."""

    id = serializers.IntegerField()
    username = serializers.CharField()
    display_name = serializers.CharField()


class AssetNetworkAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetNetworkAddress
        fields = "__all__"


class BaseDictionarySerializer(serializers.ModelSerializer):
    assets_count = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("名称不能为空")
        queryset = self.Meta.model.objects.filter(name__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("名称已存在")
        return value

    class Meta:
        fields = ["id", "name", "is_active", "assets_count", "created_at", "updated_at"]
        read_only_fields = ["id", "assets_count", "created_at", "updated_at"]


class ManufacturerSerializer(BaseDictionarySerializer):
    licenses_count = serializers.IntegerField(read_only=True, default=0)

    def validate_code(self, value):
        value = (value or "").strip()
        if not value:
            return None
        queryset = Manufacturer.objects.filter(code__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("编码已存在")
        return value

    class Meta(BaseDictionarySerializer.Meta):
        model = Manufacturer
        fields = ["id", "name", "code", "is_active", "assets_count", "licenses_count", "created_at", "updated_at"]


class ManufacturerReferenceSerializer(serializers.ModelSerializer):
    """Stable display contract for business records that reference a manufacturer."""

    class Meta:
        model = Manufacturer
        fields = ["id", "name", "code", "is_active"]
        read_only_fields = fields


class DeviceTypeSerializer(BaseDictionarySerializer):
    def validate_color(self, value):
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value or ""):
            raise serializers.ValidationError("颜色必须是六位十六进制值，例如 #1677EF")
        return value.upper()

    class Meta(BaseDictionarySerializer.Meta):
        model = DeviceType
        fields = ["id", "name", "color", "is_active", "assets_count", "created_at", "updated_at"]


_VALIDATION_CONFIG_KEYS = {
    "text": {"min_length", "max_length"},
    "textarea": {"min_length", "max_length"},
    "number": {"min", "max", "precision"},
    "date": {"min_date", "max_date"},
    "multiselect": {"min_items", "max_items"},
    "select": set(),
    "boolean": set(),
}


def _validation_integer(value, label, *, maximum=None):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label}必须是非负整数")
    if maximum is not None and value > maximum:
        raise ValueError(f"{label}不能大于 {maximum}")
    return value


def _validation_decimal(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label}必须是数字")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{label}必须是数字") from exc
    if not parsed.is_finite():
        raise ValueError(f"{label}必须是有限数字")
    return str(parsed)


def _validation_date(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label}必须是 YYYY-MM-DD 日期") from exc
    return value


def _normalize_validation_config(field_type, value):
    if not isinstance(value, dict):
        raise ValueError("校验配置必须是 JSON 对象")
    allowed = _VALIDATION_CONFIG_KEYS.get(field_type, set())
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ValueError(f"不支持的校验配置项：{'、'.join(unknown)}")

    normalized = {}
    for key, raw in value.items():
        if key in {"min_length", "max_length", "min_items", "max_items"}:
            normalized[key] = _validation_integer(raw, key)
        elif key == "precision":
            normalized[key] = _validation_integer(raw, key, maximum=6)
        elif key in {"min", "max"}:
            normalized[key] = _validation_decimal(raw, key)
        elif key in {"min_date", "max_date"}:
            normalized[key] = _validation_date(raw, key)

    if {"min_length", "max_length"}.issubset(normalized) and normalized["min_length"] > normalized["max_length"]:
        raise ValueError("min_length 不能大于 max_length")
    if {"min_items", "max_items"}.issubset(normalized) and normalized["min_items"] > normalized["max_items"]:
        raise ValueError("min_items 不能大于 max_items")
    if {"min", "max"}.issubset(normalized) and Decimal(normalized["min"]) > Decimal(normalized["max"]):
        raise ValueError("min 不能大于 max")
    if {"min_date", "max_date"}.issubset(normalized) and normalized["min_date"] > normalized["max_date"]:
        raise ValueError("min_date 不能晚于 max_date")
    return normalized


def _validate_default_value(field_type, value, active_options):
    if not isinstance(value, str):
        raise ValueError("默认值必须是字符串")
    if not value.strip():
        return ""
    if field_type in {"text", "textarea"}:
        return value
    if field_type == "number":
        try:
            parsed = Decimal(value.strip())
        except InvalidOperation as exc:
            raise ValueError("数字字段的默认值必须能解析为数字") from exc
        if not parsed.is_finite():
            raise ValueError("数字字段的默认值必须是有限数字")
        if parsed.as_tuple().exponent < -6:
            raise ValueError("数字字段的默认值最多支持 6 位小数")
        return value.strip()
    if field_type == "date":
        return _validation_date(value.strip(), "日期字段的默认值")
    if field_type == "boolean":
        normalized = value.strip()
        if normalized not in {"true", "false"}:
            raise ValueError("布尔字段的默认值只能是 true 或 false")
        return normalized
    if field_type == "select":
        if value not in active_options:
            raise ValueError("下拉字段的默认值必须是启用中的选项值")
        return value
    if field_type == "multiselect":
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("多选字段的默认值必须是 JSON 字符串数组") from exc
        if not isinstance(parsed, list) or any(not isinstance(item, str) or item not in active_options for item in parsed):
            raise ValueError("多选字段的默认值必须只包含启用中的选项值")
        return value
    return value


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


class CustomFieldOptionSerializer(serializers.ModelSerializer):
    def validate_value(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("选项值不能为空")
        queryset = CustomFieldOption.objects.filter(field=self.initial_data.get("field"), value=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if self.instance and "field" not in self.initial_data:
            queryset = CustomFieldOption.objects.filter(field=self.instance.field, value=value).exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("同一字段下选项值不能重复")
        return value

    def validate_label(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("选项名称不能为空")
        return value

    def validate(self, attrs):
        field = attrs.get("field", self.instance.field if self.instance else None)
        if field and field.field_type not in {"select", "multiselect"}:
            raise serializers.ValidationError({"field": "只有下拉单选或多选字段可以配置选项"})
        if self.instance:
            if "field" in attrs and attrs["field"].pk != self.instance.field_id:
                raise serializers.ValidationError({"field": "选项创建后不能修改所属字段"})
            if "value" in attrs and attrs["value"] != self.instance.value:
                raise serializers.ValidationError({"value": "选项值创建后不能修改"})
            if "is_active" in attrs and not attrs["is_active"] and _default_references_option(self.instance.field, self.instance.value):
                raise serializers.ValidationError({"is_active": "选项被字段默认值引用，不能停用"})
        return attrs

    class Meta:
        model = CustomFieldOption
        fields = ["id", "field", "value", "label", "sort_order", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class CustomFieldSerializer(serializers.ModelSerializer):
    options = CustomFieldOptionSerializer(many=True, read_only=True)
    assets_count = serializers.IntegerField(read_only=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)
    field_type_label = serializers.SerializerMethodField()

    def get_field_type_label(self, obj) -> str:
        return dict(CustomField.FIELD_TYPES).get(obj.field_type, obj.field_type)

    def validate_key(self, value):
        value = (value or "").strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_]*", value):
            raise serializers.ValidationError("字段编码只能包含小写字母、数字和下划线，且必须以字母开头")
        if self.instance and value != self.instance.key:
            raise serializers.ValidationError("字段编码创建后不能修改")
        queryset = CustomField.objects.filter(key=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("字段编码已存在")
        return value

    def validate(self, attrs):
        field_type = attrs.get("field_type", self.instance.field_type if self.instance else None)
        if self.instance and "field_type" in attrs and attrs["field_type"] != self.instance.field_type:
            if self.instance.asset_values.exists() or self.instance.options.exists():
                raise serializers.ValidationError({"field_type": "字段已有资产值或选项，不能修改字段类型"})
            if "validation_config" not in attrs:
                attrs["validation_config"] = {}
        if self.instance and "device_type" in attrs:
            device_type_id = attrs["device_type"].pk if attrs["device_type"] is not None else None
            if device_type_id != self.instance.device_type_id:
                raise serializers.ValidationError({"device_type": "字段创建后不能修改绑定设备类型"})
        device_type = attrs.get("device_type", self.instance.device_type if self.instance else None)
        if device_type is not None and not device_type.is_active:
            raise serializers.ValidationError({"device_type": "停用的设备类型不能绑定自定义字段"})
        required = attrs.get("required", self.instance.required if self.instance else False)
        form_visible = attrs.get("form_visible", self.instance.form_visible if self.instance else True)
        if required and not form_visible:
            raise serializers.ValidationError({"form_visible": "必填字段必须在资产表单中显示"})

        config = attrs.get("validation_config", self.instance.validation_config if self.instance else {})
        try:
            attrs["validation_config"] = _normalize_validation_config(field_type, config)
        except ValueError as exc:
            raise serializers.ValidationError({"validation_config": str(exc)}) from exc

        default_value = attrs.get("default_value", self.instance.default_value if self.instance else "")
        if "default_value" in self.initial_data and not isinstance(self.initial_data["default_value"], str):
            raise serializers.ValidationError({"default_value": "默认值必须是字符串"})
        active_options = set()
        if self.instance:
            active_options = set(self.instance.options.filter(is_active=True).values_list("value", flat=True))
        try:
            attrs["default_value"] = _validate_default_value(field_type, default_value, active_options)
        except ValueError as exc:
            raise serializers.ValidationError({"default_value": str(exc)}) from exc
        return attrs

    class Meta:
        model = CustomField
        fields = [
            "id", "device_type", "device_type_name", "key", "name", "field_type", "field_type_label",
            "required", "default_value", "sort_order", "is_active", "group", "help_text", "placeholder",
            "form_visible", "detail_visible", "list_visible", "filterable", "validation_config",
            "assets_count", "options", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "device_type_name", "field_type_label", "assets_count", "options", "created_at", "updated_at"]


class CustomFieldRuntimeOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomFieldOption
        fields = ["id", "value", "label", "sort_order", "is_active"]


class CustomFieldRuntimeSchemaSerializer(serializers.ModelSerializer):
    options = CustomFieldRuntimeOptionSerializer(many=True, read_only=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)

    class Meta:
        model = CustomField
        fields = [
            "id", "key", "name", "device_type", "device_type_name", "field_type", "required", "sort_order",
            "group", "default_value", "help_text", "placeholder", "form_visible", "detail_visible",
            "list_visible", "filterable", "is_active", "validation_config", "options",
        ]


class TagSerializer(serializers.ModelSerializer):
    assets_count = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("标签名称不能为空")
        queryset = Tag.objects.filter(name__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("标签名称已存在")
        return value

    class Meta:
        model = Tag
        fields = ["id", "name", "is_active", "assets_count", "created_at", "updated_at"]
        read_only_fields = ["id", "assets_count", "created_at", "updated_at"]


class SparePartSerializer(serializers.ModelSerializer):
    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    total_quantity = serializers.IntegerField(read_only=True)
    location_count = serializers.IntegerField(read_only=True)
    part_type_label = serializers.SerializerMethodField()

    def get_part_type_label(self, obj) -> str:
        return dict(SparePart.PART_TYPES).get(obj.part_type, obj.part_type)

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("备件名称不能为空")
        return value

    def validate_unit(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("计量单位不能为空")
        return value

    class Meta:
        model = SparePart
        fields = [
            "id", "name", "part_type", "part_type_label", "manufacturer", "manufacturer_name", "model",
            "specification", "unit", "is_active", "notes", "total_quantity", "location_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "manufacturer_name", "part_type_label", "total_quantity", "location_count", "created_at", "updated_at"]


class SpareStockSerializer(serializers.ModelSerializer):
    part_name = serializers.CharField(source="part.name", read_only=True)
    part_type_label = serializers.SerializerMethodField()
    data_center_name = serializers.CharField(source="data_center.name", read_only=True)
    server_room_name = serializers.CharField(source="server_room.name", read_only=True, allow_null=True)

    def get_part_type_label(self, obj) -> str:
        return dict(SparePart.PART_TYPES).get(obj.part.part_type, obj.part.part_type)

    class Meta:
        model = SpareStock
        fields = [
            "id", "part", "part_name", "part_type_label", "data_center", "data_center_name",
            "server_room", "server_room_name", "quantity", "updated_at",
        ]
        read_only_fields = fields


class SpareStockTransactionSerializer(serializers.ModelSerializer):
    operation_type_label = serializers.SerializerMethodField()
    part_name = serializers.CharField(source="part.name", read_only=True)
    unit = serializers.CharField(source="part.unit", read_only=True)
    source_data_center_name = serializers.CharField(source="source_data_center.name", read_only=True, allow_null=True)
    source_server_room_name = serializers.CharField(source="source_server_room.name", read_only=True, allow_null=True)
    target_data_center_name = serializers.CharField(source="target_data_center.name", read_only=True, allow_null=True)
    target_server_room_name = serializers.CharField(source="target_server_room.name", read_only=True, allow_null=True)
    operator_name = serializers.SerializerMethodField()
    target_quantity = serializers.IntegerField(write_only=True, required=False, min_value=0)

    def get_operation_type_label(self, obj) -> str:
        return dict(SpareStockTransaction.OPERATION_TYPES).get(obj.operation_type, obj.operation_type)

    def get_operator_name(self, obj) -> str:
        return (obj.operator.get_full_name() or obj.operator.username) if obj.operator else "已删除账号"

    def validate(self, attrs):
        operation_type = attrs.get("operation_type")
        if operation_type not in dict(SpareStockTransaction.OPERATION_TYPES):
            raise serializers.ValidationError({"operation_type": "不支持的库存操作类型"})
        quantity = attrs.get("quantity", 0)
        if operation_type != "adjustment" and quantity <= 0:
            raise serializers.ValidationError({"quantity": "数量必须大于 0"})
        if operation_type == "adjustment" and "target_quantity" not in self.initial_data:
            raise serializers.ValidationError({"target_quantity": "盘点调整必须填写调整后库存"})
        if operation_type in {"outbound", "scrap", "transfer"} and not attrs.get("source_data_center"):
            raise serializers.ValidationError({"source_data_center": "必须选择来源数据中心"})
        if operation_type in {"inbound", "transfer", "adjustment"} and not attrs.get("target_data_center"):
            raise serializers.ValidationError({"target_data_center": "必须选择目标数据中心"})
        if operation_type == "transfer" and not attrs.get("target_data_center"):
            raise serializers.ValidationError({"target_data_center": "调拨必须选择目标数据中心"})
        return attrs

    class Meta:
        model = SpareStockTransaction
        fields = [
            "id", "part", "part_name", "unit", "operation_type", "operation_type_label", "quantity",
            "source_data_center", "source_data_center_name", "source_server_room", "source_server_room_name",
            "target_data_center", "target_data_center_name", "target_server_room", "target_server_room_name",
            "before_quantity", "after_quantity", "operator", "operator_name", "reference", "notes", "created_at",
            "target_quantity",
        ]
        read_only_fields = [
            "id", "part_name", "unit", "operation_type_label", "source_data_center_name", "source_server_room_name",
            "target_data_center_name", "target_server_room_name", "before_quantity", "after_quantity", "operator",
            "operator_name", "created_at",
        ]


class SparePartDetailSerializer(SparePartSerializer):
    stock_locations = serializers.SerializerMethodField()
    recent_transactions = serializers.SerializerMethodField()

    def get_stock_locations(self, obj) -> list[dict[str, Any]]:
        stocks = obj.stocks.select_related("data_center", "server_room").order_by(
            "data_center__name", "server_room__name", "id"
        )
        return SpareStockSerializer(stocks, many=True).data

    def get_recent_transactions(self, obj) -> list[dict[str, Any]]:
        transactions = obj.transactions.select_related(
            "operator", "source_data_center", "source_server_room",
            "target_data_center", "target_server_room",
        ).order_by("-created_at", "-id")[:20]
        return SpareStockTransactionSerializer(transactions, many=True).data

    class Meta(SparePartSerializer.Meta):
        fields = SparePartSerializer.Meta.fields + ["stock_locations", "recent_transactions"]
        read_only_fields = SparePartSerializer.Meta.read_only_fields + [
            "stock_locations", "recent_transactions",
        ]


class SoftwareLicenseSerializer(serializers.ModelSerializer):
    manufacturer = ManufacturerReferenceSerializer(read_only=True)
    manufacturer_id = serializers.PrimaryKeyRelatedField(
        source="manufacturer",
        queryset=Manufacturer.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    utilization = serializers.SerializerMethodField()
    remaining_count = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()
    days_remaining = serializers.SerializerMethodField()

    def _status(self, obj):
        return license_status_value(obj)

    def get_utilization(self, obj) -> float:
        if not obj.authorized_count:
            return 0
        return round(obj.used_count / obj.authorized_count * 100, 1)

    def get_remaining_count(self, obj) -> int:
        return obj.authorized_count - obj.used_count

    def get_status(self, obj) -> str:
        return self._status(obj)

    def get_status_label(self, obj) -> str:
        return {"expired": "已过期", "expiring": "即将到期", "normal": "正常"}[self._status(obj)]

    def get_days_remaining(self, obj) -> int | None:
        return (obj.expiry_date - timezone.localdate()).days if obj.expiry_date else None

    def validate(self, attrs):
        removed_fields = {
            field: "厂商字段已统一为 Manufacturer，请使用 manufacturer_id"
            for field in ("vendor", "publisher", "manufacturer_name", "software_vendor")
            if field in self.initial_data
        }
        if removed_fields:
            raise serializers.ValidationError(removed_fields)
        authorized_count = attrs.get("authorized_count", self.instance.authorized_count if self.instance else 0)
        used_count = attrs.get("used_count", self.instance.used_count if self.instance else 0)
        if authorized_count < 0 or used_count < 0:
            raise serializers.ValidationError("授权数和已用数不能为负数")
        if used_count > authorized_count:
            raise serializers.ValidationError({"used_count": "已用授权数不能超过授权数"})
        manufacturer = attrs.get("manufacturer")
        if manufacturer and not manufacturer.is_active and (
            not self.instance or self.instance.manufacturer_id != manufacturer.pk
        ):
            raise serializers.ValidationError({"manufacturer_id": "停用的厂商不能用于新许可或修改许可"})
        return attrs

    class Meta:
        model = SoftwareLicense
        fields = [
            "id", "name", "manufacturer", "manufacturer_id", "license_type", "authorized_count", "used_count",
            "utilization", "remaining_count", "expiry_date", "status", "status_label",
            "days_remaining", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "utilization", "remaining_count", "status", "status_label", "days_remaining", "created_at", "updated_at"]


class DataCenterSerializer(serializers.ModelSerializer):
    assets_count = serializers.IntegerField(read_only=True)
    rooms_count = serializers.IntegerField(read_only=True)
    class Meta:
        model = DataCenter
        fields = ["id", "name", "address", "is_active", "assets_count", "rooms_count", "created_at", "updated_at"]
        read_only_fields = ["id", "assets_count", "rooms_count", "created_at", "updated_at"]

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("名称不能为空")
        queryset = DataCenter.objects.filter(name__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("数据中心名称已存在")
        return value


class ServerRoomSerializer(serializers.ModelSerializer):
    data_center_name = serializers.CharField(source="data_center.name", read_only=True)
    racks_count = serializers.IntegerField(read_only=True)
    assets_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = ServerRoom
        fields = [
            "id", "data_center", "data_center_name", "name", "is_active",
            "owner_name", "contact_phone", "notes",
            "racks_count", "assets_count", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "data_center_name", "racks_count", "assets_count",
            "created_at", "updated_at",
        ]

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("机房名称不能为空")
        return value

    def validate(self, attrs):
        data_center = attrs.get(
            "data_center", self.instance.data_center if self.instance else None
        )
        name = attrs.get("name", self.instance.name if self.instance else "")
        queryset = ServerRoom.objects.filter(data_center=data_center, name__iexact=name)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError({"name": "该数据中心下已存在同名机房"})
        if data_center and not data_center.is_active and (
            self.instance is None or data_center.id != self.instance.data_center_id
        ):
            raise serializers.ValidationError({"data_center": "停用的数据中心不能新增或接收机房"})
        return attrs


class RackUnitAllocationSerializer(serializers.ModelSerializer):
    units = serializers.IntegerField(read_only=True)
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    asset_type = serializers.CharField(source="asset.asset_type", read_only=True)
    manufacturer_model = serializers.CharField(source="asset.manufacturer_model", read_only=True)
    manufacturer_name = serializers.CharField(source="asset.manufacturer.name", read_only=True, allow_null=True)
    model_name = serializers.CharField(source="asset.model", read_only=True)
    serial_number = serializers.CharField(source="asset.serial_number", read_only=True)
    status = serializers.CharField(source="asset.status", read_only=True)
    device_type_name = serializers.CharField(source="asset.device_type.name", read_only=True, allow_null=True)
    device_type_color = serializers.CharField(source="asset.device_type.color", read_only=True, allow_null=True)
    rack_code = serializers.CharField(source="rack.code", read_only=True)
    data_center = serializers.CharField(source="rack.room.data_center.name", read_only=True)
    data_center_id = serializers.IntegerField(source="rack.room.data_center_id", read_only=True)
    server_room = serializers.CharField(source="rack.room.name", read_only=True)

    class Meta:
        model = RackUnitAllocation
        fields = ["id", "asset", "rack", "rack_code", "data_center", "data_center_id", "server_room", "start_u", "end_u", "units", "asset_no", "asset_name", "asset_type", "device_type_name", "device_type_color", "manufacturer_name", "model_name", "manufacturer_model", "serial_number", "status"]


class RackUnitAllocationDetailSerializer(serializers.ModelSerializer):
    rack_code = serializers.CharField(source="rack.code", read_only=True)
    data_center = serializers.CharField(source="rack.room.data_center.name", read_only=True)
    data_center_id = serializers.IntegerField(source="rack.room.data_center_id", read_only=True)
    server_room = serializers.CharField(source="rack.room.name", read_only=True)
    server_room_id = serializers.IntegerField(source="rack.room_id", read_only=True)
    units = serializers.IntegerField(read_only=True)
    rack_total_u = serializers.IntegerField(source="rack.total_u", read_only=True)

    class Meta:
        model = RackUnitAllocation
        fields = ["id", "asset", "rack", "rack_code", "data_center", "data_center_id", "server_room", "server_room_id", "rack_total_u", "start_u", "end_u", "units"]


class ProcurementRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcurementRecord
        fields = ["id", "asset", "purchase_date", "supplier", "order_no", "amount", "notes", "created_at", "updated_at"]


class MaintenanceContractSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceContract
        fields = ["id", "asset", "provider", "contract_no", "start_date", "expiry_date", "notes", "created_at", "updated_at"]


def _raw_custom_value(value):
    field = value.field
    if field.field_type in {"text", "textarea", "select"}:
        return value.text_value
    if field.field_type == "number":
        return str(value.number_value) if value.number_value is not None else None
    if field.field_type == "date":
        return value.date_value.isoformat() if value.date_value else None
    if field.field_type == "boolean":
        return value.boolean_value
    return value.json_value


def _asset_custom_fields(obj):
    values_by_field = {
        item.field_id: _raw_custom_value(item)
        for item in obj.custom_values.select_related("field").prefetch_related("field__options").all()
    }
    scope = Q(device_type__isnull=True)
    if obj.device_type_id:
        scope |= Q(device_type_id=obj.device_type_id)
    fields = CustomField.objects.filter(scope).select_related("device_type").prefetch_related("options").order_by("sort_order", "id")
    # Include disabled historical fields even when the device type still has
    # them defined, so old values remain visible and read-only in the UI.
    known_ids = {field.id for field in fields}
    historical = CustomField.objects.filter(asset_values__asset=obj).exclude(pk__in=known_ids).select_related("device_type").prefetch_related("options")
    result = []
    for field in list(fields) + list(historical):
        result.append({
            "id": field.id,
            "key": field.key,
            "name": field.name,
            "device_type": field.device_type_id,
            "device_type_name": field.device_type.name if field.device_type_id else None,
            "field_type": field.field_type,
            "field_type_label": dict(CustomField.FIELD_TYPES).get(field.field_type, field.field_type),
            "required": field.required,
            "default_value": field.default_value,
            "group": field.group,
            "help_text": field.help_text,
            "placeholder": field.placeholder,
            "form_visible": field.form_visible,
            "detail_visible": field.detail_visible,
            "list_visible": field.list_visible,
            "validation_config": field.validation_config,
            "is_active": field.is_active,
            "value": values_by_field.get(field.id),
            "options": [
                {"id": option.id, "value": option.value, "label": option.label, "sort_order": option.sort_order, "is_active": option.is_active}
                for option in field.options.all()
            ],
        })
    return result


def _asset_custom_values(obj):
    return {field["key"]: field["value"] for field in _asset_custom_fields(obj) if field["value"] is not None}


class AssetSerializer(serializers.ModelSerializer):
    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)
    asset_data_center_name = serializers.CharField(source="asset_data_center.name", read_only=True, allow_null=True)
    model_name = serializers.CharField(source="model", read_only=True)
    network_addresses = AssetNetworkAddressSerializer(many=True, read_only=True)
    rack_allocation = RackUnitAllocationSerializer(read_only=True)
    procurement_records = ProcurementRecordSerializer(many=True, read_only=True)
    maintenance_contracts = MaintenanceContractSerializer(many=True, read_only=True)
    tag_names = serializers.SerializerMethodField()

    def get_tag_names(self, obj) -> list[str]:
        return [item.tag.name for item in obj.asset_tags.select_related("tag").all()]

    class Meta:
        model = Asset
        fields = "__all__"


class DepreciationListResponseSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=["unconfigured", "not_started", "depreciating", "fully_depreciated"],
        read_only=True,
    )
    net_book_value = serializers.CharField(allow_null=True, read_only=True)
    accumulated_depreciation = serializers.CharField(allow_null=True, read_only=True)


class AssetListSerializer(serializers.ModelSerializer):
    """Small, flat representation used by the paged asset ledger.

    The detail endpoint intentionally keeps the historical nested payload.  The
    list endpoint can opt into this representation with ``compact=1`` so a
    page of assets does not materialize every procurement, maintenance and IP
    column into a large nested JSON document.
    """

    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)
    asset_data_center_name = serializers.CharField(source="asset_data_center.name", read_only=True, allow_null=True)
    model_name = serializers.CharField(source="model", read_only=True)
    business_ip = serializers.SerializerMethodField()
    management_ip = serializers.SerializerMethodField()
    oob_ip = serializers.SerializerMethodField()
    data_center = serializers.SerializerMethodField()
    server_room = serializers.SerializerMethodField()
    rack_code = serializers.SerializerMethodField()
    u_range = serializers.SerializerMethodField()
    purchase_date = serializers.SerializerMethodField()
    supplier = serializers.SerializerMethodField()
    purchase_order_no = serializers.SerializerMethodField()
    maintenance_provider = serializers.SerializerMethodField()
    maintenance_expiry_date = serializers.SerializerMethodField()
    depreciation = serializers.SerializerMethodField()
    tag_names = serializers.SerializerMethodField()
    custom_values = serializers.SerializerMethodField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._depreciation_as_of_date = timezone.localdate()
        if not self.context.get("requested_custom_columns"):
            self.fields.pop("custom_values", None)

    def _network(self, obj, role):
        for address in obj.network_addresses.all():
            if address.role == role:
                return address.address
        return ""

    def _allocation(self, obj):
        return getattr(obj, "rack_allocation", None)

    def _procurement(self, obj):
        records = obj._prefetched_objects_cache.get("procurement_records") if hasattr(obj, "_prefetched_objects_cache") else None
        if records is not None:
            return records[0] if records else None
        return obj.procurement_records.order_by("-purchase_date", "-id").first()

    def _maintenance(self, obj):
        records = obj._prefetched_objects_cache.get("maintenance_contracts") if hasattr(obj, "_prefetched_objects_cache") else None
        if records is not None:
            return records[0] if records else None
        return obj.maintenance_contracts.order_by("-updated_at", "-id").first()

    def get_business_ip(self, obj) -> str:
        return self._network(obj, "business")

    def get_management_ip(self, obj) -> str:
        return self._network(obj, "management")

    def get_oob_ip(self, obj) -> str:
        return self._network(obj, "oob")

    def get_data_center(self, obj) -> str:
        allocation = self._allocation(obj)
        if allocation:
            return allocation.rack.room.data_center.name
        return obj.asset_data_center.name if obj.asset_data_center_id else ""

    def get_server_room(self, obj) -> str:
        allocation = self._allocation(obj)
        return allocation.rack.room.name if allocation else ""

    def get_rack_code(self, obj) -> str:
        allocation = self._allocation(obj)
        return allocation.rack.code if allocation else ""

    def get_u_range(self, obj) -> str:
        allocation = self._allocation(obj)
        return f"U{allocation.start_u}–U{allocation.end_u}" if allocation else ""

    def get_purchase_date(self, obj) -> date | None:
        record = self._procurement(obj)
        return record.purchase_date if record else None

    def get_supplier(self, obj) -> str:
        record = self._procurement(obj)
        return record.supplier if record else ""

    def get_purchase_order_no(self, obj) -> str:
        record = self._procurement(obj)
        return record.order_no if record else ""

    def get_maintenance_provider(self, obj) -> str:
        record = self._maintenance(obj)
        return record.provider if record else ""

    def get_maintenance_expiry_date(self, obj) -> date | None:
        record = self._maintenance(obj)
        return record.expiry_date if record else None

    @extend_schema_field(DepreciationListResponseSerializer)
    def get_depreciation(self, obj) -> dict[str, object]:
        result = calculate_asset_depreciation(obj, as_of_date=self._depreciation_as_of_date)
        return {
            "status": result["status"],
            "net_book_value": result["net_book_value"],
            "accumulated_depreciation": result["accumulated_depreciation"],
        }

    def get_tag_names(self, obj) -> list[str]:
        return [item.tag.name for item in obj.asset_tags.select_related("tag").all()]

    def get_custom_values(self, obj) -> dict[str, object]:
        values = {}
        for item in getattr(obj, "list_custom_values", ()):
            field = item.field
            if field.device_type_id not in {None, obj.device_type_id}:
                continue
            values[field.key] = _raw_custom_value(item)
        return values

    class Meta:
        model = Asset
        fields = [
            "id", "created_at", "updated_at", "asset_no", "name", "asset_type",
            "manufacturer", "manufacturer_name", "device_type",
            "device_type_name", "asset_data_center", "asset_data_center_name", "model", "model_name", "manufacturer_model",
            "serial_number", "purpose", "status", "department", "owner_name", "notes",
            "business_ip", "management_ip", "oob_ip", "data_center", "server_room",
            "rack_code", "u_range", "purchase_date", "supplier", "purchase_order_no",
            "maintenance_provider", "maintenance_expiry_date", "depreciation",
            "tag_names", "custom_values",
        ]


class DepreciationResponseSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=["straight_line"], allow_null=True, read_only=True)
    start_date = serializers.DateField(allow_null=True, read_only=True)
    years = serializers.IntegerField(allow_null=True, read_only=True)
    residual_rate = serializers.CharField(allow_null=True, read_only=True)
    original_value = serializers.CharField(allow_null=True, read_only=True)
    residual_value = serializers.CharField(allow_null=True, read_only=True)
    monthly_depreciation = serializers.CharField(allow_null=True, read_only=True)
    accumulated_depreciation = serializers.CharField(allow_null=True, read_only=True)
    net_book_value = serializers.CharField(allow_null=True, read_only=True)
    elapsed_months = serializers.IntegerField(allow_null=True, read_only=True)
    total_months = serializers.IntegerField(allow_null=True, read_only=True)
    progress = serializers.CharField(allow_null=True, read_only=True)
    status = serializers.ChoiceField(
        choices=["unconfigured", "not_started", "depreciating", "fully_depreciated"],
        read_only=True,
    )


class AssetDetailSerializer(serializers.ModelSerializer):
    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)
    asset_data_center_name = serializers.CharField(source="asset_data_center.name", read_only=True, allow_null=True)
    model_name = serializers.CharField(source="model", read_only=True)
    network_addresses = AssetNetworkAddressSerializer(many=True, read_only=True)
    rack_allocation = RackUnitAllocationDetailSerializer(read_only=True)
    procurement_records = ProcurementRecordSerializer(many=True, read_only=True)
    maintenance_contracts = MaintenanceContractSerializer(many=True, read_only=True)
    inventory_records = serializers.SerializerMethodField()
    tags = serializers.SerializerMethodField()
    custom_fields = serializers.SerializerMethodField()
    custom_values = serializers.SerializerMethodField()
    depreciation = serializers.SerializerMethodField()

    def get_inventory_records(self, obj) -> list[dict[str, Any]]:
        return InventoryItemSerializer(
            obj.inventory_items.select_related("asset", "task", "task__data_center", "task__server_room", "checked_by", "resolved_by", "actual_rack__room__data_center"),
            many=True,
        ).data

    def get_tags(self, obj) -> list[dict[str, Any]]:
        return [{"id": item.tag_id, "name": item.tag.name, "is_active": item.tag.is_active} for item in obj.asset_tags.select_related("tag").all()]

    def get_custom_fields(self, obj) -> list[dict[str, Any]]:
        return _asset_custom_fields(obj)

    def get_custom_values(self, obj) -> dict[str, Any]:
        return _asset_custom_values(obj)

    @extend_schema_field(DepreciationResponseSerializer)
    def get_depreciation(self, obj) -> dict[str, object]:
        return calculate_asset_depreciation(obj)

    class Meta:
        model = Asset
        fields = [
            "id", "created_at", "updated_at", "asset_no", "name", "asset_type", "manufacturer", "manufacturer_name", "device_type", "device_type_name", "asset_data_center", "asset_data_center_name", "model", "model_name", "manufacturer_model",
            "serial_number", "purpose", "status", "department", "owner_name", "notes", "depreciation_start_date", "depreciation_years", "residual_rate", "depreciation_method",
            "network_addresses", "rack_allocation", "procurement_records", "maintenance_contracts", "inventory_records", "tags", "custom_fields", "custom_values",
            "depreciation",
        ]


class AssetWriteSerializer(serializers.ModelSerializer):
    DERIVED_DEPRECIATION_FIELDS = {
        "depreciation",
        "original_value",
        "residual_value",
        "monthly_depreciation",
        "accumulated_depreciation",
        "net_book_value",
        "elapsed_months",
        "total_months",
        "progress",
    }
    id = serializers.IntegerField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
    configuration = serializers.JSONField(write_only=True, required=False)
    tags = serializers.PrimaryKeyRelatedField(many=True, queryset=Tag.objects.all(), required=False, write_only=True)
    custom_values = serializers.JSONField(required=False, write_only=True)
    manufacturer = serializers.PrimaryKeyRelatedField(read_only=True)
    manufacturer_id = serializers.PrimaryKeyRelatedField(
        source="manufacturer",
        queryset=Manufacturer.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )

    class Meta:
        model = Asset
        fields = ["id", "created_at", "updated_at", "asset_no", "name", "asset_type", "manufacturer", "manufacturer_id", "device_type", "asset_data_center", "model", "manufacturer_model", "serial_number", "purpose", "status", "department", "owner_name", "notes", "depreciation_start_date", "depreciation_years", "residual_rate", "depreciation_method", "configuration", "tags", "custom_values"]
        read_only_fields = ["id", "created_at", "updated_at", "asset_type"]

    def _stored_procurement_amount(self):
        if not self.instance:
            return None
        cache = getattr(self.instance, "_prefetched_objects_cache", {})
        if "procurement_records" in cache:
            records = cache["procurement_records"]
            return records[0].amount if records else None
        return self.instance.procurement_records.order_by("-purchase_date", "-id").values_list("amount", flat=True).first()

    @staticmethod
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

    def _prospective_procurement_amount(self, attrs):
        if "configuration" in attrs:
            return self._submitted_procurement_amount(attrs.get("configuration"))
        return self._stored_procurement_amount()

    def _validate_depreciation(self, attrs):
        current = self.instance
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
                amount=self._prospective_procurement_amount(attrs),
            )
        except DepreciationValidationError as exc:
            raise serializers.ValidationError(exc.errors) from exc

    def to_internal_value(self, data):
        data = data.copy()
        for field in (
            "depreciation_start_date",
            "depreciation_years",
            "residual_rate",
            "depreciation_method",
        ):
            if data.get(field) == "":
                data[field] = None
        return super().to_internal_value(data)

    @staticmethod
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

    def _validate_direct_asset_data_center(self, instance, requested_data_center) -> None:
        allocation = RackUnitAllocation.objects.select_related(
            "rack__room__data_center"
        ).filter(asset=instance).first()
        if allocation is not None and getattr(requested_data_center, "pk", None) != allocation.rack.room.data_center_id:
            raise DjangoValidationError({
                "asset_data_center": "已上架资产的数据中心由机柜位置决定，请通过机柜位置调整",
            })

    def validate(self, attrs):
        derived_fields = self.DERIVED_DEPRECIATION_FIELDS & set(self.initial_data)
        if derived_fields:
            field = sorted(derived_fields)[0]
            raise serializers.ValidationError({field: "折旧派生值只读，不能提交"})
        if "status_before_repair" in self.initial_data:
            raise serializers.ValidationError({"status_before_repair": "该字段由维修流程维护"})
        if "category" in self.initial_data:
            raise serializers.ValidationError({"category": "设备分类字段已移除，请使用设备类型"})
        if "asset_type" in self.initial_data:
            raise serializers.ValidationError({"asset_type": "资产类型字段仅用于展示，请使用设备类型"})
        manufacturer = attrs.get("manufacturer")
        if manufacturer and not manufacturer.is_active and (not self.instance or self.instance.manufacturer_id != manufacturer.pk):
            raise serializers.ValidationError({"manufacturer_id": "停用的厂商不能用于新资产或修改资产"})
        device_type = attrs.get("device_type", self.instance.device_type if self.instance else None)
        if not device_type:
            raise serializers.ValidationError({"device_type": "设备类型不能为空"})
        if not device_type.is_active and (not self.instance or self.instance.device_type_id != device_type.pk):
            raise serializers.ValidationError({"device_type": "停用的设备类型不能用于新资产或修改资产"})
        attrs["device_type"] = device_type
        attrs["asset_type"] = device_type.name
        asset_data_center = attrs.get("asset_data_center")
        if asset_data_center and not asset_data_center.is_active:
            if not self.instance or self.instance.asset_data_center_id != asset_data_center.pk:
                raise serializers.ValidationError({"asset_data_center": "停用的数据中心不能用于资产"})
        if "serial_number" in attrs and not attrs["serial_number"]:
            attrs["serial_number"] = None
        if "status" in attrs:
            requested_status = attrs["status"]
            if requested_status == "repair" and (not self.instance or self.instance.status != "repair"):
                raise serializers.ValidationError({"status": "维修中状态由故障维修流程维护，不能手工设置"})
            if self.instance and requested_status != "repair" and FaultEvent.objects.filter(
                asset_id=self.instance.pk,
                is_closed=False,
            ).exists():
                raise serializers.ValidationError({"status": "存在未关闭故障时，资产状态由维修流程维护"})
        self._validate_depreciation(attrs)
        return attrs

    def create(self, validated_data):
        configuration = validated_data.pop("configuration", {})
        tags = validated_data.pop("tags", None)
        custom_values = validated_data.pop("custom_values", {})
        try:
            with transaction.atomic():
                asset = Asset.objects.create(**validated_data)
                configure_asset(asset, configuration)
                apply_asset_custom_values(asset, custom_values, is_create=True)
                apply_asset_tags(asset, tags or [])
        except DjangoValidationError as exc:
            raise serializers.ValidationError(getattr(exc, "message_dict", {"configuration": exc.messages})) from exc
        except IntegrityError as exc:
            raise serializers.ValidationError({"configuration": "关联信息已存在或与其他资产冲突"}) from exc
        return asset

    def update(self, instance, validated_data):
        configuration = validated_data.pop("configuration", None)
        tags = validated_data.pop("tags", None)
        custom_values = validated_data.pop("custom_values", None)
        missing = object()
        requested_asset_data_center = validated_data.get("asset_data_center", missing)
        old_device_type_id = instance.device_type_id
        try:
            with transaction.atomic():
                if (
                    requested_asset_data_center is not missing
                    and not self._configuration_includes_placement(configuration)
                ):
                    self._validate_direct_asset_data_center(instance, requested_asset_data_center)
                for key, value in validated_data.items():
                    setattr(instance, key, value)
                instance.save()
                if configuration is not None:
                    configure_asset(instance, configuration)
                apply_asset_custom_values(
                    instance,
                    custom_values or {},
                    submitted=custom_values is not None,
                    old_device_type_id=old_device_type_id,
                )
                if tags is not None:
                    apply_asset_tags(instance, tags)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(getattr(exc, "message_dict", {"configuration": exc.messages})) from exc
        except IntegrityError as exc:
            raise serializers.ValidationError({"configuration": "关联信息已存在或与其他资产冲突"}) from exc
        return instance


class InventoryScopePreviewQuerySerializer(serializers.Serializer):
    """Validated query parameters for the read-only inventory scope preview."""

    data_center = serializers.PrimaryKeyRelatedField(queryset=DataCenter.objects.all())
    server_room = serializers.PrimaryKeyRelatedField(
        queryset=ServerRoom.objects.select_related("data_center"),
        required=False,
        allow_null=True,
    )

    def validate(self, attrs):
        data_center = attrs["data_center"]
        server_room = attrs.get("server_room")
        if not data_center.is_active:
            raise serializers.ValidationError({"data_center": "停用的数据中心不能创建盘点任务"})
        if server_room is not None:
            if server_room.data_center_id != data_center.id:
                raise serializers.ValidationError({"server_room": "机房不属于所选数据中心"})
            if not server_room.is_active:
                raise serializers.ValidationError({"server_room": "停用的机房不能创建盘点任务"})
        return attrs


class InventoryScopeLocationSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class InventoryScopePreviewSerializer(serializers.Serializer):
    data_center = InventoryScopeLocationSerializer()
    server_room = InventoryScopeLocationSerializer(allow_null=True)
    scope_label = serializers.CharField()
    total = serializers.IntegerField()
    racked = serializers.IntegerField()
    unracked = serializers.IntegerField()
    retired = serializers.IntegerField()
    includes_unracked = serializers.BooleanField()
    warnings = serializers.ListField(child=serializers.CharField())


INVENTORY_STATUS_LABELS = dict(InventoryItem.STATUS)
INVENTORY_RESOLUTION_STATUS_LABELS = dict(InventoryItem.RESOLUTION_STATUS)
INVENTORY_RESOLUTION_ACTION_LABELS = dict(InventoryItem.RESOLUTION_ACTION)


class InventoryResolutionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=InventoryItem.RESOLUTION_ACTION)
    note = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)

    def validate(self, attrs):
        validate_inventory_resolution_request(
            attrs.get("action"),
            attrs.get("note", ""),
        )
        return attrs


class InventoryBulkResolutionSerializer(serializers.Serializer):
    item_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    action = serializers.ChoiceField(choices=InventoryItem.RESOLUTION_ACTION)
    note = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)

    def validate_item_ids(self, value):
        unique_ids = list(dict.fromkeys(value))
        if len(unique_ids) > 100:
            raise serializers.ValidationError("一次最多处理 100 条盘点异常")
        return unique_ids

    def validate(self, attrs):
        validate_inventory_resolution_request(
            attrs.get("action"),
            attrs.get("note", ""),
            bulk=True,
        )
        return attrs


class InventoryBulkResolutionResultSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    asset_no = serializers.CharField()
    success = serializers.BooleanField()
    reason = serializers.CharField(allow_blank=True)


class InventoryBulkResolutionResponseSerializer(serializers.Serializer):
    requested = serializers.IntegerField()
    succeeded = serializers.IntegerField()
    failed = serializers.IntegerField()
    results = InventoryBulkResolutionResultSerializer(many=True)


class InventoryBulkNormalSerializer(serializers.Serializer):
    item_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )

    def validate_item_ids(self, value):
        unique_ids = list(dict.fromkeys(value))
        if len(unique_ids) > 100:
            raise serializers.ValidationError("一次最多标记 100 条盘点项")
        return unique_ids


class InventoryBulkNormalResultSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    asset_no = serializers.CharField()
    success = serializers.BooleanField()
    reason = serializers.CharField(allow_blank=True)


class InventoryBulkNormalResponseSerializer(serializers.Serializer):
    requested = serializers.IntegerField()
    succeeded = serializers.IntegerField()
    failed = serializers.IntegerField()
    results = InventoryBulkNormalResultSerializer(many=True)


class InventoryItemSerializer(serializers.ModelSerializer):
    task_name = serializers.CharField(source="task.name", read_only=True)
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    asset_type = serializers.CharField(source="asset.asset_type", read_only=True)
    serial_number = serializers.CharField(source="asset.serial_number", read_only=True, allow_null=True)
    status_label = serializers.SerializerMethodField()
    checked_by_name = serializers.SerializerMethodField()
    system_data_center = serializers.SerializerMethodField()
    system_server_room = serializers.SerializerMethodField()
    system_rack_code = serializers.SerializerMethodField()
    system_start_u = serializers.SerializerMethodField()
    system_end_u = serializers.SerializerMethodField()
    actual_data_center = serializers.CharField(source="actual_rack.room.data_center.name", read_only=True, allow_null=True)
    actual_server_room = serializers.CharField(source="actual_rack.room.name", read_only=True, allow_null=True)
    actual_rack_code = serializers.CharField(source="actual_rack.code", read_only=True, allow_null=True)
    resolution_status_label = serializers.SerializerMethodField()
    resolution_action_label = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()

    def get_status_label(self, obj) -> str:
        return INVENTORY_STATUS_LABELS.get(obj.status, obj.status)

    def get_checked_by_name(self, obj) -> str:
        return (obj.checked_by.get_full_name() or obj.checked_by.username) if obj.checked_by else ""

    def get_resolution_status_label(self, obj) -> str:
        return INVENTORY_RESOLUTION_STATUS_LABELS.get(obj.resolution_status, obj.resolution_status)

    def get_resolution_action_label(self, obj) -> str:
        return INVENTORY_RESOLUTION_ACTION_LABELS.get(obj.resolution_action, "") if obj.resolution_action else ""

    def get_resolved_by_name(self, obj) -> str:
        return (obj.resolved_by.get_full_name() or obj.resolved_by.username) if obj.resolved_by else ""

    def _snapshot(self, obj):
        return obj.system_snapshot or {}

    def get_system_data_center(self, obj) -> str:
        return self._snapshot(obj).get("data_center", "")

    def get_system_server_room(self, obj) -> str:
        return self._snapshot(obj).get("server_room", "")

    def get_system_rack_code(self, obj) -> str:
        return self._snapshot(obj).get("rack_code", "")

    def get_system_start_u(self, obj) -> int | None:
        return self._snapshot(obj).get("start_u")

    def get_system_end_u(self, obj) -> int | None:
        return self._snapshot(obj).get("end_u")

    def validate(self, attrs):
        protected_fields = {
            "resolution_status",
            "resolution_action",
            "resolution_note",
            "resolved_by",
            "resolved_at",
        }
        if any(field in self.initial_data for field in protected_fields):
            raise serializers.ValidationError({"detail": "异常处理字段只能通过专用处理接口修改"})
        task = self.instance.task if self.instance else self.context.get("task")
        if task and task.status == "completed":
            raise serializers.ValidationError({"detail": "已完成的盘点任务已锁定，不能修改"})
        status = attrs.get("status", self.instance.status if self.instance else "pending")
        if status == "normal":
            if not self.instance:
                raise serializers.ValidationError({"status": "盘点项必须来自已生成的盘点任务"})
            try:
                snapshot_rack, snapshot_start_u, snapshot_end_u = inventory_snapshot_location(self.instance)
            except DRFValidationError as exc:
                raise serializers.ValidationError(exc.detail) from exc
            attrs["actual_rack"] = snapshot_rack
            attrs["actual_start_u"] = snapshot_start_u
            attrs["actual_end_u"] = snapshot_end_u
        actual_rack = attrs.get("actual_rack", self.instance.actual_rack if self.instance else None)
        start_u = attrs.get("actual_start_u", self.instance.actual_start_u if self.instance else None)
        end_u = attrs.get("actual_end_u", self.instance.actual_end_u if self.instance else None)
        if status in {"pending", "not_found"}:
            attrs["actual_rack"] = None
            attrs["actual_start_u"] = None
            attrs["actual_end_u"] = None
        elif any(value is not None for value in (actual_rack, start_u, end_u)):
            if not actual_rack or start_u is None or end_u is None:
                raise serializers.ValidationError({"actual_rack": "实际机柜和起止 U 位必须填写完整"})
            if (
                not actual_rack.is_active
                or not actual_rack.room.is_active
                or not actual_rack.room.data_center.is_active
            ):
                raise serializers.ValidationError({"actual_rack": "实际机柜、机房或数据中心已停用，不能记录为现场位置"})
            if start_u < 1 or end_u < start_u:
                raise serializers.ValidationError({"actual_start_u": "实际 U 位范围不正确"})
            if end_u > actual_rack.total_u:
                raise serializers.ValidationError({"actual_end_u": f"实际结束 U 不能超过机柜容量 U{actual_rack.total_u}"})
        if status == "normal":
            snapshot = self.instance.system_snapshot if self.instance else {}
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
                raise serializers.ValidationError({"status": "实际位置与系统记录不一致，请选择“位置不符”"})
        return attrs

    class Meta:
        model = InventoryItem
        fields = [
            "id", "task", "task_name", "asset", "asset_no", "asset_name", "asset_type", "serial_number",
            "system_data_center", "system_server_room", "system_rack_code", "system_start_u", "system_end_u",
            "status", "status_label", "checked_at", "checked_by", "checked_by_name",
            "actual_rack", "actual_data_center", "actual_server_room", "actual_rack_code",
            "actual_start_u", "actual_end_u", "notes",
            "resolution_status", "resolution_status_label", "resolution_action", "resolution_action_label",
            "resolution_note", "resolved_by", "resolved_by_name", "resolved_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "task", "task_name", "asset", "asset_no", "asset_name", "asset_type", "serial_number",
            "system_data_center", "system_server_room", "system_rack_code", "system_start_u", "system_end_u",
            "status_label", "checked_at", "checked_by", "checked_by_name", "actual_data_center",
            "actual_server_room", "actual_rack_code", "resolution_status", "resolution_status_label",
            "resolution_action", "resolution_action_label", "resolution_note", "resolved_by",
            "resolved_by_name", "resolved_at", "created_at", "updated_at",
        ]


class InventoryTaskSerializer(serializers.ModelSerializer):
    inspector = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), required=False)
    data_center_name = serializers.CharField(source="data_center.name", read_only=True)
    server_room_name = serializers.CharField(source="server_room.name", read_only=True, allow_null=True)
    inspector_name = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    def get_inspector_name(self, obj) -> str:
        return obj.inspector.get_full_name() or obj.inspector.username

    def get_can_delete(self, obj) -> bool:
        return inventory_task_can_delete(obj)

    def get_summary(self, obj) -> dict[str, Any]:
        prefetched = getattr(obj, "_prefetched_objects_cache", {}).get("items")
        if prefetched is not None:
            counts = Counter(item.status for item in prefetched)
            resolution_counts = Counter(
                item.resolution_status
                for item in prefetched
                if item.status not in {"pending", "normal"}
            )
        else:
            rows = obj.items.values("status", "resolution_status").annotate(count=Count("id"))
            counts = Counter()
            resolution_counts = Counter()
            for row in rows:
                counts[row["status"]] += row["count"]
                if row["status"] not in {"pending", "normal"}:
                    resolution_counts[row["resolution_status"]] += row["count"]
        total = sum(counts.values())
        checked = total - counts.get("pending", 0)
        exceptions = total - counts.get("pending", 0) - counts.get("normal", 0)
        return {
            "total": total,
            "checked": checked,
            "pending": counts.get("pending", 0),
            "normal": counts.get("normal", 0),
            "exceptions": exceptions,
            "location_mismatch": counts.get("location_mismatch", 0),
            "not_found": counts.get("not_found", 0),
            "info_mismatch": counts.get("info_mismatch", 0),
            "other": counts.get("other", 0),
            "resolution_pending": resolution_counts.get("pending", 0),
            "resolution_resolved": resolution_counts.get("resolved", 0),
            "completion_rate": round(checked / total * 100, 1) if total else 0,
        }

    def validate(self, attrs):
        if self.instance and self.instance.status == "completed":
            raise serializers.ValidationError({"detail": "已完成的盘点任务已锁定，请先重新打开任务"})
        data_center = attrs.get("data_center", self.instance.data_center if self.instance else None)
        server_room = attrs.get("server_room", self.instance.server_room if self.instance else None)
        start_at = attrs.get("start_at", self.instance.start_at if self.instance else None)
        end_at = attrs.get("end_at", self.instance.end_at if self.instance else None)
        if server_room and server_room.data_center_id != data_center.id:
            raise serializers.ValidationError({"server_room": "机房不属于所选数据中心"})
        if start_at and end_at and end_at < start_at:
            raise serializers.ValidationError({"end_at": "结束时间不能早于开始时间"})
        if data_center and not data_center.is_active:
            raise serializers.ValidationError({"data_center": "停用的数据中心不能创建盘点任务"})
        if server_room and not server_room.is_active:
            raise serializers.ValidationError({"server_room": "停用的机房不能创建盘点任务"})
        if self.instance:
            if "data_center" in attrs and data_center.id != self.instance.data_center_id:
                raise serializers.ValidationError({"data_center": "任务已经生成固定清单，不能修改数据中心范围"})
            if "server_room" in attrs and (server_room.id if server_room else None) != self.instance.server_room_id:
                raise serializers.ValidationError({"server_room": "任务已经生成固定清单，不能修改机房范围"})
        return attrs

    class Meta:
        model = InventoryTask
        fields = [
            "id", "name", "data_center", "data_center_name", "server_room", "server_room_name",
            "inspector", "inspector_name", "start_at", "end_at", "status", "completed_at", "notes",
            "summary", "can_delete", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "data_center_name", "server_room_name", "inspector_name", "status", "completed_at", "summary", "can_delete", "created_at", "updated_at"]


class RackSerializer(serializers.ModelSerializer):
    allocations = RackUnitAllocationSerializer(many=True, read_only=True)
    data_center_name = serializers.CharField(source="room.data_center.name", read_only=True)
    server_room_name = serializers.CharField(source="room.name", read_only=True)
    assets_count = serializers.SerializerMethodField()
    used_u = serializers.SerializerMethodField()
    free_u = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()

    def get_assets_count(self, obj) -> int:
        return len(obj.allocations.all())

    def get_used_u(self, obj) -> int:
        """Return effective occupied U, including a single-U gap between devices.

        The gap rule is shared by the placement service, dashboard aggregates,
        and the rack management UI: a one-U gap separating two devices cannot
        be reused, while larger gaps remain available.
        """
        allocations = sorted(
            obj.allocations.all(),
            key=lambda allocation: (allocation.start_u, allocation.end_u),
        )
        occupied = sum(allocation.units for allocation in allocations)
        for previous, current in zip(allocations, allocations[1:]):
            if current.start_u - previous.end_u - 1 == 1:
                occupied += 1
        return min(occupied, obj.total_u or 0)

    def get_free_u(self, obj) -> int:
        return max((obj.total_u or 0) - self.get_used_u(obj), 0)

    def get_status_label(self, obj) -> str:
        return dict(Rack.STATUS).get(obj.status, obj.status)

    class Meta:
        model = Rack
        fields = [
            "id", "created_at", "updated_at", "room", "code", "name", "rack_type",
            "owner_name", "notes", "vendor", "total_u", "is_active", "status", "status_label",
            "data_center_name", "server_room_name", "assets_count", "used_u", "free_u", "allocations",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "data_center_name", "server_room_name", "assets_count", "used_u", "free_u", "status_label", "allocations"]
        extra_kwargs = {
            # The legacy database column is retained for migration safety, but
            # vendor is no longer part of the rack management API response.
            "vendor": {"write_only": True, "required": False},
        }

    def validate_code(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("机柜编号不能为空")
        return value

    def validate(self, attrs):
        room = attrs.get("room", self.instance.room if self.instance else None)
        code = attrs.get("code", self.instance.code if self.instance else "")
        total_u = attrs.get("total_u", self.instance.total_u if self.instance else 45)
        queryset = Rack.objects.filter(room=room, code__iexact=code)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
            highest_u = self.instance.allocations.order_by("-end_u").values_list("end_u", flat=True).first() or 0
            if total_u < highest_u:
                raise serializers.ValidationError({"total_u": f"机柜已有设备占用到 U{highest_u}，容量不能小于该位置"})
        if queryset.exists():
            raise serializers.ValidationError({"code": "该机房下已存在同编号机柜"})
        if room and not room.is_active and (
            self.instance is None or room.id != self.instance.room_id
        ):
            raise serializers.ValidationError({"room": "停用的机房不能新增或接收机柜"})
        status = attrs.get("status", self.instance.status if self.instance else "in_use")
        if "is_active" in attrs and "status" not in attrs:
            status = "in_use" if attrs["is_active"] else "disabled"
            attrs["status"] = status
        attrs["is_active"] = status != "disabled"
        if status not in dict(Rack.STATUS):
            raise serializers.ValidationError({"status": "机柜状态不正确"})
        return attrs


class AuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source="actor.username", read_only=True, allow_null=True)
    actor_display_name = serializers.SerializerMethodField()

    def get_actor_display_name(self, obj) -> str:
        return (obj.actor.get_full_name() or obj.actor.username) if obj.actor else "已删除账号"

    class Meta:
        model = AuditLog
        fields = [
            "id", "actor", "actor_username", "actor_display_name", "action",
            "resource_type", "resource_id", "payload", "created_at",
        ]
        read_only_fields = fields


class FaultEventSerializer(serializers.ModelSerializer):
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    repair = serializers.SerializerMethodField()

    def get_repair(self, obj) -> dict[str, Any] | None:
        repair = getattr(obj, "repair", None)
        return RepairRecordSerializer(repair).data if repair else None

    def validate(self, attrs):
        if "is_closed" in self.initial_data:
            raise serializers.ValidationError({"is_closed": "故障关闭状态由维修完成时间维护"})
        if "resolved_at" in self.initial_data:
            raise serializers.ValidationError({"resolved_at": "故障解决时间由维修完成时间维护"})
        return attrs

    class Meta:
        model = FaultEvent
        fields = ["id", "created_at", "updated_at", "asset", "asset_no", "asset_name", "occurred_at", "reported_at", "resolved_at", "reason", "description", "is_closed", "repair"]
        read_only_fields = ["id", "created_at", "updated_at", "asset_no", "asset_name", "resolved_at", "is_closed", "repair"]


class RepairRecordSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        unsupported = {key for key in ("cost",) if key in self.initial_data}
        if unsupported:
            raise serializers.ValidationError({key: "维修费用暂不支持通过当前维修记录接口维护" for key in sorted(unsupported)})

        started_at = attrs.get("started_at", self.instance.started_at if self.instance else None)
        finished_at = attrs.get("finished_at", self.instance.finished_at if self.instance else None)
        if started_at and finished_at and started_at > finished_at:
            raise serializers.ValidationError({
                "started_at": "维修开始时间不能晚于维修完成时间",
                "finished_at": "维修完成时间不能早于维修开始时间",
            })
        return attrs

    class Meta:
        model = RepairRecord
        fields = ["id", "fault", "provider", "started_at", "finished_at", "notes", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]
