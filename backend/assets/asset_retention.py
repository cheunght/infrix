"""Admit asset writes under a lock that also serializes archival."""
from rest_framework.exceptions import APIException, NotFound, ValidationError

from .models import Asset


class AssetArchived(APIException):
    status_code = 409
    default_detail = {"code": "asset_archived", "detail": "资产已归档，请先恢复到当前台账再操作"}


def active_asset_for_update(asset_id):
    try:
        asset = Asset.all_objects.select_for_update().get(pk=asset_id)
    except Asset.DoesNotExist as exc:
        raise NotFound("资产不存在") from exc
    if asset.archived_at is not None:
        raise AssetArchived()
    return asset


def visible_assets(request, queryset):
    archived = request.query_params.get("archived", "false").lower()
    if archived not in {"true", "false"}:
        raise ValidationError({"archived": "必须是 true 或 false"})
    show_archived = archived == "true" and request.method in {"GET", "HEAD", "OPTIONS"}
    return queryset.filter(archived_at__isnull=not show_archived)
