"""Data access for the `users` collection."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..config import get_settings


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def find_by_email(db: AsyncDatabase, email: str) -> dict | None:
    return await db.users.find_one({"email": email.strip().lower()})


async def find_by_id(db: AsyncDatabase, user_id: str) -> dict | None:
    return await db.users.find_one({"_id": user_id})


async def create_local_user(db: AsyncDatabase, email: str, password_hash: str) -> dict:
    """Create a user with a single `local` (email+password) identity."""
    doc = {
        "_id": uuid.uuid4().hex,
        "email": email.strip().lower(),
        "identities": [{"provider": "local", "password_hash": password_hash}],
        "created_at": _now_iso(),
    }
    await db.users.insert_one(doc)
    return doc


async def update_preferences(db: AsyncDatabase, user_id: str, prefs: dict) -> dict | None:
    """Merge a preferences patch onto the user and return the updated doc."""
    return await db.users.find_one_and_update(
        {"_id": user_id},
        {"$set": {f"preferences.{k}": v for k, v in prefs.items()}},
        return_document=ReturnDocument.AFTER,
    )


async def delete_user(db: AsyncDatabase, user_id: str) -> bool:
    """Permanently delete the user document. Returns True if one was removed.

    Callers are responsible for purging the user's owned data (collection,
    decks) first — see the delete-account endpoint.
    """
    result = await db.users.delete_one({"_id": user_id})
    return result.deleted_count > 0


async def update_password(db: AsyncDatabase, user_id: str, password_hash: str) -> bool:
    """Update the password hash on the user's local identity. Returns True if updated."""
    result = await db.users.update_one(
        {"_id": user_id, "identities.provider": "local"},
        {"$set": {"identities.$.password_hash": password_hash}},
    )
    return result.modified_count > 0


def is_premium_exempt(user: dict) -> bool:
    """Whether the user is permanently exempt from paywall limits.

    Two independent, purchase-free grants — both never expire and are ignored by
    the RevenueCat webhook, so a test account keeps Premium regardless of its
    entitlement state:

    * `premium_exempt: true` on the user document (see scripts/premium_exempt.py)
    * the user's email listed in the PREMIUM_EXEMPT_EMAILS setting
    """
    if user.get("premium_exempt") is True:
        return True
    email = (user.get("email") or "").strip().lower()
    return bool(email) and email in get_settings().premium_exempt_email_set


def is_premium(user: dict) -> bool:
    """Whether the user currently has an active Premium entitlement.

    The `premium` sub-document is maintained by RevenueCat webhooks. A lifetime
    (non-expiring) purchase stores `expires_at = None`; subscriptions store the
    period end, so we treat an active entitlement as lapsed once it passes.
    Exempt accounts (see `is_premium_exempt`) are Premium unconditionally.
    """
    if is_premium_exempt(user):
        return True
    premium = user.get("premium") or {}
    if not premium.get("active"):
        return False
    expires_at = premium.get("expires_at")
    if expires_at is None:
        return True  # lifetime / non-expiring unlock
    try:
        return datetime.fromisoformat(expires_at) > datetime.now(timezone.utc)
    except (ValueError, TypeError):
        return False


async def set_premium(
    db: AsyncDatabase,
    user_id: str,
    *,
    active: bool,
    expires_at: str | None = None,
    product_id: str | None = None,
) -> bool:
    """Upsert the user's Premium entitlement (called from the RevenueCat webhook)."""
    result = await db.users.update_one(
        {"_id": user_id},
        {"$set": {"premium": {
            "active": active,
            "expires_at": expires_at,
            "product_id": product_id,
            "updated_at": _now_iso(),
        }}},
    )
    return result.modified_count > 0


async def set_premium_exempt(db: AsyncDatabase, email: str, exempt: bool) -> bool:
    """Grant/revoke a permanent, purchase-free Premium exemption by email.

    Independent of the `premium` sub-document, so RevenueCat sync can't clear it.
    Returns True if a matching user was found.
    """
    result = await db.users.update_one(
        {"email": email.strip().lower()},
        {"$set": {"premium_exempt": exempt}} if exempt else {"$unset": {"premium_exempt": ""}},
    )
    return result.matched_count > 0


def local_identity(user: dict) -> dict | None:
    """Return the user's `local` identity (holds the password hash), if any."""
    for identity in user.get("identities", []):
        if identity.get("provider") == "local":
            return identity
    return None
