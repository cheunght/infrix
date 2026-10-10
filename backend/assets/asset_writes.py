"""Atomic asset writes, responsibility events, disposal and archival.

HTTP callers retain maintenance and account admission through commit. Location
parents precede asset rows when writes can reach placement; trusted legacy field
callers can supply their aggregate audit instead of adding a duplicate.
"""
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError

from .asset_configuration import (
    CustomFieldConflictAPIException,
    CustomFieldConflictError,
    apply_asset_custom_values,
    apply_asset_tags,
    configure_asset,
)
from .asset_retention import active_asset_for_update
from .asset_revision import check_asset_revision
from .asset_write_rules import (
    _configuration_includes_placement,
    _merge_partial_placement_configuration,
    _validate_direct_asset_data_center,
)
from .audit import asset_audit_snapshot, asset_custom_value_changes, write_audit_log
from .data_scope import require_object, scoped
from .lifecycle import (
    transition_asset_status,
    transition_asset_to_retired,
    validate_asset_status_transition,
)
from .models import (
    Asset,
    AssetAssignmentEvent,
    AssetDisposal,
    DataCenter,
    FaultEvent,
    InventoryItem,
    Person,
    Rack,
    RackUnitAllocation,
    RepairRecord,
    ServerRoom,
)
from .organization_access import can
from .physical_location import lock_asset_location
from .runtime_clock import system_localdate
from .system_settings import get_runtime_preferences


def _require_manager(actor):
    if not can(actor, "assets.manage"):
        raise PermissionDenied("资产写入需要 assets.manage 权限")


def _ordinary_audit(asset, request, action, before):
    after = asset_audit_snapshot(asset.pk)
    changes = asset_custom_value_changes((before or {}).get("custom_value_snapshot"), after.get("custom_value_snapshot"))
    write_audit_log(request, action=action, resource_type="asset", resource_id=asset.pk,
                    before=before, after=after, extra={"custom_changes": changes} if changes else None)


def _assignment_error(code, message):
    raise DRFValidationError({"code": code, "detail": message})


def _user_display_name(user):
    if user is None:
        return ""
    return user.get_full_name().strip() or user.username


def _person_display_name(person):
    if person is None:
        return ""
    return person.display_name()


def _person_snapshot(person):
    if person is None:
        return {
            "employee_no": "",
            "name": "",
            "department": "",
            "organization": "",
            "contact": "",
        }
    return {
        "employee_no": person.employee_no or "",
        "name": _person_display_name(person),
        "department": person.department.name if person.department_id and person.department else "",
        "organization": person.organization or "",
        "contact": person.contact or "",
    }


def _locked_person(person_id):
    if person_id in (None, ""):
        _assignment_error("assignment_target_required", "必须选择使用人")
    try:
        person = Person.objects.select_for_update().select_related("department").get(pk=person_id)
    except (Person.DoesNotExist, TypeError, ValueError) as exc:
        raise DRFValidationError({"code": "assignment_target_not_found", "detail": "使用人不存在"}) from exc
    from .data_scope import require_department
    require_department(person.department_id, write=False)
    if not person.is_active:
        _assignment_error("assignment_target_inactive", "停用人员不能被指定为资产使用人")
    return person


def _apply_assignment_status(asset, target_status):
    if target_status is None or asset.status == target_status:
        return False
    try:
        return transition_asset_status(asset, target_status, source="direct")
    except ValidationError as exc:
        message_dict = getattr(exc, "message_dict", None)
        message = "；".join(
            str(value)
            for values in (message_dict or {"status": exc.messages}).values()
            for value in (values if isinstance(values, (list, tuple)) else [values])
        )
        raise DRFValidationError({
            "code": "asset_status_transition_blocked",
            "detail": message or "资产状态不允许随使用人动作变更",
        }) from exc


@transaction.atomic
def _change_asset_assignment(
    *,
    asset_id,
    action,
    target_person_id=None,
    actor,
    request,
    reason="",
    batch_operation_id=None,
):
    from .audit import asset_audit_snapshot, write_audit_log

    if request is not None:
        _require_manager(actor)
    asset = active_asset_for_update(asset_id)
    if asset.status == "retired" and action in {"assign", "transfer"}:
        _assignment_error("asset_retired", "已报废资产不能指定或转交使用人")
    if asset.status == "repair":
        _assignment_error("asset_in_repair", "维修中资产由故障维修流程维护，不能执行使用人操作")
    if FaultEvent.objects.filter(asset_id=asset.pk, is_closed=False).exists():
        _assignment_error("asset_has_open_fault", "存在未关闭故障时，资产使用关系由维修流程维护")

    current_person = asset.assigned_person
    target_person = None
    target_status = None
    if action == "assign":
        if current_person is not None:
            _assignment_error("asset_already_assigned", "资产已有使用人，请使用转交使用人操作")
        target_person = _locked_person(target_person_id)
        target_status = "in_use" if asset.status != "in_use" else None
    elif action == "return":
        if current_person is None:
            _assignment_error("asset_not_assigned", "资产当前没有使用人，不能归还")
        # Keep retired terminal while allowing legacy inconsistent data to be
        # corrected by clearing its current assignee and recording the return.
        target_status = None if asset.status == "retired" else "in_stock"
    elif action == "transfer":
        if current_person is None:
            _assignment_error("asset_not_assigned", "资产当前没有使用人，不能转交")
        target_person = _locked_person(target_person_id)
        if target_person.pk == current_person.pk:
            _assignment_error("same_assignee", "转交目标不能与当前使用人相同")
        # A transfer changes only the person and the history.  In particular,
        # an asset in idle/in_stock/repair-compatible legacy state keeps its
        # exact current status.
    else:
        raise ValueError(f"unsupported assignment action: {action}")

    before = asset_audit_snapshot(asset.pk)
    status_changed = _apply_assignment_status(asset, target_status)
    from_person = current_person if action in {"return", "transfer"} else None
    to_person = target_person if action in {"assign", "transfer"} else None
    asset.assigned_person = to_person
    update_fields = ["assigned_person", "updated_at"]
    if status_changed:
        update_fields.append("status")
    asset.save(update_fields=update_fields)

    from_snapshot = _person_snapshot(from_person)
    to_snapshot = _person_snapshot(to_person)
    event = AssetAssignmentEvent.objects.create(
        asset=asset,
        action=action,
        from_person=from_person,
        from_person_employee_no=from_snapshot["employee_no"],
        from_person_name=from_snapshot["name"],
        from_person_department=from_snapshot["department"],
        from_person_organization=from_snapshot["organization"],
        from_person_contact=from_snapshot["contact"],
        to_person=to_person,
        to_person_employee_no=to_snapshot["employee_no"],
        to_person_name=to_snapshot["name"],
        to_person_department=to_snapshot["department"],
        to_person_organization=to_snapshot["organization"],
        to_person_contact=to_snapshot["contact"],
        operator=actor,
        operator_name=_user_display_name(actor),
        reason=str(reason or "").strip(),
    )
    after = asset_audit_snapshot(asset.pk)
    audit_extra = {
        "source": "asset_assignment",
        "assignment_event_id": event.pk,
        "from_person": from_person.pk if from_person else None,
        "to_person": to_person.pk if to_person else None,
        "operator": actor.pk if actor else None,
        "reason": event.reason,
        "occurred_at": event.created_at,
    }
    if batch_operation_id:
        audit_extra["batch_operation_id"] = str(batch_operation_id)
    write_audit_log(
        request,
        action=action,
        resource_type="asset",
        resource_id=asset.pk,
        before=before,
        after=after,
        extra=audit_extra,
    )
    return asset, event


def assign_asset(*, asset_id, target_person_id, actor, request, reason="", batch_operation_id=None):
    return _change_asset_assignment(
        asset_id=asset_id,
        action="assign",
        target_person_id=target_person_id,
        actor=actor,
        request=request,
        reason=reason,
        batch_operation_id=batch_operation_id,
    )


def return_asset(*, asset_id, actor, request, reason="", batch_operation_id=None):
    return _change_asset_assignment(
        asset_id=asset_id,
        action="return",
        actor=actor,
        request=request,
        reason=reason,
        batch_operation_id=batch_operation_id,
    )


def transfer_asset(*, asset_id, target_person_id, actor, request, reason="", batch_operation_id=None):
    return _change_asset_assignment(
        asset_id=asset_id,
        action="transfer",
        target_person_id=target_person_id,
        actor=actor,
        request=request,
        reason=reason,
        batch_operation_id=batch_operation_id,
    )


def _disposal_error(code, message):
    raise DRFValidationError({"code": code, "detail": message})


def _validation_message(exc):
    message_dict = getattr(exc, "message_dict", None)
    return "；".join(
        str(value)
        for values in (message_dict or {"status": exc.messages}).values()
        for value in (values if isinstance(values, (list, tuple)) else [values])
    ) or "资产当前不能执行报废操作"


@transaction.atomic
def dispose_asset(
    *,
    asset_id,
    disposed_on,
    reason,
    method,
    notes="",
    actor=None,
    request=None,
):
    """Retire one asset and record the immutable disposal fact atomically."""

    from .audit import asset_audit_snapshot, write_audit_log

    if disposed_on is None or disposed_on > system_localdate():
        _disposal_error("invalid_disposed_on", "处置日期不能晚于今天")
    reason = str(reason or "").strip()
    method = str(method or "").strip()
    notes = str(notes or "").strip()
    if not reason:
        _disposal_error("disposal_reason_required", "报废原因不能为空")
    if not method:
        _disposal_error("disposal_method_required", "处置方式不能为空")

    if request is not None:
        _require_manager(actor or request.user)
    lock_asset_location(asset_id=asset_id)
    try:
        asset = active_asset_for_update(asset_id)
    except Asset.DoesNotExist as exc:
        raise DRFValidationError({"code": "asset_not_found", "detail": "资产不存在"}) from exc

    if asset.status == "retired":
        _disposal_error("asset_already_disposed", "资产已报废，不能重复执行报废操作")
    if AssetDisposal.objects.filter(asset_id=asset.pk).exists():
        _disposal_error("asset_already_disposed", "资产已有报废记录，不能重复执行报废操作")

    before = asset_audit_snapshot(asset.pk)
    try:
        changed = transition_asset_to_retired(asset)
    except ValidationError as exc:
        raise DRFValidationError({
            "code": "asset_retirement_precondition_failed",
            "detail": _validation_message(exc),
        }) from exc
    if not changed:
        _disposal_error("asset_already_disposed", "资产已报废，不能重复执行报废操作")

    asset.save(update_fields=["status", "updated_at"])
    operator_name = _user_display_name(actor) or "系统"
    disposal = AssetDisposal.objects.create(
        asset=asset,
        disposed_on=disposed_on,
        reason=reason,
        method=method,
        operator=actor if getattr(actor, "is_authenticated", bool(actor)) else None,
        operator_name=operator_name,
        notes=notes,
    )
    after = asset_audit_snapshot(asset.pk)
    disposal_snapshot = {
        "disposed_on": disposal.disposed_on,
        "reason": disposal.reason,
        "method": disposal.method,
        "operator_name": disposal.operator_name,
        "notes": disposal.notes,
    }
    write_audit_log(
        request,
        action="dispose",
        resource_type="asset",
        resource_id=asset.pk,
        before=before,
        after=after,
        extra={
            "source": "asset_disposal",
            "asset_disposal_id": disposal.pk,
            "disposal": disposal_snapshot,
        },
    )
    return asset, disposal


def _apply_assignment(asset, assignment, request=None):
    if not assignment:
        return asset
    actor = request.user if request is not None and request.user.is_authenticated else None
    action = assignment["action"]
    reason = assignment.get("reason", "")
    if action == "assign":
        asset, _event = assign_asset(
            asset_id=asset.pk,
            target_person_id=assignment["target_person"].pk,
            actor=actor,
            request=request,
            reason=reason,
        )
    elif action == "transfer":
        asset, _event = transfer_asset(
            asset_id=asset.pk,
            target_person_id=assignment["target_person"].pk,
            actor=actor,
            request=request,
            reason=reason,
        )
    else:
        asset, _event = return_asset(
            asset_id=asset.pk,
            actor=actor,
            request=request,
            reason=reason,
        )
    return asset


def create_asset(validated_data, *, request=None, record_audit=False):
    validated_data = dict(validated_data)
    if record_audit and request is not None:
        _require_manager(request.user)
    configuration = validated_data.pop("configuration", {})
    assignment = validated_data.pop("assignment", None)
    tags = validated_data.pop("tags", None)
    custom_values = validated_data.pop("custom_values", {})
    validated_data.pop("discard_incompatible_custom_values", None)
    asset_model = validated_data.get("asset_model")
    if validated_data.get("warranty_months") is None and asset_model is not None:
        validated_data["warranty_months"] = asset_model.default_warranty_months
    if "status" not in validated_data:
        validated_data["status"] = get_runtime_preferences().default_asset_status
    try:
        validate_asset_status_transition(None, validated_data["status"])
    except ValidationError as exc:
        raise DRFValidationError(
            getattr(exc, "message_dict", {"status": exc.messages})
        ) from exc
    try:
        with transaction.atomic():
            from .data_scope import require_center, require_department, require_asset_boundary
            department_id = getattr(validated_data.get("owning_department"), "pk", None)
            require_department(department_id)
            target_center = validated_data.get("asset_data_center")
            if configuration.get("rack_id"):
                from .physical_location import lock_inventory_scope
                rack = Rack.objects.select_related("room").filter(pk=configuration["rack_id"]).first()
                if rack is None:
                    raise DRFValidationError({"rack_id": "未找到所选机柜，请先在机房机柜维护中创建"})
                lock_inventory_scope(rack.room.data_center_id, rack.room_id)
                rack = Rack.objects.filter(pk=rack.pk).first()
                if rack is None:
                    raise DRFValidationError({"rack_id": "所选机柜已不存在，请重新选择"})
                center_id = ServerRoom.objects.values_list("data_center_id", flat=True).get(pk=rack.room_id)
                require_center(center_id)
                validated_data["asset_data_center"] = DataCenter.objects.get(pk=center_id)
                require_asset_boundary(center_id, department_id)
            else:
                require_asset_boundary(target_center.pk if target_center else None, department_id)
                if target_center is not None:
                    # Lock the parent before INSERT takes its foreign-key
                    # shared lock; configure_asset later needs this row
                    # exclusively in the same physical lock order.
                    from .physical_location import lock_inventory_scope
                    lock_inventory_scope(target_center.pk, None)
                    target_center = get_object_or_404(DataCenter.objects.all(), pk=target_center.pk)
                    if not target_center.is_active:
                        raise DRFValidationError({"asset_data_center": "停用的数据中心不能用于资产"})
                    validated_data["asset_data_center"] = target_center
            asset = Asset.objects.create(**validated_data)
            configure_asset(asset, configuration)
            apply_asset_custom_values(asset, custom_values)
            apply_asset_tags(asset, tags or [])
            asset = _apply_assignment(asset, assignment, request)
            if record_audit:
                _ordinary_audit(asset, request, "create", None)
    except CustomFieldConflictError as exc:
        raise CustomFieldConflictAPIException(exc.conflicts) from exc
    except ValidationError as exc:
        raise DRFValidationError(getattr(exc, "message_dict", {"configuration": exc.messages})) from exc
    except IntegrityError as exc:
        raise DRFValidationError({"configuration": "关联信息已存在或与其他资产冲突"}) from exc
    return asset


def update_asset(instance, validated_data, *, request=None, record_audit=False):
    validated_data = dict(validated_data)
    if record_audit and request is not None:
        _require_manager(request.user)
    configuration = validated_data.pop("configuration", None)
    assignment = validated_data.pop("assignment", None)
    tags = validated_data.pop("tags", None)
    custom_values = validated_data.pop("custom_values", None)
    discard_incompatible = validated_data.pop("discard_incompatible_custom_values", False)
    missing = object()
    requested_asset_data_center = validated_data.get("asset_data_center", missing)
    requested_status = validated_data.pop("status", missing)
    try:
        with transaction.atomic():
            # Re-read and lock the asset before applying lifecycle checks;
            # serializer validation runs before the view transaction and
            # must not be the final authority for retirement races.
            if configuration is not None or requested_asset_data_center is not missing:
                if _configuration_includes_placement(configuration):
                    configuration = _merge_partial_placement_configuration(instance, configuration)
                # All configuration writes can reach configure_asset,
                # which may clear an allocation. Lock the current graph
                # before the asset row even for network-only or empty
                # configuration payloads.
                lock_asset_location(
                    asset_id=instance.pk,
                    **({'target_department_id': getattr(validated_data['owning_department'], 'pk', None)} if 'owning_department' in validated_data else {}),
                    target_data_center_id=getattr(requested_asset_data_center, "pk", None) if requested_asset_data_center is not missing else None,
                    target_rack_id=(
                        configuration.get("rack_id")
                        if isinstance(configuration, dict)
                        else None
                    ),
                )
            instance = active_asset_for_update(instance.pk)
            from .data_scope import require_department
            require_department(getattr(validated_data.get("owning_department", instance.owning_department), "pk", None))
            check_asset_revision(instance, request)
            before = asset_audit_snapshot(instance.pk) if record_audit else None
            if (
                requested_asset_data_center is not missing
                and not _configuration_includes_placement(configuration)
            ):
                from .data_scope import require_center
                require_center(requested_asset_data_center.pk if requested_asset_data_center else None)
                if requested_asset_data_center is not None:
                    requested_asset_data_center = DataCenter.objects.get(pk=requested_asset_data_center.pk)
                    if not requested_asset_data_center.is_active and requested_asset_data_center.pk != instance.asset_data_center_id:
                        raise DRFValidationError({"asset_data_center": "停用的数据中心不能用于资产"})
                    validated_data["asset_data_center"] = requested_asset_data_center
                _validate_direct_asset_data_center(instance, requested_asset_data_center)
            from .data_scope import checked_asset_transition
            target_center_id = (getattr(requested_asset_data_center, 'pk', None)
                if requested_asset_data_center is not missing else instance.asset_data_center_id)
            allocation = getattr(instance, 'rack_allocation', None)
            if allocation is not None and not _configuration_includes_placement(configuration):
                target_center_id = allocation.rack.room.data_center_id
            if isinstance(configuration, dict) and configuration.get('rack_id'):
                try:
                    target_center_id = Rack.objects.filter(pk=int(configuration['rack_id'])).values_list('room__data_center_id', flat=True).first()
                except (TypeError, ValueError):
                    target_center_id = None
                if target_center_id is None:
                    raise DRFValidationError({"rack_id": "未找到所选机柜，请重新选择"})
            target_department_id = getattr(validated_data.get('owning_department', instance.owning_department), 'pk', None)
            with checked_asset_transition(instance, target_center_id, target_department_id):
                if requested_status is not missing:
                    transition_asset_status(instance, requested_status)
                for key, value in validated_data.items():
                    setattr(instance, key, value)
                instance.save()
                if configuration is not None:
                    configuration = _merge_partial_placement_configuration(instance, configuration)
                    configure_asset(instance, configuration)
                apply_asset_custom_values(
                    instance,
                    custom_values or {},
                    submitted=custom_values is not None,
                    discard_incompatible=discard_incompatible,
                )
                if tags is not None:
                    apply_asset_tags(instance, tags)
                instance = _apply_assignment(instance, assignment, request)
                if record_audit:
                    _ordinary_audit(instance, request, "update", before)
    except CustomFieldConflictError as exc:
        raise CustomFieldConflictAPIException(exc.conflicts) from exc
    except ValidationError as exc:
        raise DRFValidationError(getattr(exc, "message_dict", {"configuration": exc.messages})) from exc
    except IntegrityError as exc:
        raise DRFValidationError({"configuration": "关联信息已存在或与其他资产冲突"}) from exc
    return instance


def _archive_locked_asset(instance, request, *, batch_operation_id=None):
    """Archive under the caller's asset/location locks; retain business facts."""
    from .audit import json_value

    reasons = []
    if instance.assigned_person_id:
        reasons.append("仍有当前使用人，请先归还")
    if RackUnitAllocation.objects.filter(asset=instance).exists():
        reasons.append("仍占用机柜 U 位，请先下架")
    if FaultEvent.objects.filter(asset=instance, is_closed=False).exists():
        reasons.append("存在未关闭故障")
    if RepairRecord.objects.filter(fault__asset=instance, finished_at__isnull=True).exists():
        reasons.append("存在未完成维修")
    if InventoryItem.objects.filter(asset=instance, task__status="in_progress").exists():
        reasons.append("存在进行中的盘点任务")
    if reasons:
        raise DRFValidationError({"code": "asset_archive_blocked", "detail": "；".join(reasons)})
    before = asset_audit_snapshot(instance.pk)
    instance.archived_at = timezone.now()
    instance.archive_snapshot = json_value({
        **before,
        "archived_at": instance.archived_at,
        "archived_by": request.user.pk,
        "archived_by_name": request.user.get_full_name() or request.user.username,
    })
    instance.save(update_fields=["archived_at", "archive_snapshot", "updated_at"])
    extra = {"batch_operation_id": str(batch_operation_id)} if batch_operation_id else None
    write_audit_log(
        request, action="archive", resource_type="asset", resource_id=instance.pk,
        before=before, after=asset_audit_snapshot(instance.pk), extra=extra,
    )


@transaction.atomic
def archive_asset(*, asset_id, request, batch_operation_id=None):
    _require_manager(request.user)
    lock_asset_location(asset_id=asset_id)
    asset = active_asset_for_update(asset_id)
    require_object(asset, user=request.user)
    _archive_locked_asset(asset, request, batch_operation_id=batch_operation_id)
    return asset


@transaction.atomic
def restore_asset(*, asset_id, request):
    _require_manager(request.user)
    get_object_or_404(scoped(Asset.all_objects.all(), user=request.user, write=True), pk=asset_id)
    lock_asset_location(asset_id=asset_id)
    asset = get_object_or_404(Asset.all_objects.select_for_update(), pk=asset_id)
    require_object(asset, user=request.user)
    if asset.archived_at is not None:
        before = asset_audit_snapshot(asset.pk)
        asset.archived_at = None
        asset.save(update_fields=["archived_at", "updated_at"])
        write_audit_log(request, action="restore", resource_type="asset", resource_id=asset.pk,
                        before=before, after=asset_audit_snapshot(asset.pk))
    return asset
