"""60-card constructed generation (Standard / Legacy).

The point of the multi-copy fill is that output should look like a real constructed
deck — a spine of playsets — rather than a 36-card singleton pile. These tests pin
that, plus the copy caps that keep it legal and honest about what's owned.
"""
from app.services import generator
from app.services.formats import get_format
from app.services.strategies import get_strategy

STANDARD = get_format("standard")
LEGACY = get_format("legacy")


def _doc(oid, name, type_line, cmc, text="", produced=None, copies=4, colors=None):
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
        "copies_owned": copies,
    }


BASICS = {
    "G": {
        "name": "Forest",
        "type_line": "Basic Land — Forest",
        "color_identity": ["G"],
        "produced_mana": ["G"],
    }
}


def _pool(copies=4):
    pool = []
    for i in range(12):
        pool.append(_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 2, copies=copies))
    for i in range(8):
        pool.append(_doc(f"bear{i}", f"Bear {i}", "Creature — Bear", 3, copies=copies))
    for i in range(6):
        pool.append(
            _doc(f"ramp{i}", f"Ramp {i}", "Creature — Elf", 1, "{T}: Add {G}.", ["G"], copies)
        )
    for i in range(6):
        pool.append(_doc(f"draw{i}", f"Draw {i}", "Sorcery", 3, "Draw two cards.", copies=copies))
    for i in range(8):
        pool.append(
            _doc(f"kill{i}", f"Kill {i}", "Instant", 2, "Destroy target creature.", copies=copies)
        )
    for i in range(4):
        pool.append(
            _doc(f"wipe{i}", f"Wipe {i}", "Sorcery", 4, "Destroy all creatures.", copies=copies)
        )
    for i in range(6):
        pool.append(_doc(f"land{i}", f"Land {i}", "Land", 0, "{T}: Add {G}.", ["G"], copies))
    return pool


def _build(spec=STANDARD, pool=None, **kw):
    return generator.generate(
        None, pool if pool is not None else _pool(), ["G"], BASICS,
        spec=spec, strategy=get_strategy(None, spec), **kw,
    )


def _total(deck):
    return sum(c.count for c in deck.cards)


class TestDeckSize:
    def test_builds_sixty_cards(self):
        assert _total(_build()) == 60

    def test_no_short_pool_warning_with_a_deep_pool(self):
        assert _build().warnings == [] or all(
            "short" not in w for w in _build().warnings
        )

    def test_legacy_also_builds_sixty(self):
        assert _total(_build(spec=LEGACY)) == 60


class TestMultiCopy:
    def test_produces_playsets(self):
        """The core claim: output is a spine of 4-ofs, not all singletons."""
        deck = _build()
        nonbasics = [c for c in deck.cards if not c.oracle_id.startswith("basic:")]
        playsets = [c for c in nonbasics if c.count == 4]
        assert playsets, "expected at least some 4-ofs in a 60-card deck"

    def test_most_slots_come_from_multiples(self):
        deck = _build()
        nonbasics = [c for c in deck.cards if not c.oracle_id.startswith("basic:")]
        from_multiples = sum(c.count for c in nonbasics if c.count > 1)
        assert from_multiples > sum(c.count for c in nonbasics) / 2

    def test_never_exceeds_four_copies(self):
        deck = _build()
        assert all(
            c.count <= 4 for c in deck.cards if not c.oracle_id.startswith("basic:")
        )

    def test_respects_copies_owned(self):
        """Owning 2 copies caps the deck at 2, even though the format allows 4."""
        deck = _build(pool=_pool(copies=2))
        assert all(
            c.count <= 2 for c in deck.cards if not c.oracle_id.startswith("basic:")
        )

    def test_singleton_pool_still_builds(self):
        deck = _build(pool=_pool(copies=1))
        assert all(
            c.count == 1 for c in deck.cards if not c.oracle_id.startswith("basic:")
        )


class TestManaBase:
    def test_land_count_matches_strategy(self):
        deck = _build()
        assert deck.land_count == get_strategy(None, STANDARD).land_count

    def test_nonbasic_lands_come_in_multiples(self):
        deck = _build()
        nonbasic = [
            c for c in deck.cards
            if c.slot == "land" and not c.oracle_id.startswith("basic:")
        ]
        assert any(c.count > 1 for c in nonbasic)

    def test_lands_plus_nonlands_equal_deck_size(self):
        deck = _build()
        lands = sum(c.count for c in deck.cards if c.slot == "land")
        nonlands = sum(c.count for c in deck.cards if c.slot != "land")
        assert lands + nonlands == 60


class TestStrategies:
    def test_aggro_runs_fewer_lands_than_control(self):
        aggro = generator.generate(
            None, _pool(), ["G"], BASICS,
            spec=STANDARD, strategy=get_strategy("aggro", STANDARD),
        )
        control = generator.generate(
            None, _pool(), ["G"], BASICS,
            spec=STANDARD, strategy=get_strategy("control", STANDARD),
        )
        assert aggro.land_count < control.land_count

    def test_constructed_strategies_are_not_edh_ones(self):
        """Guards against silently falling back to the 37-land Commander table."""
        assert get_strategy("aggro", STANDARD).land_count == 22
        assert get_strategy(None, STANDARD).name == "Midrange"


class TestShortPool:
    def test_warns_when_pool_cannot_fill_the_deck(self):
        thin = [_doc(f"x{i}", f"X {i}", "Creature — Cat", 2, copies=1) for i in range(5)]
        deck = _build(pool=thin)
        assert any("short" in w for w in deck.warnings)

    def test_warning_names_the_right_deck_size(self):
        thin = [_doc(f"x{i}", f"X {i}", "Creature — Cat", 2, copies=1) for i in range(5)]
        deck = _build(pool=thin)
        assert any("60" in w for w in deck.warnings)
        assert not any("99" in w for w in deck.warnings)
