"""Read-only application dependency status with an explicit public field list."""
import django
import platform
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from .system_settings import get_notification_policy
from .runtime_clock import system_now, system_timezone_name
from .ldap_auth import ldap_status_snapshot
from .smtp import smtp_status


def read_status():
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
    configuration_unavailable = False
    try:
        result["application"].update(time=system_now().isoformat(), timezone=system_timezone_name())
    except Exception:
        configuration_unavailable = True
    try:
        notification_policy = get_notification_policy()
        result["smtp"] = {"status": smtp_status(), "digest_enabled": notification_policy.email_digest_enabled}
    except Exception:
        configuration_unavailable = True
        result["smtp"] = {"status": "unavailable", "digest_enabled": False}
    try:
        ldap = ldap_status_snapshot()
        result["ldap"] = {"status": "disabled" if not ldap["enabled"] else "healthy" if ldap["configured"] else "attention"}
    except Exception:
        configuration_unavailable = True
        result["ldap"] = {"status": "unavailable"}
    if configuration_unavailable:
        result["configuration_status"] = "unavailable"
    return result
