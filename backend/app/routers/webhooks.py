"""Inbound webhooks from third-party services.

RevenueCat posts a JSON event whenever a user's entitlement changes (purchase,
renewal, cancellation, expiration, refund). We authenticate the call with a
shared secret and update the user's Premium entitlement accordingly.

The mobile app calls `Purchases.logIn(<our user id>)`, so RevenueCat's
`app_user_id` on each event equals our Mongo user `_id`.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Request, status

from .. import db
from ..config import get_settings
from ..repositories import users as users_repo

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# RevenueCat event types that mean the entitlement is (or remains) active.
# Anything else (chiefly EXPIRATION) deactivates it. CANCELLATION only means
# auto-renew is off — the entitlement stays valid until it EXPIRES, so it is
# intentionally treated as still-active here.
_ACTIVE_EVENTS = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "NON_RENEWING_PURCHASE",
    "SUBSCRIPTION_EXTENDED",
    "CANCELLATION",
    "BILLING_ISSUE",
}
_DEACTIVATING_EVENTS = {"EXPIRATION", "REFUND"}


def _ms_to_iso(ms: int | None) -> str | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


@router.post("/revenuecat", status_code=status.HTTP_200_OK)
async def revenuecat_webhook(
    request: Request,
    authorization: str | None = Header(default=None),
):
    """Sync a user's Premium entitlement from a RevenueCat event."""
    expected = get_settings().revenuecat_webhook_token
    if not expected:
        # Not configured => refuse rather than silently accept unauthenticated calls.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Webhook not configured.")
    if authorization != expected and authorization != f"Bearer {expected}":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook signature.")

    payload = await request.json()
    event = payload.get("event") or {}
    event_type = event.get("type")
    app_user_id = event.get("app_user_id")

    # Anonymous RevenueCat ids aren't linked to one of our accounts; ignore.
    if not app_user_id or app_user_id.startswith("$RCAnonymousID"):
        return {"ok": True, "ignored": "unlinked app_user_id"}

    if event_type in _DEACTIVATING_EVENTS:
        active = False
    elif event_type in _ACTIVE_EVENTS:
        active = True
    else:
        # Unknown/irrelevant event (e.g. TRANSFER, TEST) — acknowledge, do nothing.
        return {"ok": True, "ignored": event_type}

    await users_repo.set_premium(
        db.get_db(),
        app_user_id,
        active=active,
        expires_at=_ms_to_iso(event.get("expiration_at_ms")),
        product_id=event.get("product_id"),
    )
    return {"ok": True}
