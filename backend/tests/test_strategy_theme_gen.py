"""Integration tests: strategy + theme influence on deck generation.

Uses the real generator.generate() with synthetic card pools, confirming that
strategy/theme params actually change the output while backward compatibility
(no params = same behavior) is preserved.
"""
from app.services import generator, roles
from app.services.strategies import get_strategy
from app.services.themes import compute_theme_matches


def _doc(oid, name, type_line, cmc, text="", produced=None, keywords=None):
    return {
        "_id": oid,
        "name": name,
        "name_normalized": name.lower(),
        "type_line": type_line,
        "cmc": cmc,
        "mana_cost": f"{{{int(cmc)}}}" if cmc else "",
        "color_identity": ["G"],
        "oracle_text": text,
        "produced_mana": produced,
        "keywords": keywords or [],
    }


COMMANDER = _doc("CMD", "Test Commander", "Legendary Creature — Elf", 3)
BASICS = {"G": {"name": "Forest", "type_line": "Basic Land — Forest", "color_identity": ["G"], "produced_mana": ["G"]}}

# Build a pool large enough to fill a deck: mix of cats, non-cats, ramp, draw, removal
def _big_pool():
    pool = []
    # 15 cats (cheap creatures)
    for i in range(15):
        pool.append(_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 2, ""))
    # 10 non-cat creatures (expensive)
    for i in range(10):
        pool.append(_doc(f"beast{i}", f"Beast {i}", "Creature — Beast", 5, ""))
    # 10 ramp cards
    for i in range(10):
        pool.append(_doc(f"ramp{i}", f"Ramp Elf {i}", "Creature — Elf Druid", 1, "{T}: Add {G}.", ["G"]))
    # 10 card draw
    for i in range(10):
        pool.append(_doc(f"draw{i}", f"Draw Spell {i}", "Sorcery", 3, "Draw two cards."))
    # 10 removal
    for i in range(10):
        pool.append(_doc(f"remove{i}", f"Kill Spell {i}", "Instant", 2, "Destroy target creature."))
    # 4 board wipes
    for i in range(4):
        pool.append(_doc(f"wipe{i}", f"Wipe {i}", "Sorcery", 5, "Destroy all creatures."))
    # 15 vanilla creatures (filler)
    for i in range(15):
        pool.append(_doc(f"filler{i}", f"Filler {i}", "Creature — Elemental", 3, ""))
    # 5 instants/sorceries
    for i in range(5):
        pool.append(_doc(f"spell{i}", f"Cantrip {i}", "Instant", 1, "Scry 2."))
    return pool


def test_no_params_backward_compatible():
    """No strategy/theme = same as before (Balanced defaults)."""
    pool = _big_pool()
    deck = generator.generate(COMMANDER, pool, ["G"], BASICS)
    assert deck.land_count == 37  # default
    assert deck.strategy is None
    assert deck.theme is None
    assert deck.theme_count == 0
    assert sum(c.count for c in deck.cards) <= 99


def test_aggro_fewer_lands():
    pool = _big_pool()
    strat = get_strategy("aggro")
    deck = generator.generate(COMMANDER, pool, ["G"], BASICS, strategy=strat)
    assert deck.land_count == 34
    assert deck.strategy == "Aggro"


def test_control_more_lands():
    pool = _big_pool()
    strat = get_strategy("control")
    deck = generator.generate(COMMANDER, pool, ["G"], BASICS, strategy=strat)
    assert deck.land_count == 38
    assert deck.strategy == "Control"


def test_explicit_land_count_overrides_strategy():
    pool = _big_pool()
    strat = get_strategy("aggro")  # default 34
    deck = generator.generate(COMMANDER, pool, ["G"], BASICS, land_count=40, strategy=strat)
    assert deck.land_count == 40  # explicit overrides


def test_cat_theme_prioritizes_cats():
    """With a large enough pool, theme should push more cats into the deck.

    Cats are at CMC 5 (lower efficiency tiebreak), non-cats at CMC 2 (higher
    efficiency tiebreak). Without theme bonus the generator prefers the cheaper
    cards. With theme the cats' +2.5 bonus overcomes the efficiency gap.
    """
    pool = []
    # 20 cats at CMC 5 (less efficient without theme)
    for i in range(20):
        pool.append(_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 5, ""))
    # 60 non-cat creatures at CMC 2 (more efficient, preferred without theme)
    for i in range(60):
        pool.append(_doc(f"other{i}", f"Other Creature {i}", "Creature — Beast", 2, ""))
    # Enough ramp/draw/removal to fill roles
    for i in range(12):
        pool.append(_doc(f"ramp{i}", f"Ramp {i}", "Creature — Elf", 1, "{T}: Add {G}.", ["G"]))
    for i in range(12):
        pool.append(_doc(f"draw{i}", f"Draw {i}", "Sorcery", 3, "Draw two cards."))
    for i in range(10):
        pool.append(_doc(f"remove{i}", f"Kill {i}", "Instant", 2, "Destroy target creature."))
    for i in range(4):
        pool.append(_doc(f"wipe{i}", f"Wipe {i}", "Sorcery", 5, "Destroy all creatures."))

    theme_matches = compute_theme_matches(pool, "cat")
    assert theme_matches  # cats exist in pool

    deck_themed = generator.generate(COMMANDER, pool, ["G"], BASICS, theme_matches=theme_matches)
    deck_plain = generator.generate(COMMANDER, pool, ["G"], BASICS)

    # Count cat cards in each deck
    themed_cats = sum(1 for c in deck_themed.cards if c.oracle_id.startswith("cat"))
    plain_cats = sum(1 for c in deck_plain.cards if c.oracle_id.startswith("cat"))
    assert themed_cats > plain_cats, f"Theme should produce more cats: {themed_cats} vs {plain_cats}"
    assert deck_themed.theme_count > 0


def test_theme_still_fills_role_quotas():
    """Even with a strong theme, role cards (ramp/draw/removal) still get picked."""
    pool = _big_pool()
    theme_matches = compute_theme_matches(pool, "cat")
    deck = generator.generate(COMMANDER, pool, ["G"], BASICS, theme_matches=theme_matches)

    # Should still have ramp, draw, removal
    assert deck.role_counts.get("ramp", 0) >= 5
    assert deck.role_counts.get("card_draw", 0) >= 5
    assert deck.role_counts.get("removal", 0) >= 3


def test_theme_no_matches_still_builds():
    """A theme that matches nothing should produce a normal deck + warning-worthy count."""
    pool = _big_pool()
    theme_matches = compute_theme_matches(pool, "unicorn")
    assert theme_matches == set()  # nothing matches

    deck = generator.generate(COMMANDER, pool, ["G"], BASICS, theme_matches=theme_matches)
    assert sum(c.count for c in deck.cards) <= 99
    assert deck.theme_count == 0


def test_strategy_plus_theme():
    """Aggro + cat theme should produce a low-curve cats deck."""
    pool = _big_pool()
    strat = get_strategy("aggro")
    theme_matches = compute_theme_matches(pool, "cat")
    deck = generator.generate(COMMANDER, pool, ["G"], BASICS, strategy=strat, theme_matches=theme_matches)

    assert deck.land_count == 34  # aggro
    assert deck.strategy == "Aggro"
    themed_cats = sum(1 for c in deck.cards if c.oracle_id.startswith("cat"))
    assert themed_cats >= 5


def test_spellslinger_prefers_instants():
    pool = _big_pool()
    strat = get_strategy("spellslinger")
    deck_spell = generator.generate(COMMANDER, pool, ["G"], BASICS, strategy=strat)
    deck_plain = generator.generate(COMMANDER, pool, ["G"], BASICS)

    spell_instants = sum(1 for c in deck_spell.cards if "Instant" in c.type_line or "Sorcery" in c.type_line)
    plain_instants = sum(1 for c in deck_plain.cards if "Instant" in c.type_line or "Sorcery" in c.type_line)
    # Spellslinger should have at least as many instants/sorceries
    assert spell_instants >= plain_instants
