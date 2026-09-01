#!/usr/bin/env python3
"""Validate an Infrix environment file without printing secret values."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


_KEY_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}
_PLACEHOLDER_PASSWORDS = {
    "change-me",
    "changeme",
    "password",
    "<database-password>",
    "数据库密码",
    "请替换为数据库密码",
}


class ConfigurationError(ValueError):
    """A safe, administrator-facing configuration error."""


def read_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise ConfigurationError(f"Production environment file not found: {path}")

    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ConfigurationError(f"Unable to read environment file: {path}") from exc

    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not _KEY_PATTERN.fullmatch(key):
            raise ConfigurationError(
                f"Invalid environment entry at line {line_number}; expected KEY=value."
            )
        values[key] = value.strip()
    return values


def _required(values: dict[str, str], name: str) -> str:
    value = values.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"Production requires {name}; the value is missing.")
    return value


def _boolean(values: dict[str, str], name: str, *, default: str | None = None) -> bool:
    raw_value = values.get(name, default)
    if raw_value is None:
        raise ConfigurationError(f"Production requires {name}.")
    normalized = raw_value.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    raise ConfigurationError(f"{name} must be one of: 1, 0, true, false, yes, no, on, off.")


def _list_value(values: dict[str, str], name: str) -> list[str]:
    return [item.strip() for item in values.get(name, "").split(",") if item.strip()]


def _validate_development(values: dict[str, str]) -> None:
    engine = values.get("DB_ENGINE", "").strip().lower()
    if engine and engine not in {"mysql", "sqlite"}:
        raise ConfigurationError("Unsupported DB_ENGINE; use mysql or sqlite.")


def validate_values(values: dict[str, str], *, require_proxy: bool = False) -> None:
    environment = _required(values, "DJANGO_ENV").lower()
    if environment == "development":
        _validate_development(values)
        return
    if environment != "production":
        raise ConfigurationError("DJANGO_ENV must be either development or production.")

    if _boolean(values, "DJANGO_DEBUG"):
        raise ConfigurationError("DJANGO_DEBUG must be false when DJANGO_ENV=production.")

    secret_key = _required(values, "DJANGO_SECRET_KEY")
    if (
        len(secret_key) < 50
        or secret_key.lower().startswith("django-insecure-")
        or secret_key.lower() in {"change-me", "changeme", "insecure"}
    ):
        raise ConfigurationError(
            "Production requires DJANGO_SECRET_KEY with at least 50 characters; "
            "the development fallback or placeholder is not allowed."
        )

    allowed_hosts = _list_value(values, "DJANGO_ALLOWED_HOSTS")
    if not allowed_hosts or any(host == "*" for host in allowed_hosts):
        raise ConfigurationError(
            "Production requires DJANGO_ALLOWED_HOSTS to contain explicit hosts; '*' is not allowed."
        )

    csrf_origins = _list_value(values, "DJANGO_CSRF_TRUSTED_ORIGINS")
    if not csrf_origins:
        raise ConfigurationError(
            "Production requires DJANGO_CSRF_TRUSTED_ORIGINS; configure HTTPS origins explicitly."
        )
    if any(urlsplit(origin).scheme != "https" or not urlsplit(origin).netloc for origin in csrf_origins):
        raise ConfigurationError(
            "Production DJANGO_CSRF_TRUSTED_ORIGINS must contain valid https:// origins."
        )

    https_mode = _required(values, "DJANGO_HTTPS_MODE").lower()
    if https_mode not in {"proxy", "direct"}:
        raise ConfigurationError("DJANGO_HTTPS_MODE must be 'proxy' or 'direct' in production.")
    if require_proxy and https_mode != "proxy":
        raise ConfigurationError("The current Nginx deployment requires DJANGO_HTTPS_MODE=proxy.")
    if not _boolean(values, "DJANGO_SECURE_SSL_REDIRECT"):
        raise ConfigurationError("DJANGO_SECURE_SSL_REDIRECT must be true in production.")
    if not _boolean(values, "DJANGO_SESSION_COOKIE_SECURE"):
        raise ConfigurationError("DJANGO_SESSION_COOKIE_SECURE must be true in production.")
    if not _boolean(values, "DJANGO_CSRF_COOKIE_SECURE"):
        raise ConfigurationError("DJANGO_CSRF_COOKIE_SECURE must be true in production.")
    try:
        hsts_seconds = int(_required(values, "DJANGO_SECURE_HSTS_SECONDS"))
    except ValueError as exc:
        raise ConfigurationError("DJANGO_SECURE_HSTS_SECONDS must be a positive integer.") from exc
    if hsts_seconds <= 0:
        raise ConfigurationError("DJANGO_SECURE_HSTS_SECONDS must be a positive integer.")
    if _boolean(values, "DJANGO_USE_X_FORWARDED_HOST"):
        raise ConfigurationError("DJANGO_USE_X_FORWARDED_HOST must be false in production.")

    engine = _required(values, "DB_ENGINE").lower()
    if engine != "mysql":
        raise ConfigurationError(
            "Unsupported DB_ENGINE for production; production requires mysql."
        )
    for name in ("DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"):
        value = _required(values, name)
        if name == "DB_PASSWORD" and value.lower() in _PLACEHOLDER_PASSWORDS:
            raise ConfigurationError("Production DB_PASSWORD must not be a placeholder.")
    try:
        db_port = int(values.get("DB_PORT", "3306").strip())
    except ValueError as exc:
        raise ConfigurationError("Production DB_PORT must be an integer.") from exc
    if not 1 <= db_port <= 65535:
        raise ConfigurationError("Production DB_PORT must be between 1 and 65535.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument(
        "--require-proxy",
        action="store_true",
        help="Require the current external TLS gateway plus internal Nginx mode.",
    )
    args = parser.parse_args()
    try:
        values = read_env_file(args.env_file)
        validate_values(values, require_proxy=args.require_proxy)
    except ConfigurationError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    environment = values.get("DJANGO_ENV", "").strip().lower()
    if environment == "production":
        print(
            "Production configuration valid: DJANGO_ENV=production "
            "DB_ENGINE=mysql SECRET_KEY=configured"
        )
    else:
        print("Development configuration valid: SQLite fallback remains available.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
