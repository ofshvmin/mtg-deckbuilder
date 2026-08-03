"""Data access for `card_prints` (per-printing Scryfall CDN image URLs + prices)."""
from __future__ import annotations

from pymongo import ReplaceOne
from pymongo.asynchronous.database import AsyncDatabase


async def count(db: AsyncDatabase) -> int:
    return await db.card_prints.count_documents({})


async def replace_all(db: AsyncDatabase, docs: list[dict], batch_size: int = 5000) -> int:
    """Replace the entire card_prints collection with fresh data.

    Batched upserts keyed on `_id`, then prune of any printing ids no longer in the
    bulk file. Not delete-then-insert: that leaves the collection empty during the
    sync, so image/price enrichment returns nothing for every in-flight request.
    """
    if not docs:
        return await count(db)

    for i in range(0, len(docs), batch_size):
        batch = docs[i : i + batch_size]
        await db.card_prints.bulk_write(
            [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in batch],
            ordered=False,
        )

    fresh_ids = {d["_id"] for d in docs}
    existing_ids = {d["_id"] async for d in db.card_prints.find({}, {"_id": 1})}
    stale = existing_ids - fresh_ids
    if stale:
        await db.card_prints.delete_many({"_id": {"$in": list(stale)}})
    return await count(db)


async def art_by_name(db: AsyncDatabase, names: list[str]) -> dict[str, dict]:
    """Map lowercase card name -> ``{"art_crop": url, "artist": name}``.

    Deck banners render Scryfall's ``art_crop``, which their image policy only
    permits alongside the illustrator's credit — so the two are fetched together
    and callers should treat them as a pair. One query for the whole batch;
    printings lacking either field are skipped so a banner never renders
    uncredited. Which printing wins is unimportant (any legal art will do), so
    the first match for a name is kept.
    """
    wanted = {n.lower() for n in names if n}
    if not wanted:
        return {}

    cursor = db.card_prints.find(
        {
            "name_lower": {"$in": list(wanted)},
            "image_uris.art_crop": {"$exists": True},
            "artist": {"$exists": True},
        },
        {"name_lower": 1, "image_uris.art_crop": 1, "artist": 1},
    )
    out: dict[str, dict] = {}
    async for doc in cursor:
        key = doc["name_lower"]
        if key in out:
            continue
        out[key] = {
            "art_crop": doc["image_uris"]["art_crop"],
            "artist": doc["artist"],
        }
    return out


async def set_names(db: AsyncDatabase, codes: list[str]) -> dict[str, str]:
    """Map set code -> display name, for the set picker.

    One aggregation for the whole batch; the ``(set, collector_number)`` index
    covers the match. ``set_name`` only lands on documents written by a sync that
    postdates the set picker, so callers must be ready for a missing name and
    fall back to the code.
    """
    wanted = [c.lower() for c in codes if c]
    if not wanted:
        return {}
    cursor = await db.card_prints.aggregate([
        {"$match": {"set": {"$in": wanted}}},
        {"$group": {"_id": "$set", "name": {"$first": "$set_name"}}},
    ])
    return {row["_id"]: row["name"] async for row in cursor if row.get("name")}


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
            if doc.get("artist"):
                p["artist"] = doc["artist"]
            # Per-printing market price, so the client shows it without a live
            # Scryfall call. Attached here alongside images since it's the same match.
            if doc.get("price_usd") is not None:
                p["price_usd"] = doc["price_usd"]
            if doc.get("price_usd_foil") is not None:
                p["price_usd_foil"] = doc["price_usd_foil"]
            # Backfill missing collector_number so CDN URLs work next time.
            if not p.get("collector_number") and doc.get("collector_number"):
                p["collector_number"] = doc["collector_number"]
