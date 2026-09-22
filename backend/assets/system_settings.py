"""Typed, database-backed system administration settings.

The singleton model is the source of truth for values editable by a system
administrator. Deployment-owned credentials and the encryption key remain
environment configuration and never cross the API boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Mapping

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone as django_timezone

from .audit import write_audit_log
from .configuration_secrets import encrypt_secret
from .models import DirectoryIdentity, SystemSetting, UserSecurityProfile
from .runtime_clock import system_timezone_name


SETTING_METADATA = {
    "email_digest_enabled": {"label": "启用每日邮件摘要", "type": "boolean", "section": "notifications", "help_text": "显式启用后，通过定时任务发送当前已启用的业务提醒。"},
    "email_digest_people": {"label": "摘要人员", "type": "people", "section": "notifications", "help_text": "从人员目录中选择最多 20 名启用且已配置邮箱的人员。"},
    "email_digest_recipients": {"label": "其他收件邮箱", "type": "emails", "section": "notifications", "help_text": "可填写公共邮箱等非人员地址；与摘要人员合计最多 20 个收件地址。"},
    "application_url": {"label": "应用访问地址", "type": "string", "section": "notifications", "help_text": "邮件中的链接使用此 HTTPS 地址。"},
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
        "section": "general",
        "help_text": "新用户和未设置个人语言偏好的会话使用此语言；用户个人设置优先。",
    },
    "date_format": {
        "label": "日期格式",
        "type": "enum",
        "section": "general",
        "help_text": "影响日期和日期时间在界面中的展示格式。",
    },
    "currency": {
        "label": "默认币种",
        "type": "enum",
        "section": "general",
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
RESET_SETTING_KEYS = (
    *PUBLIC_SETTING_KEYS,
    "smtp_password_encrypted",
)

GENERAL_SETTING_KEYS = (
    "default_page_size",
    "default_asset_status",
    "default_locale",
    "date_format",
    "currency",
)
SECURITY_SETTING_KEYS = (
    "password_min_length",
    "password_expiry_days",
    "login_max_attempts",
    "login_window_seconds",
    "login_lock_seconds",
)
SMTP_SETTING_KEYS = (
    "smtp_enabled",
    "smtp_host",
    "smtp_port",
    "smtp_security_mode",
    "smtp_username",
    "smtp_from_email",
    "smtp_from_name",
    "smtp_timeout",
)
SMTP_PATCH_TO_MODEL = {
    "enabled": "smtp_enabled",
    "host": "smtp_host",
    "port": "smtp_port",
    "security_mode": "smtp_security_mode",
    "username": "smtp_username",
    "from_email": "smtp_from_email",
    "from_name": "smtp_from_name",
    "timeout": "smtp_timeout",
}
IN_APP_NOTIFICATION_KEYS = (
    "notify_maintenance",
    "maintenance_expiry_days",
    "notify_license_expiry",
    "license_expiry_days",
    "notify_open_faults",
    "notify_overdue_inventory",
    "notify_low_spare_stock",
)
EMAIL_DIGEST_KEYS = (
    "email_digest_enabled",
    "email_digest_people",
    "email_digest_recipients",
    "application_url",
)
SETTING_GROUP_KEYS = {
    "general": GENERAL_SETTING_KEYS,
    "security": SECURITY_SETTING_KEYS,
    "smtp": SMTP_SETTING_KEYS,
    "notifications.in_app": IN_APP_NOTIFICATION_KEYS,
    "notifications.email_digest": EMAIL_DIGEST_KEYS,
}


@dataclass(frozen=True)
class RuntimePreferences:
    default_page_size: int
    default_asset_status: str
    default_locale: str
    date_format: str
    currency: str


@dataclass(frozen=True)
class SystemSettingsData:
    """Immutable read model exposed outside the settings persistence module."""

    default_page_size: int
    default_asset_status: str
    default_locale: str
    date_format: str
    currency: str
    password_min_length: int
    password_expiry_days: int
    login_max_attempts: int
    login_window_seconds: int
    login_lock_seconds: int
    smtp_enabled: bool
    smtp_host: str
    smtp_port: int
    smtp_security_mode: str
    smtp_username: str
    smtp_password_encrypted: str
    smtp_from_email: str
    smtp_from_name: str
    smtp_timeout: int
    notify_maintenance: bool
    maintenance_expiry_days: int
    notify_license_expiry: bool
    license_expiry_days: int
    notify_open_faults: bool
    notify_overdue_inventory: bool
    notify_low_spare_stock: bool
    branding_display_name: str
    branding_logo: bytes
    branding_compact_logo: bytes
    branding_favicon: bytes
    email_digest_enabled: bool
    email_digest_people: tuple[int, ...]
    email_digest_recipients: tuple[str, ...]
    application_url: str


@dataclass(frozen=True)
class LocalAuthPolicy:
    password_min_length: int
    password_expiry_days: int
    login_max_attempts: int
    login_window_seconds: int
    login_lock_seconds: int


@dataclass(frozen=True)
class NotificationPolicy:
    notify_maintenance: bool
    maintenance_expiry_days: int
    notify_license_expiry: bool
    license_expiry_days: int
    notify_open_faults: bool
    notify_overdue_inventory: bool
    notify_low_spare_stock: bool
    email_digest_enabled: bool
    email_digest_people: tuple[int, ...]
    email_digest_recipients: tuple[str, ...]
    application_url: str
    default_locale: str
    branding_display_name: str


class SystemSettingsValidationError(Exception):
    """Safe nested field errors raised by the settings write interface."""

    def __init__(self, detail: Mapping[str, Any]):
        super().__init__("system settings validation failed")
        self.detail = detail


def _deployment_defaults() -> dict[str, object]:
    language_code = str(getattr(settings, "LANGUAGE_CODE", "zh-hans") or "zh-hans").lower()
    return {
        "default_locale": "en-US" if language_code.startswith("en") else "zh-CN",
        "login_max_attempts": max(1, int(getattr(settings, "AUTH_LOGIN_MAX_ATTEMPTS", 5))),
        "login_window_seconds": max(1, int(getattr(settings, "AUTH_LOGIN_WINDOW_SECONDS", 900))),
        "login_lock_seconds": max(1, int(getattr(settings, "AUTH_LOGIN_LOCK_SECONDS", 900))),
    }


def ensure_system_settings() -> SystemSetting:
    """Create the singleton explicitly when application bootstrap needs it."""

    return SystemSetting.objects.get_or_create(
        pk=SystemSetting.SINGLETON_ID,
        defaults=_deployment_defaults(),
    )[0]


_READ_MODEL_FIELDS = (
    *GENERAL_SETTING_KEYS,
    *SECURITY_SETTING_KEYS,
    *SMTP_SETTING_KEYS,
    "smtp_password_encrypted",
    "branding_display_name",
    "branding_logo",
    "branding_compact_logo",
    "branding_favicon",
    *IN_APP_NOTIFICATION_KEYS,
    *EMAIL_DIGEST_KEYS,
)


def _read_model_from_row(setting: SystemSetting) -> SystemSettingsData:
    values = {key: getattr(setting, key) for key in _READ_MODEL_FIELDS}
    values["email_digest_people"] = tuple(values["email_digest_people"] or [])
    values["email_digest_recipients"] = tuple(values["email_digest_recipients"] or [])
    values["branding_logo"] = bytes(values["branding_logo"] or b"")
    values["branding_compact_logo"] = bytes(values["branding_compact_logo"] or b"")
    values["branding_favicon"] = bytes(values["branding_favicon"] or b"")
    return SystemSettingsData(**values)


def read_system_settings() -> SystemSettingsData:
    """Read the singleton without creating database state as a side effect.

    A transient default instance keeps pre-bootstrap read paths usable while
    leaving creation to ``ensure_system_settings``.
    """

    try:
        setting = SystemSetting.objects.get(pk=SystemSetting.SINGLETON_ID)
    except SystemSetting.DoesNotExist:
        setting = SystemSetting(pk=SystemSetting.SINGLETON_ID)
        for key, value in _deployment_defaults().items():
            setattr(setting, key, value)
    return _read_model_from_row(setting)


def _values(setting, keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: getattr(setting, key) for key in keys}


def get_runtime_preferences(setting: SystemSettingsData | SystemSetting | None = None) -> RuntimePreferences:
    setting = setting or read_system_settings()
    values = _values(setting, GENERAL_SETTING_KEYS)
    return RuntimePreferences(**values)


def get_local_auth_policy(setting: SystemSettingsData | SystemSetting | None = None) -> LocalAuthPolicy:
    setting = setting or read_system_settings()
    values = _values(setting, SECURITY_SETTING_KEYS)
    return LocalAuthPolicy(**{key: int(value) for key, value in values.items()})


def get_notification_policy(setting: SystemSettingsData | SystemSetting | None = None) -> NotificationPolicy:
    setting = setting or read_system_settings()
    values = _values(setting, IN_APP_NOTIFICATION_KEYS + EMAIL_DIGEST_KEYS)
    return NotificationPolicy(
        **{key: values[key] for key in IN_APP_NOTIFICATION_KEYS},
        email_digest_enabled=bool(values["email_digest_enabled"]),
        email_digest_people=tuple(int(value) for value in (values["email_digest_people"] or [])),
        email_digest_recipients=tuple(str(value) for value in (values["email_digest_recipients"] or [])),
        application_url=str(values["application_url"] or ""),
        default_locale=str(getattr(setting, "default_locale", "zh-CN") or "zh-CN"),
        branding_display_name=str(getattr(setting, "branding_display_name", "infrix") or "infrix"),
    )


def system_settings_snapshot(setting: SystemSettingsData | SystemSetting | None = None) -> dict[str, Any]:
    """Return a flat audit-safe snapshot for changed-field comparisons."""

    setting = setting or read_system_settings()
    return {
        key: getattr(setting, key)
        for key in PUBLIC_SETTING_KEYS
    } | {
        "smtp_password_configured": bool(setting.smtp_password_encrypted),
    }


def get_system_settings_snapshot(setting: SystemSettingsData | SystemSetting | None = None) -> dict[str, Any]:
    """Return the grouped, secret-safe HTTP snapshot."""

    setting = setting or read_system_settings()
    return {
        "schema_version": 2,
        "general": _values(setting, GENERAL_SETTING_KEYS),
        "security": _values(setting, SECURITY_SETTING_KEYS),
        "smtp": {
            "enabled": setting.smtp_enabled,
            "host": setting.smtp_host,
            "port": setting.smtp_port,
            "security_mode": setting.smtp_security_mode,
            "username": setting.smtp_username,
            "from_email": setting.smtp_from_email,
            "from_name": setting.smtp_from_name,
            "timeout": setting.smtp_timeout,
            "password_configured": bool(setting.smtp_password_encrypted),
        },
        "notifications": {
            "in_app": _values(setting, IN_APP_NOTIFICATION_KEYS),
            "email_digest": _values(setting, EMAIL_DIGEST_KEYS),
        },
        "runtime": {"timezone": system_timezone_name()},
        "definitions": system_setting_definitions(),
    }


def _flatten_system_settings_patch(patch: Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    values: dict[str, Any] = {}
    for group, fields in (("general", patch.get("general")), ("security", patch.get("security"))):
        if fields:
            values.update(fields)
    smtp = patch.get("smtp") or {}
    for key, value in smtp.items():
        if key == "password":
            continue
        values[SMTP_PATCH_TO_MODEL[key]] = value
    notifications = patch.get("notifications") or {}
    values.update(notifications.get("in_app") or {})
    values.update(notifications.get("email_digest") or {})
    return values, str(smtp.get("password") or "")


def _validate_candidate_values(
    values: Mapping[str, Any],
    *,
    smtp_password: str,
    current: SystemSetting,
) -> None:
    people = values.get("email_digest_people") or []
    recipients = values.get("email_digest_recipients") or []
    if len(people) + len(recipients) > 20:
        raise SystemSettingsValidationError({"notifications": {"email_digest": {"email_digest_people": ["摘要人员和其他收件邮箱合计不能超过 20 个"]}}})
    if values.get("email_digest_enabled"):
        errors = {}
        if not people and not recipients:
            errors["email_digest_recipients"] = "启用邮件摘要前必须配置收件人"
        application_url = str(values.get("application_url") or "")
        if not application_url:
            errors["application_url"] = "启用邮件摘要前必须配置应用访问地址"
        else:
            from urllib.parse import urlsplit

            parsed = urlsplit(application_url)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
            ):
                errors["application_url"] = "请输入不含账号、查询参数或片段的 HTTPS 应用地址"
        if errors:
            raise SystemSettingsValidationError({"notifications": {"email_digest": {key: [value] for key, value in errors.items()}}})
    password_configured = bool(smtp_password) or bool(current.smtp_password_encrypted)
    if values.get("smtp_enabled"):
        errors = {}
        if not str(values.get("smtp_host") or "").strip():
            errors["host"] = "启用 SMTP 前必须填写服务端"
        if not str(values.get("smtp_from_email") or "").strip():
            errors["from_email"] = "启用 SMTP 前必须填写发件人邮箱"
        username_configured = bool(str(values.get("smtp_username") or "").strip())
        if username_configured and not password_configured:
            errors["password"] = "已填写 SMTP 用户名，请配置密码"
        if password_configured and not username_configured:
            errors["username"] = "配置 SMTP 密码前必须填写用户名"
        if errors:
            raise SystemSettingsValidationError({"smtp": {key: [value] for key, value in errors.items()}})


def apply_system_settings_patch(
    patch: Mapping[str, Any],
    *,
    actor=None,
    request=None,
) -> dict[str, Any]:
    """Apply one or more settings groups atomically and return a full snapshot."""

    with transaction.atomic():
        try:
            setting = SystemSetting.objects.select_for_update().get(pk=SystemSetting.SINGLETON_ID)
        except SystemSetting.DoesNotExist as exc:
            raise SystemSettingsValidationError({"detail": ["系统参数尚未初始化"]}) from exc
        before = system_settings_snapshot(setting)
        values, smtp_password = _flatten_system_settings_patch(patch)
        candidate = {key: getattr(setting, key) for key in PUBLIC_SETTING_KEYS}
        candidate.update(values)
        _validate_candidate_values(candidate, smtp_password=smtp_password, current=setting)
        changed_fields = [
            key for key in values
            if getattr(setting, key) != values[key]
        ]
        storage_fields = list(changed_fields)
        if values:
            for key, value in values.items():
                setattr(setting, key, value)
        if smtp_password:
            encrypted = encrypt_secret(smtp_password, field_name="SMTP 密码")
            if encrypted != setting.smtp_password_encrypted:
                setting.smtp_password_encrypted = encrypted
                changed_fields.append("smtp_password")
                storage_fields.append("smtp_password_encrypted")
        if changed_fields:
            setting.save(update_fields=[*sorted(set(storage_fields)), "updated_at"])
            after = system_settings_snapshot(setting)
            write_audit_log(
                request,
                actor=actor,
                action="update",
                resource_type="system_settings",
                resource_id="system",
                before=before,
                after=after,
                extra={"changed_fields": sorted(set(changed_fields))},
            )
    return get_system_settings_snapshot(setting)


def _branding_audit_snapshot(setting: SystemSetting) -> dict[str, Any]:
    """Return a safe branding snapshot without retaining image bytes in audit."""

    import hashlib

    images = {}
    for kind in ("logo", "compact_logo", "favicon"):
        value = bytes(getattr(setting, f"branding_{kind}") or b"")
        images[kind] = {
            "configured": bool(value),
            "sha256": hashlib.sha256(value).hexdigest() if value else None,
        }
    return {
        "display_name": setting.branding_display_name,
        "images": images,
    }


def apply_branding_patch(
    values: Mapping[str, Any],
    *,
    reset: bool = False,
    audit: bool = True,
    actor=None,
    request=None,
) -> SystemSettingsData:
    """Persist branding through the settings module without exposing its ORM row."""

    allowed = {"display_name", "logo", "compact_logo", "favicon"}
    unknown = set(values) - allowed
    if unknown:
        raise SystemSettingsValidationError({key: ["不支持的品牌设置字段"] for key in sorted(unknown)})

    with transaction.atomic():
        setting = SystemSetting.objects.select_for_update().get(pk=SystemSetting.SINGLETON_ID)
        before = _branding_audit_snapshot(setting)
        fields: list[str] = []
        if reset:
            setting.branding_display_name = "infrix"
            fields.append("branding_display_name")
            for kind in ("logo", "compact_logo", "favicon"):
                setattr(setting, f"branding_{kind}", b"")
                fields.append(f"branding_{kind}")
        else:
            for key in ("display_name", "logo", "compact_logo", "favicon"):
                if key in values:
                    setattr(setting, f"branding_{key}", values[key])
                    fields.append(f"branding_{key}")
        if fields:
            setting.save(update_fields=[*fields, "updated_at"])
            if audit:
                write_audit_log(
                    request,
                    actor=actor,
                    action="branding_reset" if reset else "branding_updated",
                    resource_type="system_settings",
                    resource_id="branding",
                    before=before,
                    after=_branding_audit_snapshot(setting),
                )
        return _read_model_from_row(setting)


def reset_system_settings():
    """Restore grouped system-setting defaults and remove the stored SMTP secret."""

    setting = ensure_system_settings()
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
    return read_system_settings()


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


def validate_local_password(password: str, *, user=None) -> None:
    """Apply the configured local-account policy plus Django validators."""

    policy = get_local_auth_policy()
    if len(password) < policy.password_min_length:
        raise DjangoValidationError(
            f"密码至少需要 {policy.password_min_length} 位"
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
    policy = get_local_auth_policy(setting)
    expiry_days = policy.password_expiry_days
    if expiry_days <= 0:
        return False
    profile = profile or UserSecurityProfile.objects.filter(user_id=user.pk).first()
    if profile is None:
        return False
    if profile.password_changed_at is None:
        return True
    current_time = now or django_timezone.now()
    return profile.password_changed_at + timedelta(days=expiry_days) <= current_time
