"""Color filtering for constructed decks.

Regression tests for a real bug: selecting W/G produced a deck containing cards
that cost {U}. Two independent causes, both pinned here.

  1. Transform / modal-DFC cards carry no top-level `colors` (it lives per face),
     so they were recorded as colorless — and the empty set is a subset of every
     color filter, letting them into any deck.

  2. `colors` is the card's *color*, not its castability. A devoid card such as
     Void Grafter is genuinely colorless yet still costs {1}{G}{U}. Filtering on
     `colors` can never catch that; the mana cost has to be read.
"""
from app.services import scryfall
from app.util import card_castable_in, cost_castable_in

WG = {"W", "G"}


class TestCostCastability:
    def test_generic_only_is_always_payable(self):
        assert cost_castable_in("{3}", WG)
        assert cost_castable_in("", WG)

    def test_in_color_cost_passes(self):
        assert cost_castable_in("{1}{G}{W}", WG)

    def test_off_color_cost_fails(self):
        assert not cost_castable_in("{1}{U}", WG)
        assert not cost_castable_in("{1}{G}{U}", WG)

    def test_colorless_symbols_are_payable(self):
        assert cost_castable_in("{2}{C}", WG)
        assert cost_castable_in("{X}{G}", WG)

    def test_hybrid_passes_when_either_half_is_allowed(self):
        assert cost_castable_in("{G/U}", WG)
        assert cost_castable_in("{2/W}", WG)

    def test_hybrid_fails_when_neither_half_is_allowed(self):
        assert not cost_castable_in("{U/B}", WG)

    def test_double_faced_passes_if_either_face_is_castable(self):
        # MDFC: you only need to be able to cast one side.
        assert cost_castable_in("{1}{G} // {3}{U}", WG)

    def test_double_faced_fails_when_no_face_is_castable(self):
        assert not cost_castable_in("{1}{U} // {3}{B}", WG)


class TestCardCastability:
    def _card(self, **kw):
        base = {
            "type_line": "Creature — Human", "mana_cost": "{1}{G}",
            "colors": ["G"], "color_identity": ["G"],
        }
        base.update(kw)
        return base

    def test_devoid_card_is_excluded_despite_being_colorless(self):
        """The Void Grafter case: colors == [] but the cost demands {U}."""
        void_grafter = self._card(
            mana_cost="{1}{G}{U}", colors=[], color_identity=["G", "U"])
        assert not card_castable_in(void_grafter, WG)

    def test_transform_card_with_missing_colors_is_excluded(self):
        """The DFC case: no top-level colors, off-color cost."""
        dfc = self._card(mana_cost="{2}{U}", colors=[], color_identity=["U"],
                         layout="transform")
        assert not card_castable_in(dfc, WG)

    def test_transform_card_in_color_is_kept(self):
        dfc = self._card(mana_cost="{1}{G}", colors=[], color_identity=["G"],
                         layout="transform")
        assert card_castable_in(dfc, WG)

    def test_lands_are_judged_on_identity_not_cost(self):
        """Lands have no cost; an off-color dual must not count as fixing."""
        off = self._card(type_line="Land", mana_cost="", color_identity=["U", "B"])
        on = self._card(type_line="Land", mana_cost="", color_identity=["G"])
        assert not card_castable_in(off, WG)
        assert card_castable_in(on, WG)

    def test_colorless_land_is_kept(self):
        assert card_castable_in(
            self._card(type_line="Land", mana_cost="", color_identity=[]), WG)

    def test_costless_nonland_falls_back_to_identity(self):
        assert not card_castable_in(
            self._card(mana_cost="", colors=[], color_identity=["U"]), WG)

    def test_colorless_artifact_is_kept(self):
        assert card_castable_in(
            self._card(type_line="Artifact", mana_cost="{2}",
                       colors=[], color_identity=[]), WG)


class TestSyncExtractsFaceColors:
    def test_transform_card_takes_colors_from_faces(self):
        card = {
            "layout": "transform",
            "card_faces": [
                {"colors": ["G"], "mana_cost": "{1}{G}"},
                {"colors": [], "mana_cost": ""},
            ],
        }
        assert scryfall._extract_colors(card) == ["G"]

    def test_modal_dfc_unions_both_faces(self):
        card = {
            "layout": "modal_dfc",
            "card_faces": [
                {"colors": ["W"], "mana_cost": "{W}"},
                {"colors": ["U"], "mana_cost": "{U}"},
            ],
        }
        assert scryfall._extract_colors(card) == ["U", "W"]

    def test_top_level_colors_win_when_present(self):
        assert scryfall._extract_colors({"colors": ["R"], "card_faces": []}) == ["R"]

    def test_colorless_needs_an_actual_colorless_declaration(self):
        """Empty `colors` alone doesn't mean colorless — Scryfall omits it for some
        layouts. Only a devoid keyword or "is colorless" text makes it authoritative;
        see TestColorlessGuard."""
        undeclared = {"colors": [], "mana_cost": "{1}{G}{U}", "keywords": []}
        assert scryfall._extract_colors(undeclared) == ["G", "U"]

        devoid = {**undeclared, "keywords": ["Devoid"]}
        assert scryfall._extract_colors(devoid) == []


class TestColorlessGuard:
    """Deriving colors from a mana cost must not touch cards that are colorless
    by rule. 132 devoid cards plus Ghostfire depend on this."""

    def test_devoid_keeps_empty_colors(self):
        card = {"colors": [], "mana_cost": "{1}{G}{U}", "keywords": ["Devoid"],
                "oracle_text": "Devoid (This card has no color.)"}
        assert scryfall._extract_colors(card) == []

    def test_ghostfire_style_text_keeps_empty_colors(self):
        card = {"colors": [], "mana_cost": "{2}{R}", "keywords": [],
                "oracle_text": "Ghostfire is colorless.\nGhostfire deals 3 damage."}
        assert scryfall._extract_colors(card) == []

    def test_adventure_with_no_recorded_colors_falls_back_to_cost(self):
        """Ishgard: colors [] at top level, faces report None, cost is {3}{W}{W}."""
        card = {
            "layout": "adventure", "colors": [], "mana_cost": "{3}{W}{W}", "keywords": [],
            "card_faces": [
                {"name": "Ishgard, the Holy See", "colors": None, "mana_cost": ""},
                {"name": "Faith & Grief", "colors": None, "mana_cost": "{3}{W}{W}"},
            ],
        }
        assert scryfall._extract_colors(card) == ["W"]

    def test_hybrid_cost_yields_both_colors(self):
        """A card costing {G/U} is both green and blue, so both halves count.

        (Real-world caveat: Drowner of Truth looks like this but carries Devoid, so
        it stays colorless — see test_devoid_keeps_empty_colors. The guard is checked
        before the cost is consulted.)
        """
        card = {"layout": "modal_dfc", "colors": [], "keywords": [],
                "card_faces": [
                    {"colors": [], "mana_cost": "{5}{G/U}{G/U}"},
                    {"colors": [], "mana_cost": ""},
                ]}
        assert scryfall._extract_colors(card) == ["G", "U"]

    def test_devoid_beats_a_hybrid_cost(self):
        card = {"layout": "modal_dfc", "colors": [], "keywords": ["Devoid"],
                "card_faces": [{"colors": [], "mana_cost": "{5}{G/U}{G/U}"}]}
        assert scryfall._extract_colors(card) == []

    def test_true_colorless_artifact_stays_empty(self):
        assert scryfall._extract_colors(
            {"colors": [], "mana_cost": "{2}", "keywords": []}) == []

    def test_face_colors_still_win_over_cost(self):
        card = {"colors": [], "keywords": [], "card_faces": [
            {"colors": ["G"], "mana_cost": "{1}{G}"}, {"colors": [], "mana_cost": ""}]}
        assert scryfall._extract_colors(card) == ["G"]
