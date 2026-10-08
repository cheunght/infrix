"""Account password policy shared by authenticated API and admin entrypoints."""

from rest_framework.exceptions import PermissionDenied

from .models import UserSecurityProfile
from .system_settings import local_password_expired


PASSWORD_CHANGE_PATHS = frozenset({
    "/api/v1/auth/csrf/", "/api/v1/auth/me/", "/api/v1/auth/change-password/",
    "/api/v1/auth/logout/", "/api/v1/auth/login/", "/api/v1/auth/2fa/verify/",
})


def requires_password_change(user):
    if not user or not user.is_authenticated:
        return False
    profile = UserSecurityProfile.objects.filter(user_id=user.pk).first()
    if profile is None:
        return False
    if profile.must_change_password:
        return True
    if local_password_expired(user, profile=profile):
        UserSecurityProfile.objects.filter(pk=profile.pk).update(must_change_password=True)
        return True
    return False


def enforce_api_password_policy(request, user):
    if request.path not in PASSWORD_CHANGE_PATHS and requires_password_change(user):
        raise PermissionDenied({
            "detail": "首次登录或密码过期后必须修改密码",
            "code": "password_change_required",
        })
