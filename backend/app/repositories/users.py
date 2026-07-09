"""Data access for the `users` collection."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pymongo.asynchronous.database import AsyncDatabase


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


def local_identity(user: dict) -> dict | None:
    """Return the user's `local` identity (holds the password hash), if any."""
    for identity in user.get("identities", []):
        if identity.get("provider") == "local":
            return identity
    return None
