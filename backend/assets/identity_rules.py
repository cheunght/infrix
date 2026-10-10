"""Parsed account policy shared by user field adapters and domain writes."""
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError
from .ldap_auth import is_directory_managed
from .organization_access import read_authorization_snapshot
from .system_settings import get_local_auth_policy, validate_local_password


def validate_account_attributes(attrs, *, instance=None):
    if attrs.get("normalize_roles") and "role_code" not in attrs:
        raise DRFValidationError({"role_code": "规范化角色时必须明确选择一个角色"})
    if instance is not None and "role_code" in attrs:
        snapshot = read_authorization_snapshot(instance)
        if len(snapshot.role_codes) > 1 and not attrs.get("normalize_roles", False):
            raise DRFValidationError({"role_code": "该账号拥有多个角色，确认后才能规范化"})
    if instance is not None and "password" in attrs:
        if is_directory_managed(instance):
            raise DRFValidationError({"password": "目录账号密码由目录服务管理"})
        raise DRFValidationError(
            {"password": "管理员重置用户密码请使用专用 reset-password 接口"}
        )
    if instance is not None and "person" in attrs:
        raise DRFValidationError({"person_id": "系统账号只能在创建时关联人员"})
    if instance is None and not attrs.get("password"):
        minimum = get_local_auth_policy().password_min_length
        raise DRFValidationError({"password": f"新用户必须设置至少 {minimum} 位密码"})
    password = attrs.get("password")
    if password:
        password_user = instance or User(username=attrs.get("username", ""))
        try:
            validate_local_password(password, user=password_user)
        except DjangoValidationError as exc:
            raise DRFValidationError({"password": list(exc.messages)})
    return attrs
