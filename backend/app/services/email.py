"""Send transactional emails via SMTP (password reset, etc.)."""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from ..config import get_settings

log = logging.getLogger(__name__)


def _configured() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.smtp_from)


def send_reset_email(to: str, reset_url: str) -> bool:
    """Send a password-reset email. Returns True on success, False if SMTP is
    not configured or sending fails (caller should still return 200 to avoid
    leaking whether an account exists).
    """
    if not _configured():
        log.warning("SMTP not configured — reset email not sent to %s", to)
        return False

    settings = get_settings()
    msg = EmailMessage()
    msg["Subject"] = "Reset your Grimoire password"
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg.set_content(
        f"Hi,\n\n"
        f"Someone requested a password reset for your Grimoire account.\n\n"
        f"Click the link below to set a new password (expires in 1 hour):\n\n"
        f"  {reset_url}\n\n"
        f"If you didn't request this, you can safely ignore this email.\n\n"
        f"— Grimoire"
    )
    msg.add_alternative(
        f"""<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#e2e8f0;background:#0f172a;border-radius:16px">
  <h2 style="margin:0 0 16px;color:#f1f5f9">Reset your password</h2>
  <p style="margin:0 0 24px;line-height:1.6;color:#94a3b8">
    Someone requested a password reset for your Grimoire account.
    Click the button below to set a new password. This link expires in 1 hour.
  </p>
  <a href="{reset_url}"
     style="display:inline-block;padding:12px 28px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
    Reset password
  </a>
  <p style="margin:24px 0 0;font-size:13px;color:#64748b">
    If you didn't request this, you can safely ignore this email.
  </p>
</div>""",
        subtype="html",
    )

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            server.starttls()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception:
        log.exception("Failed to send reset email to %s", to)
        return False
