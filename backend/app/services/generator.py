"""Deck generator (Phase 3).

Given a commander and the user's legal pool, assemble a 99-card deck (100 with
the commander) by a transparent, greedy fill:

  1. Tag every pool card with roles (services/roles.py).
  2. Fill role quotas (ramp / draw / removal / wipes) and a target mana curve
     with a single greedy pass that scores each card on role need + curve need +
     efficiency, recording *why* each card was chosen.
  3. Build the mana base from owned nonbasic lands, topped up with basics split
     by the deck's colored-pip demand.
  4. Report consistency stats via the Phase 2 mana math.

Card *quality* ranking (EDHREC/synergy) is intentionally NOT here yet — that
arrives in Phase 4. So within a role, selection is by curve fit + efficiency,
which yields a legal, well-shaped deck but not yet a tuned one.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import mana_math, roles

COLOR_ORDER = ["W", "U", "B", "R", "G"]
BASIC_FOR_COLOR = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}

DEFAULT_LAND_COUNT = 37
DEFAULT_QUOTAS = {roles.RAMP: 10, roles.CARD_DRAW: 10, roles.REMOVAL: 8, roles.BOARD_WIPE: 3}
# Priority order when a card could fill several still-needed roles.
ROLE_FILL_ORDER = [roles.BOARD_WIPE, roles.REMOVAL, roles.RAMP, roles.CARD_DRAW]
# Target nonland mana-curve shape (fractions by MV bucket 0..7, 7 = 7+).
CURVE_WEIGHTS = {0: 0.03, 1: 0.12, 2: 0.22, 3: 0.20, 4: 0.15, 5: 0.11, 6: 0.08, 7: 0.09}

_SYMBOL_RE = re.compile(r"\{([^}]+)\}")


@dataclass
class DeckCard:
    oracle_id: str
    name: str
    mana_cost: str
    cmc: float
    type_line: str
    color_identity: list[str]
    roles: list[str]
    slot: str          # land | ramp | card_draw | removal | board_wipe | game_plan
    reason: str
    count: int = 1


@dataclass
class GeneratedDeck:
    cards: list[DeckCard] = field(default_factory=list)
    nonland_count: int = 0
    land_count: int = 0
    role_counts: dict = field(default_factory=dict)
    curve: list[dict] = field(default_factory=list)
    color_sources: dict = field(default_factory=dict)
    stats: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _color_pips(mana_cost: str) -> dict:
    pips = {c: 0 for c in COLOR_ORDER}
    for sym in _SYMBOL_RE.findall(mana_cost or ""):
        for c in COLOR_ORDER:
            if c in sym.split("/"):
                pips[c] += 1
    return pips


def _bucket(cmc: float) -> int:
    return min(int(cmc or 0), 7)


def _deck_card(doc: dict, role_set: set[str], slot: str, reason: str, count: int = 1) -> DeckCard:
    return DeckCard(
        oracle_id=doc["_id"],
        name=doc["name"],
        mana_cost=doc.get("mana_cost", ""),
        cmc=doc.get("cmc", 0.0),
        type_line=doc.get("type_line", ""),
        color_identity=doc.get("color_identity", []),
        roles=sorted(role_set),
        slot=slot,
        reason=reason,
        count=count,
    )


def generate(
    commander: dict,
    pool: list[dict],
    identity: list[str],
    basics_by_color: dict[str, dict],
    land_count: int = DEFAULT_LAND_COUNT,
    quotas: dict | None = None,
) -> GeneratedDeck:
    quotas = {**DEFAULT_QUOTAS, **(quotas or {})}
    deck = GeneratedDeck(land_count=land_count)

    # Tag pool, split lands from nonlands.
    tagged = [(doc, roles.tag_roles(doc)) for doc in pool]
    nonlands = [(d, r) for d, r in tagged if roles.LAND not in r]
    owned_lands = [(d, r) for d, r in tagged if roles.LAND in r]

    nonland_slots = max(0, 99 - land_count)

    # ---- Greedy nonland fill ----
    role_remaining = dict(quotas)
    curve_remaining = {b: round(CURVE_WEIGHTS[b] * nonland_slots) for b in range(8)}
    chosen: list[DeckCard] = []
    used: set[str] = set()

    for _ in range(nonland_slots):
        best = None
        best_score = float("-inf")
        best_role = None
        for doc, rset in nonlands:
            if doc["_id"] in used:
                continue
            score = 0.0
            fills = None
            for role in ROLE_FILL_ORDER:
                if role in rset and role_remaining.get(role, 0) > 0:
                    fills = role
                    score += 3.0
                    break
            b = _bucket(doc.get("cmc", 0))
            if curve_remaining.get(b, 0) > 0:
                score += 1.5
            score += max(0.0, 8 - (doc.get("cmc") or 0)) * 0.05  # efficiency tiebreak
            if roles.CREATURE in rset:
                score += 0.15
            if score > best_score:
                best_score, best, best_role = score, (doc, rset), fills
        if best is None:
            break
        doc, rset = best
        used.add(doc["_id"])
        b = _bucket(doc.get("cmc", 0))
        curve_remaining[b] = curve_remaining.get(b, 0) - 1
        if best_role:
            role_remaining[best_role] -= 1
            slot, reason = best_role, f"Fills {roles.ROLE_LABELS[best_role].lower()} slot"
        else:
            slot, reason = "game_plan", f"Game plan / curve filler (MV {b if b < 7 else '7+'})"
        chosen.append(_deck_card(doc, rset, slot, reason))

    # ---- Mana base: owned nonbasic lands first, then basics by pip demand ----
    nonbasic = [(d, r) for d, r in owned_lands if not d.get("is_basic_land")]
    # Prefer lands that fix more of the deck's colors.
    nonbasic.sort(
        key=lambda dr: (
            -len(set(dr[0].get("produced_mana") or []) & set(identity)),
            dr[0].get("name") or "",
        )
    )
    land_cards: list[DeckCard] = []
    for doc, rset in nonbasic[:land_count]:
        land_cards.append(_deck_card(doc, rset, "land", "Mana base (owned nonbasic land)"))

    remaining_lands = land_count - len(land_cards)
    if remaining_lands > 0:
        demand = {c: 0 for c in COLOR_ORDER}
        for dc in chosen:
            for color, n in _color_pips(dc.mana_cost).items():
                demand[color] += n
        colors = [c for c in COLOR_ORDER if c in identity] or COLOR_ORDER
        total_demand = sum(demand[c] for c in colors)
        # Distribute basics proportional to pip demand (even split if no demand).
        for i, c in enumerate(colors):
            share = (demand[c] / total_demand) if total_demand else (1 / len(colors))
            n = round(remaining_lands * share)
            # give the last color any rounding remainder
            if i == len(colors) - 1:
                n = remaining_lands - sum(bc.count for bc in land_cards if bc.slot == "land" and bc.oracle_id.startswith("basic:"))
            if n <= 0 or c not in basics_by_color:
                continue
            basic = basics_by_color[c]
            land_cards.append(
                DeckCard(
                    oracle_id=f"basic:{c}",
                    name=basic["name"],
                    mana_cost="",
                    cmc=0.0,
                    type_line=basic.get("type_line", "Basic Land"),
                    color_identity=basic.get("color_identity", [c]),
                    roles=[roles.LAND],
                    slot="land",
                    reason="Basic land (color fixing)",
                    count=n,
                )
            )

    deck.cards = land_cards + chosen
    deck.nonland_count = len(chosen)
    actual_lands = sum(c.count for c in land_cards)
    deck.land_count = actual_lands

    # ---- Stats ----
    role_counts: dict[str, int] = {}
    for c in chosen:
        role_counts[c.slot] = role_counts.get(c.slot, 0) + 1
    deck.role_counts = role_counts

    curve_hist = {b: 0 for b in range(8)}
    for c in chosen:
        curve_hist[_bucket(c.cmc)] += 1
    deck.curve = [{"cmc": b, "count": curve_hist[b]} for b in range(8)]

    # Color sources: lands + ramp that can make each color (within identity).
    sources = {c: 0 for c in COLOR_ORDER if c in identity}
    id_to_doc = {d["_id"]: d for d, _ in tagged}
    for c in deck.cards:
        if c.oracle_id.startswith("basic:"):
            color = c.oracle_id.split(":")[1]
            if color in sources:
                sources[color] += c.count
            continue
        doc = id_to_doc.get(c.oracle_id)
        produced = set(doc.get("produced_mana") or []) if doc else set()
        for color in produced:
            if color in sources:
                sources[color] += c.count
    deck.color_sources = sources

    # Consistency via Phase 2 mana math.
    deck.stats = {
        "p_2plus_lands_opening": round(
            mana_math.hypergeometric_at_least(99, actual_lands, 7, 2) * 100, 1
        ),
        "p_3plus_lands_opening": round(
            mana_math.hypergeometric_at_least(99, actual_lands, 7, 3) * 100, 1
        ),
        "avg_nonland_mv": round(
            sum(c.cmc for c in chosen) / len(chosen), 2
        ) if chosen else 0.0,
    }

    # Warnings for unmet quotas / short pool.
    total = sum(c.count for c in deck.cards)
    if total < 99:
        deck.warnings.append(
            f"Only {total} cards — your pool is short {99 - total} of a full 99 "
            "(not enough eligible owned cards)."
        )
    for role, left in role_remaining.items():
        if left > 0:
            deck.warnings.append(
                f"{left} short on {roles.ROLE_LABELS[role].lower()} — pool lacks enough of this role."
            )

    return deck
