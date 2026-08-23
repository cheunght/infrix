from django.conf import settings
from django.db.models import BooleanField, Case, CharField, Count, Exists, F, OuterRef, Q, Prefetch, Sum, Value, When
from django.db.models.functions import Coalesce
from django.db import connection, transaction
from django.db.models.expressions import RawSQL
import csv
import io
import re
from decimal import Decimal, InvalidOperation
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.middleware.csrf import get_token
from django.contrib.auth.models import Group, User
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.decorators import action, api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied, ValidationError as DRFValidationError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import date, timedelta
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from .models import AuthThrottleState, AuditLog, Asset, AssetCustomValue, AssetNetworkAddress, AssetTag, Brand, CustomField, CustomFieldOption, DataCenter, DeviceType, FaultEvent, InventoryItem, InventoryTask, MaintenanceContract, ProcurementRecord, Rack, RackUnitAllocation, RepairRecord, ServerRoom, SoftwareLicense, SparePart, SpareStock, SpareStockTransaction, Tag, UserSecurityProfile
from .serializers import AuditLogSerializer, AssetDetailSerializer, AssetListSerializer, AssetSerializer, AssetWriteSerializer, BrandSerializer, CustomFieldOptionSerializer, CustomFieldRuntimeSchemaSerializer, CustomFieldSerializer, DataCenterSerializer, DeviceTypeSerializer, FaultEventSerializer, GroupSerializer, InventoryBulkNormalResponseSerializer, InventoryBulkNormalSerializer, InventoryBulkResolutionResponseSerializer, InventoryBulkResolutionSerializer, InventoryInspectorSerializer, InventoryItemSerializer, InventoryResolutionSerializer, InventoryScopePreviewQuerySerializer, InventoryScopePreviewSerializer, InventoryTaskSerializer, RackSerializer, RepairRecordSerializer, ServerRoomSerializer, SoftwareLicenseSerializer, SparePartDetailSerializer, SparePartSerializer, SpareStockSerializer, SpareStockTransactionSerializer, TagSerializer, UserSerializer, _default_references_option
from .services import (
    apply_spare_stock_transaction,
    confirm_inventory_item_normal,
    inventory_task_delete_block_reason,
    reset_inventory_resolution,
    resolve_inventory_item,
    sync_asset_fault_status,
    sync_fault_completion,
    sync_repair_completion,
    update_asset_placement,
)
from .inventory import get_inventory_scope_assets
from .license_status import filter_licenses_by_status, license_status_counts
from .audit import asset_audit_snapshot, asset_custom_value_changes, model_snapshot, write_audit_log
from .permissions import BusinessRolePermission, CanExportAssets, CanExportFaults, CanExportInventory, CanExportRacks, CanImportAssets, CanManageInventory, CanViewAssetCustomFieldSchema, CanViewAuditLog, CanViewDashboard, CanViewInventory, CanViewLicenses, IsSystemAdministrator
from .roles import ROLE_DEFINITIONS, ROLE_NAME_TO_CODE, user_capabilities, user_has_capability, user_role_code
from .reporting import (
    DashboardScopeError,
    build_dashboard_payload,
    build_rack_capacity_rows,
    rack_effective_used_u,
    resolve_dashboard_scope,
)


class AuditedModelViewSetMixin:
    audit_resource = None

    def audit_snapshot(self, instance):
        return model_snapshot(instance)

    def audit_extra(self, before, after, *, action):
        return None

    @transaction.atomic
    def perform_create(self, serializer):
        instance = serializer.save()
        after = self.audit_snapshot(instance)
        write_audit_log(
            self.request,
            action="create",
            resource_type=self.audit_resource,
            resource_id=instance.pk,
            after=after,
            extra=self.audit_extra(None, after, action="create"),
        )

    @transaction.atomic
    def perform_update(self, serializer):
        before = self.audit_snapshot(serializer.instance)
        instance = serializer.save()
        after = self.audit_snapshot(instance)
        write_audit_log(
            self.request,
            action="update",
            resource_type=self.audit_resource,
            resource_id=instance.pk,
            before=before,
            after=after,
            extra=self.audit_extra(before, after, action="update"),
        )

    @transaction.atomic
    def perform_destroy(self, instance):
        before = self.audit_snapshot(instance)
        resource_id = instance.pk
        instance.delete()
        write_audit_log(
            self.request,
            action="delete",
            resource_type=self.audit_resource,
            resource_id=resource_id,
            before=before,
        )


def _date_filter_errors(request, fields):
    """Return a field error for malformed ISO dates before they reach SQL."""
    for field in fields:
        value = request.query_params.get(field, "").strip()
        if value:
            try:
                date.fromisoformat(value)
            except ValueError:
                return {field: "日期必须使用 YYYY-MM-DD 格式"}
    return None


CUSTOM_FILTER_MAX_CONDITIONS = 8
CUSTOM_FILTER_OPERATOR_SUFFIXES = ("contains", "gte", "lte", "eq")
CUSTOM_FILTER_OPERATORS_BY_TYPE = {
    "text": {"contains", "eq"},
    "textarea": {"contains", "eq"},
    "number": {"eq", "gte", "lte"},
    "date": {"eq", "gte", "lte"},
    "boolean": {"eq"},
    "select": {"eq"},
    "multiselect": {"contains"},
}


def _custom_filter_key_and_operator(query_key):
    field_part = query_key[len("custom__"):]
    for operator in CUSTOM_FILTER_OPERATOR_SUFFIXES:
        suffix = f"__{operator}"
        if field_part.endswith(suffix):
            return field_part[:-len(suffix)], operator
    return field_part, None


def _custom_filter_boolean(value):
    normalized = value.lower()
    if normalized in {"true", "1", "yes", "是"}:
        return True
    if normalized in {"false", "0", "no", "否"}:
        return False
    raise ValueError("必须是是或否")


def _custom_filter_multiselect_membership(value):
    if connection.vendor == "sqlite":
        return RawSQL(
            "EXISTS (SELECT 1 FROM json_each(json_value) WHERE json_type(json_value) = 'array' AND json_each.value = %s)",
            [value],
            output_field=BooleanField(),
        )
    if connection.vendor == "mysql":
        return RawSQL(
            "JSON_TYPE(json_value) = 'ARRAY' AND JSON_CONTAINS(json_value, JSON_QUOTE(%s), '$')",
            [value],
            output_field=BooleanField(),
        )
    return Q(json_value__contains=[value])


class AssetViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    max_custom_columns = 12
    queryset = Asset.objects.select_related("department", "brand", "device_type", "asset_data_center", "rack_allocation__rack__room__data_center").prefetch_related("network_addresses", "procurement_records", "maintenance_contracts", "asset_tags__tag", "custom_values__field__options").order_by("asset_no")
    serializer_class = AssetSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "assets"
    audit_resource = "asset"
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["status", "department", "brand", "device_type", "model"]
    search_fields = [
        "asset_no", "name", "brand_model", "serial_number", "purpose", "owner_name", "notes", "status",
        "brand__name", "device_type__name", "device_type__color", "model", "department__name", "department__code",
        "network_addresses__address", "network_addresses__role", "network_addresses__status", "network_addresses__notes",
        "rack_allocation__rack__code", "rack_allocation__rack__room__name", "rack_allocation__rack__room__data_center__name",
        "rack_allocation__start_u", "rack_allocation__end_u",
        "procurement_records__purchase_date", "procurement_records__supplier", "procurement_records__order_no", "procurement_records__amount", "procurement_records__notes",
        "maintenance_contracts__provider", "maintenance_contracts__contract_no", "maintenance_contracts__notes",
        "maintenance_contracts__start_date", "maintenance_contracts__expiry_date",
        "asset_tags__tag__name", "custom_values__text_value", "custom_values__json_value",
    ]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="custom_columns",
                type=OpenApiTypes.STR,
                required=False,
                description="compact 台账列表需要返回的动态字段 key，支持逗号分隔或重复参数，最多 12 个。",
            ),
            OpenApiParameter(
                name="compact",
                type=OpenApiTypes.BOOL,
                required=False,
                description="使用资产台账的轻量列表响应。",
            ),
            OpenApiParameter(
                name="tag",
                type=OpenApiTypes.STR,
                required=False,
                description="按标签名称筛选资产。",
            ),
            OpenApiParameter(
                name="data_center",
                type=OpenApiTypes.INT,
                required=False,
                description="按数据中心 ID 筛选资产；已上架资产按机柜所属数据中心，未上架资产按所属数据中心。",
            ),
            OpenApiParameter(
                name="warranty",
                type=OpenApiTypes.STR,
                required=False,
                enum=["within_30_days", "expired"],
                description="按维保到期状态筛选：within_30_days 表示今天至未来 30 天内到期，expired 表示已过期。",
            ),
            OpenApiParameter(
                name="custom__{field_key}",
                type=OpenApiTypes.STR,
                required=False,
                description="兼容旧版动态字段等值/文本包含筛选；field_key 为运行时字段编码。",
            ),
            OpenApiParameter(
                name="custom__{field_key}__{operator}",
                type=OpenApiTypes.STR,
                required=False,
                description="动态字段筛选；operator 按字段类型使用 eq、contains、gte 或 lte。多个条件为 AND。",
            ),
        ]
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("search", "").strip():
            queryset = queryset.distinct()
        if self.request.query_params.get("compact", "").lower() in {"1", "true", "yes"}:
            requested_custom_columns = self._requested_custom_columns()
            queryset = queryset.select_related(
                "brand", "device_type", "asset_data_center", "rack_allocation__rack__room__data_center"
            ).prefetch_related(None).prefetch_related(
                Prefetch(
                    "network_addresses",
                    queryset=AssetNetworkAddress.objects.only("id", "asset_id", "role", "address"),
                ),
                Prefetch(
                    "procurement_records",
                    queryset=ProcurementRecord.objects.only("id", "asset_id", "purchase_date", "supplier", "order_no").order_by("-purchase_date", "-id"),
                ),
                Prefetch(
                    "maintenance_contracts",
                    queryset=MaintenanceContract.objects.only("id", "asset_id", "provider", "expiry_date").order_by("-updated_at", "-id"),
                ),
                Prefetch("asset_tags", queryset=AssetTag.objects.select_related("tag")),
            )
            if requested_custom_columns:
                queryset = queryset.prefetch_related(
                    Prefetch(
                        "custom_values",
                        queryset=AssetCustomValue.objects.filter(
                            field__key__in=requested_custom_columns,
                            field__is_active=True,
                            field__list_visible=True,
                        ).select_related("field"),
                        to_attr="list_custom_values",
                    )
                )
        tag = self.request.query_params.get("tag", "").strip()
        if tag:
            queryset = queryset.filter(asset_tags__tag__name__iexact=tag)
        data_center = self.request.query_params.get("data_center", "").strip()
        try:
            data_center_id = int(data_center) if data_center else None
        except (TypeError, ValueError):
            data_center_id = None
        if data_center_id and data_center_id > 0:
            queryset = queryset.filter(
                Q(rack_allocation__rack__room__data_center_id=data_center_id)
                | Q(rack_allocation__isnull=True, asset_data_center_id=data_center_id)
            ).distinct()
        warranty = self.request.query_params.get("warranty", "").strip()
        today = timezone.localdate()
        if warranty == "within_30_days":
            queryset = queryset.filter(
                maintenance_contracts__expiry_date__gte=today,
                maintenance_contracts__expiry_date__lte=today + timedelta(days=30),
            ).distinct()
        elif warranty == "expired":
            queryset = queryset.filter(maintenance_contracts__expiry_date__lt=today).distinct()
        for field, operator, value in self._validated_custom_filters():
            values = AssetCustomValue.objects.filter(
                asset_id=OuterRef("pk"),
                field_id=field.id,
                field__is_active=True,
            ).filter(
                Q(field__device_type_id__isnull=True)
                | Q(field__device_type_id=OuterRef("device_type_id")),
            )
            if field.field_type in {"text", "textarea"}:
                lookup = "text_value__icontains" if operator == "contains" else "text_value"
                values = values.filter(**{lookup: value})
            elif field.field_type == "number":
                lookup = {"eq": "exact", "gte": "gte", "lte": "lte"}[operator]
                values = values.filter(**{f"number_value__{lookup}": value})
            elif field.field_type == "date":
                lookup = {"eq": "exact", "gte": "gte", "lte": "lte"}[operator]
                values = values.filter(**{f"date_value__{lookup}": value})
            elif field.field_type == "boolean":
                values = values.filter(boolean_value=value)
            elif field.field_type == "select":
                values = values.filter(text_value=value)
            else:
                values = values.filter(_custom_filter_multiselect_membership(value))
            queryset = queryset.filter(Exists(values))
        if tag:
            queryset = queryset.distinct()
        return queryset

    def _validated_custom_filters(self):
        raw_conditions = [
            (query_key, value)
            for query_key, values in self.request.query_params.lists()
            if query_key.startswith("custom__")
            for value in values
        ]
        if not raw_conditions:
            return []
        if len(raw_conditions) > CUSTOM_FILTER_MAX_CONDITIONS:
            raise DRFValidationError({"custom_filters": f"动态筛选条件最多 {CUSTOM_FILTER_MAX_CONDITIONS} 条"})

        parsed = []
        field_keys = set()
        for query_key, raw_value in raw_conditions:
            field_key, explicit_operator = _custom_filter_key_and_operator(query_key)
            parsed.append((query_key, field_key, explicit_operator, raw_value))
            if field_key:
                field_keys.add(field_key)
        fields = {
            field.key: field
            for field in CustomField.objects.filter(key__in=field_keys).select_related("device_type").prefetch_related("options")
        }
        errors = []
        validated = []
        for query_key, field_key, explicit_operator, raw_value in parsed:
            field = fields.get(field_key)
            if not field:
                errors.append(f"{query_key}：字段不存在")
                continue
            if not field.is_active:
                errors.append(f"{field.name}：字段已停用")
                continue
            if not field.filterable:
                errors.append(f"{field.name}：字段未开启筛选")
                continue
            operator = explicit_operator or ("contains" if field.field_type in {"text", "textarea", "multiselect"} else "eq")
            if operator not in CUSTOM_FILTER_OPERATORS_BY_TYPE.get(field.field_type, set()):
                errors.append(f"{field.name}：不支持“{operator}”操作")
                continue
            value = str(raw_value).strip()
            if not value:
                errors.append(f"{field.name}：筛选值不能为空")
                continue
            try:
                if field.field_type == "number":
                    value = Decimal(value)
                    if not value.is_finite():
                        raise ValueError("必须是有限数字")
                elif field.field_type == "date":
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                        raise ValueError("必须使用 YYYY-MM-DD 格式")
                    value = date.fromisoformat(value)
                elif field.field_type == "boolean":
                    value = _custom_filter_boolean(value)
                elif field.field_type in {"select", "multiselect"}:
                    active_options = {option.value for option in field.options.all() if option.is_active}
                    if value not in active_options:
                        raise ValueError("选项值不存在或已停用")
            except (InvalidOperation, ValueError) as exc:
                errors.append(f"{field.name}：{exc}")
                continue
            validated.append((field, operator, value))
        if errors:
            raise DRFValidationError({"custom_filters": errors})
        return validated

    def _requested_custom_columns(self) -> "list[str]":
        cached = getattr(self, "_requested_custom_columns_cache", None)
        if cached is not None:
            return cached

        raw_values = self.request.query_params.getlist("custom_columns")
        keys = []
        for raw_value in raw_values:
            keys.extend(part.strip() for part in raw_value.split(",") if part.strip())
        keys = list(dict.fromkeys(keys))
        if len(keys) > self.max_custom_columns:
            raise DRFValidationError({
                "custom_columns": f"动态列最多同时请求 {self.max_custom_columns} 个字段",
            })
        if not keys:
            self._requested_custom_columns_cache = []
            return []

        available = set(
            CustomField.objects.filter(
                key__in=keys,
                is_active=True,
                list_visible=True,
            ).values_list("key", flat=True)
        )
        missing = [key for key in keys if key not in available]
        if missing:
            raise DRFValidationError({
                "custom_columns": f"动态列不存在、已停用或未开启列表展示：{', '.join(missing)}",
            })
        self._requested_custom_columns_cache = keys
        return keys

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action == "list" and self.request.query_params.get("compact", "").lower() in {"1", "true", "yes"}:
            context["requested_custom_columns"] = self._requested_custom_columns()
        else:
            context["requested_custom_columns"] = []
        return context

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return AssetWriteSerializer
        if self.action == "retrieve":
            return AssetDetailSerializer
        if self.request.query_params.get("compact", "").lower() in {"1", "true", "yes"}:
            return AssetListSerializer
        return AssetSerializer

    def audit_snapshot(self, instance):
        return asset_audit_snapshot(instance.pk)

    def audit_extra(self, before, after, *, action):
        if action not in {"create", "update"}:
            return None
        changes = asset_custom_value_changes(
            (before or {}).get("custom_value_snapshot"),
            (after or {}).get("custom_value_snapshot"),
        )
        return {"custom_changes": changes} if changes else None

    @transaction.atomic
    def perform_destroy(self, instance):
        before = self.audit_snapshot(instance)
        resource_id = instance.pk
        try:
            instance.delete()
        except Exception as exc:
            from django.db.models.deletion import ProtectedError
            from rest_framework.exceptions import ValidationError as DRFValidationError
            if isinstance(exc, ProtectedError):
                protected = list(exc.protected_objects)
                if any(isinstance(item, InventoryItem) for item in protected):
                    raise DRFValidationError("资产存在历史盘点记录，不能删除") from exc
                if any(isinstance(item, FaultEvent) for item in protected):
                    raise DRFValidationError("资产存在关联故障记录，不能删除") from exc
                raise DRFValidationError("资产存在关联数据，不能删除") from exc
            raise
        write_audit_log(
            self.request,
            action="delete",
            resource_type=self.audit_resource,
            resource_id=resource_id,
            before=before,
        )


class RackViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = Rack.objects.select_related("room", "room__data_center").prefetch_related(
        Prefetch("allocations", queryset=RackUnitAllocation.objects.select_related("asset", "asset__brand", "asset__device_type", "rack__room__data_center"))
    )
    serializer_class = RackSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "racks"
    audit_resource = "rack"
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ["room", "room__data_center", "code", "status"]
    search_fields = ["code", "name", "rack_type", "owner_name", "room__name", "room__data_center__name"]

    def get_queryset(self):
        queryset = super().get_queryset()
        device_type = self.request.query_params.get("device_type", "").strip()
        if device_type:
            queryset = queryset.filter(allocations__asset__device_type__name=device_type).distinct()
        active = self.request.query_params.get("is_active", "true").strip().lower()
        if self.action in {"retrieve", "update", "partial_update", "destroy"}:
            return queryset.order_by("room__data_center__name", "room__name", "code")
        if active in {"true", "false"}:
            queryset = queryset.filter(is_active=active == "true")
        status = self.request.query_params.get("status", "").strip()
        if status in {"in_use", "reserved", "disabled"}:
            queryset = queryset.filter(status=status)
        return queryset.order_by("room__data_center__name", "room__name", "code")

    def perform_destroy(self, instance):
        if instance.allocations.exists():
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError("机柜仍有资产占用，不能删除，请先迁移资产或停用机柜")
        super().perform_destroy(instance)


class ServerRoomViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = ServerRoom.objects.select_related("data_center").annotate(
        racks_count=Count("racks", distinct=True),
        assets_count=Count("racks__allocations__asset", distinct=True),
    ).order_by("data_center__name", "name")
    serializer_class = ServerRoomSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "racks"
    audit_resource = "server_room"
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["data_center", "is_active"]
    search_fields = ["name", "data_center__name"]
    ordering_fields = ["name", "created_at", "updated_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action in {"retrieve", "update", "partial_update", "destroy"}:
            return queryset
        active = self.request.query_params.get("is_active", "true").strip().lower()
        if active in {"true", "false"}:
            queryset = queryset.filter(is_active=active == "true")
        return queryset

    @transaction.atomic
    def perform_update(self, serializer):
        if serializer.validated_data.get("is_active") is False:
            locked_room = ServerRoom.objects.select_for_update().get(pk=serializer.instance.pk)
            if locked_room.is_active and locked_room.spare_stocks.filter(quantity__gt=0).exists():
                from rest_framework.exceptions import ValidationError as DRFValidationError
                raise DRFValidationError("机房仍有备件库存，无法停用，请先调出、出库或报废库存")
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        if instance.racks.exists():
            from rest_framework.exceptions import ValidationError as DRFValidationError
            racks = list(instance.racks.values_list("code", flat=True)[:5])
            raise DRFValidationError(
                f"机房仍包含机柜（{', '.join(racks)}），不能删除，请先迁移或删除机柜后再操作"
            )
        try:
            super().perform_destroy(instance)
        except Exception as exc:
            from django.db.models.deletion import ProtectedError
            from rest_framework.exceptions import ValidationError as DRFValidationError
            if isinstance(exc, ProtectedError):
                if instance.spare_stocks.exists():
                    raise DRFValidationError("机房仍有备件库存，不能删除，请先调整库存地点") from exc
                if instance.spare_source_transactions.exists() or instance.spare_target_transactions.exists():
                    raise DRFValidationError("机房存在备件库存流水，不能删除") from exc
            raise


class DataCenterViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = DataCenter.objects.annotate(
        assets_count=(
            Count("rooms__racks__allocations__asset", distinct=True)
            + Count(
                "unmounted_assets",
                filter=Q(unmounted_assets__rack_allocation__isnull=True),
                distinct=True,
            )
        ),
        rooms_count=Count("rooms", distinct=True),
    ).order_by("name")
    serializer_class = DataCenterSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "racks"
    audit_resource = "data_center"

    def get_queryset(self):
        queryset = super().get_queryset()
        # Keep inactive data centers addressable for administrator actions.
        # The list defaults to active entries, but update/delete must still
        # resolve a previously disabled entry instead of returning 404.
        if self.action in {"retrieve", "update", "partial_update", "destroy"}:
            return queryset
        active = self.request.query_params.get("is_active", "true").strip().lower()
        if active in {"true", "false"}:
            queryset = queryset.filter(is_active=active == "true")
        search = self.request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(address__icontains=search))
        return queryset

    @transaction.atomic
    def perform_update(self, serializer):
        if serializer.validated_data.get("is_active") is False:
            locked_data_center = DataCenter.objects.select_for_update().get(pk=serializer.instance.pk)
            if locked_data_center.is_active and locked_data_center.spare_stocks.filter(quantity__gt=0).exists():
                from rest_framework.exceptions import ValidationError as DRFValidationError
                raise DRFValidationError("数据中心仍有备件库存，无法停用，请先调出、出库或报废库存")
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        if instance.rooms.exists():
            from rest_framework.exceptions import ValidationError as DRFValidationError
            rooms = list(instance.rooms.values_list("name", flat=True)[:5])
            raise DRFValidationError(f"数据中心仍包含机房（{', '.join(rooms)}），不能删除，请先删除机房或停用")
        try:
            super().perform_destroy(instance)
        except Exception as exc:
            from django.db.models.deletion import ProtectedError
            from rest_framework.exceptions import ValidationError as DRFValidationError
            if isinstance(exc, ProtectedError):
                if instance.unmounted_assets.exists():
                    raise DRFValidationError("数据中心仍有未上架资产归属，不能删除，请先调整资产所属数据中心") from exc
                if instance.inventory_tasks.exists():
                    raise DRFValidationError("数据中心仍有历史盘点任务，不能删除") from exc
                if instance.spare_stocks.exists():
                    raise DRFValidationError("数据中心仍有备件库存，不能删除，请先调整库存地点") from exc
                if instance.spare_source_transactions.exists() or instance.spare_target_transactions.exists():
                    raise DRFValidationError("数据中心存在备件库存流水，不能删除") from exc
            raise

    def destroy(self, request, *args, **kwargs):
        # Resolve by primary key directly so an inactive data center is not
        # hidden by the list filter during DELETE and turned into a 404.
        from rest_framework.exceptions import NotFound
        try:
            instance = DataCenter.objects.get(pk=kwargs.get(self.lookup_field, kwargs.get("pk")))
        except DataCenter.DoesNotExist as exc:
            raise NotFound("数据中心不存在") from exc
        self.perform_destroy(instance)
        from rest_framework.response import Response
        return Response(status=204)


class DictionaryViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    search_fields = ["name"]
    ordering_fields = ["name", "created_at", "updated_at"]
    ordering = ["name", "id"]

    permission_classes = [BusinessRolePermission]
    permission_resource = "settings"

    def get_queryset(self):
        queryset = self.queryset.annotate(assets_count=Count("assets"))
        active = self.request.query_params.get("is_active", "true").strip().lower()
        if "settings.manage" not in user_capabilities(self.request.user):
            active = "true"
        if active in {"true", "false"}:
            queryset = queryset.filter(is_active=active == "true")
        return queryset

    def perform_create(self, serializer):
        super().perform_create(serializer)
        instance = serializer.instance
        instance.assets_count = 0

    def perform_update(self, serializer):
        super().perform_update(serializer)
        instance = serializer.instance
        instance.assets_count = instance.assets.count()

    def perform_destroy(self, instance):
        if instance.assets.exists():
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError("字典项正在被资产使用，不能删除，请先停用")
        super().perform_destroy(instance)


class BrandViewSet(DictionaryViewSet):
    queryset = Brand.objects.all()
    serializer_class = BrandSerializer
    audit_resource = "brand"


class DeviceTypeViewSet(DictionaryViewSet):
    queryset = DeviceType.objects.all()
    serializer_class = DeviceTypeSerializer
    audit_resource = "device_type"


class CustomFieldViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = CustomField.objects.select_related("device_type").prefetch_related("options").annotate(
        assets_count=Count("asset_values__asset", distinct=True)
    ).order_by("device_type__name", "sort_order", "id")
    serializer_class = CustomFieldSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "custom_fields"
    audit_resource = "custom_field"
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["device_type", "field_type", "is_active"]
    search_fields = ["key", "name", "device_type__name"]
    ordering_fields = ["name", "sort_order", "created_at", "updated_at"]

    def get_permissions(self):
        if self.action == "schema_fields":
            return [CanViewAssetCustomFieldSchema()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action not in {"retrieve", "update", "partial_update", "destroy"}:
            active = self.request.query_params.get("is_active", "true").strip().lower()
            if "custom_fields.manage" not in user_capabilities(self.request.user):
                active = "true"
            if active in {"true", "false"}:
                queryset = queryset.filter(is_active=active == "true")
        return queryset

    @extend_schema(
        parameters=[
            OpenApiParameter(
                name="device_type",
                type=OpenApiTypes.INT,
                required=False,
                description="仅返回全局字段与指定设备类型字段。",
            ),
            OpenApiParameter(
                name="list_visible",
                type=OpenApiTypes.BOOL,
                required=False,
                description="仅返回启用且允许台账列展示的字段。",
            ),
            OpenApiParameter(
                name="filterable",
                type=OpenApiTypes.BOOL,
                required=False,
                description="仅返回启用且允许台账筛选的字段；返回选项仅包含启用选项。",
            ),
        ],
        responses=CustomFieldRuntimeSchemaSerializer(many=True),
    )
    @action(detail=False, methods=["get"], url_path="schema", pagination_class=None, filter_backends=[])
    def schema_fields(self, request):
        list_visible = request.query_params.get("list_visible", "").strip().lower() in {"1", "true", "yes"}
        filterable = request.query_params.get("filterable", "").strip().lower() in {"1", "true", "yes"}
        if list_visible or filterable:
            filters = {"is_active": True}
            if list_visible:
                filters["list_visible"] = True
            if filterable:
                filters["filterable"] = True
            options = CustomFieldOption.objects.all().order_by("sort_order", "id")
            if filterable:
                options = options.filter(is_active=True)
            queryset = CustomField.objects.filter(**filters).select_related("device_type").prefetch_related(
                Prefetch("options", queryset=options)
            ).order_by("device_type__name", "sort_order", "id")
            return Response(CustomFieldRuntimeSchemaSerializer(queryset, many=True).data)

        device_type = request.query_params.get("device_type", "").strip()
        if device_type:
            scope = Q(device_type__isnull=True) | Q(device_type_id=device_type)
        else:
            scope = Q(device_type__isnull=True)
        queryset = CustomField.objects.filter(is_active=True).filter(scope).select_related("device_type").prefetch_related(
            Prefetch("options", queryset=CustomFieldOption.objects.filter(is_active=True))
        ).order_by("sort_order", "id")
        return Response(CustomFieldRuntimeSchemaSerializer(queryset, many=True).data)

    def perform_destroy(self, instance):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        if instance.asset_values.exists():
            raise DRFValidationError("字段已有资产值，不能删除，请先停用")
        if instance.options.exists():
            raise DRFValidationError("字段仍有选项，不能删除，请先删除选项")
        super().perform_destroy(instance)


class CustomFieldOptionViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = CustomFieldOption.objects.select_related("field", "field__device_type").order_by("field_id", "sort_order", "id")
    serializer_class = CustomFieldOptionSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "custom_fields"
    audit_resource = "custom_field_option"
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["field", "is_active"]
    search_fields = ["value", "label", "field__name"]
    ordering_fields = ["sort_order", "created_at", "updated_at"]

    def perform_destroy(self, instance):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        if _default_references_option(instance.field, instance.value):
            raise DRFValidationError("选项被字段默认值引用，不能删除")
        used = False
        for text_value, json_value in AssetCustomValue.objects.filter(
            field_id=instance.field_id
        ).values_list("text_value", "json_value"):
            if text_value == instance.value or (
                isinstance(json_value, list) and instance.value in json_value
            ):
                used = True
                break
        if used:
            raise DRFValidationError("选项已有资产使用，不能删除，请先停用")
        super().perform_destroy(instance)


class TagViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = Tag.objects.annotate(assets_count=Count("asset_tags__asset", distinct=True)).order_by("name", "id")
    serializer_class = TagSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "tags"
    audit_resource = "tag"
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["is_active"]
    search_fields = ["name"]
    ordering_fields = ["name", "created_at", "updated_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action not in {"retrieve", "update", "partial_update", "destroy"}:
            active = self.request.query_params.get("is_active", "true").strip().lower()
            if "tags.manage" not in user_capabilities(self.request.user):
                active = "true"
            if active in {"true", "false"}:
                queryset = queryset.filter(is_active=active == "true")
        return queryset

    def perform_destroy(self, instance):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        if instance.asset_tags.exists():
            raise DRFValidationError("标签正在被资产使用，不能删除，请先停用")
        super().perform_destroy(instance)


class SparePartViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = SparePart.objects.select_related("brand").annotate(
        total_quantity=Coalesce(Sum("stocks__quantity"), 0),
        location_count=Count("stocks", distinct=True),
        part_type_label_search=Case(
            *[
                When(part_type=code, then=Value(label))
                for code, label in SparePart.PART_TYPES
            ],
            default=Value(""),
            output_field=CharField(),
        ),
    ).order_by("name", "part_type", "id")
    serializer_class = SparePartSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "spares"
    audit_resource = "spare_part"
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["part_type", "brand", "is_active"]
    search_fields = ["name", "part_type", "part_type_label_search", "brand__name", "model", "specification", "notes"]
    ordering_fields = ["name", "part_type", "created_at", "updated_at"]

    def get_serializer_class(self):
        if self.action == "retrieve":
            return SparePartDetailSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        queryset = super().get_queryset()
        # A part can be stored at more than one location. Filter through its
        # stock balances and de-duplicate the result when it matches several
        # locations.
        data_center = self.request.query_params.get("data_center", "").strip()
        server_room = self.request.query_params.get("server_room", "").strip()
        if data_center:
            queryset = queryset.filter(stocks__data_center_id=data_center)
        if server_room:
            queryset = queryset.filter(stocks__server_room_id=server_room)
        if data_center or server_room:
            queryset = queryset.distinct()
        if self.action in {"retrieve", "update", "partial_update", "destroy"}:
            return queryset
        active = self.request.query_params.get("is_active", "true").strip().lower()
        if "spares.manage" not in user_capabilities(self.request.user):
            active = "true"
        if active in {"true", "false"}:
            queryset = queryset.filter(is_active=active == "true")
        return queryset

    @transaction.atomic
    def perform_destroy(self, instance):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        # Keep the delete lock order identical to apply_spare_stock_transaction:
        # part first, then related stock/ledger rows.
        try:
            locked_part = SparePart.objects.select_for_update().get(pk=instance.pk)
        except SparePart.DoesNotExist as exc:
            raise DRFValidationError("备件不存在") from exc
        if locked_part.transactions.exists():
            raise DRFValidationError("备件存在库存流水，不能删除，请先停用")
        if locked_part.stocks.filter(quantity__gt=0).exists():
            raise DRFValidationError("备件仍有库存余额，不能删除，请先出库或报废")
        # Zero-balance rows are only bookkeeping placeholders. They can be
        # removed when the part has no immutable transaction history.
        locked_part.stocks.all().delete()
        super().perform_destroy(locked_part)


class SpareStockViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SpareStock.objects.select_related("part", "part__brand", "data_center", "server_room").order_by(
        "part__name", "data_center__name", "server_room__name", "id"
    )
    serializer_class = SpareStockSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "spares"
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["part", "data_center", "server_room"]
    ordering_fields = ["quantity", "updated_at"]


class SpareStockTransactionViewSet(viewsets.ModelViewSet):
    queryset = SpareStockTransaction.objects.select_related(
        "part", "part__brand", "operator", "source_data_center", "source_server_room",
        "target_data_center", "target_server_room",
    ).order_by("-created_at", "-id")
    serializer_class = SpareStockTransactionSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "spares"
    http_method_names = ["get", "post", "head", "options"]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["part", "operation_type", "source_data_center", "target_data_center", "operator"]
    search_fields = ["part__name", "part__model", "reference", "notes", "operator__username"]
    ordering_fields = ["created_at", "quantity", "operation_type"]

    @transaction.atomic
    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        try:
            transaction_row = apply_spare_stock_transaction(serializer.validated_data, self.request.user)
        except DjangoValidationError as exc:
            detail = getattr(exc, "message_dict", None) or {"detail": "; ".join(exc.messages)}
            raise DRFValidationError(detail) from exc
        serializer.instance = transaction_row
        write_audit_log(
            self.request,
            action="create",
            resource_type="spare_stock_transaction",
            resource_id=transaction_row.pk,
            after=SpareStockTransactionSerializer(transaction_row).data,
        )


class SoftwareLicenseViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = SoftwareLicense.objects.all()
    serializer_class = SoftwareLicenseSerializer
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ["name", "vendor", "license_type", "notes"]
    ordering_fields = ["name", "vendor", "expiry_date", "authorized_count", "used_count", "created_at"]
    ordering = ["expiry_date", "name", "id"]
    permission_classes = [BusinessRolePermission]
    permission_resource = "licenses"
    audit_resource = "software_license"

    def get_queryset(self):
        queryset = super().get_queryset()
        status = self.request.query_params.get("status", "").strip()
        return filter_licenses_by_status(queryset, status)


class GroupViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Group.objects.filter(name__in=ROLE_NAME_TO_CODE).annotate(user_count=Count("user")).order_by("id")
    serializer_class = GroupSerializer
    permission_classes = [IsSystemAdministrator]
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ["name"]
    ordering_fields = ["name", "user_count"]


def _user_audit_snapshot(user):
    role_code = user_role_code(user)
    return {
        "username": user.username,
        "display_name": user.get_full_name() or user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "role_code": role_code,
        "role_name": ROLE_DEFINITIONS.get(role_code, {}).get("name", ""),
        "is_active": user.is_active,
    }


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.prefetch_related("groups").order_by("username")
    serializer_class = UserSerializer
    permission_classes = [IsSystemAdministrator]
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ["username", "first_name", "last_name", "email"]
    ordering_fields = ["username", "date_joined", "last_login"]

    @transaction.atomic
    def perform_create(self, serializer):
        instance = serializer.save()
        write_audit_log(
            self.request,
            action="create",
            resource_type="user",
            resource_id=instance.pk,
            after=_user_audit_snapshot(instance),
        )

    @transaction.atomic
    def perform_update(self, serializer):
        before = _user_audit_snapshot(serializer.instance)
        password_reset = "password" in serializer.validated_data
        instance = serializer.save()
        write_audit_log(
            self.request,
            action="update",
            resource_type="user",
            resource_id=instance.pk,
            before=before,
            after=_user_audit_snapshot(instance),
            extra={"password_reset": True} if password_reset else None,
        )

    @transaction.atomic
    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError("不能删除当前登录账号")
        if instance.is_superuser:
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError("不能通过业务接口删除超级管理员")
        before = _user_audit_snapshot(instance)
        resource_id = instance.pk
        instance.delete()
        write_audit_log(
            self.request,
            action="delete",
            resource_type="user",
            resource_id=resource_id,
            before=before,
        )


class FaultEventViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = FaultEvent.objects.select_related("asset", "repair")
    serializer_class = FaultEventSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["asset", "is_closed"]
    search_fields = ["asset__asset_no", "asset__name", "reason", "description"]
    ordering_fields = ["occurred_at", "created_at"]
    ordering = ["-occurred_at"]
    permission_classes = [BusinessRolePermission]
    permission_resource = "faults"
    audit_resource = "fault_event"

    def get_queryset(self):
        queryset = super().get_queryset()
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            queryset = queryset.filter(occurred_at__date__gte=start)
        if end:
            queryset = queryset.filter(occurred_at__date__lte=end)
        return queryset

    def list(self, request, *args, **kwargs):
        errors = _date_filter_errors(request, ("start", "end"))
        if errors:
            return Response(errors, status=400)
        return super().list(request, *args, **kwargs)

    @transaction.atomic
    def perform_create(self, serializer):
        super().perform_create(serializer)
        fault = serializer.instance
        sync_asset_fault_status(fault.asset_id, request=self.request, fault_id=fault.pk)

    @transaction.atomic
    def perform_update(self, serializer):
        previous_asset_id = serializer.instance.asset_id
        super().perform_update(serializer)
        fault = serializer.instance
        sync_asset_fault_status(previous_asset_id, request=self.request)
        if fault.asset_id != previous_asset_id:
            sync_asset_fault_status(fault.asset_id, request=self.request, fault_id=fault.pk)

    @transaction.atomic
    def perform_destroy(self, instance):
        asset_id = instance.asset_id
        super().perform_destroy(instance)
        sync_asset_fault_status(asset_id, request=self.request)


class RepairRecordViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = RepairRecord.objects.select_related("fault", "fault__asset")
    serializer_class = RepairRecordSerializer
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["fault"]
    ordering_fields = ["created_at", "started_at", "finished_at"]
    ordering = ["-created_at"]
    permission_classes = [BusinessRolePermission]
    permission_resource = "faults"
    audit_resource = "repair_record"

    @transaction.atomic
    def perform_create(self, serializer):
        super().perform_create(serializer)
        repair = serializer.instance
        sync_repair_completion(repair, request=self.request)

    @transaction.atomic
    def perform_update(self, serializer):
        super().perform_update(serializer)
        repair = serializer.instance
        sync_repair_completion(repair, request=self.request)

    @transaction.atomic
    def perform_destroy(self, instance):
        fault = instance.fault
        super().perform_destroy(instance)
        sync_fault_completion(
            fault_id=fault.pk,
            finished_at=None,
            request=self.request,
            repair_id=instance.pk,
        )


def _inventory_snapshot(asset):
    allocation = getattr(asset, "rack_allocation", None)
    network = {
        item.role: item.address
        for item in getattr(asset, "network_addresses", []).all()
    }
    if allocation:
        location = {
            "data_center_id": allocation.rack.room.data_center_id,
            "data_center": allocation.rack.room.data_center.name,
            "server_room_id": allocation.rack.room_id,
            "server_room": allocation.rack.room.name,
            "rack_id": allocation.rack_id,
            "rack_code": allocation.rack.code,
            "start_u": allocation.start_u,
            "end_u": allocation.end_u,
        }
    else:
        location = {
            "data_center_id": asset.asset_data_center_id,
            "data_center": asset.asset_data_center.name if asset.asset_data_center_id else "",
            "server_room_id": None,
            "server_room": "",
            "rack_id": None,
            "rack_code": "",
            "start_u": None,
            "end_u": None,
        }
    return {
        "asset_no": asset.asset_no,
        "name": asset.name,
        "asset_type": asset.asset_type,
        "serial_number": asset.serial_number,
        "status": asset.status,
        "business_ip": network.get("business", ""),
        "management_ip": network.get("management", ""),
        "oob_ip": network.get("oob", ""),
        **location,
    }


class InventoryTaskViewSet(AuditedModelViewSetMixin, viewsets.ModelViewSet):
    queryset = InventoryTask.objects.select_related(
        "data_center", "server_room", "inspector"
    ).prefetch_related("items")
    serializer_class = InventoryTaskSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "inventory"
    audit_resource = "inventory_task"
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["status", "data_center", "server_room", "inspector"]
    search_fields = ["name", "data_center__name", "server_room__name", "inspector__username"]
    ordering_fields = ["created_at", "start_at", "end_at", "name"]
    ordering = ["-created_at", "-id"]

    def get_permissions(self):
        if self.action == "scope_preview":
            return [CanManageInventory()]
        if self.action == "export":
            return [CanExportInventory()]
        if self.action in {"complete", "reopen"}:
            return [CanManageInventory()]
        return super().get_permissions()

    @transaction.atomic
    def perform_create(self, serializer):
        task = serializer.save(inspector=serializer.validated_data.get("inspector") or self.request.user)
        assets = get_inventory_scope_assets(task.data_center, task.server_room)
        InventoryItem.objects.bulk_create([
            InventoryItem(task=task, asset=asset, system_snapshot=_inventory_snapshot(asset))
            for asset in assets
        ])
        write_audit_log(
            self.request,
            action="create",
            resource_type=self.audit_resource,
            resource_id=task.pk,
            after={"task": model_snapshot(task), "items_created": len(assets)},
        )

    @transaction.atomic
    def perform_destroy(self, instance):
        items = list(InventoryItem.objects.filter(task_id=instance.pk).select_for_update().order_by("pk").only(
            "status",
            "resolution_status",
            "resolution_action",
            "resolution_note",
            "resolved_by",
            "resolved_at",
        ))
        task = InventoryTask.objects.select_for_update().get(pk=instance.pk)
        block_reason = inventory_task_delete_block_reason(task, items)
        if block_reason:
            raise DRFValidationError({"detail": block_reason})
        super().perform_destroy(task)

    @extend_schema(
        parameters=[InventoryScopePreviewQuerySerializer],
        responses=InventoryScopePreviewSerializer,
        description="预览创建盘点任务时将生成的资产范围，不创建任务或盘点明细。",
    )
    @action(detail=False, methods=["get"], url_path="scope-preview")
    def scope_preview(self, request):
        query_params = {
            "data_center": request.query_params.get("data_center"),
            "server_room": request.query_params.get("server_room") or None,
        }
        serializer = InventoryScopePreviewQuerySerializer(data=query_params)
        serializer.is_valid(raise_exception=True)
        data_center = serializer.validated_data["data_center"]
        server_room = serializer.validated_data.get("server_room")
        assets = get_inventory_scope_assets(data_center, server_room)

        total = assets.count()
        racked = assets.filter(rack_allocation__isnull=False).count()
        unracked = assets.filter(rack_allocation__isnull=True).count()
        retired = assets.filter(status="retired").count()
        warnings = []
        if unracked:
            warnings.append(f"当前范围包含 {unracked} 台未上架资产")
        if retired:
            warnings.append(f"当前范围包含 {retired} 台已报废资产")

        payload = {
            "data_center": {"id": data_center.id, "name": data_center.name},
            "server_room": (
                {"id": server_room.id, "name": server_room.name}
                if server_room is not None
                else None
            ),
            "scope_label": (
                f"{data_center.name} / {server_room.name}"
                if server_room is not None
                else f"{data_center.name} / 整个数据中心"
            ),
            "total": total,
            "racked": racked,
            "unracked": unracked,
            "retired": retired,
            "includes_unracked": server_room is None,
            "warnings": warnings,
        }
        return Response(InventoryScopePreviewSerializer(payload).data)

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        # ``get_object`` applies the list search backends to query parameters.
        # The item search belongs to the nested item queryset, so resolving the
        # task from the base queryset prevents ``?search=SN...`` from filtering
        # the task itself to a false 404.
        task = get_object_or_404(InventoryTask, pk=pk)
        queryset = InventoryItem.objects.filter(task=task).select_related(
            "asset", "checked_by", "resolved_by", "actual_rack__room__data_center"
        ).order_by("asset__asset_no", "id")
        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(asset__asset_no__icontains=search)
                | Q(asset__name__icontains=search)
                | Q(asset__serial_number__icontains=search)
                | Q(asset__network_addresses__address__icontains=search)
            ).distinct()
        status = request.query_params.get("status", "").strip()
        if status:
            queryset = queryset.filter(status=status)
        resolution_status = request.query_params.get("resolution_status", "").strip()
        if resolution_status:
            queryset = queryset.filter(resolution_status=resolution_status)
        page = self.paginate_queryset(queryset)
        serializer = InventoryItemSerializer(page or queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="complete")
    @transaction.atomic
    def complete(self, request, pk=None):
        task = InventoryTask.objects.select_for_update().get(pk=self.get_object().pk)
        if task.status == "completed":
            return Response(InventoryTaskSerializer(task).data)
        pending = task.items.filter(status="pending").count()
        if pending:
            return Response({"detail": f"还有 {pending} 台设备未盘点，不能完成任务"}, status=400)
        task.status = "completed"
        task.completed_at = timezone.now()
        task.save(update_fields=["status", "completed_at", "updated_at"])
        write_audit_log(
            request,
            action="complete",
            resource_type=self.audit_resource,
            resource_id=task.pk,
            after={"status": task.status, "completed_at": task.completed_at},
        )
        return Response(InventoryTaskSerializer(task).data)

    @action(detail=True, methods=["post"], url_path="reopen")
    @transaction.atomic
    def reopen(self, request, pk=None):
        task = self.get_object()
        task.status = "in_progress"
        task.completed_at = None
        task.save(update_fields=["status", "completed_at", "updated_at"])
        write_audit_log(
            request,
            action="reopen",
            resource_type=self.audit_resource,
            resource_id=task.pk,
            after={"status": task.status},
        )
        return Response(InventoryTaskSerializer(task).data)

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        task = self.get_object()
        items = InventoryItem.objects.filter(task=task).select_related(
            "asset", "checked_by", "resolved_by", "actual_rack__room__data_center"
        ).order_by("asset__asset_no", "id")
        book = Workbook()
        sheet = book.active
        sheet.title = "盘点结果"
        headers = [
            "盘点名称", "数据中心", "机房", "盘点人", "资产编号", "资产名称", "序列号", "设备类型", "业务 IP", "管理 IP", "带外 IP",
            "系统机柜", "系统 U 位", "盘点结果", "实际数据中心", "实际机房", "实际机柜", "实际 U 位",
            "盘点时间", "盘点人", "备注", "处理状态", "处理方式", "处理人", "处理时间", "处理备注",
        ]
        sheet.append(headers)
        for item in items:
            snapshot = item.system_snapshot or {}
            system_u = ""
            if snapshot.get("start_u") is not None:
                system_u = f"U{snapshot.get('start_u')}–U{snapshot.get('end_u')}"
            actual_u = ""
            if item.actual_start_u is not None:
                actual_u = f"U{item.actual_start_u}–U{item.actual_end_u}"
            sheet.append([
                task.name, task.data_center.name, task.server_room.name if task.server_room_id else "整个数据中心",
                task.inspector.get_full_name() or task.inspector.username, item.asset.asset_no, item.asset.name,
                item.asset.serial_number or "", item.asset.asset_type,
                snapshot.get("business_ip", ""), snapshot.get("management_ip", ""), snapshot.get("oob_ip", ""),
                snapshot.get("rack_code", ""), system_u,
                dict(InventoryItem.STATUS).get(item.status, item.status),
                item.actual_rack.room.data_center.name if item.actual_rack_id else "",
                item.actual_rack.room.name if item.actual_rack_id else "",
                item.actual_rack.code if item.actual_rack_id else "", actual_u,
                timezone.localtime(item.checked_at).replace(tzinfo=None) if item.checked_at else "",
                item.checked_by.get_full_name() or item.checked_by.username if item.checked_by_id else "",
                item.notes,
                dict(InventoryItem.RESOLUTION_STATUS).get(item.resolution_status, item.resolution_status),
                dict(InventoryItem.RESOLUTION_ACTION).get(item.resolution_action, "") if item.resolution_action else "",
                item.resolved_by.get_full_name() or item.resolved_by.username if item.resolved_by_id else "",
                timezone.localtime(item.resolved_at).replace(tzinfo=None) if item.resolved_at else "",
                item.resolution_note,
            ])
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="2563EB")
            cell.alignment = Alignment(horizontal="center")
        for column in sheet.columns:
            values = [len(str(cell.value or "")) for cell in column]
            sheet.column_dimensions[get_column_letter(column[0].column)].width = min(max(max(values) + 2, 12), 32)
        response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response["Content-Disposition"] = f'attachment; filename="itam-inventory-{task.id}-{timezone.localdate().isoformat()}.xlsx"'
        book.save(response)
        return response


def _inventory_error_message(error, fallback):
    detail = getattr(error, "detail", error)

    def flatten(value):
        if isinstance(value, dict):
            return "；".join(flatten(child) for child in value.values())
        if isinstance(value, (list, tuple)):
            return "；".join(flatten(child) for child in value)
        return str(value or "")

    return flatten(detail) or fallback


def _inventory_resolution_error_message(error):
    return _inventory_error_message(error, "盘点异常处理失败")


class InventoryItemViewSet(viewsets.ModelViewSet):
    queryset = InventoryItem.objects.select_related(
        "task", "asset", "checked_by", "resolved_by", "actual_rack__room__data_center"
    )
    serializer_class = InventoryItemSerializer
    permission_classes = [BusinessRolePermission]
    permission_resource = "inventory"
    http_method_names = ["get", "post", "patch", "head", "options"]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["task", "status", "resolution_status"]

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST")

    @transaction.atomic
    def perform_update(self, serializer):
        item = serializer.instance
        if item.task.status == "completed":
            raise DRFValidationError({"detail": "已完成的盘点任务已锁定，不能修改"})
        if serializer.validated_data.get("status", item.status) == "normal":
            updated = confirm_inventory_item_normal(
                item_id=item.pk,
                actor=self.request.user,
                request=self.request,
                notes=serializer.validated_data.get("notes"),
                source="inventory_result",
            )
            serializer.instance = updated
            return
        before_result = (
            item.status,
            item.actual_rack_id,
            item.actual_start_u,
            item.actual_end_u,
            item.notes,
        )
        before = InventoryItemSerializer(item).data
        updated = serializer.save()
        if updated.status == "pending":
            updated.checked_by = None
            updated.checked_at = None
        else:
            updated.checked_by = self.request.user
            updated.checked_at = timezone.now()
        after_result = (
            updated.status,
            updated.actual_rack_id,
            updated.actual_start_u,
            updated.actual_end_u,
            updated.notes,
        )
        resolution_reset = updated.status in {"pending", "normal"} or before_result != after_result
        if resolution_reset:
            reset_inventory_resolution(updated)
        update_fields = ["checked_by", "checked_at", "updated_at"]
        if resolution_reset:
            update_fields.extend([
                "resolution_status",
                "resolution_action",
                "resolution_note",
                "resolved_by",
                "resolved_at",
            ])
        updated.save(update_fields=update_fields)
        write_audit_log(
            self.request,
            action="update",
            resource_type="inventory_item",
            resource_id=updated.pk,
            before=before,
            after=InventoryItemSerializer(updated).data,
        )

    @extend_schema(
        request=InventoryResolutionSerializer,
        responses=InventoryItemSerializer,
        description="处理盘点异常；盘点结果本身在任务完成后仍保持锁定。",
    )
    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        request_serializer = InventoryResolutionSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        action_name = request_serializer.validated_data["action"]
        note = request_serializer.validated_data.get("note", "")
        if action_name == "update_asset" and not user_has_capability(request.user, "assets.manage"):
            raise PermissionDenied("更新资产台账需要 assets.manage 权限")
        item = self.get_object()
        resolved_item = resolve_inventory_item(
            item_id=item.pk,
            action=action_name,
            note=note,
            actor=request.user,
            request=request,
        )
        return Response(InventoryItemSerializer(resolved_item).data)

    @extend_schema(
        request=InventoryBulkResolutionSerializer,
        responses=InventoryBulkResolutionResponseSerializer,
        description="批量处理当前盘点任务中的盘点异常；不支持批量更新资产台账。",
    )
    @action(detail=False, methods=["post"], url_path="bulk-resolve")
    def bulk_resolve(self, request):
        request_serializer = InventoryBulkResolutionSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        item_ids = request_serializer.validated_data["item_ids"]
        action_name = request_serializer.validated_data["action"]
        note = request_serializer.validated_data.get("note", "")

        items = list(
            InventoryItem.objects.filter(pk__in=item_ids).select_related("task", "asset")
        )
        items_by_id = {item.pk: item for item in items}
        missing_ids = [item_id for item_id in item_ids if item_id not in items_by_id]
        if missing_ids:
            raise DRFValidationError({"item_ids": f"盘点项不存在：{', '.join(map(str, missing_ids))}"})
        task_ids = {item.task_id for item in items}
        if len(task_ids) != 1:
            raise DRFValidationError({"item_ids": "所有盘点项必须属于同一个盘点任务"})

        results = []
        succeeded = 0
        for item_id in item_ids:
            item = items_by_id[item_id]
            try:
                resolved_item = resolve_inventory_item(
                    item_id=item_id,
                    action=action_name,
                    note=note,
                    actor=request.user,
                    request=request,
                )
            except (DRFValidationError, PermissionDenied) as exc:
                results.append({
                    "item_id": item_id,
                    "asset_no": item.asset.asset_no,
                    "success": False,
                    "reason": _inventory_resolution_error_message(exc),
                })
            except InventoryItem.DoesNotExist:
                results.append({
                    "item_id": item_id,
                    "asset_no": item.asset.asset_no,
                    "success": False,
                    "reason": "盘点项不存在",
                })
            else:
                succeeded += 1
                results.append({
                    "item_id": item_id,
                    "asset_no": resolved_item.asset.asset_no,
                    "success": True,
                    "reason": "",
                })

        response_data = {
            "requested": len(item_ids),
            "succeeded": succeeded,
            "failed": len(item_ids) - succeeded,
            "results": results,
        }
        return Response(InventoryBulkResolutionResponseSerializer(response_data).data)

    @extend_schema(
        request=InventoryBulkNormalSerializer,
        responses=InventoryBulkNormalResponseSerializer,
        description="批量确认当前进行中盘点任务中的未盘点项为正常；位置由任务创建时的系统快照确定。",
    )
    @action(detail=False, methods=["post"], url_path="bulk-confirm-normal")
    def bulk_confirm_normal(self, request):
        request_serializer = InventoryBulkNormalSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        item_ids = request_serializer.validated_data["item_ids"]

        items = list(
            InventoryItem.objects.filter(pk__in=item_ids).select_related("task", "asset")
        )
        items_by_id = {item.pk: item for item in items}
        missing_ids = [item_id for item_id in item_ids if item_id not in items_by_id]
        if missing_ids:
            raise DRFValidationError({"item_ids": f"盘点项不存在：{', '.join(map(str, missing_ids))}"})
        task_ids = {item.task_id for item in items}
        if len(task_ids) != 1:
            raise DRFValidationError({"item_ids": "所有盘点项必须属于同一个盘点任务"})

        results = []
        succeeded = 0
        for item_id in item_ids:
            item = items_by_id[item_id]
            try:
                confirmed_item = confirm_inventory_item_normal(
                    item_id=item_id,
                    actor=request.user,
                    request=request,
                    require_pending=True,
                    source="inventory_bulk_confirm_normal",
                )
            except (DRFValidationError, PermissionDenied) as exc:
                results.append({
                    "item_id": item_id,
                    "asset_no": item.asset.asset_no,
                    "success": False,
                    "reason": _inventory_error_message(exc, "批量标记正常失败"),
                })
            except InventoryItem.DoesNotExist:
                results.append({
                    "item_id": item_id,
                    "asset_no": item.asset.asset_no,
                    "success": False,
                    "reason": "盘点项不存在",
                })
            else:
                succeeded += 1
                results.append({
                    "item_id": item_id,
                    "asset_no": confirmed_item.asset.asset_no,
                    "success": True,
                    "reason": "",
                })

        response_data = {
            "requested": len(item_ids),
            "succeeded": succeeded,
            "failed": len(item_ids) - succeeded,
            "results": results,
        }
        return Response(InventoryBulkNormalResponseSerializer(response_data).data)


@extend_schema(responses=InventoryItemSerializer(many=True))
@api_view(["GET"])
@permission_classes([CanViewInventory])
def asset_inventory_records(request, pk):
    records = InventoryItem.objects.filter(asset_id=pk).select_related(
        "task", "task__data_center", "task__server_room", "checked_by", "resolved_by", "actual_rack__room__data_center"
    )
    if not Asset.objects.filter(pk=pk).exists():
        from rest_framework.exceptions import NotFound
        raise NotFound("资产不存在")
    return Response(InventoryItemSerializer(records, many=True).data)


@extend_schema(responses=InventoryInspectorSerializer(many=True))
@api_view(["GET"])
@permission_classes([CanManageInventory])
def inventory_inspectors(request):
    users = User.objects.filter(is_active=True).order_by("username")
    return Response([
        {"id": user.id, "username": user.username, "display_name": user.get_full_name() or user.username}
        for user in users
    ])


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor").order_by("-created_at", "-id")
    serializer_class = AuditLogSerializer
    permission_classes = [CanViewAuditLog]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["actor", "resource_type", "action", "resource_id"]
    search_fields = ["actor__username", "actor__first_name", "actor__last_name", "resource_type", "resource_id"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            try:
                start = date.fromisoformat(start)
            except ValueError:
                return queryset.none()
            queryset = queryset.filter(created_at__date__gte=start)
        if end:
            try:
                end = date.fromisoformat(end)
            except ValueError:
                return queryset.none()
            queryset = queryset.filter(created_at__date__lte=end)
        return queryset

    def list(self, request, *args, **kwargs):
        errors = _date_filter_errors(request, ("start", "end"))
        if errors:
            return Response(errors, status=400)
        return super().list(request, *args, **kwargs)


def _security_profile(user):
    profile, _ = UserSecurityProfile.objects.get_or_create(
        user=user,
        defaults={"must_change_password": False},
    )
    return profile


def _login_ip(request):
    # REMOTE_ADDR is the only trusted value unless a deployment explicitly
    # adds a trusted proxy middleware in front of Django.
    return (request.META.get("REMOTE_ADDR") or "unknown")[:255]


def _login_account_key(username):
    return (username or "").strip().casefold()


def _auth_audit_extra(request, username, **extra):
    payload = {
        "username": username,
        "ip": _login_ip(request),
        "user_agent": (request.META.get("HTTP_USER_AGENT") or "")[:500],
    }
    payload.update(extra)
    return payload


def _throttle_state(scope, key, now):
    state, _ = AuthThrottleState.objects.select_for_update().get_or_create(
        scope=scope,
        key=key,
    )
    if state.locked_until and state.locked_until <= now:
        state.failure_count = 0
        state.first_failed_at = None
        state.locked_until = None
        state.save(update_fields=["failure_count", "first_failed_at", "locked_until", "updated_at"])
    return state


def _login_lock_status(username, ip):
    now = timezone.now()
    with transaction.atomic():
        states = [_throttle_state("account", _login_account_key(username), now), _throttle_state("ip", ip, now)]
        locked_until = max(
            (state.locked_until for state in states if state.locked_until and state.locked_until > now),
            default=None,
        )
    if locked_until:
        return True, max(1, int((locked_until - now).total_seconds()))
    return False, 0


def _register_login_failure(request, username, actor=None):
    now = timezone.now()
    ip = _login_ip(request)
    window = timedelta(seconds=max(1, settings.AUTH_LOGIN_WINDOW_SECONDS))
    lock_duration = timedelta(seconds=max(1, settings.AUTH_LOGIN_LOCK_SECONDS))
    max_attempts = max(1, settings.AUTH_LOGIN_MAX_ATTEMPTS)
    with transaction.atomic():
        states = [_throttle_state("account", _login_account_key(username), now), _throttle_state("ip", ip, now)]
        locked_until = None
        for state in states:
            if not state.first_failed_at or now - state.first_failed_at > window:
                state.failure_count = 0
                state.first_failed_at = now
            state.failure_count += 1
            if state.failure_count >= max_attempts:
                state.locked_until = now + lock_duration
                locked_until = max(locked_until or now, state.locked_until)
            state.save(update_fields=["failure_count", "first_failed_at", "locked_until", "updated_at"])
        is_locked = bool(locked_until)
        retry_after = max(1, int((locked_until - now).total_seconds())) if locked_until else 0
        write_audit_log(
            request,
            action="login_locked" if is_locked else "login_failure",
            resource_type="auth_login",
            resource_id=username,
            actor=actor,
            extra=_auth_audit_extra(request, username, reason="invalid_credentials", retry_after=retry_after),
        )
    return is_locked, retry_after


def _clear_login_throttle(username, ip):
    with transaction.atomic():
        AuthThrottleState.objects.select_for_update().filter(
            scope="account", key=_login_account_key(username),
        ).update(failure_count=0, first_failed_at=None, locked_until=None)
        AuthThrottleState.objects.select_for_update().filter(
            scope="ip", key=ip,
        ).update(failure_count=0, first_failed_at=None, locked_until=None)


def _auth_response(user):
    role_code = user_role_code(user)
    return {
        "username": user.username,
        "display_name": user.get_full_name() or user.username,
        "is_staff": role_code == "system_admin",
        "role_code": role_code,
        "role_name": ROLE_DEFINITIONS[role_code]["name"],
        "permissions": user_capabilities(user),
        "password_change_required": _security_profile(user).must_change_password,
    }


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([AllowAny])
def auth_login(request):
    username = str(request.data.get("username", "")).strip()
    password = request.data.get("password", "")
    ip = _login_ip(request)
    locked, retry_after = _login_lock_status(username, ip)
    matched_user = User.objects.filter(username__iexact=username).first() if username else None
    if locked:
        with transaction.atomic():
            write_audit_log(
                request,
                action="login_locked",
                resource_type="auth_login",
                resource_id=username or "unknown",
                actor=matched_user,
                extra=_auth_audit_extra(request, username, reason="throttle_locked", retry_after=retry_after),
            )
        return Response(
            {"detail": "登录失败次数过多，请稍后再试", "code": "login_locked", "retry_after": retry_after},
            status=429,
            headers={"Retry-After": str(retry_after)},
        )
    user = authenticate(request, username=username, password=password)
    if not user or not user.is_active:
        is_locked, retry_after = _register_login_failure(request, username, matched_user)
        if is_locked:
            return Response(
                {"detail": "登录失败次数过多，请稍后再试", "code": "login_locked", "retry_after": retry_after},
                status=429,
                headers={"Retry-After": str(retry_after)},
            )
        return Response({"detail": "用户名或密码错误"}, status=400)
    _clear_login_throttle(username, ip)
    login(request, user)
    write_audit_log(
        request,
        action="login_success",
        resource_type="auth_login",
        resource_id=user.username,
        actor=user,
        extra=_auth_audit_extra(request, user.username),
    )
    return Response(_auth_response(user))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([AllowAny])
def auth_csrf(request):
    return Response({"csrfToken": get_token(request)})


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    return Response(_auth_response(request.user))


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def auth_logout(request):
    logout(request)
    return Response({"ok": True})


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def auth_change_password(request):
    old_password = request.data.get("old_password", "")
    new_password = request.data.get("new_password", "")
    if not request.user.check_password(old_password):
        return Response({"detail": "原密码错误"}, status=400)
    try:
        validate_password(new_password, user=request.user)
    except DjangoValidationError as exc:
        return Response({"new_password": list(exc.messages)}, status=400)
    request.user.set_password(new_password)
    request.user.save(update_fields=["password"])
    profile = _security_profile(request.user)
    profile.must_change_password = False
    profile.password_changed_at = timezone.now()
    profile.save(update_fields=["must_change_password", "password_changed_at", "updated_at"])
    write_audit_log(
        request,
        action="update",
        resource_type="user",
        resource_id=request.user.pk,
        extra={"password_change": True},
    )
    login(request, request.user)
    return Response({"ok": True, "password_change_required": False})


IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024
IMPORT_MAX_ROWS = 10000
IMPORT_FIELD_LABELS = {
    "asset_no": "资产编号",
    "name": "资产名称",
    "asset_type": "资产类型",
    "brand": "品牌",
    "device_type": "设备类型",
    "asset_data_center": "所属数据中心",
    "model": "型号",
    "serial_number": "序列号",
    "status": "状态",
    "configuration": "机柜位置",
    "data_center": "数据中心",
    "server_room": "机房",
    "rack_code": "机柜编号",
    "rack_start_u": "起始 U",
    "rack_end_u": "结束 U",
    "business_ip": "业务 IP",
    "management_ip": "管理 IP",
    "oob_ip": "带外 IP",
    "purchase_date": "采购日期",
    "supplier": "供应商",
    "purchase_order_no": "采购单号",
    "purchase_amount": "采购金额",
    "maintenance_provider": "维保厂商",
    "maintenance_contract_no": "维保合同号",
    "maintenance_start_date": "维保开始日",
    "maintenance_expiry_date": "维保到期日",
    "tags": "标签",
}


def _import_error_items(detail):
    """Normalize DRF/Django errors to the preview's field/message shape."""
    if isinstance(detail, dict):
        result = []
        for field, value in detail.items():
            values = value if isinstance(value, (list, tuple)) else [value]
            for item in values:
                result.append({
                    "field": str(field),
                    "label": IMPORT_FIELD_LABELS.get(str(field), str(field)),
                    "message": str(item),
                })
        return result
    if isinstance(detail, (list, tuple)):
        return [{"field": "row", "label": "整行", "message": str(item)} for item in detail]
    return [{"field": "row", "label": "整行", "message": str(detail or "数据格式不正确")}]


def _read_asset_import(upload):
    if not upload:
        raise ValueError("请上传 CSV 文件")
    if upload.size > IMPORT_MAX_FILE_SIZE:
        raise ValueError("CSV 文件不能超过 10 MB")
    try:
        content = upload.read().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("CSV 必须使用 UTF-8 编码") from exc
    reader = csv.DictReader(io.StringIO(content))
    headers = set(reader.fieldnames or [])
    required = {"asset_no", "name"}
    legacy_headers = headers.intersection({"asset_type", "category"})
    if legacy_headers:
        legacy = "、".join(sorted(legacy_headers))
        raise ValueError(f"CSV 不再支持 {legacy} 列，请使用 device_type")
    if not required.issubset(headers) or "device_type" not in headers:
        raise ValueError("CSV 必须包含 asset_no、name、device_type 列")
    rows = []
    for line, row in enumerate(reader, start=2):
        if line > IMPORT_MAX_ROWS + 1:
            raise ValueError("单次导入最多支持 10000 条资产")
        rows.append((line, row))
    return headers, rows


def _prepare_asset_import_payload(row, headers):
    """Resolve dictionary references and convert a CSV row to write payload.

    This function intentionally does not touch the database beyond read-only
    lookups.  Both preview and the real import call the same resolver so that
    a row cannot pass preview and fail later because of different parsing.
    """
    asset_no = (row.get("asset_no") or "").strip()
    asset_name = (row.get("name") or "").strip()
    if not asset_no:
        raise DjangoValidationError({"asset_no": "资产编号不能为空"})
    if not asset_name:
        raise DjangoValidationError({"name": "资产名称不能为空"})

    brand_name = (row.get("brand") or "").strip()
    brand = Brand.objects.filter(name__iexact=brand_name, is_active=True).first() if brand_name else None
    if brand_name and not brand:
        raise DjangoValidationError({"brand": f"未找到品牌“{brand_name}”"})
    model_name = (row.get("model") or row.get("asset_model") or "").strip()
    device_type_name = (row.get("device_type") or "").strip()
    device_type = DeviceType.objects.filter(name__iexact=device_type_name, is_active=True).first() if device_type_name else None
    if device_type_name and not device_type:
        raise DjangoValidationError({"device_type": f"未找到设备类型“{device_type_name}”"})
    asset_data_center_name = (row.get("asset_data_center") or "").strip()
    asset_data_center = DataCenter.objects.filter(name__iexact=asset_data_center_name, is_active=True).first() if asset_data_center_name else None
    if asset_data_center_name and not asset_data_center:
        raise DjangoValidationError({"asset_data_center": f"未找到所属数据中心“{asset_data_center_name}”"})
    if not device_type:
        raise DjangoValidationError({"device_type": "设备类型不能为空"})

    custom_values = {}
    for header in sorted(headers):
        if not header.startswith("custom__"):
            continue
        field_key = header[8:].strip()
        field = CustomField.objects.filter(key=field_key).first()
        if not field:
            raise DjangoValidationError({header: f"未知自定义字段编码“{field_key}”"})
        raw_custom = (row.get(header) or "").strip()
        if not raw_custom:
            continue
        if field.field_type == "multiselect":
            custom_values[field_key] = [item.strip() for item in raw_custom.split(";") if item.strip()]
        elif field.field_type == "boolean":
            if raw_custom.lower() in {"true", "1", "yes", "是"}:
                custom_values[field_key] = True
            elif raw_custom.lower() in {"false", "0", "no", "否"}:
                custom_values[field_key] = False
            else:
                raise DjangoValidationError({header: "布尔值只能填写 true/false、是/否"})
        else:
            custom_values[field_key] = raw_custom

    tag_values = []
    tag_text = (row.get("tags") or "").strip()
    if tag_text:
        for tag_name in [item.strip() for item in tag_text.split(";") if item.strip()]:
            tag = Tag.objects.filter(name__iexact=tag_name, is_active=True).first()
            if not tag:
                raise DjangoValidationError({"tags": f"未找到启用标签“{tag_name}”"})
            tag_values.append(tag.pk)
    return {
        "asset_no": asset_no,
        "name": asset_name,
        "brand": brand.pk if brand else None,
        "device_type": device_type.pk if device_type else None,
        "asset_data_center": asset_data_center.pk if asset_data_center else None,
        "model": model_name,
        "brand_model": row.get("brand_model", ""),
        "serial_number": row.get("serial_number") or None,
        "purpose": row.get("purpose", ""),
        "status": row.get("status") or "in_stock",
        "owner_name": row.get("owner_name", ""),
        "notes": row.get("notes", ""),
        "configuration": row,
        "tags": tag_values,
        "custom_values": custom_values,
    }


def _preview_asset_changes(asset, payload):
    fields = [
        ("name", "资产名称", asset.name, payload.get("name", "")),
        ("model", "型号", asset.model or "", payload.get("model", "")),
        ("serial_number", "序列号", asset.serial_number or "", payload.get("serial_number") or ""),
        ("purpose", "用途", asset.purpose or "", payload.get("purpose", "")),
        ("status", "状态", asset.status, payload.get("status", "in_stock")),
        ("owner_name", "使用人", asset.owner_name or "", payload.get("owner_name", "")),
        ("notes", "备注", asset.notes or "", payload.get("notes", "")),
    ]
    relation_fields = [
        ("brand", "品牌", getattr(asset.brand, "name", ""), payload.get("brand")),
        ("device_type", "设备类型", getattr(asset.device_type, "name", ""), payload.get("device_type")),
        ("asset_data_center", "所属数据中心", getattr(asset.asset_data_center, "name", ""), payload.get("asset_data_center")),
    ]
    for field, label, old, new_id in relation_fields:
        model = {"brand": Brand, "device_type": DeviceType, "asset_data_center": DataCenter}[field]
        new = model.objects.filter(pk=new_id).values_list("name", flat=True).first() if new_id else ""
        fields.append((field, label, old or "", new or ""))
    changes = []
    for field, label, old, new in fields:
        if str(old or "") != str(new or ""):
            changes.append({"field": field, "label": label, "old_value": old or "", "new_value": new or ""})
    return changes


def _preview_asset_row(line, row, headers, seen_asset_nos):
    asset_no = (row.get("asset_no") or "").strip()
    name = (row.get("name") or "").strip()
    base = {"line": line, "asset_no": asset_no, "name": name, "action": "create", "changes": [], "errors": []}
    if asset_no in seen_asset_nos:
        base["action"] = "conflict"
        base["errors"] = [{"field": "asset_no", "label": "资产编号", "message": "文件内重复的资产编号，确认导入时将跳过该行"}]
        return base
    if asset_no:
        seen_asset_nos.add(asset_no)
    existing = Asset.objects.select_related("brand", "device_type", "asset_data_center").filter(asset_no=asset_no).first() if asset_no else None
    try:
        payload = _prepare_asset_import_payload(row, headers)
    except Exception as exc:
        base["action"] = "error"
        base["errors"] = _import_error_items(getattr(exc, "message_dict", None) or getattr(exc, "detail", None) or str(exc))
        return base
    if existing:
        base["action"] = "conflict"
        base["changes"] = _preview_asset_changes(existing, payload)
        base["errors"] = [{"field": "asset_no", "label": "资产编号", "message": "资产编号已存在，确认导入时不会更新该资产"}]
        return base
    try:
        with transaction.atomic():
            serializer = AssetWriteSerializer(data=payload)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            transaction.set_rollback(True)
    except Exception as exc:
        base["action"] = "error"
        detail = getattr(exc, "detail", None) or getattr(exc, "message_dict", None) or str(exc)
        base["errors"] = _import_error_items(detail)
    return base


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([CanImportAssets])
@parser_classes([MultiPartParser, FormParser])
def asset_import_preview(request):
    try:
        headers, rows = _read_asset_import(request.FILES.get("file"))
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    seen_asset_nos = set()
    preview_rows = [_preview_asset_row(line, row, headers, seen_asset_nos) for line, row in rows]
    ready = sum(item["action"] == "create" and not item["errors"] for item in preview_rows)
    conflicts = sum(item["action"] == "conflict" for item in preview_rows)
    errors = sum(item["action"] == "error" for item in preview_rows)
    return Response({
        "filename": request.FILES["file"].name,
        "total": len(preview_rows),
        "summary": {"ready": ready, "conflicts": conflicts, "errors": errors},
        "rows": preview_rows,
    })


@extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([CanImportAssets])
@parser_classes([MultiPartParser, FormParser])
@transaction.atomic
def asset_import(request):
    try:
        headers, rows = _read_asset_import(request.FILES.get("file"))
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    created, errors, seen_asset_nos = 0, [], set()
    for line, row in rows:
        asset_no = (row.get("asset_no") or "").strip()
        asset_name = (row.get("name") or "").strip()
        if not asset_no or not asset_name:
            missing = {}
            if not asset_no:
                missing["asset_no"] = "资产编号不能为空"
            if not asset_name:
                missing["name"] = "资产名称不能为空"
            errors.append({"line": line, "detail": missing})
            continue
        if asset_no in seen_asset_nos:
            errors.append({"line": line, "detail": {"asset_no": "文件内重复的资产编号"}})
            continue
        seen_asset_nos.add(asset_no)
        if Asset.objects.filter(asset_no=asset_no).exists():
            errors.append({"line": line, "detail": {"asset_no": "资产编号已存在"}})
            continue
        try:
            payload = _prepare_asset_import_payload(row, headers)
            serializer = AssetWriteSerializer(data=payload)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            created += 1
        except Exception as exc:
            detail = getattr(exc, "detail", None) or getattr(exc, "message_dict", None) or str(exc)
            errors.append({"line": line, "detail": detail if detail else "数据格式不正确"})
    write_audit_log(
        request,
        action="import",
        resource_type="asset",
        resource_id="bulk",
        after={"filename": request.FILES["file"].name, "created": created, "failed": len(errors)},
    )
    return Response({"created": created, "errors": errors})


@extend_schema(responses=OpenApiTypes.BINARY)
@api_view(["GET"])
@permission_classes([CanExportAssets])
def asset_export(request):
    ids_param = request.query_params.get("ids", "").strip()
    queryset = Asset.objects.select_related("brand", "device_type", "asset_data_center", "rack_allocation__rack__room__data_center").prefetch_related(
        "network_addresses", "procurement_records", "maintenance_contracts", "asset_tags__tag", "custom_values__field__options"
    ).order_by("asset_no")
    if ids_param:
        try:
            asset_ids = [int(value) for value in ids_param.split(",") if value.strip()]
        except ValueError:
            return Response({"detail": "资产 ID 格式不正确"}, status=400)
        queryset = queryset.filter(id__in=asset_ids)

    assets = list(queryset)
    custom_fields = list(
        CustomField.objects.filter(
            Q(device_type__assets__in=assets) | Q(asset_values__asset__in=assets)
        ).distinct().prefetch_related("options").order_by("device_type__name", "sort_order", "id")
    ) if assets else []
    headers = [
        "资产编号", "资产名称", "设备类型", "品牌", "型号", "品牌/型号", "序列号", "用途", "状态", "使用人",
        "数据中心", "机房", "机柜编号", "起止 U 位", "业务 IP", "管理 IP", "带外 IP", "采购日期",
        "供应商", "采购单号", "维保厂商", "维保合同号", "维保开始日", "维保到期日", "备注", "标签",
    ]
    headers.extend([f"custom__{field.key}" for field in custom_fields])
    status_labels = dict(Asset.STATUS)
    book = Workbook()
    sheet = book.active
    sheet.title = "资产台账"
    sheet.append(headers)
    for asset in assets:
        networks = {item.role: item.address for item in asset.network_addresses.all()}
        rack = getattr(asset, "rack_allocation", None)
        procurement = next(iter(asset.procurement_records.all()), None)
        maintenance = next(iter(asset.maintenance_contracts.all()), None)
        custom_by_key = {}
        for item in asset.custom_values.all():
            field = item.field
            if field.field_type in {"text", "textarea", "select"}:
                value = item.text_value
            elif field.field_type == "number":
                value = str(item.number_value) if item.number_value is not None else ""
            elif field.field_type == "date":
                value = item.date_value.isoformat() if item.date_value else ""
            elif field.field_type == "boolean":
                value = "true" if item.boolean_value else "false"
            else:
                value = ";".join(item.json_value or [])
            custom_by_key[field.key] = value
        tag_text = ";".join(item.tag.name for item in asset.asset_tags.all())
        row_values = [
            asset.asset_no, asset.name, asset.device_type.name if asset.device_type_id else "",
            asset.brand.name if asset.brand_id else "", asset.model or "", asset.brand_model, asset.serial_number or "", asset.purpose, status_labels.get(asset.status, asset.status), asset.owner_name,
            rack.rack.room.data_center.name if rack else (asset.asset_data_center.name if asset.asset_data_center_id else ""), rack.rack.room.name if rack else "", rack.rack.code if rack else "",
            f"U{rack.start_u}-U{rack.end_u}" if rack else "", networks.get("business", ""), networks.get("management", ""), networks.get("oob", ""),
            procurement.purchase_date if procurement else "", procurement.supplier if procurement else "", procurement.order_no if procurement else "",
            maintenance.provider if maintenance else "", maintenance.contract_no if maintenance else "", maintenance.start_date if maintenance else "", maintenance.expiry_date if maintenance else "", asset.notes,
            tag_text,
        ]
        row_values.extend(custom_by_key.get(field.key, "") for field in custom_fields)
        sheet.append(row_values)
    for column in sheet.columns:
        width = min(max(len(str(cell.value or "")) for cell in column) + 2, 32)
        sheet.column_dimensions[get_column_letter(column[0].column)].width = width
    response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    response["Content-Disposition"] = 'attachment; filename="assets.xlsx"'
    book.save(response)
    return response


def _repair_queryset(request):
    queryset = FaultEvent.objects.select_related("asset", "repair").order_by("-occurred_at")
    keyword = request.query_params.get("search", "").strip()
    status = request.query_params.get("is_closed", "").strip().lower()
    start = request.query_params.get("start")
    end = request.query_params.get("end")
    if keyword:
        queryset = queryset.filter(Q(asset__asset_no__icontains=keyword) | Q(asset__name__icontains=keyword) | Q(reason__icontains=keyword) | Q(description__icontains=keyword))
    if status in {"true", "false"}:
        queryset = queryset.filter(is_closed=status == "true")
    if start:
        queryset = queryset.filter(occurred_at__date__gte=start)
    if end:
        queryset = queryset.filter(occurred_at__date__lte=end)
    return queryset


@extend_schema(responses=OpenApiTypes.BINARY)
@api_view(["GET"])
@permission_classes([CanExportFaults])
def repair_record_export(request):
    errors = _date_filter_errors(request, ("start", "end"))
    if errors:
        return Response(errors, status=400)
    book = Workbook()
    sheet = book.active
    sheet.title = "维修记录"
    sheet.append(["资产编号", "资产名称", "故障发生时间", "故障原因", "故障描述", "维修完成时间", "状态"])
    for fault in _repair_queryset(request):
        repair = getattr(fault, "repair", None)
        sheet.append([
            fault.asset.asset_no, fault.asset.name, timezone.localtime(fault.occurred_at).replace(tzinfo=None),
            fault.reason, fault.description,
            timezone.localtime(repair.finished_at).replace(tzinfo=None) if repair and repair.finished_at else "",
            "已关闭" if fault.is_closed else "未关闭",
        ])
    for column in sheet.columns:
        sheet.column_dimensions[get_column_letter(column[0].column)].width = min(max(len(str(cell.value or "")) for cell in column) + 2, 40)
    response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    response["Content-Disposition"] = f'attachment; filename="itam-repairs-{timezone.localdate().isoformat()}.xlsx"'
    book.save(response)
    return response


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([CanViewLicenses])
def license_summary(request):
    counts = license_status_counts()
    return Response({
        **counts,
        # Keep the previous summary keys for existing clients.
        "within_90_days": counts["expiring"],
        "over_license_risk": counts["over_limit"],
    })


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([CanViewDashboard])
def dashboard_overview(request):
    try:
        scope = resolve_dashboard_scope(request)
    except DashboardScopeError as exc:
        return Response({"detail": str(exc)}, status=400)
    return Response(build_dashboard_payload(
        scope,
        include_faults=user_has_capability(request.user, "faults.view"),
        include_licenses=user_has_capability(request.user, "licenses.view"),
    ))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([CanViewDashboard])
def facilities_summary(request):
    """Compact aggregates for the room/rack management tabs."""
    data_center_id = request.query_params.get("data_center", "").strip()
    room_id = request.query_params.get("server_room", "").strip()
    try:
        data_center_pk = int(data_center_id) if data_center_id else None
        room_pk = int(room_id) if room_id else None
    except (TypeError, ValueError):
        return Response({"detail": "数据中心或机房筛选无效"}, status=400)

    if data_center_pk is not None and not DataCenter.objects.filter(
        pk=data_center_pk, is_active=True
    ).exists():
        return Response({"detail": "数据中心筛选无效"}, status=400)
    selected_room = None
    if room_pk is not None:
        selected_room = ServerRoom.objects.select_related("data_center").filter(
            pk=room_pk, is_active=True, data_center__is_active=True
        ).first()
        if selected_room is None:
            return Response({"detail": "机房筛选无效"}, status=400)
        if data_center_pk is not None and selected_room.data_center_id != data_center_pk:
            return Response({"detail": "所选机房不属于当前数据中心"}, status=400)

    # Keep all rooms/racks for status totals, but use only active locations for
    # capacity and device aggregates. This prevents disabled infrastructure
    # from inflating U totals while preserving maintenance-page counts.
    rooms = ServerRoom.objects.filter(data_center__is_active=True).select_related("data_center")
    if data_center_pk is not None:
        rooms = rooms.filter(data_center_id=data_center_pk)
    if room_pk is not None:
        rooms = rooms.filter(pk=room_pk)
    all_racks = Rack.objects.filter(room__in=rooms)
    racks = all_racks.filter(
        is_active=True,
        room__is_active=True,
        room__data_center__is_active=True,
    ).select_related("room__data_center").prefetch_related("allocations")
    room_ids = list(rooms.values_list("id", flat=True))
    rack_rows, totals = build_rack_capacity_rows(
        list(racks.order_by("room__data_center__name", "room__name", "code")),
        include_status=True,
    )
    room_rows = []
    for room in rooms.order_by("data_center__name", "name"):
        room_racks = [
            row for row in rack_rows if row["server_room_id"] == room.id
        ]
        room_rows.append({
            "id": room.id,
            "name": room.name,
            "data_center": room.data_center.name,
            "data_center_id": room.data_center_id,
            "racks_count": len(room_racks),
            "assets_count": sum(row["device_count"] for row in room_racks),
            "total_u": sum(row["total_u"] for row in room_racks),
            "used_u": sum(row["used_u"] for row in room_racks),
            "is_active": room.is_active,
        })

    data_centers = DataCenter.objects.filter(is_active=True).order_by("name")
    if data_center_pk is not None:
        data_centers = data_centers.filter(pk=data_center_pk)
    elif room_pk is not None:
        # A room filter implicitly narrows the data-center summary as well.
        data_centers = data_centers.filter(pk=selected_room.data_center_id)
    data_center_rows = []
    for data_center in data_centers:
        center_rooms = [row for row in room_rows if row["data_center_id"] == data_center.id]
        total_u = sum(row["total_u"] for row in center_rooms)
        used_u = sum(row["used_u"] for row in center_rooms)
        data_center_rows.append({
            "id": data_center.id,
            "name": data_center.name,
            "rooms_count": len(center_rooms),
            "assets_count": sum(row["assets_count"] for row in center_rooms),
            "racks_count": sum(row["racks_count"] for row in center_rooms),
            "total_u": total_u,
            "used_u": used_u,
            "free_u": max(total_u - used_u, 0),
            "utilization": round(used_u / total_u * 100, 1) if total_u else 0,
            "is_active": data_center.is_active,
        })
    return Response({
        "rooms_total": len(room_ids),
        "rooms_in_use": sum(1 for room in room_rows if room["is_active"]),
        "rooms_disabled": ServerRoom.objects.filter(pk__in=room_ids, is_active=False).count(),
        "racks_total": all_racks.count(),
        "racks_in_use": all_racks.filter(
            is_active=True,
            status="in_use",
            room__is_active=True,
            room__data_center__is_active=True,
        ).count(),
        "total_u": totals["total_u"],
        "used_u": totals["used_u"],
        "free_u": max(totals["total_u"] - totals["used_u"], 0),
        "data_centers": data_center_rows,
        "rooms": room_rows,
        "racks": rack_rows,
    })


def _rack_sheet_name(name, used):
    cleaned = re.sub(r"[\\/*?:\[\]]", "_", name or "未命名数据中心")[:31] or "未命名数据中心"
    candidate, suffix = cleaned, 1
    while candidate in used:
        suffix_text = f"_{suffix}"
        candidate = f"{cleaned[:31 - len(suffix_text)]}{suffix_text}"
        suffix += 1
    used.add(candidate)
    return candidate


def _rack_prefix(code):
    match = re.search(r"\d", code or "")
    return (code[:match.start()] if match else code or "未分组").rstrip("-_ ") or "未分组"


def _rack_sort_key(rack):
    match = re.search(r"(\d+)(?!.*\d)", rack.code or "")
    return (int(match.group(1)) if match else 0, rack.code or "")


@extend_schema(responses=OpenApiTypes.BINARY)
@api_view(["GET"])
@permission_classes([CanExportRacks])
def rack_layout_export(request):
    racks = list(Rack.objects.select_related("room__data_center").prefetch_related("allocations__asset__device_type").order_by("room__data_center__name", "code"))
    book = Workbook()
    book.remove(book.active)
    used_sheet_names = set()
    thin = Side(style="thin", color="B8C5D6")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    status_fills = {
        "in_use": PatternFill("solid", fgColor="C6EFCE"),
        "repair": PatternFill("solid", fgColor="FCE4D6"),
        "idle": PatternFill("solid", fgColor="E4DFEC"),
        "in_stock": PatternFill("solid", fgColor="D9EAF7"),
        "retired": PatternFill("solid", fgColor="E7E6E6"),
    }
    grouped = {}
    for rack in racks:
        grouped.setdefault(rack.room.data_center.name, []).append(rack)

    for data_center_name, data_center_racks in grouped.items():
        sheet = book.create_sheet(_rack_sheet_name(data_center_name, used_sheet_names))
        sheet.sheet_view.showGridLines = False
        sheet["A1"] = f"数据中心：{data_center_name}"
        sheet["A1"].font = Font(size=14, bold=True, color="17365D")
        sheet.freeze_panes = "A5"
        row_cursor = 3
        by_prefix = {}
        for rack in data_center_racks:
            by_prefix.setdefault(_rack_prefix(rack.code), []).append(rack)
        for prefix, prefix_racks in sorted(by_prefix.items(), key=lambda item: item[0]):
            prefix_racks.sort(key=_rack_sort_key)
            rack_width, gap = 5, 2
            group_start = 1
            group_end = group_start + len(prefix_racks) * (rack_width + gap) - gap - 1
            sheet.merge_cells(start_row=row_cursor, start_column=group_start, end_row=row_cursor, end_column=group_end)
            group_cell = sheet.cell(row_cursor, group_start, f"{prefix} 组")
            group_cell.font = Font(bold=True, color="FFFFFF")
            group_cell.fill = PatternFill("solid", fgColor="1F4E78")
            group_cell.alignment = Alignment(horizontal="center")
            row_cursor += 1
            rack_top = row_cursor
            max_u = max((rack.total_u for rack in prefix_racks), default=45)
            for index, rack in enumerate(prefix_racks):
                start_col = group_start + index * (rack_width + gap)
                end_col = start_col + rack_width - 1
                sheet.merge_cells(start_row=rack_top, start_column=start_col, end_row=rack_top, end_column=end_col)
                header = sheet.cell(rack_top, start_col, f"机柜 {rack.code}")
                header.font = Font(bold=True, color="FFFFFF")
                header.fill = PatternFill("solid", fgColor="4472C4")
                header.alignment = Alignment(horizontal="center")
                sheet.merge_cells(start_row=rack_top + 1, start_column=start_col, end_row=rack_top + 1, end_column=end_col)
                effective_used_u = rack_effective_used_u(list(rack.allocations.all()), rack.total_u)
                meta = sheet.cell(rack_top + 1, start_col, f"{rack.room.name} | {rack.total_u} U | 已用 {effective_used_u} U | 可用 {rack.total_u - effective_used_u} U")
                meta.font = Font(size=9, color="44546A")
                meta.alignment = Alignment(horizontal="center")
                for col in (start_col, end_col):
                    sheet.column_dimensions[get_column_letter(col)].width = 7
                for col in range(start_col + 1, end_col):
                    sheet.column_dimensions[get_column_letter(col)].width = 13
                for col in range(start_col, end_col + 1):
                    sheet.cell(rack_top + 2, col).border = border
                sheet.cell(rack_top + 2, start_col, "U").alignment = Alignment(horizontal="center")
                sheet.cell(rack_top + 2, start_col + 1, "设备信息").alignment = Alignment(horizontal="center")
                sheet.merge_cells(start_row=rack_top + 2, start_column=start_col + 1, end_row=rack_top + 2, end_column=end_col - 1)
                sheet.cell(rack_top + 2, end_col, "U").alignment = Alignment(horizontal="center")
                for offset in range(rack.total_u):
                    row = rack_top + 3 + offset
                    u = rack.total_u - offset
                    sheet.cell(row, start_col, u)
                    sheet.cell(row, end_col, u)
                    for col in range(start_col, end_col + 1):
                        cell = sheet.cell(row, col)
                        cell.border = border
                        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                ordered_allocations = sorted(rack.allocations.all(), key=lambda allocation: (allocation.start_u, allocation.end_u))
                for previous, current in zip(ordered_allocations, ordered_allocations[1:]):
                    if current.start_u - previous.end_u - 1 == 1:
                        gap_row = rack_top + 3 + (rack.total_u - (previous.end_u + 1))
                        for col in range(start_col + 1, end_col):
                            gap_cell = sheet.cell(gap_row, col)
                            gap_cell.fill = PatternFill("solid", fgColor="AEB8C8")
                            gap_cell.font = Font(size=9, color="69778C", italic=True)
                for allocation in rack.allocations.all():
                    top_row = rack_top + 3 + (rack.total_u - allocation.end_u)
                    bottom_row = rack_top + 3 + (rack.total_u - allocation.start_u)
                    asset = allocation.asset
                    text = "\n".join(filter(None, [asset.asset_no, asset.name, asset.device_type.name if asset.device_type_id else "", asset.brand_model, f"SN: {asset.serial_number}" if asset.serial_number else ""]))
                    for row in range(top_row, bottom_row + 1):
                        for col in range(start_col + 1, end_col):
                            sheet.cell(row, col).fill = status_fills.get(asset.status, PatternFill("solid", fgColor="D9EAF7"))
                    if top_row != bottom_row:
                        sheet.merge_cells(start_row=top_row, start_column=start_col + 1, end_row=bottom_row, end_column=end_col - 1)
                    cell = sheet.cell(top_row, start_col + 1, text)
                    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                    cell.font = Font(size=9, bold=True)
            row_cursor = rack_top + 3 + max_u + 2
    if not racks:
        book.create_sheet("无机柜数据")["A1"] = "暂无机柜数据"
    response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    response["Content-Disposition"] = f'attachment; filename="itam-rack-layout-{timezone.localdate().isoformat()}.xlsx"'
    book.save(response)
    return response
