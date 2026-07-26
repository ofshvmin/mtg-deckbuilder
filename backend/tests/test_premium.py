"""Unit tests for freemium entitlements: is_premium logic, the Premium-only
dependency, and the RevenueCat webhook that keeps entitlements in sync."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.auth.deps as deps
import app.routers.webhooks as webhooks
from app.repositories.users import is_premium


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# ---- is_premium ----

def test_no_premium_field_is_not_premium():
    assert is_premium({"_id": "u"}) is False


def test_inactive_is_not_premium():
    assert is_premium({"premium": {"active": False}}) is False


def test_lifetime_unlock_is_premium():
    # No expiry => non-expiring lifetime purchase.
    assert is_premium({"premium": {"active": True, "expires_at": None}}) is True


def test_active_subscription_in_future_is_premium():
    future = _iso(datetime.now(timezone.utc) + timedelta(days=5))
    assert is_premium({"premium": {"active": True, "expires_at": future}}) is True


def test_active_but_expired_is_not_premium():
    past = _iso(datetime.now(timezone.utc) - timedelta(days=1))
    assert is_premium({"premium": {"active": True, "expires_at": past}}) is False


def test_malformed_expiry_is_not_premium():
    assert is_premium({"premium": {"active": True, "expires_at": "not-a-date"}}) is False


# ---- require_premium dependency ----

def test_require_premium_blocks_free_user():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(deps.require_premium(current_user={"_id": "u"}))
    assert exc.value.status_code == 402


def test_require_premium_allows_premium_user():
    user = {"_id": "u", "premium": {"active": True, "expires_at": None}}
    assert asyncio.run(deps.require_premium(current_user=user)) is user


# ---- RevenueCat webhook ----

class _FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def _run_webhook(monkeypatch, body, authorization="secret-token", token="secret-token"):
    captured = {}

    async def fake_set_premium(db, user_id, *, active, expires_at=None, product_id=None):
        captured.update(user_id=user_id, active=active,
                        expires_at=expires_at, product_id=product_id)
        return True

    monkeypatch.setattr(webhooks.users_repo, "set_premium", fake_set_premium)
    monkeypatch.setattr(webhooks.db, "get_db", lambda: object())

    class _S:
        revenuecat_webhook_token = token
    monkeypatch.setattr(webhooks, "get_settings", lambda: _S())

    result = asyncio.run(
        webhooks.revenuecat_webhook(_FakeRequest(body), authorization=authorization)
    )
    return result, captured


def test_webhook_rejects_bad_auth(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        _run_webhook(monkeypatch, {"event": {}}, authorization="wrong")
    assert exc.value.status_code == 401


def test_webhook_503_when_unconfigured(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        _run_webhook(monkeypatch, {"event": {}}, authorization="x", token="")
    assert exc.value.status_code == 503


def test_webhook_accepts_bearer_prefixed_token(monkeypatch):
    body = {"event": {"type": "INITIAL_PURCHASE", "app_user_id": "user-1",
                      "expiration_at_ms": None, "product_id": "com.grimoire.mtg.premium.lifetime"}}
    _, captured = _run_webhook(monkeypatch, body, authorization="Bearer secret-token")
    assert captured["user_id"] == "user-1"
    assert captured["active"] is True


def test_webhook_initial_purchase_activates(monkeypatch):
    exp_ms = 2_000_000_000_000  # far-future ms epoch
    body = {"event": {"type": "RENEWAL", "app_user_id": "user-1",
                      "expiration_at_ms": exp_ms, "product_id": "com.grimoire.mtg.premium.monthly"}}
    _, captured = _run_webhook(monkeypatch, body)
    assert captured["active"] is True
    assert captured["expires_at"] is not None


def test_webhook_expiration_deactivates(monkeypatch):
    body = {"event": {"type": "EXPIRATION", "app_user_id": "user-1"}}
    _, captured = _run_webhook(monkeypatch, body)
    assert captured["active"] is False


def test_webhook_cancellation_stays_active(monkeypatch):
    # Cancellation just turns off auto-renew; entitlement is valid until expiry.
    body = {"event": {"type": "CANCELLATION", "app_user_id": "user-1",
                      "expiration_at_ms": 2_000_000_000_000}}
    _, captured = _run_webhook(monkeypatch, body)
    assert captured["active"] is True


def test_webhook_ignores_anonymous_user(monkeypatch):
    body = {"event": {"type": "INITIAL_PURCHASE", "app_user_id": "$RCAnonymousID:abc"}}
    result, captured = _run_webhook(monkeypatch, body)
    assert captured == {}  # set_premium never called
    assert result["ok"] is True
