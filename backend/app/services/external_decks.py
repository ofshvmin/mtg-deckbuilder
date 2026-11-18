"""Fetch and convert decks from external platforms.

Search uses EDHREC (public JSON endpoints for commander decklists).
Individual deck fetch uses either EDHREC deck preview (card list format)
or Archidekt's individual deck API (still publicly accessible).

Follows the httpx + descriptive User-Agent pattern from scryfall.py.
"""
from __future__ import annotations

import asyncio
import re

import httpx

from ..util import USER_AGENT

HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}
TIMEOUT = 15

# URL patterns for supported platforms.
_ARCHIDEKT_URL_RE = re.compile(r"archidekt\.com/decks/(\d+)")
_MOXFIELD_URL_RE = re.compile(r"moxfield\.com/decks/([\w-]+)")
_EDHREC_HASH_RE = re.compile(r"edhrec\.com/deckpreview/([\w_-]+)")
_EDHREC_PAGE_RE = re.compile(r"edhrec\.com/(commanders|average-decks|precon|precon-hierarchies)/([\w/-]+)")

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
    m = _EDHREC_PAGE_RE.search(url)
    if m:
        # Return the full path segment for json.edhrec.com lookup
        return ("edhrec-page", f"{m.group(1)}/{m.group(2)}")
    return None


def commander_to_slug(name: str) -> str:
    """Convert a commander name to an EDHREC URL slug.

    "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
    """
    slug = name.lower()
    slug = re.sub(r"[',.]", "", slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def slug_to_name_hint(slug: str) -> str:
    """Convert an EDHREC slug back to a rough commander name for DB lookup.

    "caesar-legions-emperor" -> "caesar legions emperor"
    Not an exact reverse of commander_to_slug (punctuation is lost), but
    good enough for a substring search against our cards DB.
    """
    return slug.replace("-", " ")


async def _fetch_edhrec_decks_page(path: str) -> dict | None:
    """One json.edhrec.com page under /pages/decks/, or None when EDHREC has none."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(
            f"https://json.edhrec.com/pages/decks/{path}.json",
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if resp.status_code in (403, 404):
            return None
        resp.raise_for_status()
        return resp.json()


def _table_summaries(data: dict, commander: str, page_size: int) -> list[dict]:
    """EDHREC's deck table (tags, bracket, price, type counts) as search results."""
    table = data.get("table") or []
    container = data.get("container") or {}
    jd = container.get("json_dict") or {}
    card_info = jd.get("card") or {}
    color_identity = _normalize_colors(card_info.get("color_identity") or [])

    out: list[dict] = []
    for entry in table[:page_size]:
        h = entry.get("urlhash")
        if not h:
            continue

        tags = entry.get("tags") or []
        bracket = entry.get("bracket")
        price = entry.get("price")
        budget = entry.get("budget_label") or ""
        # Build a descriptive name from tags + card composition
        name = _build_deck_name(commander, tags, budget, bracket, entry)
        # Estimate card count from type counts
        card_count = sum(
            entry.get(t, 0) or 0
            for t in ("creature", "instant", "sorcery", "artifact",
                      "enchantment", "battle", "planeswalker", "land")
        )

        out.append({
            "external_id": h,
            "source": "edhrec",
            "name": name,
            "owner": "EDHREC",
            "card_count": card_count or 99,
            "url": f"https://edhrec.com/deckpreview/{h}",
            "commander_name": commander,
            "color_identity": color_identity,
            "bracket": bracket,
            "price": round(price) if price else None,
        })
    return out


async def search_edhrec(commander: str, page_size: int = 20) -> list[dict]:
    """Search EDHREC for public Commander decklists by commander name.

    Uses the hash table from json.edhrec.com directly — no preview fetches.
    The table has tags, bracket, price, budget_label, and card type counts.
    This is instant (single request) vs the old approach of N+1 requests.
    """
    data = await _fetch_edhrec_decks_page(commander_to_slug(commander))
    return _table_summaries(data, commander, page_size) if data else []


async def search_edhrec_theme(commander: str, theme_slug: str, page_size: int = 10) -> list[dict]:
    """One commander's EDHREC decks within a theme (e.g. Locutus of Borg, tokens)."""
    data = await _fetch_edhrec_decks_page(f"{commander_to_slug(commander)}/{theme_slug}")
    return _table_summaries(data, commander, page_size) if data else []


def _build_deck_name(
    commander: str, tags: list, budget: str, bracket, entry: dict | None = None,
) -> str:
    """Build a descriptive deck name from EDHREC tags and card composition."""
    short = commander.split(",")[0].strip()
    parts: list[str] = []

    if tags:
        parts.append(" / ".join(str(t) for t in tags[:2]))

    # Infer deck style from card-type breakdown when tags are empty
    if not tags and entry:
        creatures = entry.get("creature", 0) or 0
        instants = entry.get("instant", 0) or 0
        sorceries = entry.get("sorcery", 0) or 0
        artifacts = entry.get("artifact", 0) or 0
        enchantments = entry.get("enchantment", 0) or 0
        planeswalkers = entry.get("planeswalker", 0) or 0
        nonland = creatures + instants + sorceries + artifacts + enchantments + planeswalkers
        if nonland > 0:
            if planeswalkers >= 5:
                parts.append("Superfriends")
            elif artifacts / nonland > 0.25:
                parts.append("Artifacts")
            elif enchantments / nonland > 0.25:
                parts.append("Enchantress")
            elif (instants + sorceries) / nonland > 0.4:
                parts.append("Spellslinger")
            elif creatures / nonland > 0.55:
                parts.append("Creature-heavy")
            else:
                parts.append("Balanced")

    # Price as differentiator (always unique per deck)
    price = (entry or {}).get("price")
    if price:
        parts.append(f"${round(price)}")
    elif budget:
        parts.append(str(budget).capitalize())

    if parts:
        return f"{short} — {', '.join(parts)}"
    return f"{short} Deck"


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


async def fetch_edhrec_page(path: str) -> dict:
    """Fetch a JSON page from EDHREC (e.g. 'precon/counter-intelligence').

    Returns the raw JSON dict from json.edhrec.com/pages/{path}.json.
    """
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(
            f"https://json.edhrec.com/pages/{path}.json",
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if resp.status_code in (403, 404):
            return {}
        resp.raise_for_status()
        return resp.json()


def extract_edhrec_page_cards(data: dict) -> list[dict]:
    """Extract card entries from an EDHREC page (precon, average-deck, etc.).

    EDHREC pages have a 'deck' dict with 'commander' list and 'cards' dict
    grouped by type (Land, Creature, etc.), each containing [name, qty] pairs.
    """
    deck = data.get("deck")
    if not deck or not isinstance(deck, dict):
        return []
    cards: list[dict] = []
    for name in deck.get("commander") or []:
        cards.append({"name": name, "quantity": 1, "categories": ["Commander"]})
    card_groups = deck.get("cards") or {}
    if isinstance(card_groups, dict):
        for _type, entries in card_groups.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if isinstance(entry, list) and len(entry) >= 2:
                    cards.append({"name": entry[0], "quantity": entry[1], "categories": []})
    return cards


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

    EDHREC has sent two shapes for 'deck': a list of strings like "1 Sol Ring"
    (commanders listed separately in 'commanders'), and — since late 2026 —
    sections: {"commander_v2": [[name, qty]], "cards": {"Sorcery": [[name, qty]], ...}}.
    Both are read. Returns list of dicts: {name, quantity, categories}
    """
    deck = preview.get("deck")
    if isinstance(deck, dict):
        return _extract_edhrec_sections(deck, preview.get("commanders") or [])

    cards: list[dict] = []
    commanders = set(preview.get("commanders") or [])

    for line in deck or []:
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
        cards.append(_edhrec_entry(name, qty, cats))
    return cards


def _edhrec_entry(name: str, qty: int, categories: list[str]) -> dict:
    return {
        "name": name,
        "quantity": qty,
        "categories": categories,
        "set_code": "",
        "collector_number": "",
    }


def _extract_edhrec_sections(deck: dict, commanders: list[str]) -> list[dict]:
    """The sectioned shape: commanders first, then every typed group of [name, qty]."""
    pairs = deck.get("commander_v2") or [[n, 1] for n in (deck.get("commander") or commanders)]
    cards = [
        _edhrec_entry(str(pair[0]).strip(), _qty(pair), ["Commander"])
        for pair in pairs
        if isinstance(pair, (list, tuple)) and pair and str(pair[0]).strip()
    ]
    for group in (deck.get("cards") or {}).values():
        for pair in group or []:
            if isinstance(pair, (list, tuple)) and pair and str(pair[0]).strip():
                cards.append(_edhrec_entry(str(pair[0]).strip(), _qty(pair), []))
    return cards


def _qty(pair) -> int:
    try:
        return int(pair[1]) if len(pair) > 1 else 1
    except (TypeError, ValueError):
        return 1


def extract_archidekt_cards(raw: dict) -> list[dict]:
    """Extract card entries from an Archidekt deck response.

    Returns list of dicts: {name, quantity, categories, set_code, collector_number}

    Cards whose primary (first) category is marked not-in-deck — Maybeboard, or
    any category the owner set that way, like "out" — are left out, the way
    Archidekt itself counts the deck.
    """
    excluded = {
        c.get("name") for c in raw.get("categories") or [] if c.get("includedInDeck") is False
    }
    cards: list[dict] = []
    for entry in raw.get("cards") or []:
        cats = entry.get("categories") or []
        if cats and cats[0] in excluded:
            continue
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


# ---- MTGJSON preconstructed decks ----

# In-memory cache for the deck list (fetched once per process lifetime).
_precon_cache: list[dict] | None = None
_precon_enrichment_started = False


async def get_precon_list() -> list[dict]:
    """Fetch and cache the MTGJSON Commander Deck list.

    On first call, fetches the deck index and starts a background task
    to enrich entries with commander names (from individual deck files).
    """
    global _precon_cache, _precon_enrichment_started
    if _precon_cache is not None:
        return _precon_cache

    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(
            "https://mtgjson.com/api/v5/DeckList.json",
            headers=HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

    all_decks = data.get("data") or []
    # Filter to Commander Deck type only
    commander_decks = [
        d for d in all_decks
        if d.get("type") == "Commander Deck"
    ]
    # Sort by release date descending (newest first)
    commander_decks.sort(key=lambda d: d.get("releaseDate", ""), reverse=True)
    _precon_cache = commander_decks

    # Eagerly enrich with commander names before returning.
    # ~190 decks at 8 concurrent ≈ 20s on first boot, then cached.
    if not _precon_enrichment_started:
        _precon_enrichment_started = True
        await _enrich_precon_commanders()

    return _precon_cache


async def _enrich_precon_commanders() -> None:
    """Background task: fetch each precon deck to extract commander name + colors."""
    if not _precon_cache:
        return
    sem = asyncio.Semaphore(8)
    async with httpx.AsyncClient(
        follow_redirects=True, headers=HEADERS, timeout=15
    ) as client:

        async def _fetch_one(deck: dict) -> None:
            fn = deck.get("fileName", "")
            if not fn or deck.get("commander_name"):
                return
            async with sem:
                try:
                    resp = await client.get(
                        f"https://mtgjson.com/api/v5/decks/{fn}.json"
                    )
                    if resp.status_code != 200:
                        return
                    deck_data = resp.json().get("data", {})
                    cmds = deck_data.get("commander") or []
                    if cmds:
                        deck["commander_name"] = cmds[0].get("name", "")
                        deck["color_identity"] = cmds[0].get("colorIdentity") or []
                except Exception:
                    pass

        await asyncio.gather(*(_fetch_one(d) for d in _precon_cache))


async def search_precons(query: str, limit: int = 20) -> list[dict]:
    """Search MTGJSON precon decks by name (substring match)."""
    decks = await get_precon_list()
    q = query.lower()
    matches = [d for d in decks if q in d.get("name", "").lower() or q in d.get("code", "").lower()]
    return matches[:limit]


async def fetch_precon_deck(file_name: str) -> dict:
    """Fetch a single precon deck from MTGJSON by fileName."""
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(
            f"https://mtgjson.com/api/v5/decks/{file_name}.json",
            headers=HEADERS,
            timeout=15,
        )
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json().get("data", {})


def extract_precon_cards(deck_data: dict) -> list[dict]:
    """Extract card entries from a MTGJSON precon deck."""
    cards: list[dict] = []
    # Commander(s)
    for card in deck_data.get("commander") or []:
        name = card.get("name", "")
        if not name:
            continue
        cards.append({
            "name": name,
            "quantity": card.get("count", 1),
            "categories": ["Commander"],
            "set_code": card.get("setCode", ""),
            "collector_number": card.get("number", ""),
        })
    # Main board
    for card in deck_data.get("mainBoard") or []:
        name = card.get("name", "")
        if not name:
            continue
        cards.append({
            "name": name,
            "quantity": card.get("count", 1),
            "categories": [],
            "set_code": card.get("setCode", ""),
            "collector_number": card.get("number", ""),
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
