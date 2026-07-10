"""Theme matching for deck generation.

A theme string (e.g. "cats", "landfall", "sacrifice") lets users steer the
auto-generator toward a flavor. Two match types:

1. **Mechanical** — curated keyword/oracle_text pattern matches.
2. **Tribal** — any string not in the mechanical list is treated as a creature
   subtype. Matches cards with that subtype in type_line, "changeling" keyword,
   or references to the type in oracle_text.
"""
from __future__ import annotations

import re


# Mechanical themes: name -> list of match configs.
# Each config is a dict with optional keys:
#   keyword: str — match if keyword appears in card's keywords list
#   oracle_re: str — match if regex matches oracle_text (case-insensitive)
MECHANICAL_THEMES: dict[str, list[dict]] = {
    "landfall": [
        {"keyword": "landfall"},
        {"oracle_re": r"whenever a land enters"},
    ],
    "tokens": [
        {"oracle_re": r"create\b.*\btokens?"},
    ],
    "sacrifice": [
        {"oracle_re": r"sacrifice a "},
        {"oracle_re": r"whenever .{0,40}dies"},
        {"oracle_re": r"when .{0,30} dies"},
    ],
    "aristocrats": [
        {"oracle_re": r"sacrifice a "},
        {"oracle_re": r"whenever .{0,40}dies"},
        {"oracle_re": r"when .{0,30} dies"},
    ],
    "voltron": [
        {"oracle_re": r"equipped creature"},
        {"oracle_re": r"enchanted creature"},
        {"oracle_re": r"attach(ed)? to"},
    ],
    "reanimator": [
        {"oracle_re": r"return .{0,40}from .{0,20}graveyard"},
        {"oracle_re": r"mill "},
        {"oracle_re": r"put .{0,30}from .{0,20}graveyard .{0,30}battlefield"},
    ],
    "blink": [
        {"oracle_re": r"exile .{0,40}return .{0,40}(battlefield|to the battlefield)"},
        {"oracle_re": r"flicker"},
    ],
    "flicker": [
        {"oracle_re": r"exile .{0,40}return .{0,40}(battlefield|to the battlefield)"},
        {"oracle_re": r"flicker"},
    ],
    "counters": [
        {"oracle_re": r"\+1/\+1 counter"},
        {"keyword": "proliferate"},
        {"oracle_re": r"proliferate"},
    ],
}


def parse_subtypes(type_line: str) -> list[str]:
    """Extract creature subtypes from a type_line like 'Creature — Cat Warrior'."""
    if " — " not in type_line and " - " not in type_line:
        return []
    # Handle both em-dash and regular dash
    sep = " — " if " — " in type_line else " - "
    right = type_line.split(sep, 1)[1]
    return [s.strip() for s in right.split() if s.strip()]


class ThemeMatcher:
    """Determines whether a card matches a theme string."""

    def __init__(self, theme: str):
        self.theme = theme.strip().lower()
        self.is_mechanical = self.theme in MECHANICAL_THEMES
        if self.is_mechanical:
            self._configs = MECHANICAL_THEMES[self.theme]
            self._compiled = [
                re.compile(c["oracle_re"], re.IGNORECASE)
                for c in self._configs
                if "oracle_re" in c
            ]
        else:
            # Tribal: match creature subtype
            self._subtype = self.theme

    def matches(self, card_doc: dict) -> bool:
        if self.is_mechanical:
            return self._matches_mechanical(card_doc)
        return self._matches_tribal(card_doc)

    def _matches_mechanical(self, card_doc: dict) -> bool:
        text = (card_doc.get("oracle_text") or "").lower()
        keywords = [k.lower() for k in (card_doc.get("keywords") or [])]

        for config in self._configs:
            if "keyword" in config and config["keyword"].lower() in keywords:
                return True
        for rx in self._compiled:
            if rx.search(text):
                return True
        return False

    def _matches_tribal(self, card_doc: dict) -> bool:
        # Check if card has changeling
        keywords = [k.lower() for k in (card_doc.get("keywords") or [])]
        if "changeling" in keywords:
            return True

        # Check subtypes in type_line
        type_line = card_doc.get("type_line") or ""
        subtypes = [s.lower() for s in parse_subtypes(type_line)]
        if self._subtype in subtypes:
            return True

        # Check oracle_text for references (e.g. enchantment that says "Cat")
        text = (card_doc.get("oracle_text") or "").lower()
        if self._subtype in text:
            return True

        return False


def compute_theme_matches(pool: list[dict], theme: str | None) -> set[str] | None:
    """Return oracle_ids of pool cards that match the theme, or None if no theme."""
    if not theme or not theme.strip():
        return None
    matcher = ThemeMatcher(theme)
    return {doc["_id"] for doc in pool if matcher.matches(doc)}
