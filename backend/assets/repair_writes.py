"""Fault and repair writes, completion derivation and asset status snapshots.

HTTP calls retain admitted maintenance/account locks through commit. Fault then
repair then asset is the shared lock order. Stock consumption owns its preceding
stock/location locks. Trusted server callers must arrange equivalent admission.
"""
from django.db import transaction
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError as DRFValidationError
from .models import FaultEvent, RepairRecord
from .asset_retention import active_asset_for_update
from .lifecycle import ASSET_REPAIR_RESTORE_STATUS_VALUES, transition_asset_status
from .fault_timeline import validate_fault_times, validate_repair_times
from .organization_access import can
from .data_scope import require_object, scoped
from .resource_revision import check_resource_revision
from .audit import model_snapshot, write_audit_log


class RepairRoundConflict(APIException):
    status_code = 409
    default_detail = {"code": "repair_round_conflict", "detail": "当前维修轮次已变化，请刷新后操作"}


def _authorize(instance, request):
    if request is None:
        return  # Compatibility services are trusted server calls, not HTTP admission.
    if not can(request.user, "faults.manage"):
        raise PermissionDenied("故障和维修写入需要 faults.manage 权限")
    require_object(instance, user=request.user)


def _lock_fault(fault_id):
    try:
        return FaultEvent.objects.select_for_update().get(pk=fault_id)
    except FaultEvent.DoesNotExist as exc:
        raise NotFound("故障记录已被删除，请刷新后再操作") from exc


def validate_fault_write(attrs, *, instance=None, initial_data=None):
    if "is_closed" in (initial_data or {}):
        raise DRFValidationError({"is_closed": "故障关闭状态由维修完成时间维护"})
    if "resolved_at" in (initial_data or {}):
        raise DRFValidationError({"resolved_at": "故障解决时间由维修完成时间维护"})
    if instance is not None and instance.is_closed and attrs:
        raise DRFValidationError({
            "detail": "已关闭故障不可修改。",
            "code": "closed_fault_immutable",
        })
    if (
        instance is not None
        and "asset" in attrs
        and attrs["asset"].pk != instance.asset_id
    ):
        raise DRFValidationError({"asset": "故障关联资产创建后不能修改"})
    validate_fault_times(
        occurred_at=attrs.get("occurred_at", instance.occurred_at if instance else None),
        reported_at=attrs.get("reported_at", instance.reported_at if instance else None),
        repair=getattr(instance, "repair", None) if instance else None,
    )
    if instance is not None:
        for historical in instance.repairs.all():
            validate_fault_times(occurred_at=attrs.get("occurred_at", instance.occurred_at), reported_at=None, repair=historical)
    return attrs


def validate_repair_write(attrs, *, instance=None):
    if instance is not None and instance.finished_at is not None and attrs:
        raise DRFValidationError({
            "detail": "已完成维修保持只读；重新打开会新增空白轮次。",
            "code": "finished_repair_immutable",
        })

    if (
        instance is not None
        and "fault" in attrs
        and attrs["fault"].pk != instance.fault_id
    ):
        raise DRFValidationError({"fault": "维修记录关联故障创建后不能修改"})

    started_at = attrs.get("started_at", instance.started_at if instance else None)
    finished_at = attrs.get("finished_at", instance.finished_at if instance else None)
    fault = attrs.get("fault", instance.fault if instance else None)
    if fault.asset.archived_at is not None:
        raise DRFValidationError({"code": "asset_archived", "detail": "已归档资产的历史维修不能修改"})
    if instance is not None and fault.repair and fault.repair.pk != instance.pk:
        raise DRFValidationError({"code": "repair_round_not_current", "detail": "历史维修轮次只允许查看"})
    previous = instance.previous_round if instance is not None else None
    if previous is not None and previous.finished_at:
        if (started_at is not None and started_at < previous.finished_at) or (finished_at is not None and finished_at < previous.finished_at):
            raise DRFValidationError({"code": "repair_round_time_invalid", "detail": "本轮维修时间不能早于上一轮完成时间"})
    validate_repair_times(
        occurred_at=fault.occurred_at,
        started_at=started_at,
        finished_at=finished_at,
    )
    return attrs


REPAIR_RESTORE_STATUSES = ASSET_REPAIR_RESTORE_STATUS_VALUES


def _write_fault_status_audit(
    *,
    request,
    asset,
    old_status,
    new_status,
    old_snapshot,
    new_snapshot,
    fault_id=None,
    repair_id=None,
    transition=None,
):
    if request is None or old_status == new_status:
        return

    from .audit import write_audit_log

    transition = transition or ("enter_repair" if new_status == "repair" else "restore")
    write_audit_log(
        request,
        action="update",
        resource_type="asset",
        resource_id=asset.pk,
        before={
            "status": old_status,
            "status_before_repair": old_snapshot,
        },
        after={
            "status": new_status,
            "status_before_repair": new_snapshot,
        },
        extra={
            "source": "fault_status_sync",
            "transition": transition,
            "asset_id": asset.pk,
            "fault_id": fault_id,
            "repair_id": repair_id,
            "old_status": old_status,
            "new_status": new_status,
            "status_before_repair": new_snapshot if new_status == "repair" else old_snapshot,
        },
    )


@transaction.atomic
def sync_asset_fault_status(asset_id: int, *, request=None, fault_id=None, repair_id=None, transition=None):
    """Synchronize one asset's repair lifecycle and restore snapshot."""
    asset = active_asset_for_update(asset_id)
    open_faults = FaultEvent.objects.filter(asset_id=asset_id, is_closed=False)
    has_open_fault = open_faults.exists()
    other_open_fault = open_faults.exclude(pk=fault_id).exists() if fault_id is not None else has_open_fault
    old_status = asset.status
    old_snapshot = asset.status_before_repair
    update_fields = []

    if has_open_fault:
        if asset.status == "retired":
            raise DRFValidationError({
                "code": "asset_retired",
                "detail": "已报废资产不能新建或重开未关闭故障",
            })
        if asset.status != "repair":
            if not other_open_fault and asset.status_before_repair is None and asset.status in REPAIR_RESTORE_STATUSES:
                asset.status_before_repair = asset.status
                update_fields.append("status_before_repair")
            if transition_asset_status(asset, "repair", source="fault"):
                update_fields.append("status")
    elif asset.status == "repair":
        if asset.status_before_repair in REPAIR_RESTORE_STATUSES:
            if transition_asset_status(asset, asset.status_before_repair, source="fault"):
                asset.status_before_repair = None
                update_fields.extend(["status", "status_before_repair"])
    elif asset.status_before_repair is not None:
        # Clear only a stale internal snapshot; never infer a replacement status.
        asset.status_before_repair = None
        update_fields.append("status_before_repair")

    if update_fields:
        asset.save(update_fields=[*update_fields, "updated_at"])
        _write_fault_status_audit(
            request=request,
            asset=asset,
            old_status=old_status,
            new_status=asset.status,
            old_snapshot=old_snapshot,
            new_snapshot=asset.status_before_repair,
            fault_id=fault_id,
            repair_id=repair_id,
            transition=transition,
        )
    return asset


@transaction.atomic
def sync_fault_completion(*, fault_id: int, finished_at, request=None, repair_id=None):
    """Make FaultEvent completion state derive only from RepairRecord.finished_at."""
    from .audit import write_audit_log

    fault = FaultEvent.objects.select_for_update().get(pk=fault_id)
    current = fault.repair
    if current is not None and repair_id is not None and current.pk != repair_id:
        raise DRFValidationError({"code": "repair_round_not_current", "detail": "历史轮次不能改变当前故障状态"})
    next_is_closed = bool(finished_at)
    before = {"is_closed": fault.is_closed, "resolved_at": fault.resolved_at}
    after = {"is_closed": next_is_closed, "resolved_at": finished_at}
    if before != after:
        fault.is_closed = next_is_closed
        fault.resolved_at = finished_at
        fault.save(update_fields=["is_closed", "resolved_at", "updated_at"])
        if request is not None:
            write_audit_log(
                request,
                action="close" if next_is_closed else "reopen",
                resource_type="fault_event",
                resource_id=fault.pk,
                before=before,
                after=after,
                extra={
                    "source": "repair_record",
                    "repair_id": repair_id,
                    "fault_id": fault.pk,
                },
            )

    sync_asset_fault_status(
        fault.asset_id,
        request=request,
        fault_id=fault.pk,
        repair_id=repair_id,
        transition="reopen" if not next_is_closed else None,
    )
    return fault


def sync_repair_completion(repair, *, request=None):
    """Keep RepairRecord, FaultEvent and Asset status consistent."""
    return sync_fault_completion(
        fault_id=repair.fault_id,
        finished_at=repair.finished_at,
        request=request,
        repair_id=repair.pk,
    )


@transaction.atomic
def reopen_repair(*, repair_id: int, request=None):
    """Reopen one finished repair without deleting its historical record."""
    from .audit import model_snapshot, write_audit_log

    repair = _lock_repair(repair_id)
    _authorize(repair, request)
    if repair.finished_at is None:
        raise DRFValidationError({
            "detail": "未完成的维修不能重新打开。",
            "code": "repair_not_finished",
        })

    fault = _lock_fault(repair.fault_id)
    if fault.repair.pk != repair.pk:
        raise RepairRoundConflict()
    actor = getattr(request, "user", None)
    successor = RepairRecord.objects.create(fault=fault, round_number=repair.round_number + 1, previous_round=repair,
        opened_by=actor, opened_by_name=_actor_name(actor))
    if request is not None:
        write_audit_log(request, action="reopen", resource_type="repair_record", resource_id=successor.pk,
            after=model_snapshot(successor), extra={"source": "repair_round_open", "fault_id": fault.pk, "previous_round_id": repair.pk, "round_number": successor.round_number})
    sync_repair_completion(successor, request=request)
    return successor


def _actor_name(actor):
    return (actor.get_full_name().strip() or actor.username)[:150] if actor is not None else ""


def begin_usage_round(fault, *, request, actor):
    """Caller owns fault admission/lock. A first usage opens a blank draft round."""
    current = RepairRecord.objects.select_for_update().filter(fault=fault).order_by("-round_number").first()
    if current is None:
        current = RepairRecord.objects.create(fault=fault, origin="usage_started", opened_by=actor, opened_by_name=_actor_name(actor))
        if request is not None:
            _audit(current, request, "create", None, model_snapshot(current))
    return current


def _serializer(kind, request, instance=None):
    from .serializers import FaultEventSerializer, RepairRecordSerializer
    cls = FaultEventSerializer if kind == "fault" else RepairRecordSerializer
    serializer = cls(instance, data=request.data, partial=request.method == "PATCH", context={"request": request})
    relation = serializer.fields["asset" if kind == "fault" else "fault"]
    relation.queryset = scoped(relation.queryset, user=request.user, write=True)
    serializer.is_valid(raise_exception=True)
    return serializer


def _audit(instance, request, action, before, after, *, resource_id=None):
    is_fault = isinstance(instance, FaultEvent)
    extra = {"asset_id": instance.asset_id, "source": "fault_event"} if is_fault else {
        "asset_id": instance.fault.asset_id, "fault_id": instance.fault_id, "source": "repair_record",
    }
    write_audit_log(request, action=action, resource_type="fault_event" if is_fault else "repair_record",
                    resource_id=resource_id or instance.pk, before=before, after=after, extra=extra)


@transaction.atomic
def create_fault(*, request, asset_id):
    asset = active_asset_for_update(asset_id)
    _authorize(asset, request)
    serializer = _serializer("fault", request)
    fault = serializer.save()
    _audit(fault, request, "create", None, model_snapshot(fault))
    sync_asset_fault_status(fault.asset_id, request=request, fault_id=fault.pk)
    return fault


@transaction.atomic
def update_fault(*, request, fault_id):
    fault = _lock_fault(fault_id)
    _authorize(fault, request)
    check_resource_revision(fault, request)
    serializer = _serializer("fault", request, fault)
    before = model_snapshot(fault)
    fault = serializer.save()
    _audit(fault, request, "update", before, model_snapshot(fault))
    sync_asset_fault_status(fault.asset_id, request=request)
    return fault


@transaction.atomic
def delete_fault(*, request, fault_id):
    fault = _lock_fault(fault_id)
    _authorize(fault, request)
    if fault.is_closed:
        raise DRFValidationError({"detail": "已关闭故障不可删除。", "code": "closed_fault_immutable"})
    if fault.repairs.exists():
        raise DRFValidationError({"code": "repair_round_history_protected", "detail": "存在维修轮次的故障不能删除"})
    if fault.part_usages.exists():
        raise DRFValidationError("故障存在维修用件记录，不能删除。")
    before = model_snapshot(fault)
    resource_id, asset_id = fault.pk, fault.asset_id
    fault.delete()
    _audit(fault, request, "delete", before, None, resource_id=resource_id)
    sync_asset_fault_status(asset_id, request=request)


def _lock_repair(repair_id):
    try:
        fault_id = RepairRecord.objects.values_list("fault_id", flat=True).get(pk=repair_id)
        _lock_fault(fault_id)
        return RepairRecord.objects.select_for_update().get(pk=repair_id)
    except (FaultEvent.DoesNotExist, RepairRecord.DoesNotExist) as exc:
        raise NotFound("故障或维修记录已被删除，请刷新后再操作") from exc


@transaction.atomic
def create_repair(*, request, fault_id):
    fault = _lock_fault(fault_id)
    _authorize(fault, request)
    current = fault.repair
    if current is not None and current.origin != "usage_started":
        raise DRFValidationError({"fault": "故障已有维修轮次；请编辑当前轮次或从完成轮次重开"})
    serializer = _serializer("repair", request, current)
    actor = request.user
    before = model_snapshot(current) if current else None
    repair = serializer.save(origin="recorded", opened_by=current.opened_by if current else actor,
        opened_by_name=current.opened_by_name if current else _actor_name(actor))
    if repair.finished_at is not None:
        repair.completed_by = actor
        repair.completed_by_name = _actor_name(actor)
        repair.save(update_fields=["completed_by", "completed_by_name"])
    _audit(repair, request, "update" if current else "create", before, model_snapshot(repair))
    sync_repair_completion(repair, request=request)
    return repair


@transaction.atomic
def update_repair(*, request, repair_id):
    repair = _lock_repair(repair_id)
    _authorize(repair, request)
    check_resource_revision(repair, request)
    serializer = _serializer("repair", request, repair)
    before = model_snapshot(repair)
    repair = serializer.save(origin="recorded" if repair.origin == "usage_started" else repair.origin)
    if repair.finished_at is not None:
        repair.completed_by = request.user
        repair.completed_by_name = _actor_name(request.user)
        repair.save(update_fields=["completed_by", "completed_by_name"])
    _audit(repair, request, "update", before, model_snapshot(repair))
    sync_repair_completion(repair, request=request)
    return repair


@transaction.atomic
def delete_repair(*, request, repair_id):
    repair = _lock_repair(repair_id)
    _authorize(repair, request)
    if repair.finished_at is not None:
        raise DRFValidationError({"detail": "已完成维修不可删除；重新打开会新增空白轮次。", "code": "finished_repair_immutable"})
    if repair.previous_round_id or repair.part_usages.exists() or repair.attachments.exists():
        raise DRFValidationError({"code": "repair_round_history_protected", "detail": "存在前轮、用件或附件的维修不能删除"})
    before = model_snapshot(repair)
    resource_id, fault_id = repair.pk, repair.fault_id
    # Read audit scope while the retained fault still exists.
    repair.delete()
    _audit(repair, request, "delete", before, None, resource_id=resource_id)
    sync_fault_completion(fault_id=fault_id, finished_at=None, request=request, repair_id=resource_id)


def admit_repair_attachment(repair_id, *, request):
    """Caller keeps the transaction open through storage and commit callbacks."""
    repair = _lock_repair(repair_id)
    _authorize(repair, request)
    if repair.finished_at is not None or repair.fault.repair.pk != repair.pk:
        raise DRFValidationError({"code": "finished_repair_immutable", "detail": "已完成或历史轮次的附件只允许查看和下载"})
    return repair
