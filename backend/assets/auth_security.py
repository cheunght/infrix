"""Small, dependency-free primitives for user 2FA and API tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from datetime import timedelta
from urllib.parse import urlencode, quote

from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from drf_spectacular.plumbing import build_bearer_security_scheme_object

from .models import PersonalAccessToken


TOTP_PERIOD = 30
TOTP_DIGITS = 6
TOTP_WINDOW = 1
API_TOKEN_PREFIX = "ifx_"
API_TOKEN_DEFAULT_EXPIRY_DAYS = 90
_TOTP_CODE_RE = re.compile(r"^\d{6}$")


def generate_totp_secret() -> str:
    """Return a base32 secret compatible with standard authenticator apps."""

    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def provisioning_uri(*, username: str, secret: str) -> str:
    label = quote(f"infrix:{username}", safe=":")
    query = urlencode({
        "secret": secret,
        "issuer": "infrix",
        "algorithm": "SHA1",
        "digits": TOTP_DIGITS,
        "period": TOTP_PERIOD,
    })
    return f"otpauth://totp/{label}?{query}"


def _totp_digest(secret: str, step: int) -> str | None:
    padding = "=" * (-len(secret) % 8)
    try:
        key = base64.b32decode(f"{secret}{padding}", casefold=True)
    except (ValueError, TypeError):
        return None
    message = struct.pack(">Q", step)
    digest = hmac.new(key, message, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)


def totp_step_for_code(secret: str, code: str, *, now: float | None = None) -> int | None:
    """Return the matching time step, accepting a small clock-drift window."""

    normalized = str(code or "").strip()
    if not _TOTP_CODE_RE.fullmatch(normalized):
        return None
    current_step = int((time.time() if now is None else now) // TOTP_PERIOD)
    for offset in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        step = current_step + offset
        expected = _totp_digest(secret, step)
        if expected is not None and hmac.compare_digest(expected, normalized):
            return step
    return None


def hash_api_token(raw_token: str) -> str:
    """Hash a high-entropy token with the deployment secret before storage."""

    secret = str(getattr(settings, "SECRET_KEY", "")).encode("utf-8")
    return hmac.new(secret, raw_token.encode("utf-8"), hashlib.sha256).hexdigest()


def generate_api_token() -> tuple[str, str, str]:
    raw_token = f"{API_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
    return raw_token, hash_api_token(raw_token), raw_token[:12]


def default_api_token_expiry():
    return timezone.localdate() + timedelta(days=API_TOKEN_DEFAULT_EXPIRY_DAYS)


def token_is_expired(token: PersonalAccessToken) -> bool:
    return token.expires_at is not None and token.expires_at < timezone.localdate()


class PersonalAccessTokenAuthentication(BaseAuthentication):
    """Authenticate API calls using ``Authorization: Bearer <token>``."""

    keyword = "Bearer"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts:
            return None
        if len(parts) != 2 or parts[0].lower() != self.keyword.lower().encode("ascii"):
            raise AuthenticationFailed("Authorization header must use a Bearer token")
        try:
            raw_token = parts[1].decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AuthenticationFailed("API token is invalid") from exc
        token = (
            PersonalAccessToken.objects.select_related("user")
            .filter(token_hash=hash_api_token(raw_token), revoked_at__isnull=True)
            .first()
        )
        if token is None or token_is_expired(token):
            raise AuthenticationFailed("API token is invalid or expired")
        if not token.user.is_active:
            raise AuthenticationFailed("The account associated with this API token is disabled")

        now = timezone.now()
        if token.last_used_at is None or token.last_used_at <= now - timedelta(minutes=5):
            PersonalAccessToken.objects.filter(pk=token.pk).update(last_used_at=now)
        return token.user, token

    def authenticate_header(self, request):
        # Keep the existing browser/session behaviour (403 without any
        # authentication challenge), while invalid bearer credentials receive
        # a useful 401 challenge.
        return self.keyword if get_authorization_header(request) else None


class PersonalAccessTokenScheme(OpenApiAuthenticationExtension):
    """Describe the bearer token accepted by the API in the OpenAPI schema."""

    target_class = "assets.auth_security.PersonalAccessTokenAuthentication"
    name = "bearerAuth"
    priority = 1

    def get_security_definition(self, auto_schema):
        del auto_schema
        return build_bearer_security_scheme_object(
            header_name="Authorization",
            token_prefix=PersonalAccessTokenAuthentication.keyword,
        )
