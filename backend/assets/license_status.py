"""Shared software-license status rules for list and dashboard reporting."""

from datetime import timedelta

from django.db.models import Case, CharField, Count, F, Q, Value, When
from django.utils import timezone

from .models import SoftwareLicense

LICENSE_STATUS_KEYS = ("normal", "expiring", "expired", "over_limit")


def license_status_value(obj, today=None):
    """Return the mutually-exclusive status used by the license UI."""
    today = today or timezone.localdate()
    if obj.used_count > obj.authorized_count:
        return "over_limit"
    if obj.expiry_date and obj.expiry_date < today:
        return "expired"
    if obj.expiry_date and obj.expiry_date <= today + timedelta(days=90):
        return "expiring"
    return "normal"


def license_status_expression(today=None):
    """Build the database expression matching :func:`license_status_value`."""
    today = today or timezone.localdate()
    expiry_limit = today + timedelta(days=90)
    return Case(
        When(used_count__gt=F("authorized_count"), then=Value("over_limit")),
        When(expiry_date__lt=today, then=Value("expired")),
        When(
            expiry_date__gte=today,
            expiry_date__lte=expiry_limit,
            then=Value("expiring"),
        ),
        default=Value("normal"),
        output_field=CharField(),
    )


def filter_licenses_by_status(queryset, status, today=None):
    """Apply the same status semantics as the serialized license status."""
    today = today or timezone.localdate()
    expiry_limit = today + timedelta(days=90)
    within_limit = Q(used_count__lte=F("authorized_count"))
    if status == "over_limit":
        return queryset.filter(used_count__gt=F("authorized_count"))
    if status == "expired":
        return queryset.filter(within_limit, expiry_date__lt=today)
    if status == "expiring":
        return queryset.filter(
            within_limit,
            expiry_date__gte=today,
            expiry_date__lte=expiry_limit,
        )
    if status == "normal":
        return queryset.filter(within_limit).filter(
            Q(expiry_date__isnull=True) | Q(expiry_date__gt=expiry_limit)
        )
    return queryset


def license_status_counts(queryset=None, today=None):
    """Return one mutually-exclusive count for every license status."""
    queryset = queryset if queryset is not None else SoftwareLicense.objects.all()
    rows = (
        queryset.annotate(_license_status=license_status_expression(today))
        .values("_license_status")
        .annotate(count=Count("id"))
    )
    counts = {status: 0 for status in LICENSE_STATUS_KEYS}
    for row in rows:
        counts[row["_license_status"]] = row["count"]
    counts["total"] = sum(counts.values())
    return counts
