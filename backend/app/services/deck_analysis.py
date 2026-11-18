"""Analyze & upgrade, step 1: deterministic swap candidates (no Claude, no cost).

Given a deck, find what it could cut and what it could add instead, so the Claude
step chooses between real, legal, in-color cards and can't invent one. Also the
fallback: when Claude is unavailable or its answer doesn't validate, `pair_swaps`
turns the same candidates into swaps on its own.

Pure functions over card docs — the router does the database work.

Scoring reuses the generator's ideas at a coarser grain:
- **Cut** a card the deck needs least: low card rank (or EDHREC score in
  Commander), a role the deck already has more of than the strategy wants, a mana
  value bucket over its target. Combo pieces are protected.
- **Add** a card that fills what the deck is short on — a role under quota, a
  thin curve bucket — ranked by card rank / EDHREC score, plus a bonus for
  completing a combo.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import roles
from .formats import FormatSpec
from .strategies import Strategy

QUOTA_ROLES = (roles.REMOVAL, roles.CARD_DRAW, roles.RAMP, roles.BOARD_WIPE)
MAX_CUTS = 25
MAX_ADDS = 40
MAX_SWAPS = 10


def _bucket(cmc: float) -> int:
    return min(int(cmc or 0), 7)


def _is_land(doc: dict) -> bool:
    return "land" in (doc.get("type_line") or "").lower()


@dataclass
class DeckShape:
    """Where the deck stands against its strategy: role counts and curve."""

    role_counts: dict[str, int]
    role_quota: dict[str, int]
    curve: dict[int, int]
    curve_target: dict[int, int]

    def role_short(self, role: str) -> int:
        return max(0, self.role_quota.get(role, 0) - self.role_counts.get(role, 0))

    def role_over(self, role: str) -> int:
        return max(0, self.role_counts.get(role, 0) - self.role_quota.get(role, 0))

    def curve_short(self, b: int) -> int:
        return max(0, self.curve_target.get(b, 0) - self.curve.get(b, 0))

    def curve_over(self, b: int) -> int:
        return max(0, self.curve.get(b, 0) - self.curve_target.get(b, 0))

    def summary(self) -> dict:
        """Compact numbers for the Claude prompt."""
        return {
            "roles": {r: [self.role_counts.get(r, 0), self.role_quota.get(r, 0)] for r in QUOTA_ROLES},
            "curve": {str(b): [self.curve.get(b, 0), self.curve_target.get(b, 0)] for b in range(8)},
        }


def deck_shape(deck: list[tuple[dict, int]], spec: FormatSpec, strategy: Strategy) -> DeckShape:
    """`deck` is (card doc, copies) for every nonland card."""
    role_counts: dict[str, int] = {}
    curve: dict[int, int] = {}
    nonland = 0
    for doc, n in deck:
        nonland += n
        for r in roles.tag_roles(doc) & set(QUOTA_ROLES):
            role_counts[r] = role_counts.get(r, 0) + n
        b = _bucket(doc.get("cmc", 0))
        curve[b] = curve.get(b, 0) + n
    target = {b: round(w * nonland) for b, w in strategy.curve_weights.items()}
    return DeckShape(role_counts, dict(strategy.quotas), curve, target)


@dataclass
class Candidate:
    doc: dict
    score: float
    roles: list[str]
    count: int = 1               # cuts: copies in the deck; adds: copies allowed
    owned: bool = False
    price: float | None = None
    notes: list[str] = field(default_factory=list)


def cut_candidates(
    deck: list[tuple[dict, int]],
    shape: DeckShape,
    quality: dict[str, float],
    combo_pieces: set[str],
    rank_weight: float,
) -> list[Candidate]:
    """The deck's weakest nonland cards, weakest first."""
    out = []
    for doc, n in deck:
        rset = roles.tag_roles(doc) & set(QUOTA_ROLES)
        score, notes = 0.0, []
        score += 2.0 * (1.0 - (doc.get("rank_score") or 0.0)) * (1.0 if rank_weight else 0.5)
        score -= 2.0 * quality.get(doc["_id"], 0.0)
        if rset and all(shape.role_over(r) for r in rset):
            score += 1.0
            notes.append("role over quota")
        elif not rset:
            score += 0.3
        if shape.curve_over(_bucket(doc.get("cmc", 0))):
            score += 1.0
            notes.append("crowded mana value")
        if doc["_id"] in combo_pieces:
            score -= 2.5
            notes.append("combo piece")
        out.append(Candidate(doc, round(score, 3), sorted(rset), count=n, notes=notes))
    out.sort(key=lambda c: -c.score)
    return out[:MAX_CUTS]


def add_candidates(
    docs: list[dict],
    shape: DeckShape,
    quality: dict[str, float],
    finishers: set[str],
    *,
    owned: bool,
    copies_allowed: dict[str, int],
    prices: dict[str, float] | None = None,
    max_price: float | None = None,
) -> list[Candidate]:
    """Cards that would help, best first. `copies_allowed` caps each card (owned
    copies not already in the deck, or the format's copy limit when buying)."""
    out = []
    for doc in docs:
        if _is_land(doc) or doc.get("is_basic_land"):
            continue
        allowed = copies_allowed.get(doc["_id"], 0)
        if allowed < 1:
            continue
        price = (prices or {}).get(doc["_id"])
        if not owned and max_price is not None and (price is None or price > max_price):
            continue
        rset = roles.tag_roles(doc) & set(QUOTA_ROLES)
        score, notes = 0.0, []
        short_roles = [r for r in rset if shape.role_short(r)]
        if short_roles:
            score += 2.0
            notes.append("fills " + "/".join(r.replace("_", " ") for r in short_roles))
        if shape.curve_short(_bucket(doc.get("cmc", 0))):
            score += 1.0
            notes.append("thin mana value")
        score += 2.0 * (doc.get("rank_score") or 0.0)
        score += 2.0 * quality.get(doc["_id"], 0.0)
        if doc["_id"] in finishers:
            score += 1.5
            notes.append("completes a combo")
        out.append(Candidate(
            doc, round(score, 3), sorted(rset), count=allowed, owned=owned, price=price, notes=notes,
        ))
    out.sort(key=lambda c: -c.score)
    return out[:MAX_ADDS]


def prompt_entry(key: str, c: Candidate) -> dict:
    """A candidate as Claude sees it: a short key, never a raw id it could garble."""
    d = c.doc
    entry = {
        "key": key,
        "name": d["name"],
        "cost": d.get("mana_cost", ""),
        "type": d.get("type_line", ""),
        "text": (d.get("oracle_text") or "")[:160],
        "roles": c.roles,
        "rank": d.get("edhrec_rank"),
        "copies": c.count,
    }
    if c.price is not None:
        entry["price"] = c.price
    if c.notes:
        entry["notes"] = c.notes
    return entry


@dataclass
class Swap:
    cut: Candidate
    cut_count: int
    add: Candidate
    add_count: int
    reason: str


def validate_swaps(
    raw: list[dict],
    cuts: dict[str, Candidate],
    adds: dict[str, Candidate],
    max_copies: int,
) -> list[Swap]:
    """Keep only swaps that are real and legal: known keys, counts within what the
    deck holds and what may be added, equal counts so the deck size holds, and no
    card cut or added past its limit across all swaps."""
    out: list[Swap] = []
    cut_left = {k: c.count for k, c in cuts.items()}
    add_left = {k: min(c.count, max_copies) for k, c in adds.items()}
    for item in raw or []:
        ck, ak = item.get("cut"), item.get("add")
        if ck not in cuts or ak not in adds:
            continue
        count = item.get("count")
        try:
            n = 1 if count is None else int(count)
        except (TypeError, ValueError):
            continue
        if n < 1 or n > cut_left[ck] or n > add_left[ak]:
            continue
        if cuts[ck].doc["_id"] == adds[ak].doc["_id"]:
            continue
        cut_left[ck] -= n
        add_left[ak] -= n
        reason = str(item.get("reason") or "").strip()[:200]
        out.append(Swap(cuts[ck], n, adds[ak], n, reason))
        if len(out) >= MAX_SWAPS:
            break
    return out


def pair_swaps(
    cuts: list[Candidate], adds: list[Candidate], max_copies: int, limit: int = 6
) -> list[Swap]:
    """The no-Claude fallback: each weak card against the best unused add that
    shares a role with it, else the best add left."""
    swaps: list[Swap] = []
    used: set[str] = set()
    for cut in cuts:
        if len(swaps) >= limit:
            break
        pick = next(
            (a for a in adds if a.doc["_id"] not in used and set(a.roles) & set(cut.roles)),
            None,
        ) or next((a for a in adds if a.doc["_id"] not in used), None)
        if pick is None:
            break
        if pick.score <= 0:
            continue
        n = min(cut.count, pick.count, max_copies)
        used.add(pick.doc["_id"])
        why = "; ".join(pick.notes) or "stronger, more widely played"
        swaps.append(Swap(cut, n, pick, n, f"{pick.doc['name']}: {why}."))
    return swaps
