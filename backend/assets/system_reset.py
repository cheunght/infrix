"""Transactional application-level system reset service."""

from threading import Lock

from django.contrib.admin.models import LogEntry
from django.contrib.auth import SESSION_KEY, get_user_model
from django.contrib.sessions.models import Session
from django.db import transaction

from .audit import write_audit_log
from .backups import backup_operation_lock
from .branding import reset_branding_settings
from .bootstrap import initialize_system_data
from .models import (
    Asset,
    AssetModel,
    AssetCustomValue,
    AssetNetworkAddress,
    AssetAssignmentEvent,
    Person,
    AssetTag,
    AuthThrottleState,
    CustomField,
    CustomFieldOption,
    CustomFieldSet,
    CustomFieldSetItem,
    DataCenter,
    Department,
    DeviceType,
    DirectoryIdentity,
    FaultEvent,
    InventoryItem,
    InventoryTask,
    MaintenanceContract,
    Manufacturer,
    NotificationDelivery,
    PersonalAccessToken,
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
from .organization_access import (
    delete_non_preset_groups,
    lock_preset_role_rows,
    reset_preserved_administrator_roles,
    verify_role_bootstrap,
)
from .system_settings import reset_system_settings


SYSTEM_RESET_CONFIRMATION = "RESET INFRIX"
_RESET_LOCK = Lock()
_verify_bootstrap = verify_role_bootstrap


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
    _delete_queryset(counts, "asset_assignment_events", AssetAssignmentEvent.objects.all())
    _delete_queryset(counts, "rack_allocations", RackUnitAllocation.objects.all())
    _delete_queryset(counts, "asset_network_addresses", AssetNetworkAddress.objects.all())
    _delete_queryset(counts, "asset_custom_values", AssetCustomValue.objects.all())
    _delete_queryset(counts, "asset_tags", AssetTag.objects.all())
    _delete_queryset(counts, "procurement_records", ProcurementRecord.objects.all())
    _delete_queryset(counts, "maintenance_contracts", MaintenanceContract.objects.all())
    _delete_queryset(counts, "assets", Asset.objects.all())
    # AssetModel and the fieldset links are protected references.  Remove
    # models before their manufacturer/device-type/fieldset parents, then
    # remove fieldset memberships before the protected CustomField rows.
    _delete_queryset(counts, "asset_models", AssetModel.objects.all())

    _delete_queryset(counts, "software_licenses", SoftwareLicense.objects.all())
    _delete_queryset(counts, "spare_stock_transactions", SpareStockTransaction.objects.all())
    _delete_queryset(counts, "spare_stocks", SpareStock.objects.all())
    _delete_queryset(counts, "spare_parts", SparePart.objects.all())
    _delete_queryset(counts, "spare_part_categories", SparePartCategory.objects.all())

    _delete_queryset(counts, "custom_fieldset_items", CustomFieldSetItem.objects.all())
    _delete_queryset(counts, "custom_field_options", CustomFieldOption.objects.all())
    # DeviceType.default_fieldset is PROTECT, so device types must be removed
    # before the fieldsets they reference.
    _delete_queryset(counts, "device_types", DeviceType.objects.all())
    _delete_queryset(counts, "custom_fieldsets", CustomFieldSet.objects.all())
    _delete_queryset(counts, "custom_fields", CustomField.objects.all())
    _delete_queryset(counts, "racks", Rack.objects.all())
    _delete_queryset(counts, "server_rooms", ServerRoom.objects.all())
    _delete_queryset(counts, "data_centers", DataCenter.objects.all())
    _delete_queryset(counts, "tags", Tag.objects.all())
    _delete_queryset(counts, "manufacturers", Manufacturer.objects.all())
    _delete_queryset(
        counts,
        "people",
        Person.objects.all(),
    )

    # Department is the only self-protected business hierarchy.  Break its
    # parent links before deleting the hierarchy, still within the transaction.
    department_count = Department.objects.count()
    Department.objects.update(parent=None)
    if department_count:
        Department.objects.all().delete()
    counts["departments"] = department_count

    # Directory identities protect their user rows, so remove identities for
    # deleted users explicitly while retaining identities for administrators.
    _delete_queryset(
        counts,
        "directory_identities",
        DirectoryIdentity.objects.exclude(user_id__in=preserved_user_ids),
    )
    # A system reset is a security boundary: every PAT, including retained
    # administrators' tokens, must be invalid after the reset.
    _delete_queryset(counts, "personal_access_tokens", PersonalAccessToken.objects.all())

    User = get_user_model()
    _delete_queryset(
        counts,
        "users",
        User.objects.exclude(pk__in=preserved_user_ids),
    )
    counts["custom_groups"] = delete_non_preset_groups()
    counts["auth_throttle_states"] = AuthThrottleState.objects.count()
    AuthThrottleState.objects.all().delete()
    counts["sessions"] = _delete_non_preserved_sessions(preserved_user_ids)
    reset_system_settings()
    counts["system_settings_reset"] = 1
    return counts


def _reset_system_in_transaction(*, actor, request):
    # Keep a common, non-deleted preset group as the database lock row.  This
    # serializes reset requests on databases that support SELECT FOR UPDATE.
    groups = lock_preset_role_rows()
    User = get_user_model()
    actor = User.objects.select_for_update().get(pk=actor.pk)
    preserved_user_ids = _preserved_admin_ids(actor)

    deleted = _clear_mutable_data(preserved_user_ids)
    reset_branding_settings(actor=actor, request=request, audit=False)
    groups = initialize_system_data()
    groups = reset_preserved_administrator_roles(preserved_user_ids)

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
    with backup_operation_lock():
        with _RESET_LOCK:
            with transaction.atomic():
                return _reset_system_in_transaction(actor=actor, request=request)
