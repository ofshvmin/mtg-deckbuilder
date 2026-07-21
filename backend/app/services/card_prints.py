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
from .scryfall import BULK_DATA_INDEX_URL, HEADERS, _extract_image_uris

logger = logging.getLogger("uvicorn.error")


async def _get_json(client: httpx.AsyncClient, url: str):
    resp = await client.get(url, headers=HEADERS, timeout=600)
    resp.raise_for_status()
    return resp.json()


async def fetch_default_cards() -> list[dict]:
    """Fetch the `default_cards` bulk file from Scryfall (one entry per printing)."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        index = await _get_json(client, BULK_DATA_INDEX_URL)
        uri = next(
            (item["download_uri"] for item in index["data"] if item["type"] == "default_cards"),
            None,
        )
        if not uri:
            raise RuntimeError("Could not find 'default_cards' in Scryfall bulk-data index.")
        logger.info("Downloading default_cards from %s", uri)
        return await _get_json(client, uri)


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
    if image_uris:
        doc["image_uris"] = image_uris
    if image_uris_back:
        doc["image_uris_back"] = image_uris_back
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
    raw = await fetch_default_cards()
    # English only keeps the collection lean (~90K vs ~300K+ all languages).
    docs = [print_doc(c) for c in raw if c.get("id") and c.get("lang") == "en"]
    logger.info("Inserting %d card_prints documents", len(docs))
    return await card_prints_repo.replace_all(db, docs)
