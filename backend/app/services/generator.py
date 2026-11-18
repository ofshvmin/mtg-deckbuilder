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

Within a role, card quality decides: EDHREC's data for the commander
(Commander only), and card rank — Scryfall's `edhrec_rank` as `rank_score` —
weighted by the format's `rank_weight` (60-card formats; zero for Commander).
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from . import availability, mana_math, roles
from .formats import FormatSpec, get_format
from .strategies import Strategy, get_strategy

COLOR_ORDER = ["W", "U", "B", "R", "G"]
BASIC_FOR_COLOR = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}

DEFAULT_LAND_COUNT = 37
DEFAULT_QUOTAS = {roles.RAMP: 10, roles.CARD_DRAW: 10, roles.REMOVAL: 8, roles.BOARD_WIPE: 3}
# Priority order when a card could fill several still-needed roles.
ROLE_FILL_ORDER = [roles.BOARD_WIPE, roles.REMOVAL, roles.RAMP, roles.CARD_DRAW]
# How strongly the EDHREC quality signal influences selection. Kept below the
# role bonus (3.0) so role quotas still fill, but above the efficiency tiebreak
# so that among role/curve-equivalent cards, the community-proven one wins.
QUALITY_WEIGHT = 2.0
# Bonus for a card that is a piece of a combo assemblable from the pool, to
# encourage the generator to actually include all the pieces.
COMBO_WEIGHT = 1.5
# Bonus for a card that matches the user's chosen theme. Sits between the role
# bonus (3.0) and EDHREC quality (2.0), so role cards still fill first but
# theme-matching cards dominate among the "game plan" slots.
THEME_WEIGHT = 2.5
# rank_score at or above this (about the top 150 cards by edhrec_rank) earns the
# "Widely played" reason when card rank is in use.
WIDELY_PLAYED = 0.5

# Hidden gems: cards that are played, but not staples. The bonus is full across
# the sweet spot (rank_score 0.2-0.35 ≈ ranks 800-3,900), ramps up from the floor
# (0.1 ≈ rank 10,000: below it a card is more likely unplayable or brand new than
# undiscovered) and fades out toward the staples (0.6 ≈ rank 60).
GEM_FLOOR = 0.1
GEM_SWEET = (0.2, 0.35)
GEM_CEILING = 0.6
# gem_bonus at or above this earns the "Hidden gem" reason.
HIDDEN_GEM = 0.75


def gem_bonus(rank_score: float) -> float:
    """0-1 bonus for being played, but rarely."""
    low, high = GEM_SWEET
    if rank_score < GEM_FLOOR or rank_score >= GEM_CEILING:
        return 0.0
    if rank_score < low:
        return (rank_score - GEM_FLOOR) / (low - GEM_FLOOR)
    if rank_score <= high:
        return 1.0
    return (GEM_CEILING - rank_score) / (GEM_CEILING - high)
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
    quality: float = 0.0   # EDHREC quality score (0 if unknown / not on EDHREC)
    # Owned printing units for this card (which physical copies Danko has, and
    # where they live). Empty for generator-added basics.
    printings: list = field(default_factory=list)
    # Which physical copies this deck holds: printing_key -> copies. Set by
    # `_allocate_printings` once counts are final, and the number the availability
    # math charges against the collection. selected_printing_key is the largest
    # slice of it — the single copy the pull list and card art display.
    printing_allocation: dict | None = None
    selected_printing_key: str | None = None


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
    strategy: str | None = None
    theme: str | None = None
    theme_count: int = 0


def _color_pips(mana_cost: str) -> dict:
    pips = {c: 0 for c in COLOR_ORDER}
    for sym in _SYMBOL_RE.findall(mana_cost or ""):
        for c in COLOR_ORDER:
            if c in sym.split("/"):
                pips[c] += 1
    return pips


def _bucket(cmc: float) -> int:
    return min(int(cmc or 0), 7)


def _deck_card(
    doc: dict,
    role_set: set[str],
    slot: str,
    reason: str,
    count: int = 1,
    quality: float = 0.0,
    printings: dict[str, list[dict]] | None = None,
) -> DeckCard:
    units = (printings or {}).get(doc["_id"], [])
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
        quality=round(quality, 4),
        printings=list(units),
    )


def _allocate_printings(cards: list[DeckCard]) -> None:
    """Earmark the physical copies each card in the finished deck holds.

    A post-pass rather than part of ``_deck_card`` because the greedy fill bumps
    ``count`` after a card is created (a 4-of starts life as a 1-of), and the
    allocation has to be made against the final number of copies. Prefers
    printings with copies still free, so building against the ``available`` scope
    doesn't hand you a card another in-use deck is already holding.
    """
    for card in cards:
        alloc = availability.allocate(card.printings, card.count)
        card.printing_allocation = alloc or None
        card.selected_printing_key = availability.primary_key(alloc)


# Mana bases, every format. A nonbasic must be widely played (rank_score 0.4 ≈ the
# top 500 by edhrec_rank) — real duals clear it easily (Breeding Pool 0.60, Temple
# of Mystery 0.43); the tapped five-color utility lands that used to fill whole
# mana bases sit at 0.1-0.3. And a fixed share of the lands is always basics.
#
# 60-card decks also need every nonbasic to make one of the deck's colors, and keep
# more basics the fewer colors they have. Commander keeps colorless utility lands
# (Reliquary Tower, Rogue's Passage) and a smaller floor: its decks really do run
# many nonbasics. Either way a mono-color deck skips rainbow lands (Exotic Orchard,
# Mana Confluence) — it needs no fixing, so they're worse than a basic.
LAND_RANK_FLOOR = 0.4
MIN_BASIC_SHARE = {1: 0.75, 2: 0.4, 3: 0.3}
COMMANDER_MIN_BASIC_SHARE = 0.25

_BASIC_TYPE_COLOR = {"plains": "W", "island": "U", "swamp": "B", "mountain": "R", "forest": "G"}
_FETCH_RE = re.compile(r"search your library for (.{0,80}?) card", re.IGNORECASE)


def _land_colors(doc: dict) -> set[str]:
    """The colors a land provides: what it taps for, plus the basic land types it
    fetches. A fetchland taps for nothing — Polluted Delta is an Island or a Swamp,
    which is no use to a green deck; Evolving Wilds ("a basic land card") is any."""
    colors = set(doc.get("produced_mana") or []) & set(COLOR_ORDER)
    m = _FETCH_RE.search(doc.get("oracle_text") or "")
    if m:
        wanted = m.group(1).lower()
        named = {c for t, c in _BASIC_TYPE_COLOR.items() if t in wanted}
        colors |= named or ({"W", "U", "B", "R", "G"} if "basic land" in wanted else set())
    return colors


def _choose_nonbasics(
    owned_lands: list[tuple[dict, set[str]]],
    identity: list[str],
    land_count: int,
    locked_ids: set[str],
    commander: bool,
) -> tuple[list[tuple[dict, set[str]]], int]:
    """The nonbasic lands a deck may use, best first, and how many slots they may
    fill — the rest are basics."""
    colors = set(identity)
    # Cards synced before card rank have no rank_score at all. Judging them would
    # read every land as unplayed and leave a deck of basics, so until the sync
    # adds the field the floor stands aside and only the basics share applies.
    ranked = any("rank_score" in doc for doc, _ in owned_lands)
    eligible = []
    for doc, rset in owned_lands:
        if doc.get("is_basic_land") or "Basic" in (doc.get("type_line") or ""):
            continue  # snow basics and the like: the basics fill covers them
        produced = _land_colors(doc)
        makes = produced & colors
        locked = doc["_id"] in locked_ids
        popular = not ranked or (doc.get("rank_score") or 0.0) >= LAND_RANK_FLOOR
        rainbow_in_mono = len(colors) == 1 and len(produced) > 2
        # Commander keeps colorless utility lands; a land that does provide colors
        # must provide one of the deck's (no off-color fetches).
        on_color = bool(makes) or (commander and not produced)
        if locked or (popular and on_color and not rainbow_in_mono):
            eligible.append((doc, rset, len(makes), locked))
    eligible.sort(
        key=lambda e: (
            0 if e[3] else 1,
            -e[2],  # fixes more of the deck's colors
            -(e[0].get("rank_score") or 0.0),
            e[0].get("name") or "",
        )
    )
    if commander:
        share = COMMANDER_MIN_BASIC_SHARE
    else:
        share = MIN_BASIC_SHARE.get(len(colors), min(MIN_BASIC_SHARE.values()))
    budget = land_count - round(land_count * share)
    locked_count = sum(1 for e in eligible if e[3])
    return [(doc, rset) for doc, rset, _, _ in eligible], max(budget, locked_count)


def generate(
    commander: dict | None,
    pool: list[dict],
    identity: list[str],
    basics_by_color: dict[str, dict],
    land_count: int | None = None,
    quotas: dict | None = None,
    quality: dict[str, float] | None = None,
    combo_pieces: set[str] | None = None,
    printings: dict[str, list[dict]] | None = None,
    strategy: Strategy | None = None,
    theme_matches: set[str] | None = None,
    locked_ids: set[str] | None = None,
    avoid_combos: bool = False,
    jitter: float = 0.0,
    spec: FormatSpec | None = None,
    locked_counts: dict[str, int] | None = None,
    rank_weight: float | None = None,
    quality_weight: float | None = None,
) -> GeneratedDeck:
    fmt = spec or get_format(None)
    effective_rank_weight = fmt.rank_weight if rank_weight is None else rank_weight
    effective_quality_weight = QUALITY_WEIGHT if quality_weight is None else quality_weight
    strat = strategy or get_strategy(None, fmt)
    # Explicit params override strategy defaults
    effective_land_count = land_count if land_count is not None else strat.land_count
    effective_quotas = {**strat.quotas, **(quotas or {})}
    effective_curve = strat.curve_weights
    effective_combo_weight = (
        0.0
        if avoid_combos
        else strat.combo_weight_override
        if strat.combo_weight_override is not None
        else COMBO_WEIGHT
    )
    quality = quality or {}
    combo_pieces = combo_pieces or set()
    theme_matches = theme_matches or set()
    printings = printings or {}
    locked_ids = locked_ids or set()
    locked_counts = locked_counts or {}
    max_quality = max(quality.values()) if quality else 0.0
    deck = GeneratedDeck(land_count=effective_land_count)

    def q(oid: str) -> float:
        return quality.get(oid, 0.0)

    def q_norm(oid: str) -> float:
        return (q(oid) / max_quality) if max_quality > 0 else 0.0

    # Tag pool, split lands from nonlands.
    tagged = [(doc, roles.tag_roles(doc)) for doc in pool]
    nonlands = [(d, r) for d, r in tagged if roles.LAND not in r]
    owned_lands = [(d, r) for d, r in tagged if roles.LAND in r]

    nonland_slots = max(0, fmt.deck_size - effective_land_count)

    # ---- Greedy nonland fill ----
    role_remaining = dict(effective_quotas)
    curve_remaining = {b: round(effective_curve.get(b, 0.0) * nonland_slots) for b in range(8)}
    chosen: list[DeckCard] = []
    # Copies of each card already placed. Under Commander (max_copies=1) the guard
    # `counts[id] < cap` is exactly the old `id not in used` membership test.
    counts: dict[str, int] = {}

    def cap(doc: dict) -> int:
        """How many copies of this card may go in the deck."""
        return min(doc.get("copies_owned", 1) or 1, fmt.max_copies)

    # Pre-place locked nonlands (kept from a previous build, or an AI-chosen core),
    # counting them against role/curve budgets so the greedy fill builds *around*
    # them. `locked_counts` lets a lock ask for several copies; anything not listed
    # there is a single copy, which is all Commander can ever have.
    placed = 0
    for doc, rset in nonlands:
        if doc["_id"] not in locked_ids or placed >= nonland_slots:
            continue
        want = min(locked_counts.get(doc["_id"], 1), cap(doc), nonland_slots - placed)
        if want < 1:
            continue
        counts[doc["_id"]] = counts.get(doc["_id"], 0) + want
        placed += want
        curve_remaining[_bucket(doc.get("cmc", 0))] -= want
        role = next(
            (r for r in ROLE_FILL_ORDER if r in rset and role_remaining.get(r, 0) > 0),
            None,
        )
        if role:
            role_remaining[role] -= want
            slot = role
            reason = f"Kept · fills {roles.ROLE_LABELS[role].lower()} slot"
        else:
            slot, reason = "game_plan", "Kept (locked)"
        card = _deck_card(doc, rset, slot, reason, quality=q(doc["_id"]), printings=printings)
        card.count = want
        chosen.append(card)

    # Iterate on copies placed, not entries: a pre-placed 4-of already filled four
    # slots even though it is a single entry in `chosen`.
    for _ in range(nonland_slots - placed):
        best = None
        best_score = float("-inf")
        best_role = None
        for doc, rset in nonlands:
            if counts.get(doc["_id"], 0) >= cap(doc):
                continue
            score = 0.0
            fills = None
            for role in ROLE_FILL_ORDER:
                if role in rset and role_remaining.get(role, 0) > 0:
                    fills = role
                    score += 3.0
                    break
            b = _bucket(doc.get("cmc", 0))
            curve_need = curve_remaining.get(b, 0) > 0
            if curve_need:
                score += 1.5
            score += effective_quality_weight * q_norm(doc["_id"])  # EDHREC community signal
            rank = doc.get("rank_score") or 0.0
            if effective_rank_weight >= 0:
                score += effective_rank_weight * rank  # card rank
            elif fills or curve_need:
                score += -effective_rank_weight * gem_bonus(rank)  # hidden gems
            # Rising bonus for going deeper on a card already in the deck: the 2nd copy
            # of the best card outbids the 1st copy of the 10th-best, which is what
            # makes 60-card output a spine of playsets rather than a singleton pile.
            # Zero under Commander, so this term vanishes there.
            score += fmt.copy_bonus * counts.get(doc["_id"], 0)
            if doc["_id"] in combo_pieces:
                score += effective_combo_weight  # piece of an assemblable combo
            if doc["_id"] in theme_matches:
                score += THEME_WEIGHT  # matches the user's chosen theme
            for scorer in strat.extra_scorers:
                score += scorer(doc, rset)
            score += max(0.0, 8 - (doc.get("cmc") or 0)) * 0.05  # efficiency tiebreak
            if jitter > 0:
                score += random.uniform(0, jitter)  # randomness for regenerate variety
            if roles.CREATURE in rset:
                score += 0.15
            if score > best_score:
                best_score, best, best_role = score, (doc, rset), fills
        if best is None:
            break
        doc, rset = best
        copy_index = counts.get(doc["_id"], 0)
        counts[doc["_id"]] = copy_index + 1
        b = _bucket(doc.get("cmc", 0))
        curve_remaining[b] = curve_remaining.get(b, 0) - 1
        if best_role:
            role_remaining[best_role] -= 1
            slot = best_role
            reason = f"Fills {roles.ROLE_LABELS[best_role].lower()} slot"
            if doc["_id"] in theme_matches:
                reason += " (theme match)"
        elif doc["_id"] in theme_matches:
            slot, reason = "game_plan", "Theme pick"
        elif q_norm(doc["_id"]) >= 0.5:
            slot, reason = "game_plan", (
                "High-synergy pick (popular with this commander)"
                if fmt.supports_quality
                else "High-value pick"
            )
        elif effective_rank_weight > 0 and (doc.get("rank_score") or 0.0) >= WIDELY_PLAYED:
            slot, reason = "game_plan", "Widely played"
        elif effective_rank_weight < 0 and gem_bonus(doc.get("rank_score") or 0.0) >= HIDDEN_GEM:
            slot, reason = "game_plan", "Hidden gem"
        else:
            slot, reason = "game_plan", f"Game plan / curve filler (MV {b if b < 7 else '7+'})"
        if copy_index > 0:
            # Additional copy of a card already picked — bump its count instead of
            # emitting a second entry, matching how basics are represented. Under
            # Commander this branch is unreachable (cap is always 1).
            existing = next(c for c in chosen if c.oracle_id == doc["_id"])
            existing.count += 1
        else:
            chosen.append(
                _deck_card(doc, rset, slot, reason, quality=q(doc["_id"]), printings=printings)
            )

    # ---- Mana base: owned nonbasic lands first, then basics by pip demand ----
    nonbasic, nonbasic_budget = _choose_nonbasics(
        owned_lands, identity, effective_land_count, locked_ids, fmt.requires_commander
    )
    # Take up to `cap` copies of each nonbasic before moving on, so a 60-card manabase
    # gets playsets of its duals instead of a pile of distinct one-ofs. Under Commander
    # cap is 1, making this exactly the old `nonbasic[:effective_land_count]` slice.
    land_cards: list[DeckCard] = []
    placed_lands = 0
    for doc, rset in nonbasic:
        if placed_lands >= nonbasic_budget:
            break
        take = min(cap(doc), nonbasic_budget - placed_lands)
        card = _deck_card(
            doc, rset, "land", "Mana base (owned nonbasic land)", printings=printings
        )
        card.count = take
        land_cards.append(card)
        placed_lands += take

    remaining_lands = effective_land_count - placed_lands
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
    _allocate_printings(deck.cards)
    # Count copies, not entries — a 4-of is four cards. Identical under Commander,
    # where every entry is a singleton.
    deck.nonland_count = sum(c.count for c in chosen)
    actual_lands = sum(c.count for c in land_cards)
    deck.land_count = actual_lands

    # ---- Stats ----
    # Copies, not entries: a 4-of contributes four cards to its role and curve bucket.
    # Identical under Commander, where every nonland entry is a singleton.
    role_counts: dict[str, int] = {}
    for c in chosen:
        role_counts[c.slot] = role_counts.get(c.slot, 0) + c.count
    deck.role_counts = role_counts

    curve_hist = {b: 0 for b in range(8)}
    for c in chosen:
        curve_hist[_bucket(c.cmc)] += c.count
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
            mana_math.hypergeometric_at_least(fmt.deck_size, actual_lands, 7, 2) * 100, 1
        ),
        "p_3plus_lands_opening": round(
            mana_math.hypergeometric_at_least(fmt.deck_size, actual_lands, 7, 3) * 100, 1
        ),
        "avg_nonland_mv": round(
            sum(c.cmc for c in chosen) / len(chosen), 2
        ) if chosen else 0.0,
    }

    # Strategy / theme metadata
    deck.strategy = strat.name if strategy else None
    deck.theme = None
    deck.theme_count = 0
    if theme_matches:
        deck.theme_count = sum(1 for c in chosen if c.oracle_id in theme_matches)

    # Warnings for unmet quotas / short pool.
    total = sum(c.count for c in deck.cards)
    if total < fmt.deck_size:
        deck.warnings.append(
            f"Only {total} cards — your pool is short {fmt.deck_size - total} of a full "
            f"{fmt.deck_size} (not enough eligible owned cards)."
        )
    for role, left in role_remaining.items():
        if left > 0:
            deck.warnings.append(
                f"{left} short on {roles.ROLE_LABELS[role].lower()} — pool lacks enough of this role."
            )

    return deck


def compose(
    chosen_docs: list[dict],
    identity: list[str],
    quality: dict[str, float] | None = None,
    printings: dict[str, list[dict]] | None = None,
    spec: FormatSpec | None = None,
) -> GeneratedDeck:
    """Analyze an *exact* user-chosen set of cards into the same deck shape as
    ``generate`` — same role categories, curve, color sources and mana-math
    stats — but with no greedy fill and no auto-added basics. Powers the manual
    builder: whatever the user has added so far, computed live.
    """
    fmt = spec or get_format(None)
    quality = quality or {}
    printings = printings or {}
    max_quality = max(quality.values()) if quality else 0.0

    def q(oid: str) -> float:
        return quality.get(oid, 0.0)

    def q_norm(oid: str) -> float:
        return (q(oid) / max_quality) if max_quality > 0 else 0.0

    deck = GeneratedDeck()
    tagged = [(doc, roles.tag_roles(doc)) for doc in chosen_docs]

    chosen: list[DeckCard] = []
    land_cards: list[DeckCard] = []
    for doc, rset in tagged:
        if roles.LAND in rset:
            land_cards.append(_deck_card(doc, rset, "land", "Land", printings=printings))
            continue
        role = next((r for r in ROLE_FILL_ORDER if r in rset), None)
        if role:
            slot, reason = role, roles.ROLE_LABELS[role]
        elif q_norm(doc["_id"]) >= 0.5:
            slot, reason = "game_plan", "High-synergy pick (popular with this commander)"
        else:
            slot, reason = "game_plan", "Game plan"
        chosen.append(_deck_card(doc, rset, slot, reason, quality=q(doc["_id"]), printings=printings))

    deck.cards = land_cards + chosen
    _allocate_printings(deck.cards)
    deck.nonland_count = sum(c.count for c in chosen)
    actual_lands = sum(c.count for c in land_cards)
    deck.land_count = actual_lands
    total = sum(c.count for c in deck.cards)

    # Copies, not entries: a 4-of contributes four cards to its role and curve bucket.
    # Identical under Commander, where every nonland entry is a singleton.
    role_counts: dict[str, int] = {}
    for c in chosen:
        role_counts[c.slot] = role_counts.get(c.slot, 0) + c.count
    deck.role_counts = role_counts

    curve_hist = {b: 0 for b in range(8)}
    for c in chosen:
        curve_hist[_bucket(c.cmc)] += c.count
    deck.curve = [{"cmc": b, "count": curve_hist[b]} for b in range(8)]

    sources = {c: 0 for c in COLOR_ORDER if c in identity}
    id_to_doc = {d["_id"]: d for d, _ in tagged}
    for c in deck.cards:
        doc = id_to_doc.get(c.oracle_id)
        produced = set(doc.get("produced_mana") or []) if doc else set()
        for color in produced:
            if color in sources:
                sources[color] += c.count
    deck.color_sources = sources

    # Consistency on the CURRENT deck size (opening-hand math needs >= 7 cards).
    if total >= 7:
        deck.stats = {
            "p_2plus_lands_opening": round(
                mana_math.hypergeometric_at_least(total, actual_lands, 7, 2) * 100, 1
            ),
            "p_3plus_lands_opening": round(
                mana_math.hypergeometric_at_least(total, actual_lands, 7, 3) * 100, 1
            ),
            "avg_nonland_mv": round(sum(c.cmc for c in chosen) / len(chosen), 2) if chosen else 0.0,
        }
    else:
        deck.stats = {
            "p_2plus_lands_opening": 0.0,
            "p_3plus_lands_opening": 0.0,
            "avg_nonland_mv": round(sum(c.cmc for c in chosen) / len(chosen), 2) if chosen else 0.0,
        }

    size = fmt.deck_size
    if total < size:
        deck.warnings.append(f"{total}/{size} cards — add {size - total} more to complete the deck.")
    elif total > size:
        deck.warnings.append(f"{total} cards — {total - size} over the {size}-card limit.")

    return deck
