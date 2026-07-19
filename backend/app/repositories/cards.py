"""Data access for the `cards` collection (Scryfall reference data)."""
from __future__ import annotations

from pymongo import ReplaceOne
from pymongo.asynchronous.database import AsyncDatabase

from ..util import card_castable_in, normalize_name


async def count(db: AsyncDatabase) -> int:
    return await db.cards.count_documents({})


async def replace_all(db: AsyncDatabase, docs: list[dict], batch_size: int = 5000) -> int:
    """Replace the entire cards collection with a fresh Scryfall pull.

    Done as batched upserts keyed on `_id`, then a prune of any oracle_ids Scryfall
    no longer returns. Deliberately NOT delete-then-insert: that leaves the collection
    empty for the duration of the sync, so every pool/search query in flight returns
    nothing. Commander legality never changes, so re-syncs were rare enough to hide
    this; format rotation makes them routine.

    Reads during a sync see a mix of old and new documents. Both are valid card data,
    so that's a safe intermediate state — unlike an empty collection.
    """
    if not docs:
        return await count(db)

    for i in range(0, len(docs), batch_size):
        batch = docs[i : i + batch_size]
        await db.cards.bulk_write(
            [ReplaceOne({"_id": doc["_id"]}, doc, upsert=True) for doc in batch],
            ordered=False,
        )

    # Prune oracle_ids Scryfall no longer returns. Diffed in Python rather than with
    # a 30k-element $nin: the stale set is normally empty or tiny, so this turns a
    # very large query into a small one (or none at all).
    fresh_ids = {doc["_id"] for doc in docs}
    existing_ids = {doc["_id"] async for doc in db.cards.find({}, {"_id": 1})}
    stale_ids = existing_ids - fresh_ids
    if stale_ids:
        await db.cards.delete_many({"_id": {"$in": list(stale_ids)}})
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


async def search_owned_commanders(
    db: AsyncDatabase, owned_ids: list[str], query: str = "", limit: int = 20
) -> list[dict]:
    """Owned cards that can be a commander (legendary creatures, or anything whose
    text says 'can be your commander'), optionally filtered by a name substring."""
    if not owned_ids:
        return []
    mongo_query: dict = {
        "_id": {"$in": owned_ids},
        "legal_commander": "legal",
        "$or": [
            {"type_line": {"$regex": "Legendary.*Creature"}},
            {"oracle_text": {"$regex": "[Cc]an be your commander"}},
        ],
    }
    if query.strip():
        mongo_query["name_normalized"] = {"$regex": _escape_regex(normalize_name(query))}
    cursor = db.cards.find(mongo_query).sort("name", 1).limit(limit)
    return [doc async for doc in cursor]


async def search_all_commanders(
    db: AsyncDatabase, query: str = "", limit: int = 10
) -> list[dict]:
    """All commander-eligible cards matching a name substring (for Explore autocomplete)."""
    mongo_query: dict = {
        "legal_commander": "legal",
        "$or": [
            {"type_line": {"$regex": "Legendary.*Creature"}},
            {"oracle_text": {"$regex": "[Cc]an be your commander"}},
        ],
    }
    if query.strip():
        mongo_query["name_normalized"] = {"$regex": _escape_regex(normalize_name(query))}
    cursor = db.cards.find(mongo_query).sort("name", 1).limit(limit)
    return [doc async for doc in cursor]


async def get_constructed_pool(
    db: AsyncDatabase,
    legality_field: str,
    owned_counts: dict[str, int],
    allowed_colors: list[str] | None = None,
) -> list[dict]:
    """Owned cards legal in a 60-card constructed format, with `copies_owned` attached.

    Sibling to `get_legal_pool` rather than a generalization of it — Commander's
    color-identity-subset rule and this one are genuinely different questions, and
    keeping them apart means the Commander path is provably untouched.

    `allowed_colors=None` returns the whole legal pool unfiltered. That's the normal
    case: color selection happens at generation time, not pool time, so the frontend
    can retoggle colors without refetching.

    The color test is applied in Python because castability is a mana-cost question
    (see `util.card_castable_in`) rather than a field comparison, and lands are judged
    differently from spells — neither is cleanly one Mongo clause. The owned set is
    small enough that this is free.
    """
    owned_ids = list(owned_counts)
    if not owned_ids:
        return []
    cursor = db.cards.find({"_id": {"$in": owned_ids}, legality_field: "legal"})
    pool = [doc async for doc in cursor]

    if allowed_colors is not None:
        allowed = set(allowed_colors)
        pool = [doc for doc in pool if card_castable_in(doc, allowed)]

    for doc in pool:
        doc["copies_owned"] = owned_counts.get(doc["_id"], 0)
    pool.sort(key=lambda d: (d.get("cmc") or 0, d.get("name") or ""))
    return pool


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
