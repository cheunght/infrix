"""Conditional asset editing, checked only after the asset write lock."""

from rest_framework.exceptions import APIException, ValidationError


class RevisionRequired(APIException):
    status_code = 428
    default_detail = {"detail": "请重新读取资产，并携带 If-Match 修订号后提交修改", "code": "asset_revision_required"}


class RevisionConflict(APIException):
    status_code = 409


def check_asset_revision(asset, request):
    if request is None or request.method not in {"PUT", "PATCH"}:
        return
    raw = request.headers.get("If-Match")
    if not raw:
        raise RevisionRequired()
    token = raw.strip()
    if token.startswith('"') and token.endswith('"'):
        token = token[1:-1]
    if len(token) > 20 or not token.isascii() or not token.isdecimal() or int(token) < 1:
        raise ValidationError({"detail": "If-Match 必须是读取资产时返回的修订号", "code": "asset_revision_invalid"})
    if int(token) != asset.revision:
        raise RevisionConflict({
            "detail": "资产已被其他操作更新，请重新加载后再编辑；当前内容尚未保存",
            "code": "asset_revision_conflict", "current_revision": asset.revision,
        })
