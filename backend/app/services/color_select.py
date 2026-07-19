"""Pick a constructed deck's colors from the owned card pool.

Commander gets its colors for free — the commander's identity fixes them. Formats
without a commander need this: given everything the user owns that's legal in the
format, decide which 1-3 colors make the best 60-card deck.

**It answers that by building the deck.** For each candidate color combination we run
the real generator and score the resulting 60 cards. An earlier version scored the
*pool* instead — how many playables, whether role quotas could be met — and it failed
on a real collection: with 800+ available slots per color against a 36-slot need,
every component saturated at 1.0 and all five colors tied, so the pick fell through to
alphabetical order. Pool sufficiency stops discriminating once a collection is deep.

Scoring the built deck also removes a subtler problem: any separate pool heuristic can
disagree with what the generator actually does. Here the scorer and the builder are the
same code, so they agree by construction.

Cost is ~2s for a full 25-combination sweep, which is why it runs only on auto-pick
(once, when the format is chosen). Explicit color choices skip scoring entirely.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

from . import generator as generator_service
from ..util import card_castable_in
from .formats import FormatSpec
from .strategies import Strategy

COLOR_ORDER = ["W", "U", "B", "R", "G"]

# Component weights over the *generated* deck.
W_COMPLETE = 0.30    # did the pool actually fill the deck
W_ROLE = 0.25        # are the strategy's role quotas met
W_CURVE = 0.25       # does the curve match the strategy's target shape
W_PLAYSET = 0.20     # how much of the deck is 3-ofs and 4-ofs

# Multicolor costs consistency; owned fixing in the built deck buys it back.
BASE_PENALTY = {1: 0.00, 2: 0.06, 3: 0.14}
FIXING_NEEDED = {1: 0, 2: 8, 3: 12}

TIE_EPSILON = 0.02


@dataclass
class ColorChoice:
    colors: list[str]
    score: float
    components: dict[str, float] = field(default_factory=dict)
    # (colors, score) for the next-best combinations, best first.
    alternates: list[tuple[list[str], float]] = field(default_factory=list)
    short_pool: bool = False


def _is_land(doc: dict) -> bool:
    return "land" in (doc.get("type_line") or "").lower()


def _castable_in(doc: dict, allowed: set[str]) -> bool:
    """Can this card go in a deck of exactly `allowed` colors?

    Delegates to `util.card_castable_in`, which reads the mana *cost* rather than
    the card's `colors` field — see the note there on why those differ.
    """
    return card_castable_in(doc, allowed)


def _score_deck(deck, spec: FormatSpec, strategy: Strategy, combo: set[str]) -> tuple[float, dict]:
    """Score a generated deck. Every term is measured on cards actually selected."""
    total = sum(c.count for c in deck.cards)
    completeness = min(1.0, total / spec.deck_size) if spec.deck_size else 0.0

    # Role quotas, measured against what the deck actually contains.
    quotas = {r: q for r, q in strategy.quotas.items() if q > 0}
    if quotas:
        role_fill = sum(
            min(1.0, deck.role_counts.get(role, 0) / quota) for role, quota in quotas.items()
        ) / len(quotas)
    else:
        role_fill = 1.0

    # Curve fit as 1 - total variation distance from the strategy's target shape.
    nonland_total = sum(c.count for c in deck.cards if c.slot != "land") or 1
    actual = {entry["cmc"]: entry["count"] / nonland_total for entry in deck.curve}
    divergence = sum(
        abs(actual.get(bucket, 0.0) - weight)
        for bucket, weight in strategy.curve_weights.items()
    )
    curve_fit = max(0.0, 1.0 - divergence / 2.0)

    # Redundancy, measured on the built deck rather than the pool: what fraction of
    # nonland slots come from cards run in 3+ copies.
    nonlands = [c for c in deck.cards if c.slot != "land"]
    deep_slots = sum(c.count for c in nonlands if c.count >= 3)
    playset_ratio = deep_slots / nonland_total if spec.max_copies > 1 else 1.0

    # Fixing measured on the deck's actual manabase.
    fixing = sum(
        c.count
        for c in deck.cards
        if c.slot == "land" and not c.oracle_id.startswith("basic:")
    )
    size = len(combo)
    penalty = BASE_PENALTY.get(size, 0.20)
    need_fix = FIXING_NEEDED.get(size, 0)
    if need_fix:
        penalty *= max(0.0, 1.0 - fixing / need_fix)

    score = (
        W_COMPLETE * completeness
        + W_ROLE * role_fill
        + W_CURVE * curve_fit
        + W_PLAYSET * playset_ratio
        - penalty
    )
    components = {
        "completeness": round(completeness, 4),
        "role_fill": round(role_fill, 4),
        "curve_fit": round(curve_fit, 4),
        "playset_ratio": round(playset_ratio, 4),
        "mana_penalty": round(penalty, 4),
        "deck_total": total,
        "fixing_lands": fixing,
    }
    return score, components


def _build(
    pool: list[dict],
    combo: set[str],
    spec: FormatSpec,
    strategy: Strategy,
    basics_by_color: dict[str, dict],
    theme_matches: set[str] | None,
):
    colors = [c for c in COLOR_ORDER if c in combo]
    subset = [doc for doc in pool if _castable_in(doc, combo)]
    deck = generator_service.generate(
        None,
        subset,
        colors,
        basics_by_color,
        spec=spec,
        strategy=strategy,
        theme_matches=theme_matches,
    )
    return deck, subset


def select_colors(
    pool: list[dict],
    spec: FormatSpec,
    strategy: Strategy,
    basics_by_color: dict[str, dict] | None = None,
    theme_matches: set[str] | None = None,
    locked_colors: list[str] | None = None,
    auto_fill: bool = True,
) -> ColorChoice:
    """Choose the deck's colors.

    Three behaviors, one code path — zero-input auto is just the empty-lock case:

    | locked_colors | auto_fill | behavior                                    |
    |---------------|-----------|---------------------------------------------|
    | none          | True      | build every combination, pick the best       |
    | {R}           | True      | build combinations containing R              |
    | {R,G}         | False     | use exactly R/G, no search                   |
    """
    basics_by_color = basics_by_color or {}
    locked = [c for c in COLOR_ORDER if c in set(locked_colors or [])]

    # Explicit colors: the user has decided. Build once so the rationale panel still
    # has real numbers, but don't search.
    if locked and not auto_fill:
        deck, _ = _build(pool, set(locked), spec, strategy, basics_by_color, theme_matches)
        score, components = _score_deck(deck, spec, strategy, set(locked))
        return ColorChoice(
            colors=locked,
            score=round(score, 4),
            components=components,
            short_pool=components["deck_total"] < spec.deck_size,
        )

    locked_set = set(locked)
    scored: list[tuple[float, list[str], dict]] = []
    for size in range(1, spec.max_deck_colors + 1):
        for combo in combinations(COLOR_ORDER, size):
            combo_set = set(combo)
            if not locked_set <= combo_set:
                continue
            deck, _ = _build(pool, combo_set, spec, strategy, basics_by_color, theme_matches)
            score, components = _score_deck(deck, spec, strategy, combo_set)
            scored.append((score, list(combo), components))

    if not scored:
        return ColorChoice(colors=locked or ["C"], score=0.0, short_pool=True)

    scored.sort(key=lambda t: (-t[0], len(t[1])))
    best_score, best_colors, best_components = scored[0]

    # Among near-ties, prefer the simpler mana base.
    for score, colors, components in scored[1:]:
        if best_score - score > TIE_EPSILON:
            break
        if len(colors) < len(best_colors):
            best_score, best_colors, best_components = score, colors, components

    alternates = [
        (colors, round(score, 4)) for score, colors, _ in scored if colors != best_colors
    ][:4]

    return ColorChoice(
        colors=best_colors,
        score=round(best_score, 4),
        components=best_components,
        alternates=alternates,
        short_pool=best_components["deck_total"] < spec.deck_size,
    )
