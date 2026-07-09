"""Commander Spellbook combo detection (Phase 4b).

Syncs the open Commander Spellbook combo database (json.commanderspellbook.com)
into Mongo as slim docs, then detects which combos a card set assembles. Combos
are matched by Scryfall oracle_id (== our card _id), so detection is exact.

Two detection outputs:
  - full: every piece of the combo is present.
  - near: exactly one piece missing (a "you're one card away" suggestion).
"""
from __future__ import annotations

import httpx
from pymongo.asynchronous.database import AsyncDatabase

BULK_URL = "https://json.commanderspellbook.com/variants.json"
HEADERS = {"User-Agent": "MTGDeckBuilder/0.1 (personal project; daniel.g.mathews@gmail.com)"}
COLORS = set("WUBRG")


def combo_doc(variant: dict) -> dict | None:
    """Transform a Commander Spellbook variant into a slim Mongo combo doc.

    Keeps oracle_ids + names of the cards, the produced features, color identity,
    and popularity. Returns None for combos we can't use (no cards, not Commander-legal).
    """
    oracle_ids, names = [], []
    for use in variant.get("uses", []) or []:
        card = use.get("card") or {}
        oid = card.get("oracleId")
        if oid and oid not in oracle_ids:
            oracle_ids.append(oid)
            names.append(card.get("name"))
    if len(oracle_ids) < 2:
        return None

    legal = (variant.get("legalities") or {}).get("commander")
    is_legal = legal if isinstance(legal, bool) else str(legal).lower() in ("legal", "true", "l")
    if not is_legal:
        return None

    produces = [
        p["feature"]["name"]
        for p in variant.get("produces", []) or []
        if p.get("feature", {}).get("name")
    ]
    identity = [c for c in (variant.get("identity") or "") if c in COLORS]

    return {
        "_id": variant["id"],
        "cards": oracle_ids,
        "card_names": names,
        "produces": produces,
        "identity": identity,
        "popularity": variant.get("popularity") or 0,
    }


async def fetch_combos() -> list[dict]:
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(BULK_URL, headers=HEADERS, timeout=300)
        resp.raise_for_status()
        payload = resp.json()
    variants = payload.get("variants", [])
    docs = [d for v in variants for d in (combo_doc(v),) if d]
    return docs


async def sync(db: AsyncDatabase, batch_size: int = 5000) -> int:
    """Replace the `combos` collection with a fresh Commander Spellbook pull."""
    docs = await fetch_combos()
    await db.combos.delete_many({})
    for i in range(0, len(docs), batch_size):
        await db.combos.insert_many(docs[i : i + batch_size], ordered=False)
    await db.combos.create_index("cards")
    await db.combos.create_index("identity")
    return await db.combos.count_documents({})


async def detect(
    db: AsyncDatabase,
    owned_oracle_ids: set[str],
    identity: list[str],
    near_limit: int = 15,
    full_limit: int = 40,
) -> tuple[list[dict], list[dict]]:
    """Find combos in a card set. Returns (full, near) lists, most popular first.

    Only considers combos whose color identity fits the deck and that touch at
    least one owned card. `near` combos annotate the single missing card.
    """
    allowed = list(identity)
    query = {
        "identity": {"$not": {"$elemMatch": {"$nin": allowed}}},
        "cards": {"$in": list(owned_oracle_ids)},
    }
    full: list[dict] = []
    near: list[dict] = []
    cursor = db.combos.find(query)
    async for combo in cursor:
        cards = set(combo["cards"])
        have = cards & owned_oracle_ids
        missing = cards - have
        if not missing:
            full.append(combo)
        elif len(missing) == 1:
            missing_id = next(iter(missing))
            idx = combo["cards"].index(missing_id)
            c = dict(combo)
            c["missing_name"] = combo["card_names"][idx] if idx < len(combo["card_names"]) else "?"
            near.append(c)

    full = _dedupe(full)
    near = _dedupe(near)
    full.sort(key=lambda c: -(c.get("popularity") or 0))
    near.sort(key=lambda c: -(c.get("popularity") or 0))
    return full[:full_limit], near[:near_limit]


def _dedupe(combos: list[dict]) -> list[dict]:
    """Collapse variants that use the same card set, keeping the most popular
    (Commander Spellbook lists a separate variant per produced feature)."""
    best: dict[frozenset, dict] = {}
    for combo in combos:
        key = frozenset(combo["cards"])
        if key not in best or (combo.get("popularity") or 0) > (best[key].get("popularity") or 0):
            best[key] = combo
    return list(best.values())
