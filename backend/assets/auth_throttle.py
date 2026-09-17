"""Shared client-IP and persistent authentication throttling primitives."""

from __future__ import annotations

from datetime import timedelta
from ipaddress import ip_address

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import AuthThrottleState


def _canonical_ip(value) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return str(ip_address(text))
    except ValueError:
        return None


def trusted_client_ip(request) -> str:
    """Return the client IP only when forwarding came from a trusted proxy.

    Direct requests ignore all forwarding headers.  For a trusted proxy, the
    right-most untrusted address in the X-Forwarded-For chain is the client;
    this also prevents an internet client from poisoning the value when the
    proxy appends, rather than replaces, X-Forwarded-For.
    """

    remote_addr = _canonical_ip(request.META.get("REMOTE_ADDR"))
    if remote_addr is None:
        return "unknown"

    trusted = {
        value
        for value in (
            _canonical_ip(item)
            for item in getattr(settings, "TRUSTED_PROXY_IPS", ())
        )
        if value is not None
    }
    if remote_addr not in trusted:
        return remote_addr[:255]

    chain = [
        candidate
        for candidate in (
            _canonical_ip(item)
            for item in (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")
        )
        if candidate is not None
    ]
    chain.append(remote_addr)
    for candidate in reversed(chain):
        if candidate not in trusted:
            return candidate[:255]

    real_ip = _canonical_ip(request.META.get("HTTP_X_REAL_IP"))
    if real_ip is not None:
        return real_ip[:255]
    return remote_addr[:255]


def _security_policy() -> dict[str, int]:
    # Import lazily: system_settings imports the models used by this module.
    from .system_settings import get_local_account_security_policy

    return get_local_account_security_policy()


def _two_factor_keys(user_id, client_ip: str):
    return (
        ("account", f"two-factor-account:{user_id}"),
        ("ip", f"two-factor-ip:{client_ip}"[:255]),
    )


def _locked_state(scope, key, now):
    state, _ = AuthThrottleState.objects.select_for_update().get_or_create(
        scope=scope,
        key=key,
    )
    if state.locked_until and state.locked_until <= now:
        state.failure_count = 0
        state.first_failed_at = None
        state.locked_until = None
        state.save(update_fields=["failure_count", "first_failed_at", "locked_until", "updated_at"])
    return state


def two_factor_lock_status(user_id, client_ip: str, *, now=None) -> tuple[bool, int]:
    now = now or timezone.now()
    with transaction.atomic():
        states = [_locked_state(scope, key, now) for scope, key in _two_factor_keys(user_id, client_ip)]
        locked_until = max(
            (state.locked_until for state in states if state.locked_until and state.locked_until > now),
            default=None,
        )
    if locked_until:
        return True, max(1, int((locked_until - now).total_seconds()))
    return False, 0


def register_two_factor_failure(user_id, client_ip: str, *, now=None) -> tuple[bool, int]:
    now = now or timezone.now()
    policy = _security_policy()
    window = timedelta(seconds=max(1, policy["login_window_seconds"]))
    lock_duration = timedelta(seconds=max(1, policy["login_lock_seconds"]))
    max_attempts = max(1, policy["login_max_attempts"])
    with transaction.atomic():
        states = [_locked_state(scope, key, now) for scope, key in _two_factor_keys(user_id, client_ip)]
        locked_until = None
        for state in states:
            if state.locked_until and state.locked_until > now:
                locked_until = max(locked_until or now, state.locked_until)
                continue
            if not state.first_failed_at or now - state.first_failed_at > window:
                state.failure_count = 0
                state.first_failed_at = now
            state.failure_count += 1
            if state.failure_count >= max_attempts:
                state.locked_until = now + lock_duration
                locked_until = max(locked_until or now, state.locked_until)
            state.save(update_fields=["failure_count", "first_failed_at", "locked_until", "updated_at"])
    if locked_until:
        return True, max(1, int((locked_until - now).total_seconds()))
    return False, 0


def clear_two_factor_throttle(user_id, client_ip: str) -> None:
    with transaction.atomic():
        for scope, key in _two_factor_keys(user_id, client_ip):
            AuthThrottleState.objects.select_for_update().filter(scope=scope, key=key).update(
                failure_count=0,
                first_failed_at=None,
                locked_until=None,
            )
