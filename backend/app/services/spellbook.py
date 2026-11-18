"""Commander Spellbook combo detection (Phase 4b).

Syncs the open Commander Spellbook combo database (json.commanderspellbook.com)
into Mongo as slim docs, then detects which combos a card set assembles. Despite
the name, the feed covers every format — each combo carries its legality per
format — so detection works for 60-card decks too. Combos
are matched by Scryfall oracle_id (== our card _id), so detection is exact.

Two detection outputs:
  - full: every piece of the combo is present.
  - near: exactly one piece missing (a "you're one card away" suggestion).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
import ijson
from pymongo import ReplaceOne
from pymongo.asynchronous.database import AsyncDatabase

from ..util import USER_AGENT

logger = logging.getLogger(__name__)

BULK_URL = "https://json.commanderspellbook.com/variants.json"
HEADERS = {"User-Agent": USER_AGENT}
COLORS = set("WUBRG")

# Our format key → Commander Spellbook's legality key. The feed carries a legality
# per format for every combo; we keep the formats we can build.
FORMAT_LEGALITY = {
    "commander": "commander",
    "standard": "standard",
    "pioneer": "pioneer",
    "modern": "modern",
    "legacy": "legacy",
    "pauper": "pauper",
    "paupercommander": "pauperCommander",
}

# A sync that finds fewer than this share of the combos already stored stops
# before pruning: a bad or partial feed must not empty the collection.
MIN_KEEP_RATIO = 0.8


def _is_legal(value) -> bool:
    return value if isinstance(value, bool) else str(value).lower() in ("legal", "true", "l")


def combo_doc(variant: dict) -> dict | None:
    """Transform a Commander Spellbook variant into a slim Mongo combo doc.

    Keeps oracle_ids + names of the cards, the produced features, color identity,
    popularity, and `legal_in` — the formats (our keys) it's legal in. Returns None
    for combos we can't use (fewer than two cards, or legal in no format we build).
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

    legalities = variant.get("legalities") or {}
    legal_in = [ours for ours, theirs in FORMAT_LEGALITY.items() if _is_legal(legalities.get(theirs))]
    if not legal_in:
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
        "legal_in": legal_in,
    }


class _AsyncBody:
    """An httpx streaming response as the async file object ijson reads.

    Honours `n`: ijson probes with `read(0)` to learn whether the stream is bytes
    or text, and handing back a whole chunk there would drop it on the floor.
    """

    def __init__(self, resp: httpx.Response):
        self._chunks = resp.aiter_bytes()
        self._buffer = b""

    async def read(self, n: int = -1) -> bytes:
        if n == 0:
            return b""
        while not self._buffer:
            try:
                self._buffer = await self._chunks.__anext__()
            except StopAsyncIteration:
                return b""
        if n < 0 or n >= len(self._buffer):
            out, self._buffer = self._buffer, b""
        else:
            out, self._buffer = self._buffer[:n], self._buffer[n:]
        return out


async def iter_combos():
    """Stream usable combo docs from the feed.

    The file is ~750MB of JSON — loading it whole would need several GB, far past
    the 1GB sync machine — so it's parsed incrementally. A cut-off download leaves
    the JSON unterminated, which ijson raises on, so a partial feed fails loudly
    instead of reading as a short one.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        async with client.stream("GET", BULK_URL, headers=HEADERS, timeout=600) as resp:
            resp.raise_for_status()
            async for variant in ijson.items_async(_AsyncBody(resp), "variants.item"):
                doc = combo_doc(variant)
                if doc:
                    yield doc


async def sync(db: AsyncDatabase, batch_size: int = 2000) -> int:
    """Refresh the `combos` collection from Commander Spellbook, in place.

    Upserts every combo stamped with this run, then deletes combos the run didn't
    see. The collection is never empty mid-sync, so it's safe while the API is
    live. Raises — without pruning — if the feed came back much smaller than what's
    stored.
    """
    stamp = datetime.now(timezone.utc).isoformat()
    previous = await db.combos.count_documents({})
    seen = 0
    batch: list[ReplaceOne] = []
    async for doc in iter_combos():
        doc["synced_at"] = stamp
        batch.append(ReplaceOne({"_id": doc["_id"]}, doc, upsert=True))
        seen += 1
        if len(batch) >= batch_size:
            await db.combos.bulk_write(batch, ordered=False)
            batch = []
    if batch:
        await db.combos.bulk_write(batch, ordered=False)

    if previous and seen < previous * MIN_KEEP_RATIO:
        raise RuntimeError(
            f"Spellbook feed has {seen} combos, under {MIN_KEEP_RATIO:.0%} of the "
            f"{previous} stored — not pruning. Check the feed before re-running."
        )
    pruned = await db.combos.delete_many({"synced_at": {"$ne": stamp}})
    logger.info("combos: %d upserted, %d pruned", seen, pruned.deleted_count)

    await db.combos.create_index("cards")
    await db.combos.create_index("identity")
    await db.combos.create_index("legal_in")
    return await db.combos.count_documents({})


def _legal_clause(format_key: str) -> dict:
    """Combos legal in a format. Combos synced before `legal_in` existed were all
    Commander-legal, so for Commander a missing field counts as legal."""
    if format_key == "commander":
        return {"legal_in": {"$in": ["commander", None]}}
    return {"legal_in": format_key}


async def detect(
    db: AsyncDatabase,
    owned_oracle_ids: set[str],
    identity: list[str],
    near_limit: int = 15,
    full_limit: int = 40,
    format_key: str = "commander",
) -> tuple[list[dict], list[dict]]:
    """Find combos in a card set. Returns (full, near) lists, most popular first.

    Only considers combos whose color identity fits the deck and that touch at
    least one owned card. `near` combos annotate the single missing card.
    """
    allowed = list(identity)
    query = {
        "identity": {"$not": {"$elemMatch": {"$nin": allowed}}},
        "cards": {"$in": list(owned_oracle_ids)},
        **_legal_clause(format_key),
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


async def combo_finishers(
    db: AsyncDatabase,
    deck_ids: set[str],
    identity: list[str],
    format_key: str = "commander",
) -> list[dict]:
    """Cards that would *complete* a combo with the current deck.

    Finds combos whose color identity fits and that are missing **exactly one**
    piece from ``deck_ids``; that missing piece is a "finisher". Aggregates by
    finisher card, so each result lists every deck-combo it would complete.

    Returns ``[{oracle_id, combos, combo_count, popularity}]`` sorted by how many
    combos the card finishes (then total popularity). Owned/price enrichment and
    the final owned-first ranking happen in the router.
    """
    allowed = list(identity)
    query = {
        "identity": {"$not": {"$elemMatch": {"$nin": allowed}}},
        "cards": {"$in": list(deck_ids)},
        **_legal_clause(format_key),
    }
    by_finisher: dict[str, list[dict]] = {}
    cursor = db.combos.find(query)
    async for combo in cursor:
        missing = set(combo["cards"]) - deck_ids
        if len(missing) != 1:
            continue
        by_finisher.setdefault(next(iter(missing)), []).append(combo)

    out: list[dict] = []
    for finisher_id, combos in by_finisher.items():
        combos = _dedupe(combos)
        combos.sort(key=lambda c: -(c.get("popularity") or 0))
        out.append(
            {
                "oracle_id": finisher_id,
                "combos": combos,
                "combo_count": len(combos),
                "popularity": sum(c.get("popularity") or 0 for c in combos),
            }
        )
    out.sort(key=lambda e: (-e["combo_count"], -e["popularity"]))
    return out


def _dedupe(combos: list[dict]) -> list[dict]:
    """Collapse variants that use the same card set, keeping the most popular
    (Commander Spellbook lists a separate variant per produced feature)."""
    best: dict[frozenset, dict] = {}
    for combo in combos:
        key = frozenset(combo["cards"])
        if key not in best or (combo.get("popularity") or 0) > (best[key].get("popularity") or 0):
            best[key] = combo
    return list(best.values())
