from pathlib import Path

from django.conf import settings
from rest_framework import serializers


ALLOWED_ATTACHMENT_TYPES = {
    ".pdf": {"application/pdf"},
    ".txt": {"text/plain"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
    ".doc": {"application/msword"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".xls": {"application/vnd.ms-excel"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".ppt": {"application/vnd.ms-powerpoint"},
    ".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
}


def validate_attachment_file(uploaded_file):
    """Validate the upload before Django writes it to private media storage."""
    original_filename = str(getattr(uploaded_file, "name", "") or "").strip()
    if (
        not original_filename
        or Path(original_filename).name != original_filename
        or "/" in original_filename
        or "\\" in original_filename
        or any(ord(char) < 32 for char in original_filename)
    ):
        raise serializers.ValidationError("文件名不合法")
    if len(original_filename) > 255:
        raise serializers.ValidationError("文件名不能超过 255 个字符")

    suffix = Path(original_filename).suffix.lower()
    allowed_mimes = ALLOWED_ATTACHMENT_TYPES.get(suffix)
    if not allowed_mimes:
        raise serializers.ValidationError("不支持的文件类型")

    size = int(getattr(uploaded_file, "size", 0) or 0)
    max_size = int(getattr(settings, "ATTACHMENT_MAX_SIZE", 20 * 1024 * 1024))
    if size <= 0:
        raise serializers.ValidationError("文件不能为空")
    if size > max_size:
        raise serializers.ValidationError(f"文件不能超过 {max_size // (1024 * 1024)} MB")

    content_type = str(getattr(uploaded_file, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if content_type not in allowed_mimes:
        raise serializers.ValidationError("文件类型与扩展名不匹配")

    return {
        "original_filename": original_filename,
        "content_type": content_type,
        "size": size,
    }
