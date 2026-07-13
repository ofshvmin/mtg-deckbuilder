"""Fetch and convert decks from external platforms (Archidekt, Moxfield).

Follows the httpx + descriptive User-Agent pattern from scryfall.py.
"""
from __future__ import annotations

import re

import httpx

USER_AGENT = "MTGDeckBuilder/0.1 (personal project; contact: daniel.g.mathews@gmail.com)"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}
TIMEOUT = 10

# URL patterns for supported platforms.
_ARCHIDEKT_URL_RE = re.compile(r"archidekt\.com/decks/(\d+)")
_MOXFIELD_URL_RE = re.compile(r"moxfield\.com/decks/([\w-]+)")


def parse_deck_url(url: str) -> tuple[str, str] | None:
    """Extract (source, id) from a deck URL, or None if unsupported."""
    m = _ARCHIDEKT_URL_RE.search(url)
    if m:
        return ("archidekt", m.group(1))
    m = _MOXFIELD_URL_RE.search(url)
    if m:
        return ("moxfield", m.group(1))
    return None


async def search_archidekt(commander: str, page_size: int = 20) -> list[dict]:
    """Search Archidekt for public Commander decks by commander name.

    Returns a list of summary dicts with keys:
      external_id, source, name, owner, card_count, url, commander_name, color_identity
    """
    params = {
        "commanders": f'"{commander}"',
        "formats": "3",  # Commander format
        "pageSize": str(page_size),
        "orderBy": "-viewCount",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://archidekt.com/api/decks/cards/",
            params=params,
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()

    results = data.get("results") or []
    out: list[dict] = []
    for deck in results:
        commanders = deck.get("commanders") or []
        cmd_name = commanders[0].get("name") if commanders else commander
        colors = _extract_archidekt_colors(deck)
        out.append({
            "external_id": str(deck["id"]),
            "source": "archidekt",
            "name": deck.get("name", "Untitled"),
            "owner": deck.get("owner", {}).get("username", "Unknown"),
            "card_count": deck.get("cardCount") or 0,
            "url": f"https://archidekt.com/decks/{deck['id']}",
            "commander_name": cmd_name,
            "color_identity": colors,
        })
    return out


def _extract_archidekt_colors(deck: dict) -> list[str]:
    """Pull color identity from Archidekt deck data."""
    colors = deck.get("colors") or deck.get("deckColors") or []
    if isinstance(colors, list):
        # Archidekt might return color objects or just strings
        out = []
        for c in colors:
            if isinstance(c, str) and len(c) == 1:
                out.append(c.upper())
            elif isinstance(c, dict):
                val = c.get("color") or c.get("name", "")
                if len(val) == 1:
                    out.append(val.upper())
        return out
    return []


async def fetch_archidekt_deck(deck_id: str) -> dict:
    """Fetch a full deck from Archidekt by numeric ID.

    Returns the raw Archidekt API response dict.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://archidekt.com/api/decks/{deck_id}/",
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json()


async def fetch_moxfield_deck(public_id: str) -> dict:
    """Fetch a full deck from Moxfield by public ID.

    Returns the raw Moxfield API response dict.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api2.moxfield.com/v3/decks/all/{public_id}",
            headers={**HEADERS, "User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json()


def extract_archidekt_cards(raw: dict) -> list[dict]:
    """Extract card entries from an Archidekt deck response.

    Returns list of dicts: {name, quantity, categories, set_code, collector_number}
    """
    cards: list[dict] = []
    for entry in raw.get("cards") or []:
        card_data = entry.get("card") or {}
        oracle = card_data.get("oracleCard") or {}
        name = oracle.get("name") or card_data.get("name", "")
        if not name:
            continue
        edition = card_data.get("edition", {})
        cards.append({
            "name": name,
            "quantity": entry.get("quantity", 1),
            "categories": entry.get("categories") or [],
            "set_code": edition.get("editioncode") or "",
            "collector_number": card_data.get("collectorNumber") or "",
        })
    return cards


def extract_moxfield_cards(raw: dict) -> list[dict]:
    """Extract card entries from a Moxfield deck response.

    Returns list of dicts: {name, quantity, categories, set_code, collector_number}
    """
    cards: list[dict] = []
    boards = raw.get("boards") or {}
    for board_name, board in boards.items():
        if board_name in ("sideboard", "maybeboard", "considering"):
            continue
        board_cards = board.get("cards") or {}
        for _, entry in board_cards.items():
            card = entry.get("card") or {}
            name = card.get("name", "")
            if not name:
                continue
            cats = []
            if board_name == "commanders":
                cats = ["Commander"]
            cards.append({
                "name": name,
                "quantity": entry.get("quantity", 1),
                "categories": cats,
                "set_code": card.get("set") or "",
                "collector_number": card.get("cn") or card.get("collector_number") or "",
            })
    return cards


def extract_deck_metadata(raw: dict, source: str) -> dict:
    """Extract deck name and owner from a raw API response."""
    if source == "archidekt":
        return {
            "name": raw.get("name", "Untitled"),
            "owner": (raw.get("owner") or {}).get("username", "Unknown"),
        }
    elif source == "moxfield":
        return {
            "name": raw.get("name", "Untitled"),
            "owner": (raw.get("createdByUser") or {}).get("displayName")
            or (raw.get("createdByUser") or {}).get("userName", "Unknown"),
        }
    return {"name": "Untitled", "owner": "Unknown"}
