"""Download Scryfall's Oracle card data and load it into the Mongo `cards` collection.

Async port of the Phase 1 `scryfall_sync.py`. Same parsing rules; the differences
are that it fetches with httpx (async), stores list fields as native Mongo arrays
(not JSON strings), and uses oracle_id as the document `_id`.

Per Scryfall API policy: a descriptive User-Agent, and only two requests total
(bulk-data index + the file), well within the 10 req/sec guidance.
"""
from __future__ import annotations

import json
import logging
import zlib
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import httpx
from pymongo.asynchronous.database import AsyncDatabase

from ..repositories import cards as cards_repo
from ..util import USER_AGENT, colors_in_cost, normalize_name

logger = logging.getLogger("uvicorn.error")

BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json;q=0.9,*/*;q=0.8"}

BASIC_LAND_NAMES = {"plains", "island", "swamp", "mountain", "forest", "wastes"}


def _extract_faces_text(card: dict) -> str:
    """Oracle text for transform/modal/split cards lives on `card_faces`."""
    if card.get("oracle_text"):
        return card["oracle_text"]
    faces = card.get("card_faces") or []
    return "\n//\n".join(f.get("oracle_text", "") for f in faces if f.get("oracle_text"))


def _extract_mana_cost(card: dict) -> str:
    if card.get("mana_cost"):
        return card["mana_cost"]
    faces = card.get("card_faces") or []
    return " // ".join(f.get("mana_cost", "") for f in faces if f.get("mana_cost"))


def _is_declared_colorless(card: dict) -> bool:
    """True for cards that are colorless *by rule* despite a colored mana cost.

    Devoid covers almost all of them; Ghostfire predates the keyword and says so in
    its text instead. Both must keep `colors == []` — inferring color from their
    cost would be wrong.
    """
    if "Devoid" in (card.get("keywords") or []):
        return True
    return "is colorless" in (_extract_faces_text(card) or "").lower()


def _extract_colors(card: dict) -> list[str]:
    """A card's colors, which Scryfall records inconsistently across layouts.

    Three sources, in order of trust:
      1. Top-level `colors` — normal cards.
      2. `card_faces[].colors` — transform / modal-DFC, where the top level is absent.
         Missing these recorded every DFC as colorless, and the empty set is a subset
         of every color filter, so they leaked into decks of any color.
      3. The mana cost — a handful of adventure and MDFC entries report no colors at
         any level (Ishgard, the Holy See has `colors: []` and faces with `colors: None`,
         yet costs {3}{W}{W}).

    Step 3 is guarded by `_is_declared_colorless`, because a devoid card is genuinely
    colorless while still costing colored mana — inferring from its cost would be wrong.

    Note this is the card's *color*, not its castability. Color filtering uses
    `util.card_castable_in`, which reads the mana cost and so is unaffected by all of
    the above.
    """
    if card.get("colors"):
        return card["colors"]
    faces = card.get("card_faces") or []
    from_faces = {c for face in faces for c in (face.get("colors") or [])}
    if from_faces:
        return sorted(from_faces)
    if _is_declared_colorless(card):
        return []
    return sorted(colors_in_cost(_extract_mana_cost(card)))


_IMAGE_SIZES = ("small", "normal", "art_crop")


def _pick_image_uris(raw: dict | None) -> dict[str, str] | None:
    """Extract the image sizes we care about from a Scryfall image_uris dict."""
    if not raw:
        return None
    picked = {k: raw[k] for k in _IMAGE_SIZES if k in raw}
    return picked or None


def _extract_image_uris(card: dict) -> tuple[dict[str, str] | None, dict[str, str] | None]:
    """Return (front_uris, back_uris) from a Scryfall card object.

    Single-faced cards have top-level ``image_uris``. DFCs (transform,
    modal_dfc, etc.) store them on ``card_faces[0]`` / ``card_faces[1]``.
    """
    if card.get("image_uris"):
        return _pick_image_uris(card["image_uris"]), None
    faces = card.get("card_faces") or []
    front = _pick_image_uris(faces[0].get("image_uris")) if len(faces) > 0 else None
    back = _pick_image_uris(faces[1].get("image_uris")) if len(faces) > 1 else None
    return front, back


def doc_from_card(card: dict) -> dict:
    """Transform one Scryfall card into a Mongo `cards` document."""
    name = card["name"]
    image_uris, image_uris_back = _extract_image_uris(card)
    doc = {
        "_id": card["oracle_id"],
        "name": name,
        "name_normalized": normalize_name(name),
        "mana_cost": _extract_mana_cost(card),
        "cmc": card.get("cmc", 0.0),
        "type_line": card.get("type_line", ""),
        "oracle_text": _extract_faces_text(card),
        "colors": _extract_colors(card),
        "color_identity": card.get("color_identity", []),
        "keywords": card.get("keywords", []),
        "produced_mana": card.get("produced_mana"),  # list or None
        "power": card.get("power"),
        "toughness": card.get("toughness"),
        "loyalty": card.get("loyalty"),
        "layout": card.get("layout"),
        # Full legality map, so adding a format later is a FORMATS entry rather than
        # another full re-sync. The three denormalized fields below are the ones we
        # index and query directly.
        "legalities": card.get("legalities", {}),
        "legal_commander": card.get("legalities", {}).get("commander", "not_legal"),
        "legal_standard": card.get("legalities", {}).get("standard", "not_legal"),
        "legal_legacy": card.get("legalities", {}).get("legacy", "not_legal"),
        "rarity": card.get("rarity"),
        "is_basic_land": name.lower() in BASIC_LAND_NAMES,
        "released_at": card.get("released_at"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if image_uris:
        doc["image_uris"] = image_uris
    if image_uris_back:
        doc["image_uris_back"] = image_uris_back
    return doc


async def _get_json(client: httpx.AsyncClient, url: str):
    resp = await client.get(url, headers=HEADERS, timeout=300)
    resp.raise_for_status()
    return resp.json()


async def bulk_download_uri(client: httpx.AsyncClient, bulk_type: str) -> str:
    """Look up the current download URL for one of Scryfall's bulk data files.

    Scryfall retired the plain-JSON `download_uri` in favour of gzipped JSONL
    (`jsonl_download_uri`), so this reads the new field only — a missing key
    means the index schema moved again and we want that to fail loudly here
    rather than halfway through a sync.
    """
    index = await _get_json(client, BULK_DATA_INDEX_URL)
    uri = next(
        (
            item["jsonl_download_uri"]
            for item in index.get("data", [])
            if item.get("type") == bulk_type and item.get("jsonl_download_uri")
        ),
        None,
    )
    if not uri:
        raise RuntimeError(
            f"No '{bulk_type}' entry with a jsonl_download_uri in Scryfall's bulk-data index."
        )
    return uri


async def iter_bulk_cards(client: httpx.AsyncClient, bulk_type: str) -> AsyncIterator[dict]:
    """Stream card objects from a Scryfall gzipped-JSONL bulk file.

    The files are served as `application/gzip` with no Content-Encoding header,
    so httpx hands back the raw compressed bytes and we inflate them ourselves.
    Streaming keeps peak memory to one chunk plus the caller's own documents,
    rather than the ~1.5GB the decompressed file would occupy in full.
    """
    uri = await bulk_download_uri(client, bulk_type)
    logger.info("Streaming %s from %s", bulk_type, uri)

    # 16 + MAX_WBITS selects gzip framing (rather than raw zlib).
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
    pending = b""

    async with client.stream("GET", uri, headers=HEADERS, timeout=600) as resp:
        resp.raise_for_status()
        async for chunk in resp.aiter_bytes():
            pending += decompressor.decompress(chunk)
            # The final element is whatever precedes the next newline, which may
            # be a partial record — hold it back until more bytes arrive.
            lines = pending.split(b"\n")
            pending = lines.pop()
            for line in lines:
                if line.strip():
                    yield json.loads(line)

    pending += decompressor.flush()
    # A truncated gzip stream decompresses cleanly up to the cut and then simply
    # stops — no exception from decompress() or flush(). Yielding what arrived
    # would look like a short but valid bulk file, and since the callers replace
    # the collection wholesale, every printing past the cut would be pruned from
    # the database. Only a decompressor that reached the gzip trailer is trusted.
    if not decompressor.eof:
        raise RuntimeError(
            f"Truncated Scryfall {bulk_type} download — gzip stream ended mid-file."
        )
    for line in pending.split(b"\n"):
        if line.strip():
            yield json.loads(line)


async def fetch_oracle_cards() -> list[dict]:
    """Fetch the current `oracle_cards` bulk file from Scryfall."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        return [card async for card in iter_bulk_cards(client, "oracle_cards")]


async def sync(db: AsyncDatabase) -> int:
    """Fetch Scryfall oracle cards and replace the `cards` collection. Returns count."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        docs = [
            doc_from_card(card)
            async for card in iter_bulk_cards(client, "oracle_cards")
            if card.get("oracle_id")
        ]
    logger.info("Inserting %d cards documents", len(docs))
    return await cards_repo.replace_all(db, docs)
