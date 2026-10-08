"""Commit a replayable result in the same transaction as its business writes."""
import hashlib
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response

from .models import IdempotentMutation


class IdempotencyRequired(APIException):
    status_code = 428
    default_detail = {"detail": "此操作需要 Idempotency-Key；重试时必须复用同一个键", "code": "idempotency_key_required"}


class IdempotencyConflict(APIException):
    status_code = 409
    default_detail = {"detail": "同一幂等键不能用于不同的请求内容", "code": "idempotency_conflict"}


def execute_once(request, mutation):
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key:
        raise IdempotencyRequired()
    if len(key) > 128 or not all(33 <= ord(char) <= 126 for char in key):
        raise ValidationError({"detail": "Idempotency-Key 必须是 1–128 个可见 ASCII 字符", "code": "idempotency_key_invalid"})
    payload = json.dumps(request.data, sort_keys=True, separators=(",", ":"), cls=DjangoJSONEncoder)
    scope = f"{request.method}:{request.path_info}"
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    payload_hash = hashlib.sha256(payload.encode()).hexdigest()
    with transaction.atomic():
        # The unique insert waits for the same request to commit or roll back.
        # Do not take an exclusive user lock: business audits reference that
        # user after taking location locks, which would invert lock order.
        identity = {"actor": request.user, "scope": scope, "key_hash": key_hash}
        try:
            with transaction.atomic():
                record = IdempotentMutation.objects.create(
                    **identity, payload_hash=payload_hash, response={}, status_code=0,
                )
        except IntegrityError:
            # A committed result is immutable. Avoid upgrading the duplicate
            # insert's shared index lock, including when several retries wait.
            previous = IdempotentMutation.objects.filter(**identity).first()
            if previous is None:
                raise
            if previous.payload_hash != payload_hash:
                raise IdempotencyConflict()
            return Response(previous.response, status=previous.status_code, headers={"Idempotency-Replayed": "true"})
        response = mutation()
        if response.status_code >= 400:
            transaction.set_rollback(True)
            return response
        serializable = json.loads(json.dumps(response.data, cls=DjangoJSONEncoder))
        record.response = serializable
        record.status_code = response.status_code
        record.save(update_fields=["response", "status_code"])
        return response
