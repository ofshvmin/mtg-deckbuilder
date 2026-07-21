"""Named deck-building strategy presets.

Each strategy tunes the generator's structural levers — role quotas, land count,
curve shape, and optional scoring bonuses — to steer the deck toward a playstyle
(aggro, control, combo, etc.) without restricting card selection.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from . import roles


@dataclass
class Strategy:
    name: str
    description: str
    quotas: dict[str, int]
    land_count: int
    curve_weights: dict[int, float]
    combo_weight_override: float | None = None
    # Extra scoring functions applied per-card: (card_doc, role_set) -> bonus
    extra_scorers: list[Callable] = field(default_factory=list)


def _creature_bonus(doc: dict, rset: set[str]) -> float:
    return 0.5 if roles.CREATURE in rset else 0.0


def _counterspell_protection_bonus(doc: dict, rset: set[str]) -> float:
    return 0.5 if (roles.COUNTERSPELL in rset or roles.PROTECTION in rset) else 0.0


def _tutor_bonus(doc: dict, rset: set[str]) -> float:
    return 1.0 if roles.TUTOR in rset else 0.0


def _noncreature_spell_bonus(doc: dict, rset: set[str]) -> float:
    type_line = (doc.get("type_line") or "").lower()
    if "instant" in type_line or "sorcery" in type_line:
        return 0.3
    return 0.0


def _high_cmc_bonus(doc: dict, rset: set[str]) -> float:
    cmc = doc.get("cmc") or 0
    if cmc >= 5:
        return 0.5
    return 0.0


STRATEGIES: dict[str, Strategy] = {
    "balanced": Strategy(
        name="Balanced",
        description="Well-rounded: a bit of everything.",
        quotas={roles.RAMP: 10, roles.CARD_DRAW: 10, roles.REMOVAL: 8, roles.BOARD_WIPE: 3},
        land_count=37,
        curve_weights={0: 0.03, 1: 0.12, 2: 0.22, 3: 0.20, 4: 0.15, 5: 0.11, 6: 0.08, 7: 0.09},
    ),
    "aggro": Strategy(
        name="Aggro",
        description="Fast creatures, low curve, get in early.",
        quotas={roles.RAMP: 8, roles.CARD_DRAW: 8, roles.REMOVAL: 6, roles.BOARD_WIPE: 2},
        land_count=34,
        curve_weights={0: 0.05, 1: 0.18, 2: 0.25, 3: 0.20, 4: 0.14, 5: 0.08, 6: 0.05, 7: 0.05},
        extra_scorers=[_creature_bonus],
    ),
    "control": Strategy(
        name="Control",
        description="Answers, card advantage, grind them out.",
        quotas={roles.RAMP: 10, roles.CARD_DRAW: 12, roles.REMOVAL: 10, roles.BOARD_WIPE: 4},
        land_count=38,
        curve_weights={0: 0.02, 1: 0.08, 2: 0.16, 3: 0.22, 4: 0.20, 5: 0.14, 6: 0.10, 7: 0.08},
        extra_scorers=[_counterspell_protection_bonus],
    ),
    "combo": Strategy(
        name="Combo",
        description="Assemble win conditions, tutor for pieces.",
        quotas={roles.RAMP: 12, roles.CARD_DRAW: 12, roles.REMOVAL: 6, roles.BOARD_WIPE: 2},
        land_count=36,
        curve_weights={0: 0.04, 1: 0.12, 2: 0.18, 3: 0.18, 4: 0.16, 5: 0.13, 6: 0.10, 7: 0.09},
        combo_weight_override=3.0,
        extra_scorers=[_tutor_bonus],
    ),
    "ramp": Strategy(
        name="Ramp",
        description="Big mana, big payoffs.",
        quotas={roles.RAMP: 14, roles.CARD_DRAW: 10, roles.REMOVAL: 7, roles.BOARD_WIPE: 3},
        land_count=39,
        curve_weights={0: 0.02, 1: 0.08, 2: 0.14, 3: 0.16, 4: 0.16, 5: 0.16, 6: 0.14, 7: 0.14},
        extra_scorers=[_high_cmc_bonus],
    ),
    "spellslinger": Strategy(
        name="Spellslinger",
        description="Instants and sorceries matter.",
        quotas={roles.RAMP: 10, roles.CARD_DRAW: 12, roles.REMOVAL: 8, roles.BOARD_WIPE: 2},
        land_count=36,
        curve_weights={0: 0.04, 1: 0.14, 2: 0.24, 3: 0.22, 4: 0.16, 5: 0.10, 6: 0.06, 7: 0.04},
        extra_scorers=[_noncreature_spell_bonus],
    ),
}


# 60-card constructed presets (Standard, Legacy). Same dataclass, same scorer
# functions — only the numbers differ, since the EDH values above assume a 99-card
# singleton deck. Curves are steeper and land counts far lower.
CONSTRUCTED_STRATEGIES: dict[str, Strategy] = {
    "midrange": Strategy(
        name="Midrange",
        description="Efficient threats and answers; the default shape.",
        quotas={roles.RAMP: 2, roles.CARD_DRAW: 5, roles.REMOVAL: 8, roles.BOARD_WIPE: 2},
        land_count=24,
        curve_weights={0: 0.01, 1: 0.15, 2: 0.25, 3: 0.22, 4: 0.18, 5: 0.12, 6: 0.05, 7: 0.02},
    ),
    "aggro": Strategy(
        name="Aggro",
        description="Fast creatures, low curve, get in early.",
        quotas={roles.RAMP: 0, roles.CARD_DRAW: 3, roles.REMOVAL: 6, roles.BOARD_WIPE: 0},
        land_count=22,
        curve_weights={0: 0.02, 1: 0.26, 2: 0.30, 3: 0.22, 4: 0.12, 5: 0.05, 6: 0.02, 7: 0.01},
        extra_scorers=[_creature_bonus],
    ),
    "control": Strategy(
        name="Control",
        description="Answers, card advantage, grind them out.",
        quotas={roles.RAMP: 2, roles.CARD_DRAW: 8, roles.REMOVAL: 10, roles.BOARD_WIPE: 4},
        land_count=26,
        curve_weights={0: 0.01, 1: 0.10, 2: 0.20, 3: 0.22, 4: 0.20, 5: 0.15, 6: 0.08, 7: 0.04},
        extra_scorers=[_counterspell_protection_bonus],
    ),
    "ramp": Strategy(
        name="Ramp",
        description="Big mana, big payoffs.",
        quotas={roles.RAMP: 8, roles.CARD_DRAW: 5, roles.REMOVAL: 6, roles.BOARD_WIPE: 2},
        land_count=25,
        curve_weights={0: 0.01, 1: 0.10, 2: 0.22, 3: 0.18, 4: 0.16, 5: 0.15, 6: 0.11, 7: 0.07},
        extra_scorers=[_high_cmc_bonus],
    ),
}


def _table_for(spec=None) -> tuple[dict[str, Strategy], str]:
    """(strategy table, default key) for a format spec. None => Commander."""
    if spec is None or spec.key == "commander":
        return STRATEGIES, "balanced"
    return CONSTRUCTED_STRATEGIES, "midrange"


def get_strategy(name: str | None, spec=None) -> Strategy:
    """Return the named strategy for this format, falling back to the format's default.

    `spec` defaults to None (Commander), so existing callers are unaffected.
    """
    table, default = _table_for(spec)
    if not name:
        return table[default]
    return table.get(name.lower(), table[default])


def list_strategies(spec=None) -> list[dict[str, str]]:
    """Return this format's strategies as simple dicts for the API."""
    table, _ = _table_for(spec)
    return [{"name": s.name, "description": s.description} for s in table.values()]
