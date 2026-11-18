"""The "card choice" setting: Staples · Balanced · Hidden gems.

One control, the same meaning in every format: how much the builder leans on what
the wider community plays. It only re-weights the card-quality signals —
EDHREC's data for the commander (Commander) and card rank (`rank_score`) — so role
quotas, curve and color rules hold under every setting and the deck stays
functional.

**Balanced is today's behaviour exactly**, in every format: the format's own rank
weight, the usual EDHREC weight, no randomness. That's what keeps shipped apps,
which never send the field, building the decks they always have.

Hidden gems uses a negative rank weight, which the generator reads as "prefer
less-played cards" (see `generator.gem_bonus`).
"""
from __future__ import annotations

from dataclasses import dataclass

from . import generator
from .formats import FormatSpec

STAPLES = "staples"
BALANCED = "balanced"
HIDDEN_GEMS = "hidden_gems"


@dataclass(frozen=True)
class Tuning:
    rank_weight: float     # negative = hidden gems
    quality_weight: float  # EDHREC (Commander only)
    jitter: float


def tuning(choice: str | None, spec: FormatSpec) -> Tuning:
    """The generator weights for a card-choice setting in a format.

    Unknown or missing values are Balanced, so an old client gets today's deck.
    """
    key = (choice or BALANCED).lower()
    base_quality = generator.QUALITY_WEIGHT
    if key == STAPLES:
        if spec.requires_commander:
            # Commander already ranks by EDHREC for its commander; push that harder
            # and let general popularity break the remaining ties.
            return Tuning(rank_weight=0.5, quality_weight=base_quality * 1.5, jitter=0.0)
        return Tuning(rank_weight=spec.rank_weight * 2, quality_weight=base_quality, jitter=0.0)
    if key == HIDDEN_GEMS:
        # Damp the commander's popular picks, prefer less-played cards, and add a
        # little variety so rebuilds turn up different gems.
        quality = base_quality * 0.3 if spec.requires_commander else base_quality
        return Tuning(rank_weight=-1.0, quality_weight=quality, jitter=0.4)
    return Tuning(rank_weight=spec.rank_weight, quality_weight=base_quality, jitter=0.0)
