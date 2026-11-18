"""Data access for the `cards` collection (Scryfall reference data)."""
from __future__ import annotations

import re

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


def commander_filter_query(
    query: str = "",
    colors: list[str] | None = None,
    max_mv: float | None = None,
    creature_type: str = "",
) -> dict:
    """The picker's filters as a Mongo query fragment.

    `colors` is an *exact* color identity: ["G", "W"] means Selesnya commanders
    only, not anything containing green and white — "I want a GW deck" is how
    players pick. None or [] means no color filter.

    "C" is the colorless mana symbol and combines with colors: it requires a {C}
    pip in the casting cost, hybrid {C/W} included. Ulalek, Fused Atrocity
    ({2}{C/W}{C/U}{C/B}{C/R}{C/G}) is WUBRG + C. On its own, "C" means colorless
    commanders, pip or not — Karn as well as Kozilek — since that's what someone
    asking for "colorless" wants.

    `creature_type` matches a whole word in the subtype half of the type line, so
    "Elf" finds "Legendary Creature — Elf Druid" but not "Elfball" in a name or
    "Self" in rules text.
    """
    q: dict = {}
    if query.strip():
        q["name_normalized"] = {"$regex": _escape_regex(normalize_name(query))}
    identity = [c for c in colors or [] if c != "C"]
    if identity:
        # $size pins the count, $all the members — together, set equality.
        q["color_identity"] = {"$size": len(identity), "$all": identity}
        if "C" in colors:
            q["mana_cost"] = {"$regex": r"\{C[}/]"}
    elif colors:
        q["color_identity"] = {"$size": 0}
    if max_mv is not None:
        q["cmc"] = {"$lte": max_mv}
    if creature_type.strip():
        q["type_line"] = {
            "$regex": rf"—.*\b{_escape_regex(creature_type.strip())}\b",
            "$options": "i",
        }
    return q


async def search_owned_commanders(
    db: AsyncDatabase,
    owned_ids: list[str],
    query: str = "",
    limit: int = 20,
    colors: list[str] | None = None,
    max_mv: float | None = None,
    creature_type: str = "",
) -> list[dict]:
    """Owned cards that can be a commander (legendary creatures, or anything whose
    text says 'can be your commander'), narrowed by the picker's filters."""
    if not owned_ids:
        return []
    mongo_query: dict = {
        **_owned_commander_query(owned_ids),
        **commander_filter_query(query, colors, max_mv, creature_type),
    }
    cursor = db.cards.find(mongo_query).sort("name", 1).limit(limit)
    return [doc async for doc in cursor]


def _owned_commander_query(owned_ids: list[str]) -> dict:
    return {
        "_id": {"$in": owned_ids},
        "legal_commander": "legal",
        "$or": [
            {"type_line": {"$regex": "Legendary.*Creature"}},
            {"oracle_text": {"$regex": "[Cc]an be your commander"}},
        ],
    }


async def owned_commander_ids(db: AsyncDatabase, owned_ids: list[str]) -> set[str]:
    """Which of these owned cards can be a commander — every one, no filters."""
    if not owned_ids:
        return set()
    cursor = db.cards.find(_owned_commander_query(owned_ids), {"_id": 1})
    return {doc["_id"] async for doc in cursor}


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


# "Your commander's color identity" — Command Tower, Arcane Signet, Commander's
# Sphere, Path of Ancestry. Legal in 60-card formats but they make no mana there,
# and Scryfall lists Command Tower as producing all five colors, so the mana base
# picks them first. Card rank would pull the rest in: they're among the most
# played cards anywhere.
_COMMANDER_IDENTITY_RE = re.compile(r"commander['’]?s color identity", re.IGNORECASE)


def needs_a_commander(doc: dict) -> bool:
    """True for cards that do nothing without a commander."""
    return bool(_COMMANDER_IDENTITY_RE.search(doc.get("oracle_text") or ""))


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
    pool = [doc async for doc in cursor if not needs_a_commander(doc)]

    if allowed_colors is not None:
        allowed = set(allowed_colors)
        pool = [doc for doc in pool if card_castable_in(doc, allowed)]

    for doc in pool:
        doc["copies_owned"] = owned_counts.get(doc["_id"], 0)
    pool.sort(key=lambda d: (d.get("cmc") or 0, d.get("name") or ""))
    return pool


async def count_legal_owned(db: AsyncDatabase, owned_ids: list[str], legality_field: str) -> int:
    """How many of the owned cards (distinct oracle ids) are legal under one field."""
    if not owned_ids:
        return 0
    return await db.cards.count_documents({"_id": {"$in": owned_ids}, legality_field: "legal"})


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
