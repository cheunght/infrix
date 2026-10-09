"""Conditional master-data writes under their existing business lock order."""
from django.db import transaction
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiTypes
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.response import Response

from .models import RevisionedTimestamped, Rack, ServerRoom
from .physical_location import lock_rack_location, lock_server_room_location


def check_resource_revision(instance, request):
    raw = request.headers.get("If-Match")
    if not raw:
        raise ResourceRevisionRequired()
    token = raw.strip()
    if token.startswith('"') and token.endswith('"'):
        token = token[1:-1]
    if len(token) > 20 or not token.isascii() or not token.isdecimal() or int(token) < 1:
        raise ValidationError({"code": "resource_revision_invalid", "detail": "If-Match 必须是读取记录时返回的修订号"})
    if int(token) != instance.revision:
        raise ResourceRevisionConflict({"code": "resource_revision_conflict", "current_revision": instance.revision,
            "detail": "记录已被其他操作更新，当前修改未保存；请重新读取并确认差异后提交"})


class ResourceRevisionRequired(APIException):
    status_code = 428
    default_detail = {"code": "resource_revision_required", "detail": "请重新读取记录，并携带 If-Match 修订号后提交修改"}


class ResourceRevisionConflict(APIException):
    status_code = 409


class ResourceRevisionViewSetMixin:
    @extend_schema(parameters=[OpenApiParameter("If-Match", OpenApiTypes.STR, location=OpenApiParameter.HEADER,
        description="主数据记录的 revision；受保护记录必填，缺少 428，过期 409。")])
    @transaction.atomic
    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if not isinstance(instance, RevisionedTimestamped):
            return super().update(request, *args, **kwargs)
        partial = kwargs.pop("partial", False)
        # Facilities must retain center -> room -> rack -> asset order.
        model = type(instance)
        try:
            if isinstance(instance, Rack):
                instance = lock_rack_location(rack_id=instance.pk, target_room_id=request.data.get("room"))
            elif isinstance(instance, ServerRoom):
                instance = lock_server_room_location(room_id=instance.pk, target_data_center_id=request.data.get("data_center"))
            else:
                instance = model.objects.select_for_update().get(pk=instance.pk)
        except model.DoesNotExist as exc:
            raise NotFound("记录已被删除，请刷新后再操作") from exc
        check_resource_revision(instance, request)
        # Preserve the normal response's annotations and related projections.
        instance = self.get_queryset().get(pk=instance.pk)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        serializer.instance.refresh_from_db(fields=["revision"])
        serializer.instance._prefetched_objects_cache = {}
        return Response(serializer.data)


class ResourceRevisionSerializerMixin:
    def get_fields(self):
        from rest_framework import serializers
        fields = super().get_fields()
        fields["revision"] = serializers.IntegerField(read_only=True)
        return fields
