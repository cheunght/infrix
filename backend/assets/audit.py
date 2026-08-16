import json

from django.core.serializers.json import DjangoJSONEncoder

from .models import AuditLog


SENSITIVE_KEYS = {
    "password", "old_password", "new_password", "csrf", "csrf_token",
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


def write_audit_log(
    request,
    *,
    action,
    resource_type,
    resource_id,
    before=None,
    after=None,
    extra=None,
):
    payload = {}
    if before is not None:
        payload["before"] = json_value(before)
    if after is not None:
        payload["after"] = json_value(after)
    if extra:
        payload["extra"] = json_value(extra)
    return AuditLog.objects.create(
        actor=request.user if request.user.is_authenticated else None,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        payload=payload,
    )
