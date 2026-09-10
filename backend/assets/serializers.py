from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from collections import Counter
from django.db.models import Count, Q, Sum
from django.utils import timezone as django_timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from rest_framework.exceptions import ValidationError as DRFValidationError
from django.contrib.auth.models import Group, User
from drf_spectacular.utils import extend_schema_field
from datetime import date, datetime
from decimal import Decimal
from typing import Any
import json
import re
from .models import AssetModel, AuditLog, Asset, AssetAssignmentEvent, AssetCustomValue, AssetNetworkAddress, AssetTag, CustomField, CustomFieldOption, DataCenter, Department, DeviceType, DirectoryIdentity, FaultEvent, InventoryItem, InventoryTask, MaintenanceContract, Manufacturer, NotificationDelivery, Person, ProcurementRecord, Rack, RackUnitAllocation, RepairPartUsage, RepairRecord, ServerRoom, SoftwareLicense, SparePart, SparePartCategory, SpareStock, SpareStockTransaction, SystemSetting, Tag, UserSecurityProfile
from .depreciation import DepreciationValidationError, calculate_asset_depreciation, validate_depreciation_configuration
from .enum_contracts import (
    INVENTORY_ITEM_STATUS_LABELS,
    INVENTORY_RESOLUTION_ACTION_LABELS,
    INVENTORY_RESOLUTION_STATUS_LABELS,
    RACK_STATUS_LABELS,
    RACK_STATUS_VALUES,
    REPAIR_PART_USAGE_SOURCE_LABELS,
    REPAIR_PART_USAGE_SOURCE_VALUES,
    SPARE_UNIT_LABELS,
    STOCK_SOURCE_OPERATION_TYPES,
    STOCK_TARGET_OPERATION_TYPES,
    STOCK_OPERATION_TYPE_LABELS,
    STOCK_OPERATION_TYPE_VALUES,
)
from .license_status import LICENSE_STATUS_LABELS, license_status_value
from .reporting.capacity import rack_effective_used_u
from .services import apply_asset_custom_values, apply_asset_tags, apply_spare_stock_transaction, assign_asset, configure_asset, inventory_snapshot_location, inventory_task_can_delete, return_asset, synchronize_asset_location_hierarchy, transfer_asset, validate_inventory_resolution_request
from .custom_fields import validate_custom_field_value
from .custom_fields import normalize_validation_config as _normalize_validation_config
from .lifecycle import allowed_asset_status_values, transition_asset_status, validate_asset_status_transition
from .roles import ROLE_AUDITOR, ROLE_DEFINITIONS, ROLE_NAME_TO_CODE, preset_group_for_code, user_role_code
from .ldap_auth import AUTH_SOURCE_LDAP, AUTH_SOURCE_LOCAL
from .ldap_configuration import DIRECTORY_TYPE_CHOICES, SECURITY_MODE_CHOICES
from .system_reset import SYSTEM_RESET_CONFIRMATION
from .system_settings import (
    SETTING_METADATA,
    get_system_settings,
    system_localdate,
    system_timezone,
    system_timezone_name,
    system_setting_definitions,
    validate_local_password,
)


class SystemDateTimeInputField(serializers.DateTimeField):
    """Interpret timezone-less client datetimes in the deployment timezone."""

    def to_internal_value(self, value):
        parsed = parse_datetime(value) if isinstance(value, str) else value
        if isinstance(value, str) and parsed is None:
            return super().to_internal_value(value)
        if isinstance(parsed, datetime) and django_timezone.is_naive(parsed):
            parsed = django_timezone.make_aware(parsed, system_timezone())
        return super().to_internal_value(parsed)


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
    )
    groups = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    role_code = serializers.ChoiceField(
        choices=list(ROLE_DEFINITIONS), required=False, write_only=True
    )
    assigned_role_code = serializers.SerializerMethodField()
    assigned_role_name = serializers.SerializerMethodField()
    auth_source = serializers.SerializerMethodField()
    directory_provider = serializers.SerializerMethodField()
    directory_login_identifier = serializers.SerializerMethodField()
    directory_last_seen_at = serializers.SerializerMethodField()
    person = serializers.SerializerMethodField()
    person_id = serializers.PrimaryKeyRelatedField(
        source="person",
        queryset=Person.objects.filter(account__isnull=True, is_active=True),
        required=False,
        allow_null=True,
        write_only=True,
    )

    def get_display_name(self, obj) -> str:
        return obj.get_full_name() or obj.username

    def get_assigned_role_code(self, obj) -> str | None:
        return user_role_code(obj)

    def get_assigned_role_name(self, obj) -> str:
        code = user_role_code(obj)
        return ROLE_DEFINITIONS.get(code, {}).get("name", "")

    @staticmethod
    def _directory_identity(obj) -> DirectoryIdentity | None:
        try:
            return obj.directory_identity
        except DirectoryIdentity.DoesNotExist:
            return None

    def get_auth_source(self, obj) -> str:
        return AUTH_SOURCE_LDAP if self._directory_identity(obj) is not None else AUTH_SOURCE_LOCAL

    def get_directory_provider(self, obj) -> str | None:
        identity = self._directory_identity(obj)
        return identity.provider if identity is not None else None

    def get_directory_login_identifier(self, obj) -> str | None:
        identity = self._directory_identity(obj)
        return identity.current_login_identifier if identity is not None else None

    def get_directory_last_seen_at(self, obj):
        identity = self._directory_identity(obj)
        return identity.last_seen_at if identity is not None else None

    def get_person(self, obj):
        person = getattr(obj, "person", None)
        if person is None:
            return None
        return {
            "id": person.pk,
            "name": person.name,
            "employee_no": person.employee_no,
            "department": person.department_id,
            "department_name": person.department.name if person.department_id and person.department else None,
        }

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
        if self.instance is not None and "person" in attrs:
            raise serializers.ValidationError({"person_id": "系统账号只能在创建时关联人员"})
        if self.instance is None and not attrs.get("password"):
            minimum = get_system_settings().password_min_length
            raise serializers.ValidationError({"password": f"新用户必须设置至少 {minimum} 位密码"})
        password = attrs.get("password")
        if password:
            password_user = self.instance or User(username=attrs.get("username", ""))
            try:
                validate_local_password(password, user=password_user)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        role_code = validated_data.pop("role_code", ROLE_AUDITOR)
        password = validated_data.pop("password")
        person = validated_data.pop("person", None)
        user = User(**validated_data)
        if person is not None:
            user._selected_person_id = person.pk
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
        fields = ["id", "username", "display_name", "first_name", "last_name", "email", "is_active", "is_staff", "is_superuser", "groups", "role_code", "assigned_role_code", "assigned_role_name", "auth_source", "directory_provider", "directory_login_identifier", "directory_last_seen_at", "person", "person_id", "password", "last_login", "date_joined"]
        read_only_fields = ["id", "display_name", "is_staff", "is_superuser", "groups", "assigned_role_code", "assigned_role_name", "last_login", "date_joined"]


class CurrentUserProfileSerializer(serializers.Serializer):
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150, trim_whitespace=True)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150, trim_whitespace=True)
    email = serializers.EmailField(required=False, allow_blank=True, max_length=254, trim_whitespace=True)
    locale = serializers.ChoiceField(
        choices=UserSecurityProfile.LOCALE_CHOICES,
        required=False,
    )


class AdminPasswordResetSerializer(serializers.Serializer):
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "两次输入的密码不一致"})
        try:
            validate_local_password(attrs["new_password"], user=self.context.get("user"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        return attrs


class SystemResetSerializer(serializers.Serializer):
    confirmation = serializers.CharField(
        required=True,
        allow_blank=False,
        trim_whitespace=False,
        write_only=True,
    )

    def validate_confirmation(self, value):
        if value != SYSTEM_RESET_CONFIRMATION:
            raise serializers.ValidationError(
                f"请输入 {SYSTEM_RESET_CONFIRMATION} 以确认恢复系统初始状态"
            )
        return value


class SystemSettingsSerializer(serializers.ModelSerializer):
    """Serialize the fixed, editable system-settings contract."""

    timezone = serializers.SerializerMethodField()
    definitions = serializers.SerializerMethodField()
    email_digest_recipients = serializers.ListField(child=serializers.EmailField(max_length=254), max_length=20, required=False, allow_empty=True)

    def validate_email_digest_recipients(self, value):
        return list(dict.fromkeys(address.strip().lower() for address in value))

    def validate_application_url(self, value):
        from urllib.parse import urlsplit
        parsed = urlsplit(value)
        if value and (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise serializers.ValidationError("请输入不含账号、查询参数或片段的 HTTPS 应用地址")
        return value.rstrip("/")
    smtp_password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        trim_whitespace=False,
    )
    smtp_password_configured = serializers.SerializerMethodField()
    EDITABLE_FIELDS = frozenset(SETTING_METADATA) | {"smtp_password"}
    password_min_length = serializers.IntegerField(required=False, min_value=8, max_value=128)
    password_expiry_days = serializers.IntegerField(required=False, min_value=0, max_value=3650)
    login_max_attempts = serializers.IntegerField(required=False, min_value=1, max_value=100)
    login_window_seconds = serializers.IntegerField(required=False, min_value=1, max_value=86400)
    login_lock_seconds = serializers.IntegerField(required=False, min_value=1, max_value=86400)
    smtp_port = serializers.IntegerField(required=False, min_value=1, max_value=65535)
    smtp_timeout = serializers.IntegerField(required=False, min_value=1, max_value=120)
    maintenance_expiry_days = serializers.IntegerField(required=False, min_value=0, max_value=3650)
    license_expiry_days = serializers.IntegerField(required=False, min_value=0, max_value=3650)

    class Meta:
        model = SystemSetting
        fields = [
            *SETTING_METADATA,
            "timezone",
            "smtp_password",
            "smtp_password_configured",
            "definitions",
        ]

    def get_definitions(self, _obj):
        return system_setting_definitions()

    def get_timezone(self, _obj):
        return system_timezone_name()

    def get_smtp_password_configured(self, obj):
        return bool(obj.smtp_password_encrypted)

    def validate(self, attrs):
        unknown = sorted(set(self.initial_data.keys()) - self.EDITABLE_FIELDS)
        if unknown:
            raise serializers.ValidationError(
                {key: "该系统设置不支持通过当前接口修改" for key in unknown}
            )

        header_errors = {
            key: "该字段不能包含换行符"
            for key in ("smtp_host", "smtp_username", "smtp_from_email", "smtp_from_name")
            if key in attrs and any(char in str(attrs[key]) for char in ("\r", "\n"))
        }
        if header_errors:
            raise serializers.ValidationError(header_errors)
        if "smtp_host" in attrs:
            host = str(attrs["smtp_host"] or "").strip()
            if host and ("://" in host or any(char.isspace() for char in host)):
                raise serializers.ValidationError(
                    {"smtp_host": "请输入主机名或 IP，不要包含协议前缀或空格"}
                )

        current = self.instance
        values = {
            key: getattr(current, key)
            for key in SETTING_METADATA
            if current is not None
        }
        values.update({key: value for key, value in attrs.items() if key in SETTING_METADATA})
        password_value = attrs.get("smtp_password", "")
        if values.get("email_digest_enabled"):
            errors = {}
            if not values.get("email_digest_recipients"):
                errors["email_digest_recipients"] = "启用邮件摘要前必须配置收件人"
            if not values.get("application_url"):
                errors["application_url"] = "启用邮件摘要前必须配置应用访问地址"
            if errors:
                raise serializers.ValidationError(errors)
        password_configured = bool(password_value) or bool(
            current is not None and current.smtp_password_encrypted
        )
        if values.get("smtp_enabled"):
            errors = {}
            if not str(values.get("smtp_host") or "").strip():
                errors["smtp_host"] = "启用 SMTP 前必须填写服务端"
            if not str(values.get("smtp_from_email") or "").strip():
                errors["smtp_from_email"] = "启用 SMTP 前必须填写发件人邮箱"
            if str(values.get("smtp_username") or "").strip() and not password_configured:
                errors["smtp_password"] = "已填写 SMTP 用户名，请配置密码"
            if password_value and not str(values.get("smtp_username") or "").strip():
                errors["smtp_username"] = "配置 SMTP 密码前必须填写用户名"
            if errors:
                raise serializers.ValidationError(errors)
        return attrs


class SmtpTestEmailSerializer(serializers.Serializer):
    recipient = serializers.EmailField(required=True, max_length=254)


class LdapConfigurationUpdateSerializer(serializers.Serializer):
    """Write-only update contract for the singleton directory configuration."""

    enabled = serializers.BooleanField(required=False)
    directory_type = serializers.ChoiceField(choices=DIRECTORY_TYPE_CHOICES, required=False)
    primary_host = serializers.CharField(required=False, allow_blank=True, max_length=255)
    primary_port = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=65535)
    secondary_host = serializers.CharField(required=False, allow_blank=True, max_length=255)
    secondary_port = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=65535)
    base_dn = serializers.CharField(required=False, allow_blank=True, max_length=255)
    bind_dn = serializers.CharField(required=False, allow_blank=True, max_length=255)
    bind_password = serializers.CharField(
        required=False,
        allow_blank=True,
        trim_whitespace=False,
        write_only=True,
    )
    security_mode = serializers.ChoiceField(choices=SECURITY_MODE_CHOICES, required=False)
    tls_server_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    ca_cert_file = serializers.CharField(required=False, allow_blank=True, max_length=500)
    user_search_base = serializers.CharField(required=False, allow_blank=True, max_length=255)
    user_login_attribute = serializers.CharField(required=False, allow_blank=True, max_length=80)
    user_filter = serializers.CharField(required=False, allow_blank=True, max_length=500)
    external_id_attribute = serializers.CharField(required=False, allow_blank=True, max_length=80)
    email_attribute = serializers.CharField(required=False, allow_blank=True, max_length=80)
    first_name_attribute = serializers.CharField(required=False, allow_blank=True, max_length=80)
    last_name_attribute = serializers.CharField(required=False, allow_blank=True, max_length=80)
    account_control_attribute = serializers.CharField(required=False, allow_blank=True, max_length=80)
    connect_timeout = serializers.IntegerField(required=False, min_value=1)
    operation_timeout = serializers.IntegerField(required=False, min_value=1)

    def validate(self, attrs):
        unknown = sorted(set(self.initial_data.keys()) - set(self.fields))
        if unknown:
            raise serializers.ValidationError({key: "该 LDAP 配置字段不受支持" for key in unknown})
        return attrs


class AssetBatchDeleteSerializer(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )

    def validate_ids(self, value):
        unique_ids = list(dict.fromkeys(value))
        if len(unique_ids) > 100:
            raise serializers.ValidationError("一次最多删除 100 项资产")
        return unique_ids


class AssetBatchDeleteResultSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    asset_no = serializers.CharField(allow_blank=True)
    success = serializers.BooleanField()
    code = serializers.CharField(allow_blank=True)
    reason = serializers.CharField(allow_blank=True)


class AssetBatchDeleteResponseSerializer(serializers.Serializer):
    requested = serializers.IntegerField()
    succeeded = serializers.IntegerField()
    failed = serializers.IntegerField()
    results = AssetBatchDeleteResultSerializer(many=True)


class AssetBatchAssignmentSerializer(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    action = serializers.ChoiceField(choices=("assign", "transfer"), required=True)
    target_person = serializers.PrimaryKeyRelatedField(queryset=Person.objects.all(), required=True)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate(self, attrs):
        unknown = sorted(set(self.initial_data.keys()) - set(self.fields))
        if unknown:
            raise serializers.ValidationError({key: "该批量操作字段不受支持" for key in unknown})
        return attrs

    def validate_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("资产 ID 不能重复")
        if len(value) > 100:
            raise serializers.ValidationError("一次最多处理 100 项资产")
        return value

    def validate_target_person(self, value):
        if not value.is_active:
            raise serializers.ValidationError("停用人员不能被指定为使用人")
        return value


class AssetBatchAssignmentResultSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    asset_no = serializers.CharField(allow_blank=True)
    success = serializers.BooleanField()
    code = serializers.CharField(allow_blank=True)
    reason = serializers.CharField(allow_blank=True)


class AssetBatchAssignmentResponseSerializer(serializers.Serializer):
    requested = serializers.IntegerField()
    succeeded = serializers.IntegerField()
    failed = serializers.IntegerField()
    results = AssetBatchAssignmentResultSerializer(many=True)


class UserBatchStatusSerializer(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    is_active = serializers.BooleanField(required=True)

    def validate_ids(self, value):
        unique_ids = list(dict.fromkeys(value))
        if len(unique_ids) > 100:
            raise serializers.ValidationError("一次最多更新 100 个用户")
        return unique_ids


class UserBatchStatusResultSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField(allow_blank=True)
    success = serializers.BooleanField()
    code = serializers.CharField(allow_blank=True)
    reason = serializers.CharField(allow_blank=True)


class UserBatchStatusResponseSerializer(serializers.Serializer):
    requested = serializers.IntegerField()
    succeeded = serializers.IntegerField()
    failed = serializers.IntegerField()
    results = UserBatchStatusResultSerializer(many=True)


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


class DepartmentSerializer(serializers.ModelSerializer):
    parent_name = serializers.CharField(source="parent.name", read_only=True, allow_null=True)
    people_count = serializers.IntegerField(read_only=True, default=0)

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("部门名称不能为空")
        queryset = Department.objects.filter(name__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("部门名称已存在")
        return value

    def validate_code(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("部门编码不能为空")
        queryset = Department.objects.filter(code__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("部门编码已存在")
        return value

    def validate_parent(self, value):
        if not value or not self.instance:
            return value
        current = value
        visited = set()
        while current is not None and current.pk not in visited:
            if current.pk == self.instance.pk:
                raise serializers.ValidationError("部门层级不能形成循环")
            visited.add(current.pk)
            current = current.parent
        return value

    class Meta:
        model = Department
        fields = ["id", "name", "code", "parent", "parent_name", "people_count", "created_at", "updated_at"]
        read_only_fields = ["id", "parent_name", "people_count", "created_at", "updated_at"]


class ManufacturerSerializer(BaseDictionarySerializer):
    licenses_count = serializers.IntegerField(read_only=True, default=0)
    spare_parts_count = serializers.IntegerField(read_only=True, default=0)

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
        fields = [
            "id", "name", "code", "is_active", "assets_count", "licenses_count", "spare_parts_count",
            "created_at", "updated_at",
        ]


class ManufacturerReferenceSerializer(serializers.ModelSerializer):
    """Stable display contract for business records that reference a manufacturer."""

    class Meta:
        model = Manufacturer
        fields = ["id", "name", "code", "is_active"]
        read_only_fields = fields


class DeviceTypeSerializer(BaseDictionarySerializer):
    custom_fields_count = serializers.IntegerField(read_only=True, default=0)

    def validate_color(self, value):
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value or ""):
            raise serializers.ValidationError("颜色必须是六位十六进制值，例如 #1677EF")
        return value.upper()

    class Meta(BaseDictionarySerializer.Meta):
        model = DeviceType
        fields = [
            "id", "name", "color", "is_active", "assets_count", "custom_fields_count",
            "created_at", "updated_at",
        ]


class AssetModelReferenceSerializer(serializers.ModelSerializer):
    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)

    class Meta:
        model = AssetModel
        fields = [
            "id", "name", "manufacturer", "manufacturer_name", "device_type", "device_type_name",
            "model_number", "default_warranty_months", "expected_life_months", "is_active",
        ]
        read_only_fields = fields


class AssetModelOptionSerializer(AssetModelReferenceSerializer):
    class Meta(AssetModelReferenceSerializer.Meta):
        fields = [
            "id", "name", "manufacturer", "manufacturer_name", "device_type", "device_type_name",
            "model_number", "default_warranty_months", "expected_life_months", "is_active",
        ]


class AssetModelSerializer(serializers.ModelSerializer):
    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)
    assets_count = serializers.IntegerField(read_only=True, default=0)

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("型号名称不能为空")
        queryset = AssetModel.objects.filter(name__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("型号名称已存在")
        return value

    def validate_model_number(self, value):
        return (value or "").strip()

    def validate(self, attrs):
        for field in ("manufacturer", "device_type"):
            value = attrs.get(field)
            if value is not None and not value.is_active:
                current_id = getattr(self.instance, f"{field}_id", None) if self.instance else None
                if current_id != value.pk:
                    raise serializers.ValidationError({field: "停用的选项不能用于资产型号"})
        for field in ("default_warranty_months", "expected_life_months"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "月数不能为负数"})
        return attrs

    class Meta:
        model = AssetModel
        fields = [
            "id", "name", "manufacturer", "manufacturer_name", "device_type", "device_type_name",
            "model_number", "default_warranty_months", "expected_life_months", "is_active",
            "assets_count", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "manufacturer_name", "device_type_name", "assets_count", "created_at", "updated_at"]


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
        binding_is_new = not self.instance or (
            "device_type" in attrs
            and attrs["device_type"] is not None
            and attrs["device_type"].pk != self.instance.device_type_id
        )
        if device_type is not None and not device_type.is_active and binding_is_new:
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
        validation_field = CustomField(
            name=attrs.get("name", self.instance.name if self.instance else "自定义字段"),
            field_type=field_type,
            validation_config=attrs["validation_config"],
        )
        try:
            attrs["default_value"] = _validate_default_value(validation_field, default_value, active_options)
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


class SparePartCategorySerializer(serializers.ModelSerializer):
    spare_parts_count = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("备件类型名称不能为空")
        queryset = SparePartCategory.objects.filter(name__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("备件类型名称已存在")
        return value

    def validate_code(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("备件类型编码不能为空")
        queryset = SparePartCategory.objects.filter(code__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("备件类型编码已存在")
        return value

    class Meta:
        model = SparePartCategory
        fields = ["id", "name", "code", "is_active", "spare_parts_count", "created_at", "updated_at"]
        read_only_fields = ["id", "spare_parts_count", "created_at", "updated_at"]


SPARE_UNIT_CHANGE_ERROR = "该备件已有库存流水，无法修改计量单位。"


class SparePartSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_code = serializers.CharField(source="category.code", read_only=True)
    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    total_quantity = serializers.IntegerField(read_only=True)
    location_count = serializers.IntegerField(read_only=True)
    has_stock_movements = serializers.SerializerMethodField()
    is_low_stock = serializers.SerializerMethodField()
    safety_stock = serializers.IntegerField(required=False, min_value=0)
    initial_quantity = serializers.IntegerField(write_only=True, required=False, min_value=0, default=0)
    initial_data_center = serializers.PrimaryKeyRelatedField(
        queryset=DataCenter.objects.filter(is_active=True),
        write_only=True,
        required=False,
        allow_null=True,
    )
    initial_server_room = serializers.PrimaryKeyRelatedField(
        queryset=ServerRoom.objects.filter(is_active=True),
        write_only=True,
        required=False,
        allow_null=True,
    )

    INITIAL_STOCK_FIELDS = {"initial_quantity", "initial_data_center", "initial_server_room"}
    DIRECT_STOCK_FIELDS = {"quantity", "current_stock", "total_quantity"}

    def get_is_low_stock(self, obj) -> bool:
        total_quantity = getattr(obj, "total_quantity", None)
        if total_quantity is None:
            total_quantity = obj.stocks.aggregate(total=Sum("quantity"))["total"] or 0
        return total_quantity <= obj.safety_stock

    def get_has_stock_movements(self, obj) -> bool:
        annotated = getattr(obj, "stock_movement_exists", None)
        return bool(annotated) if annotated is not None else obj.transactions.exists()

    def validate_code(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("备件编码不能为空")
        queryset = SparePart.objects.filter(code__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("备件编码已存在")
        return value

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

    def validate_category(self, value):
        if not value.is_active and (self.instance is None or value.pk != self.instance.category_id):
            raise serializers.ValidationError("停用的备件类型不能用于新增或变更备件")
        return value

    def validate_manufacturer(self, value):
        if value and not value.is_active and (
            self.instance is None or value.pk != self.instance.manufacturer_id
        ):
            raise serializers.ValidationError("停用的厂商不能用于新增或变更备件")
        return value

    def validate_storage_location(self, value):
        return (value or "").strip()

    def validate(self, attrs):
        submitted_fields = set(self.initial_data)
        if self.instance and submitted_fields & self.INITIAL_STOCK_FIELDS:
            raise serializers.ValidationError({
                "initial_quantity": "编辑备件时不能修改初始库存，请通过库存流水调整",
            })
        if submitted_fields & self.DIRECT_STOCK_FIELDS:
            raise serializers.ValidationError({
                "quantity": "当前库存只能通过入库、出库、调拨或盘点调整改变",
            })

        initial_quantity = attrs.get("initial_quantity", 0)
        initial_data_center = attrs.get("initial_data_center")
        initial_server_room = attrs.get("initial_server_room")
        if self.instance is None and initial_quantity > 0 and not initial_data_center:
            raise serializers.ValidationError({"initial_data_center": "有初始库存时必须选择数据中心"})
        if initial_server_room and not initial_data_center:
            raise serializers.ValidationError({"initial_data_center": "选择初始库存机房前必须选择数据中心"})
        if initial_server_room and initial_server_room.data_center_id != initial_data_center.pk:
            raise serializers.ValidationError({"initial_server_room": "初始库存机房不属于所选数据中心"})

        if self.instance and "unit" in attrs and attrs["unit"] != self.instance.unit:
            if self.instance.transactions.exists():
                raise serializers.ValidationError({"unit": SPARE_UNIT_CHANGE_ERROR})
        return attrs

    def update(self, instance, validated_data):
        for field in self.INITIAL_STOCK_FIELDS:
            validated_data.pop(field, None)
        requested_unit = validated_data.get("unit")
        if requested_unit is not None and requested_unit != instance.unit:
            # The movement service locks the part before changing stock. Lock
            # the same row here so a concurrent first movement cannot race a
            # unit change after serializer validation has completed.
            with transaction.atomic():
                locked_instance = SparePart.objects.select_for_update().get(pk=instance.pk)
                if locked_instance.unit != requested_unit and locked_instance.transactions.exists():
                    raise serializers.ValidationError({"unit": SPARE_UNIT_CHANGE_ERROR})
                return super().update(locked_instance, validated_data)
        return super().update(instance, validated_data)

    class Meta:
        model = SparePart
        fields = [
            "id", "code", "name", "category", "category_name", "category_code", "manufacturer", "manufacturer_name", "model",
            "specification", "unit", "safety_stock", "storage_location", "notes", "total_quantity", "location_count", "has_stock_movements",
            "is_low_stock", "initial_quantity", "initial_data_center", "initial_server_room",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "category_name", "category_code", "manufacturer_name", "total_quantity", "location_count",
            "is_low_stock", "has_stock_movements", "created_at", "updated_at",
        ]


class SpareStockSerializer(serializers.ModelSerializer):
    part_code = serializers.CharField(source="part.code", read_only=True)
    part_name = serializers.CharField(source="part.name", read_only=True)
    category_name = serializers.CharField(source="part.category.name", read_only=True)
    data_center_name = serializers.CharField(source="data_center.name", read_only=True)
    server_room_name = serializers.CharField(source="server_room.name", read_only=True, allow_null=True)

    class Meta:
        model = SpareStock
        fields = [
            "id", "part", "part_code", "part_name", "category_name", "data_center", "data_center_name",
            "server_room", "server_room_name", "quantity", "updated_at",
        ]
        read_only_fields = fields


class SpareStockTransactionSerializer(serializers.ModelSerializer):
    operation_type_label = serializers.SerializerMethodField()
    part_code = serializers.CharField(source="part.code", read_only=True)
    part_name = serializers.CharField(source="part.name", read_only=True)
    category_name = serializers.CharField(source="part.category.name", read_only=True)
    unit = serializers.CharField(source="part.unit", read_only=True)
    source_data_center_name = serializers.CharField(source="source_data_center.name", read_only=True, allow_null=True)
    source_server_room_name = serializers.CharField(source="source_server_room.name", read_only=True, allow_null=True)
    target_data_center_name = serializers.CharField(source="target_data_center.name", read_only=True, allow_null=True)
    target_server_room_name = serializers.CharField(source="target_server_room.name", read_only=True, allow_null=True)
    operator_name = serializers.SerializerMethodField()
    quantity_delta = serializers.IntegerField(read_only=True)
    adjustment_quantity = serializers.IntegerField(write_only=True, required=False)

    def get_operation_type_label(self, obj) -> str:
        return STOCK_OPERATION_TYPE_LABELS.get(obj.operation_type, obj.operation_type)

    def get_operator_name(self, obj) -> str:
        return (obj.operator.get_full_name() or obj.operator.username) if obj.operator else "已删除账号"

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["adjustment_quantity"] = (
            instance.after_quantity - instance.before_quantity
            if instance.operation_type == "adjustment"
            else None
        )
        return data

    def validate(self, attrs):
        operation_type = attrs.get("operation_type")
        if operation_type not in STOCK_OPERATION_TYPE_VALUES:
            raise serializers.ValidationError({"operation_type": "不支持的库存操作类型"})
        quantity = attrs.get("quantity", 0)
        if operation_type != "adjustment" and quantity <= 0:
            raise serializers.ValidationError({"quantity": "数量必须大于 0"})
        if operation_type == "adjustment":
            if "quantity" in self.initial_data:
                raise serializers.ValidationError({"quantity": "盘点调整请使用 adjustment_quantity"})
            adjustment_quantity = attrs.get("adjustment_quantity")
            if adjustment_quantity is None:
                raise serializers.ValidationError({"adjustment_quantity": "盘点调整必须填写调整数量"})
            if adjustment_quantity == 0:
                raise serializers.ValidationError({"adjustment_quantity": "调整数量不能为 0"})
        elif "adjustment_quantity" in attrs:
            raise serializers.ValidationError({"adjustment_quantity": "只有盘点调整支持调整数量"})
        if operation_type in STOCK_SOURCE_OPERATION_TYPES and not attrs.get("source_data_center"):
            raise serializers.ValidationError({"source_data_center": "必须选择来源数据中心"})
        if operation_type in STOCK_TARGET_OPERATION_TYPES and not attrs.get("target_data_center"):
            raise serializers.ValidationError({"target_data_center": "必须选择目标数据中心"})
        if operation_type == "transfer" and not attrs.get("target_data_center"):
            raise serializers.ValidationError({"target_data_center": "调拨必须选择目标数据中心"})
        return attrs

    class Meta:
        model = SpareStockTransaction
        fields = [
            "id", "part", "part_code", "part_name", "category_name", "unit", "operation_type", "operation_type_label", "quantity",
            "source_data_center", "source_data_center_name", "source_server_room", "source_server_room_name",
            "target_data_center", "target_data_center_name", "target_server_room", "target_server_room_name",
            "quantity_delta", "before_quantity", "after_quantity", "operator", "operator_name", "reference", "notes", "created_at",
            "adjustment_quantity",
        ]
        read_only_fields = [
            "id", "part_code", "part_name", "unit", "operation_type_label", "source_data_center_name", "source_server_room_name",
            "target_data_center_name", "target_server_room_name", "quantity_delta", "before_quantity", "after_quantity", "operator",
            "operator_name", "created_at",
        ]


class SparePartDetailSerializer(SparePartSerializer):
    stock_locations = serializers.SerializerMethodField()
    recent_transactions = serializers.SerializerMethodField()

    def get_stock_locations(self, obj) -> list[dict[str, Any]]:
        stocks = obj.stocks.select_related("part", "part__category", "part__manufacturer", "data_center", "server_room").order_by(
            "data_center__name", "server_room__name", "id"
        )
        return SpareStockSerializer(stocks, many=True).data

    def get_recent_transactions(self, obj) -> list[dict[str, Any]]:
        transactions = obj.transactions.select_related(
            "part", "part__category", "part__manufacturer",
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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._system_today = system_localdate()

    def _status(self, obj):
        return license_status_value(obj, today=self._system_today)

    def get_utilization(self, obj) -> float:
        if not obj.authorized_count:
            return 0
        return round(obj.used_count / obj.authorized_count * 100, 1)

    def get_remaining_count(self, obj) -> int:
        return obj.authorized_count - obj.used_count

    def get_status(self, obj) -> str:
        return self._status(obj)

    def get_status_label(self, obj) -> str:
        return LICENSE_STATUS_LABELS[self._status(obj)]

    def get_days_remaining(self, obj) -> int | None:
        return (obj.expiry_date - self._system_today).days if obj.expiry_date else None

    def validate(self, attrs):
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

    def update(self, instance, validated_data):
        data_center = validated_data.get("data_center")
        location_submitted = "data_center" in self.initial_data
        with transaction.atomic():
            instance = super().update(instance, validated_data)
            if location_submitted and data_center is not None:
                rack_ids = Rack.objects.filter(room_id=instance.pk).values_list("pk", flat=True)
                synchronize_asset_location_hierarchy(
                    rack_ids=rack_ids,
                    data_center_id=data_center.pk,
                )
        return instance


class RackUnitAllocationSerializer(serializers.ModelSerializer):
    units = serializers.IntegerField(read_only=True)
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    asset_name = serializers.CharField(source="asset.name", read_only=True)
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
        fields = ["id", "asset", "rack", "rack_code", "data_center", "data_center_id", "server_room", "start_u", "end_u", "units", "asset_no", "asset_name", "device_type_name", "device_type_color", "manufacturer_name", "model_name", "manufacturer_model", "serial_number", "status"]


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
    result = []
    for field in fields:
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


class PersonSummarySerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(source="name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, allow_null=True)

    class Meta:
        model = Person
        fields = [
            "id", "name", "display_name", "employee_no", "department", "department_name",
            "organization", "contact", "is_active",
        ]
        read_only_fields = fields


class PersonOptionSerializer(serializers.ModelSerializer):
    """Small projection for people selectors and account-linking controls."""

    display_name = serializers.CharField(source="name", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, allow_null=True)

    class Meta:
        model = Person
        fields = [
            "id", "name", "display_name", "employee_no", "department", "department_name", "is_active",
        ]
        read_only_fields = fields


class PersonSerializer(PersonSummarySerializer):
    account_username = serializers.CharField(source="account.username", read_only=True, allow_null=True)
    account_email = serializers.CharField(source="account.email", read_only=True, allow_null=True)
    asset_count = serializers.IntegerField(read_only=True, default=0)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("姓名不能为空")
        return value

    def validate_employee_no(self, value):
        value = (value or "").strip()
        if not value:
            return None
        queryset = Person.objects.filter(employee_no__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("员工编号已存在")
        return value

    def validate_department(self, value):
        if value is not None and getattr(value, "is_active", True) is False:
            raise serializers.ValidationError("停用的部门不能作为人员所属部门")
        return value

    def validate(self, attrs):
        current_active = self.instance.is_active if self.instance else True
        target_active = attrs.get("is_active", current_active)
        if current_active and not target_active and self.instance and self.instance.assigned_assets.exists():
            raise serializers.ValidationError({"is_active": "该人员仍有资产，处理名下资产后才能停用"})
        for field in ("organization", "contact"):
            if field in attrs:
                attrs[field] = (attrs[field] or "").strip()
        return attrs

    class Meta(PersonSummarySerializer.Meta):
        fields = PersonSummarySerializer.Meta.fields + [
            "account", "account_username", "account_email",
            "asset_count", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "display_name", "department_name", "account", "account_username", "account_email",
            "asset_count", "created_at", "updated_at",
        ]


class AssetAssignmentTargetSerializer(serializers.Serializer):
    REMOVED_FIELDS = frozenset({
        "target_subject", "target_user", "responsible_user", "responsible_user_id",
        "responsible_user_name", "responsibility_subject", "responsibility_subject_id",
        "assigned_to", "assignee",
    })
    target_person = serializers.PrimaryKeyRelatedField(queryset=Person.objects.all(), required=True)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def to_internal_value(self, data):
        submitted = self.REMOVED_FIELDS.intersection(data)
        if submitted:
            field = sorted(submitted)[0]
            raise serializers.ValidationError({field: "该字段已移除，请使用 target_person"})
        return super().to_internal_value(data)

    def validate_target_person(self, value):
        if not value.is_active:
            raise serializers.ValidationError("停用人员不能被指定为使用人")
        return value


class AssetAssignmentReturnSerializer(serializers.Serializer):
    REMOVED_FIELDS = AssetAssignmentTargetSerializer.REMOVED_FIELDS
    reason = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def to_internal_value(self, data):
        submitted = self.REMOVED_FIELDS.intersection(data)
        if submitted:
            field = sorted(submitted)[0]
            raise serializers.ValidationError({field: "该字段已移除，请使用使用人操作"})
        return super().to_internal_value(data)


class AssetAssignmentSerializer(AssetAssignmentTargetSerializer):
    action = serializers.ChoiceField(choices=("assign", "transfer", "return"), required=True)
    target_person = serializers.PrimaryKeyRelatedField(queryset=Person.objects.all(), required=False, allow_null=True)

    def validate(self, attrs):
        action = attrs["action"]
        target = attrs.get("target_person")
        if action in {"assign", "transfer"} and target is None:
            raise serializers.ValidationError({"target_person": "指定或转交必须选择使用人"})
        if action == "return" and target is not None:
            raise serializers.ValidationError({"target_person": "归还不能同时指定使用人"})
        if target is not None and not target.is_active:
            raise serializers.ValidationError({"target_person": "停用人员不能被指定为使用人"})
        return attrs


class AssetAssignmentEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetAssignmentEvent
        fields = [
            "id", "asset", "action",
            "from_person", "from_person_employee_no", "from_person_name", "from_person_department",
            "from_person_organization", "from_person_contact",
            "to_person", "to_person_employee_no", "to_person_name", "to_person_department",
            "to_person_organization", "to_person_contact",
            "operator", "operator_name", "reason", "created_at",
        ]
        read_only_fields = fields


class AssetSerializer(serializers.ModelSerializer):
    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)
    asset_data_center_name = serializers.CharField(source="asset_data_center.name", read_only=True, allow_null=True)
    asset_model = AssetModelReferenceSerializer(read_only=True, allow_null=True)
    asset_model_name = serializers.CharField(source="asset_model.name", read_only=True, allow_null=True)
    asset_model_number = serializers.CharField(source="asset_model.model_number", read_only=True, allow_null=True)
    model_name = serializers.SerializerMethodField()
    assigned_person = PersonSummarySerializer(read_only=True, allow_null=True)
    network_addresses = AssetNetworkAddressSerializer(many=True, read_only=True)
    rack_allocation = RackUnitAllocationSerializer(read_only=True)
    procurement_records = ProcurementRecordSerializer(many=True, read_only=True)
    maintenance_contracts = MaintenanceContractSerializer(many=True, read_only=True)
    tag_names = serializers.SerializerMethodField()

    def get_tag_names(self, obj) -> list[str]:
        return [item.tag.name for item in obj.asset_tags.select_related("tag").all()]

    def get_model_name(self, obj) -> str:
        return obj.asset_model.name if obj.asset_model_id else (obj.model or "")

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

    The detail endpoint intentionally keeps the full nested payload.  The
    list endpoint can opt into this representation with ``compact=1`` so a
    page of assets does not materialize every procurement, maintenance and IP
    column into a large nested JSON document.
    """

    manufacturer_name = serializers.CharField(source="manufacturer.name", read_only=True, allow_null=True)
    device_type_name = serializers.CharField(source="device_type.name", read_only=True, allow_null=True)
    asset_data_center_name = serializers.CharField(source="asset_data_center.name", read_only=True, allow_null=True)
    asset_model_name = serializers.CharField(source="asset_model.name", read_only=True, allow_null=True)
    asset_model_number = serializers.CharField(source="asset_model.model_number", read_only=True, allow_null=True)
    model_name = serializers.SerializerMethodField()
    assigned_person = PersonSummarySerializer(read_only=True, allow_null=True)
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
        self._depreciation_as_of_date = system_localdate()
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

    def get_model_name(self, obj) -> str:
        return obj.asset_model.name if obj.asset_model_id else (obj.model or "")

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
            "id", "created_at", "updated_at", "asset_no", "name",
            "manufacturer", "manufacturer_name", "device_type",
            "device_type_name", "asset_data_center", "asset_data_center_name", "asset_model_name", "asset_model_number", "model", "model_name", "manufacturer_model",
            "serial_number", "purpose", "status", "assigned_person", "notes", "warranty_months",
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
    asset_model = AssetModelReferenceSerializer(read_only=True, allow_null=True)
    asset_model_name = serializers.CharField(source="asset_model.name", read_only=True, allow_null=True)
    asset_model_number = serializers.CharField(source="asset_model.model_number", read_only=True, allow_null=True)
    model_name = serializers.SerializerMethodField()
    assigned_person = PersonSummarySerializer(read_only=True, allow_null=True)
    network_addresses = AssetNetworkAddressSerializer(many=True, read_only=True)
    rack_allocation = RackUnitAllocationDetailSerializer(read_only=True)
    procurement_records = ProcurementRecordSerializer(many=True, read_only=True)
    maintenance_contracts = MaintenanceContractSerializer(many=True, read_only=True)
    inventory_records_count = serializers.SerializerMethodField()
    latest_inventory_record = serializers.SerializerMethodField()
    tags = serializers.SerializerMethodField()
    custom_fields = serializers.SerializerMethodField()
    custom_values = serializers.SerializerMethodField()
    depreciation = serializers.SerializerMethodField()
    allowed_statuses = serializers.SerializerMethodField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._depreciation_as_of_date = system_localdate()

    def get_inventory_records_count(self, obj) -> int:
        return obj.inventory_items.count()

    def get_latest_inventory_record(self, obj) -> dict[str, Any] | None:
        record = (
            obj.inventory_items.filter(checked_at__isnull=False)
            .select_related(
                "asset",
                "asset__device_type",
                "task",
                "task__data_center",
                "task__server_room",
                "checked_by",
                "resolved_by",
                "actual_rack__room__data_center",
            )
            .order_by("-checked_at", "-id")
            .first()
        )
        return InventoryItemSerializer(record).data if record else None

    def get_tags(self, obj) -> list[dict[str, Any]]:
        return [{"id": item.tag_id, "name": item.tag.name, "is_active": item.tag.is_active} for item in obj.asset_tags.select_related("tag").all()]

    def get_custom_fields(self, obj) -> list[dict[str, Any]]:
        return _asset_custom_fields(obj)

    def get_custom_values(self, obj) -> dict[str, Any]:
        return _asset_custom_values(obj)

    @extend_schema_field(DepreciationResponseSerializer)
    def get_depreciation(self, obj) -> dict[str, object]:
        return calculate_asset_depreciation(obj, as_of_date=self._depreciation_as_of_date)

    def get_allowed_statuses(self, obj) -> list[str]:
        return list(allowed_asset_status_values(obj))

    def get_model_name(self, obj) -> str:
        return obj.asset_model.name if obj.asset_model_id else (obj.model or "")

    class Meta:
        model = Asset
        fields = [
            "id", "created_at", "updated_at", "asset_no", "name", "manufacturer", "manufacturer_name", "device_type", "device_type_name", "asset_data_center", "asset_data_center_name", "asset_model", "asset_model_name", "asset_model_number", "model", "model_name", "manufacturer_model",
            "serial_number", "purpose", "status", "assigned_person", "notes", "warranty_months", "depreciation_start_date", "depreciation_years", "residual_rate", "depreciation_method",
            "network_addresses", "rack_allocation", "procurement_records", "maintenance_contracts", "inventory_records_count", "latest_inventory_record", "tags", "custom_fields", "custom_values", "allowed_statuses",
            "depreciation",
        ]


class AssetWriteSerializer(serializers.ModelSerializer):
    PLACEMENT_CONFIGURATION_KEYS = (
        "data_center",
        "server_room_id",
        "rack_id",
        "rack_start_u",
        "rack_end_u",
        "rack_total_u",
    )
    REQUIRED_PLACEMENT_CONFIGURATION_KEYS = frozenset(PLACEMENT_CONFIGURATION_KEYS[:5])
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
    assignment = AssetAssignmentSerializer(write_only=True, required=False)
    tags = serializers.PrimaryKeyRelatedField(many=True, queryset=Tag.objects.all(), required=False, write_only=True)
    custom_values = serializers.JSONField(required=False, write_only=True)
    asset_model = serializers.PrimaryKeyRelatedField(
        queryset=AssetModel.objects.all(),
        required=False,
        allow_null=True,
    )
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
        fields = ["id", "created_at", "updated_at", "asset_no", "name", "manufacturer", "manufacturer_id", "device_type", "asset_data_center", "asset_model", "model", "manufacturer_model", "warranty_months", "serial_number", "purpose", "status", "notes", "depreciation_start_date", "depreciation_years", "residual_rate", "depreciation_method", "configuration", "assignment", "tags", "custom_values"]
        read_only_fields = ["id", "created_at", "updated_at"]

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
            configuration = attrs.get("configuration")
            if isinstance(configuration, dict) and configuration:
                if "purchase_amount" not in configuration:
                    return self._stored_procurement_amount()
            return self._submitted_procurement_amount(configuration)
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

    @classmethod
    def _current_placement_configuration(cls, instance):
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

    @classmethod
    def _merge_partial_placement_configuration(cls, instance, configuration):
        if not isinstance(configuration, dict):
            return configuration
        current = cls._current_placement_configuration(instance)
        if not current:
            return configuration

        submitted_required = set(configuration).intersection(
            cls.REQUIRED_PLACEMENT_CONFIGURATION_KEYS
        )
        if submitted_required == cls.REQUIRED_PLACEMENT_CONFIGURATION_KEYS and all(
            not str(configuration.get(key) or "").strip()
            for key in cls.REQUIRED_PLACEMENT_CONFIGURATION_KEYS
        ):
            # The form sends all five empty values to explicitly unmount an
            # asset.  Preserve that intent instead of restoring the current
            # allocation below.
            return configuration
        return {**current, **configuration}

    def _validate_direct_asset_data_center(self, instance, requested_data_center) -> None:
        allocation = RackUnitAllocation.objects.select_related(
            "rack__room__data_center"
        ).filter(asset=instance).first()
        if allocation is not None and getattr(requested_data_center, "pk", None) != allocation.rack.room.data_center_id:
            raise DjangoValidationError({
                "asset_data_center": "已上架资产的数据中心由机柜位置决定，请通过机柜位置调整",
            })

    def validate(self, attrs):
        removed_fields = {
            "responsible_user", "responsible_user_id", "responsible_user_name",
            "responsibility_subject", "responsibility_subject_id", "assigned_to", "assignee", "target_user",
            "target_subject", "target_person", "assigned_person", "assigned_person_id",
            "department", "department_id", "owner_name",
        }
        submitted_removed_fields = removed_fields.intersection(self.initial_data)
        if submitted_removed_fields:
            field = sorted(submitted_removed_fields)[0]
            raise serializers.ValidationError({field: "该字段已移除，请使用 assignment 或使用人操作"})
        derived_fields = self.DERIVED_DEPRECIATION_FIELDS & set(self.initial_data)
        if derived_fields:
            field = sorted(derived_fields)[0]
            raise serializers.ValidationError({field: "折旧派生值只读，不能提交"})
        if "status_before_repair" in self.initial_data:
            raise serializers.ValidationError({"status_before_repair": "该字段由维修流程维护"})
        if "configuration" in attrs and not isinstance(attrs["configuration"], dict):
            raise serializers.ValidationError({"configuration": "配置必须是 JSON 对象"})
        asset_model = attrs.get("asset_model", self.instance.asset_model if self.instance else None)
        if asset_model is not None:
            current_model_id = self.instance.asset_model_id if self.instance else None
            if not asset_model.is_active and asset_model.pk != current_model_id:
                raise serializers.ValidationError({"asset_model": "停用的资产型号不能用于资产"})
            for field in ("manufacturer", "device_type"):
                related = getattr(asset_model, f"{field}_id", None)
                if related is None:
                    continue
                submitted = attrs.get(field)
                if submitted is not None and submitted.pk != related:
                    raise serializers.ValidationError({field: "所选资产型号与该字段不一致"})
                attrs[field] = getattr(asset_model, field)
        manufacturer = attrs.get("manufacturer")
        if manufacturer and not manufacturer.is_active and (not self.instance or self.instance.manufacturer_id != manufacturer.pk):
            raise serializers.ValidationError({"manufacturer_id": "停用的厂商不能用于新资产或修改资产"})
        device_type = attrs.get("device_type", self.instance.device_type if self.instance else None)
        if not device_type:
            raise serializers.ValidationError({"device_type": "设备类型不能为空"})
        if not device_type.is_active and (not self.instance or self.instance.device_type_id != device_type.pk):
            raise serializers.ValidationError({"device_type": "停用的设备类型不能用于新资产或修改资产"})
        attrs["device_type"] = device_type
        asset_data_center = attrs.get("asset_data_center")
        if asset_data_center and not asset_data_center.is_active:
            if not self.instance or self.instance.asset_data_center_id != asset_data_center.pk:
                raise serializers.ValidationError({"asset_data_center": "停用的数据中心不能用于资产"})
        if "serial_number" in attrs and not attrs["serial_number"]:
            attrs["serial_number"] = None
        if "status" in attrs:
            try:
                validate_asset_status_transition(self.instance, attrs["status"])
            except DjangoValidationError as exc:
                raise serializers.ValidationError(
                    getattr(exc, "message_dict", {"status": exc.messages})
                ) from exc
        assignment = attrs.get("assignment")
        if assignment and assignment.get("action") == "transfer" and "status" in attrs:
            if self.instance is not None and attrs["status"] != self.instance.status:
                raise serializers.ValidationError({"status": "转交使用人不会改变资产状态"})
        self._validate_depreciation(attrs)
        return attrs

    def _apply_assignment(self, asset, assignment):
        if not assignment:
            return asset
        request = self.context.get("request")
        actor = request.user if request is not None and request.user.is_authenticated else None
        action = assignment["action"]
        reason = assignment.get("reason", "")
        if action == "assign":
            asset, _event = assign_asset(
                asset_id=asset.pk,
                target_person_id=assignment["target_person"].pk,
                actor=actor,
                request=request,
                reason=reason,
            )
        elif action == "transfer":
            asset, _event = transfer_asset(
                asset_id=asset.pk,
                target_person_id=assignment["target_person"].pk,
                actor=actor,
                request=request,
                reason=reason,
            )
        else:
            asset, _event = return_asset(
                asset_id=asset.pk,
                actor=actor,
                request=request,
                reason=reason,
            )
        return asset

    def create(self, validated_data):
        configuration = validated_data.pop("configuration", {})
        assignment = validated_data.pop("assignment", None)
        tags = validated_data.pop("tags", None)
        custom_values = validated_data.pop("custom_values", {})
        asset_model = validated_data.get("asset_model")
        if validated_data.get("warranty_months") is None and asset_model is not None:
            validated_data["warranty_months"] = asset_model.default_warranty_months
        if "status" not in validated_data:
            validated_data["status"] = get_system_settings().default_asset_status
        try:
            validate_asset_status_transition(None, validated_data["status"])
        except DjangoValidationError as exc:
            raise serializers.ValidationError(
                getattr(exc, "message_dict", {"status": exc.messages})
            ) from exc
        try:
            with transaction.atomic():
                asset = Asset.objects.create(**validated_data)
                configure_asset(asset, configuration)
                apply_asset_custom_values(asset, custom_values)
                apply_asset_tags(asset, tags or [])
                asset = self._apply_assignment(asset, assignment)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(getattr(exc, "message_dict", {"configuration": exc.messages})) from exc
        except IntegrityError as exc:
            raise serializers.ValidationError({"configuration": "关联信息已存在或与其他资产冲突"}) from exc
        return asset

    def update(self, instance, validated_data):
        configuration = validated_data.pop("configuration", None)
        assignment = validated_data.pop("assignment", None)
        tags = validated_data.pop("tags", None)
        custom_values = validated_data.pop("custom_values", None)
        missing = object()
        requested_asset_data_center = validated_data.get("asset_data_center", missing)
        requested_status = validated_data.pop("status", missing)
        try:
            with transaction.atomic():
                # Re-read and lock the asset before applying lifecycle checks;
                # serializer validation runs before the view transaction and
                # must not be the final authority for retirement races.
                instance = Asset.objects.select_for_update().get(pk=instance.pk)
                if (
                    requested_asset_data_center is not missing
                    and not self._configuration_includes_placement(configuration)
                ):
                    self._validate_direct_asset_data_center(instance, requested_asset_data_center)
                if requested_status is not missing:
                    transition_asset_status(instance, requested_status)
                for key, value in validated_data.items():
                    setattr(instance, key, value)
                instance.save()
                if configuration is not None:
                    configuration = self._merge_partial_placement_configuration(instance, configuration)
                    configure_asset(instance, configuration)
                apply_asset_custom_values(
                    instance,
                    custom_values or {},
                    submitted=custom_values is not None,
                )
                if tags is not None:
                    apply_asset_tags(instance, tags)
                instance = self._apply_assignment(instance, assignment)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(getattr(exc, "message_dict", {"configuration": exc.messages})) from exc
        except IntegrityError as exc:
            raise serializers.ValidationError({"configuration": "关联信息已存在或与其他资产冲突"}) from exc
        return instance


class InventoryScopePreviewQuerySerializer(serializers.Serializer):
    """Validated query parameters for the read-only inventory scope preview."""

    scope = serializers.ChoiceField(choices=tuple(InventoryTask.SCOPE), required=False)
    data_center = serializers.PrimaryKeyRelatedField(
        queryset=DataCenter.objects.all(),
        required=False,
        allow_null=True,
    )
    server_room = serializers.PrimaryKeyRelatedField(
        queryset=ServerRoom.objects.select_related("data_center"),
        required=False,
        allow_null=True,
    )

    def validate(self, attrs):
        scope = attrs.get("scope")
        data_center = attrs.get("data_center")
        server_room = attrs.get("server_room")
        if scope is None:
            if data_center is None:
                raise serializers.ValidationError({"scope": "请选择盘点范围"})
            scope = "server_room" if server_room is not None else "data_center"
            attrs["scope"] = scope

        if scope == "all_assets":
            if data_center is not None or server_room is not None:
                raise serializers.ValidationError({"scope": "全部资产范围不能同时指定数据中心或机房"})
            return attrs

        if data_center is None:
            raise serializers.ValidationError({"data_center": "指定位置范围必须选择数据中心"})
        if not data_center.is_active:
            raise serializers.ValidationError({"data_center": "停用的数据中心不能创建盘点任务"})
        if server_room is not None:
            if server_room.data_center_id != data_center.id:
                raise serializers.ValidationError({"server_room": "机房不属于所选数据中心"})
            if not server_room.is_active:
                raise serializers.ValidationError({"server_room": "停用的机房不能创建盘点任务"})
        if scope == "data_center" and server_room is not None:
            raise serializers.ValidationError({"server_room": "数据中心范围不能同时指定机房"})
        if scope == "server_room" and server_room is None:
            raise serializers.ValidationError({"server_room": "机房范围必须选择机房"})
        return attrs


class InventoryScopeLocationSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class InventoryScopePreviewSerializer(serializers.Serializer):
    scope = serializers.ChoiceField(choices=tuple(InventoryTask.SCOPE))
    data_center = InventoryScopeLocationSerializer(allow_null=True)
    server_room = InventoryScopeLocationSerializer(allow_null=True)
    scope_label = serializers.CharField()
    total = serializers.IntegerField()
    racked = serializers.IntegerField()
    unracked = serializers.IntegerField()
    retired = serializers.IntegerField()
    unassigned = serializers.IntegerField()
    inactive_location = serializers.IntegerField()
    includes_unracked = serializers.BooleanField()
    warnings = serializers.ListField(child=serializers.CharField())


class InventoryResolutionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=tuple(INVENTORY_RESOLUTION_ACTION_LABELS.items()))
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
    device_type_name = serializers.CharField(source="asset.device_type.name", read_only=True, allow_null=True)
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
        return INVENTORY_ITEM_STATUS_LABELS.get(obj.status, obj.status)

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
            "id", "task", "task_name", "asset", "asset_no", "asset_name", "device_type_name", "serial_number",
            "system_data_center", "system_server_room", "system_rack_code", "system_start_u", "system_end_u",
            "status", "status_label", "checked_at", "checked_by", "checked_by_name",
            "actual_rack", "actual_data_center", "actual_server_room", "actual_rack_code",
            "actual_start_u", "actual_end_u", "notes",
            "resolution_status", "resolution_status_label", "resolution_action", "resolution_action_label",
            "resolution_note", "resolved_by", "resolved_by_name", "resolved_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "task", "task_name", "asset", "asset_no", "asset_name", "device_type_name", "serial_number",
            "system_data_center", "system_server_room", "system_rack_code", "system_start_u", "system_end_u",
            "status_label", "checked_at", "checked_by", "checked_by_name", "actual_data_center",
            "actual_server_room", "actual_rack_code", "resolution_status", "resolution_status_label",
            "resolution_action", "resolution_action_label", "resolution_note", "resolved_by",
            "resolved_by_name", "resolved_at", "created_at", "updated_at",
        ]


class InventoryItemPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True, required=False)
    previous = serializers.URLField(allow_null=True, required=False)
    results = InventoryItemSerializer(many=True)


class InventoryTaskSerializer(serializers.ModelSerializer):
    start_at = SystemDateTimeInputField()
    end_at = SystemDateTimeInputField()
    inspector = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(is_active=True), required=False)
    scope = serializers.ChoiceField(choices=tuple(InventoryTask.SCOPE), required=False)
    data_center_name = serializers.CharField(source="data_center.name", read_only=True, allow_null=True)
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
        scope = attrs.get("scope")
        start_at = attrs.get("start_at", self.instance.start_at if self.instance else None)
        end_at = attrs.get("end_at", self.instance.end_at if self.instance else None)
        if scope is None:
            if self.instance and "data_center" not in attrs and "server_room" not in attrs:
                scope = self.instance.scope
            elif server_room is not None:
                scope = "server_room"
            elif data_center is not None:
                scope = "data_center"
            else:
                raise serializers.ValidationError({"scope": "请选择盘点范围"})
            attrs["scope"] = scope

        if scope == "all_assets":
            if data_center is not None or server_room is not None:
                raise serializers.ValidationError({"scope": "全部资产范围不能同时指定数据中心或机房"})
        else:
            if data_center is None:
                raise serializers.ValidationError({"data_center": "指定位置范围必须选择数据中心"})
            if server_room and server_room.data_center_id != data_center.id:
                raise serializers.ValidationError({"server_room": "机房不属于所选数据中心"})
            if scope == "data_center" and server_room is not None:
                raise serializers.ValidationError({"server_room": "数据中心范围不能同时指定机房"})
            if scope == "server_room" and server_room is None:
                raise serializers.ValidationError({"server_room": "机房范围必须选择机房"})
        if start_at and end_at and end_at < start_at:
            raise serializers.ValidationError({"end_at": "结束时间不能早于开始时间"})
        if data_center and not data_center.is_active:
            raise serializers.ValidationError({"data_center": "停用的数据中心不能创建盘点任务"})
        if server_room and not server_room.is_active:
            raise serializers.ValidationError({"server_room": "停用的机房不能创建盘点任务"})
        if self.instance:
            if scope != self.instance.scope:
                raise serializers.ValidationError({"scope": "任务已经生成固定清单，不能修改盘点范围"})
            if "data_center" in attrs and (data_center.id if data_center else None) != self.instance.data_center_id:
                raise serializers.ValidationError({"data_center": "任务已经生成固定清单，不能修改数据中心范围"})
            if "server_room" in attrs and (server_room.id if server_room else None) != self.instance.server_room_id:
                raise serializers.ValidationError({"server_room": "任务已经生成固定清单，不能修改机房范围"})
        return attrs

    class Meta:
        model = InventoryTask
        fields = [
            "id", "name", "scope", "data_center", "data_center_name", "server_room", "server_room_name",
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
        return rack_effective_used_u(obj.allocations.all(), obj.total_u or 0)

    def get_free_u(self, obj) -> int:
        return max((obj.total_u or 0) - self.get_used_u(obj), 0)

    def get_status_label(self, obj) -> str:
        return RACK_STATUS_LABELS.get(obj.status, obj.status)

    class Meta:
        model = Rack
        fields = [
            "id", "created_at", "updated_at", "room", "code", "name", "rack_type",
            "owner_name", "notes", "total_u", "is_active", "status", "status_label",
            "data_center_name", "server_room_name", "assets_count", "used_u", "free_u", "allocations",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "data_center_name", "server_room_name", "assets_count", "used_u", "free_u", "status_label", "allocations"]

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
        if total_u < 1:
            raise serializers.ValidationError({"total_u": "机柜总 U 位数必须大于等于 1"})
        if queryset.exists():
            raise serializers.ValidationError({"code": "该机房下已存在同编号机柜"})
        if room and not room.is_active and (
            self.instance is None or room.id != self.instance.room_id
        ):
            raise serializers.ValidationError({"room": "停用的机房不能新增或接收机柜"})
        if room and not room.data_center.is_active and (
            self.instance is None or room.id != self.instance.room_id
        ):
            raise serializers.ValidationError({"room": "停用的数据中心不能新增或接收机柜"})
        status = attrs.get("status", self.instance.status if self.instance else "in_use")
        if "is_active" in attrs and "status" not in attrs:
            status = "in_use" if attrs["is_active"] else "disabled"
            attrs["status"] = status
        attrs["is_active"] = status != "disabled"
        if status not in RACK_STATUS_VALUES:
            raise serializers.ValidationError({"status": "机柜状态不正确"})
        return attrs

    def update(self, instance, validated_data):
        room = validated_data.get("room")
        location_submitted = "room" in self.initial_data
        with transaction.atomic():
            instance = super().update(instance, validated_data)
            if location_submitted and room is not None:
                synchronize_asset_location_hierarchy(
                    rack_ids=(instance.pk,),
                    data_center_id=room.data_center_id,
                )
        return instance


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


class NotificationDeliverySerializer(serializers.ModelSerializer):
    delivery_type = serializers.SerializerMethodField()

    def get_delivery_type(self, obj) -> str:
        return "daily_digest"

    class Meta:
        model = NotificationDelivery
        fields = [
            "id", "delivery_type", "window_date", "status", "attempts",
            "attempted_at", "sent_at", "recipient_count", "error_code",
            "created_at", "updated_at",
        ]
        read_only_fields = fields


class FaultEventSerializer(serializers.ModelSerializer):
    occurred_at = SystemDateTimeInputField()
    reported_at = SystemDateTimeInputField(required=False, allow_null=True)
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
        if self.instance is not None and self.instance.is_closed and attrs:
            raise serializers.ValidationError({
                "detail": "已关闭故障不可修改。",
                "code": "closed_fault_immutable",
            })
        if (
            self.instance is not None
            and "asset" in attrs
            and attrs["asset"].pk != self.instance.asset_id
        ):
            raise serializers.ValidationError({"asset": "故障关联资产创建后不能修改"})
        return attrs

    class Meta:
        model = FaultEvent
        fields = ["id", "created_at", "updated_at", "asset", "asset_no", "asset_name", "occurred_at", "reported_at", "resolved_at", "reason", "description", "is_closed", "repair"]
        read_only_fields = ["id", "created_at", "updated_at", "asset_no", "asset_name", "resolved_at", "is_closed", "repair"]


class RepairRecordSerializer(serializers.ModelSerializer):
    started_at = SystemDateTimeInputField(required=False, allow_null=True)
    finished_at = SystemDateTimeInputField(required=False, allow_null=True)

    def validate(self, attrs):
        if self.instance is not None and self.instance.finished_at is not None and attrs:
            raise serializers.ValidationError({
                "detail": "已完成维修不可直接修改，请先重新打开。",
                "code": "finished_repair_immutable",
            })

        if (
            self.instance is not None
            and "fault" in attrs
            and attrs["fault"].pk != self.instance.fault_id
        ):
            raise serializers.ValidationError({"fault": "维修记录关联故障创建后不能修改"})

        started_at = attrs.get("started_at", self.instance.started_at if self.instance else None)
        finished_at = attrs.get("finished_at", self.instance.finished_at if self.instance else None)
        if started_at and finished_at and started_at > finished_at:
            raise serializers.ValidationError({
                "started_at": "维修开始时间不能晚于维修完成时间",
                "finished_at": "维修完成时间不能早于维修开始时间",
            })
        return attrs

    cost = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = RepairRecord
        fields = ["id", "fault", "provider", "started_at", "finished_at", "cost", "notes", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class RepairPartUsageSerializer(serializers.ModelSerializer):
    source_label = serializers.SerializerMethodField()
    unit = serializers.CharField(source="part_unit", read_only=True)
    unit_label = serializers.SerializerMethodField()
    stock_location = serializers.SerializerMethodField()

    def get_source_label(self, obj) -> str:
        return REPAIR_PART_USAGE_SOURCE_LABELS.get(obj.source, obj.source)

    def get_unit_label(self, obj) -> str:
        return SPARE_UNIT_LABELS.get(obj.part_unit, obj.part_unit)

    def get_stock_location(self, obj) -> str:
        if obj.source != RepairPartUsage.INTERNAL_STOCK:
            return ""
        names = [item for item in (obj.stock_data_center_name, obj.stock_server_room_name) if item]
        return " / ".join(names)

    class Meta:
        model = RepairPartUsage
        fields = [
            "id", "fault", "source", "source_label", "spare_part", "part_code", "part_name",
            "part_model", "unit", "unit_label", "spare_stock", "stock_location",
            "stock_data_center_name", "stock_server_room_name", "vendor_name", "quantity", "notes",
            "operator", "operator_name", "created_at",
        ]
        read_only_fields = fields


class RepairPartUsageCreateSerializer(serializers.Serializer):
    source = serializers.ChoiceField(choices=REPAIR_PART_USAGE_SOURCE_VALUES)
    spare_part_id = serializers.PrimaryKeyRelatedField(
        source="spare_part",
        queryset=SparePart.objects.all(),
        required=False,
        allow_null=True,
    )
    spare_stock_id = serializers.PrimaryKeyRelatedField(
        source="spare_stock",
        queryset=SpareStock.objects.select_related("part", "data_center", "server_room"),
        required=False,
        allow_null=True,
    )
    part_code = serializers.CharField(required=False, allow_blank=True, max_length=80)
    part_name = serializers.CharField(required=False, allow_blank=True, max_length=160)
    part_model = serializers.CharField(required=False, allow_blank=True, max_length=160)
    vendor_name = serializers.CharField(required=False, allow_blank=True, max_length=160)
    quantity = serializers.IntegerField(min_value=1)
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
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
                raise serializers.ValidationError({"spare_stock_id": "内部库存用件必须选择明确的库存位置"})
            if vendor_name:
                raise serializers.ValidationError({"vendor_name": "内部库存用件不能填写厂商名称"})
            if attrs.get("spare_part") is not None and stock.part_id != attrs["spare_part"].pk:
                raise serializers.ValidationError({"spare_stock_id": "所选库存备件与部件不一致"})
            attrs["spare_part"] = stock.part
            if (
                not stock.data_center.is_active
                or (stock.server_room is not None and not stock.server_room.is_active)
            ):
                raise serializers.ValidationError({"spare_stock_id": "停用的数据中心或机房不能作为用件库存位置"})
        else:
            if stock is not None:
                raise serializers.ValidationError({"spare_stock_id": "厂商提供的用件不能关联内部库存"})
            if not attrs["part_name"]:
                raise serializers.ValidationError({"part_name": "厂商提供的用件必须填写部件名称"})
        return attrs
