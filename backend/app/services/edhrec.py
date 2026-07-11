"""EDHREC synergy signal (Phase 4a).

For a given commander, EDHREC's public JSON API returns the cards the playerbase
runs with it, each with an inclusion count and a synergy score. We turn that into
a per-card quality score, cache it in Mongo (keyed by the commander's EDHREC slug),
and hand it to the generator so it prefers community-proven cards over filler.

Robustness: if EDHREC is unreachable or the commander isn't on EDHREC, callers
get an empty score map and the generator falls back to curve/efficiency ranking.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone

import httpx
from pymongo.asynchronous.database import AsyncDatabase

from ..util import normalize_name

HEADERS = {"User-Agent": "MTGDeckBuilder/0.1 (personal project; daniel.g.mathews@gmail.com)"}
CACHE_TTL = timedelta(days=7)
_BASE = "https://json.edhrec.com/pages/commanders/{slug}.json"


def slugify(commander_name: str) -> str:
    """EDHREC commander slug, e.g. 'Korvold, Fae-Cursed King' -> 'korvold-fae-cursed-king'."""
    front = commander_name.split("//")[0].strip()
    decomposed = unicodedata.normalize("NFKD", front)
    ascii_str = "".join(c for c in decomposed if not unicodedata.combining(c))
    lowered = ascii_str.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")


def _score(inclusion: int, potential: int, synergy: float) -> float:
    """Quality score = inclusion rate (popularity with this commander) plus a
    synergy bonus (commander-specific fit). Clamped at 0."""
    rate = (inclusion / potential) if potential else 0.0
    return max(0.0, rate + 0.5 * synergy)


async def _fetch(slug: str) -> list[dict] | None:
    """Fetch + parse EDHREC. Returns a list of {n, s, inc, syn} or None on failure."""
    url = _BASE.format(slug=slug)
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, headers=HEADERS, timeout=30)
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None

    cardlists = (
        resp.json().get("container", {}).get("json_dict", {}).get("cardlists", []) or []
    )
    seen: dict[str, dict] = {}
    for section in cardlists:
        for cv in section.get("cardviews", []) or []:
            name = cv.get("name")
            if not name:
                continue
            inclusion = cv.get("inclusion") or 0
            potential = cv.get("potential_decks") or 0
            synergy = cv.get("synergy") or 0.0
            key = normalize_name(name)
            seen[key] = {
                "n": key,
                "s": round(_score(inclusion, potential, synergy), 5),
                "inc": inclusion,
                "syn": round(synergy, 4),
            }
    return list(seen.values())


async def get_scored_cards(db: AsyncDatabase, commander: dict) -> list[dict]:
    """Return the commander's EDHREC cards as ``[{n, s, inc, syn}, ...]``, cached.

    Each entry: ``n`` = name_normalized, ``s`` = quality score, ``inc`` = inclusion
    count, ``syn`` = raw synergy. Uses a fresh cache if < CACHE_TTL old; otherwise
    refetches. On fetch failure falls back to a stale cache, else an empty list.
    """
    slug = slugify(commander["name"])
    now = datetime.now(timezone.utc)
    cached = await db.edhrec_cache.find_one({"_id": slug})

    fresh = False
    if cached:
        try:
            fresh = (now - datetime.fromisoformat(cached["fetched_at"])) < CACHE_TTL
        except (KeyError, ValueError):
            fresh = False
    if fresh:
        return cached["cards"]

    cards = await _fetch(slug)
    if cards is None:
        return cached["cards"] if cached else []

    await db.edhrec_cache.replace_one(
        {"_id": slug},
        {
            "_id": slug,
            "commander_oracle_id": commander.get("_id"),
            "fetched_at": now.isoformat(),
            "cards": cards,
        },
        upsert=True,
    )
    return cards


async def get_score_map(db: AsyncDatabase, commander: dict) -> dict[str, float]:
    """Return {name_normalized: quality_score} for a commander (see get_scored_cards)."""
    return {c["n"]: c["s"] for c in await get_scored_cards(db, commander)}
