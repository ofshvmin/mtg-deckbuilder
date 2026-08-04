"""Parse a pasted or uploaded decklist into card entries.

Collection imports (``services/importer.py``) read *inventory* exports, where
every row is a physical card you own. This module reads *decklists* — the thing
you copy out of Moxfield, Archidekt, Arena or a forum post — and turns them into
the ``{name, quantity, categories}`` entries the deck resolver already speaks.

Two shapes are handled, auto-detected:

*Text*, one card per line, with everything after the name optional::

    1x Ravos, Soultender (c16) 39 *F* [Commander{top}]
    1x Animate Dead (plst) EMA-78 [Enchantment]
    10x Plains (khm) 394 [Land]
    1 Sol Ring
    SB: 1 Pithing Needle

*CSV*, reusing the header auto-detection the collection importer already has
(``services/csv_formats.py``), so a Moxfield or Archidekt deck export drops in.

Cards the list itself marks as not-in-the-deck — a Moxfield maybeboard row
(``[Maybeboard{noDeck}]``), anything tagged ``{noDeck}``, or a sideboard section —
are separated out rather than silently folded into the 99. Lines that make no
sense as a card are reported too: an import that quietly drops three typo'd names
is worse than one that names them.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field

from . import csv_formats

# A decklist longer than this is not a decklist. Guards the parse (and the
# name-resolution query behind it) against a pasted novel.
MAX_LINES = 5000
MAX_ENTRIES = 1000
# Per-line copies. Real lists top out around 60 (a Relentless Rats brew);
# anything higher is a mis-parse or a joke, and clamping keeps one bad line
# from ballooning the resolved deck.
MAX_QUANTITY = 100

# Section headers, with or without a count: "Deck", "Sideboard (15)".
_SECTION_RE = re.compile(r"^([A-Za-z][A-Za-z /]{2,20})(?:\s*\(\s*\d+\s*\))?:?$")
# Sections whose cards are not part of the deck.
_EXCLUDED_SECTIONS = frozenset({
    "sideboard", "maybeboard", "considering", "tokens", "token",
    "wishlist", "acquire", "acquires",
})
_COMMANDER_SECTIONS = frozenset({"commander", "commanders", "command zone", "commandzone"})
# Sections that are just the main deck under different names.
_MAIN_SECTIONS = frozenset({
    "deck", "decklist", "mainboard", "main", "creature", "creatures", "land",
    "lands", "instant", "instants", "sorcery", "sorceries", "artifact",
    "artifacts", "enchantment", "enchantments", "planeswalker", "planeswalkers",
    "battle", "battles", "companion", "other", "spells",
})

# "1x ", "10 ", "1 " — three digits max so a card named "1996 World Champion"
# keeps its number instead of importing 1,996 copies of "World Champion".
_QUANTITY_RE = re.compile(r"^(\d{1,3})\s*[xX]?\s+(?=\S)")
# Trailing "[Creature]" / "[Maybeboard{noDeck}{noPrice}]".
_CATEGORY_RE = re.compile(r"\s*\[([^\]]*)\]\s*$")
# Trailing "*F*" (foil) / "*E*" (etched), as Moxfield and Archidekt write them.
_FINISH_RE = re.compile(r"\s*\*([A-Za-z])\*\s*$")
# Trailing "(c17) 39" / "(plst) EMA-78" / "(khm)". The set code excludes spaces
# so a parenthesised name suffix ("Erase (Not the Urza's Legacy One)") survives.
_PRINTING_RE = re.compile(r"\s*\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†\-]+))?\s*$")
_SIDEBOARD_PREFIX_RE = re.compile(r"^SB:\s*", re.IGNORECASE)
_COMMENT_RE = re.compile(r"^(//|#)")

# CSV columns naming a deck section, in the order we trust them.
_CSV_SECTION_COLUMNS = ("Section", "Category", "Categories", "Board", "Maybeboard")


@dataclass
class DeckEntry:
    """One decklist line, resolved against nothing yet."""

    name: str
    quantity: int = 1
    is_commander: bool = False
    edition: str | None = None
    collector_number: str | None = None
    foil: bool = False

    def as_card_entry(self) -> dict:
        """The shape the deck resolver takes."""
        return {
            "name": self.name,
            "quantity": self.quantity,
            "categories": ["Commander"] if self.is_commander else [],
        }


@dataclass
class ParsedDeckList:
    """Everything a decklist parse learned, including what it refused."""

    entries: list[DeckEntry] = field(default_factory=list)
    source_format: str = "text"
    excluded: list[DeckEntry] = field(default_factory=list)
    unparsed: list[str] = field(default_factory=list)

    @property
    def total_cards(self) -> int:
        return sum(e.quantity for e in self.entries)


def _clamp_quantity(value: int) -> int:
    return max(1, min(value, MAX_QUANTITY))


def _classify_category(category: str) -> tuple[bool, bool]:
    """``(is_commander, is_excluded)`` for a bracketed category tag.

    The tag is a name plus curly flags — ``Commander{top}``,
    ``Maybeboard{noDeck}{noPrice}``. ``{noDeck}`` is Moxfield's own marker for
    "counted, but not in the deck", so it is authoritative over the name.
    """
    flags = {f.lower() for f in re.findall(r"\{([^}]*)\}", category)}
    base = re.sub(r"\{[^}]*\}", "", category).strip().lower()
    if "nodeck" in flags:
        return (False, True)
    if base in _COMMANDER_SECTIONS:
        return (True, False)
    if base in _EXCLUDED_SECTIONS:
        return (False, True)
    return (False, False)


def _parse_line(line: str) -> tuple[DeckEntry | None, bool, bool]:
    """Parse one card line into ``(entry, category_commander, category_excluded)``.

    Returns ``(None, …)`` when the line holds no usable card name. Section state
    is the caller's job — this only reports what the line itself claims.
    """
    rest = line.strip()
    forced_exclude = False
    if _SIDEBOARD_PREFIX_RE.match(rest):
        rest = _SIDEBOARD_PREFIX_RE.sub("", rest, count=1)
        forced_exclude = True

    quantity = 1
    m = _QUANTITY_RE.match(rest)
    if m:
        quantity = _clamp_quantity(int(m.group(1)))
        rest = rest[m.end():]

    is_commander = False
    excluded = forced_exclude
    m = _CATEGORY_RE.search(rest)
    if m:
        rest = rest[: m.start()]
        cat_commander, cat_excluded = _classify_category(m.group(1))
        is_commander = is_commander or cat_commander
        excluded = excluded or cat_excluded

    foil = False
    m = _FINISH_RE.search(rest)
    if m:
        # F = foil, E = etched; both are non-plain finishes as far as we model it.
        foil = m.group(1).upper() in ("F", "E")
        rest = rest[: m.start()]

    edition = collector_number = None
    m = _PRINTING_RE.search(rest)
    if m:
        edition = m.group(1).lower()
        collector_number = m.group(2)
        rest = rest[: m.start()]

    name = rest.strip().strip(",").strip()
    if not name:
        return (None, False, False)
    return (
        DeckEntry(
            name=name,
            quantity=quantity,
            is_commander=is_commander,
            edition=edition,
            collector_number=collector_number,
            foil=foil,
        ),
        is_commander,
        excluded,
    )


def parse_text(text: str) -> ParsedDeckList:
    """Parse a plain-text decklist, honouring section headers and category tags."""
    result = ParsedDeckList(source_format="text")
    section_commander = False
    section_excluded = False

    for raw in text.splitlines()[:MAX_LINES]:
        line = raw.strip()
        if not line or _COMMENT_RE.match(line):
            continue

        # A bare word line is a section header, not a one-copy card — but only
        # when it names a section we know, so "Sol Ring" on its own still imports.
        m = _SECTION_RE.match(line)
        if m:
            label = m.group(1).strip().lower()
            if label in _COMMANDER_SECTIONS:
                section_commander, section_excluded = True, False
                continue
            if label in _EXCLUDED_SECTIONS:
                section_commander, section_excluded = False, True
                continue
            if label in _MAIN_SECTIONS:
                section_commander, section_excluded = False, False
                continue

        entry, line_commander, line_excluded = _parse_line(line)
        if entry is None:
            result.unparsed.append(line)
            continue
        entry.is_commander = line_commander or (section_commander and not line_excluded)
        if line_excluded or section_excluded:
            result.excluded.append(entry)
        elif len(result.entries) < MAX_ENTRIES:
            result.entries.append(entry)

    return result


def _csv_section(row: dict[str, str]) -> str:
    """The section a CSV row claims, lowercased ("" when the export has none)."""
    for col in _CSV_SECTION_COLUMNS:
        for key, value in row.items():
            if key and key.strip().lower() == col.lower() and str(value or "").strip():
                return str(value).strip().lower()
    return ""


def parse_csv(text: str) -> ParsedDeckList | None:
    """Parse a deck export in one of the known collection CSV shapes.

    Returns ``None`` when the headers match no known format, so the caller can
    fall back to the text parser — a two-column ad-hoc CSV is still readable as
    "quantity, name" text.
    """
    try:
        headers, rows = csv_formats.parse_csv(text)
    except (csv.Error, UnicodeDecodeError):
        return None
    fmt = csv_formats.detect_format(headers)
    if fmt is None:
        return None

    result = ParsedDeckList(source_format=fmt.name)
    for row in rows[:MAX_LINES]:
        canonical = csv_formats.normalize_row(row, fmt)
        name = (canonical.get("name") or "").strip()
        if not name:
            continue
        try:
            quantity = _clamp_quantity(int(canonical.get("count") or 1))
        except (TypeError, ValueError):
            quantity = 1
        section = _csv_section(row)
        is_commander = section in _COMMANDER_SECTIONS
        excluded = section in _EXCLUDED_SECTIONS
        entry = DeckEntry(
            name=name,
            quantity=quantity,
            is_commander=is_commander,
            edition=(canonical.get("edition") or "").strip().lower() or None,
            collector_number=(canonical.get("collector_number") or "").strip() or None,
            foil=bool((canonical.get("foil") or "").strip()),
        )
        if excluded:
            result.excluded.append(entry)
        elif len(result.entries) < MAX_ENTRIES:
            result.entries.append(entry)

    return result


def parse(text: str) -> ParsedDeckList:
    """Parse a decklist in whichever supported shape it turns out to be.

    CSV is tried first because a Moxfield deck CSV would otherwise parse as text
    — badly, one comma-jammed "card name" per row.
    """
    parsed = parse_csv(text)
    if parsed is not None and parsed.entries:
        return parsed
    return parse_text(text)
