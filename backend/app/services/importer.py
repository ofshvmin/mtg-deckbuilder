"""Import a collection CSV/Excel file into `collection_items` for a user.

Supports Moxfield, Archidekt, Dragon Shield, Deckbox, and ManaBox formats
in CSV, XLSX, or XLS containers. The format is auto-detected from headers,
or can be specified explicitly.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from pymongo.asynchronous.database import AsyncDatabase

from ..repositories import collection as collection_repo
from ..util import normalize_name
from . import csv_formats


@dataclass
class ImportResult:
    total: int = 0
    matched: int = 0
    unmatched: int = 0
    unique_owned: int = 0
    unmatched_names: list[str] = field(default_factory=list)
    detected_format: str | None = None


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


async def import_collection(
    db: AsyncDatabase,
    user_id: str,
    csv_text: str | None = None,
    format_name: str | None = None,
    excel_bytes: bytes | None = None,
) -> ImportResult:
    name_map = await _name_to_oracle_id(db)
    if not name_map:
        raise RuntimeError("The cards collection is empty — run the Scryfall sync first.")

    if excel_bytes is not None:
        headers, rows = csv_formats.parse_excel(excel_bytes)
    elif csv_text is not None:
        headers, rows = csv_formats.parse_csv(csv_text)
    else:
        raise ValueError("Either csv_text or excel_bytes must be provided.")

    supported = ", ".join(f.name for f in csv_formats.FORMATS)
    if format_name:
        fmt = csv_formats.get_format_by_name(format_name)
        if fmt is None:
            raise ValueError(f"Unknown format '{format_name}'. Supported: {supported}")
    else:
        fmt = csv_formats.detect_format(headers)
        if fmt is None:
            raise ValueError(f"Could not detect format. Supported: {supported}")

    items: list[dict] = []
    result = ImportResult(detected_format=fmt.name)
    for row in rows:
        canonical = csv_formats.normalize_row(row, fmt)
        name = canonical.get("name", "").strip()
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
                "count": _parse_int(canonical.get("count"), 1),
                "tradelist_count": _parse_int(canonical.get("tradelist_count"), 0),
                "edition": canonical.get("edition"),
                "condition": canonical.get("condition"),
                "language": canonical.get("language"),
                "foil": canonical.get("foil"),
                "tags": canonical.get("tags"),
                "collector_number": canonical.get("collector_number"),
                "altered": canonical.get("altered"),
                "proxy": canonical.get("proxy"),
                "purchase_price": _parse_float(canonical.get("purchase_price")),
            }
        )

    await collection_repo.replace_user_collection(db, user_id, items)
    result.unique_owned = await collection_repo.unique_owned_count(db, user_id)
    return result
