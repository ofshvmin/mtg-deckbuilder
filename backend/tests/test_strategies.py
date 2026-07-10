"""Unit tests for the strategy presets module."""
from app.services.strategies import STRATEGIES, get_strategy, list_strategies
from app.services import roles


def test_all_presets_have_valid_quotas():
    for name, strat in STRATEGIES.items():
        assert strat.name, f"{name} missing display name"
        assert strat.description, f"{name} missing description"
        assert strat.land_count >= 30, f"{name} land_count too low"
        assert strat.land_count <= 42, f"{name} land_count too high"
        # Must define quotas for all four standard roles
        for role in [roles.RAMP, roles.CARD_DRAW, roles.REMOVAL, roles.BOARD_WIPE]:
            assert role in strat.quotas, f"{name} missing quota for {role}"
        # Curve weights must sum to ~1.0
        total = sum(strat.curve_weights.values())
        assert 0.99 <= total <= 1.01, f"{name} curve weights sum to {total}"


def test_get_strategy_returns_balanced_for_none():
    strat = get_strategy(None)
    assert strat.name == "Balanced"


def test_get_strategy_returns_balanced_for_unknown():
    strat = get_strategy("nonexistent-strategy-xyz")
    assert strat.name == "Balanced"


def test_get_strategy_case_insensitive():
    strat = get_strategy("Aggro")
    assert strat.name == "Aggro"
    strat2 = get_strategy("AGGRO")
    assert strat2.name == "Aggro"


def test_list_strategies_returns_all():
    result = list_strategies()
    names = {s["name"] for s in result}
    assert "Balanced" in names
    assert "Aggro" in names
    assert "Control" in names
    assert "Combo" in names
    assert "Ramp" in names
    assert "Spellslinger" in names
    for s in result:
        assert "name" in s
        assert "description" in s


def test_aggro_has_lower_lands_than_control():
    aggro = get_strategy("aggro")
    control = get_strategy("control")
    assert aggro.land_count < control.land_count


def test_combo_has_override_weight():
    combo = get_strategy("combo")
    assert combo.combo_weight_override is not None
    assert combo.combo_weight_override > 1.5  # higher than default
