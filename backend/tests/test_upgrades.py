"""Unit tests for the budget-upgrade ranking (pure, no DB/EDHREC network)."""
from app.routers.decks import _build_upgrades, _upgrade_reason


def _card(oid, name, ci=None, type_line="Creature", text="", basic=False):
    return {
        "_id": oid,
        "name": name,
        "name_normalized": name.lower(),
        "mana_cost": "{1}",
        "cmc": 1.0,
        "type_line": type_line,
        "oracle_text": text,
        "color_identity": ci if ci is not None else [],
        "is_basic_land": basic,
    }


def test_upgrade_reason_tiers():
    assert _upgrade_reason(0.5, []) == "High synergy with this commander"
    assert _upgrade_reason(0.1, []) == "Often played with this commander"
    assert _upgrade_reason(0.0, []) == "Popular staple"
    # Role label appended when a recognized role is present.
    assert _upgrade_reason(0.5, ["ramp"]).endswith("· Ramp")


def test_build_upgrades_filters_and_ranks():
    scored = [
        {"n": "sol ring", "s": 0.9, "inc": 100, "syn": 0.05},
        {"n": "dockside extortionist", "s": 0.7, "inc": 80, "syn": 0.4},
        {"n": "owned card", "s": 0.95, "inc": 90, "syn": 0.2},
        {"n": "off color", "s": 0.99, "inc": 99, "syn": 0.3},
    ]
    docs = [
        _card("sol", "Sol Ring", ci=[], type_line="Artifact", text="{T}: Add {C}{C}."),
        _card("dock", "Dockside Extortionist", ci=["R"], text="create treasure"),
        _card("owned", "Owned Card", ci=["R"]),
        _card("off", "Off Color", ci=["U"]),  # outside identity → dropped
    ]
    owned_ids = {"owned", "cmdr"}
    identity = {"R"}

    out = _build_upgrades(scored, docs, owned_ids, identity, limit=10)
    names = [s.name for s in out]

    assert "Owned Card" not in names          # already owned
    assert "Off Color" not in names           # outside color identity
    assert names == ["Sol Ring", "Dockside Extortionist"]  # ranked by score desc
    assert out[0].roles == ["ramp"]           # tagged from oracle text
    assert out[1].synergy == 0.4


def test_build_upgrades_excludes_basics_and_respects_limit():
    scored = [
        {"n": "mountain", "s": 0.99, "syn": 0.0},
        {"n": "card a", "s": 0.8, "syn": 0.0},
        {"n": "card b", "s": 0.6, "syn": 0.0},
    ]
    docs = [
        _card("mtn", "Mountain", ci=[], type_line="Basic Land", basic=True),
        _card("a", "Card A", ci=["R"]),
        _card("b", "Card B", ci=["R"]),
    ]
    out = _build_upgrades(scored, docs, owned_ids=set(), identity={"R"}, limit=1)
    assert [s.name for s in out] == ["Card A"]  # basic dropped, limit honored
