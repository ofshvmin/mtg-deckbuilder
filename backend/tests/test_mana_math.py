"""Parity tests for the ported mana-math engine — same numbers verified in Phase 2."""
from app.services import mana_math as mm


def test_land_probabilities_match_plan():
    # 99-card deck, 37 lands, opening 7
    assert round(mm.hypergeometric_at_least(99, 37, 7, 2) * 100, 1) == 81.4
    assert round(mm.hypergeometric_at_least(99, 37, 7, 3) * 100, 1) == 52.5


def test_pmf_sums_to_one():
    total = sum(mm.hypergeometric_pmf(99, 37, 7, k) for k in range(0, 8))
    assert abs(total - 1.0) < 1e-9


def test_sources_needed_two_pips_turn_three():
    # Known: 36 sources gives >=90% for a 2-pip card on turn 3 in a 99-card deck.
    assert mm.sources_needed(2, 3, deck_size=99, threshold=0.90) == 36
