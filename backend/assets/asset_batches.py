"""Asset batches: independent per-record transactions and safe result projections."""
from uuid import uuid4

from django.core.exceptions import ObjectDoesNotExist, ValidationError as DjangoValidationError
from django.db import DatabaseError, transaction
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError as DRFValidationError

from .asset_writes import _require_manager, archive_asset, assign_asset, transfer_asset
from .audit import asset_audit_snapshot, write_audit_log
from .data_scope import scoped
from .models import Asset, AssetTag, DataCenter, Rack, ServerRoom, Tag
from .physical_location import clear_asset_placement, lock_asset_location, place_asset


def _batch_error_message(error, fallback):
    detail = getattr(error, "detail", error)

    def flatten(value):
        if isinstance(value, dict):
            return "；".join(flatten(child) for child in value.values())
        if isinstance(value, (list, tuple)):
            return "；".join(flatten(child) for child in value)
        return str(value or "")

    return flatten(detail) or fallback


def _batch_error_code(error, fallback):
    detail = getattr(error, "detail", error)
    if isinstance(detail, dict) and detail.get("code"):
        return str(detail["code"]).upper()
    return fallback


def _apply_bulk_edit(request, instance, changes, batch_operation_id):
    """Apply the explicitly selected asset fields inside one asset transaction."""
    from .serializers import AssetWriteSerializer
    before = asset_audit_snapshot(instance.pk)
    write_data = {}
    changed_fields = []

    model_change = changes.get("model", {})
    if model_change.get("enabled"):
        changed_fields.append("model")
        if model_change["mode"] == "set":
            write_data["asset_model"] = model_change["asset_model"]
        else:
            write_data.update({
                "asset_model": None,
                "device_type": model_change["device_type"],
                "manufacturer": model_change.get("manufacturer"),
                "model_text": model_change.get("model_text", ""),
            })

    purpose_change = changes.get("purpose", {})
    if purpose_change.get("enabled"):
        changed_fields.append("purpose")
        write_data["purpose"] = "" if purpose_change["action"] == "clear" else purpose_change.get("value", "")

    tag_change = changes.get("tags", {})
    if tag_change.get("enabled"):
        changed_fields.append("tags")
        requested_tag_ids = tag_change.get("values", [])
        requested_tags = list(Tag.objects.filter(pk__in=requested_tag_ids))
        if len(requested_tags) != len(requested_tag_ids):
            raise DRFValidationError({"tags": "存在不存在的标签"})
        inactive_new = [tag.name for tag in requested_tags if not tag.is_active]
        existing_tag_ids = set(AssetTag.objects.filter(asset_id=instance.pk).values_list("tag_id", flat=True))
        if inactive_new and any(tag_id not in existing_tag_ids for tag_id in requested_tag_ids):
            raise DRFValidationError({"tags": "停用的标签不能用于资产"})
        requested_by_id = {tag.pk: tag for tag in requested_tags}
        if tag_change["mode"] == "add":
            final_ids = list(dict.fromkeys([*existing_tag_ids, *requested_by_id]))
        elif tag_change["mode"] == "remove":
            remove_ids = set(requested_by_id)
            final_ids = [tag_id for tag_id in existing_tag_ids if tag_id not in remove_ids]
        else:
            final_ids = list(dict.fromkeys(requested_by_id))
        write_data["tags"] = final_ids

    if write_data:
        serializer = AssetWriteSerializer(
            instance=instance,
            data=write_data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()

    location_change = changes.get("location", {})
    if location_change.get("enabled"):
        changed_fields.append("location")
        if location_change["action"] == "clear":
            clear_asset_placement(asset_id=instance.pk)
        else:
            data_center = DataCenter.objects.filter(pk=location_change["data_center"]).first()
            room = ServerRoom.objects.select_related("data_center").filter(
                pk=location_change["server_room"],
                data_center_id=location_change["data_center"],
            ).first()
            rack = Rack.objects.select_related("room__data_center").filter(
                pk=location_change["rack"],
                room_id=location_change["server_room"],
            ).first()
            if not data_center:
                raise DRFValidationError({"location.data_center": "数据中心不存在"})
            if not room:
                raise DRFValidationError({"location.server_room": "机房不属于所选数据中心"})
            if not rack:
                raise DRFValidationError({"location.rack": "机柜不属于所选机房"})
            place_asset(
                asset_id=instance.pk,
                rack_id=rack.pk,
                start_u=location_change["start_u"],
                end_u=location_change["end_u"],
            )

    after = asset_audit_snapshot(instance.pk)
    write_audit_log(
        request,
        action="bulk_update",
        resource_type="asset",
        resource_id=instance.pk,
        before=before,
        after=after,
        extra={
            "source": "asset_bulk_edit",
            "batch_operation_id": str(batch_operation_id),
            "changed_fields": changed_fields,
        },
    )
    return instance

def batch_archive_assets(request, asset_ids):
    _require_manager(request.user)
    batch_operation_id = uuid4()
    results = []
    succeeded = 0
    for asset_id in asset_ids:
        asset_no = f"ID {asset_id}"
        try:
            with transaction.atomic():
                if not scoped(Asset.objects.filter(pk=asset_id), user=request.user, write=True).exists():
                    raise Asset.DoesNotExist
                lock_asset_location(asset_id=asset_id)
                instance = Asset.objects.select_for_update().get(pk=asset_id)
                asset_no = instance.asset_no
                archive_asset(
                    asset_id=instance.pk,
                    request=request,
                    batch_operation_id=batch_operation_id,
                )
        except (Asset.DoesNotExist, PermissionDenied):
            results.append({
                "id": asset_id,
                "asset_no": f"ID {asset_id}",
                "success": False,
                "code": "NOT_FOUND",
                "reason": "资产不存在、已归档或不在写入范围内",
            })
        except DRFValidationError as exc:
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": False,
                "code": "PROTECTED",
                "reason": _batch_error_message(exc, "资产当前不能归档"),
            })
        except DatabaseError:
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": False,
                "code": "CONFLICT",
                "reason": "资产当前存在关联数据，未归档",
            })
        else:
            succeeded += 1
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": True,
                "code": "",
                "reason": "",
            })
    response_data = {
        "requested": len(asset_ids),
        "succeeded": succeeded,
        "failed": len(asset_ids) - succeeded,
        "results": results,
    }
    return response_data

def batch_assign_assets(request, validated):
    _require_manager(request.user)
    asset_ids = validated["ids"]
    action = validated["action"]
    target_person_id = validated["target_person"].pk
    reason = validated.get("reason", "")
    batch_operation_id = uuid4()
    results = []
    succeeded = 0
    actor = request.user if request.user.is_authenticated else None

    for asset_id in asset_ids:
        asset_no = f"ID {asset_id}"
        try:
            with transaction.atomic():
                if not scoped(Asset.objects.filter(pk=asset_id), user=request.user, write=True).exists():
                    raise Asset.DoesNotExist
                lock_asset_location(asset_id=asset_id)
                instance = Asset.objects.select_for_update().get(pk=asset_id)
                asset_no = instance.asset_no
                if action == "assign":
                    assign_asset(
                        asset_id=asset_id,
                        target_person_id=target_person_id,
                        actor=actor,
                        request=request,
                        reason=reason,
                        batch_operation_id=batch_operation_id,
                    )
                else:
                    transfer_asset(
                        asset_id=asset_id,
                        target_person_id=target_person_id,
                        actor=actor,
                        request=request,
                        reason=reason,
                        batch_operation_id=batch_operation_id,
                    )
        except (Asset.DoesNotExist, PermissionDenied):
            results.append({
                "id": asset_id,
                "asset_no": f"ID {asset_id}",
                "success": False,
                "code": "NOT_FOUND",
                "reason": "资产不存在、已归档或不在写入范围内",
            })
        except DRFValidationError as exc:
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": False,
                "code": _batch_error_code(exc, "ASSIGNMENT_REJECTED"),
                "reason": _batch_error_message(exc, "资产当前不能执行使用人操作"),
            })
        except DatabaseError:
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": False,
                "code": "CONFLICT",
                "reason": "资产当前存在并发变更，未执行使用人操作",
            })
        else:
            succeeded += 1
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": True,
                "code": "",
                "reason": "",
            })

    response_data = {
        "requested": len(asset_ids),
        "succeeded": succeeded,
        "failed": len(asset_ids) - succeeded,
        "results": results,
    }
    return response_data

def bulk_edit_assets(request, validated):
    _require_manager(request.user)
    batch_operation_id = uuid4()
    results = []
    succeeded = 0
    for asset_id in validated["ids"]:
        asset_no = f"ID {asset_id}"
        try:
            with transaction.atomic():
                if not scoped(Asset.objects.filter(pk=asset_id), user=request.user, write=True).exists():
                    raise Asset.DoesNotExist
                location_change = validated["changes"].get("location", {})
                if location_change.get("enabled"):
                    if location_change.get("action") == "clear":
                        lock_asset_location(asset_id=asset_id)
                    else:
                        lock_asset_location(
                            asset_id=asset_id,
                            target_rack_id=location_change.get("rack"),
                        )
                else:
                    lock_asset_location(asset_id=asset_id)
                instance = Asset.objects.select_for_update().get(pk=asset_id)
                asset_no = instance.asset_no
                _apply_bulk_edit(request, instance, validated["changes"], batch_operation_id)
        except (ObjectDoesNotExist, PermissionDenied):
            results.append({
                "id": asset_id,
                "asset_no": f"ID {asset_id}",
                "success": False,
                "code": "NOT_FOUND",
                "reason": "资产不存在、已归档或操作涉及未授权范围",
            })
        except (DRFValidationError, APIException) as exc:
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": False,
                "code": _batch_error_code(exc, "BULK_EDIT_REJECTED"),
                "reason": _batch_error_message(exc, "资产当前不能执行批量编辑"),
            })
        except DjangoValidationError as exc:
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": False,
                "code": "BULK_EDIT_REJECTED",
                "reason": _batch_error_message(exc, "资产当前不能执行批量编辑"),
            })
        except DatabaseError:
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": False,
                "code": "CONFLICT",
                "reason": "资产当前存在并发变更，未执行批量编辑",
            })
        else:
            succeeded += 1
            results.append({
                "id": asset_id,
                "asset_no": asset_no,
                "success": True,
                "code": "",
                "reason": "",
            })
    response_data = {
        "requested": len(validated["ids"]),
        "succeeded": succeeded,
        "failed": len(validated["ids"]) - succeeded,
        "results": results,
    }
    return response_data

