"""Data access for `collection_items` (a user's owned cards, one doc per CSV line)."""
from __future__ import annotations

from pymongo.asynchronous.database import AsyncDatabase

from ..util import printing_key


async def replace_user_collection(
    db: AsyncDatabase, user_id: str, items: list[dict]
) -> int:
    """Replace all of a user's collection rows with a freshly imported set.

    Deletes every existing row for this user first, waits for the delete to
    fully acknowledge, then inserts the new rows. This ensures a re-import
    always produces a clean replacement, never duplicates.
    """
    result = await db.collection_items.delete_many({"user_id": user_id})
    # Force a round-trip to confirm the delete completed before inserting.
    await db.collection_items.count_documents({"user_id": user_id})
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


async def owned_printings(db: AsyncDatabase, user_id: str) -> dict[str, list[dict]]:
    """Map of oracle_id -> the distinct printing units the user owns of that card.

    Each unit is one physical inventory line: a specific (edition, collector
    number, finish, condition, language) combination, with the total count owned
    and a stable ``printing_key``. Rows that never matched a card (oracle_id =
    None) are skipped — they can't be attached to a deck card.

    This is the counterpart to ``owned_counts`` (which collapses every printing
    into a single number for legality/inclusion math). Here we keep the printings
    apart so the deck output can tell Danko *which physical card* to pull.
    """
    pipeline = [
        {"$match": {"user_id": user_id, "oracle_id": {"$ne": None}}},
        {
            "$group": {
                "_id": {
                    "oracle_id": "$oracle_id",
                    "edition": "$edition",
                    "collector_number": "$collector_number",
                    "foil": "$foil",
                    "condition": "$condition",
                    "language": "$language",
                },
                "count": {"$sum": "$count"},
                "purchase_price": {"$first": "$purchase_price"},
                "added_at": {"$min": "$added_at"},
            }
        },
    ]
    result: dict[str, list[dict]] = {}
    cursor = await db.collection_items.aggregate(pipeline)
    async for row in cursor:
        g = row["_id"]
        oracle_id = g["oracle_id"]
        finish = "foil" if str(g.get("foil") or "").strip().lower() in {"foil", "etched"} else "nonfoil"
        unit = {
            "printing_key": printing_key(g.get("edition"), g.get("collector_number"), g.get("foil")),
            "edition": g.get("edition") or None,
            "collector_number": g.get("collector_number") or None,
            "finish": finish,
            "condition": g.get("condition") or None,
            "language": g.get("language") or None,
            "count": row["count"],
            "purchase_price": row.get("purchase_price"),
            "added_at": row.get("added_at"),
        }
        result.setdefault(oracle_id, []).append(unit)
    # Stable display order: set code, then collector number, then finish.
    for units in result.values():
        units.sort(key=lambda u: (u["edition"] or "", u["collector_number"] or "", u["finish"]))
    return result


async def list_collection_cards(db: AsyncDatabase, user_id: str) -> list[dict]:
    """One row per owned oracle card, with its oracle data + owned printings.

    Powers the collection browser: distinct cards (not printing lines), each
    carrying the total copies owned and the list of physical printing units.
    Sorted by name. Cards whose oracle_id is unknown to the `cards` collection
    are skipped (can't render oracle data for them).
    """
    printings = await owned_printings(db, user_id)
    if not printings:
        return []
    oracle_ids = list(printings.keys())
    cards: dict[str, dict] = {}
    cursor = db.cards.find({"_id": {"$in": oracle_ids}})
    async for doc in cursor:
        cards[doc["_id"]] = doc

    rows: list[dict] = []
    for oracle_id, units in printings.items():
        card = cards.get(oracle_id)
        if card is None:
            continue
        rows.append(
            {
                "oracle_id": oracle_id,
                "name": card.get("name", ""),
                "mana_cost": card.get("mana_cost", ""),
                "cmc": card.get("cmc", 0.0),
                "type_line": card.get("type_line", ""),
                "color_identity": card.get("color_identity", []),
                "oracle_text": card.get("oracle_text", ""),
                "total_count": sum(u["count"] for u in units),
                "printings": units,
            }
        )
    rows.sort(key=lambda r: r["name"].lower())
    return rows


async def unique_owned_count(db: AsyncDatabase, user_id: str) -> int:
    ids = await db.collection_items.distinct(
        "oracle_id", {"user_id": user_id, "oracle_id": {"$ne": None}}
    )
    return len(ids)


async def total_copies(db: AsyncDatabase, user_id: str) -> int:
    """Sum of `count` across all of a user's matched collection rows."""
    pipeline = [
        {"$match": {"user_id": user_id, "oracle_id": {"$ne": None}}},
        {"$group": {"_id": None, "total": {"$sum": "$count"}}},
    ]
    cursor = await db.collection_items.aggregate(pipeline)
    async for row in cursor:
        return row["total"]
    return 0


async def list_items(db: AsyncDatabase, user_id: str) -> list[dict]:
    cursor = db.collection_items.find({"user_id": user_id}).sort("name", 1)
    return [doc async for doc in cursor]


async def add_item(db: AsyncDatabase, user_id: str, item: dict) -> None:
    """Add a single card to the user's collection."""
    item["user_id"] = user_id
    await db.collection_items.insert_one(item)


async def remove_item(db: AsyncDatabase, user_id: str, oracle_id: str) -> bool:
    """Remove all copies of a card (by oracle_id) from the user's collection."""
    result = await db.collection_items.delete_many(
        {"user_id": user_id, "oracle_id": oracle_id}
    )
    return result.deleted_count > 0


async def batch_add_items(db: AsyncDatabase, user_id: str, items: list[dict]) -> int:
    """Bulk-insert multiple cards into the user's collection. Returns count added."""
    if not items:
        return 0
    for item in items:
        item["user_id"] = user_id
    await db.collection_items.insert_many(items, ordered=False)
    return len(items)
