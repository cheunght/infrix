import json

from django.core.serializers.json import DjangoJSONEncoder

from .models import AssetCustomValue, AuditLog


SENSITIVE_KEYS = {
    "password", "old_password", "new_password", "confirm_password", "password_hash",
    "csrf", "csrf_token",
    "token", "session", "cookie",
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
