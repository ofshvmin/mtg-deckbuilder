"""Rule-based card role tagger (Phase 3).

Classifies a card into functional Commander roles from its type line, oracle
text, and mana production. A card can carry several roles (a creature that also
draws cards gets both). Pure and deterministic — easy to test and to reason
about. This is intentionally heuristic; it will be refined, but it gives the
deck generator the role signal it needs.
"""
from __future__ import annotations

import re

# Role tags
LAND = "land"
RAMP = "ramp"
CARD_DRAW = "card_draw"
REMOVAL = "removal"
BOARD_WIPE = "board_wipe"
COUNTERSPELL = "counterspell"
PROTECTION = "protection"
TUTOR = "tutor"
CREATURE = "creature"

# Human-readable labels for UI / reasoning.
ROLE_LABELS = {
    LAND: "Land",
    RAMP: "Ramp",
    CARD_DRAW: "Card draw",
    REMOVAL: "Removal",
    BOARD_WIPE: "Board wipe",
    COUNTERSPELL: "Counterspell",
    PROTECTION: "Protection",
    TUTOR: "Tutor",
    CREATURE: "Creature",
}

_SEARCH_LAND_RE = re.compile(
    r"search your library for .{0,40}?land.{0,60}?(onto the battlefield|put)"
)
_SEARCH_ANY_RE = re.compile(r"search your library for (a|an|up to|any|one|two|\d)")
_DRAW_RE = re.compile(r"draw (a|one|two|three|four|five|\w+|x) cards?")
_DMG_TARGET_RE = re.compile(r"deals? \d+ damage to (target|any target)")
_BOUNCE_RE = re.compile(r"return target .* to (its|their) owner'?s hand")
_SHRINK_RE = re.compile(r"target creature gets [+-]?\d*/-[1-9]")
# Board wipe = damage to each *creature* (not "each opponent/player", which is a pinger).
_DMG_EACH_RE = re.compile(r"deals? \d+ damage to each creature")


def _produces_mana(card: dict) -> bool:
    return bool(card.get("produced_mana")) or "add {" in card.get("oracle_text", "").lower()


def tag_roles(card: dict) -> set[str]:
    """Return the set of role tags that apply to a card."""
    type_line = (card.get("type_line") or "").lower()
    text = (card.get("oracle_text") or "").lower()
    roles: set[str] = set()

    is_land = "land" in type_line
    if is_land:
        roles.add(LAND)
    if "creature" in type_line:
        roles.add(CREATURE)

    # Ramp: mana rocks/dorks, land ramp, treasure making. (Lands themselves are
    # tracked separately as the mana base, so don't double-count them as ramp.)
    if not is_land:
        if (
            _produces_mana(card)
            or _SEARCH_LAND_RE.search(text)
            or ("create" in text and "treasure" in text)
            or "additional land" in text
        ):
            roles.add(RAMP)

    # Card advantage
    if _DRAW_RE.search(text) or "investigate" in text or "create a clue" in text:
        roles.add(CARD_DRAW)

    # Board wipes (checked before targeted removal so "destroy all" isn't removal)
    is_wipe = (
        "destroy all" in text
        or "exile all" in text
        or "destroy each" in text
        or "all creatures get -" in text
        or bool(_DMG_EACH_RE.search(text))
        or "each player sacrifices" in text
        or "return all" in text            # mass bounce (Evacuation)
        or "return each" in text            # mass bounce (Cyclonic Rift overload)
    )
    if is_wipe:
        roles.add(BOARD_WIPE)

    # Targeted removal
    if (
        "destroy target" in text
        or "exile target" in text
        or _DMG_TARGET_RE.search(text)
        or _BOUNCE_RE.search(text)
        or _SHRINK_RE.search(text)
        or "fights" in text
        or "fight target" in text
    ):
        roles.add(REMOVAL)

    # Counterspells
    if "counter target" in text:
        roles.add(COUNTERSPELL)

    # Protection / interaction that shields your board
    if any(
        k in text
        for k in ("hexproof", "indestructible", "protection from", "prevent all", "phase out")
    ):
        roles.add(PROTECTION)

    # Tutors (a library search that isn't just land ramp)
    if _SEARCH_ANY_RE.search(text) and not _SEARCH_LAND_RE.search(text):
        roles.add(TUTOR)

    return roles
