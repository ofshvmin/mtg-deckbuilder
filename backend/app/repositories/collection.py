"""Data access for `collection_items` (a user's owned cards, one doc per CSV line)."""
from __future__ import annotations

from pymongo.asynchronous.database import AsyncDatabase


async def replace_user_collection(
    db: AsyncDatabase, user_id: str, items: list[dict]
) -> int:
    """Replace all of a user's collection rows with a freshly imported set."""
    await db.collection_items.delete_many({"user_id": user_id})
    if items:
        await db.collection_items.insert_many(items, ordered=False)
    return len(items)


async def owned_counts(db: AsyncDatabase, user_id: str) -> dict[str, int]:
    """Map of oracle_id -> total copies owned across all printings, for a user.

    Rows that never matched a card (oracle_id = None) are skipped.
    """
    pipeline = [
        {"$match": {"user_id": user_id, "oracle_id": {"$ne": None}}},
        {"$group": {"_id": "$oracle_id", "copies": {"$sum": "$count"}}},
    ]
    result: dict[str, int] = {}
    cursor = await db.collection_items.aggregate(pipeline)
    async for row in cursor:
        result[row["_id"]] = row["copies"]
    return result


async def unique_owned_count(db: AsyncDatabase, user_id: str) -> int:
    ids = await db.collection_items.distinct(
        "oracle_id", {"user_id": user_id, "oracle_id": {"$ne": None}}
    )
    return len(ids)


async def list_items(db: AsyncDatabase, user_id: str) -> list[dict]:
    cursor = db.collection_items.find({"user_id": user_id})
    return [doc async for doc in cursor]
