"""Analyze & upgrade: candidates, validation and the no-Claude fallback.

Claude only ever chooses among these candidates, and `validate_swaps` is the gate
between its answer and the user — so these tests are the guarantee that nothing
invented, illegal or deck-size-breaking reaches the screen.
"""
from app.services import deck_analysis as da
from app.services import scryfall
from app.services.formats import get_format
from app.services.strategies import get_strategy

STANDARD = get_format("standard")
MIDRANGE = get_strategy(None, STANDARD)


def _doc(oid, cmc=2, text="", type_line="Creature — Bear", rank=None):
    return {
        "_id": oid, "name": oid.title(), "mana_cost": f"{{{cmc}}}", "cmc": cmc,
        "type_line": type_line, "oracle_text": text,
        "edhrec_rank": rank, "rank_score": scryfall.rank_score(rank),
    }


KILL = "Destroy target creature."
DRAW = "Draw two cards."


def _deck():
    """A 36-spell Midrange deck heavy on 2-drop bears, light on removal and draw."""
    deck = [(_doc(f"bear{i}", 2, rank=8_000 + i), 4) for i in range(8)]
    deck.append((_doc("kill", 2, KILL, "Instant", rank=300), 4))
    return deck


class TestShape:
    def test_counts_roles_and_curve_by_copies(self):
        shape = da.deck_shape(_deck(), STANDARD, MIDRANGE)
        assert shape.role_counts.get("removal") == 4
        assert shape.curve[2] == 36
        assert shape.role_short("removal") == MIDRANGE.quotas["removal"] - 4
        assert shape.curve_over(2) > 0


class TestCuts:
    def test_weak_cards_first_and_quota_roles_kept(self):
        deck = _deck()
        shape = da.deck_shape(deck, STANDARD, MIDRANGE)
        cuts = da.cut_candidates(deck, shape, {}, set(), rank_weight=1.0)
        assert cuts[0].doc["_id"].startswith("bear")
        assert cuts[-1].doc["_id"] == "kill"  # removal is short, and well ranked

    def test_combo_pieces_are_protected(self):
        deck = _deck()
        shape = da.deck_shape(deck, STANDARD, MIDRANGE)
        cuts = da.cut_candidates(deck, shape, {}, {"bear0"}, rank_weight=1.0)
        order = [c.doc["_id"] for c in cuts]
        assert order.index("bear0") > order.index("bear1")


class TestAdds:
    def _shape(self):
        return da.deck_shape(_deck(), STANDARD, MIDRANGE)

    def test_short_role_beats_more_of_the_same(self):
        docs = [_doc("removal", 3, KILL, "Instant", rank=2_000), _doc("bear", 2, rank=2_000)]
        adds = da.add_candidates(docs, self._shape(), {}, set(), owned=True,
                                 copies_allowed={"removal": 4, "bear": 4})
        assert adds[0].doc["_id"] == "removal"

    def test_no_copies_left_or_lands_are_skipped(self):
        docs = [_doc("spent", 2, KILL, "Instant"), _doc("land", 0, "", "Land")]
        adds = da.add_candidates(docs, self._shape(), {}, set(), owned=True,
                                 copies_allowed={"spent": 0, "land": 4})
        assert adds == []

    def test_budget_drops_pricey_and_unpriced_buys(self):
        docs = [_doc("cheap", 2, KILL, "Instant"), _doc("pricey", 2, KILL, "Instant"),
                _doc("unpriced", 2, KILL, "Instant")]
        adds = da.add_candidates(
            docs, self._shape(), {}, set(), owned=False,
            copies_allowed={d["_id"]: 4 for d in docs},
            prices={"cheap": 0.5, "pricey": 40.0}, max_price=5.0,
        )
        assert [a.doc["_id"] for a in adds] == ["cheap"]

    def test_combo_finisher_bonus(self):
        docs = [_doc("plain", 2), _doc("finisher", 2)]
        adds = da.add_candidates(docs, self._shape(), {}, {"finisher"}, owned=True,
                                 copies_allowed={"plain": 4, "finisher": 4})
        assert adds[0].doc["_id"] == "finisher"
        assert "completes a combo" in adds[0].notes


def _keyed():
    cuts = {"c1": da.Candidate(_doc("bear0"), 3.0, [], count=4),
            "c2": da.Candidate(_doc("bear1"), 2.5, [], count=2)}
    adds = {"o1": da.Candidate(_doc("kill2", 2, KILL, "Instant"), 4.0, ["removal"], count=4, owned=True),
            "b1": da.Candidate(_doc("draw", 3, DRAW, "Sorcery"), 3.0, ["card_draw"], count=4, price=1.0)}
    return cuts, adds


class TestValidate:
    def test_keeps_good_swaps(self):
        cuts, adds = _keyed()
        out = da.validate_swaps(
            [{"cut": "c1", "add": "o1", "count": 2, "reason": "More removal."}], cuts, adds, 4
        )
        assert [(s.cut.doc["_id"], s.add.doc["_id"], s.cut_count, s.reason) for s in out] == [
            ("bear0", "kill2", 2, "More removal.")
        ]

    def test_drops_unknown_keys(self):
        cuts, adds = _keyed()
        assert da.validate_swaps([{"cut": "c9", "add": "o1", "count": 1}], cuts, adds, 4) == []
        assert da.validate_swaps([{"cut": "c1", "add": "Sol Ring", "count": 1}], cuts, adds, 4) == []

    def test_drops_counts_past_what_the_deck_holds(self):
        cuts, adds = _keyed()
        assert da.validate_swaps([{"cut": "c2", "add": "o1", "count": 3}], cuts, adds, 4) == []

    def test_limits_hold_across_swaps(self):
        """Two swaps may not cut the same card past its copies, or add one past the cap."""
        cuts, adds = _keyed()
        out = da.validate_swaps(
            [
                {"cut": "c1", "add": "o1", "count": 3},
                {"cut": "c2", "add": "o1", "count": 2},  # o1 has only 1 copy left
                {"cut": "c1", "add": "b1", "count": 2},  # c1 has only 1 copy left
                {"cut": "c1", "add": "b1", "count": 1},
            ],
            cuts, adds, 4,
        )
        assert [(s.cut.doc["_id"], s.add.doc["_id"], s.cut_count) for s in out] == [
            ("bear0", "kill2", 3), ("bear0", "draw", 1),
        ]

    def test_bad_counts_are_dropped(self):
        cuts, adds = _keyed()
        raw = [{"cut": "c1", "add": "o1", "count": 0}, {"cut": "c1", "add": "o1", "count": "lots"}]
        assert da.validate_swaps(raw, cuts, adds, 4) == []

    def test_singleton_format_caps_adds_at_one(self):
        cuts, adds = _keyed()
        out = da.validate_swaps([{"cut": "c1", "add": "o1", "count": 2}], cuts, adds, 1)
        assert out == []


class TestFallback:
    def test_pairs_by_shared_role(self):
        cut_draw = da.Candidate(_doc("weakdraw", 3, DRAW, "Sorcery"), 3.0, ["card_draw"], count=2)
        cut_bear = da.Candidate(_doc("bear0"), 2.0, [], count=4)
        add_kill = da.Candidate(_doc("kill2", 2, KILL, "Instant"), 4.0, ["removal"], count=4, owned=True)
        add_draw = da.Candidate(_doc("gooddraw", 2, DRAW, "Instant"), 3.5, ["card_draw"], count=4, owned=True)
        swaps = da.pair_swaps([cut_draw, cut_bear], [add_kill, add_draw], max_copies=4)
        assert [(s.cut.doc["_id"], s.add.doc["_id"], s.cut_count) for s in swaps] == [
            ("weakdraw", "gooddraw", 2), ("bear0", "kill2", 4),
        ]
        assert all(s.reason for s in swaps)


def test_analyze_endpoint_requires_premium():
    """Each analysis is a Claude call: the route must sit behind require_premium."""
    from app.auth.deps import require_premium
    from app.routers.decks import router

    route = next(r for r in router.routes if getattr(r, "path", "").endswith("/analyze"))
    deps = [d.call for d in route.dependant.dependencies]
    assert require_premium in deps


def test_analysis_cache_key_tracks_the_deck():
    from app.routers.decks import AnalyzeRequest, _analysis_key

    a = AnalyzeRequest(format="standard", cards=[{"oracle_id": "x", "count": 4}])
    b = AnalyzeRequest(format="standard", cards=[{"oracle_id": "x", "count": 3}])
    reordered = AnalyzeRequest(format="standard", cards=[{"oracle_id": "y"}, {"oracle_id": "x", "count": 4}])
    same = AnalyzeRequest(format="standard", cards=[{"oracle_id": "x", "count": 4}, {"oracle_id": "y"}])
    assert _analysis_key("u", a, None) != _analysis_key("u", b, None)
    assert _analysis_key("u", reordered, None) == _analysis_key("u", same, None)
    assert _analysis_key("u", a, None) != _analysis_key("u", a, 5.0)
    assert _analysis_key("u", a, None) != _analysis_key("other", a, None)
