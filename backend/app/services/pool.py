"""Legal owned-card pool for a given commander.

Async port of Phase 1 `query_pool.py`. Given a user and a commander name,
returns the commander plus the user's owned cards that are Commander-legal and
whose color identity is a subset of the commander's — the Phase 1 deliverable,
now user-scoped and served from Mongo.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from pymongo.asynchronous.database import AsyncDatabase

from ..repositories import cards as cards_repo
from ..repositories import collection as collection_repo
from . import availability
from .formats import FormatSpec, get_format

COLOR_ORDER = ["W", "U", "B", "R", "G"]


class CommanderNotFound(Exception):
    def __init__(self, name: str, suggestions: list[str]):
        self.name = name
        self.suggestions = suggestions
        super().__init__(f"No card found matching '{name}'.")


@dataclass
class Pool:
    # None for formats without a commander (Standard, Legacy).
    commander: dict | None
    color_identity: list[str]
    pool: list[dict]
    # oracle_id -> list of owned printing units (see collection_repo.owned_printings)
    printings: dict[str, list[dict]] = None  # type: ignore[assignment]
    format_key: str = "commander"
    # For non-Commander formats this is the FULL legal pool, unfiltered by color —
    # the colors below are the generator's filter, not the pool's.
    colors: list[str] = field(default_factory=list)
    color_choice: object | None = None
    # Which slice of the collection this pool was drawn from. Echoed back to the
    # client so the build screen can confirm the filters actually applied.
    scope: str = availability.SCOPE_OWNED
    sets: list[str] = field(default_factory=list)


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


async def _load_inventory(
    db: AsyncDatabase,
    user_id: str,
    *,
    scope: str,
    sets: list[str] | None,
    exclude_deck_id: str | None,
) -> tuple[dict[str, list[dict]], dict[str, int]]:
    """The printings a build may draw on, plus the copy count per oracle id.

    Both filters act on owned printing *units*, in the order Danko reasons about
    them: narrow to what isn't already sleeved up, then narrow to the sets you
    feel like building from. A card survives only if some unit survives both.

    Under the default ``owned`` scope with no set filter this is exactly the old
    ``owned_counts()`` result — the availability pass still runs so every unit
    carries an ``available`` number for display, but nothing is excluded.
    """
    printings = await collection_repo.owned_printings(db, user_id)
    printings = availability.filter_units_by_set(printings, sets)
    committed = await availability.committed_by_printing(
        db, user_id, exclude_deck_id=exclude_deck_id
    )
    printings = availability.apply_committed(printings, committed)
    count_key = "available" if scope == availability.SCOPE_AVAILABLE else "count"
    return printings, availability.counts_from_units(printings, key=count_key)


async def get_pool(
    db: AsyncDatabase,
    user_id: str,
    commander_name: str,
    *,
    scope: str = availability.SCOPE_OWNED,
    sets: list[str] | None = None,
    exclude_deck_id: str | None = None,
) -> Pool:
    commander = await cards_repo.find_commander(db, commander_name)
    if commander is None:
        suggestions = [c["name"] for c in await cards_repo.search(db, commander_name, limit=10)]
        raise CommanderNotFound(commander_name, suggestions)

    identity = commander.get("color_identity", [])
    printings, owned = await _load_inventory(
        db, user_id, scope=scope, sets=sets, exclude_deck_id=exclude_deck_id
    )
    pool = await cards_repo.get_legal_pool(
        db, allowed_colors=identity, owned_counts=owned, exclude_oracle_id=commander["_id"]
    )
    return Pool(
        commander=commander,
        color_identity=identity,
        pool=pool,
        printings=printings,
        format_key="commander",
        colors=identity,
        scope=scope,
        sets=list(sets or []),
    )


async def get_pool_for_format(
    db: AsyncDatabase,
    user_id: str,
    spec: FormatSpec | None = None,
    commander_name: str | None = None,
    *,
    scope: str = availability.SCOPE_OWNED,
    sets: list[str] | None = None,
    exclude_deck_id: str | None = None,
) -> Pool:
    """Format-aware pool loader.

    Commander delegates to `get_pool` verbatim — that path is untouched.

    Constructed formats fetch the whole legality-filtered owned pool with NO color
    filter. Colors are decided at generation time instead, so the client can retoggle
    them without a refetch and the color knob behaves like the strategy and theme
    knobs sitting next to it.
    """
    fmt = spec or get_format(None)

    if fmt.requires_commander:
        if not commander_name:
            raise ValueError(f"{fmt.label} requires a commander")
        return await get_pool(
            db, user_id, commander_name,
            scope=scope, sets=sets, exclude_deck_id=exclude_deck_id,
        )

    printings, owned = await _load_inventory(
        db, user_id, scope=scope, sets=sets, exclude_deck_id=exclude_deck_id
    )
    pool = await cards_repo.get_constructed_pool(
        db, legality_field=fmt.legality_field, owned_counts=owned
    )
    return Pool(
        commander=None,
        color_identity=[],
        pool=pool,
        printings=printings,
        format_key=fmt.key,
        colors=[],
        scope=scope,
        sets=list(sets or []),
    )
