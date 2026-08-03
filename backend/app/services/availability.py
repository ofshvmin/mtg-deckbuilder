"""Which physical copies are free, and which are already committed to a deck.

The collection tells us what Danko *owns*; saved decks flagged ``in_use`` tell us
what is already sleeved up and therefore unavailable to a new build. This module
is the arithmetic between the two, keyed by ``printing_key`` (the
``{edition}|{collector_number}|{finish}`` seam from ``util.printing_key``) so a
card owned in three sets is accounted for per-printing rather than as one number.

Everything here is a pure function over the dicts ``collection_repo.owned_printings``
already returns, apart from ``committed_by_printing`` and ``deck_shortfalls``, which
each do a single read of the ``decks`` collection.

Availability is allowed to go negative. Two in-use decks may both claim the only
copy you own; the pool math simply drops the card (nothing at or below zero is
buildable) and ``deck_shortfalls`` decides which deck has to show it as unowned.
"""
from __future__ import annotations

from pymongo.asynchronous.database import AsyncDatabase

# Pool scopes accepted by the build endpoints.
SCOPE_OWNED = "owned"
SCOPE_AVAILABLE = "available"
SCOPES = (SCOPE_OWNED, SCOPE_AVAILABLE)


def normalize_scope(value: str | None) -> str:
    """Coerce a client-supplied pool scope, defaulting to the permissive one.

    An unknown scope falls back to "owned" rather than erroring: a typo should
    build you a deck from your whole collection, not fail the request.
    """
    return value if value in SCOPES else SCOPE_OWNED


def is_filtered(scope: str, sets: list[str] | None) -> bool:
    """Whether the caller narrowed the pool at all (vs. the default whole collection)."""
    return scope != SCOPE_OWNED or bool(sets)


def empty_pool_message(format_label: str, scope: str, sets: list[str] | None) -> str:
    """Explain an empty pool in terms of the filters that emptied it.

    Without this the available/set filters fail with the generic "no legal cards"
    message, which reads as a broken collection rather than an over-narrow filter.
    """
    if sets:
        codes = ", ".join(str(s).upper() for s in sets)
        where = "the set" if len(sets) == 1 else "the sets"
        tail = (
            " that aren't already in a deck you're using."
            if scope == SCOPE_AVAILABLE
            else " in your collection."
        )
        return f"No {format_label}-legal cards from {where} you picked ({codes}){tail}"
    if scope == SCOPE_AVAILABLE:
        return (
            f"No {format_label}-legal cards available — every eligible card in your "
            "collection is already in a deck you've marked as in use."
        )
    return f"No {format_label}-legal cards in your collection."


def card_allocation(card: dict) -> dict[str, int]:
    """How many copies of each printing a saved deck card claims.

    ``printing_allocation`` is authoritative when present. Decks saved before
    this feature only carry ``selected_printing_key``, so fall back to charging
    the card's whole ``count`` to that key — the same thing the allocator would
    have written. Basics (and any card with no owned printing) claim nothing.
    """
    alloc = card.get("printing_allocation")
    if isinstance(alloc, dict):
        cleaned = {str(k): int(v) for k, v in alloc.items() if k and int(v or 0) > 0}
        # An all-zero or empty allocation isn't an allocation — fall through to
        # the selected key rather than silently reporting the deck claims nothing.
        if cleaned:
            return cleaned
    key = card.get("selected_printing_key")
    if not key:
        return {}
    return {str(key): int(card.get("count") or 1)}


def _deck_claims(deck_doc: dict) -> dict[str, dict[str, int]]:
    """oracle_id -> printing_key -> copies, for one saved-deck document."""
    claims: dict[str, dict[str, int]] = {}
    for card in (deck_doc.get("deck") or {}).get("cards") or []:
        oracle_id = card.get("oracle_id")
        if not oracle_id:
            continue
        for key, copies in card_allocation(card).items():
            per_card = claims.setdefault(oracle_id, {})
            per_card[key] = per_card.get(key, 0) + copies
    return claims


async def _in_use_decks(
    db: AsyncDatabase, user_id: str, *, exclude_deck_id: str | None = None
) -> list[dict]:
    """The user's in-use decks, oldest first.

    Ordered by ``created_at`` so shortfall attribution is stable: the deck that
    existed first keeps the physical copy. ``updated_at`` would reshuffle the
    blame every time an unrelated deck was renamed.
    """
    cursor = db.decks.find(
        {"user_id": user_id, "in_use": True},
        {"deck.cards": 1, "created_at": 1, "name": 1},
    )
    docs = [doc async for doc in cursor]
    # Excluded in Python on the stringified id rather than as a `$ne` on an
    # ObjectId: a malformed id would make the ObjectId conversion throw, and a
    # silently-unapplied exclusion means a deck competes with itself for its own
    # cards. We already read every in-use deck, so this costs nothing.
    if exclude_deck_id:
        docs = [d for d in docs if str(d.get("_id")) != str(exclude_deck_id)]
    docs.sort(key=lambda d: (d.get("created_at") or "", str(d.get("_id"))))
    return docs


async def committed_by_printing(
    db: AsyncDatabase, user_id: str, *, exclude_deck_id: str | None = None
) -> dict[str, dict[str, int]]:
    """oracle_id -> printing_key -> copies locked up in in-use decks.

    ``exclude_deck_id`` keeps a deck from competing with itself: when you reopen
    an in-use deck and regenerate it, its own copies must read as available or
    the rebuild would be unable to keep any of its cards.
    """
    total: dict[str, dict[str, int]] = {}
    for doc in await _in_use_decks(db, user_id, exclude_deck_id=exclude_deck_id):
        for oracle_id, per_printing in _deck_claims(doc).items():
            bucket = total.setdefault(oracle_id, {})
            for key, copies in per_printing.items():
                bucket[key] = bucket.get(key, 0) + copies
    return total


def filter_units_by_set(
    printings: dict[str, list[dict]], sets: list[str] | None
) -> dict[str, list[dict]]:
    """Keep only owned printings from the given set codes.

    ``sets`` is a list of Scryfall set codes; empty or None means no filter.
    Cards left with no surviving printing drop out of the map entirely, which is
    what removes them from the build pool.
    """
    if not sets:
        return printings
    wanted = {str(s).strip().lower() for s in sets if str(s).strip()}
    if not wanted:
        return printings
    result: dict[str, list[dict]] = {}
    for oracle_id, units in printings.items():
        kept = [u for u in units if str(u.get("edition") or "").lower() in wanted]
        if kept:
            result[oracle_id] = kept
    return result


def apply_committed(
    printings: dict[str, list[dict]], committed: dict[str, dict[str, int]]
) -> dict[str, list[dict]]:
    """Stamp ``available`` on every owned printing unit.

    ``count`` is left alone — it stays the number owned, so the UI can show
    "2 owned, 1 available" rather than silently rewriting your inventory. The
    result may be negative when decks over-claim; callers clamp where they care.
    """
    result: dict[str, list[dict]] = {}
    for oracle_id, units in printings.items():
        claims = committed.get(oracle_id) or {}
        result[oracle_id] = [
            {**unit, "available": int(unit.get("count") or 0) - claims.get(unit["printing_key"], 0)}
            for unit in units
        ]
    return result


def counts_from_units(printings: dict[str, list[dict]], *, key: str = "count") -> dict[str, int]:
    """oracle_id -> total copies, summing ``key`` across a card's printings.

    Use ``key="available"`` for the available-only pool and ``key="count"`` for
    the owned pool. Cards summing to zero or less are omitted — the pool is a map
    of what you can actually build with.
    """
    result: dict[str, int] = {}
    for oracle_id, units in printings.items():
        total = sum(int(u.get(key) or 0) for u in units)
        if total > 0:
            result[oracle_id] = total
    return result


def allocate(units: list[dict], count: int) -> dict[str, int]:
    """Choose which owned printings a deck card should claim.

    Spends from the printing with the most copies free first, so a 4-of splits
    across sets naturally instead of over-claiming one printing. If nothing is
    free (every copy is already in another in-use deck) it still returns a key —
    over-allocation is allowed by design, and a deck card with no printing at all
    would lose its pull-list entry and its "which copy is this" answer.
    """
    if not units or count <= 0:
        return {}
    remaining = count
    alloc: dict[str, int] = {}
    for unit in sorted(units, key=lambda u: -int(u.get("available", u.get("count")) or 0)):
        free = int(unit.get("available", unit.get("count")) or 0)
        if free <= 0:
            continue
        take = min(free, remaining)
        alloc[unit["printing_key"]] = alloc.get(unit["printing_key"], 0) + take
        remaining -= take
        if remaining == 0:
            return alloc
    # Nothing free (or not enough): charge the shortfall to the first printing.
    fallback = units[0]["printing_key"]
    alloc[fallback] = alloc.get(fallback, 0) + remaining
    return alloc


def primary_key(allocation: dict[str, int]) -> str | None:
    """The printing a deck card displays as *the* copy it holds.

    The largest slice of the allocation, tie-broken by key so the choice is
    stable across rebuilds.
    """
    if not allocation:
        return None
    return sorted(allocation.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


async def deck_shortfalls(
    db: AsyncDatabase, user_id: str, deck_id: str, owned: dict[str, list[dict]]
) -> dict[str, bool]:
    """oracle_id -> whether this deck's claim on that card can't be honoured.

    Walks every in-use deck oldest-first, spending down the owned inventory. A
    card is short when the copies still on the shelf, by the time this deck's
    turn comes, don't cover what it asked for. The upshot: your older decks stay
    clean and the newest one shows the contested card greyed out.

    Returns an empty map for a deck that isn't in use — a deck you haven't
    sleeved up isn't competing for anything.
    """
    remaining: dict[str, int] = {
        oracle_id: sum(int(u.get("count") or 0) for u in units)
        for oracle_id, units in owned.items()
    }
    shortfalls: dict[str, bool] = {}
    for doc in await _in_use_decks(db, user_id):
        is_target = str(doc.get("_id")) == deck_id
        for oracle_id, per_printing in _deck_claims(doc).items():
            wanted = sum(per_printing.values())
            have = remaining.get(oracle_id, 0)
            if is_target:
                shortfalls[oracle_id] = have < wanted
            remaining[oracle_id] = have - wanted
        if is_target:
            break
    return shortfalls
