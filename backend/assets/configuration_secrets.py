"""Authenticated-encryption boundary for database-backed configuration secrets."""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


class ConfigurationSecretError(Exception):
    """Raised when the deployment key cannot protect a configuration secret."""


def _fernet() -> Fernet:
    key = str(getattr(settings, "INFRIX_CONFIG_ENCRYPTION_KEY", "") or "").strip()
    if not key:
        raise ConfigurationSecretError("configuration encryption key is not configured")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError, UnicodeEncodeError) as exc:
        raise ConfigurationSecretError("configuration encryption key is invalid") from exc


def encrypt_secret(value: str, *, field_name: str = "configuration secret") -> str:
    if not value:
        return ""
    try:
        return _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    except UnicodeEncodeError as exc:
        raise ConfigurationSecretError(f"{field_name} is not valid UTF-8") from exc


def decrypt_secret(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (ConfigurationSecretError, InvalidToken, UnicodeDecodeError, UnicodeEncodeError) as exc:
        raise ConfigurationSecretError("configuration secret is unavailable") from exc
