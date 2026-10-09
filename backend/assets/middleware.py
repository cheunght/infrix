from django.http import JsonResponse

from .maintenance_gate import MaintenanceUnavailable, business_access


class DataScopeContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        import sys
        from .data_scope import _actor, _scope_snapshot
        token = _actor.set(None)
        scope_token = _scope_snapshot.set(None)
        def release_read(error=(None, None, None)):
            snapshot = getattr(request, "_data_scope_read_access", None)
            if snapshot is not None:
                del request._data_scope_read_access
                snapshot.__exit__(*error)
        def release():
            access = getattr(request, "_data_scope_access", None)
            if access is not None:
                del request._data_scope_access
                access.__exit__(None, None, None)
        try:
            response = self.get_response(request)
            # Current streaming endpoints have already authorized/opened an
            # immutable file; SQL-backed JSON/XLSX are materialized here.
            # End the DB snapshot on this thread, retain admission until the
            # file stream closes (including streams consumed by another thread).
            release_read()
            if response.streaming:
                content = response.streaming_content
                def stream():
                    try:
                        yield from content
                    finally:
                        release()
                response.streaming_content = stream()
                response._resource_closers.append(release)
            else:
                release()
            return response
        except BaseException:
            try:
                release_read(sys.exc_info())
            finally:
                release()
            raise
        finally:
            _scope_snapshot.reset(scope_token)
            _actor.reset(token)


class MaintenanceAdmissionMiddleware:
    """Hold admission through authentication, commit callbacks and streaming."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path_info.startswith(("/api/", "/admin/")):
            return self.get_response(request)
        access = business_access()
        try:
            access.__enter__()
        except (MaintenanceUnavailable, OSError):
            response = JsonResponse({
                "detail": "系统正在维护，请稍后重试；恢复未完成时需在服务器处理。",
                "code": "maintenance_in_progress",
            }, status=503)
            response["Retry-After"] = "30"
            return response
        released = False

        def release():
            nonlocal released
            if not released:
                released = True
                access.__exit__(None, None, None)

        try:
            response = self.get_response(request)
            if response.streaming:
                content = response.streaming_content

                def stream():
                    try:
                        yield from content
                    finally:
                        release()

                response.streaming_content = stream()
                response._resource_closers.append(release)
            else:
                release()
            return response
        except BaseException:
            release()
            raise
