"""Direct digest delivery and recipient-free daily delivery counts."""
from django.db.models import Count
from drf_spectacular.utils import extend_schema, OpenApiTypes
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .audit import write_audit_log
from .data_scope import scope_endpoint, scope_for
from .models import NotificationDelivery
from .notification_delivery import send_digest
from .organization_access import can
from .runtime_clock import system_now


def _require_digest_administrator(request):
    if not can(request.user, "settings.manage") or not scope_for(request.user).global_write:
        raise PermissionDenied({"code": "data_scope_global_required", "detail": "需要系统管理权限及全局写入范围"})


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@scope_endpoint
def notification_digest_status(request):
    _require_digest_administrator(request)
    day = system_now().date()
    counts = {state: 0 for state in ("pending", "sending", "sent", "failed", "unknown")}
    counts.update({row["status"]: row["count"] for row in
                   NotificationDelivery.objects.filter(window_date=day)
                   .values("status").annotate(count=Count("pk")) if row["status"] in counts})
    return Response({"date": day, "deliveries": counts})


@extend_schema(request=None, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@scope_endpoint
def notification_digest_send(request):
    _require_digest_administrator(request)
    result = send_digest()
    write_audit_log(request, action="notification_digest", resource_type="system",
                    resource_id="notifications", extra=result)
    return Response(result)
