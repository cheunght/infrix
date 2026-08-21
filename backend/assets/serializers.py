from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from collections import Counter
from django.db.models import Count
from rest_framework import serializers
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from datetime import date, timedelta
from typing import Any
import re
from .models import AuditLog, Asset, AssetCustomValue, AssetNetworkAddress, AssetTag, Brand, CustomField, CustomFieldOption, DataCenter, DeviceType, FaultEvent, InventoryItem, InventoryTask, MaintenanceContract, ProcurementRecord, Rack, RackUnitAllocation, RepairRecord, ServerRoom, SoftwareLicense, SparePart, SpareStock, SpareStockTransaction, Tag, UserSecurityProfile
from .services import apply_asset_custom_values, apply_asset_tags, apply_spare_stock_transaction, configure_asset
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

    def validate(self, attrs):
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
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        if password:
            UserSecurityProfile.objects.update_or_create(
                user=instance,
                defaults={"must_change_password": True, "password_changed_at": None},
            )
        if role_code is not None:
            group = preset_group_for_code(role_code)
            if group:
                instance.groups.set([group])
        return instance

    class Meta:
        model = User
        fields = ["id", "username", "display_name", "first_name", "last_name", "email", "is_active", "is_staff", "groups", "role_code", "assigned_role_code", "assigned_role_name", "password", "last_login", "date_joined"]
        read_only_fields = ["id", "display_name", "is_staff", "groups", "assigned_role_code", "assigned_role_name", "last_login", "date_joined"]


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


class BrandSerializer(BaseDictionarySerializer):
    class Meta(BaseDictionarySerializer.Meta):
        model = Brand


class DeviceTypeSerializer(BaseDictionarySerializer):
    def validate_color(self, value):
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value or ""):
            raise serializers.ValidationError("颜色必须是六位十六进制值，例如 #1677EF")
        return value.upper()

    class Meta(BaseDictionarySerializer.Meta):
        model = DeviceType
        fields = ["id", "name", "color", "is_active", "assets_count", "created_at", "updated_at"]


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

    class Meta:
        model = CustomFieldOption
        fields = ["id", "field", "value", "label", "sort_order", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class CustomFieldSerializer(serializers.ModelSerializer):
    options = CustomFieldOptionSerializer(many=True, read_only=True)
    assets_count = serializers.IntegerField(read_only=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True)
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
        if self.instance and "field_type" in attrs and attrs["field_type"] != self.instance.field_type:
            if self.instance.asset_values.exists():
                raise serializers.ValidationError({"field_type": "字段已有资产值，不能修改字段类型"})
        if "device_type" in attrs and not attrs["device_type"].is_active:
            raise serializers.ValidationError({"device_type": "停用的设备类型不能绑定自定义字段"})
        return attrs

    class Meta:
        model = CustomField
        fields = [
            "id", "device_type", "device_type_name", "key", "name", "field_type", "field_type_label",
            "required", "default_value", "sort_order", "is_active", "assets_count", "options", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "device_type_name", "field_type_label", "assets_count", "options", "created_at", "updated_at"]


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
    brand_name = serializers.CharField(source="brand.name", read_only=True, allow_null=True)
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
            "id", "name", "part_type", "part_type_label", "brand", "brand_name", "model",
            "specification", "unit", "is_active", "notes", "total_quantity", "location_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "brand_name", "part_type_label", "total_quantity", "location_count", "created_at", "updated_at"]


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
    utilization = serializers.SerializerMethodField()
    remaining_count = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()
    days_remaining = serializers.SerializerMethodField()

    def _status(self, obj):
        today = timezone.localdate()
        if obj.used_count > obj.authorized_count:
            return "over_limit"
        if obj.expiry_date and obj.expiry_date < today:
            return "expired"
        if obj.expiry_date and obj.expiry_date <= today + timedelta(days=90):
            return "expiring"
        return "normal"

    def get_utilization(self, obj) -> float:
        if not obj.authorized_count:
            return 0
        return round(obj.used_count / obj.authorized_count * 100, 1)

    def get_remaining_count(self, obj) -> int:
        return obj.authorized_count - obj.used_count

    def get_status(self, obj) -> str:
        return self._status(obj)

    def get_status_label(self, obj) -> str:
        return {"over_limit": "超授权", "expired": "已过期", "expiring": "即将到期", "normal": "正常"}[self._status(obj)]

    def get_days_remaining(self, obj) -> int | None:
        return (obj.expiry_date - timezone.localdate()).days if obj.expiry_date else None

    def validate(self, attrs):
        authorized_count = attrs.get("authorized_count", self.instance.authorized_count if self.instance else 0)
        used_count = attrs.get("used_count", self.instance.used_count if self.instance else 0)
        if authorized_count < 0 or used_count < 0:
            raise serializers.ValidationError("授权数和已用数不能为负数")
        if used_count > authorized_count:
            raise serializers.ValidationError({"used_count": "已用授权数不能超过授权数"})
        return attrs

    class Meta:
        model = SoftwareLicense
        fields = [
            "id", "name", "vendor", "license_type", "authorized_count", "used_count",
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
    brand_model = serializers.CharField(source="asset.brand_model", read_only=True)
    brand_name = serializers.CharField(source="asset.brand.name", read_only=True, allow_null=True)
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
        fields = ["id", "asset", "rack", "rack_code", "data_center", "data_center_id", "server_room", "start_u", "end_u", "units", "asset_no", "asset_name", "asset_type", "device_type_name", "device_type_color", "brand_name", "model_name", "brand_model", "serial_number", "status"]


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
        return float(value.number_value) if value.number_value is not None else None
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
    fields = obj.device_type.custom_fields.prefetch_related("options").all() if obj.device_type_id else []
    # Include disabled historical fields even when the device type still has
    # them defined, so old values remain visible and read-only in the UI.
    known_ids = {field.id for field in fields}
    historical = CustomField.objects.filter(asset_values__asset=obj).exclude(pk__in=known_ids).prefetch_related("options")
    result = []
    for field in list(fields) + list(historical):
        result.append({
            "id": field.id,
            "key": field.key,
            "name": field.name,
            "field_type": field.field_type,
            "field_type_label": dict(CustomField.FIELD_TYPES).get(field.field_type, field.field_type),
            "required": field.required,
            "default_value": field.default_value,
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
    brand_name = serializers.CharField(source="brand.name", read_only=True, allow_null=True)
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


class AssetListSerializer(serializers.ModelSerializer):
    """Small, flat representation used by the paged asset ledger.

    The detail endpoint intentionally keeps the historical nested payload.  The
    list endpoint can opt into this representation with ``compact=1`` so a
    page of assets does not materialize every procurement, maintenance and IP
    column into a large nested JSON document.
    """

    brand_name = serializers.CharField(source="brand.name", read_only=True, allow_null=True)
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
    tag_names = serializers.SerializerMethodField()

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

    def get_tag_names(self, obj) -> list[str]:
        return [item.tag.name for item in obj.asset_tags.select_related("tag").all()]

    class Meta:
        model = Asset
        fields = [
            "id", "created_at", "updated_at", "asset_no", "name", "asset_type",
            "brand", "brand_name", "device_type",
            "device_type_name", "asset_data_center", "asset_data_center_name", "model", "model_name", "brand_model",
            "serial_number", "purpose", "status", "department", "owner_name", "notes",
            "business_ip", "management_ip", "oob_ip", "data_center", "server_room",
            "rack_code", "u_range", "purchase_date", "supplier", "purchase_order_no",
            "maintenance_provider", "maintenance_expiry_date",
            "tag_names",
        ]


class AssetDetailSerializer(serializers.ModelSerializer):
    brand_name = serializers.CharField(source="brand.name", read_only=True, allow_null=True)
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

    def get_inventory_records(self, obj) -> list[dict[str, Any]]:
        return InventoryItemSerializer(
            obj.inventory_items.select_related("asset", "task", "task__data_center", "task__server_room", "checked_by", "actual_rack__room__data_center"),
            many=True,
        ).data

    def get_tags(self, obj) -> list[dict[str, Any]]:
        return [{"id": item.tag_id, "name": item.tag.name, "is_active": item.tag.is_active} for item in obj.asset_tags.select_related("tag").all()]

    def get_custom_fields(self, obj) -> list[dict[str, Any]]:
        return _asset_custom_fields(obj)

    def get_custom_values(self, obj) -> dict[str, Any]:
        return _asset_custom_values(obj)

    class Meta:
        model = Asset
        fields = [
            "id", "created_at", "updated_at", "asset_no", "name", "asset_type", "brand", "brand_name", "device_type", "device_type_name", "asset_data_center", "asset_data_center_name", "model", "model_name", "brand_model",
            "serial_number", "purpose", "status", "department", "owner_name", "notes",
            "network_addresses", "rack_allocation", "procurement_records", "maintenance_contracts", "inventory_records", "tags", "custom_fields", "custom_values",
        ]


class AssetWriteSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
    configuration = serializers.JSONField(write_only=True, required=False)
    tags = serializers.PrimaryKeyRelatedField(many=True, queryset=Tag.objects.all(), required=False, write_only=True)
    custom_values = serializers.JSONField(required=False, write_only=True)

    class Meta:
        model = Asset
        fields = ["id", "created_at", "updated_at", "asset_no", "name", "asset_type", "brand", "device_type", "asset_data_center", "model", "brand_model", "serial_number", "purpose", "status", "department", "owner_name", "notes", "configuration", "tags", "custom_values"]
        read_only_fields = ["id", "created_at", "updated_at", "asset_type"]

    def validate(self, attrs):
        if "category" in self.initial_data:
            raise serializers.ValidationError({"category": "设备分类字段已移除，请使用设备类型"})
        if "asset_type" in self.initial_data:
            raise serializers.ValidationError({"asset_type": "资产类型字段仅用于展示，请使用设备类型"})
        brand = attrs.get("brand")
        if brand and not brand.is_active and (not self.instance or self.instance.brand_id != brand.pk):
            raise serializers.ValidationError({"brand": "停用的品牌不能用于新资产或修改资产"})
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
        old_device_type_id = instance.device_type_id
        try:
            with transaction.atomic():
                for key, value in validated_data.items():
                    setattr(instance, key, value)
                instance.save()
                if configuration is not None:
                    configure_asset(instance, configuration)
                if custom_values is not None or old_device_type_id != instance.device_type_id:
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

    def get_status_label(self, obj) -> str:
        return INVENTORY_STATUS_LABELS.get(obj.status, obj.status)

    def get_checked_by_name(self, obj) -> str:
        return (obj.checked_by.get_full_name() or obj.checked_by.username) if obj.checked_by else ""

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
        task = self.instance.task if self.instance else self.context.get("task")
        if task and task.status == "completed":
            raise serializers.ValidationError({"detail": "已完成的盘点任务已锁定，不能修改"})
        status = attrs.get("status", self.instance.status if self.instance else "pending")
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
            "actual_start_u", "actual_end_u", "notes", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "task", "task_name", "asset", "asset_no", "asset_name", "asset_type", "serial_number",
            "system_data_center", "system_server_room", "system_rack_code", "system_start_u", "system_end_u",
            "status_label", "checked_at", "checked_by", "checked_by_name", "actual_data_center",
            "actual_server_room", "actual_rack_code", "created_at", "updated_at",
        ]


class InventoryTaskSerializer(serializers.ModelSerializer):
    inspector = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), required=False)
    data_center_name = serializers.CharField(source="data_center.name", read_only=True)
    server_room_name = serializers.CharField(source="server_room.name", read_only=True, allow_null=True)
    inspector_name = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()

    def get_inspector_name(self, obj) -> str:
        return obj.inspector.get_full_name() or obj.inspector.username

    def get_summary(self, obj) -> dict[str, Any]:
        prefetched = getattr(obj, "_prefetched_objects_cache", {}).get("items")
        if prefetched is not None:
            counts = Counter(item.status for item in prefetched)
        else:
            counts = dict(obj.items.values("status").annotate(count=Count("id")).values_list("status", "count"))
        total = sum(counts.values())
        checked = total - counts.get("pending", 0)
        return {
            "total": total,
            "checked": checked,
            "pending": counts.get("pending", 0),
            "normal": counts.get("normal", 0),
            "location_mismatch": counts.get("location_mismatch", 0),
            "not_found": counts.get("not_found", 0),
            "info_mismatch": counts.get("info_mismatch", 0),
            "other": counts.get("other", 0),
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
            "summary", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "data_center_name", "server_room_name", "inspector_name", "status", "completed_at", "summary", "created_at", "updated_at"]


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

    class Meta:
        model = FaultEvent
        fields = ["id", "created_at", "updated_at", "asset", "asset_no", "asset_name", "occurred_at", "reported_at", "resolved_at", "reason", "description", "is_closed", "repair"]


class RepairRecordSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        unsupported = {key for key in ("cost", "provider", "started_at", "notes") if key in self.initial_data}
        if unsupported:
            raise serializers.ValidationError({key: "维修记录只维护完成时间" for key in sorted(unsupported)})
        return attrs

    class Meta:
        model = RepairRecord
        fields = ["id", "fault", "provider", "started_at", "finished_at", "notes", "created_at", "updated_at"]
        read_only_fields = ["provider", "started_at", "notes"]
