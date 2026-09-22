"""HTTP adapters for the settings data dictionaries.

The adapters keep DRF routing and response serialization at the HTTP seam,
while the implementation below owns the shared query, audit, and reference
protection rules for the two supported dictionary kinds.
"""

from __future__ import annotations

from typing import Literal

from django.db import transaction
from django.db.models import Count
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.filters import OrderingFilter, SearchFilter

from ..audit import model_snapshot, write_audit_log
from ..models import Asset, Manufacturer, SparePartCategory
from ..permissions import (
    BusinessRolePermission,
    CanViewManufacturerRuntime,
    CanViewSparePartCategoryRuntime,
)
from ..serializers import (
    DictionaryOptionSerializer,
    ManufacturerSerializer,
    SparePartCategorySerializer,
)
from ..organization_access import can


DictionaryKind = Literal["manufacturers", "spare-categories"]


def _compact_requested(request) -> bool:
    return request.query_params.get("compact", "").lower() in {"1", "true", "yes"}


def _can_view_inactive(kind: DictionaryKind, request) -> bool:
    if kind == "manufacturers":
        return any(
            can(request.user, capability)
            for capability in (
                "settings.manage",
                "assets.view",
                "assets.manage",
                "licenses.view",
                "licenses.manage",
                "spares.view",
                "spares.manage",
            )
        )
    return can(request.user, "settings.manage")


def _queryset(kind: DictionaryKind, *, compact: bool):
    if kind == "manufacturers":
        if compact:
            return Manufacturer.objects.only("id", "name", "is_active")
        return Manufacturer.objects.annotate(
            assets_count=Count("standalone_assets", distinct=True)
            + Count("asset_models__assets", distinct=True),
            licenses_count=Count("software_licenses", distinct=True),
            spare_parts_count=Count("spare_parts", distinct=True),
        )
    if compact:
        return SparePartCategory.objects.only("id", "name", "is_active")
    return SparePartCategory.objects.annotate(
        spare_parts_count=Count("spare_parts", distinct=True),
    ).order_by("name", "id")


def _filter_active(queryset, request, *, can_view_inactive: bool):
    active = request.query_params.get("is_active", "true").strip().lower()
    if not can_view_inactive:
        active = "true"
    if active in {"true", "false"}:
        return queryset.filter(is_active=active == "true")
    return queryset


def _is_in_use(kind: DictionaryKind, instance) -> bool:
    if kind == "manufacturers":
        return (
            instance.standalone_assets.exists()
            or instance.asset_models.filter(assets__isnull=False).exists()
            or instance.software_licenses.exists()
            or instance.spare_parts.exists()
        )
    return instance.spare_parts.exists()


def _in_use_message(kind: DictionaryKind) -> str:
    if kind == "manufacturers":
        return "厂商正在被资产、软件许可或备件使用，不能删除，请先停用"
    return "备件类型正在被备件使用，不能删除，请先停用"


class DataDictionaryViewSet(viewsets.ModelViewSet):
    """Thin HTTP adapter over the manufacturer/category dictionary seam."""

    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    permission_classes = [BusinessRolePermission]
    permission_resource = "settings"
    dictionary_kind: DictionaryKind
    compact_serializer_class = DictionaryOptionSerializer

    def get_serializer_class(self):
        if self.action == "list" and _compact_requested(self.request):
            return self.compact_serializer_class
        return self.serializer_class

    def can_view_inactive(self):
        return _can_view_inactive(self.dictionary_kind, self.request)

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            if self.dictionary_kind == "manufacturers":
                return [CanViewManufacturerRuntime()]
            return [CanViewSparePartCategoryRuntime()]
        return super().get_permissions()

    def get_queryset(self):
        compact = self.action == "list" and _compact_requested(self.request)
        queryset = _queryset(self.dictionary_kind, compact=compact)
        if self.action in {"retrieve", "update", "partial_update", "destroy"}:
            return queryset
        return _filter_active(
            queryset,
            self.request,
            can_view_inactive=self.can_view_inactive(),
        )

    def _audit_create(self, instance):
        write_audit_log(
            self.request,
            action="create",
            resource_type=self.audit_resource,
            resource_id=instance.pk,
            after=model_snapshot(instance),
        )

    def _audit_update(self, instance, before):
        write_audit_log(
            self.request,
            action="update",
            resource_type=self.audit_resource,
            resource_id=instance.pk,
            before=before,
            after=model_snapshot(instance),
        )

    def _audit_delete(self, instance, before):
        write_audit_log(
            self.request,
            action="delete",
            resource_type=self.audit_resource,
            resource_id=instance.pk,
            before=before,
        )

    @transaction.atomic
    def perform_create(self, serializer):
        instance = serializer.save()
        if self.dictionary_kind == "manufacturers":
            instance.assets_count = 0
            instance.licenses_count = 0
            instance.spare_parts_count = 0
        else:
            instance.spare_parts_count = 0
        self._audit_create(instance)

    @transaction.atomic
    def perform_update(self, serializer):
        before = model_snapshot(serializer.instance)
        instance = serializer.save()
        if self.dictionary_kind == "manufacturers":
            instance.assets_count = (
                instance.standalone_assets.count()
                + Asset.objects.filter(asset_model__manufacturer=instance).count()
            )
            instance.licenses_count = instance.software_licenses.count()
            instance.spare_parts_count = instance.spare_parts.count()
        else:
            instance.spare_parts_count = instance.spare_parts.count()
        self._audit_update(instance, before)

    @transaction.atomic
    def perform_destroy(self, instance):
        if _is_in_use(self.dictionary_kind, instance):
            raise DRFValidationError(_in_use_message(self.dictionary_kind))
        before = model_snapshot(instance)
        resource_id = instance.pk
        instance.delete()
        write_audit_log(
            self.request,
            action="delete",
            resource_type=self.audit_resource,
            resource_id=resource_id,
            before=before,
        )


class ManufacturerViewSet(DataDictionaryViewSet):
    dictionary_kind = "manufacturers"
    queryset = Manufacturer.objects.all()
    serializer_class = ManufacturerSerializer
    search_fields = ["name"]
    ordering_fields = ["name", "created_at", "updated_at"]
    ordering = ["name", "id"]
    audit_resource = "manufacturer"


class SparePartCategoryViewSet(DataDictionaryViewSet):
    dictionary_kind = "spare-categories"
    queryset = SparePartCategory.objects.all()
    serializer_class = SparePartCategorySerializer
    filterset_fields = ["is_active"]
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code", "created_at", "updated_at"]
    ordering = ["name", "id"]
    audit_resource = "spare_part_category"
