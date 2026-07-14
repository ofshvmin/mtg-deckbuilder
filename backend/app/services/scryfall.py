"""Download Scryfall's Oracle card data and load it into the Mongo `cards` collection.

Async port of the Phase 1 `scryfall_sync.py`. Same parsing rules; the differences
are that it fetches with httpx (async), stores list fields as native Mongo arrays
(not JSON strings), and uses oracle_id as the document `_id`.

Per Scryfall API policy: a descriptive User-Agent, and only two requests total
(bulk-data index + the file), well within the 10 req/sec guidance.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
from pymongo.asynchronous.database import AsyncDatabase

from ..repositories import cards as cards_repo
from ..util import normalize_name

BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data"
USER_AGENT = "MTGDeckBuilder/0.1 (personal project; contact: daniel.g.mathews@gmail.com)"
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
        "colors": card.get("colors", []),
        "color_identity": card.get("color_identity", []),
        "keywords": card.get("keywords", []),
        "produced_mana": card.get("produced_mana"),  # list or None
        "power": card.get("power"),
        "toughness": card.get("toughness"),
        "loyalty": card.get("loyalty"),
        "layout": card.get("layout"),
        "legal_commander": card.get("legalities", {}).get("commander", "not_legal"),
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


async def fetch_oracle_cards() -> list[dict]:
    """Fetch the current `oracle_cards` bulk file from Scryfall."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        index = await _get_json(client, BULK_DATA_INDEX_URL)
        download_uri = next(
            (item["download_uri"] for item in index["data"] if item["type"] == "oracle_cards"),
            None,
        )
        if not download_uri:
            raise RuntimeError("Could not find 'oracle_cards' entry in Scryfall bulk-data index.")
        return await _get_json(client, download_uri)


async def sync(db: AsyncDatabase) -> int:
    """Fetch Scryfall oracle cards and replace the `cards` collection. Returns count."""
    raw = await fetch_oracle_cards()
    docs = [doc_from_card(c) for c in raw if c.get("oracle_id")]
    return await cards_repo.replace_all(db, docs)
