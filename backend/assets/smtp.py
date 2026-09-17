"""Concrete SMTP test-mail integration for the system settings boundary."""

from __future__ import annotations

from email.utils import formataddr
from smtplib import SMTPAuthenticationError, SMTPRecipientsRefused, SMTPSenderRefused, SMTPDataError, SMTPConnectError

from django.core.mail import EmailMessage, get_connection

from .configuration_secrets import ConfigurationSecretError, decrypt_secret


class SmtpConfigurationError(Exception):
    """A safe, user-facing SMTP configuration or delivery failure."""

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _configured_password(setting) -> str:
    if not setting.smtp_password_encrypted:
        return ""
    try:
        return decrypt_secret(setting.smtp_password_encrypted)
    except ConfigurationSecretError as exc:
        raise SmtpConfigurationError(
            "secret_unavailable",
            "SMTP 密码无法解密，请检查部署密钥后重新保存密码",
        ) from exc


def send_smtp_test_email(setting, recipient: str) -> None:
    """Send one synchronous test message using only the saved configuration."""

    send_smtp_message(setting, recipient, "infrix SMTP test email", "This is a test email sent by infrix.")


def send_smtp_message(setting, recipient: str, subject: str, body: str) -> None:
    """Send through the existing encrypted SMTP configuration boundary."""

    if not setting.smtp_enabled:
        raise SmtpConfigurationError("smtp_disabled", "请先启用 SMTP")
    if not setting.smtp_host.strip() or not setting.smtp_from_email.strip():
        raise SmtpConfigurationError("smtp_incomplete", "SMTP 服务端和发件人邮箱不能为空")
    if any(
        any(char in str(getattr(setting, field, "")) for char in ("\r", "\n"))
        for field in ("smtp_host", "smtp_username", "smtp_from_email", "smtp_from_name")
    ):
        raise SmtpConfigurationError("smtp_incomplete", "SMTP 配置包含无效字符")

    password = _configured_password(setting)
    if setting.smtp_username.strip() and not password:
        raise SmtpConfigurationError("password_missing", "SMTP 用户名已配置，但服务密码尚未配置")

    mode = setting.smtp_security_mode
    connection = get_connection(
        backend="django.core.mail.backends.smtp.EmailBackend",
        host=setting.smtp_host.strip(),
        port=setting.smtp_port,
        username=setting.smtp_username.strip() or None,
        password=password or None,
        use_tls=mode == "starttls",
        use_ssl=mode == "ssl",
        timeout=setting.smtp_timeout,
        fail_silently=False,
    )
    from_email = setting.smtp_from_email.strip()
    if setting.smtp_from_name.strip():
        from_email = formataddr((setting.smtp_from_name.strip(), from_email))
    message = EmailMessage(
        subject=subject,
        body=body,
        from_email=from_email,
        to=[recipient],
        connection=connection,
    )
    try:
        sent = message.send(fail_silently=False)
    except Exception as exc:
        error = SmtpConfigurationError(
            "delivery_failed",
            "无法发送测试邮件，请检查 SMTP 地址、端口、安全模式和账号配置",
        )
        error.retry_safe = isinstance(exc, (ConnectionRefusedError, SMTPAuthenticationError, SMTPRecipientsRefused, SMTPSenderRefused, SMTPDataError, SMTPConnectError))
        raise error from exc
    if sent != 1:
        raise SmtpConfigurationError("delivery_failed", "测试邮件未发送成功")
