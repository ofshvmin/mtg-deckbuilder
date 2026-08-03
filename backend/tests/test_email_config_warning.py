"""Startup warnings for unsendable password-reset email.

/auth/forgot-password must return 200 whether or not the mail went out, so it
cannot leak which addresses have accounts. The cost of that is a mailer whose
failure is invisible from outside: prod ran with no SMTP secrets at all and
every client saw success. These pin the startup log that is the only signal.
"""
import logging
from types import SimpleNamespace

import pytest

from app import main

CONFIGURED = {
    "smtp_host": "smtp.resend.com",
    "smtp_from": "Grimoire <noreply@dankodev.com>",
    "smtp_password": "re_key",
    "frontend_url": "https://grimoire.dankodev.app",
}


@pytest.fixture
def settings(monkeypatch):
    """Swap the module-level settings the warning reads."""

    def _apply(**overrides):
        monkeypatch.setattr(main, "settings", SimpleNamespace(**{**CONFIGURED, **overrides}))

    return _apply


def _warnings(caplog):
    # getMessage() applies the record's % args; caplog's .message is already formatted.
    return [r.getMessage() for r in caplog.records]


class TestDisabledMailer:
    def test_warns_when_nothing_is_configured(self, settings, caplog):
        settings(smtp_host="", smtp_from="", smtp_password="")
        with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
            main._warn_if_email_disabled()
        assert any("DISABLED" in m for m in _warnings(caplog))

    def test_names_the_unset_variables(self, settings, caplog):
        """The operator needs to know which knob to turn, not just that it broke."""
        settings(smtp_host="", smtp_from="")
        with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
            main._warn_if_email_disabled()
        message = " ".join(_warnings(caplog))
        assert "SMTP_HOST" in message and "SMTP_FROM" in message

    def test_missing_sender_alone_still_disables(self, settings, caplog):
        # send_reset_email requires both, so a host without a sender is dead too.
        settings(smtp_from="")
        with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
            main._warn_if_email_disabled()
        message = " ".join(_warnings(caplog))
        assert "DISABLED" in message and "SMTP_FROM" in message and "SMTP_HOST" not in message


class TestPartialConfiguration:
    def test_warns_when_password_is_missing(self, settings, caplog):
        """Host and sender alone satisfy send_reset_email's check, so this
        combination looks configured until the relay rejects the send."""
        settings(smtp_password="")
        with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
            main._warn_if_email_disabled()
        assert any("SMTP_PASSWORD" in m for m in _warnings(caplog))

    def test_warns_when_frontend_url_is_still_localhost(self, settings, caplog):
        """The bug that shipped: reset links pointing at a dev default."""
        settings(frontend_url="http://localhost:5173")
        with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
            main._warn_if_email_disabled()
        assert any("localhost" in m for m in _warnings(caplog))

    def test_localhost_url_is_not_reported_when_mail_is_off(self, settings, caplog):
        # With no mailer there are no links to get wrong; one clear warning beats two.
        settings(smtp_host="", smtp_from="", frontend_url="http://localhost:5173")
        with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
            main._warn_if_email_disabled()
        assert not any("localhost" in m for m in _warnings(caplog))


class TestHealthyConfiguration:
    def test_fully_configured_is_silent(self, settings, caplog):
        settings()
        with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
            main._warn_if_email_disabled()
        assert _warnings(caplog) == []
