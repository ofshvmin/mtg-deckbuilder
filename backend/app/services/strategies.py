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


def get_strategy(name: str | None) -> Strategy:
    """Return the named strategy, falling back to Balanced for None/unknown."""
    if not name:
        return STRATEGIES["balanced"]
    return STRATEGIES.get(name.lower(), STRATEGIES["balanced"])


def list_strategies() -> list[dict[str, str]]:
    """Return all strategies as simple dicts for the API."""
    return [{"name": s.name, "description": s.description} for s in STRATEGIES.values()]
