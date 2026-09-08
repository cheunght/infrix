"""Transactional application-level system reset service."""

from threading import Lock

from django.contrib.admin.models import LogEntry
from django.contrib.auth import SESSION_KEY, get_user_model
from django.contrib.auth.models import Group
from django.contrib.sessions.models import Session
from django.db import transaction

from .audit import write_audit_log
from .bootstrap import initialize_system_data
from .models import (
    Asset,
    AssetCustomValue,
    AssetNetworkAddress,
    AssetRelation,
    AssetTag,
    AuthThrottleState,
    CustomField,
    CustomFieldOption,
    DataCenter,
    Department,
    DeviceType,
    FaultEvent,
    InventoryItem,
    InventoryTask,
    MaintenanceContract,
    Manufacturer,
    NotificationDelivery,
    ProcurementRecord,
    Rack,
    RackUnitAllocation,
    RepairRecord,
    ServerRoom,
    SoftwareLicense,
    SparePart,
    SparePartCategory,
    SpareStock,
    SpareStockTransaction,
    Tag,
    AuditLog,
)
from .roles import ROLE_DEFINITIONS, ROLE_SYSTEM_ADMIN
from .system_settings import reset_system_settings


SYSTEM_RESET_CONFIRMATION = "RESET INFRIX"
_RESET_LOCK = Lock()


def _delete_queryset(counts, key, queryset):
    count = queryset.count()
    if count:
        queryset.delete()
    counts[key] = count


def _delete_non_preserved_sessions(preserved_user_ids):
    """Keep sessions for retained administrators and invalidate the rest."""
    preserved = {str(user_id) for user_id in preserved_user_ids}
    deleted = 0
    for session in Session.objects.all().iterator(chunk_size=200):
        try:
            decoded = session.get_decoded()
        except Exception:
            decoded = {}
        user_id = decoded.get(SESSION_KEY)
        if user_id is None or str(user_id) not in preserved:
            session.delete()
            deleted += 1
    return deleted


def _preserved_admin_ids(actor):
    User = get_user_model()
    ids = set(User.objects.filter(is_superuser=True).values_list("pk", flat=True))
    ids.add(actor.pk)
    return ids


def _clear_mutable_data(preserved_user_ids):
    """Delete business records in dependency order, never schema metadata."""
    counts = {}

    # Operational history and authentication state must be removed before
    # their actors or referenced business objects disappear.
    _delete_queryset(counts, "notification_deliveries", NotificationDelivery.objects.all())
    _delete_queryset(counts, "audit_logs", AuditLog.objects.all())
    _delete_queryset(counts, "admin_log_entries", LogEntry.objects.all())
    _delete_queryset(counts, "inventory_items", InventoryItem.objects.all())
    _delete_queryset(counts, "inventory_tasks", InventoryTask.objects.all())
    _delete_queryset(counts, "repair_records", RepairRecord.objects.all())
    _delete_queryset(counts, "fault_events", FaultEvent.objects.all())
    _delete_queryset(counts, "asset_relations", AssetRelation.objects.all())
    _delete_queryset(counts, "rack_allocations", RackUnitAllocation.objects.all())
    _delete_queryset(counts, "asset_network_addresses", AssetNetworkAddress.objects.all())
    _delete_queryset(counts, "asset_custom_values", AssetCustomValue.objects.all())
    _delete_queryset(counts, "asset_tags", AssetTag.objects.all())
    _delete_queryset(counts, "procurement_records", ProcurementRecord.objects.all())
    _delete_queryset(counts, "maintenance_contracts", MaintenanceContract.objects.all())
    _delete_queryset(counts, "assets", Asset.objects.all())

    _delete_queryset(counts, "software_licenses", SoftwareLicense.objects.all())
    _delete_queryset(counts, "spare_stock_transactions", SpareStockTransaction.objects.all())
    _delete_queryset(counts, "spare_stocks", SpareStock.objects.all())
    _delete_queryset(counts, "spare_parts", SparePart.objects.all())
    _delete_queryset(counts, "spare_part_categories", SparePartCategory.objects.all())

    _delete_queryset(counts, "custom_field_options", CustomFieldOption.objects.all())
    _delete_queryset(counts, "custom_fields", CustomField.objects.all())
    _delete_queryset(counts, "racks", Rack.objects.all())
    _delete_queryset(counts, "server_rooms", ServerRoom.objects.all())
    _delete_queryset(counts, "data_centers", DataCenter.objects.all())
    _delete_queryset(counts, "tags", Tag.objects.all())
    _delete_queryset(counts, "manufacturers", Manufacturer.objects.all())
    _delete_queryset(counts, "device_types", DeviceType.objects.all())

    # Department is the only self-protected business hierarchy.  Break its
    # parent links before deleting the hierarchy, still within the transaction.
    department_count = Department.objects.count()
    Department.objects.update(parent=None)
    if department_count:
        Department.objects.all().delete()
    counts["departments"] = department_count

    User = get_user_model()
    _delete_queryset(
        counts,
        "users",
        User.objects.exclude(pk__in=preserved_user_ids),
    )
    _delete_queryset(
        counts,
        "custom_groups",
        Group.objects.exclude(name__in=[item["name"] for item in ROLE_DEFINITIONS.values()]),
    )
    counts["auth_throttle_states"] = AuthThrottleState.objects.count()
    AuthThrottleState.objects.all().delete()
    counts["sessions"] = _delete_non_preserved_sessions(preserved_user_ids)
    reset_system_settings()
    counts["system_settings_reset"] = 1
    return counts


def _verify_bootstrap(actor_id, preserved_user_ids, groups):
    User = get_user_model()
    expected_codes = set(ROLE_DEFINITIONS)
    if set(groups) != expected_codes:
        raise RuntimeError("系统初始角色不完整，恢复操作已回滚")
    group_ids = {group.pk for group in groups.values()}
    if Group.objects.filter(pk__in=group_ids).count() != len(expected_codes):
        raise RuntimeError("系统初始角色不完整，恢复操作已回滚")
    if not User.objects.filter(pk=actor_id, is_active=True).exists():
        raise RuntimeError("执行恢复操作的管理员不存在或已停用，恢复操作已回滚")
    if not set(User.objects.filter(pk__in=preserved_user_ids).values_list("pk", flat=True)) == set(preserved_user_ids):
        raise RuntimeError("保留的管理员账号不完整，恢复操作已回滚")


def _reset_system_in_transaction(*, actor, request):
    # Keep a common, non-deleted preset group as the database lock row.  This
    # serializes reset requests on databases that support SELECT FOR UPDATE.
    groups = initialize_system_data()
    system_group = groups.get(ROLE_SYSTEM_ADMIN)
    if system_group is None:
        raise RuntimeError("系统管理员角色不存在，恢复操作已回滚")
    system_group = Group.objects.select_for_update().get(pk=system_group.pk)
    User = get_user_model()
    actor = User.objects.select_for_update().get(pk=actor.pk)
    preserved_user_ids = _preserved_admin_ids(actor)

    deleted = _clear_mutable_data(preserved_user_ids)
    groups = initialize_system_data()
    system_group = groups[ROLE_SYSTEM_ADMIN]
    preserved_users = list(User.objects.filter(pk__in=preserved_user_ids))
    if len(preserved_users) != len(preserved_user_ids):
        raise RuntimeError("保留的管理员账号不完整，恢复操作已回滚")
    for user in preserved_users:
        # The reset returns retained administrator accounts to the canonical
        # system-admin role without touching their password/hash.
        user.groups.set([system_group])

    _verify_bootstrap(actor.pk, preserved_user_ids, groups)
    write_audit_log(
        request,
        action="system_reset",
        resource_type="system",
        resource_id="system",
        extra={
            "scope": "application_data",
            "deleted_counts": deleted,
            "preserved_admin_count": len(preserved_user_ids),
        },
    )
    return {"detail": "系统已恢复初始状态"}


def reset_system(*, actor, request):
    """Atomically reset mutable application data and preserve administrators."""
    with _RESET_LOCK:
        with transaction.atomic():
            return _reset_system_in_transaction(actor=actor, request=request)
