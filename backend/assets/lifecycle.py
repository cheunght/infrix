"""The small, explicit lifecycle policy for assets.

The Asset model owns the legal status values.  This module only defines which
of those values can be selected by a normal asset edit and which transitions
belong to the existing fault/repair service.
"""

from django.core.exceptions import ValidationError

from .enum_contracts import ASSET_STATUS_VALUES
from .models import FaultEvent, RackUnitAllocation, RepairRecord


ASSET_REPAIR_STATUS = "repair"
ASSET_TERMINAL_STATUS_VALUES = frozenset({"retired"})
ASSET_INITIAL_STATUS_VALUES = tuple(
    status for status in ASSET_STATUS_VALUES if status != ASSET_REPAIR_STATUS
)
ASSET_REPAIR_RESTORE_STATUS_VALUES = frozenset(
    status for status in ASSET_INITIAL_STATUS_VALUES
    if status not in ASSET_TERMINAL_STATUS_VALUES
)

# Normal asset editing can move between the ordinary operational statuses and
# into the terminal retired status.  Repair is owned by the fault/repair
# service, and retired has no ordinary reverse transition.
ASSET_STATUS_TRANSITIONS = {
    status: frozenset(ASSET_INITIAL_STATUS_VALUES)
    for status in ASSET_REPAIR_RESTORE_STATUS_VALUES
}
ASSET_STATUS_TRANSITIONS.update({
    ASSET_REPAIR_STATUS: frozenset({ASSET_REPAIR_STATUS}),
    **{
        status: frozenset({status})
        for status in ASSET_TERMINAL_STATUS_VALUES
    },
})


def _transition_error(current_status, target_status, reason):
    if current_status is None:
        message = f'资产创建时不能将状态设置为“{target_status}”：{reason}'
    else:
        message = (
            f'资产状态从“{current_status}”到“{target_status}”的直接转换不允许：{reason}'
        )
    return ValidationError({"status": message})


def _has_open_fault(asset, has_open_fault):
    if has_open_fault is not None or asset is None or not asset.pk:
        return bool(has_open_fault)
    return FaultEvent.objects.filter(asset_id=asset.pk, is_closed=False).exists()


def validate_asset_retirement(asset, *, has_open_fault=None):
    """Validate the current business facts required before retiring an asset."""

    if asset is None or not asset.pk:
        return
    if getattr(asset, "responsible_user_id", None):
        raise ValidationError({"status": "资产仍有当前责任人，请先归还后再报废"})
    if RackUnitAllocation.objects.filter(asset_id=asset.pk).exists():
        raise ValidationError({"status": "资产仍占用机柜 U 位，请先下架后再报废"})
    if _has_open_fault(asset, has_open_fault):
        raise ValidationError({"status": "资产存在未关闭故障，请先完成故障处理后再报废"})
    if RepairRecord.objects.filter(
        fault__asset_id=asset.pk,
        finished_at__isnull=True,
    ).exists():
        raise ValidationError({"status": "资产存在未完成维修，请先完成故障维修后再报废"})


def allowed_asset_status_values(asset=None, *, has_open_fault=None):
    """Return statuses that the normal asset form may submit.

    A new asset uses the model-backed initial status set.  Existing assets in
    repair, retired, or an active asset with an open fault only expose their
    current status because those changes are controlled by a business action.
    """

    if asset is None:
        allowed = set(ASSET_INITIAL_STATUS_VALUES)
    else:
        current_status = asset.status
        allowed = set(ASSET_STATUS_TRANSITIONS.get(current_status, {current_status}))
        if current_status in ASSET_REPAIR_RESTORE_STATUS_VALUES and _has_open_fault(asset, has_open_fault):
            allowed = {current_status}
        elif "retired" in allowed:
            try:
                validate_asset_retirement(asset, has_open_fault=has_open_fault)
            except ValidationError:
                allowed.discard("retired")
    return tuple(status for status in ASSET_STATUS_VALUES if status in allowed)


def validate_asset_status_transition(
    asset,
    target_status,
    *,
    source="direct",
    has_open_fault=None,
):
    """Validate one status change at a business boundary.

    ``direct`` is the ordinary API/import path.  ``fault`` is reserved for
    the existing fault/repair synchronization service and does not broaden
    what a user can submit through the normal asset API.
    """

    if target_status not in ASSET_STATUS_VALUES:
        raise _transition_error(None if asset is None else asset.status, target_status, "目标状态不是 AssetStatus 合法值")

    if asset is None:
        if target_status not in ASSET_INITIAL_STATUS_VALUES:
            raise _transition_error(
                None,
                target_status,
                "维修中状态由故障维修流程维护，不能手工设置",
            )
        return

    current_status = asset.status
    if current_status == target_status:
        return

    if target_status == "retired":
        validate_asset_retirement(asset, has_open_fault=has_open_fault)

    if source == "fault":
        if (
            target_status == ASSET_REPAIR_STATUS
            and current_status in ASSET_REPAIR_RESTORE_STATUS_VALUES
        ):
            return
        if (
            current_status == ASSET_REPAIR_STATUS
            and target_status in ASSET_REPAIR_RESTORE_STATUS_VALUES
            and asset.status_before_repair == target_status
        ):
            return
        raise _transition_error(
            current_status,
            target_status,
            "该转换不符合故障维修流程当前记录",
        )

    if source != "direct":
        raise ValueError(f"unsupported asset status transition source: {source}")

    if current_status in ASSET_TERMINAL_STATUS_VALUES:
        raise _transition_error(
            current_status,
            target_status,
            "已报废是终态，当前没有恢复资产业务动作",
        )
    if current_status == ASSET_REPAIR_STATUS or target_status == ASSET_REPAIR_STATUS:
        raise _transition_error(
            current_status,
            target_status,
            "维修中状态由故障维修流程维护，不能手工设置或结束",
        )
    if _has_open_fault(asset, has_open_fault):
        raise _transition_error(
            current_status,
            target_status,
            "存在未关闭故障时，资产状态由维修流程维护",
        )
    if target_status not in ASSET_STATUS_TRANSITIONS.get(current_status, {current_status}):
        raise _transition_error(
            current_status,
            target_status,
            "当前状态不允许该直接转换",
        )


def transition_asset_status(
    asset,
    target_status,
    *,
    source="direct",
    has_open_fault=None,
):
    """Validate and apply one status transition, returning whether it changed."""

    validate_asset_status_transition(
        asset,
        target_status,
        source=source,
        has_open_fault=has_open_fault,
    )
    if asset.status == target_status:
        return False
    asset.status = target_status
    return True
