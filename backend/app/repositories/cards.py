"""Data access for the `cards` collection (Scryfall reference data)."""
from __future__ import annotations

from pymongo.asynchronous.database import AsyncDatabase

from ..util import normalize_name


async def count(db: AsyncDatabase) -> int:
    return await db.cards.count_documents({})


async def replace_all(db: AsyncDatabase, docs: list[dict], batch_size: int = 5000) -> int:
    """Replace the entire cards collection with a fresh Scryfall pull.

    Mirrors the Phase 1 sync semantics (full replace), but in Mongo. Done as
    delete-then-batched-insert so a re-sync is a clean swap.
    """
    await db.cards.delete_many({})
    for i in range(0, len(docs), batch_size):
        await db.cards.insert_many(docs[i : i + batch_size], ordered=False)
    return await count(db)


async def find_by_normalized_name(db: AsyncDatabase, name: str) -> dict | None:
    return await db.cards.find_one({"name_normalized": normalize_name(name)})


async def find_commander(db: AsyncDatabase, name: str) -> dict | None:
    """Exact commander lookup by normalized name (used by the pool query)."""
    return await find_by_normalized_name(db, name)


async def search(db: AsyncDatabase, query: str, limit: int = 20) -> list[dict]:
    """Substring name search (case-insensitive), for suggestions / pickers."""
    norm = normalize_name(query)
    cursor = db.cards.find(
        {"name_normalized": {"$regex": _escape_regex(norm)}}
    ).limit(limit)
    return [doc async for doc in cursor]


async def get_legal_pool(
    db: AsyncDatabase,
    allowed_colors: list[str],
    owned_counts: dict[str, int],
    exclude_oracle_id: str | None = None,
) -> list[dict]:
    """Owned cards that are Commander-legal and whose color identity is a subset
    of `allowed_colors`. Returns card docs with `copies_owned` attached, sorted
    by mana value then name.

    The subset test is the Mongo equivalent of the Phase 1 Python check:
    a card qualifies when color_identity has NO element outside allowed_colors.
    """
    owned_ids = [oid for oid in owned_counts if oid != exclude_oracle_id]
    if not owned_ids:
        return []
    query = {
        "_id": {"$in": owned_ids},
        "legal_commander": "legal",
        "color_identity": {"$not": {"$elemMatch": {"$nin": allowed_colors}}},
    }
    cursor = db.cards.find(query)
    pool = [doc async for doc in cursor]
    for doc in pool:
        doc["copies_owned"] = owned_counts.get(doc["_id"], 0)
    pool.sort(key=lambda d: (d.get("cmc") or 0, d.get("name") or ""))
    return pool


def _escape_regex(text: str) -> str:
    import re

    return re.escape(text)
