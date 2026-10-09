"""Data-center authorization at HTTP admission, query and domain write seams.

Function capabilities remain in organization_access. Missing grants fail closed.
A write grant includes read access. Location-less assets need an explicit grant.
CLI callers have no HTTP actor and retain the separate operator boundary.
"""
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps

from django.db.models import Exists, OuterRef, Q
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework import viewsets

_actor = ContextVar('data_scope_actor', default=None)
_scope_snapshot = ContextVar('data_scope_snapshot', default=None)
SHARED_REFERENCES = frozenset({
    'Person', 'Department', 'Manufacturer', 'DeviceType', 'AssetModel', 'CustomField',
    'CustomFieldSet', 'CustomFieldSetItem', 'CustomFieldOption', 'Tag', 'SparePartCategory',
    'SparePart', 'SoftwareLicense', 'User',
})


@dataclass(frozen=True)
class Scope:
    global_read: bool = False
    global_write: bool = False
    read_centers: tuple = ()
    write_centers: tuple = ()
    unlocated_read: bool = False
    unlocated_write: bool = False
    global_stock_metrics: bool = False

    def contains(self, center_id, *, write=False):
        if self.global_write if write else self.global_read:
            return True
        if center_id is None:
            return self.unlocated_write if write else self.unlocated_read
        return center_id in (self.write_centers if write else self.read_centers)

    def location_q(self, field, *, write=False, nullable=False):
        if self.global_write if write else self.global_read:
            return Q()
        ids = self.write_centers if write else self.read_centers
        condition = Q(**{f'{field}__in': ids})
        if nullable and (self.unlocated_write if write else self.unlocated_read):
            condition |= Q(**{f'{field}__isnull': True})
        return condition

    def as_dict(self):
        return {
            'global_read': self.global_read, 'global_write': self.global_write,
            'read_data_centers': list(self.read_centers), 'write_data_centers': list(self.write_centers),
            'unlocated_read': self.unlocated_read, 'unlocated_write': self.unlocated_write,
            'global_stock_metrics': self.global_stock_metrics,
        }


def scope_for(user=None):
    from .models import UserDataScope
    from .organization_access import can
    user = user or _actor.get()
    if user is None or not user.is_authenticated or not user.is_active:
        return Scope()
    cached = _scope_snapshot.get()
    if cached is not None and cached[0] == user.pk:
        return cached[1]
    if can(user, 'organization.manage'):
        return Scope(global_read=True, global_write=True, unlocated_read=True, unlocated_write=True, global_stock_metrics=True)
    grant = UserDataScope.objects.filter(user_id=user.pk).first()
    if grant is None:
        return Scope()
    writes = tuple(grant.write_data_centers.values_list('pk', flat=True).order_by('pk'))
    reads = tuple(sorted(set(writes) | set(grant.read_data_centers.values_list('pk', flat=True))))
    return Scope(grant.global_read or grant.global_write, grant.global_write, reads, writes,
                 grant.unlocated_read or grant.unlocated_write, grant.unlocated_write,
                 grant.global_stock_metrics or grant.global_read or grant.global_write)


def require_center(center_id, *, write=True, user=None):
    if user is None and _actor.get() is None:
        return  # Deliberately separate server-operator boundary.
    if not scope_for(user).contains(center_id, write=write):
        raise PermissionDenied({'code': 'data_scope_denied', 'detail': '当前账号没有该数据中心或待归属数据的权限'})


def require_object(instance, *, write=True, user=None):
    if user is None and _actor.get() is None:
        return
    if not scoped(instance.__class__._base_manager.filter(pk=instance.pk), user=user, write=write).exists():
        raise PermissionDenied({'code': 'data_scope_denied', 'detail': '对象已不在当前授权范围内，请重新加载'})


def scoped(queryset, *, user=None, write=False):
    from .models import Asset, InventoryItem, InventoryTask
    scope = scope_for(user)
    if scope.global_write if write else scope.global_read:
        return queryset
    name = queryset.model.__name__
    if name == 'Asset':
        return queryset.filter(
            Q(rack_allocation__isnull=False) & scope.location_q('rack_allocation__rack__room__data_center_id', write=write)
            | Q(rack_allocation__isnull=True) & scope.location_q('asset_data_center_id', write=write, nullable=True))
    centers = {'DataCenter': 'pk', 'ServerRoom': 'data_center_id', 'Rack': 'room__data_center_id', 'SpareStock': 'data_center_id'}
    if name in centers:
        return queryset.filter(scope.location_q(centers[name], write=write))
    if name == 'SpareStockTransaction':
        # A transfer is visible only when both endpoints are authorized.
        return queryset.filter(
            (Q(source_data_center__isnull=True) | scope.location_q('source_data_center_id', write=write))
            & (Q(target_data_center__isnull=True) | scope.location_q('target_data_center_id', write=write)))
    assets = scoped(Asset.all_objects.all(), user=user, write=write).values('pk')
    links = {'Attachment': 'asset_id', 'FaultEvent': 'asset_id', 'RepairRecord': 'fault__asset_id',
             'RepairPartUsage': 'fault__asset_id', 'AssetAssignmentEvent': 'asset_id',
             'AssetNetworkAddress': 'asset_id', 'AssetCustomValue': 'asset_id', 'AssetTag': 'asset_id',
             'RackUnitAllocation': 'asset_id', 'ProcurementRecord': 'asset_id', 'MaintenanceContract': 'asset_id',
             'AssetDisposal': 'asset_id'}
    if name == 'RepairPartUsage':
        return queryset.filter(fault__asset_id__in=assets).filter(Q(spare_stock__isnull=True) | scope.location_q('spare_stock__data_center_id', write=write))
    if name in links:
        return queryset.filter(**{f'{links[name]}__in': assets})
    if name in {'InventoryTask', 'InventoryItem'}:
        # Never expose a partial task: completion and counts require its entire
        # current and frozen scope. Unknown legacy snapshots are global-only.
        center_ids = scope.write_centers if write else scope.read_centers
        snapshots = Q(system_snapshot__data_center_id__in=center_ids)
        if scope.unlocated_write if write else scope.unlocated_read:
            snapshots |= Q(system_snapshot__data_center_id=None)
        visible_items = InventoryItem.objects.filter(asset_id__in=assets).filter(snapshots)
        observed = Q(actual_placement='') | Q(actual_location_snapshot__data_center_id__in=center_ids)
        if scope.unlocated_write if write else scope.unlocated_read:
            observed |= Q(actual_placement='unlocated')
        visible_items = visible_items.filter(observed).values('pk')
        excluded_items = InventoryItem.objects.filter(task_id=OuterRef('pk')).exclude(pk__in=visible_items)
        tasks = InventoryTask.objects.exclude(scope='all_assets').filter(
            scope.location_q('data_center_id', write=write)).filter(~Exists(excluded_items)).values('pk')
        return queryset.filter(pk__in=tasks) if name == 'InventoryTask' else queryset.filter(task_id__in=tasks, pk__in=visible_items)
    # Company-wide catalog/reference data have shared read access; their
    # changes and unscoped logs require global authorization.
    if name in {'AuditLog', 'NotificationDelivery'} or write:
        return queryset.none()
    return queryset if name in SHARED_REFERENCES else queryset.none()


def admit(request, user=None):
    """Called after DRF authentication, including force-authenticated probes."""
    user = user or request.user
    _actor.set(user if user.is_authenticated else None)
    raw = getattr(request, '_request', request)
    if user.is_authenticated and not hasattr(raw, '_data_scope_access'):
        from .maintenance_gate import authorization_access
        from .organization_access import can
        if not can(user, 'organization.manage'):
            access = authorization_access(user.pk)
            access.__enter__()
            raw._data_scope_access = access
    cached = _scope_snapshot.get()
    if user.is_authenticated and (cached is None or cached[0] != user.pk):
        _scope_snapshot.set((user.pk, scope_for(user)))


def global_endpoint(function):
    @wraps(function)
    def wrapper(request, *args, **kwargs):
        admit(request)
        scope = scope_for(request.user)
        if not (scope.global_read if request.method in SAFE_METHODS else scope.global_write):
            raise PermissionDenied({'code': 'data_scope_global_required', 'detail': '此全局操作需要全局数据范围授权'})
        return function(request, *args, **kwargs)
    return wrapper


def scope_endpoint(function):
    @wraps(function)
    def wrapper(request, *args, **kwargs):
        admit(request)
        return function(request, *args, **kwargs)
    return wrapper


def lock_creation_locations(serializer):
    """Prevent parent moves between FK validation and a child insert."""
    from .physical_location import lock_inventory_scope
    from .models import Rack, ServerRoom
    model = serializer.Meta.model
    data = serializer.validated_data
    if model is Rack:
        room = data['room']
        lock_inventory_scope(room.data_center_id, room.pk)
        require_center(ServerRoom.objects.values_list('data_center_id', flat=True).get(pk=room.pk))
    elif model is ServerRoom:
        center = data['data_center']
        lock_inventory_scope(center.pk, None)
        require_center(center.pk)


class ScopedViewSetMixin:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        admit(request)
        scope = scope_for(request.user)
        action = getattr(self, 'action', '')
        if action == 'timeline' and not scope.global_read:
            raise PermissionDenied({'code': 'data_scope_global_required', 'detail': '完整审计时间线需要全局读取授权；范围内历史请使用专项记录入口'})
        # Shared master-data changes still require global authorization.
        model = getattr(getattr(self, 'queryset', None), 'model', None)
        if model is None:
            model = getattr(getattr(self.get_serializer_class(), 'Meta', None), 'model', None)
        if request.method not in SAFE_METHODS and model and model.__name__ in {
            'Person', 'Department', 'Manufacturer', 'DeviceType', 'AssetModel', 'CustomField',
            'CustomFieldSet', 'CustomFieldOption', 'Tag', 'SparePartCategory', 'SparePart', 'SoftwareLicense',
        } and not scope.global_write:
            raise PermissionDenied({'code': 'data_scope_global_required', 'detail': '共有主数据修改需要全局写入授权'})

    def get_queryset(self):
        return scoped(super().get_queryset(), user=self.request.user, write=self.request.method not in SAFE_METHODS)

    def filter_queryset(self, queryset):
        return scoped(super().filter_queryset(queryset), user=self.request.user, write=self.request.method not in SAFE_METHODS)

    def get_serializer(self, *args, **kwargs):
        serializer = super().get_serializer(*args, **kwargs)
        # Only writable related objects are admission selectors. Shared
        # dictionaries remain usable; location/asset/task relations are scoped.
        for field in serializer.fields.values() if hasattr(serializer, 'fields') else ():
            child = getattr(field, 'child_relation', field)
            queryset = getattr(child, 'queryset', None)
            if queryset is not None:
                related_write = self.request.method not in SAFE_METHODS and queryset.model.__name__ in {'Asset', 'DataCenter', 'ServerRoom', 'Rack', 'InventoryTask', 'InventoryItem', 'FaultEvent', 'RepairRecord', 'SpareStock'}
                child.queryset = scoped(queryset, user=self.request.user, write=related_write)
        return serializer


class ScopedModelViewSet(ScopedViewSetMixin, viewsets.ModelViewSet):
    pass

class ScopedReadOnlyModelViewSet(ScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    pass
