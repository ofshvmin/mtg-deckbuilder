"""Explore's one search box: commanders, themes and decks by name.

- **Commanders** come from our own card data, commander-eligible cards only, so
  typing "borg" can never resolve to the Borg token.
- **Themes** come from EDHREC's tag index (Tokens, Aristocrats, +1/+1 Counters…).
  A theme's decks are its top commanders' EDHREC decks within that theme.
- **Decks by name** come from Archidekt's public deck search, the source with
  real deck names and authors, plus the official precons (MTGJSON).

EDHREC's tag index and theme pages change slowly, so they're held in memory for
hours — one fetch serves every search.
"""
from __future__ import annotations

import asyncio
import re
import time

import httpx

from .external_decks import HEADERS, TIMEOUT, search_edhrec_theme

THEME_TTL = 6 * 3600
# Archidekt's art URLs carry the Scryfall printing id in two shapes:
# .../art/front/8/c/<id>.webp and .../archidekt-card-images/<set>/<id>_art_crop.jpg
_SCRYFALL_ID_RE = re.compile(
    r"/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[._]"
)

# Archidekt's deckFormat 3 is Commander, the format Explore serves.
ARCHIDEKT_COMMANDER = 3

_cache: dict[str, tuple[float, object]] = {}


async def _cached(key: str, ttl: float, load):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = await load()
    _cache[key] = (time.monotonic(), value)
    return value


async def _get_json(url: str, params: dict | None = None) -> dict | None:
    async with httpx.AsyncClient(follow_redirects=True) as client:
        resp = await client.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code in (403, 404):
            return None
        resp.raise_for_status()
        return resp.json()


# ---- Themes ----


def _theme_slug(url: str) -> str:
    """'/tags/plus-1-plus-1-counters' -> 'plus-1-plus-1-counters'."""
    return url.rstrip("/").rsplit("/", 1)[-1]


def parse_theme_index(data: dict) -> list[dict]:
    """EDHREC's tag index as [{name, slug, decks}], most popular first."""
    lists = ((data.get("container") or {}).get("json_dict") or {}).get("cardlists") or []
    out = []
    for cl in lists:
        for view in cl.get("cardviews") or []:
            name, url = view.get("name"), view.get("url") or ""
            if name and url.startswith("/tags/"):
                out.append({"name": name, "slug": _theme_slug(url), "decks": view.get("num_decks") or 0})
    out.sort(key=lambda t: -t["decks"])
    return out


async def theme_index() -> list[dict]:
    async def load():
        data = await _get_json("https://json.edhrec.com/pages/tags.json")
        return parse_theme_index(data) if data else []

    return await _cached("themes", THEME_TTL, load)


def match_themes(themes: list[dict], query: str, limit: int = 6) -> list[dict]:
    """Themes whose name contains the query, word starts first, then by popularity."""
    q = query.strip().lower()
    if len(q) < 2:
        return []
    hits = [t for t in themes if q in t["name"].lower()]
    hits.sort(key=lambda t: (not any(w.startswith(q) for w in t["name"].lower().split()), -t["decks"]))
    return hits[:limit]


def parse_theme_commanders(data: dict, limit: int) -> list[str]:
    """A theme page's top commanders, by name."""
    lists = ((data.get("container") or {}).get("json_dict") or {}).get("cardlists") or []
    top = next((cl for cl in lists if (cl.get("header") or "").lower() == "top commanders"), None)
    if top is None:
        return []
    return [v["name"] for v in (top.get("cardviews") or [])[:limit] if v.get("name")]


async def theme_decks(slug: str, commanders: int = 6, per_commander: int = 6) -> list[dict]:
    """A theme's community decks: its top commanders' EDHREC decks in that theme,
    interleaved so the first screen shows several commanders, not one."""

    async def load():
        data = await _get_json(f"https://json.edhrec.com/pages/tags/{slug}.json")
        return parse_theme_commanders(data, commanders) if data else []

    names = await _cached(f"theme:{slug}", THEME_TTL, load)
    results = await asyncio.gather(
        *(search_edhrec_theme(n, slug, per_commander) for n in names), return_exceptions=True
    )
    lists = [r for r in results if isinstance(r, list)]
    out: list[dict] = []
    for i in range(per_commander):
        out.extend(lst[i] for lst in lists if i < len(lst))
    return out


# ---- Decks by name (Archidekt) ----


def parse_archidekt_results(data: dict) -> list[dict]:
    """Archidekt's deck search results as Explore decks."""
    out = []
    for r in data.get("results") or []:
        if r.get("private") or r.get("unlisted"):
            continue
        colors = [c for c, n in (r.get("colors") or {}).items() if n and c in "WUBRG"]
        # The owner's chosen art first, then Archidekt's default.
        m = _SCRYFALL_ID_RE.search(r.get("customFeatured") or "") or _SCRYFALL_ID_RE.search(
            r.get("featured") or ""
        )
        out.append({
            "kind": "archidekt",
            "id": str(r["id"]),
            "name": (r.get("name") or "Untitled deck").strip(),
            "owner": ((r.get("owner") or {}).get("username")) or "Archidekt",
            "views": r.get("viewCount") or 0,
            "card_count": r.get("size") or 0,
            "color_identity": [c for c in "WUBRG" if c in colors],
            "bracket": r.get("edhBracket"),
            "url": f"https://archidekt.com/decks/{r['id']}",
            # The featured art's Scryfall printing id, so the tile can use our own
            # art_crop and its artist credit rather than hotlinking Archidekt.
            "art_print_id": m.group(1) if m else None,
        })
    return out


async def search_archidekt(query: str, limit: int = 12) -> list[dict]:
    async def load():
        data = await _get_json(
            "https://archidekt.com/api/decks/v3/",
            {"name": query.strip(), "deckFormat": ARCHIDEKT_COMMANDER,
             "orderBy": "-viewCount", "pageSize": limit},
        )
        # Archidekt ignores pageSize (always 60), so trim here.
        return parse_archidekt_results(data)[:limit] if data else []

    return await _cached(f"archidekt:{query.strip().lower()}:{limit}", 600, load)
