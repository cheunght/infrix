"""Stable authentication codes without changing existing business errors."""

from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated, PermissionDenied
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exception, context):
    response = drf_exception_handler(exception, context)
    if response is None or not isinstance(response.data, dict) or "code" in response.data:
        return response
    if isinstance(exception, NotAuthenticated):
        response.data["code"] = "not_authenticated"
    elif isinstance(exception, AuthenticationFailed):
        response.data["code"] = "authentication_failed"
    elif isinstance(exception, PermissionDenied):
        response.data["code"] = (
            "csrf_failed" if str(exception.detail).startswith("CSRF Failed:") else "permission_denied"
        )
    return response
