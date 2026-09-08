"""Small, raster-only display branding stored with the settings singleton.

Re-encoding drops filenames, metadata and appended content. Only normalized
PNG bytes can be served; no uploaded path is ever passed to file storage.
"""

import hashlib
from io import BytesIO
from pathlib import PurePath
import warnings

from PIL import Image, UnidentifiedImageError
from django.db import transaction
from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .audit import write_audit_log
from .permissions import CanManageSystemSettings
from .models import SystemSetting
from .system_settings import get_system_settings


IMAGE_FIELDS = ("logo", "compact_logo", "favicon")
MAX_UPLOAD = 2 * 1024 * 1024
MAX_PIXELS = 4_000_000


def normalize_image(upload, kind):
    extension = PurePath(upload.name.replace("\\", "/")).suffix.lower()
    formats = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
    if extension not in formats or (kind == "favicon" and extension != ".png"):
        raise serializers.ValidationError("Logo 仅支持 PNG、JPEG、WebP；favicon 仅支持 PNG")
    if upload.size > MAX_UPLOAD:
        raise serializers.ValidationError("图片不能超过 2 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            raw = upload.read(MAX_UPLOAD + 1)
            if len(raw) > MAX_UPLOAD:
                raise ValueError()
            with Image.open(BytesIO(raw)) as image:
                if image.format != formats[extension] or image.width * image.height > MAX_PIXELS:
                    raise ValueError()
                image.verify()
            with Image.open(BytesIO(raw)) as image:
                image.load()
                image = image.convert("RGBA")
                image.thumbnail((256, 256) if kind == "favicon" else (1600, 1600))
                output = BytesIO()
                image.save(output, format="PNG")
                result = output.getvalue()
                if len(result) > MAX_UPLOAD:
                    raise ValueError()
                return result
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise serializers.ValidationError("图片无效或尺寸过大") from None


def valid_image(value):
    if not value:
        return False
    raw = bytes(value)
    if len(raw) > MAX_UPLOAD:
        return False
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                if image.format != "PNG" or image.width * image.height > MAX_PIXELS:
                    return False
                image.verify()
        return True
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        return False


def branding_payload(setting):
    payload = {"display_name": setting.branding_display_name or "infrix"}
    for kind in IMAGE_FIELDS:
        value = getattr(setting, f"branding_{kind}")
        payload[kind] = (
            f"/api/v1/branding/images/{kind}/?v={hashlib.sha256(bytes(value)).hexdigest()[:16]}"
            if valid_image(value) else None
        )
    return payload


@api_view(["GET"])
@permission_classes([AllowAny])
def public_branding(request):
    return Response(branding_payload(get_system_settings()))


@api_view(["GET"])
@permission_classes([AllowAny])
def branding_image(request, kind):
    if kind not in IMAGE_FIELDS:
        return HttpResponse(status=404)
    value = getattr(get_system_settings(), f"branding_{kind}")
    if not valid_image(value):
        return HttpResponse(status=404)
    response = HttpResponse(bytes(value), content_type="image/png")
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cache-Control"] = "no-cache"
    return response


class BrandingUpdateSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=80, required=False, allow_blank=False, trim_whitespace=True)
    logo = serializers.FileField(required=False, write_only=True)
    compact_logo = serializers.FileField(required=False, write_only=True)
    favicon = serializers.FileField(required=False, write_only=True)
    reset = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({key: "不支持的品牌设置字段" for key in unknown})
        if "display_name" in attrs and any(ord(char) < 32 or ord(char) == 127 for char in attrs["display_name"]):
            raise serializers.ValidationError({"display_name": "名称不能包含控制字符"})
        if attrs.get("reset") and set(self.initial_data) != {"reset"}:
            raise serializers.ValidationError({"reset": "恢复默认不能与其他修改同时执行"})
        for kind in IMAGE_FIELDS:
            if kind in attrs:
                try:
                    attrs[kind] = normalize_image(attrs[kind], kind)
                except serializers.ValidationError as exc:
                    raise serializers.ValidationError({kind: exc.detail}) from None
        return attrs


@api_view(["GET", "PATCH"])
@permission_classes([CanManageSystemSettings])
def branding_configuration(request):
    setting = get_system_settings()
    if request.method == "GET":
        return Response(branding_payload(setting))
    serializer = BrandingUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    with transaction.atomic():
        setting = SystemSetting.objects.select_for_update().get(pk=setting.pk)
        before = branding_payload(setting)
        fields = []
        if values.get("reset"):
            setting.branding_display_name = "infrix"
            fields.append("branding_display_name")
            for kind in IMAGE_FIELDS:
                setattr(setting, f"branding_{kind}", b"")
                fields.append(f"branding_{kind}")
        else:
            for key in ("display_name", *IMAGE_FIELDS):
                if key in values:
                    setattr(setting, f"branding_{key}", values[key])
                    fields.append(f"branding_{key}")
        if fields:
            setting.save(update_fields=[*fields, "updated_at"])
            write_audit_log(request, action="branding_reset" if values.get("reset") else "branding_updated",
                            resource_type="system_settings", resource_id="branding",
                            before=before, after=branding_payload(setting))
    return Response(branding_payload(setting))
