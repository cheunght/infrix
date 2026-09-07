from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import migrations
from django.utils import timezone


def _deployment_locale():
    language_code = str(getattr(settings, "LANGUAGE_CODE", "zh-hans") or "").lower()
    return "en-US" if language_code.startswith("en") else "zh-CN"


def _deployment_timezone():
    candidate = str(getattr(settings, "TIME_ZONE", "Asia/Shanghai") or "").strip()
    try:
        ZoneInfo(candidate)
    except (ZoneInfoNotFoundError, ValueError):
        return "Asia/Shanghai"
    return candidate


def seed_runtime_defaults(apps, schema_editor):
    system_setting_model = apps.get_model("assets", "SystemSetting")
    system_setting = system_setting_model.objects.filter(pk=1).first()
    if system_setting is None:
        return

    updates = {}

    # 0011 introduced these values with static defaults. Only replace those
    # untouched defaults so an administrator's existing setting is preserved.
    if system_setting.default_locale == "zh-CN":
        updates["default_locale"] = _deployment_locale()
    if system_setting.timezone == "Asia/Shanghai":
        updates["timezone"] = _deployment_timezone()

    login_defaults = (
        ("login_max_attempts", "AUTH_LOGIN_MAX_ATTEMPTS", 5),
        ("login_window_seconds", "AUTH_LOGIN_WINDOW_SECONDS", 900),
        ("login_lock_seconds", "AUTH_LOGIN_LOCK_SECONDS", 900),
    )
    for field_name, setting_name, migration_default in login_defaults:
        if getattr(system_setting, field_name) == migration_default:
            updates[field_name] = int(
                getattr(settings, setting_name, migration_default)
            )

    if updates:
        updates["updated_at"] = timezone.now()
        system_setting_model.objects.filter(pk=1).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0011_system_administration_settings"),
    ]

    operations = [
        migrations.RunPython(seed_runtime_defaults, migrations.RunPython.noop),
    ]
