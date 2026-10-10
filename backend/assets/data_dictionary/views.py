"""HTTP adapters for the settings data dictionaries.

The adapters keep DRF routing and response serialization at the HTTP seam,
while the implementation below owns the shared query, audit, and reference
protection rules for the two supported dictionary kinds.
"""

from __future__ import annotations

from ..reference_writes import SharedReferenceWriteMixin
from ..data_scope import ScopedViewSetMixin

from typing import Literal

from django.db.models import Count
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from ..resource_revision import ResourceRevisionViewSetMixin
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.filters import OrderingFilter, SearchFilter

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


class DataDictionaryViewSet(SharedReferenceWriteMixin, ScopedViewSetMixin, ResourceRevisionViewSetMixin, viewsets.ModelViewSet):
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


    def perform_create(self, serializer):
        super().perform_create(serializer)
        instance = serializer.instance
        instance.spare_parts_count = 0
        if self.dictionary_kind == "manufacturers":
            instance.assets_count = 0
            instance.licenses_count = 0

    def perform_update(self, serializer):
        super().perform_update(serializer)
        instance = serializer.instance
        instance.spare_parts_count = instance.spare_parts.count()
        if self.dictionary_kind == "manufacturers":
            instance.assets_count = instance.standalone_assets.count() + Asset.objects.filter(asset_model__manufacturer=instance).count()
            instance.licenses_count = instance.software_licenses.count()


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
