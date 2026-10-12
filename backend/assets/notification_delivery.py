"""Daily, explicit-opt-in email digests; one durable record per recipient/day."""
import hashlib
import os
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from .models import NotificationDelivery, Person
from .reporting.alerts import build_alerts_payload
from .smtp import send_smtp_message, SmtpConfigurationError
from .system_settings import get_notification_policy
from .runtime_clock import system_now
from .maintenance_gate import _root, _sync_directory


def suppress_restored_notifications():
    """Keep restore-day SMTP suppression outside the restored database."""
    root = _root()
    descriptor = os.open(root / "digest-suppressed-date", os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(str(system_now().date()))
        handle.flush()
        os.fsync(handle.fileno())
    _sync_directory(root)

LABELS = {
    "zh-CN": {"maintenance": "维保到期", "license": "软件许可", "fault": "未关闭故障", "inventory": "逾期盘点", "spare": "备件低库存"},
    "en-US": {"maintenance": "Maintenance expiry", "license": "Software licenses", "fault": "Unresolved faults", "inventory": "Overdue inventory", "spare": "Low spare stock"},
}
PATHS = {"maintenance": "/assets", "license": "/licenses", "fault": "/repairs", "inventory": "/inventory", "spare": "/spares"}


def _safe_subject_part(value):
    return "".join(" " if ord(char) < 32 or ord(char) == 127 else char for char in str(value or "")).strip()


def digest_content(setting, payload):
    labels = LABELS.get(setting.default_locale, LABELS["zh-CN"])
    title = "每日业务提醒" if setting.default_locale == "zh-CN" else "Daily operational digest"
    display_name = _safe_subject_part(setting.branding_display_name) or "infrix"
    subject = f"{display_name} — {title} — {system_now().date()}"
    lines = [subject, ""]
    for kind, label in labels.items():
        alerts = [item for item in payload["alerts"] if item["kind"] == kind]
        if not alerts:
            continue
        lines.append(label)
        for item in alerts:
            text = " · ".join(str(item[key]) for key in ("asset_no", "asset_name", "code", "name", "reference", "due_date", "due_at") if item.get(key))
            lines.append(f"- {text}")
        lines.extend([setting.application_url.rstrip("/") + PATHS[kind], ""])
    # The notification center caps its current item list; make truncation explicit.
    lines.append(("提醒总数：" if setting.default_locale == "zh-CN" else "Total alerts: ") + str(payload["summary"]["total"]))
    if payload["summary"]["total"] > len(payload["alerts"]):
        lines.append("仅列出前 100 项，请打开系统查看全部。" if setting.default_locale == "zh-CN" else "First 100 items shown; open the application for all items.")
    return subject, "\n".join(lines)


def digest_recipients(setting):
    """Resolve selected people at send time, then append explicit extra addresses."""

    people_ids = [int(value) for value in (setting.email_digest_people or []) if str(value).isdigit()]
    people = {
        person.pk: person
        for person in Person.objects.select_related("account").filter(
            pk__in=people_ids,
            is_active=True,
        )
    }
    addresses = []
    for person_id in people_ids:
        address = people[person_id].notification_email() if person_id in people else ""
        if address:
            addresses.append(address)
    addresses.extend(
        str(address).strip().lower()
        for address in (setting.email_digest_recipients or [])
        if str(address).strip()
    )
    return list(dict.fromkeys(addresses))


def send_digest():
    marker = _root() / "digest-suppressed-date"
    if marker.is_symlink():
        raise OSError("Unsafe digest suppression marker")
    try:
        suppressed = marker.read_text().strip()
    except FileNotFoundError:
        suppressed = ""
    if suppressed == str(system_now().date()):
        return {"status": "suppressed", "sent": 0, "failed": 0}
    setting = get_notification_policy()
    if not setting.email_digest_enabled:
        return {"status": "disabled", "sent": 0, "failed": 0}
    recipients = digest_recipients(setting)
    if not recipients or not setting.application_url:
        return {"status": "unconfigured", "sent": 0, "failed": 1}
    payload = build_alerts_payload(setting=setting)
    if not payload["alerts"]:
        return {"status": "empty", "sent": 0, "failed": 0}
    subject, body = digest_content(setting, payload)
    day = system_now().date()
    recipient_count = len(recipients)
    sent = failed = 0
    for recipient in recipients:
        key = hashlib.sha256(recipient.lower().encode()).hexdigest()
        row, _ = NotificationDelivery.objects.get_or_create(window_date=day, recipient_key=key)
        # Persist the claim before contacting SMTP. A process crash leaves an
        # indeterminate record, never a blind automatic resend after acceptance.
        with transaction.atomic():
            row = NotificationDelivery.objects.select_for_update().get(pk=row.pk)
            if row.status in {"sent", "sending", "unknown"}:
                continue
            now = timezone.now()
            if row.attempts >= 3 or (row.attempted_at and now - row.attempted_at < timedelta(hours=1)):
                continue
            row.status = "sending"
            row.attempts += 1
            row.attempted_at = now
            row.recipient_count = recipient_count
            row.save()
        try:
            send_smtp_message(recipient, subject, body)
        except SmtpConfigurationError as exc:
            # SMTP disconnects can happen after acceptance. Keep those
            # indeterminate instead of risking duplicate delivery.
            row.status = "unknown" if exc.code == "delivery_failed" and not getattr(exc, "retry_safe", False) else "failed"
            row.error_code = exc.code
            failed += 1
        else:
            row.status = "sent"
            row.error_code = ""
            row.sent_at = timezone.now()
            sent += 1
        row.save()
    return {"status": "failed" if failed else "complete", "sent": sent, "failed": failed}
