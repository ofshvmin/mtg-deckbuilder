"""Import a Moxfield-format collection CSV into `collection_items` for a user.

Async port of the Phase 1 `import_collection.py`. Each CSV row is matched to a
card by normalized name; unmatched rows are still stored (with oracle_id=None)
and reported, so nothing is silently dropped.

Expected columns (Moxfield export):
  Count, Tradelist Count, Name, Edition, Condition, Language, Foil, Tags,
  Last Modified, Collector Number, Alter, Proxy, Purchase Price
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field

from pymongo.asynchronous.database import AsyncDatabase

from ..repositories import collection as collection_repo
from ..util import normalize_name


@dataclass
class ImportResult:
    total: int = 0
    matched: int = 0
    unmatched: int = 0
    unique_owned: int = 0
    unmatched_names: list[str] = field(default_factory=list)


def _parse_int(value, default=0) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except (ValueError, TypeError):
        return default


def _parse_float(value):
    try:
        return float(value) if value not in (None, "") else None
    except (ValueError, TypeError):
        return None


async def _name_to_oracle_id(db: AsyncDatabase) -> dict[str, str]:
    cursor = db.cards.find({}, {"_id": 1, "name_normalized": 1})
    return {doc["name_normalized"]: doc["_id"] async for doc in cursor}


async def import_collection(db: AsyncDatabase, user_id: str, csv_text: str) -> ImportResult:
    name_map = await _name_to_oracle_id(db)
    if not name_map:
        raise RuntimeError("The cards collection is empty — run the Scryfall sync first.")

    items: list[dict] = []
    result = ImportResult()
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        name = (row.get("Name") or "").strip()
        if not name:
            continue
        name_norm = normalize_name(name)
        oracle_id = name_map.get(name_norm)
        result.total += 1
        if oracle_id is None:
            result.unmatched += 1
            result.unmatched_names.append(name)
        else:
            result.matched += 1
        items.append(
            {
                "user_id": user_id,
                "oracle_id": oracle_id,
                "name": name,
                "name_normalized": name_norm,
                "count": _parse_int(row.get("Count"), 1),
                "tradelist_count": _parse_int(row.get("Tradelist Count"), 0),
                "edition": row.get("Edition"),
                "condition": row.get("Condition"),
                "language": row.get("Language"),
                "foil": row.get("Foil"),
                "tags": row.get("Tags"),
                "collector_number": row.get("Collector Number"),
                "altered": row.get("Alter"),
                "proxy": row.get("Proxy"),
                "purchase_price": _parse_float(row.get("Purchase Price")),
            }
        )

    await collection_repo.replace_user_collection(db, user_id, items)
    result.unique_owned = await collection_repo.unique_owned_count(db, user_id)
    return result
