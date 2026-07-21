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


# --- constructed formats: structural shortlist + counted core cards ---

from app.services.formats import get_format  # noqa: E402

STANDARD = get_format("standard")
COMMANDER = get_format("commander")


def _c(oid, name, *, cmc=2.0, text="", type_line="Creature — Human",
       rarity="common", copies=1, colors=("R",)):
    return {
        "_id": oid, "name": name, "cmc": cmc, "oracle_text": text,
        "type_line": type_line, "rarity": rarity, "copies_owned": copies,
        "colors": list(colors), "color_identity": list(colors), "keywords": [],
    }


def _varied_pool(n=400):
    """A pool wide enough to exercise every stratum, spread across colors."""
    pool, colors = [], ["W", "U", "B", "R", "G"]
    kinds = [
        ("Kill", "Instant", "destroy target creature"),
        ("Draw", "Sorcery", "draw two cards"),
        ("Wipe", "Sorcery", "destroy all creatures"),
        ("Ramp", "Artifact", "{T}: Add {C}."),
        ("Stop", "Instant", "counter target spell"),
        ("Bear", "Creature — Bear", ""),
        ("Land", "Land", "{T}: Add {R}."),
    ]
    for i in range(n):
        base, tl, txt = kinds[i % len(kinds)]
        pool.append(_c(
            f"c{i}", f"{base} {i}", cmc=float(i % 6), text=txt, type_line=tl,
            rarity=["common", "uncommon", "rare", "mythic"][i % 4],
            copies=[1, 2, 3, 4][i % 4], colors=(colors[i % 5],),
        ))
    return pool


class TestStructuralShortlist:
    def test_commander_still_ranks_by_quality(self):
        """The EDHREC path must be untouched."""
        pool = [_c("a", "A"), _c("b", "B"), _c("c", "C")]
        quality = {"a": 0.1, "b": 0.9, "c": 0.5}
        out = ai_brief.build_shortlist(pool, quality, set(), spec=COMMANDER)
        assert [c["name"] for c in out] == ["B", "C", "A"]

    def test_constructed_ignores_quality(self):
        pool = _varied_pool(120)
        a = ai_brief.build_shortlist(pool, {}, set(), spec=STANDARD)
        b = ai_brief.build_shortlist(pool, {c["_id"]: 1.0 for c in pool}, set(), spec=STANDARD)
        assert [c["name"] for c in a] == [c["name"] for c in b]

    def test_respects_the_limit(self):
        out = ai_brief.build_shortlist(_varied_pool(400), {}, set(), limit=200, spec=STANDARD)
        assert len(out) <= 200

    def test_no_duplicate_cards(self):
        out = ai_brief.build_shortlist(_varied_pool(400), {}, set(), spec=STANDARD)
        names = [c["name"] for c in out]
        assert len(names) == len(set(names))

    def test_every_stratum_represented(self):
        """Ranking alone would return 200 rares and no lands."""
        out = ai_brief.build_shortlist(_varied_pool(400), {}, set(), spec=STANDARD)
        types = " ".join(c["type"] for c in out).lower()
        for kind in ("land", "instant", "sorcery", "creature"):
            assert kind in types, f"no {kind} in shortlist"

    def test_all_colors_represented(self):
        """Claude can't honor 'red-green stompy' if suppression wiped out a color."""
        out = ai_brief.build_shortlist(_varied_pool(400), {}, set(), spec=STANDARD)
        seen = {c for entry in out for c in entry.get("colors", [])}
        assert seen == {"W", "U", "B", "R", "G"}

    def test_near_duplicates_are_suppressed(self):
        """20 identical 2-mana commons must not consume 20 slots."""
        pool = [
            _c(f"d{i}", f"Dupe {i}", cmc=2.0, type_line="Creature — Bear", colors=("R",))
            for i in range(20)
        ]
        out = ai_brief.build_shortlist(pool, {}, set(), spec=STANDARD)
        assert len(out) <= ai_brief._PER_SIGNATURE

    def test_payload_carries_copies_for_constructed(self):
        out = ai_brief.build_shortlist(_varied_pool(60), {}, set(), spec=STANDARD)
        assert all("copies" in c for c in out)
        assert all(1 <= c["copies"] <= 4 for c in out)

    def test_payload_omits_copies_for_commander(self):
        out = ai_brief.build_shortlist([_c("a", "A")], {"a": 1.0}, set(), spec=COMMANDER)
        assert "copies" not in out[0]

    def test_rares_outrank_commons_all_else_equal(self):
        pool = [
            _c("r", "Rare One", rarity="rare", copies=4, type_line="Instant",
               text="destroy target creature"),
            _c("c", "Common One", rarity="common", copies=1, type_line="Instant",
               text="destroy target creature"),
        ]
        out = ai_brief.build_shortlist(pool, {}, set(), spec=STANDARD)
        assert out[0]["name"] == "Rare One"


class TestCountedCoreCards:
    def test_accepts_objects_with_counts(self):
        out = ai_brief.validate_spec(
            {"core_cards": [{"name": "Sol Ring", "count": 4}], "rationale": "x"},
            {"Sol Ring"}, STRATS, fmt=STANDARD,
        )
        assert out["core_cards"] == ["Sol Ring"]
        assert out["core_counts"] == {"Sol Ring": 4}

    def test_accepts_bare_strings_as_one_copy(self):
        """Commander's shape must keep working through the same validator."""
        out = ai_brief.validate_spec(
            {"core_cards": ["Sol Ring"], "rationale": "x"}, {"Sol Ring"}, STRATS,
        )
        assert out["core_counts"] == {"Sol Ring": 1}

    def test_caps_counts_at_format_max(self):
        out = ai_brief.validate_spec(
            {"core_cards": [{"name": "Sol Ring", "count": 99}], "rationale": "x"},
            {"Sol Ring"}, STRATS, fmt=STANDARD,
        )
        assert out["core_counts"]["Sol Ring"] == 4

    def test_commander_caps_counts_at_one(self):
        out = ai_brief.validate_spec(
            {"core_cards": [{"name": "Sol Ring", "count": 4}], "rationale": "x"},
            {"Sol Ring"}, STRATS, fmt=COMMANDER,
        )
        assert out["core_counts"]["Sol Ring"] == 1

    def test_land_range_follows_the_format(self):
        std = ai_brief.validate_spec(
            {"core_cards": [], "land_count": 24, "rationale": "x"}, set(), STRATS, fmt=STANDARD)
        assert std["land_count"] == 24
        # 24 is out of Commander's 30-42 range
        cmd = ai_brief.validate_spec(
            {"core_cards": [], "land_count": 24, "rationale": "x"}, set(), STRATS, fmt=COMMANDER)
        assert cmd["land_count"] is None

    def test_colors_are_validated_and_capped(self):
        out = ai_brief.validate_spec(
            {"core_cards": [], "colors": ["R", "G", "X", "U", "W"], "rationale": "x"},
            set(), STRATS, fmt=STANDARD,
        )
        assert "X" not in out["colors"]
        assert len(out["colors"]) <= STANDARD.max_deck_colors

    def test_colors_default_empty(self):
        out = ai_brief.validate_spec({"core_cards": [], "rationale": "x"}, set(), STRATS)
        assert out["colors"] == []


class TestSpecTool:
    def test_commander_tool_is_the_original_object(self):
        assert ai_brief._spec_tool(COMMANDER) is ai_brief._SPEC_TOOL
        assert ai_brief._spec_tool(None) is ai_brief._SPEC_TOOL

    def test_constructed_tool_has_counted_cards_and_colors(self):
        props = ai_brief._spec_tool(STANDARD)["input_schema"]["properties"]
        assert props["core_cards"]["items"]["type"] == "object"
        assert "colors" in props
        assert "avoid_combos" not in props

    def test_constructed_tool_does_not_mutate_the_original(self):
        ai_brief._spec_tool(STANDARD)
        assert ai_brief._SPEC_TOOL["input_schema"]["properties"]["core_cards"]["items"] == {
            "type": "string"
        }

    def test_system_prompt_mentions_format_rules(self):
        sys = ai_brief._system_for(STANDARD)
        assert "60-card" in sys and "no commander" in sys
        assert ai_brief._system_for(COMMANDER) is ai_brief._SYSTEM


class TestSlotBudget:
    """A core that fills every non-land slot leaves no room for interaction."""

    def _spec(self, n_cards, count=4):
        names = {f"Card {i}" for i in range(n_cards)}
        raw = {"core_cards": [{"name": f"Card {i}", "count": count} for i in range(n_cards)],
               "rationale": "x"}
        return ai_brief.validate_spec(raw, names, STRATS, fmt=STANDARD)

    def test_trims_an_oversized_core(self):
        out = self._spec(15)   # 15 x4 = 60 slots, way past the 36 non-land budget
        assert sum(out["core_counts"].values()) <= 22   # 60% of 36

    def test_keeps_a_reasonable_core_intact(self):
        out = self._spec(5)    # 5 x4 = 20 slots, under budget
        assert sum(out["core_counts"].values()) == 20
        assert len(out["core_cards"]) == 5

    def test_keeps_earliest_picks(self):
        """Trim from the end — the model lists its most important cards first."""
        out = self._spec(15)
        assert out["core_cards"][0] == "Card 0"

    def test_core_cards_and_counts_stay_consistent(self):
        out = self._spec(15)
        assert set(out["core_cards"]) == set(out["core_counts"])

    def test_commander_core_is_not_trimmed(self):
        names = {f"Card {i}" for i in range(30)}
        out = ai_brief.validate_spec(
            {"core_cards": [f"Card {i}" for i in range(30)], "rationale": "x"},
            names, STRATS, fmt=COMMANDER,
        )
        assert len(out["core_cards"]) == 30
