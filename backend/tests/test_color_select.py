"""Color auto-selection.

The scorer builds a real deck per candidate color combination and scores the result,
so these tests pin *deck* properties rather than pool statistics. They assert the
behaviors that motivated the design — a color that can't fill a deck must lose, an
unfixed three-color pile must lose to a clean two-color one, and the three knob modes
must be distinguishable — rather than exact scores, which have no ground truth.
"""
from app.services.color_select import select_colors
from app.services.formats import get_format
from app.services.strategies import get_strategy

SPEC = get_format("standard")
STRATEGY = get_strategy(None, SPEC)

BASICS = {
    c: {
        "name": {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}[c],
        "type_line": "Basic Land",
        "color_identity": [c],
        "produced_mana": [c],
    }
    for c in "WUBRG"
}


def card(
    oid: str,
    colors: list[str],
    *,
    copies: int = 4,
    cmc: float = 2.0,
    type_line: str = "Creature — Human",
    text: str = "",
    produced: list[str] | None = None,
) -> dict:
    doc = {
        "_id": oid,
        "name": oid,
        "name_normalized": oid,
        "colors": colors,
        "color_identity": colors,
        "copies_owned": copies,
        "cmc": cmc,
        "type_line": type_line,
        "oracle_text": text,
        "keywords": [],
        "is_basic_land": False,
        "mana_cost": "{1}{" + colors[0] + "}" if colors else "{1}",
    }
    if produced is not None:
        doc["produced_mana"] = produced
    return doc


def block(prefix: str, colors: list[str], n: int, copies: int = 4) -> list[dict]:
    """A playable spread: creatures, removal and draw across the curve."""
    out = []
    for i in range(n):
        if i % 4 == 0:
            text, tl = "destroy target creature", "Instant"
        elif i % 4 == 1:
            text, tl = "draw two cards", "Sorcery"
        else:
            text, tl = "", "Creature — Human"
        out.append(
            card(f"{prefix}{i}", colors, copies=copies, cmc=float(1 + (i % 4)),
                 type_line=tl, text=text)
        )
    return out


def pick(pool, **kw):
    return select_colors(pool, SPEC, STRATEGY, BASICS, **kw)


class TestPicksBuildableColors:
    def test_prefers_the_color_that_fills_a_deck(self):
        pool = block("u", ["U"], 25) + block("r", ["R"], 2)
        assert "R" not in pick(pool).colors

    def test_reports_deck_based_components(self):
        choice = pick(block("u", ["U"], 25))
        assert set(choice.components) >= {
            "completeness", "role_fill", "curve_fit", "playset_ratio", "mana_penalty",
        }

    def test_scores_do_not_all_saturate(self):
        """The bug this rewrite fixed: a deep pool used to tie every color at 1.0."""
        pool = (
            block("w", ["W"], 25)
            + block("u", ["U"], 25)
            + block("b", ["B"], 25)
        )
        choice = pick(pool)
        scores = {choice.score} | {s for _, s in choice.alternates}
        assert len(scores) > 1, "scorer must discriminate between colors"

    def test_returns_alternates(self):
        pool = block("u", ["U"], 25) + block("b", ["B"], 25)
        choice = pick(pool)
        assert choice.alternates
        assert all(cols != choice.colors for cols, _ in choice.alternates)


class TestCompleteness:
    def test_a_color_that_cannot_fill_the_deck_loses(self):
        deep, thin = block("u", ["U"], 25), block("g", ["G"], 2, copies=1)
        assert pick(deep + thin).colors == ["U"]

    def test_flags_short_pool_when_nothing_can_fill(self):
        choice = pick(block("u", ["U"], 2, copies=1))
        assert choice.short_pool
        assert choice.colors, "a thin collection gets a warned answer, not an empty one"

    def test_empty_pool_does_not_crash(self):
        assert pick([]).short_pool


class TestManaPenalty:
    def _three_colors(self, with_fixing: bool) -> list[dict]:
        pool = block("w", ["W"], 10) + block("u", ["U"], 10) + block("b", ["B"], 10)
        if with_fixing:
            for i in range(8):
                pool.append(
                    card(f"dual{i}", ["W", "U", "B"], copies=4,
                         type_line="Land", produced=["W", "U", "B"])
                )
        return pool

    def test_fixing_enables_more_colors(self):
        without = pick(self._three_colors(False))
        with_fix = pick(self._three_colors(True))
        assert len(with_fix.colors) >= len(without.colors)

    def test_penalty_is_zero_for_mono(self):
        assert pick(block("u", ["U"], 25)).components["mana_penalty"] == 0.0


class TestColorKnob:
    """The three behaviors from the plan, sharing one code path."""

    POOL = block("u", ["U"], 20) + block("b", ["B"], 20) + block("r", ["R"], 3)

    def test_no_locks_searches_everything(self):
        choice = pick(self.POOL)
        assert 1 <= len(choice.colors) <= SPEC.max_deck_colors

    def test_locked_with_autofill_returns_a_superset(self):
        choice = pick(self.POOL, locked_colors=["R"], auto_fill=True)
        assert "R" in choice.colors
        assert len(choice.colors) > 1, "auto-fill should shore up a weak lone color"

    def test_locked_without_autofill_returns_the_lock_exactly(self):
        assert pick(self.POOL, locked_colors=["R"], auto_fill=False).colors == ["R"]

    def test_lock_is_returned_in_canonical_wubrg_order(self):
        choice = pick(self.POOL, locked_colors=["R", "U"], auto_fill=False)
        assert choice.colors == ["U", "R"]

    def test_explicit_choice_still_reports_components(self):
        """The rationale panel needs real numbers even when the user decided."""
        choice = pick(self.POOL, locked_colors=["R"], auto_fill=False)
        assert choice.components["deck_total"] > 0

    def test_respects_max_deck_colors(self):
        assert len(pick(self.POOL).colors) <= SPEC.max_deck_colors


class TestPlaysetPreference:
    def test_prefers_the_color_it_can_run_playsets_of(self):
        """Same card count; only copies differ."""
        pool = block("u", ["U"], 20, copies=4) + block("b", ["B"], 20, copies=1)
        choice = pick(pool)
        assert "U" in choice.colors

    def test_playset_ratio_reflects_copies(self):
        deep = pick(block("u", ["U"], 20, copies=4), locked_colors=["U"], auto_fill=False)
        flat = pick(block("u", ["U"], 20, copies=1), locked_colors=["U"], auto_fill=False)
        assert deep.components["playset_ratio"] > flat.components["playset_ratio"]
