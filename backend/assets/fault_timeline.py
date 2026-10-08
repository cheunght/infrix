"""Event-time rules; recording time does not constrain historical backfills."""

from rest_framework.exceptions import ValidationError


def validate_fault_times(*, occurred_at, reported_at, repair=None):
    errors = {}
    if reported_at is not None and reported_at < occurred_at:
        errors["reported_at"] = "报障时间不能早于故障发生时间"
    if repair is not None:
        for field, label in (("started_at", "开始"), ("finished_at", "完成")):
            value = getattr(repair, field)
            if value is not None and value < occurred_at:
                errors["occurred_at"] = f"故障发生时间不能晚于已有维修{label}时间"
    if errors:
        raise ValidationError(errors)


def validate_repair_times(*, occurred_at, started_at, finished_at):
    errors = {}
    if started_at is not None and started_at < occurred_at:
        errors["started_at"] = "维修开始时间不能早于故障发生时间"
    if finished_at is not None and finished_at < occurred_at:
        errors["finished_at"] = "维修完成时间不能早于故障发生时间"
    if started_at is not None and finished_at is not None and started_at > finished_at:
        errors["started_at"] = "维修开始时间不能晚于维修完成时间"
        errors["finished_at"] = "维修完成时间不能早于维修开始时间"
    if errors:
        raise ValidationError(errors)
