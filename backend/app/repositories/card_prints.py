"""Data access for `card_prints` (per-printing Scryfall CDN image URLs)."""
from __future__ import annotations

from pymongo.asynchronous.database import AsyncDatabase


async def count(db: AsyncDatabase) -> int:
    return await db.card_prints.count_documents({})


async def replace_all(db: AsyncDatabase, docs: list[dict], batch_size: int = 5000) -> int:
    """Replace the entire card_prints collection with fresh data."""
    await db.card_prints.delete_many({})
    for i in range(0, len(docs), batch_size):
        await db.card_prints.insert_many(docs[i : i + batch_size], ordered=False)
    return await count(db)


async def enrich_printings(
    db: AsyncDatabase,
    named_printings: list[tuple[str, list[dict]]],
) -> None:
    """Attach per-printing ``image_uris`` to printing dicts, in-place.

    *named_printings* is a list of ``(card_name, printings_list)`` tuples.
    For each printing with (edition, collector_number) we match by
    (set, collector_number); for printings with only edition we fall back
    to (name_lower, set) and also backfill the missing collector_number.

    At most 2 DB queries total, regardless of how many cards/printings.
    """
    # Partition by lookup strategy.
    set_cn_keys: set[tuple[str, str]] = set()
    name_set_keys: set[tuple[str, str]] = set()

    for card_name, prints in named_printings:
        name_lower = card_name.lower()
        for p in prints:
            ed = (p.get("edition") or "").lower()
            cn = p.get("collector_number") or ""
            if ed and cn:
                set_cn_keys.add((ed, cn))
            elif ed:
                name_set_keys.add((name_lower, ed))

    # Batch fetch (2 queries max).
    set_cn_map: dict[tuple[str, str], dict] = {}
    if set_cn_keys:
        cursor = db.card_prints.find(
            {"$or": [{"set": s, "collector_number": cn} for s, cn in set_cn_keys]}
        )
        async for doc in cursor:
            set_cn_map[(doc["set"], doc["collector_number"])] = doc

    name_set_map: dict[tuple[str, str], dict] = {}
    if name_set_keys:
        cursor = db.card_prints.find(
            {"$or": [{"name_lower": n, "set": s} for n, s in name_set_keys]}
        )
        async for doc in cursor:
            key = (doc["name_lower"], doc["set"])
            # Keep the first match (there might be multiple printings in the
            # same set with different collector numbers — e.g. borderless).
            if key not in name_set_map:
                name_set_map[key] = doc

    if not set_cn_map and not name_set_map:
        return

    # Distribute results back into the printing dicts.
    for card_name, prints in named_printings:
        name_lower = card_name.lower()
        for p in prints:
            ed = (p.get("edition") or "").lower()
            cn = p.get("collector_number") or ""
            doc = None
            if ed and cn:
                doc = set_cn_map.get((ed, cn))
            elif ed:
                doc = name_set_map.get((name_lower, ed))
            if not doc:
                continue
            if doc.get("image_uris"):
                p["image_uris"] = doc["image_uris"]
            if doc.get("image_uris_back"):
                p["image_uris_back"] = doc["image_uris_back"]
            # Backfill missing collector_number so CDN URLs work next time.
            if not p.get("collector_number") and doc.get("collector_number"):
                p["collector_number"] = doc["collector_number"]
