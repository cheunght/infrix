from django.http import JsonResponse

from .models import UserSecurityProfile


class PasswordChangeRequiredMiddleware:
    """Block business API access until a newly provisioned password is changed."""

    allowed_paths = {
        "/api/v1/auth/csrf/",
        "/api/v1/auth/me/",
        "/api/v1/auth/change-password/",
        "/api/v1/auth/logout/",
        "/api/v1/auth/login/",
    }

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info
        if (
            path.startswith("/api/v1/")
            and path not in self.allowed_paths
            and getattr(request, "user", None)
            and request.user.is_authenticated
        ):
            profile = UserSecurityProfile.objects.filter(user=request.user).first()
            if profile and profile.must_change_password:
                return JsonResponse(
                    {"detail": "首次登录必须修改密码", "code": "password_change_required"},
                    status=403,
                )
        return self.get_response(request)
