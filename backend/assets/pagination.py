from django.db import OperationalError, ProgrammingError
from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_page_size(self, request):
        # An explicit page_size remains authoritative.  The persisted setting
        # only supplies the server-side default when a caller omits it.
        if self.page_size_query_param and self.page_size_query_param in request.query_params:
            return super().get_page_size(request)
        try:
            from .system_settings import get_system_settings

            return get_system_settings().default_page_size
        except (OperationalError, ProgrammingError):
            # Keep migrations and management commands usable before the
            # singleton table exists.
            return self.page_size
