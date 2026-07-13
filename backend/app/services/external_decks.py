"""Fetch and convert decks from external platforms.

Search uses EDHREC (public JSON endpoints for commander decklists).
Individual deck fetch uses either EDHREC deck preview (card list format)
or Archidekt's individual deck API (still publicly accessible).

Follows the httpx + descriptive User-Agent pattern from scryfall.py.
"""
from __future__ import annotations

import re

import httpx

USER_AGENT = "MTGDeckBuilder/0.1 (personal project; contact: daniel.g.mathews@gmail.com)"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}
TIMEOUT = 15

# URL patterns for supported platforms.
_ARCHIDEKT_URL_RE = re.compile(r"archidekt\.com/decks/(\d+)")
_MOXFIELD_URL_RE = re.compile(r"moxfield\.com/decks/([\w-]+)")
_EDHREC_HASH_RE = re.compile(r"edhrec\.com/deckpreview/([\w_-]+)")

# EDHREC color letter map (they use full names in some endpoints).
_COLOR_MAP = {"W": "W", "U": "U", "B": "B", "R": "R", "G": "G",
              "White": "W", "Blue": "U", "Black": "B", "Red": "R", "Green": "G"}


def parse_deck_url(url: str) -> tuple[str, str] | None:
    """Extract (source, id) from a deck URL, or None if unsupported."""
    m = _ARCHIDEKT_URL_RE.search(url)
    if m:
        return ("archidekt", m.group(1))
    m = _MOXFIELD_URL_RE.search(url)
    if m:
        return ("moxfield", m.group(1))
    m = _EDHREC_HASH_RE.search(url)
    if m:
        return ("edhrec", m.group(1))
    return None


def commander_to_slug(name: str) -> str:
    """Convert a commander name to an EDHREC URL slug.

    "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
    """
    slug = name.lower()
    slug = re.sub(r"[',.]", "", slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


async def search_edhrec(commander: str, page_size: int = 20) -> list[dict]:
    """Search EDHREC for public Commander decklists by commander name.

    Fetches the EDHREC decks page for the commander, takes the top N deck
    hashes, then batch-fetches their previews for names/URLs/card counts.

    Returns a list of summary dicts with keys:
      external_id, source, name, owner, card_count, url, commander_name, color_identity
    """
    slug = commander_to_slug(commander)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        # Step 1: Get deck hashes from EDHREC
        resp = await client.get(
            f"https://json.edhrec.com/pages/decks/{slug}.json",
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if resp.status_code in (403, 404):
            return []
        resp.raise_for_status()
        data = resp.json()

    table = data.get("table") or []
    if not table:
        return []

    # Take top N by position (EDHREC already sorts by relevance/date)
    hashes = [entry["urlhash"] for entry in table[:page_size] if entry.get("urlhash")]

    # Step 2: Fetch previews for each hash
    out: list[dict] = []
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for h in hashes:
            try:
                resp = await client.get(
                    f"https://edhrec.com/api/deckpreview/{h}",
                    headers=HEADERS,
                    timeout=TIMEOUT,
                )
                if resp.status_code != 200:
                    continue
                preview = resp.json()
            except (httpx.HTTPError, ValueError):
                continue

            deck_lines = preview.get("deck") or []
            card_count = len(deck_lines) if isinstance(deck_lines, list) else 0
            commanders = preview.get("commanders") or []
            cmd_name = commanders[0] if commanders else commander
            colors = _normalize_colors(preview.get("coloridentity") or [])
            source_url = preview.get("url") or ""

            # Determine the source from the URL
            source = "edhrec"
            if "archidekt.com" in source_url:
                source = "archidekt"
            elif "moxfield.com" in source_url:
                source = "moxfield"

            out.append({
                "external_id": h,
                "source": source,
                "name": preview.get("header") or f"{cmd_name} Deck",
                "owner": _owner_from_url(source_url),
                "card_count": card_count,
                "url": source_url or f"https://edhrec.com/deckpreview/{h}",
                "commander_name": cmd_name,
                "color_identity": colors,
            })

    return out


def _normalize_colors(colors: list) -> list[str]:
    """Normalize EDHREC color identity to WUBRG letters."""
    out = []
    for c in colors:
        mapped = _COLOR_MAP.get(c, c.upper() if isinstance(c, str) and len(c) == 1 else "")
        if mapped and mapped not in out:
            out.append(mapped)
    return out


def _owner_from_url(url: str) -> str:
    """Try to extract an owner/username from a deck URL, or return a default."""
    if not url:
        return "Unknown"
    # Archidekt URLs sometimes have the username in the path but not reliably
    return "EDHREC"


async def fetch_edhrec_preview(deck_hash: str) -> dict:
    """Fetch a deck preview from EDHREC by hash.

    Returns dict with keys: deck (list of "N CardName"), commanders, coloridentity, url, price, etc.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(
            f"https://edhrec.com/api/deckpreview/{deck_hash}",
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json()


async def fetch_archidekt_deck(deck_id: str) -> dict:
    """Fetch a full deck from Archidekt by numeric ID.

    Returns the raw Archidekt API response dict.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(
            f"https://archidekt.com/api/decks/{deck_id}/",
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json()


def extract_edhrec_cards(preview: dict) -> list[dict]:
    """Extract card entries from an EDHREC deck preview.

    The preview's 'deck' field is a list of strings like "1 Sol Ring".
    Returns list of dicts: {name, quantity, categories}
    """
    cards: list[dict] = []
    commanders = set(preview.get("commanders") or [])

    for line in preview.get("deck") or []:
        if not isinstance(line, str) or not line.strip():
            continue
        parts = line.strip().split(" ", 1)
        if len(parts) < 2:
            continue
        try:
            qty = int(parts[0])
        except ValueError:
            qty = 1
        name = parts[1].strip()
        if not name:
            continue
        cats = ["Commander"] if name in commanders else []
        cards.append({
            "name": name,
            "quantity": qty,
            "categories": cats,
            "set_code": "",
            "collector_number": "",
        })
    return cards


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
    elif source == "edhrec":
        return {
            "name": raw.get("header") or "Untitled",
            "owner": "EDHREC",
        }
    return {"name": "Untitled", "owner": "Unknown"}
