"""Explicit local/LDAP authentication and JIT provisioning boundary."""

from __future__ import annotations

from dataclasses import dataclass
import logging
import socket
import ssl
from typing import Any, Callable
from uuid import UUID

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.utils import timezone
from ldap3 import ALL, BASE, Connection, Server, SUBTREE, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from .ldap_configuration import (
    EffectiveLDAPConfiguration,
    configuration_errors,
    get_effective_ldap_configuration,
)
from .models import DirectoryIdentity, UserSecurityProfile


logger = logging.getLogger(__name__)

AUTH_SOURCE_LOCAL = "local"
AUTH_SOURCE_LDAP = "ldap"
LDAP_PROVIDER = "ldap"
AD_ACCOUNT_DISABLED = 0x0002
LDAP_MODEL_BACKEND = "django.contrib.auth.backends.ModelBackend"
LDAP_DIAGNOSTIC_CODES = frozenset({
    "disabled",
    "configuration_error",
    "connection_error",
    "timeout",
    "tls_error",
    "bind_error",
    "search_error",
    "unexpected_error",
})
LDAP_DIAGNOSTIC_MESSAGES = {
    "disabled": "LDAP 集成未启用",
    "configuration_error": "LDAP 配置不完整或不一致",
    "connection_error": "无法连接 LDAP 服务",
    "timeout": "LDAP 服务响应超时",
    "tls_error": "LDAP TLS 校验失败",
    "bind_error": "LDAP 服务账号认证失败",
    "search_error": "LDAP 受控查询失败",
    "unexpected_error": "LDAP 诊断失败，请查看服务端日志",
}
LDAP_DIAGNOSTIC_CHECKS = (
    "configuration",
    "connection",
    "tls",
    "service_bind",
    "search",
)


class AuthenticationFailure(Exception):
    """A safe authentication failure that the login endpoint can classify."""

    def __init__(
        self,
        reason="invalid_credentials",
        *,
        infrastructure=False,
        actor=None,
        auth_source=None,
        throttle=True,
    ):
        super().__init__(reason)
        self.reason = reason
        self.infrastructure = infrastructure
        self.actor = actor
        self.auth_source = auth_source
        self.throttle = throttle


class LDAPCredentialFailure(AuthenticationFailure):
    def __init__(self, reason="invalid_credentials", *, actor=None, throttle=None):
        if throttle is None:
            throttle = reason == "invalid_credentials"
        super().__init__(
            reason,
            actor=actor,
            auth_source=AUTH_SOURCE_LDAP,
            throttle=throttle,
        )


class LDAPInfrastructureFailure(AuthenticationFailure):
    def __init__(self, reason="ldap_unavailable", *, actor=None, retryable=False):
        super().__init__(
            reason,
            infrastructure=True,
            actor=actor,
            auth_source=AUTH_SOURCE_LDAP,
            throttle=False,
        )
        self.retryable = retryable


class LDAPDiagnosticFailure(Exception):
    """Internal, safe classification for a staged LDAP diagnostic."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code if code in LDAP_DIAGNOSTIC_CODES else "unexpected_error"


@dataclass(frozen=True)
class LDAPDiagnosticResult:
    success: bool
    stage: str
    checks: tuple[dict[str, str], ...]
    code: str | None = None
    message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "success": self.success,
            "stage": self.stage,
            "checks": list(self.checks),
        }
        if self.code:
            payload["code"] = self.code
        if self.message:
            payload["message"] = self.message
        return payload


@dataclass(frozen=True)
class DirectoryUser:
    external_id: str
    login_identifier: str
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    directory_disabled: bool = False


@dataclass(frozen=True)
class AuthenticationResult:
    user: User
    auth_source: str


@dataclass(frozen=True)
class AuthenticationRoute:
    source: str
    user: User | None = None
    identity: DirectoryIdentity | None = None


def normalize_external_id(value: Any, attribute: str = "objectGUID") -> str:
    """Return one stable textual representation for directory identity bytes."""
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    if value is None:
        return ""
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, (bytes, bytearray)):
        raw_value = bytes(value)
        if len(raw_value) == 16:
            if attribute.casefold() == "objectguid":
                return str(UUID(bytes_le=raw_value))
            return str(UUID(bytes=raw_value))
        return raw_value.hex()
    text = str(value).strip().strip("{}").strip()
    if not text:
        return ""
    try:
        return str(UUID(text))
    except (ValueError, AttributeError):
        return text


def is_directory_managed(user: User) -> bool:
    return DirectoryIdentity.objects.filter(user_id=user.pk).exists()


def _single_user_for_username(username: str) -> User | None:
    users = list(User.objects.filter(username__iexact=username).order_by("pk")[:2])
    if len(users) > 1:
        raise AuthenticationFailure("identity_collision", actor=users[0], throttle=False)
    return users[0] if users else None


def _directory_identity_for_login(username: str) -> DirectoryIdentity | None:
    identities = list(
        DirectoryIdentity.objects.select_related("user")
        .filter(
            current_login_identifier__iexact=username,
        )
        .order_by("pk")[:2]
    )
    historical_identity = None
    user = _single_user_for_username(username)
    if user is not None:
        historical_identity = (
            DirectoryIdentity.objects.select_related("user")
            .filter(user_id=user.pk)
            .first()
        )
    combined = identities + ([historical_identity] if historical_identity else [])
    unique_identities = {identity.pk: identity for identity in combined}
    if len(unique_identities) > 1:
        actor = next(iter(unique_identities.values())).user
        raise AuthenticationFailure("identity_collision", actor=actor, throttle=False)
    return next(iter(unique_identities.values()), None)


def resolve_authentication_route(username: str) -> AuthenticationRoute:
    """Resolve source from persisted identity state before any password attempt."""
    identity = _directory_identity_for_login(username)
    local_user = _single_user_for_username(username)
    if identity is not None:
        if local_user is not None and local_user.pk != identity.user_id:
            raise AuthenticationFailure(
                "identity_collision",
                actor=identity.user,
                auth_source=AUTH_SOURCE_LDAP,
                throttle=False,
            )
        return AuthenticationRoute(AUTH_SOURCE_LDAP, identity.user, identity)
    if local_user is not None:
        return AuthenticationRoute(AUTH_SOURCE_LOCAL, local_user, None)
    return AuthenticationRoute("unknown")


def _attribute_value(entry: Any, attribute: str) -> Any:
    as_dict = getattr(entry, "entry_attributes_as_dict", None)
    if isinstance(as_dict, dict):
        for key, value in as_dict.items():
            if str(key).casefold() == attribute.casefold():
                return value
    try:
        value = entry[attribute].value
    except (AttributeError, KeyError, TypeError, IndexError, LDAPException):
        value = None
    if value is not None:
        return value
    try:
        return getattr(entry, attribute)
    except (AttributeError, LDAPException):
        return None


def _first_attribute_value(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return value


def _text_attribute(entry: Any, attribute: str) -> str:
    value = _first_attribute_value(_attribute_value(entry, attribute))
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except UnicodeDecodeError:
            return ""
    return str(value).strip()


def _account_disabled(entry: Any, attribute: str) -> bool:
    raw_value = _first_attribute_value(_attribute_value(entry, attribute))
    if raw_value in (None, ""):
        return False
    if isinstance(raw_value, bytes):
        try:
            raw_value = raw_value.decode("ascii")
        except UnicodeDecodeError:
            return False
    normalized = str(raw_value).strip().casefold()
    if attribute.casefold() != "useraccountcontrol":
        if normalized in {"true", "yes", "on", "locked", "1"}:
            return True
        if normalized in {"false", "no", "off", "unlocked", "0"}:
            return False
    try:
        numeric_value = int(normalized)
        if attribute.casefold() == "useraccountcontrol":
            return bool(numeric_value & AD_ACCOUNT_DISABLED)
        return numeric_value != 0
    except (TypeError, ValueError):
        return False


def _invalid_credential_result(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    description = str(result.get("description", "")).casefold()
    return str(result.get("result")) == "49" or description in {
        "invalidcredentials",
        "invalid credentials",
    }


class LDAPDirectoryClient:
    """Small ldap3 adapter using the unified effective directory config."""

    def __init__(
        self,
        *,
        connection_factory: Callable[..., Any] | None = None,
        server_factory: Callable[..., Any] | None = None,
        configuration: EffectiveLDAPConfiguration | None = None,
    ):
        self.connection_factory = connection_factory or Connection
        self.server_factory = server_factory or Server
        self.configuration = configuration or get_effective_ldap_configuration()

    def _server(
        self,
        configuration: EffectiveLDAPConfiguration | None = None,
        *,
        endpoint: tuple[str, str, int | None] | None = None,
    ):
        config = configuration or self.configuration
        endpoint = endpoint or config.endpoints[0]
        _name, hostname, port = endpoint
        if not hostname or port is None:
            raise LDAPInfrastructureFailure("ldap_connection_failure", retryable=True)
        if config.security_mode not in {"ldaps", "starttls", "none"}:
            raise LDAPInfrastructureFailure("ldap_tls_failure", retryable=True)
        tls = None
        if config.security_mode != "none":
            tls_server_name = config.tls_server_name or hostname
            tls = Tls(
                validate=ssl.CERT_REQUIRED,
                ca_certs_file=config.ca_cert_file or None,
                valid_names=[tls_server_name],
                sni=tls_server_name,
            )
        return self.server_factory(
            hostname,
            port=port,
            use_ssl=config.security_mode == "ldaps",
            tls=tls,
            get_info=ALL,
            connect_timeout=config.connect_timeout,
        )

    def _connection(
        self,
        server,
        configuration: EffectiveLDAPConfiguration,
        *,
        user,
        password,
    ):
        return self.connection_factory(
            server,
            user=user,
            password=password,
            auto_bind=False,
            receive_timeout=configuration.operation_timeout,
        )

    @staticmethod
    def _diagnostic_success(checks, name: str) -> None:
        checks.append({"name": name, "status": "success"})

    @staticmethod
    def _diagnostic_failure(
        stage: str,
        checks,
        code: str,
    ) -> LDAPDiagnosticResult:
        safe_code = code if code in LDAP_DIAGNOSTIC_CODES else "unexpected_error"
        checks.append({"name": stage, "status": "error"})
        return LDAPDiagnosticResult(
            success=False,
            stage=stage,
            checks=tuple(checks),
            code=safe_code,
            message=LDAP_DIAGNOSTIC_MESSAGES[safe_code],
        )

    def _validate_diagnostic_configuration(
        self,
        configuration: EffectiveLDAPConfiguration | None = None,
        *,
        allow_disabled: bool = False,
    ) -> str | None:
        config = configuration or self.configuration
        if not allow_disabled and not config.enabled:
            return "disabled"
        return "configuration_error" if configuration_errors(config, require_password=True) else None

    def _diagnose_endpoint(
        self,
        configuration: EffectiveLDAPConfiguration,
        endpoint: tuple[str, str, int | None],
    ) -> LDAPDiagnosticResult:
        checks: list[dict[str, str]] = []
        self._diagnostic_success(checks, "configuration")
        connection = None
        stage = "connection"
        try:
            server = self._server(configuration, endpoint=endpoint)
            connection = self._connection(
                server,
                configuration,
                user=configuration.bind_dn,
                password=configuration.bind_password,
            )
            opened = connection.open()
            if opened is False:
                raise LDAPInfrastructureFailure("ldap_connection_failure", retryable=True)
            self._diagnostic_success(checks, "connection")

            stage = "tls"
            if configuration.security_mode == "starttls" and not connection.start_tls():
                raise LDAPDiagnosticFailure("tls_error")
            self._diagnostic_success(checks, "tls")

            stage = "service_bind"
            if not connection.bind():
                raise LDAPDiagnosticFailure("bind_error")
            self._diagnostic_success(checks, "service_bind")

            stage = "search"
            if not connection.search(
                search_base=configuration.base_dn,
                search_filter="(objectClass=*)",
                search_scope=BASE,
                attributes=["1.1"],
                size_limit=1,
            ):
                raise LDAPDiagnosticFailure("search_error")
            self._diagnostic_success(checks, "search")
            return LDAPDiagnosticResult(success=True, stage="search", checks=tuple(checks))
        except LDAPDiagnosticFailure as exc:
            return self._diagnostic_failure(stage, checks, exc.code)
        except (socket.timeout, TimeoutError):
            return self._diagnostic_failure(stage, checks, "timeout")
        except ssl.SSLError:
            return self._diagnostic_failure(stage, checks, "tls_error")
        except LDAPInfrastructureFailure as exc:
            code = "tls_error" if exc.reason == "ldap_tls_failure" else "connection_error"
            return self._diagnostic_failure(stage, checks, code)
        except (LDAPException, OSError, ValueError):
            code_by_stage = {
                "connection": "connection_error",
                "tls": "tls_error",
                "service_bind": "bind_error",
                "search": "search_error",
            }
            return self._diagnostic_failure(stage, checks, code_by_stage.get(stage, "unexpected_error"))
        except Exception:
            logger.exception("LDAP diagnostic failed at stage %s", stage)
            return self._diagnostic_failure(stage, checks, "unexpected_error")
        finally:
            if connection is not None:
                self._close(connection)

    def diagnose(
        self,
        configuration: EffectiveLDAPConfiguration | None = None,
        *,
        allow_disabled: bool = False,
    ) -> LDAPDiagnosticResult:
        """Run a fixed, safe health check against saved or staged settings."""
        config = configuration or self.configuration
        checks: list[dict[str, str]] = []
        configuration_error = self._validate_diagnostic_configuration(
            config,
            allow_disabled=allow_disabled,
        )
        if configuration_error:
            if configuration_error == "disabled":
                checks.append({"name": "configuration", "status": "disabled"})
                return LDAPDiagnosticResult(
                    success=False,
                    stage="configuration",
                    checks=tuple(checks),
                    code="disabled",
                    message=LDAP_DIAGNOSTIC_MESSAGES["disabled"],
                )
            return self._diagnostic_failure("configuration", checks, configuration_error)

        attempts = config.endpoints
        result = self._diagnostic_failure("connection", checks, "connection_error")
        for index, endpoint in enumerate(attempts):
            endpoint_name = endpoint[0]
            logger.info("LDAP diagnostic attempting %s endpoint", endpoint_name)
            result = self._diagnose_endpoint(config, endpoint)
            if result.success:
                return result
            if result.code not in {"connection_error", "timeout", "tls_error"}:
                return result
            if index + 1 < len(attempts):
                logger.warning("LDAP diagnostic infrastructure failure on %s; trying secondary", endpoint_name)
        return result

    @staticmethod
    def _start_tls_if_needed(connection, configuration: EffectiveLDAPConfiguration):
        if configuration.security_mode == "starttls" and not connection.start_tls():
            raise LDAPInfrastructureFailure("ldap_tls_failure", retryable=True)

    @staticmethod
    def _close(connection):
        try:
            connection.unbind()
        except (LDAPException, OSError, socket.timeout, TimeoutError, ssl.SSLError):
            logger.debug("LDAP connection close failed")

    def _authenticate_endpoint(
        self,
        configuration: EffectiveLDAPConfiguration,
        username: str,
        password: str,
        endpoint: tuple[str, str, int | None],
    ) -> DirectoryUser:
        server = None
        service_connection = None
        user_connection = None
        stage = "connection"
        try:
            server = self._server(configuration, endpoint=endpoint)
            service_connection = self._connection(
                server,
                configuration,
                user=configuration.bind_dn,
                password=configuration.bind_password,
            )
            self._start_tls_if_needed(service_connection, configuration)
            stage = "service_bind"
            if not service_connection.bind():
                raise LDAPInfrastructureFailure("ldap_bind_failure")

            escaped_username = escape_filter_chars(username)
            stage = "search"
            search_filter = configuration.user_filter.replace("{username}", escaped_username)
            attributes = list(
                dict.fromkeys(
                    attribute
                    for attribute in [
                        configuration.user_login_attribute,
                        configuration.external_id_attribute,
                        configuration.email_attribute,
                        configuration.first_name_attribute,
                        configuration.last_name_attribute,
                        configuration.account_control_attribute,
                    ]
                    if attribute
                )
            )
            search_succeeded = service_connection.search(
                search_base=configuration.effective_user_search_base,
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=attributes,
                size_limit=2,
            )
            if not search_succeeded:
                raise LDAPInfrastructureFailure("ldap_search_error")
            entries = list(getattr(service_connection, "entries", []) or [])
            if not entries:
                raise LDAPCredentialFailure()
            if len(entries) > 1:
                raise LDAPCredentialFailure("ldap_search_error", throttle=False)

            entry = entries[0]
            external_id = normalize_external_id(
                _attribute_value(entry, configuration.external_id_attribute),
                configuration.external_id_attribute,
            )
            login_identifier = _text_attribute(entry, configuration.user_login_attribute)
            if not external_id or not login_identifier:
                raise LDAPCredentialFailure("ldap_search_error", throttle=False)
            if _account_disabled(entry, configuration.account_control_attribute):
                raise LDAPCredentialFailure("directory_disabled", throttle=False)

            entry_dn = str(getattr(entry, "entry_dn", "") or "").strip()
            if not entry_dn:
                raise LDAPCredentialFailure("ldap_search_error", throttle=False)
            stage = "user_bind"
            user_connection = self._connection(
                server,
                configuration,
                user=entry_dn,
                password=password,
            )
            self._start_tls_if_needed(user_connection, configuration)
            if not user_connection.bind():
                if _invalid_credential_result(getattr(user_connection, "result", None)):
                    raise LDAPCredentialFailure()
                raise LDAPInfrastructureFailure("ldap_user_bind_failure")
            return DirectoryUser(
                external_id=external_id,
                login_identifier=login_identifier,
                first_name=_text_attribute(entry, configuration.first_name_attribute),
                last_name=_text_attribute(entry, configuration.last_name_attribute),
                email=_text_attribute(entry, configuration.email_attribute),
            )
        except LDAPCredentialFailure as exc:
            if not exc.throttle:
                logger.warning("LDAP authentication rejected: %s", exc.reason)
            raise
        except LDAPInfrastructureFailure as exc:
            logger.warning("LDAP authentication infrastructure failure: %s", exc.reason)
            raise
        except (LDAPException, OSError, socket.timeout, TimeoutError, ssl.SSLError, ValueError) as exc:
            reason = "ldap_tls_failure" if isinstance(exc, ssl.SSLError) else (
                "ldap_search_error" if stage == "search" else "ldap_connection_failure"
            )
            logger.warning("LDAP authentication infrastructure failure: %s (%s)", reason, type(exc).__name__)
            raise LDAPInfrastructureFailure(
                reason,
                retryable=stage == "connection" or isinstance(exc, (socket.timeout, TimeoutError, ssl.SSLError)),
            ) from exc
        finally:
            if user_connection is not None:
                self._close(user_connection)
            if service_connection is not None:
                self._close(service_connection)

    def authenticate(self, username: str, password: str) -> DirectoryUser:
        configuration = self.configuration
        if not configuration.enabled:
            raise LDAPInfrastructureFailure("ldap_disabled")
        if not password:
            raise LDAPCredentialFailure()
        if configuration_errors(configuration, require_password=True):
            raise LDAPInfrastructureFailure("ldap_configuration_error")
        attempts = configuration.endpoints
        last_error: LDAPInfrastructureFailure | None = None
        for index, endpoint in enumerate(attempts):
            try:
                return self._authenticate_endpoint(configuration, username, password, endpoint)
            except LDAPCredentialFailure:
                raise
            except LDAPInfrastructureFailure as exc:
                last_error = exc
                if not exc.retryable or index + 1 >= len(attempts):
                    raise
                logger.warning("LDAP authentication retrying secondary endpoint after %s", exc.reason)
        raise last_error or LDAPInfrastructureFailure("ldap_unavailable")


def _ldap_endpoint_display(host: str, port: int | None) -> str | None:
    if not host:
        return None
    return f"{host}:{port}" if port is not None else host


def _ad_specific_mode(configuration: EffectiveLDAPConfiguration | None = None) -> bool | None:
    config = configuration or get_effective_ldap_configuration()
    return config.directory_type == "active_directory"


def ldap_is_enabled() -> bool:
    return get_effective_ldap_configuration().enabled


def ldap_status_snapshot() -> dict[str, Any]:
    """Return admin-safe metadata; never return credentials or encrypted tokens."""
    configuration = get_effective_ldap_configuration()
    errors = configuration_errors(
        configuration,
        require_password=configuration.enabled,
    )
    if configuration.secret_error:
        errors["bind_password"] = "无法读取已保存的绑定密码，请重新输入并保存"
    protocol = (
        "ldaps"
        if configuration.security_mode == "ldaps"
        else "ldap"
        if configuration.security_mode in {"starttls", "none"}
        else None
    )
    return {
        "enabled": configuration.enabled,
        "configured": not errors,
        "provider": LDAP_PROVIDER,
        "directory_type": configuration.directory_type,
        "protocol": protocol,
        "tls_mode": configuration.security_mode,
        "server": _ldap_endpoint_display(configuration.primary_host, configuration.primary_port),
        "secondary_server": _ldap_endpoint_display(
            configuration.secondary_host,
            configuration.secondary_port,
        ),
        "base_dn": configuration.base_dn or None,
        "search_configured": bool(
            configuration.effective_user_search_base and configuration.user_filter
        ),
        "connect_timeout": configuration.connect_timeout,
        "operation_timeout": configuration.operation_timeout,
        "ad_specific_mode": _ad_specific_mode(configuration),
        "password_configured": configuration.password_configured,
        "secret_available": configuration.secret_available,
        "source": configuration.source,
        "configuration_error": bool(errors),
    }


class LDAPAuthenticationService:
    def __init__(self, *, client: LDAPDirectoryClient | None = None):
        self.client = client or LDAPDirectoryClient()

    def authenticate(
        self,
        username: str,
        password: str,
        *,
        expected_identity: DirectoryIdentity | None = None,
    ) -> AuthenticationResult:
        directory_user = self.client.authenticate(username, password)
        if expected_identity is not None and (
            expected_identity.provider != LDAP_PROVIDER
            or expected_identity.external_id != directory_user.external_id
        ):
            logger.warning("LDAP identity collision during expected identity verification")
            raise LDAPCredentialFailure(
                "identity_collision",
                actor=expected_identity.user,
                throttle=False,
            )
        return provision_directory_user(directory_user, expected_identity=expected_identity)


def _bounded_text(value: str, max_length: int) -> str | None:
    normalized = (value or "").strip()
    if not normalized or len(normalized) > max_length:
        return None
    return normalized


def _sync_directory_attributes(user: User, directory_user: DirectoryUser) -> None:
    field_values = {
        "first_name": _bounded_text(directory_user.first_name, 150),
        "last_name": _bounded_text(directory_user.last_name, 150),
        "email": _bounded_text(directory_user.email, 254),
    }
    update_fields = []
    for field, value in field_values.items():
        if value is not None and getattr(user, field) != value:
            setattr(user, field, value)
            update_fields.append(field)
    if update_fields:
        user.save(update_fields=update_fields)


def _ensure_login_identifier_available(login_identifier: str, user: User) -> None:
    existing_user = _single_user_for_username(login_identifier)
    if existing_user is None or existing_user.pk == user.pk:
        return
    raise LDAPCredentialFailure(
        "identity_collision",
        actor=existing_user,
        throttle=False,
    )


def _prepare_directory_user(user: User, directory_user: DirectoryUser) -> User:
    if not user.is_active:
        raise LDAPCredentialFailure("identity_inactive", actor=user, throttle=False)
    _ensure_login_identifier_available(directory_user.login_identifier, user)
    if user.has_usable_password():
        user.set_unusable_password()
        user.save(update_fields=["password"])
    _sync_directory_attributes(user, directory_user)
    profile, _ = UserSecurityProfile.objects.get_or_create(user=user)
    profile_updates = []
    if profile.must_change_password:
        profile.must_change_password = False
        profile_updates.append("must_change_password")
    if profile.password_changed_at is not None:
        profile.password_changed_at = None
        profile_updates.append("password_changed_at")
    if profile_updates:
        profile.save(update_fields=[*profile_updates, "updated_at"])
    return user


def provision_directory_user(
    directory_user: DirectoryUser,
    *,
    expected_identity: DirectoryIdentity | None = None,
) -> AuthenticationResult:
    login_identifier = _bounded_text(directory_user.login_identifier, 150)
    external_id = _bounded_text(directory_user.external_id, 255)
    if login_identifier is None or external_id is None:
        raise LDAPCredentialFailure("ldap_search_error", throttle=False)

    for attempt in range(2):
        try:
            with transaction.atomic():
                identity = (
                    DirectoryIdentity.objects.select_for_update()
                    .select_related("user")
                    .filter(provider=LDAP_PROVIDER, external_id=external_id)
                    .first()
                )
                if expected_identity is not None:
                    if expected_identity.provider != LDAP_PROVIDER or expected_identity.external_id != external_id:
                        raise LDAPCredentialFailure(
                            "identity_collision",
                            actor=expected_identity.user,
                            throttle=False,
                        )
                    if identity is not None and identity.user_id != expected_identity.user_id:
                        raise LDAPCredentialFailure(
                            "identity_collision",
                            actor=identity.user,
                            throttle=False,
                        )
                    identity = identity or expected_identity
                    try:
                        identity = (
                            DirectoryIdentity.objects.select_for_update()
                            .select_related("user")
                            .get(pk=identity.pk)
                        )
                    except DirectoryIdentity.DoesNotExist as exc:
                        raise LDAPCredentialFailure(
                            "identity_collision",
                            throttle=False,
                        ) from exc

                if identity is not None:
                    user = _prepare_directory_user(identity.user, directory_user)
                    identity.current_login_identifier = login_identifier
                    identity.last_seen_at = timezone.now()
                    identity.save(update_fields=["current_login_identifier", "last_seen_at", "updated_at"])
                    return AuthenticationResult(user, AUTH_SOURCE_LDAP)

                local_user = _single_user_for_username(login_identifier)
                if local_user is not None:
                    raise LDAPCredentialFailure(
                        "identity_collision",
                        actor=local_user,
                        throttle=False,
                    )

                user = User(
                    username=login_identifier,
                    first_name=_bounded_text(directory_user.first_name, 150) or "",
                    last_name=_bounded_text(directory_user.last_name, 150) or "",
                    email=_bounded_text(directory_user.email, 254) or "",
                    is_active=True,
                    is_staff=False,
                    is_superuser=False,
                )
                user.set_unusable_password()
                user.save()
                profile, _ = UserSecurityProfile.objects.get_or_create(user=user)
                profile.must_change_password = False
                profile.password_changed_at = None
                profile.save(update_fields=["must_change_password", "password_changed_at", "updated_at"])
                DirectoryIdentity.objects.create(
                    user=user,
                    provider=LDAP_PROVIDER,
                    external_id=external_id,
                    current_login_identifier=login_identifier,
                    last_seen_at=timezone.now(),
                )
                return AuthenticationResult(user, AUTH_SOURCE_LDAP)
        except IntegrityError as exc:
            if attempt == 0:
                continue
            raise LDAPCredentialFailure("identity_collision", throttle=False) from exc
    raise LDAPCredentialFailure("identity_collision", throttle=False)


def authenticate_with_source_routing(request, username: str, password: str) -> AuthenticationResult:
    route = resolve_authentication_route(username)
    if route.source == AUTH_SOURCE_LOCAL:
        user = authenticate(request, username=username, password=password)
        if user is None or not user.is_active:
            raise AuthenticationFailure(
                actor=route.user,
                auth_source=AUTH_SOURCE_LOCAL,
            )
        return AuthenticationResult(user, AUTH_SOURCE_LOCAL)

    if route.source == AUTH_SOURCE_LDAP:
        if not ldap_is_enabled():
            raise LDAPInfrastructureFailure(actor=route.user)
        return LDAPAuthenticationService().authenticate(
            username,
            password,
            expected_identity=route.identity,
        )

    if not ldap_is_enabled():
        user = authenticate(request, username=username, password=password)
        if user is not None and user.is_active:
            return AuthenticationResult(user, AUTH_SOURCE_LOCAL)
        raise AuthenticationFailure()

    return LDAPAuthenticationService().authenticate(username, password)
