"""Lock & regenerate: locked cards must survive a rebuild (Tier 2)."""
from app.services import generator


def _doc(oid, name, type_line, cmc, text="", produced=None):
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
        "keywords": [],
        "is_basic_land": False,
    }


COMMANDER = _doc("CMD", "Test Commander", "Legendary Creature — Elf", 3)
BASICS = {"G": {"name": "Forest", "type_line": "Basic Land — Forest",
                "color_identity": ["G"], "produced_mana": ["G"]}}


def _pool():
    pool = []
    for i in range(15):
        pool.append(_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 2))
    for i in range(20):
        pool.append(_doc(f"beast{i}", f"Beast {i}", "Creature — Beast", 6))  # low priority
    for i in range(10):
        pool.append(_doc(f"ramp{i}", f"Ramp {i}", "Creature — Elf", 1, "{T}: Add {G}.", ["G"]))
    for i in range(10):
        pool.append(_doc(f"draw{i}", f"Draw {i}", "Sorcery", 3, "Draw two cards."))
    for i in range(10):
        pool.append(_doc(f"remove{i}", f"Kill {i}", "Instant", 2, "Destroy target creature."))
    # nonbasic lands
    for i in range(5):
        pool.append(_doc(f"land{i}", f"Green Land {i}", "Land", 0, "{T}: Add {G}.", ["G"]))
    return pool


def _ids(deck):
    return {c.oracle_id for c in deck.cards}


def test_locked_card_forced_into_deck():
    pool = _pool()
    plain = generator.generate(COMMANDER, pool, ["G"], BASICS)
    # Find a nonland card the plain build left out.
    excluded = next(
        c["_id"] for c in pool
        if c["_id"].startswith("beast") and c["_id"] not in _ids(plain)
    )
    locked = generator.generate(COMMANDER, pool, ["G"], BASICS, locked_ids={excluded})
    assert excluded in _ids(locked), "locked card should be forced into the deck"
    assert sum(c.count for c in locked.cards) <= 99


def test_locked_land_retained():
    pool = _pool()
    locked = generator.generate(COMMANDER, pool, ["G"], BASICS, locked_ids={"land3"})
    assert "land3" in _ids(locked)


def test_no_locked_is_unchanged():
    pool = _pool()
    a = generator.generate(COMMANDER, pool, ["G"], BASICS)
    b = generator.generate(COMMANDER, pool, ["G"], BASICS, locked_ids=set())
    assert _ids(a) == _ids(b)


def test_locked_still_fills_roles():
    """Locking a few cards shouldn't starve the role quotas."""
    pool = _pool()
    deck = generator.generate(
        COMMANDER, pool, ["G"], BASICS, locked_ids={"beast0", "beast1", "cat0"}
    )
    assert deck.role_counts.get("ramp", 0) >= 5
    assert deck.role_counts.get("removal", 0) >= 3
