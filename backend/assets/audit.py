import json

from django.core.serializers.json import DjangoJSONEncoder

from .models import Asset, AssetCustomValue, AuditLog


SENSITIVE_KEYS = {
    "password", "old_password", "new_password", "confirm_password", "password_hash",
    "csrf", "csrf_token",
    "token", "session", "cookie", "authorization", "secret", "bind_password",
    "smtp_password", "smtp_password_encrypted",
    "ldap_bind_password", "ldap_filter", "raw_filter", "dn", "entry_dn", "raw_entry",
}


def _sanitize(value):
    if isinstance(value, dict):
        return {
            key: _sanitize(item)
            for key, item in value.items()
            if str(key).lower() not in SENSITIVE_KEYS
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]
    return value


def json_value(value):
    return json.loads(json.dumps(_sanitize(value), cls=DjangoJSONEncoder))


def model_snapshot(instance):
    snapshot = {}
    for field in instance._meta.concrete_fields:
        if field.name in SENSITIVE_KEYS:
            continue
        snapshot[field.name] = field.value_from_object(instance)
    return json_value(snapshot)


def software_license_audit_snapshot(instance):
    """Keep license audit changes readable without querying manufacturers per field."""
    snapshot = model_snapshot(instance)
    manufacturer = getattr(instance, "manufacturer", None)
    snapshot["manufacturer"] = (
        {
            "id": manufacturer.pk,
            "name": manufacturer.name,
            "code": manufacturer.code,
            "is_active": manufacturer.is_active,
        }
        if manufacturer is not None
        else None
    )
    return json_value(snapshot)


def spare_part_audit_snapshot(instance):
    """Keep spare part master-data changes readable in audit history."""
    snapshot = model_snapshot(instance)
    category = getattr(instance, "category", None)
    snapshot["category"] = (
        {
            "id": category.pk,
            "name": category.name,
            "code": category.code,
            "is_active": category.is_active,
        }
        if category is not None
        else None
    )
    manufacturer = getattr(instance, "manufacturer", None)
    snapshot["manufacturer"] = (
        {
            "id": manufacturer.pk,
            "name": manufacturer.name,
            "code": manufacturer.code,
            "is_active": manufacturer.is_active,
        }
        if manufacturer is not None
        else None
    )
    return json_value(snapshot)


def spare_stock_transaction_audit_snapshot(instance, *, transfer_context=None):
    """Keep transfer audits reconstructable without changing the ledger API."""
    from .serializers import SpareStockTransactionSerializer

    snapshot = SpareStockTransactionSerializer(instance).data
    if instance.operation_type != "transfer":
        return json_value(snapshot)
    if transfer_context is None:
        raise ValueError("transfer audit context is required")
    snapshot.update({
        "transfer_quantity": transfer_context["transfer_quantity"],
        "source_before_quantity": transfer_context["source_before_quantity"],
        "source_after_quantity": transfer_context["source_after_quantity"],
        "target_before_quantity": transfer_context["target_before_quantity"],
        "target_after_quantity": transfer_context["target_after_quantity"],
    })
    return json_value(snapshot)


def repair_part_usage_audit_snapshot(instance):
    """Keep repair part usage audits readable from immutable snapshots."""
    from .serializers import RepairPartUsageSerializer

    return json_value(RepairPartUsageSerializer(instance).data)


def asset_audit_snapshot(asset_id):
    """Build the same rich asset snapshot used by asset write audits."""
    from .serializers import AssetDetailSerializer

    asset = Asset.objects.select_related(
        "department",
        "responsible_user",
        "manufacturer",
        "device_type",
        "asset_data_center",
        "rack_allocation__rack__room__data_center",
    ).prefetch_related(
        "network_addresses",
        "procurement_records",
        "maintenance_contracts",
        "asset_tags__tag",
        "custom_values__field__options",
    ).get(pk=asset_id)
    snapshot = AssetDetailSerializer(asset).data
    snapshot.pop("allowed_statuses", None)
    # Depreciation values are derived from today's date and must not create
    # date-dependent audit diffs.  The four configuration fields remain in the
    # AssetDetailSerializer payload and are intentionally retained here.
    snapshot.pop("depreciation", None)
    custom_snapshot = asset_custom_value_snapshot(asset.pk)
    snapshot["custom_value_snapshot"] = custom_snapshot
    snapshot["custom_values"] = {
        item["key"]: item["value"] for item in custom_snapshot
    }
    snapshot["status_before_repair"] = asset.status_before_repair
    custom_values_by_id = {item["field_id"]: item["value"] for item in custom_snapshot}
    for field in snapshot.get("custom_fields", []):
        if field.get("id") in custom_values_by_id:
            field["value"] = custom_values_by_id[field["id"]]
    return snapshot


def asset_custom_value_snapshot(asset_id):
    """Return a stable, field-identified snapshot for one asset's custom values."""
    snapshot = []
    values = AssetCustomValue.objects.filter(asset_id=asset_id).select_related("field").order_by("field_id")
    for item in values:
        field = item.field
        if field.field_type in {"text", "textarea", "select"}:
            value = item.text_value
        elif field.field_type == "number":
            value = str(item.number_value) if item.number_value is not None else None
        elif field.field_type == "date":
            value = item.date_value.isoformat() if item.date_value else None
        elif field.field_type == "boolean":
            value = item.boolean_value
        else:
            value = item.json_value
        snapshot.append({
            "field_id": field.id,
            "key": field.key,
            "name": field.name,
            "field_type": field.field_type,
            "value": value,
        })
    return snapshot


def asset_custom_value_changes(before, after):
    """Describe only custom value changes between two asset snapshots."""
    before_by_id = {item["field_id"]: item for item in (before or [])}
    after_by_id = {item["field_id"]: item for item in (after or [])}
    changes = []
    for field_id in sorted(set(before_by_id) | set(after_by_id)):
        old = before_by_id.get(field_id)
        new = after_by_id.get(field_id)
        old_value = old["value"] if old else None
        new_value = new["value"] if new else None
        if old_value == new_value:
            continue
        field = new or old
        changes.append({
            "field_id": field_id,
            "key": field["key"],
            "name": field["name"],
            "field_type": field["field_type"],
            "old_value": old_value,
            "new_value": new_value,
        })
    return changes


def write_audit_log(
    request,
    *,
    action,
    resource_type,
    resource_id,
    before=None,
    after=None,
    extra=None,
    actor=None,
):
    payload = {}
    if before is not None:
        payload["before"] = json_value(before)
    if after is not None:
        payload["after"] = json_value(after)
    if extra:
        payload["extra"] = json_value(extra)
    return AuditLog.objects.create(
        actor=actor if actor is not None else (request.user if request.user.is_authenticated else None),
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        payload=payload,
    )
