"""Deck format definitions.

One `FormatSpec` per supported format, describing the structural rules (deck size,
copy limit, legality field) and which Commander-specific services apply.

The values are chosen so that **Commander's spec reduces the format-aware code paths
to the code that existed before them**: `max_copies=1` makes the generator's per-card
count guard equivalent to the old `used: set` membership test, and `copy_bonus=0.0`
zeroes the extra scoring term. That's the back-compat guarantee — structural, not just
defaulted request fields.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import roles

COMMANDER = "commander"
STANDARD = "standard"
LEGACY = "legacy"


@dataclass(frozen=True)
class FormatSpec:
    key: str
    label: str

    # Structure
    deck_size: int              # cards the generator fills, excluding the commander
    max_copies: int             # per-card limit (basics exempt)
    copy_bonus: float           # rising score bonus per copy already in the deck
    default_land_count: int
    land_range: tuple[int, int]  # clamp for user/LLM-supplied land counts
    max_deck_colors: int

    # Pool
    legality_field: str
    requires_commander: bool
    auto_select_colors: bool

    # Generator defaults (a strategy may override)
    default_quotas: dict[str, int]
    default_curve: dict[int, float]

    # Capability gates for Commander-only services
    supports_quality: bool      # EDHREC quality signal
    supports_combos: bool       # Commander Spellbook
    supports_brackets: bool     # WOTC 1-5 bracket
    supports_upgrades: bool     # "cards to buy" panel (EDHREC-derived)


_COMMANDER_CURVE = {0: 0.03, 1: 0.12, 2: 0.22, 3: 0.20, 4: 0.15, 5: 0.11, 6: 0.08, 7: 0.09}
# 60-card constructed wants its mass at 1-3 and almost nothing above 5.
_CONSTRUCTED_CURVE = {0: 0.01, 1: 0.15, 2: 0.25, 3: 0.22, 4: 0.18, 5: 0.12, 6: 0.05, 7: 0.02}
_CONSTRUCTED_QUOTAS = {
    roles.REMOVAL: 8,
    roles.CARD_DRAW: 5,
    roles.RAMP: 2,
    roles.BOARD_WIPE: 2,
}


FORMATS: dict[str, FormatSpec] = {
    COMMANDER: FormatSpec(
        key=COMMANDER,
        label="Commander",
        deck_size=99,
        max_copies=1,
        copy_bonus=0.0,
        default_land_count=37,
        land_range=(30, 42),
        max_deck_colors=5,
        legality_field="legal_commander",
        requires_commander=True,
        auto_select_colors=False,
        default_quotas={roles.RAMP: 10, roles.CARD_DRAW: 10, roles.REMOVAL: 8, roles.BOARD_WIPE: 3},
        default_curve=_COMMANDER_CURVE,
        supports_quality=True,
        supports_combos=True,
        supports_brackets=True,
        supports_upgrades=True,
    ),
    STANDARD: FormatSpec(
        key=STANDARD,
        label="Standard",
        deck_size=60,
        max_copies=4,
        copy_bonus=0.6,
        default_land_count=24,
        land_range=(20, 28),
        max_deck_colors=3,
        legality_field="legal_standard",
        requires_commander=False,
        auto_select_colors=True,
        default_quotas=dict(_CONSTRUCTED_QUOTAS),
        default_curve=dict(_CONSTRUCTED_CURVE),
        supports_quality=False,
        supports_combos=False,
        supports_brackets=False,
        supports_upgrades=False,
    ),
    LEGACY: FormatSpec(
        key=LEGACY,
        label="Legacy — any card you own",
        deck_size=60,
        max_copies=4,
        copy_bonus=0.6,
        default_land_count=24,
        land_range=(20, 28),
        # Kept at 3 despite the unrestricted pool. The color-selection mana penalty is
        # only calibrated for 1-3 colors, so allowing 4-5 would mean inventing penalty
        # constants with no data behind them — and an unrestricted pool otherwise tempts
        # the scorer into uncastable 5-color piles.
        max_deck_colors=3,
        legality_field="legal_legacy",
        requires_commander=False,
        auto_select_colors=True,
        default_quotas=dict(_CONSTRUCTED_QUOTAS),
        default_curve=dict(_CONSTRUCTED_CURVE),
        supports_quality=False,
        supports_combos=False,
        supports_brackets=False,
        supports_upgrades=False,
    ),
}


def get_format(key: str | None) -> FormatSpec:
    """Return the named format, falling back to Commander for None/unknown.

    The fallback is what keeps every pre-format API client working: a request with no
    `format` field resolves to exactly the behavior that shipped before this existed.
    """
    if not key:
        return FORMATS[COMMANDER]
    return FORMATS.get(key.lower(), FORMATS[COMMANDER])


def list_formats() -> list[dict[str, object]]:
    """All formats as simple dicts for the API / format picker."""
    return [
        {
            "key": spec.key,
            "label": spec.label,
            "deck_size": spec.deck_size,
            "max_copies": spec.max_copies,
            "requires_commander": spec.requires_commander,
            "max_deck_colors": spec.max_deck_colors,
        }
        for spec in FORMATS.values()
    ]
