"""Unit tests for bracket estimation (pure; no DB)."""
from app.services import brackets


def _doc(oid, name="Card", cmc=2.0, text="", type_line="Creature"):
    return {"_id": oid, "name": name, "name_normalized": name.lower(),
            "cmc": cmc, "oracle_text": text, "type_line": type_line}


def _combo(names, ids, produces):
    return {"cards": ids, "card_names": names, "produces": produces}


def test_core_no_signals():
    docs = [_doc(f"c{i}") for i in range(5)]
    r = brackets.estimate(docs, [], gc_ids=set())
    assert r.bracket == 2 and r.label == "Core"
    assert r.signals == []


def test_upgraded_on_few_game_changers():
    docs = [_doc("rhystic", "Rhystic Study"), _doc("demonic", "Demonic Tutor"), _doc("x")]
    r = brackets.estimate(docs, [], gc_ids={"rhystic", "demonic"})
    assert r.bracket == 3 and r.label == "Upgraded"
    gc = next(s for s in r.signals if s.key == "game_changers")
    assert gc.count == 2 and "Rhystic Study" in gc.cards


def test_optimized_on_four_game_changers():
    ids = {f"g{i}" for i in range(4)}
    docs = [_doc(g, f"GC {g}") for g in ids] + [_doc("x")]
    r = brackets.estimate(docs, [], gc_ids=ids)
    assert r.bracket == 4 and r.label == "Optimized"


def test_early_infinite_combo_is_optimized():
    docs = [_doc("a", "Piece A", cmc=1.0), _doc("b", "Piece B", cmc=2.0)]
    combos = [_combo(["Piece A", "Piece B"], ["a", "b"], ["Infinite mana"])]
    r = brackets.estimate(docs, combos, gc_ids=set())
    assert r.bracket == 4                      # combined MV 3 <= 5 → "early"
    assert any(s.key == "infinite_combo" for s in r.signals)


def test_late_combo_only_upgraded():
    docs = [_doc("a", "Piece A", cmc=5.0), _doc("b", "Piece B", cmc=6.0)]
    combos = [_combo(["Piece A", "Piece B"], ["a", "b"], ["Infinite mana"])]
    r = brackets.estimate(docs, combos, gc_ids=set())
    assert r.bracket == 3                      # combined MV 11 > 5 → "late"


def test_mass_land_denial_is_optimized():
    docs = [_doc("arma", "Armageddon", text="Destroy all lands.")]
    r = brackets.estimate(docs, [], gc_ids=set())
    assert r.bracket == 4
    assert any(s.key == "land_denial" for s in r.signals)


def test_extra_turns_is_optimized():
    docs = [_doc("tw", "Time Warp", text="Take an extra turn after this one.")]
    r = brackets.estimate(docs, [], gc_ids=set())
    assert r.bracket == 4
    assert any(s.key == "extra_turns" for s in r.signals)


def test_heavy_tutors_bump_to_upgraded():
    docs = [_doc(f"t{i}", f"Tutor {i}", text="Search your library for a card.") for i in range(4)]
    r = brackets.estimate(docs, [], gc_ids=set())
    assert r.bracket == 3
    assert any(s.key == "tutors" and s.count >= 4 for s in r.signals)
