"""Unit tests for generator.compose — the manual-builder card-list analyzer.

Pure function (no DB): given chosen card docs it groups them into slots and
computes curve + stats, mirroring the auto-generator's shape.
"""
from app.services import generator


def _doc(oid, name, type_line, cmc, text="", produced=None):
    return {
        "_id": oid,
        "name": name,
        "type_line": type_line,
        "cmc": cmc,
        "mana_cost": "",
        "color_identity": [],
        "oracle_text": text,
        "produced_mana": produced,
    }


LAND = _doc("L", "Test Forest", "Land", 0, "{T}: Add {G}.", ["G"])
REMOVAL = _doc("X", "Kill Spell", "Instant", 2, "Destroy target creature.")
DRAW = _doc("D", "Divination", "Sorcery", 3, "Draw two cards.")
VANILLA = _doc("V", "Grizzly Bears", "Creature — Bear", 2, "")


def test_compose_groups_and_counts():
    deck = generator.compose([LAND, REMOVAL, DRAW, VANILLA], ["G"])
    by_id = {c.oracle_id: c for c in deck.cards}

    # Every chosen card is present.
    assert set(by_id) == {"L", "X", "D", "V"}
    # Land is categorized as a land and counted.
    assert by_id["L"].slot == "land"
    assert deck.land_count == 1
    # Non-land cards land in a non-"land" slot.
    assert by_id["V"].slot != "land"
    assert by_id["X"].slot == "removal"
    assert by_id["D"].slot == "card_draw"
    # Curve counts nonlands only (3 nonlands here).
    assert sum(b["count"] for b in deck.curve) == 3
    assert deck.nonland_count == 3


def test_compose_drops_nothing_and_warns_under_99():
    deck = generator.compose([LAND, VANILLA], ["G"])
    assert sum(c.count for c in deck.cards) == 2
    # Under 99 -> a completion warning mentioning the shortfall.
    assert any("/99" in w for w in deck.warnings)
    # Opening-hand math is suppressed below 7 cards.
    assert deck.stats["p_2plus_lands_opening"] == 0.0


def test_compose_empty():
    deck = generator.compose([], ["G"])
    assert deck.cards == []
    assert deck.land_count == 0
    assert deck.nonland_count == 0
