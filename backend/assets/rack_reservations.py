"""Durable U holds serialized with every writer of the physical rack graph."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from .audit import write_audit_log
from .data_scope import require_object, scope_for
from .models import Rack, RackUnitReservation
from .organization_access import can
from .physical_location import lock_rack_capacity, active_rack_reservations, rack_position_ranges
from .resource_revision import check_resource_revision


def require_reservation_access(rack, request, *, write=False):
    require_object(rack, write=write, user=request.user)
    if not scope_for(request.user).full_department_access(center_id=rack.room.data_center_id):
        raise PermissionDenied("U 位预留需要读取该机柜完整占用的权限")
    if write and not can(request.user, "racks.manage"):
        raise PermissionDenied("使用或管理 U 位预留需要机柜管理权限")


def _lock_rack(rack_id):
    try:
        return lock_rack_capacity(rack_id)
    except Rack.DoesNotExist as exc:
        raise NotFound("机柜已删除，请刷新后重试") from exc


def _audit(row, request, operation):
    write_audit_log(request, action="update", resource_type="rack", resource_id=row.rack_id,
                    extra={"source": "rack_u_reservation", "operation": operation,
                           "reservation_id": row.pk, "start_u": row.start_u, "end_u": row.end_u,
                           "purpose": row.purpose, "status": row.status})


@transaction.atomic
def reserve_units(*, rack_id, start_u, end_u, purpose, request):
    rack = _lock_rack(rack_id)
    require_reservation_access(rack, request, write=True)
    check_resource_revision(rack, request)
    purpose = purpose.strip()
    if end_u < start_u or not 1 <= len(purpose) <= 200:
        raise ValidationError("请填写有效的预留区间和用途")
    if not (rack.is_active and rack.status == "in_use" and rack.room.is_active and rack.room.data_center.is_active):
        raise ValidationError({"rack": "机柜或上级位置不可用，不能新增 U 位预留"})
    ranges = rack_position_ranges(rack.allocations.all(), rack.total_u, reservations=active_rack_reservations(rack))
    if not any(start_u >= span["start_u"] and end_u <= span["end_u"] for span in ranges["available_ranges"]):
        raise ValidationError({"start_u": "区间已被占用、预留、包含禁用 1U 或超过机柜容量，请刷新后重新选择"})
    row = RackUnitReservation.objects.create(rack=rack, start_u=start_u, end_u=end_u, purpose=purpose, created_by=request.user)
    rack.save(update_fields=["updated_at"])
    _audit(row, request, "created")
    return row


@transaction.atomic
def release_units(*, rack_id, reservation_id, request):
    rack = _lock_rack(rack_id)
    require_reservation_access(rack, request, write=True)
    row = RackUnitReservation.objects.select_for_update().filter(pk=reservation_id, rack=rack).first()
    if row is None:
        raise NotFound("预留记录不存在")
    check_resource_revision(row, request)
    if row.status != "active":
        raise ValidationError({"reservation_id": "该预留已经结束，请刷新后查看状态"})
    row.status, row.closed_by, row.closed_at = "released", request.user, timezone.now()
    row.save(update_fields=["status", "closed_by", "closed_at", "updated_at"])
    rack.save(update_fields=["updated_at"])
    _audit(row, request, "released")
    return row


def consume_units(*, rack_id, reservation_id, asset_id, start_u, end_u, request):
    """Caller holds the asset placement graph locks and transaction.

    Consume the whole hold only. Any failed placement rolls this change back.
    Ordinary asset edits/imports have no implicit right to consume a hold.
    """
    rack = Rack.objects.select_related("room__data_center").get(pk=rack_id)
    require_reservation_access(rack, request, write=True)
    row = RackUnitReservation.objects.select_for_update().filter(pk=reservation_id, rack=rack).first()
    if row is None:
        raise NotFound("预留记录不存在或不属于目标机柜")
    if row.status != "active" or (row.start_u, row.end_u) != (start_u, end_u):
        raise ValidationError({"reservation_id": "预留已结束或位置不匹配；上架必须完整使用所选预留区间"})
    row.status, row.closed_by, row.closed_at, row.consumed_asset_id = "consumed", request.user, timezone.now(), asset_id
    row.save(update_fields=["status", "closed_by", "closed_at", "consumed_asset", "updated_at"])
    rack.save(update_fields=["updated_at"])
    _audit(row, request, "consumed")
