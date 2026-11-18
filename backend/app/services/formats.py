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
PIONEER = "pioneer"
MODERN = "modern"
PAUPER = "pauper"

# Families group formats the way the build screen does: a family decides whether
# there's a commander search, who picks colors, and which Commander-only services
# apply. The picker asks for the family first, then the format within it.
FAMILY_COMMANDER = "commander"
FAMILY_CONSTRUCTED = "constructed"


@dataclass(frozen=True)
class FormatSpec:
    key: str
    label: str
    family: str
    description: str            # one line under the picker

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

    # Weight on the card-rank signal (Scryfall's edhrec_rank, as `rank_score`).
    # Zero for Commander, which already ranks cards by EDHREC data for its
    # commander — so Commander output is untouched by card rank.
    rank_weight: float = 0.0

    # Listed by the original `/formats` endpoint. Shipped apps (iOS 2.0) draw that
    # list as one row of equal segments, which holds four at most; newer clients
    # read the full `/formats/catalog` instead.
    in_v1_list: bool = False


_COMMANDER_CURVE = {0: 0.03, 1: 0.12, 2: 0.22, 3: 0.20, 4: 0.15, 5: 0.11, 6: 0.08, 7: 0.09}
# 60-card constructed wants its mass at 1-3 and almost nothing above 5.
_CONSTRUCTED_CURVE = {0: 0.01, 1: 0.15, 2: 0.25, 3: 0.22, 4: 0.18, 5: 0.12, 6: 0.05, 7: 0.02}
# Card rank's pull in 60-card formats: enough to choose the staple between two
# cards that fill the same role, not enough to override role or curve need
# (+3.0 / +1.5). Tuned on a real collection: at 2.0 the Commander bias in
# edhrec_rank (mana rocks, big top-end) took over Standard and Modern builds; at
# 1.0 the median nonland card still went from rank ~12,000 to ~340.
_CONSTRUCTED_RANK_WEIGHT = 1.0

_CONSTRUCTED_QUOTAS = {
    roles.REMOVAL: 8,
    roles.CARD_DRAW: 5,
    roles.RAMP: 2,
    roles.BOARD_WIPE: 2,
}


def _constructed(
    key: str, label: str, description: str, *, legality_field: str, in_v1_list: bool = False
) -> FormatSpec:
    """A 60-card, 4-copy format: the Standard shape with its own card pool.

    `legality_field` may be a dotted path into the stored `legalities` map
    (`legalities.modern`). The sync already keeps that map in full, so a new format
    needs no denormalized field, index or backfill — the pool query narrows by
    owned `_id` first, and the legality test runs over that handful.
    """
    return FormatSpec(
        key=key,
        label=label,
        family=FAMILY_CONSTRUCTED,
        description=description,
        deck_size=60,
        max_copies=4,
        copy_bonus=0.6,
        default_land_count=24,
        land_range=(20, 28),
        max_deck_colors=3,
        legality_field=legality_field,
        requires_commander=False,
        auto_select_colors=True,
        default_quotas=dict(_CONSTRUCTED_QUOTAS),
        default_curve=dict(_CONSTRUCTED_CURVE),
        supports_quality=False,
        supports_combos=True,
        supports_brackets=False,
        supports_upgrades=False,
        rank_weight=_CONSTRUCTED_RANK_WEIGHT,
        in_v1_list=in_v1_list,
    )


FORMATS: dict[str, FormatSpec] = {
    COMMANDER: FormatSpec(
        key=COMMANDER,
        label="Commander",
        family=FAMILY_COMMANDER,
        description="A legendary commander and 99 singletons",
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
        in_v1_list=True,
    ),
    STANDARD: FormatSpec(
        key=STANDARD,
        label="Standard",
        family=FAMILY_CONSTRUCTED,
        description="Cards from the current rotation",
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
        supports_combos=True,
        supports_brackets=False,
        supports_upgrades=False,
        rank_weight=_CONSTRUCTED_RANK_WEIGHT,
        in_v1_list=True,
    ),
    LEGACY: FormatSpec(
        key=LEGACY,
        label="Legacy — any card you own",
        family=FAMILY_CONSTRUCTED,
        description="Nearly every card ever printed",
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
        supports_combos=True,
        supports_brackets=False,
        supports_upgrades=False,
        rank_weight=_CONSTRUCTED_RANK_WEIGHT,
        in_v1_list=True,
    ),
    PIONEER: _constructed(
        PIONEER, "Pioneer", "Cards from Return to Theros onward",
        legality_field="legalities.pioneer",
    ),
    MODERN: _constructed(
        MODERN, "Modern", "Cards from Eighth Edition onward",
        legality_field="legalities.modern",
    ),
    PAUPER: _constructed(
        PAUPER, "Pauper", "Only cards printed at common",
        legality_field="legalities.pauper",
        in_v1_list=True,
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
    """The original format list, frozen to what a one-row picker can hold."""
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
        if spec.in_v1_list
    ]


# Planned formats the catalog shows as "soon", so the picker's shape is settled
# before they're buildable. Not in FORMATS: get_format() must never resolve them.
_COMING_SOON = [
    {
        "key": "paupercommander",
        "label": "Pauper Commander",
        "family": FAMILY_COMMANDER,
        "description": "An uncommon commander and 99 commons",
    },
]


# Picker order within a family. The 60-card formats run from the smallest card
# pool to the largest, with Pauper (its own axis: rarity, not era) last.
_CATALOG_ORDER = [COMMANDER, "paupercommander", STANDARD, PIONEER, MODERN, LEGACY, PAUPER]


def list_catalog() -> list[dict[str, object]]:
    """Every format, grouped by family, for the two-step picker."""
    entries: list[dict[str, object]] = [
        {
            "key": spec.key,
            "label": spec.label.split(" — ")[0],
            "family": spec.family,
            "description": spec.description,
            "deck_size": spec.deck_size,
            "max_copies": spec.max_copies,
            "requires_commander": spec.requires_commander,
            "max_deck_colors": spec.max_deck_colors,
            "available": True,
        }
        for spec in FORMATS.values()
    ]
    for soon in _COMING_SOON:
        entries.append({**soon, "available": False})
    entries.sort(key=lambda e: _CATALOG_ORDER.index(str(e["key"])))
    return entries
