"""Format spec invariants."""
from app.services import formats
from app.services.formats import COMMANDER, LEGACY, STANDARD, get_format


class TestGetFormat:
    def test_none_is_commander(self):
        """The whole back-compat story: a request with no format behaves as before."""
        assert get_format(None).key == COMMANDER

    def test_empty_string_is_commander(self):
        assert get_format("").key == COMMANDER

    def test_unknown_is_commander(self):
        assert get_format("vintage").key == COMMANDER

    def test_case_insensitive(self):
        assert get_format("STANDARD").key == STANDARD


class TestCommanderSpec:
    def test_reduces_new_code_to_old(self):
        """max_copies=1 and copy_bonus=0.0 are what make the generator refactor a no-op."""
        spec = get_format(COMMANDER)
        assert spec.max_copies == 1
        assert spec.copy_bonus == 0.0

    def test_shape(self):
        spec = get_format(COMMANDER)
        assert spec.deck_size == 99
        assert spec.requires_commander is True
        assert spec.legality_field == "legal_commander"

    def test_all_capabilities_on(self):
        spec = get_format(COMMANDER)
        assert spec.supports_quality
        assert spec.supports_combos
        assert spec.supports_brackets
        assert spec.supports_upgrades


class TestConstructedSpecs:
    def test_standard_shape(self):
        spec = get_format(STANDARD)
        assert spec.deck_size == 60
        assert spec.max_copies == 4
        assert spec.requires_commander is False
        assert spec.auto_select_colors is True
        assert spec.legality_field == "legal_standard"

    def test_legacy_differs_from_standard_only_in_legality(self):
        std, leg = get_format(STANDARD), get_format(LEGACY)
        assert leg.deck_size == std.deck_size
        assert leg.max_copies == std.max_copies
        assert leg.default_land_count == std.default_land_count
        assert leg.legality_field == "legal_legacy"

    def test_legacy_color_cap_held_at_three(self):
        """Deliberate: the mana penalty is only calibrated for 1-3 colors."""
        assert get_format(LEGACY).max_deck_colors == 3

    def test_no_commander_only_capabilities(self):
        for key in (STANDARD, LEGACY):
            spec = get_format(key)
            assert not spec.supports_quality
            assert not spec.supports_brackets
            assert not spec.supports_upgrades

    def test_combos_in_every_sixty_card_format(self):
        """Spellbook's feed carries a legality per format, so combos aren't Commander-only."""
        for key in (STANDARD, LEGACY, formats.PIONEER, formats.MODERN, formats.PAUPER):
            assert get_format(key).supports_combos

    def test_land_count_within_range(self):
        for key in (STANDARD, LEGACY):
            spec = get_format(key)
            low, high = spec.land_range
            assert low <= spec.default_land_count <= high


class TestNewConstructedFormats:
    def test_sixty_card_shape(self):
        for key in (formats.PIONEER, formats.MODERN, formats.PAUPER):
            spec = get_format(key)
            assert spec.key == key
            assert spec.deck_size == 60
            assert spec.max_copies == 4
            assert spec.requires_commander is False
            assert spec.family == formats.FAMILY_CONSTRUCTED

    def test_read_the_stored_legality_map(self):
        """No denormalized field: the pool query reads `legalities.<format>` directly."""
        assert get_format(formats.MODERN).legality_field == "legalities.modern"
        assert get_format(formats.PAUPER).legality_field == "legalities.pauper"


class TestFormatLists:
    def test_v1_list_fits_one_row(self):
        """Shipped apps draw /formats as one row of segments; four is the most it holds."""
        keys = [f["key"] for f in formats.list_formats()]
        assert keys == [COMMANDER, STANDARD, LEGACY, formats.PAUPER]

    def test_catalog_has_every_format_once(self):
        keys = [e["key"] for e in formats.list_catalog()]
        assert len(keys) == len(set(keys))
        assert set(formats.FORMATS) <= set(keys)

    def test_catalog_labels_drop_the_gloss(self):
        legacy = next(e for e in formats.list_catalog() if e["key"] == LEGACY)
        assert legacy["label"] == "Legacy"

    def test_coming_soon_is_never_buildable(self):
        for entry in formats.list_catalog():
            if not entry["available"]:
                assert get_format(str(entry["key"])).key == COMMANDER

    def test_pauper_commander_is_buildable_but_not_in_v1(self):
        """Shipped apps would search it with Commander's rules, so it stays out of /formats."""
        pdh = next(e for e in formats.list_catalog() if e["key"] == formats.PAUPER_COMMANDER)
        assert pdh["available"] and pdh["family"] == formats.FAMILY_COMMANDER
        assert formats.PAUPER_COMMANDER not in [f["key"] for f in formats.list_formats()]

    def test_pauper_commander_shape(self):
        spec = get_format(formats.PAUPER_COMMANDER)
        assert spec.requires_commander and spec.deck_size == 99 and spec.max_copies == 1
        assert spec.legality_field == "legalities.paupercommander"
        assert spec.supports_combos
        assert not (spec.supports_quality or spec.supports_brackets or spec.supports_upgrades)
