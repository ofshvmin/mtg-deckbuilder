"""Data access for `promo_codes` — single-use codes printed on promo cards.

Each code grants a fixed number of days of Premium to the one account that
redeems it. The document `_id` is the normalized code (no dash), so a lookup is
a primary-key hit and duplicates are impossible:

    { _id: "7K3QM9XD", batch: "magiccon-2026", days: 365, created_at,
      expires_at: ISO | None, redeemed_by: user_id | None, redeemed_at: ISO | None }

Codes use Crockford's base32 alphabet (no I, L, O, U), so a code read off a
card can't be mistyped as a lookalike — and `normalize_code` folds the
lookalikes back anyway.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 8  # 32^8 ≈ 1.1e12 — guessing one of a few hundred live codes is hopeless

_LOOKALIKES = str.maketrans({"O": "0", "I": "1", "L": "1"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(raw: str) -> str:
    """Uppercase, drop dashes and spaces, fold O/I/L to 0/1."""
    cleaned = "".join(ch for ch in raw.upper() if ch.isalnum())
    return cleaned.translate(_LOOKALIKES)


def display_code(code: str) -> str:
    """The printed form: two groups of four, e.g. 7K3Q-M9XD."""
    return f"{code[:4]}-{code[4:]}"


def is_well_formed(code: str) -> bool:
    return len(code) == CODE_LENGTH and all(ch in ALPHABET for ch in code)


async def create_batch(
    db: AsyncDatabase, count: int, days: int, batch: str, expires_at: str | None = None
) -> list[str]:
    """Insert `count` fresh codes and return them. Collisions just retry."""
    created: list[str] = []
    while len(created) < count:
        code = new_code()
        try:
            await db.promo_codes.insert_one(
                {
                    "_id": code,
                    "batch": batch,
                    "days": days,
                    "created_at": _now_iso(),
                    "expires_at": expires_at,
                    "redeemed_by": None,
                    "redeemed_at": None,
                }
            )
        except DuplicateKeyError:
            continue
        created.append(code)
    return created


async def find(db: AsyncDatabase, code: str) -> dict | None:
    return await db.promo_codes.find_one({"_id": code})


async def claim(db: AsyncDatabase, code: str, user_id: str) -> dict | None:
    """Atomically mark an unredeemed, unexpired code as redeemed by `user_id`.

    Returns the code document, or None if it doesn't exist, was already taken,
    or has expired. One conditional update, so two people racing on the same
    code can't both win.
    """
    now = _now_iso()
    return await db.promo_codes.find_one_and_update(
        {
            "_id": code,
            "redeemed_by": None,
            "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}],
        },
        {"$set": {"redeemed_by": user_id, "redeemed_at": now}},
    )


async def list_codes(db: AsyncDatabase, batch: str | None = None) -> list[dict]:
    query = {"batch": batch} if batch else {}
    cursor = db.promo_codes.find(query).sort([("batch", 1), ("created_at", 1)])
    return [doc async for doc in cursor]
