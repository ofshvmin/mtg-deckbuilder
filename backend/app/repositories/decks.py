"""Data access for saved decks."""
from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase


async def save_deck(
    db: AsyncDatabase, user_id: str, name: str, deck_data: dict
) -> str:
    """Save a generated deck. Returns the new deck's ID."""
    doc = {
        "user_id": user_id,
        "name": name,
        "deck": deck_data,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.decks.insert_one(doc)
    return str(result.inserted_id)


async def list_decks(db: AsyncDatabase, user_id: str) -> list[dict]:
    """List all saved decks for a user (metadata only, no full card list)."""
    cursor = db.decks.find(
        {"user_id": user_id},
        {"deck.cards": 0, "deck.combos": 0, "deck.near_combos": 0, "deck.curve": 0},
    ).sort("updated_at", -1)
    results = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        results.append(doc)
    return results


async def get_deck(db: AsyncDatabase, user_id: str, deck_id: str) -> dict | None:
    """Fetch a single saved deck by ID (full data)."""
    try:
        oid = ObjectId(deck_id)
    except Exception:
        return None
    doc = await db.decks.find_one({"_id": oid, "user_id": user_id})
    if doc:
        doc["_id"] = str(doc["_id"])
    return doc


async def delete_deck(db: AsyncDatabase, user_id: str, deck_id: str) -> bool:
    """Delete a saved deck. Returns True if it existed."""
    try:
        oid = ObjectId(deck_id)
    except Exception:
        return False
    result = await db.decks.delete_one({"_id": oid, "user_id": user_id})
    return result.deleted_count > 0
