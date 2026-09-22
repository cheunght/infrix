"""Deployment-clock primitives shared by date-sensitive application modules."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.utils import timezone as django_timezone


def system_timezone():
    """Return the deployment timezone configured for the Django process."""

    return django_timezone.get_default_timezone()


def system_timezone_name() -> str:
    """Return the deployment timezone name for read-only status payloads."""

    value = system_timezone()
    return str(getattr(value, "key", value))


def system_now():
    """Return the current instant represented in the deployment timezone."""

    return django_timezone.now().astimezone(system_timezone())


def system_localdate() -> date:
    """Return today's date according to the deployment timezone."""

    return system_now().date()


def system_localtime(value=None):
    """Represent an aware datetime in the deployment timezone."""

    value = value or django_timezone.now()
    if django_timezone.is_naive(value):
        value = django_timezone.make_aware(value, system_timezone())
    return django_timezone.localtime(value, system_timezone())


def system_date_bounds(start: date | None = None, end: date | None = None):
    """Return an inclusive local-date range as aware datetime boundaries.

    The upper bound is exclusive so an ``end`` date includes its entire local
    day.
    """

    timezone = system_timezone()
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
