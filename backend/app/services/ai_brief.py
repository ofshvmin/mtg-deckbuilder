"""AI deck brief: turn a natural-language request into a build spec via Claude.

Claude picks *core cards* (only from a shortlist of the user's owned, legal pool,
so it can't hallucinate or suggest cards you don't have) plus a few build knobs.
The deterministic generator then builds a legal, curved, synergy/combo-layered
deck around that core. Claude writes the spec; the engine executes it.
"""
from __future__ import annotations

import httpx

from ..config import get_settings
from ..services import roles

_API_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"

# Role keys the generator understands for quota overrides.
_QUOTA_ROLES = {"ramp", "card_draw", "removal", "board_wipe"}


class BriefUnavailable(Exception):
    """The feature isn't configured (no API key)."""


class BriefError(Exception):
    """Claude call failed or returned nothing usable."""


def _short_oracle(text: str, limit: int = 140) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _card_entry(c: dict, combo_pieces: set[str], max_copies: int) -> dict:
    entry = {
        "name": c["name"],
        "type": c.get("type_line", ""),
        "cmc": c.get("cmc", 0),
        "roles": sorted(roles.tag_roles(c)),
        "combo": c["_id"] in combo_pieces,
        "text": _short_oracle(c.get("oracle_text", "")),
    }
    if max_copies > 1:
        # Claude has to know it can't run 4 of a card the player owns 2 of.
        entry["copies"] = min(c.get("copies_owned", 1) or 1, max_copies)
        entry["colors"] = c.get("colors") or []
    return entry


# --- structural ranking (formats with no community quality signal) ---

_RARITY_WEIGHT = {"mythic": 1.0, "rare": 0.85, "uncommon": 0.5, "common": 0.3}
_ANSWER_ROLES = {
    roles.REMOVAL, roles.BOARD_WIPE, roles.CARD_DRAW,
    roles.COUNTERSPELL, roles.PROTECTION, roles.TUTOR, roles.RAMP,
}
# Per-signature cap. Twelve interchangeable 2-mana commons collapse to the best six.
_PER_SIGNATURE = 6


def _base_score(card: dict, role_set: set[str], max_copies: int) -> float:
    """A card's standalone promise, with no metagame data to lean on.

    Rarity is the only real "this card does something" proxy available; text
    density is crude but reliably separates a vanilla bear from a card with an
    ability. Redundancy matters because a constructed deck wants playsets.
    """
    rarity_w = _RARITY_WEIGHT.get((card.get("rarity") or "").lower(), 0.4)
    redundancy = min(card.get("copies_owned", 1) or 1, max_copies) / max(1, max_copies)
    if role_set & _ANSWER_ROLES:
        role_score = 1.0
    elif roles.CREATURE in role_set:
        role_score = 0.4
    else:
        role_score = 0.2
    text_density = min(1.0, len(card.get("oracle_text") or "") / 200)
    return 0.35 * rarity_w + 0.30 * redundancy + 0.25 * role_score + 0.10 * text_density


def _type_bucket(type_line: str) -> str:
    t = (type_line or "").lower()
    for kind in ("land", "creature", "planeswalker", "artifact", "enchantment"):
        if kind in t:
            return kind
    return "spell"


def _signature(card: dict, role_set: set[str]) -> tuple:
    """Cards sharing a signature are near-interchangeable to a deckbuilder.

    Colour is part of the key so suppression can't wipe out a whole colour — Claude
    needs to see every colour to honour a request like "red-green stompy".
    """
    return (
        _type_bucket(card.get("type_line", "")),
        int(card.get("cmc") or 0),
        frozenset(role_set & _ANSWER_ROLES),
        "".join(sorted(card.get("colors") or [])),
    )


# Slot allocation. Claude must see a complete toolkit, not just the top stratum —
# ranking alone would hand back 200 rares and no lands.
_STRATA = [
    ("threats", 60),
    (roles.REMOVAL, 30),
    (roles.CARD_DRAW, 25),
    ("land", 24),
    ("answers", 12),      # counterspells + protection
    (roles.RAMP, 12),
    (roles.BOARD_WIPE, 12),
]


def _stratum_of(card: dict, role_set: set[str]) -> str:
    if _type_bucket(card.get("type_line", "")) == "land":
        return "land"
    for key in (roles.BOARD_WIPE, roles.REMOVAL, roles.CARD_DRAW, roles.RAMP):
        if key in role_set:
            return key
    if role_set & {roles.COUNTERSPELL, roles.PROTECTION}:
        return "answers"
    if roles.CREATURE in role_set or "planeswalker" in (card.get("type_line") or "").lower():
        return "threats"
    return "other"


def build_shortlist(
    pool: list[dict],
    quality: dict[str, float],
    combo_pieces: set[str],
    limit: int = 200,
    spec=None,
) -> list[dict]:
    """The strongest candidate cards for Claude to choose a core from.

    With a quality signal (Commander/EDHREC), rank by it — staples and
    commander-synergy first. The generator's theme bias still pulls the long tail,
    so this only needs the notable cards.

    Without one, rank structurally: score each card on rarity, copies owned, role
    and text density; collapse near-duplicates; then fill the 200 slots by role
    stratum so the candidate set is a usable toolkit rather than 200 rares.
    """
    max_copies = spec.max_copies if spec else 1
    if spec is None or spec.supports_quality:
        ranked = sorted(pool, key=lambda c: -quality.get(c["_id"], 0.0))
        return [_card_entry(c, combo_pieces, max_copies) for c in ranked[:limit]]

    tagged = [(c, roles.tag_roles(c)) for c in pool]
    scored = sorted(
        ((_base_score(c, r, max_copies), c, r) for c, r in tagged),
        key=lambda t: (-t[0], t[1].get("name") or ""),
    )

    # Collapse near-duplicates.
    per_sig: dict[tuple, int] = {}
    deduped: list[tuple[float, dict, set]] = []
    for score, card, role_set in scored:
        sig = _signature(card, role_set)
        if per_sig.get(sig, 0) >= _PER_SIGNATURE:
            continue
        per_sig[sig] = per_sig.get(sig, 0) + 1
        deduped.append((score, card, role_set))

    by_stratum: dict[str, list] = {}
    for score, card, role_set in deduped:
        by_stratum.setdefault(_stratum_of(card, role_set), []).append((score, card, role_set))

    chosen: list[dict] = []
    seen: set[str] = set()
    leftovers: list[tuple[float, dict, set]] = []
    for key, allocation in _STRATA:
        bucket = by_stratum.get(key, [])
        for score, card, role_set in bucket[:allocation]:
            if card["_id"] in seen:
                continue
            seen.add(card["_id"])
            chosen.append(_card_entry(card, combo_pieces, max_copies))
        leftovers.extend(bucket[allocation:])

    leftovers.extend(by_stratum.get("other", []))
    leftovers.sort(key=lambda t: -t[0])
    for score, card, role_set in leftovers:
        if len(chosen) >= limit:
            break
        if card["_id"] in seen:
            continue
        seen.add(card["_id"])
        chosen.append(_card_entry(card, combo_pieces, max_copies))

    return chosen[:limit]


_SPEC_TOOL = {
    "name": "submit_build_spec",
    "description": "Submit the deck build specification derived from the user's request.",
    "input_schema": {
        "type": "object",
        "properties": {
            "core_cards": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Card names to anchor the deck around. MUST be exact names from the provided candidate list. Pick ~8-20 that best fit the request.",
            },
            "strategy": {
                "type": "string",
                "description": "One of the provided strategy names, or omit.",
            },
            "theme": {
                "type": "string",
                "description": "Short theme keyword(s) for card-text matching (e.g. 'treasure sacrifice', 'goblins'), or omit.",
            },
            "quota_overrides": {
                "type": "object",
                "description": "Optional target counts per role. Keys: ramp, card_draw, removal, board_wipe.",
                "additionalProperties": {"type": "integer"},
            },
            "avoid_combos": {
                "type": "boolean",
                "description": "True if the user wants to avoid infinite/two-card combos.",
            },
            "land_count": {
                "type": "integer",
                "description": "Total lands (30-42), or omit for default.",
            },
            "rationale": {
                "type": "string",
                "description": "1-3 sentences explaining the deck's plan, shown to the user.",
            },
        },
        "required": ["core_cards", "rationale"],
    },
}


def _spec_tool(spec=None) -> dict:
    """Tool schema for this format.

    Commander keeps the original bare-string `core_cards`. Constructed formats need
    counts, so items become `{name, count}` — `validate_spec` accepts both shapes,
    which is what keeps the Commander path byte-identical.
    """
    if spec is None or spec.requires_commander:
        return _SPEC_TOOL

    import copy

    tool = copy.deepcopy(_SPEC_TOOL)
    props = tool["input_schema"]["properties"]
    props["core_cards"] = {
        "type": "array",
        "description": (
            f"Cards to anchor the deck around, with how many copies to run. MUST be exact "
            f"names from the candidate list. `count` must not exceed that card's `copies` "
            f"value. Pick ~8-15 distinct cards; favor 3-4 copies of your best ones."
        ),
        "items": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "integer", "description": f"1-{spec.max_copies}"},
            },
            "required": ["name", "count"],
        },
    }
    props["colors"] = {
        "type": "array",
        "items": {"type": "string", "enum": ["W", "U", "B", "R", "G"]},
        "description": (
            f"The deck's colors, at most {spec.max_deck_colors}. Every core card must be "
            f"castable in these colors."
        ),
    }
    low, high = spec.land_range
    props["land_count"] = {
        "type": "integer",
        "description": f"Total lands ({low}-{high}), or omit for default.",
    }
    props.pop("avoid_combos", None)   # two-card infinite combos aren't a constructed concern
    return tool

_SYSTEM = (
    "You are an expert Magic: The Gathering Commander (EDH) deckbuilding assistant. "
    "Given a commander and a player's natural-language request, choose the core cards that "
    "anchor the deck's plan, and set high-level build knobs. Core cards MUST come only from "
    "the provided candidate list (these are the cards the player owns and can legally run). "
    "Prefer cards that directly serve the request's theme and gameplan; you don't need to fill "
    "the whole deck — the engine adds ramp, card draw, removal, lands, and synergy picks around "
    "your core. Respect explicit constraints (e.g. 'no infinite combos', a budget, an archetype). "
    "Always call submit_build_spec."
)


def _system_for(spec=None) -> str:
    if spec is None or spec.requires_commander:
        return _SYSTEM
    nonland = spec.deck_size - spec.default_land_count
    budget = max(4, int(nonland * 0.6))
    return (
        f"You are an expert Magic: The Gathering {spec.label} deckbuilding assistant. "
        f"Given a player's natural-language request, choose the core cards that anchor the "
        f"deck's plan, and set high-level build knobs. Core cards MUST come only from the "
        f"provided candidate list (these are the cards the player owns and can legally run). "
        f"\n\nFormat rules: {spec.deck_size}-card deck, no commander, no sideboard. You may "
        f"run up to {spec.max_copies} copies of a card, but never more than the `copies` value "
        f"shown for it — that's how many the player actually owns. Constructed decks win by "
        f"consistency, so prefer 4 copies of a few strong cards over singles of many. "
        f"\n\nSLOT BUDGET — this matters. The deck has roughly {nonland} non-land slots, and "
        f"your core_cards counts are copies, not cards: eight cards at 4 copies is 32 slots, "
        f"not 8. Keep the total across all core_cards at or under {budget} so the engine still "
        f"has room to add removal, card draw and curve filler around your plan. Exceeding it "
        f"produces a deck with no interaction. "
        f"\n\nPick the deck's colors yourself (at most {spec.max_deck_colors}) and return them "
        f"in `colors` — a second color needs a real reason, since every extra color costs mana "
        f"consistency. Only include cards castable in the colors you choose. "
        f"\n\nAlways call submit_build_spec."
    )


async def interpret_brief(
    commander: dict | None,
    brief: str,
    shortlist: list[dict],
    strategy_names: list[str],
    prior_spec: dict | None = None,
    spec=None,
) -> dict:
    """Call Claude and return the raw build-spec dict (validate separately).

    When ``prior_spec`` is given, this is a *refinement* of an existing build:
    Claude adjusts that spec per the new instruction and returns the full updated
    spec (keeping the deck's identity except where the instruction changes it).
    """
    settings = get_settings()
    if not settings.claude_api:
        raise BriefUnavailable("AI deck brief is not configured (no API key).")

    import json

    if prior_spec:
        instruction = (
            "This is a REFINEMENT of a deck you already built. Current build spec "
            "(core cards + knobs):\n"
            f"{json.dumps(prior_spec, ensure_ascii=False)}\n\n"
            f"The player now wants this change:\n{brief.strip()}\n\n"
            "Return the FULL updated build spec — keep the rest of the deck's identity, "
            "only changing what the request implies (e.g. adjust core_cards, quotas, "
            "avoid_combos, land_count, strategy, or theme as needed)."
        )
    else:
        instruction = f"Player's request:\n{brief.strip()}"

    header = (
        f"Commander: {commander['name']}\n{commander.get('oracle_text', '')}\n\n"
        if commander
        else f"Format: {spec.label if spec else 'Constructed'}\n\n"
    )
    user = (
        f"{header}"
        f"Available strategies: {', '.join(strategy_names)}\n\n"
        f"{instruction}\n\n"
        f"Candidate cards (choose core cards ONLY from these exact names):\n"
        f"{json.dumps(shortlist, ensure_ascii=False)}"
    )
    tool = _spec_tool(spec)
    body = {
        "model": settings.claude_model,
        "max_tokens": 1500,
        "system": _system_for(spec),
        "tools": [tool],
        "tool_choice": {"type": "tool", "name": "submit_build_spec"},
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "x-api-key": settings.claude_api,
        "anthropic-version": _ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(_API_URL, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise BriefError(f"Claude request failed: {exc}") from exc

    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "submit_build_spec":
            return block.get("input", {})
    raise BriefError("Claude did not return a build spec.")


_COLORS = {"W", "U", "B", "R", "G"}


def validate_spec(
    spec: dict,
    valid_card_names: set[str],
    strategy_names: set[str],
    fmt=None,
) -> dict:
    """Sanitize a raw spec: keep only real candidate cards + sane knobs (pure).

    Accepts `core_cards` as bare strings (Commander) or `{name, count}` objects
    (constructed). Both are normalized to a name->count map, with bare strings
    treated as 1 copy — so the Commander path is unchanged.
    """
    max_copies = fmt.max_copies if fmt else 1
    lower_valid = {n.lower(): n for n in valid_card_names}

    core: list[str] = []
    core_counts: dict[str, int] = {}
    for item in spec.get("core_cards", []) or []:
        if isinstance(item, dict):
            raw_name, raw_count = item.get("name"), item.get("count", 1)
        else:
            raw_name, raw_count = item, 1
        canon = lower_valid.get(str(raw_name).lower())
        if not canon or canon in core_counts:
            continue
        count = raw_count if isinstance(raw_count, int) else 1
        core.append(canon)
        core_counts[canon] = max(1, min(max_copies, count))

    # Enforce the slot budget rather than only asking for it in the prompt. A core
    # that fills every non-land slot leaves the generator no room for removal or
    # card draw, and the result is a deck with no interaction. Trim from the end,
    # since the model lists its most important picks first.
    if fmt and not fmt.requires_commander:
        budget = max(4, int((fmt.deck_size - fmt.default_land_count) * 0.6))
        running = 0
        trimmed: list[str] = []
        for name in core:
            take = min(core_counts[name], budget - running)
            if take < 1:
                break
            core_counts[name] = take
            trimmed.append(name)
            running += take
        for dropped in core[len(trimmed):]:
            core_counts.pop(dropped, None)
        core = trimmed

    strategy = spec.get("strategy")
    if strategy not in strategy_names:
        strategy = None

    quotas = {}
    for role, val in (spec.get("quota_overrides") or {}).items():
        if role in _QUOTA_ROLES and isinstance(val, int):
            quotas[role] = max(0, min(20, val))

    low, high = fmt.land_range if fmt else (30, 42)
    land_count = spec.get("land_count")
    if not isinstance(land_count, int) or not (low <= land_count <= high):
        land_count = None

    colors = [c for c in (spec.get("colors") or []) if c in _COLORS]
    if fmt:
        colors = colors[: fmt.max_deck_colors]

    return {
        "core_cards": core,
        "core_counts": core_counts,
        "colors": colors,
        "strategy": strategy,
        "theme": (spec.get("theme") or "").strip() or None,
        "quota_overrides": quotas,
        "avoid_combos": bool(spec.get("avoid_combos", False)),
        "land_count": land_count,
        "rationale": (spec.get("rationale") or "").strip(),
    }
