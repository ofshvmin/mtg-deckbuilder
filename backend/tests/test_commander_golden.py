"""Commander regression guard for the multi-copy generator refactor.

The whole format abstraction rests on one claim: Commander's `FormatSpec`
(`max_copies=1`, `copy_bonus=0.0`) reduces the new format-aware code paths to the code
that existed before them. `counts[id] < 1` is exactly `id not in used`, and a copy
bonus of zero contributes nothing to the score.

This test pins that claim. The expected values below were captured from the generator
*before* the refactor — so if the refactor changes Commander output in any way, these
fail. Do not regenerate the expectations to make them pass; that defeats the purpose.

Deliberately asserts on the full ordered card list rather than aggregate counts,
because a scoring change can preserve totals while silently reshuffling selection.
"""
import json
from pathlib import Path

import pytest

from app.services import generator

GOLDEN_PATH = Path(__file__).parent / "data" / "commander_golden.json"


def _doc(oid, name, type_line, cmc, text="", produced=None, colors=None):
    return {
        "_id": oid,
        "name": name,
        "name_normalized": name.lower(),
        "type_line": type_line,
        "cmc": cmc,
        "mana_cost": f"{{{int(cmc)}}}" if cmc else "",
        "color_identity": colors or ["G"],
        "colors": colors or ["G"],
        "oracle_text": text,
        "produced_mana": produced,
        "keywords": [],
        "is_basic_land": False,
        # Deliberately >1 so the refactor's copy cap has something to clamp. Under
        # Commander it must be ignored entirely.
        "copies_owned": 4,
    }


COMMANDER = _doc("CMD", "Test Commander", "Legendary Creature — Elf", 3)
BASICS = {
    "G": {
        "name": "Forest",
        "type_line": "Basic Land — Forest",
        "color_identity": ["G"],
        "produced_mana": ["G"],
    }
}


def build_pool():
    """A pool wide enough to fill a real 99, with every role represented."""
    pool = []
    for i in range(30):
        pool.append(_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 2))
    for i in range(25):
        pool.append(_doc(f"beast{i}", f"Beast {i}", "Creature — Beast", 6))
    for i in range(20):
        pool.append(_doc(f"ramp{i}", f"Ramp {i}", "Creature — Elf", 1, "{T}: Add {G}.", ["G"]))
    for i in range(20):
        pool.append(_doc(f"draw{i}", f"Draw {i}", "Sorcery", 3, "Draw two cards."))
    for i in range(20):
        pool.append(_doc(f"remove{i}", f"Kill {i}", "Instant", 2, "Destroy target creature."))
    for i in range(8):
        pool.append(
            _doc(f"wipe{i}", f"Wipe {i}", "Sorcery", 5, "Destroy all creatures.")
        )
    for i in range(15):
        pool.append(_doc(f"land{i}", f"Green Land {i}", "Land", 0, "{T}: Add {G}.", ["G"]))
    return pool


def generate_commander_deck():
    """The exact call the golden file describes. Keep deterministic — no jitter."""
    return generator.generate(COMMANDER, build_pool(), ["G"], BASICS)


def snapshot(deck) -> dict:
    return {
        "nonland_count": deck.nonland_count,
        "land_count": deck.land_count,
        "role_counts": deck.role_counts,
        "curve": deck.curve,
        "warnings": deck.warnings,
        "cards": [
            {"oracle_id": c.oracle_id, "slot": c.slot, "count": c.count}
            for c in deck.cards
        ],
    }


@pytest.mark.skipif(
    not GOLDEN_PATH.exists(),
    reason="golden file missing — run scripts/capture_commander_golden.py",
)
def test_commander_output_unchanged():
    expected = json.loads(GOLDEN_PATH.read_text())
    assert snapshot(generate_commander_deck()) == expected


def test_generation_is_deterministic():
    """Without jitter the generator must be reproducible, or the golden is meaningless."""
    assert snapshot(generate_commander_deck()) == snapshot(generate_commander_deck())


def test_commander_ignores_copies_owned():
    """Every pool card has copies_owned=4; Commander must still be singleton."""
    deck = generate_commander_deck()
    assert all(c.count == 1 for c in deck.cards if not c.oracle_id.startswith("basic:"))
