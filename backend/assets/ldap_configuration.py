"""Database-backed LDAP configuration and secret boundary.

The singleton database row is the only runtime source for LDAP configuration.
Fresh installations start disabled and can be configured from the administrator
UI.  The deployment environment supplies only the encryption key used for
stored bind secrets.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
import re
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import transaction

from .models import DirectoryIdentity, DirectoryServiceConfiguration


DIRECTORY_TYPE_ACTIVE_DIRECTORY = "active_directory"
DIRECTORY_TYPE_GENERIC_LDAP = "generic_ldap"
SECURITY_MODE_LDAPS = "ldaps"
SECURITY_MODE_STARTTLS = "starttls"
SECURITY_MODE_NONE = "none"

DIRECTORY_TYPE_CHOICES = (
    DIRECTORY_TYPE_ACTIVE_DIRECTORY,
    DIRECTORY_TYPE_GENERIC_LDAP,
)
SECURITY_MODE_CHOICES = (
    SECURITY_MODE_LDAPS,
    SECURITY_MODE_STARTTLS,
    SECURITY_MODE_NONE,
)
ATTRIBUTE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9-]*$")

DEFAULT_DIRECTORY_VALUES = {
    DIRECTORY_TYPE_ACTIVE_DIRECTORY: {
        "user_login_attribute": "sAMAccountName",
        "external_id_attribute": "objectGUID",
        "user_filter": "(&(objectClass=user)(sAMAccountName={username}))",
        "account_control_attribute": "userAccountControl",
    },
    DIRECTORY_TYPE_GENERIC_LDAP: {
        "user_login_attribute": "uid",
        "external_id_attribute": "entryUUID",
        "user_filter": "(&(objectClass=inetOrgPerson)(uid={username}))",
        "account_control_attribute": "",
    },
}
DIRECTORY_PROVIDER = "ldap"
AD_STABLE_ID_ATTRIBUTE = "objectGUID"


class ConfigurationSecretError(Exception):
    """Raised when the deployment key cannot decrypt a stored secret."""


class ConfigurationIdentityError(Exception):
    """Raised when a change would invalidate persisted directory identities."""

    def __init__(self, errors: dict[str, str]):
        super().__init__("directory identity anchor cannot be changed")
        self.errors = errors


@dataclass(frozen=True)
class EffectiveLDAPConfiguration:
    enabled: bool = False
    directory_type: str = DIRECTORY_TYPE_GENERIC_LDAP
    primary_host: str = ""
    primary_port: int | None = None
    secondary_host: str = ""
    secondary_port: int | None = None
    base_dn: str = ""
    bind_dn: str = ""
    bind_password: str = ""
    password_configured: bool = False
    secret_available: bool = True
    secret_error: str | None = None
    security_mode: str = SECURITY_MODE_LDAPS
    tls_server_name: str = ""
    ca_cert_file: str = ""
    user_search_base: str = ""
    user_login_attribute: str = "uid"
    user_filter: str = "(&(objectClass=inetOrgPerson)(uid={username}))"
    external_id_attribute: str = "entryUUID"
    email_attribute: str = "mail"
    first_name_attribute: str = "givenName"
    last_name_attribute: str = "sn"
    account_control_attribute: str = ""
    connect_timeout: int = 5
    operation_timeout: int = 5
    source: str = "default"

    @property
    def effective_user_search_base(self) -> str:
        return self.user_search_base or self.base_dn

    @property
    def endpoints(self) -> tuple[tuple[str, str, int | None], ...]:
        values = [("primary", self.primary_host, self.primary_port)]
        if self.secondary_host or self.secondary_port is not None:
            values.append(("secondary", self.secondary_host, self.secondary_port))
        return tuple(values)


def _as_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _as_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _fernet() -> Fernet:
    key = _as_text(getattr(settings, "INFRIX_CONFIG_ENCRYPTION_KEY", ""))
    if not key:
        raise ConfigurationSecretError("configuration encryption key is not configured")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError) as exc:
        raise ConfigurationSecretError("configuration encryption key is invalid") from exc


def encrypt_bind_password(password: str) -> str:
    if not password:
        return ""
    try:
        return _fernet().encrypt(password.encode("utf-8")).decode("ascii")
    except UnicodeEncodeError as exc:
        raise ConfigurationSecretError("bind password is not valid UTF-8") from exc


def _decrypt_bind_password(token: str) -> tuple[str, bool, str | None]:
    if not token:
        return "", False, None
    try:
        value = _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (ConfigurationSecretError, InvalidToken, UnicodeDecodeError, UnicodeEncodeError):
        return "", True, "secret_unavailable"
    return value, True, None


def _from_record(record: DirectoryServiceConfiguration) -> EffectiveLDAPConfiguration:
    password, password_configured, secret_error = _decrypt_bind_password(
        record.bind_password_encrypted
    )
    return EffectiveLDAPConfiguration(
        enabled=record.enabled,
        directory_type=record.directory_type,
        primary_host=record.primary_host,
        primary_port=record.primary_port,
        secondary_host=record.secondary_host,
        secondary_port=record.secondary_port,
        base_dn=record.base_dn,
        bind_dn=record.bind_dn,
        bind_password=password,
        password_configured=password_configured,
        secret_available=secret_error is None,
        secret_error=secret_error,
        security_mode=record.security_mode,
        tls_server_name=record.tls_server_name,
        ca_cert_file=record.ca_cert_file,
        user_search_base=record.user_search_base,
        user_login_attribute=record.user_login_attribute,
        user_filter=record.user_filter,
        external_id_attribute=record.external_id_attribute,
        email_attribute=record.email_attribute,
        first_name_attribute=record.first_name_attribute,
        last_name_attribute=record.last_name_attribute,
        account_control_attribute=record.account_control_attribute,
        connect_timeout=record.connect_timeout,
        operation_timeout=record.operation_timeout,
        source="database",
    )


def get_configuration_record() -> DirectoryServiceConfiguration | None:
    return DirectoryServiceConfiguration.objects.order_by("id").first()


def get_effective_ldap_configuration() -> EffectiveLDAPConfiguration:
    record = get_configuration_record()
    return _from_record(record) if record is not None else EffectiveLDAPConfiguration()


def _candidate_value(current: EffectiveLDAPConfiguration, changes: dict[str, Any], name: str):
    if name not in changes:
        return getattr(current, name)
    value = changes[name]
    if isinstance(value, str):
        return value.strip()
    return value


def merge_configuration(
    current: EffectiveLDAPConfiguration,
    changes: dict[str, Any],
    *,
    password_submitted: bool = False,
    password_value: str = "",
) -> EffectiveLDAPConfiguration:
    directory_type = _candidate_value(current, changes, "directory_type")
    values = {
        name: _candidate_value(current, changes, name)
        for name in (
            "enabled",
            "primary_host",
            "primary_port",
            "secondary_host",
            "secondary_port",
            "base_dn",
            "bind_dn",
            "security_mode",
            "tls_server_name",
            "ca_cert_file",
            "user_search_base",
            "user_login_attribute",
            "user_filter",
            "external_id_attribute",
            "email_attribute",
            "first_name_attribute",
            "last_name_attribute",
            "account_control_attribute",
            "connect_timeout",
            "operation_timeout",
        )
    }
    values["directory_type"] = directory_type
    if "directory_type" in changes and directory_type != current.directory_type:
        defaults = DEFAULT_DIRECTORY_VALUES.get(directory_type, {})
        previous_defaults = DEFAULT_DIRECTORY_VALUES.get(current.directory_type, {})
        for field in ("user_login_attribute", "user_filter", "external_id_attribute", "account_control_attribute"):
            if field not in changes and (
                directory_type == DIRECTORY_TYPE_ACTIVE_DIRECTORY
                or not getattr(current, field)
                or getattr(current, field) == previous_defaults.get(field)
            ):
                values[field] = defaults.get(field, values[field])
    if password_submitted and password_value:
        values["bind_password"] = password_value
        values["password_configured"] = True
        values["secret_available"] = True
        values["secret_error"] = None
    else:
        values["bind_password"] = current.bind_password
        values["password_configured"] = current.password_configured
        values["secret_available"] = current.secret_available
        values["secret_error"] = current.secret_error
    values["source"] = current.source
    return EffectiveLDAPConfiguration(**values)


def configuration_errors(
    config: EffectiveLDAPConfiguration,
    *,
    require_password: bool = False,
) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not config.primary_host:
        errors["primary_host"] = "主 LDAP 服务端不能为空"
    elif any(char in config.primary_host for char in "/?#") or "://" in config.primary_host:
        errors["primary_host"] = "服务端只填写主机名或 IP，不要包含协议和路径"
    if config.primary_port is None or not 1 <= int(config.primary_port) <= 65535:
        errors["primary_port"] = "主服务端口必须在 1 到 65535 之间"
    if bool(config.secondary_host) != (config.secondary_port is not None):
        errors["secondary_host"] = "备用服务端和端口必须同时填写"
        errors["secondary_port"] = "备用服务端和端口必须同时填写"
    if config.secondary_host and (
        any(char in config.secondary_host for char in "/?#")
        or "://" in config.secondary_host
    ):
        errors["secondary_host"] = "服务端只填写主机名或 IP，不要包含协议和路径"
    if config.secondary_port is not None and not 1 <= int(config.secondary_port) <= 65535:
        errors["secondary_port"] = "备用服务端口必须在 1 到 65535 之间"
    if config.directory_type not in DIRECTORY_TYPE_CHOICES:
        errors["directory_type"] = "目录类型不受支持"
    if (
        config.directory_type == DIRECTORY_TYPE_ACTIVE_DIRECTORY
        and config.external_id_attribute.casefold() != AD_STABLE_ID_ATTRIBUTE.casefold()
    ):
        errors["external_id_attribute"] = "Microsoft Active Directory 必须使用 objectGUID 作为外部身份属性"
    if not config.base_dn:
        errors["base_dn"] = "Base DN 不能为空"
    if not config.bind_dn:
        errors["bind_dn"] = "绑定账户不能为空"
    if config.security_mode not in SECURITY_MODE_CHOICES:
        errors["security_mode"] = "安全模式不受支持"
    if not config.user_login_attribute or not ATTRIBUTE_PATTERN.fullmatch(config.user_login_attribute):
        errors["user_login_attribute"] = "登录属性必须是合法 LDAP 属性名"
    if not config.external_id_attribute or not ATTRIBUTE_PATTERN.fullmatch(config.external_id_attribute):
        errors["external_id_attribute"] = "外部身份属性必须是合法 LDAP 属性名"
    if not config.user_filter or config.user_filter.count("{username}") != 1:
        errors["user_filter"] = "用户过滤器必须包含且只能包含一个 {username}"
    elif "{" in config.user_filter.replace("{username}", "") or "}" in config.user_filter.replace("{username}", ""):
        errors["user_filter"] = "用户过滤器只允许使用 {username} 占位符"
    for field in (
        "email_attribute",
        "first_name_attribute",
        "last_name_attribute",
        "account_control_attribute",
    ):
        value = getattr(config, field)
        if value and not ATTRIBUTE_PATTERN.fullmatch(value):
            errors[field] = "必须是合法 LDAP 属性名"
    if config.connect_timeout is None or int(config.connect_timeout) <= 0:
        errors["connect_timeout"] = "连接超时必须为正整数"
    if config.operation_timeout is None or int(config.operation_timeout) <= 0:
        errors["operation_timeout"] = "操作超时必须为正整数"
    if config.ca_cert_file and (
        not os.path.isfile(config.ca_cert_file) or not os.access(config.ca_cert_file, os.R_OK)
    ):
        errors["ca_cert_file"] = "CA 证书文件不可读"
    if config.secret_error and (require_password or config.enabled):
        errors["bind_password"] = "无法读取已保存的绑定密码，请重新输入并保存"
    elif require_password and not config.bind_password:
        errors["bind_password"] = "请配置绑定账户密码"
    return errors


def stable_identity_attribute(config: EffectiveLDAPConfiguration) -> str:
    """Return the persisted identity anchor semantics for a directory config."""
    if config.directory_type == DIRECTORY_TYPE_ACTIVE_DIRECTORY:
        return AD_STABLE_ID_ATTRIBUTE
    return config.external_id_attribute


def directory_identity_count() -> int:
    return DirectoryIdentity.objects.filter(provider=DIRECTORY_PROVIDER).count()


def identity_anchor_errors(
    current: EffectiveLDAPConfiguration,
    candidate: EffectiveLDAPConfiguration,
    *,
    identity_count: int | None = None,
) -> dict[str, str]:
    """Prevent config changes that would make existing identity links unreachable."""
    errors: dict[str, str] = {}
    if candidate.directory_type == DIRECTORY_TYPE_ACTIVE_DIRECTORY:
        if candidate.external_id_attribute.casefold() != AD_STABLE_ID_ATTRIBUTE.casefold():
            errors["external_id_attribute"] = "Microsoft Active Directory 必须使用 objectGUID 作为外部身份属性"
    if identity_count is None:
        identity_count = directory_identity_count()
    if identity_count <= 0:
        return errors
    if current.directory_type != candidate.directory_type:
        errors["directory_type"] = "已有目录身份绑定，目录类型不可直接修改"
    elif stable_identity_attribute(current).casefold() != stable_identity_attribute(candidate).casefold():
        errors["external_id_attribute"] = "已有目录身份绑定，外部身份属性不可直接修改"
    return errors


def public_configuration(config: EffectiveLDAPConfiguration) -> dict[str, Any]:
    errors = configuration_errors(config, require_password=bool(config.enabled))
    if config.secret_error:
        errors["bind_password"] = "无法读取已保存的绑定密码，请重新输入并保存"
    identity_count = directory_identity_count()
    return {
        "enabled": config.enabled,
        "directory_type": config.directory_type,
        "primary_host": config.primary_host,
        "primary_port": config.primary_port,
        "secondary_host": config.secondary_host,
        "secondary_port": config.secondary_port,
        "base_dn": config.base_dn,
        "bind_dn": config.bind_dn,
        "bind_password_configured": config.password_configured,
        "secret_available": config.secret_available,
        "secret_error": bool(config.secret_error),
        "security_mode": config.security_mode,
        "tls_server_name": config.tls_server_name,
        "ca_cert_file": config.ca_cert_file,
        "user_search_base": config.user_search_base,
        "user_login_attribute": config.user_login_attribute,
        "user_filter": config.user_filter,
        "external_id_attribute": config.external_id_attribute,
        "email_attribute": config.email_attribute,
        "first_name_attribute": config.first_name_attribute,
        "last_name_attribute": config.last_name_attribute,
        "account_control_attribute": config.account_control_attribute,
        "connect_timeout": config.connect_timeout,
        "operation_timeout": config.operation_timeout,
        "directory_identity_count": identity_count,
        "identity_anchor_locked": identity_count > 0,
        "identity_anchor_attribute": stable_identity_attribute(config),
        "source": config.source,
        "configured": not errors,
        "configuration_errors": errors,
    }


def save_configuration(
    candidate: EffectiveLDAPConfiguration,
    *,
    password_submitted: bool,
    password_value: str,
) -> DirectoryServiceConfiguration:
    current_record = get_configuration_record()
    encrypted_password = current_record.bind_password_encrypted if current_record else ""
    if password_submitted and password_value:
        encrypted_password = encrypt_bind_password(password_value)

    field_values = {
        field: getattr(candidate, field)
        for field in (
            "enabled",
            "directory_type",
            "primary_host",
            "primary_port",
            "secondary_host",
            "secondary_port",
            "base_dn",
            "bind_dn",
            "security_mode",
            "tls_server_name",
            "ca_cert_file",
            "user_search_base",
            "user_login_attribute",
            "user_filter",
            "external_id_attribute",
            "email_attribute",
            "first_name_attribute",
            "last_name_attribute",
            "account_control_attribute",
            "connect_timeout",
            "operation_timeout",
        )
    }
    field_values["bind_password_encrypted"] = encrypted_password
    with transaction.atomic():
        record = (
            DirectoryServiceConfiguration.objects.select_for_update().filter(pk=1).first()
        )
        persisted_configuration = _from_record(record) if record is not None else candidate
        identity_errors = identity_anchor_errors(persisted_configuration, candidate)
        if identity_errors:
            raise ConfigurationIdentityError(identity_errors)
        if record is None:
            record = DirectoryServiceConfiguration(pk=1, **field_values)
        else:
            for field, value in field_values.items():
                setattr(record, field, value)
        record.save()
    return record
