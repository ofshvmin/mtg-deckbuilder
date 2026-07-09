"""Legal owned-card pool for a given commander.

Async port of Phase 1 `query_pool.py`. Given a user and a commander name,
returns the commander plus the user's owned cards that are Commander-legal and
whose color identity is a subset of the commander's — the Phase 1 deliverable,
now user-scoped and served from Mongo.
"""
from __future__ import annotations

from dataclasses import dataclass

from pymongo.asynchronous.database import AsyncDatabase

from ..repositories import cards as cards_repo
from ..repositories import collection as collection_repo

COLOR_ORDER = ["W", "U", "B", "R", "G"]


class CommanderNotFound(Exception):
    def __init__(self, name: str, suggestions: list[str]):
        self.name = name
        self.suggestions = suggestions
        super().__init__(f"No card found matching '{name}'.")


@dataclass
class Pool:
    commander: dict
    color_identity: list[str]
    pool: list[dict]


def format_color_identity(colors: list[str]) -> str:
    ordered = [c for c in COLOR_ORDER if c in colors]
    return "".join(ordered) if ordered else "C"


def is_land(card: dict) -> bool:
    return "land" in (card.get("type_line") or "").lower()


def land_count(pool: list[dict]) -> int:
    return sum(1 for c in pool if is_land(c))


def nonland_curve(pool: list[dict]) -> list[dict]:
    """Histogram of nonland cards by mana value, bucketed 0..7 (7 = 7+)."""
    buckets = {i: 0 for i in range(8)}
    for c in pool:
        if is_land(c):
            continue
        buckets[min(int(c.get("cmc") or 0), 7)] += 1
    return [{"cmc": cmc, "count": buckets[cmc]} for cmc in range(8)]


async def get_pool(db: AsyncDatabase, user_id: str, commander_name: str) -> Pool:
    commander = await cards_repo.find_commander(db, commander_name)
    if commander is None:
        suggestions = [c["name"] for c in await cards_repo.search(db, commander_name, limit=10)]
        raise CommanderNotFound(commander_name, suggestions)

    identity = commander.get("color_identity", [])
    owned = await collection_repo.owned_counts(db, user_id)
    pool = await cards_repo.get_legal_pool(
        db, allowed_colors=identity, owned_counts=owned, exclude_oracle_id=commander["_id"]
    )
    return Pool(commander=commander, color_identity=identity, pool=pool)
