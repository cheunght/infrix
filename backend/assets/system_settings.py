"""Typed, database-backed system administration settings.

The singleton model is the source of truth for values editable by a system
administrator. Deployment-owned credentials and the encryption key remain
environment configuration and never cross the API boundary.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import OperationalError, ProgrammingError
from django.utils import timezone as django_timezone

from .models import DirectoryIdentity, SystemSetting, UserSecurityProfile


TIMEZONE_OPTIONS = (
    {"value": "Asia/Shanghai", "label": "Asia/Shanghai — China Standard Time"},
    {"value": "UTC", "label": "UTC"},
    {"value": "Asia/Tokyo", "label": "Asia/Tokyo — Japan Standard Time"},
    {"value": "Asia/Singapore", "label": "Asia/Singapore — Singapore Standard Time"},
    {"value": "Europe/London", "label": "Europe/London — United Kingdom"},
    {"value": "America/New_York", "label": "America/New_York — Eastern Time"},
    {"value": "America/Los_Angeles", "label": "America/Los_Angeles — Pacific Time"},
    {"value": "Australia/Sydney", "label": "Australia/Sydney — Australian Eastern Time"},
)


SETTING_METADATA = {
    "default_page_size": {
        "label": "默认每页条数",
        "type": "integer",
        "section": "general",
        "help_text": "作为未指定分页大小的列表默认值；用户已选择的页面大小不受影响。",
    },
    "default_asset_status": {
        "label": "新资产默认状态",
        "type": "enum",
        "section": "general",
        "help_text": "仅影响以后新建或导入且未填写状态的资产，不修改历史资产。",
    },
    "default_locale": {
        "label": "默认界面语言",
        "type": "enum",
        "section": "localization",
        "help_text": "新用户和未设置个人语言偏好的会话使用此语言；用户个人设置优先。",
    },
    "timezone": {
        "label": "系统时区",
        "type": "timezone",
        "section": "localization",
        "help_text": "用于系统日期时间和提醒展示；请输入有效的 IANA 时区名称。",
        "options": TIMEZONE_OPTIONS,
    },
    "date_format": {
        "label": "日期格式",
        "type": "enum",
        "section": "localization",
        "help_text": "影响日期和日期时间在界面中的展示格式。",
    },
    "currency": {
        "label": "默认币种",
        "type": "enum",
        "section": "localization",
        "help_text": "影响金额输入和资产折旧金额的货币符号展示，不会换算已保存金额。",
    },
    "password_min_length": {
        "label": "本地账号密码最小长度",
        "type": "integer",
        "section": "security",
        "help_text": "只约束本地账号；LDAP / AD 账号仍由目录服务的密码策略约束。",
    },
    "password_expiry_days": {
        "label": "本地账号密码有效期（天）",
        "type": "integer",
        "section": "security",
        "help_text": "设置为 0 表示不强制过期；过期后本地账号需先修改密码。",
    },
    "login_max_attempts": {
        "label": "登录失败次数上限",
        "type": "integer",
        "section": "security",
        "help_text": "账号和来源 IP 在窗口内达到上限后会暂时锁定。",
    },
    "login_window_seconds": {
        "label": "失败计数窗口（秒）",
        "type": "integer",
        "section": "security",
        "help_text": "登录失败次数在此时间窗口内累计。",
    },
    "login_lock_seconds": {
        "label": "临时锁定时长（秒）",
        "type": "integer",
        "section": "security",
        "help_text": "达到失败次数上限后，账号和来源 IP 暂停登录的时间。",
    },
    "smtp_enabled": {
        "label": "启用 SMTP",
        "type": "boolean",
        "section": "smtp",
        "help_text": "启用后可以发送测试邮件；现有业务提醒仍通过站内通知中心展示。",
    },
    "smtp_host": {
        "label": "SMTP 服务端",
        "type": "string",
        "section": "smtp",
        "help_text": "填写主机名或 IP，不要包含协议前缀。",
    },
    "smtp_port": {
        "label": "SMTP 端口",
        "type": "integer",
        "section": "smtp",
        "help_text": "常见端口：STARTTLS 使用 587，SSL/TLS 使用 465。",
    },
    "smtp_security_mode": {
        "label": "SMTP 安全模式",
        "type": "enum",
        "section": "smtp",
        "help_text": "请根据邮件服务端要求选择连接安全模式。",
    },
    "smtp_username": {
        "label": "SMTP 用户名",
        "type": "string",
        "section": "smtp",
        "help_text": "需要认证时填写；密码只接受输入，不会回显。",
    },
    "smtp_from_email": {
        "label": "发件人邮箱",
        "type": "email",
        "section": "smtp",
        "help_text": "测试邮件和系统邮件使用的发件人地址。",
    },
    "smtp_from_name": {
        "label": "发件人名称",
        "type": "string",
        "section": "smtp",
        "help_text": "可选；用于邮件客户端显示的发件人名称。",
    },
    "smtp_timeout": {
        "label": "SMTP 超时（秒）",
        "type": "integer",
        "section": "smtp",
        "help_text": "连接邮件服务端的最大等待时间。",
    },
    "notify_maintenance": {
        "label": "维保到期提醒",
        "type": "boolean",
        "section": "notifications",
        "help_text": "在站内提醒中显示已过期或即将到期的维保合同。",
    },
    "maintenance_expiry_days": {
        "label": "维保到期提醒提前天数",
        "type": "integer",
        "section": "notifications",
        "help_text": "包含未来指定天数内到期的维保合同。",
    },
    "notify_license_expiry": {
        "label": "软件许可到期提醒",
        "type": "boolean",
        "section": "notifications",
        "help_text": "在站内提醒中显示已过期或即将到期的软件许可。",
    },
    "license_expiry_days": {
        "label": "许可到期提醒提前天数",
        "type": "integer",
        "section": "notifications",
        "help_text": "包含未来指定天数内到期的软件许可；超额使用提醒不受此项影响。",
    },
    "notify_open_faults": {
        "label": "未关闭故障提醒",
        "type": "boolean",
        "section": "notifications",
        "help_text": "在站内提醒中显示当前仍未关闭的故障。",
    },
    "notify_overdue_inventory": {
        "label": "逾期盘点提醒",
        "type": "boolean",
        "section": "notifications",
        "help_text": "在站内提醒中显示超过结束时间且仍在进行中的盘点任务。",
    },
    "notify_low_spare_stock": {
        "label": "备件低库存提醒",
        "type": "boolean",
        "section": "notifications",
        "help_text": "在站内提醒中显示低于安全库存的备件。",
    },
}

PUBLIC_SETTING_KEYS = tuple(SETTING_METADATA)
RESET_SETTING_KEYS = (*PUBLIC_SETTING_KEYS, "smtp_password_encrypted")


def _valid_timezone(value: str) -> str:
    candidate = str(value or "").strip()
    try:
        ZoneInfo(candidate)
    except (ZoneInfoNotFoundError, ValueError):
        return "Asia/Shanghai"
    return candidate


def _deployment_defaults() -> dict[str, object]:
    language_code = str(getattr(settings, "LANGUAGE_CODE", "zh-hans") or "zh-hans").lower()
    return {
        "default_locale": "en-US" if language_code.startswith("en") else "zh-CN",
        "timezone": _valid_timezone(getattr(settings, "TIME_ZONE", "Asia/Shanghai")),
        "login_max_attempts": max(1, int(getattr(settings, "AUTH_LOGIN_MAX_ATTEMPTS", 5))),
        "login_window_seconds": max(1, int(getattr(settings, "AUTH_LOGIN_WINDOW_SECONDS", 900))),
        "login_lock_seconds": max(1, int(getattr(settings, "AUTH_LOGIN_LOCK_SECONDS", 900))),
    }


def get_system_settings():
    """Return the singleton, applying deployment defaults only on first creation."""

    return SystemSetting.objects.get_or_create(
        pk=SystemSetting.SINGLETON_ID,
        defaults=_deployment_defaults(),
    )[0]


def system_timezone(setting=None):
    """Return the configured application timezone with a migration-safe fallback."""

    if setting is None:
        try:
            setting = get_system_settings()
        except (OperationalError, ProgrammingError):
            return django_timezone.get_current_timezone()
    candidate = str(getattr(setting, "timezone", "") or "").strip()
    try:
        return ZoneInfo(candidate)
    except (ZoneInfoNotFoundError, ValueError):
        return django_timezone.get_current_timezone()


def system_now(setting=None):
    """Return the current instant represented in the configured timezone."""

    return django_timezone.now().astimezone(system_timezone(setting))


def system_localdate(setting=None):
    """Return today's date according to the configured application timezone."""

    configured_timezone = system_timezone(setting)
    current_timezone = django_timezone.get_current_timezone()
    # Keep Django's established localdate path when the application setting
    # and deployment timezone agree. Besides avoiding needless conversion,
    # this preserves existing callers' timezone.localdate observation and
    # keeps their behavior unchanged. A web-configured timezone still takes
    # precedence whenever it differs from the deployment timezone.
    if configured_timezone == current_timezone:
        return django_timezone.localdate()
    return system_now(setting).date()


def system_localtime(value=None, setting=None):
    """Represent an aware datetime in the configured application timezone."""

    value = value or django_timezone.now()
    if django_timezone.is_naive(value):
        value = django_timezone.make_aware(value, system_timezone(setting))
    return django_timezone.localtime(value, system_timezone(setting))


def system_date_bounds(start: date | None = None, end: date | None = None, setting=None):
    """Return an inclusive system-date range as aware datetime boundaries.

    Timestamp filters must use the configured system timezone instead of the
    deployment ``TIME_ZONE`` used by Django's ``__date`` lookup. The upper
    bound is exclusive so an ``end`` date includes its entire local day.
    """

    timezone = system_timezone(setting)
    start_at = (
        django_timezone.make_aware(datetime.combine(start, time.min), timezone)
        if start is not None
        else None
    )
    end_at = (
        django_timezone.make_aware(
            datetime.combine(end + timedelta(days=1), time.min),
            timezone,
        )
        if end is not None
        else None
    )
    return start_at, end_at


def system_settings_snapshot(setting):
    """Return an audit-safe snapshot without any encrypted SMTP material."""

    return {
        key: getattr(setting, key)
        for key in PUBLIC_SETTING_KEYS
    } | {
        "smtp_password_configured": bool(setting.smtp_password_encrypted),
    }


def reset_system_settings():
    """Restore model defaults and remove the stored SMTP secret."""

    setting = get_system_settings()
    defaults = {
        field.name: field.default() if callable(field.default) else field.default
        for field in setting._meta.fields
        if field.name in RESET_SETTING_KEYS
    }
    changed_fields = [
        field_name
        for field_name, default in defaults.items()
        if getattr(setting, field_name) != default
    ]
    if changed_fields:
        for field_name, default in defaults.items():
            setattr(setting, field_name, default)
        setting.save(update_fields=[*changed_fields, "updated_at"])
    return setting


def system_setting_definitions():
    """Build form metadata from model fields, not a second value registry."""

    definitions = []
    for key, metadata in SETTING_METADATA.items():
        field = SystemSetting._meta.get_field(key)
        choices = metadata.get("options")
        if choices is None:
            choices = [
                {"value": value, "label": label}
                for value, label in (field.choices or [])
            ]
        default = field.default() if callable(field.default) else field.default
        definitions.append(
            {
                "key": key,
                "label": metadata["label"],
                "type": metadata["type"],
                "section": metadata["section"],
                "default": default,
                "options": choices,
                "help_text": metadata["help_text"],
            }
        )
    return definitions


def get_local_account_security_policy(setting=None) -> dict[str, int]:
    setting = setting or get_system_settings()
    return {
        "password_min_length": int(setting.password_min_length),
        "password_expiry_days": int(setting.password_expiry_days),
        "login_max_attempts": int(setting.login_max_attempts),
        "login_window_seconds": int(setting.login_window_seconds),
        "login_lock_seconds": int(setting.login_lock_seconds),
    }


def validate_local_password(password: str, *, user=None) -> None:
    """Apply the configured local-account policy plus Django validators."""

    policy = get_local_account_security_policy()
    if len(password) < policy["password_min_length"]:
        raise DjangoValidationError(
            f"密码至少需要 {policy['password_min_length']} 位"
        )
    validate_password(password, user=user)


def local_password_expired(user, *, profile=None, setting=None, now=None) -> bool:
    """Return whether a local account must rotate an expired password.

    Directory identities are intentionally excluded: their directory service
    remains authoritative for password lifetime and complexity.
    """

    if not user or not getattr(user, "pk", None):
        return False
    if DirectoryIdentity.objects.filter(user_id=user.pk).exists():
        return False
    policy = get_local_account_security_policy(setting)
    expiry_days = policy["password_expiry_days"]
    if expiry_days <= 0:
        return False
    profile = profile or UserSecurityProfile.objects.filter(user_id=user.pk).first()
    if profile is None:
        return False
    if profile.password_changed_at is None:
        return True
    current_time = now or django_timezone.now()
    return profile.password_changed_at + timedelta(days=expiry_days) <= current_time
