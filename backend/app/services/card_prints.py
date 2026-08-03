"""Download Scryfall's default_cards bulk data and seed `card_prints` with
per-printing CDN image URLs.

Each document stores one printing (set + collector_number) with its actual
Scryfall CDN image URLs (UUID-based, not rate-limited). This lets the API
serve per-printing images from the DB — no Scryfall API calls needed at
runtime.

Run the seed from backend/:
    python scripts/sync_card_prints.py
"""
from __future__ import annotations

import logging

import httpx
from pymongo.asynchronous.database import AsyncDatabase

from ..repositories import card_prints as card_prints_repo
from .scryfall import _extract_image_uris, iter_bulk_cards

logger = logging.getLogger("uvicorn.error")


async def fetch_default_cards() -> list[dict]:
    """Fetch the `default_cards` bulk file from Scryfall (one entry per printing)."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        return [card async for card in iter_bulk_cards(client, "default_cards")]


def _price(raw: dict | None, key: str) -> float | None:
    """Parse one Scryfall price string (e.g. "0.35") to a float, or None."""
    if not raw:
        return None
    val = raw.get(key)
    if val in (None, ""):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def print_doc(card: dict) -> dict:
    """Transform one Scryfall card into a `card_prints` document."""
    image_uris, image_uris_back = _extract_image_uris(card)
    doc: dict = {
        "_id": card["id"],
        "oracle_id": card.get("oracle_id"),
        "name_lower": card.get("name", "").lower(),
        "set": card.get("set", "").lower(),
        "collector_number": card.get("collector_number", ""),
    }
    # The set's display name, so the set picker doesn't have to show bare codes.
    # Web could look this up from Scryfall's /sets index client-side, but mobile
    # has no such cache — carrying it here serves both from one place.
    set_name = (card.get("set_name") or "").strip()
    if set_name:
        doc["set_name"] = set_name
    if image_uris:
        doc["image_uris"] = image_uris
    if image_uris_back:
        doc["image_uris_back"] = image_uris_back
    # Scryfall's image policy requires the artist credit to appear wherever we
    # show an `art_crop`, so the illustrator travels with the image URLs.
    artist = (card.get("artist") or "").strip()
    if artist:
        doc["artist"] = artist
    # Per-printing market price, seeded here so the app never has to call Scryfall
    # live for prices (mirrors how images are served from the DB). Stored only when
    # present to keep documents small.
    prices = card.get("prices")
    usd = _price(prices, "usd")
    usd_foil = _price(prices, "usd_foil")
    if usd is not None:
        doc["price_usd"] = usd
    if usd_foil is not None:
        doc["price_usd_foil"] = usd_foil
    return doc


async def sync(db: AsyncDatabase) -> int:
    """Download Scryfall default_cards and replace the `card_prints` collection."""
    # Transformed while streaming: holding every raw printing object would cost
    # well over a gigabyte, where the slim docs we keep are a fraction of that.
    # English only keeps the collection lean (~90K vs ~300K+ all languages).
    async with httpx.AsyncClient(follow_redirects=True) as client:
        docs = [
            print_doc(card)
            async for card in iter_bulk_cards(client, "default_cards")
            if card.get("id") and card.get("lang") == "en"
        ]
    logger.info("Inserting %d card_prints documents", len(docs))
    return await card_prints_repo.replace_all(db, docs)
