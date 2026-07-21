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
        assert get_format("pioneer").key == COMMANDER

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
            assert not spec.supports_combos
            assert not spec.supports_brackets
            assert not spec.supports_upgrades

    def test_land_count_within_range(self):
        for key in (STANDARD, LEGACY):
            spec = get_format(key)
            low, high = spec.land_range
            assert low <= spec.default_land_count <= high


class TestListFormats:
    def test_lists_all_three(self):
        keys = {f["key"] for f in formats.list_formats()}
        assert keys == {COMMANDER, STANDARD, LEGACY}
