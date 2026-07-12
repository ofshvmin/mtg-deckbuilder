"""Unit tests for AI-brief spec validation + shortlist (pure, no network)."""
from app.services import ai_brief


def _card(oid, name, cmc=2.0, text="", type_line="Creature"):
    return {"_id": oid, "name": name, "cmc": cmc, "oracle_text": text, "type_line": type_line}


STRATS = {"Balanced", "Aggro", "Control", "Combo"}


def test_validate_drops_unknown_cards_and_strategy():
    spec = {
        "core_cards": ["Sol Ring", "Fake Card", "sol ring"],  # dup + unknown
        "strategy": "Nonsense",
        "theme": "  treasure  ",
        "quota_overrides": {"ramp": 12, "bogus": 5, "removal": 99},
        "avoid_combos": True,
        "land_count": 200,
        "rationale": "  Build treasures.  ",
    }
    out = ai_brief.validate_spec(spec, {"Sol Ring", "Arcane Signet"}, STRATS)
    assert out["core_cards"] == ["Sol Ring"]          # unknown dropped, dedup
    assert out["strategy"] is None                    # unknown strategy dropped
    assert out["theme"] == "treasure"                 # trimmed
    assert out["quota_overrides"] == {"ramp": 12, "removal": 20}  # bogus role dropped, clamp
    assert out["avoid_combos"] is True
    assert out["land_count"] is None                  # out of 30-42 range
    assert out["rationale"] == "Build treasures."


def test_validate_keeps_valid_strategy_and_landcount():
    out = ai_brief.validate_spec(
        {"core_cards": [], "strategy": "Aggro", "land_count": 34, "rationale": "x"},
        {"Sol Ring"}, STRATS,
    )
    assert out["strategy"] == "Aggro"
    assert out["land_count"] == 34
    assert out["theme"] is None


def test_shortlist_ranks_by_quality_and_caps():
    pool = [_card(f"c{i}", f"Card {i}") for i in range(10)]
    quality = {f"c{i}": i / 10 for i in range(10)}  # c9 best
    sl = ai_brief.build_shortlist(pool, quality, combo_pieces={"c9"}, limit=3)
    assert [c["name"] for c in sl] == ["Card 9", "Card 8", "Card 7"]
    assert sl[0]["combo"] is True
    assert "roles" in sl[0] and "text" in sl[0]
