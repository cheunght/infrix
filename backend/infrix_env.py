"""Read single-line systemd environment assignments without shell evaluation."""

import argparse
import os
from pathlib import Path
import re
import sys


CONFIG_KEYS = frozenset("""
DJANGO_ENV DJANGO_SECRET_KEY DJANGO_DEBUG DJANGO_ALLOWED_HOSTS DJANGO_CSRF_TRUSTED_ORIGINS
DJANGO_HTTPS_MODE DJANGO_SECURE_SSL_REDIRECT DJANGO_SESSION_COOKIE_SECURE DJANGO_CSRF_COOKIE_SECURE
DJANGO_SECURE_HSTS_SECONDS DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS DJANGO_SECURE_HSTS_PRELOAD
DJANGO_USE_X_FORWARDED_HOST DJANGO_TRUSTED_PROXY_IPS DB_ENGINE DB_NAME DB_USER DB_PASSWORD
DB_HOST DB_PORT DB_CONN_MAX_AGE INFRIX_CONFIG_ENCRYPTION_KEY INFRIX_GIT_REVISION INFRIX_MEDIA_ROOT
INFRIX_BACKUP_DIR INFRIX_MAINTENANCE_DIR INFRIX_MAINTENANCE_DRAIN_SECONDS INFRIX_ATTACHMENT_MAX_SIZE
INFRIX_SQLITE_PATH AUTH_LOGIN_MAX_ATTEMPTS AUTH_LOGIN_WINDOW_SECONDS AUTH_LOGIN_LOCK_SECONDS
TZ SERVER_NAME TLS_MODE TLS_CERT_FILE TLS_KEY_FILE TLS_CA_FILE SKIP_MARIADB GUNICORN_WORKERS NODE_OPTIONS
""".split())


class ConfigurationError(ValueError):
    """Configuration error safe to print without exposing a value."""


def read_env_file(path):
    if not path.is_file():
        raise ConfigurationError(f"Production environment file not found: {path}")
    try:
        lines = path.read_text(encoding="utf-8").split("\n")
    except (OSError, UnicodeError) as exc:
        raise ConfigurationError(f"Unable to read environment file: {path}") from exc

    values = {}
    for number, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line or line.startswith(("#", ";")):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or key not in CONFIG_KEYS:
            raise ConfigurationError(f"Invalid or unsupported environment entry at line {number}.")
        if not re.fullmatch(r"[^\x00-\x1f\x7f]*", value):
            raise ConfigurationError(f"Invalid environment value at line {number}.")
        if value.startswith("'"):
            if not re.fullmatch(r"'[^']*'", value):
                raise ConfigurationError(f"Expected a single-line quoted value at line {number}.")
            value = value[1:-1]
        elif value.startswith('"'):
            if not re.fullmatch(r'"(?:[^"\\]|\\.)*"', value):
                raise ConfigurationError(f"Expected a single-line quoted value at line {number}.")
            value = re.sub(r'\\(["\\$`])', r'\1', value[1:-1])
        elif "\\" in value:
            raise ConfigurationError(f"Use a quoted value for backslashes at line {number}.")
        values[key] = value
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("env_file", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        values = read_env_file(args.env_file)
        if not values.get("DJANGO_ENV"):
            raise ConfigurationError(f"Environment file must define DJANGO_ENV: {args.env_file}")
        if args.command:
            os.execvpe(args.command[0], args.command, {**os.environ, **values})
        for key, value in values.items():
            sys.stdout.buffer.write(f"{key}={value}\0".encode())
        sys.stdout.buffer.write(b"\0")
    except ConfigurationError as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
