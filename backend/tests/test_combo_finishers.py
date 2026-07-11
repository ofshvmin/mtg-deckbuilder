"""Unit tests for combo-finisher ranking/enrichment (pure, no DB)."""
from app.routers.decks import _build_finishers


def _finisher(oid, combos):
    return {
        "oracle_id": oid,
        "combos": combos,
        "combo_count": len(combos),
        "popularity": sum(c.get("popularity", 0) for c in combos),
    }


def _combo(cid, names, produces, pop):
    return {"_id": cid, "card_names": names, "produces": produces, "popularity": pop}


def _doc(oid, name, ci=None):
    return {"_id": oid, "name": name, "mana_cost": "{2}", "cmc": 2.0,
            "type_line": "Creature", "color_identity": ci or ["B"]}


def test_owned_first_then_combo_count():
    finishers = [
        # unowned, finishes 2 combos
        _finisher("gravecrawler", [
            _combo("c1", ["Gravecrawler", "Phyrexian Altar"], ["Infinite death"], 900),
            _combo("c2", ["Gravecrawler", "Ashnod's Altar"], ["Infinite mana"], 500),
        ]),
        # owned, finishes 1 combo
        _finisher("blood_artist", [
            _combo("c3", ["Blood Artist", "Viscera Seer"], ["Drain"], 700),
        ]),
    ]
    docs = {
        "gravecrawler": _doc("gravecrawler", "Gravecrawler"),
        "blood_artist": _doc("blood_artist", "Blood Artist"),
    }
    out = _build_finishers(finishers, docs, owned_ids={"blood_artist"}, commander_id="CMD", limit=10)
    # Owned card ranks first even though it finishes fewer combos.
    assert [f.name for f in out] == ["Blood Artist", "Gravecrawler"]
    assert out[0].owned is True and out[1].owned is False
    assert out[1].combo_count == 2
    assert out[1].produces == ["Infinite death"]        # from most popular combo
    assert out[1].combos[0].missing_name == "Gravecrawler"


def test_excludes_commander_and_unknown_cards():
    finishers = [
        _finisher("CMD", [_combo("c1", ["X"], ["y"], 10)]),        # the commander itself
        _finisher("not_in_db", [_combo("c2", ["Z"], ["y"], 10)]),  # no card doc
        _finisher("real", [_combo("c3", ["Real"], ["y"], 10)]),
    ]
    docs = {"real": _doc("real", "Real Card")}
    out = _build_finishers(finishers, docs, owned_ids=set(), commander_id="CMD", limit=10)
    assert [f.name for f in out] == ["Real Card"]


def test_limit_and_combo_cap():
    combos = [_combo(f"c{i}", ["A"], ["y"], i) for i in range(8)]
    out = _build_finishers([_finisher("a", combos)], {"a": _doc("a", "A")},
                           owned_ids=set(), commander_id="CMD", limit=30)
    assert out[0].combo_count == 8          # count reflects all combos
    assert len(out[0].combos) == 5          # but only top 5 combos are returned
