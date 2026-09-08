"""Read-only application dependency status with an explicit public field list."""
import platform
import django
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from .permissions import CanManageSystemSettings
from .system_settings import get_system_settings, system_now
from .ldap_auth import ldap_status_snapshot
from .smtp import _configured_password, SmtpConfigurationError


@api_view(["GET"])
@permission_classes([CanManageSystemSettings])
def operational_status(request):
    result = {
        "application": {"product": "infrix", "version": settings.SPECTACULAR_SETTINGS.get("VERSION", "unknown"),
                        "environment": "production" if settings.IS_PRODUCTION else "development",
                        "runtime": f"Python {platform.python_version()} / Django {django.get_version()}"},
        "database": {"status": "unavailable", "engine": connection.vendor, "version": None, "migrations": "unavailable", "pending": None},
    }
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.execute("SELECT sqlite_version()" if connection.vendor == "sqlite" else "SELECT VERSION()")
            result["database"]["version"] = str(cursor.fetchone()[0])[:100]
        result["database"]["status"] = "healthy"
        executor = MigrationExecutor(connection)
        executor.loader.check_consistent_history(connection)
        pending = len(executor.migration_plan(executor.loader.graph.leaf_nodes()))
        result["database"].update(migrations="attention" if pending else "healthy", pending=pending)
    except Exception:
        # Do not expose driver errors, paths, connection strings or migration SQL.
        pass
    try:
        setting = get_system_settings()
        result["application"].update(time=system_now(setting).isoformat(), timezone=setting.timezone)
        smtp_state = "disabled" if not setting.smtp_enabled else "healthy"
        if setting.smtp_enabled:
            if not setting.smtp_host or not setting.smtp_from_email:
                smtp_state = "unconfigured"
            elif setting.smtp_username:
                try:
                    if not _configured_password(setting):
                        smtp_state = "unconfigured"
                except SmtpConfigurationError:
                    smtp_state = "attention"
        result["smtp"] = {"status": smtp_state, "digest_enabled": setting.email_digest_enabled}
        ldap = ldap_status_snapshot()
        result["ldap"] = {"status": "disabled" if not ldap["enabled"] else "healthy" if ldap["configured"] else "attention"}
    except Exception:
        result["configuration_status"] = "unavailable"
    return Response(result)
