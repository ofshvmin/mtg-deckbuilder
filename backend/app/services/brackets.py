"""Estimate a deck's WOTC Commander Bracket (1-5) from its card content.

Brackets: 1 Exhibition, 2 Core, 3 Upgraded, 4 Optimized, 5 cEDH. We estimate
2-4 from signals we can read off the cards — the official Game Changers list,
two-card infinite combos, mass land denial, extra turns, tutor density — and
flag that 1 (intent) and 5 (metagame) can't be read from content alone.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from pymongo.asynchronous.database import AsyncDatabase

from ..util import normalize_name
from . import roles

_DATA = Path(__file__).resolve().parent.parent / "data" / "game_changers.json"

BRACKET_LABELS = {1: "Exhibition", 2: "Core", 3: "Upgraded", 4: "Optimized", 5: "cEDH"}
EARLY_COMBO_MV = 5   # combined MV at/under which a 2-card combo counts as "early"
TUTOR_HEAVY = 4      # tutor count that nudges a deck up a bracket

# Conservative patterns — a false positive wrongly inflates the bracket.
_MLD_RE = re.compile(r"destroy all [^.\n]*lands|sacrifices? all[^.\n]*lands", re.I)
_EXTRA_TURN_RE = re.compile(r"take an extra turn|extra turn after this one", re.I)

_GC_IDS_CACHE: set[str] | None = None


@dataclass
class BracketSignal:
    key: str
    label: str
    count: int
    cards: list[str]


@dataclass
class BracketResult:
    bracket: int
    label: str
    explanation: str
    signals: list[BracketSignal]
    caveat: str | None


def _game_changer_names() -> list[str]:
    return json.loads(_DATA.read_text()).get("cards", [])


async def game_changer_ids(db: AsyncDatabase) -> set[str]:
    """Resolve the Game Changers list to oracle_ids in our card DB (cached).

    Matches by normalized name, also trying the front face of DFC/split names.
    """
    global _GC_IDS_CACHE
    if _GC_IDS_CACHE is not None:
        return _GC_IDS_CACHE
    norms: set[str] = set()
    for name in _game_changer_names():
        norms.add(normalize_name(name))
        front = name.split("//")[0].strip()
        if front != name:
            norms.add(normalize_name(front))
    ids: set[str] = set()
    cursor = db.cards.find({"name_normalized": {"$in": list(norms)}}, {"_id": 1})
    async for doc in cursor:
        ids.add(doc["_id"])
    _GC_IDS_CACHE = ids
    return ids


def estimate(
    deck_docs: list[dict],
    deck_combos: list[dict],
    gc_ids: set[str],
) -> BracketResult:
    """Estimate the bracket from full deck card docs + detected combos.

    ``deck_docs`` are full card documents (need oracle_text/cmc); ``deck_combos``
    are the Spellbook combos fully present in the deck.
    """
    by_id = {d["_id"]: d for d in deck_docs}

    gc_names = sorted(d.get("name", "") for d in deck_docs if d["_id"] in gc_ids)

    infinite: list[str] = []
    early_infinite = False
    for combo in deck_combos:
        ids = combo.get("cards", [])
        if len(ids) != 2:
            continue
        if not any("infinite" in (p or "").lower() for p in combo.get("produces", [])):
            continue
        infinite.append(" + ".join(combo.get("card_names", [])))
        combined_mv = sum((by_id.get(i, {}).get("cmc") or 0) for i in ids)
        if combined_mv <= EARLY_COMBO_MV:
            early_infinite = True

    mld = sorted(d.get("name", "") for d in deck_docs if _MLD_RE.search(d.get("oracle_text") or ""))
    extra = sorted(d.get("name", "") for d in deck_docs if _EXTRA_TURN_RE.search(d.get("oracle_text") or ""))
    tutors = sorted(d.get("name", "") for d in deck_docs if roles.TUTOR in roles.tag_roles(d))

    signals: list[BracketSignal] = []
    if gc_names:
        signals.append(BracketSignal("game_changers", "Game Changers", len(gc_names), gc_names))
    if infinite:
        signals.append(BracketSignal("infinite_combo", "Two-card infinite combos", len(infinite), infinite))
    if mld:
        signals.append(BracketSignal("land_denial", "Mass land denial", len(mld), mld))
    if extra:
        signals.append(BracketSignal("extra_turns", "Extra-turn spells", len(extra), extra))
    if tutors:
        signals.append(BracketSignal("tutors", "Tutors", len(tutors), tutors))

    n_gc = len(gc_names)
    reasons: list[str] = []
    if n_gc >= 4 or early_infinite or mld or extra:
        bracket = 4
        if n_gc >= 4:
            reasons.append(f"{n_gc} Game Changers")
        if early_infinite:
            reasons.append("an early two-card infinite combo")
        if mld:
            reasons.append("mass land denial")
        if extra:
            reasons.append("extra-turn effects")
    elif n_gc >= 1 or infinite or len(tutors) >= TUTOR_HEAVY:
        bracket = 3
        if n_gc:
            reasons.append(f"{n_gc} Game Changer{'s' if n_gc > 1 else ''}")
        if infinite:
            reasons.append("a two-card combo")
        if len(tutors) >= TUTOR_HEAVY:
            reasons.append(f"{len(tutors)} tutors")
    else:
        bracket = 2
        reasons.append("no Game Changers or infinite combos")

    label = BRACKET_LABELS[bracket]
    explanation = f"Estimated Bracket {bracket} ({label}) — " + ", ".join(reasons) + "."

    if bracket == 4 and n_gc >= 4 and early_infinite:
        caveat = "Signals are cEDH-leaning — a tuned build could be Bracket 5."
    elif bracket >= 3:
        caveat = "Brackets 1 (Exhibition) and 5 (cEDH) reflect intent and metagame, which card content can't fully determine."
    else:
        caveat = "Estimated from card content; a deliberately casual deck could be Bracket 1."

    return BracketResult(bracket, label, explanation, signals, caveat)
