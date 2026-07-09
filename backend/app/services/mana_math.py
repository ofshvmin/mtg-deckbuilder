"""Mana math for Commander deck building — Phase 2.

Two independent capabilities, both usable as a library or via mana_calc.py:

1. A general hypergeometric probability calculator (drawing without
   replacement), for questions like "what are the odds of seeing at least 2
   lands in my opening 7?" or "at least one of my 3 combo pieces by turn 8?".

2. A Frank Karsten-style colored-source recommender: how many sources of a
   color you need to reliably (~90%) cast a spell with a given colored-pip
   requirement on curve.

Karsten method assumptions (documented so results are reproducible):
  - Singleton 99-card Commander deck (deck_size defaults to 99).
  - You are on the play, casting the spell on the turn equal to its mana value
    ("on curve"), so by turn T you have seen 7 + (T - 1) = 6 + T cards.
  - Target reliability threshold is 90% by default.
This is the same hypergeometric core Karsten uses, but WITHOUT a mulligan
correction. His published tables assume you mulligan aggressively for your
colors under the London rule, which effectively lets you dig deeper and lowers
the counts — most noticeably on early turns (e.g. our raw model wants ~27
sources for a turn-1 single pip where his mulligan-adjusted table says ~19).
So treat these numbers as a conservative upper bound: hitting them means you're
reliable even without leaning on mulligans. Modeling the London mulligan is a
planned refinement.
"""
from math import comb


# --------------------------------------------------------------------------
# Core hypergeometric distribution
# --------------------------------------------------------------------------

def hypergeometric_pmf(population: int, successes: int, draws: int, k: int) -> float:
    """P(exactly k successes) when drawing `draws` cards without replacement
    from a `population` containing `successes` favorable cards.

    P(X=k) = C(K,k) * C(N-K, n-k) / C(N,n)
    """
    N, K, n = population, successes, draws
    if k < 0 or k > K or (n - k) > (N - K) or k > n:
        return 0.0
    if n > N or K > N or n < 0 or K < 0:
        raise ValueError("draws and successes must each be between 0 and population")
    return comb(K, k) * comb(N - K, n - k) / comb(N, n)


def hypergeometric_at_least(population: int, successes: int, draws: int, x: int) -> float:
    """P(at least x successes)."""
    if x <= 0:
        return 1.0
    upper = min(successes, draws)
    return sum(hypergeometric_pmf(population, successes, draws, k) for k in range(x, upper + 1))


def hypergeometric_at_most(population: int, successes: int, draws: int, x: int) -> float:
    """P(at most x successes)."""
    upper = min(x, successes, draws)
    return sum(hypergeometric_pmf(population, successes, draws, k) for k in range(0, upper + 1))


def hypergeometric_exactly(population: int, successes: int, draws: int, x: int) -> float:
    """P(exactly x successes) — alias for pmf, for readable call sites."""
    return hypergeometric_pmf(population, successes, draws, x)


# --------------------------------------------------------------------------
# Cards-seen model
# --------------------------------------------------------------------------

def cards_seen(turn: int, on_play: bool = True, opening_hand: int = 7) -> int:
    """How many cards you have seen by the point you cast a spell on `turn`.

    On the play you skip the turn-1 draw, so by turn T you have seen
    opening_hand + (T - 1). On the draw, add one more.
    """
    if turn < 1:
        raise ValueError("turn must be >= 1")
    seen = opening_hand + (turn - 1)
    if not on_play:
        seen += 1
    return seen


# --------------------------------------------------------------------------
# Karsten colored-source recommender
# --------------------------------------------------------------------------

def prob_have_sources(deck_size: int, sources: int, turn: int, pips: int,
                      on_play: bool = True, opening_hand: int = 7) -> float:
    """Probability of having at least `pips` colored sources of a color in hand
    by the turn you want to cast the spell (on curve)."""
    seen = min(cards_seen(turn, on_play, opening_hand), deck_size)
    return hypergeometric_at_least(deck_size, sources, seen, pips)


def sources_needed(pips: int, turn: int, deck_size: int = 99, threshold: float = 0.90,
                   on_play: bool = True, opening_hand: int = 7) -> int:
    """Minimum number of colored sources so that the probability of having
    `pips` of them by `turn` (on curve) is at least `threshold`.

    Returns the smallest source count meeting the threshold, capped at deck_size.
    """
    if pips <= 0:
        return 0
    for s in range(pips, deck_size + 1):
        if prob_have_sources(deck_size, s, turn, pips, on_play, opening_hand) >= threshold:
            return s
    return deck_size


def karsten_table(deck_size: int = 99, threshold: float = 0.90,
                  max_pips: int = 3, max_turn: int = 7) -> dict:
    """Build a {pips: {turn: sources_needed}} table (like Karsten's charts)."""
    return {
        p: {t: sources_needed(p, t, deck_size, threshold) for t in range(p, max_turn + 1)}
        for p in range(1, max_pips + 1)
    }
