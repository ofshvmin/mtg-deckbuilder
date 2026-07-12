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


def build_shortlist(
    pool: list[dict],
    quality: dict[str, float],
    combo_pieces: set[str],
    limit: int = 200,
) -> list[dict]:
    """The strongest candidate cards for Claude to choose a core from.

    Ranked by EDHREC quality (staples + commander-synergy first). The generator's
    theme bias still pulls the long tail, so this only needs the notable cards.
    """
    ranked = sorted(pool, key=lambda c: -quality.get(c["_id"], 0.0))
    out: list[dict] = []
    for c in ranked[:limit]:
        out.append(
            {
                "name": c["name"],
                "type": c.get("type_line", ""),
                "cmc": c.get("cmc", 0),
                "roles": sorted(roles.tag_roles(c)),
                "combo": c["_id"] in combo_pieces,
                "text": _short_oracle(c.get("oracle_text", "")),
            }
        )
    return out


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


async def interpret_brief(
    commander: dict, brief: str, shortlist: list[dict], strategy_names: list[str]
) -> dict:
    """Call Claude and return the raw build-spec dict (validate separately)."""
    settings = get_settings()
    if not settings.claude_api:
        raise BriefUnavailable("AI deck brief is not configured (no API key).")

    import json

    user = (
        f"Commander: {commander['name']}\n"
        f"{commander.get('oracle_text', '')}\n\n"
        f"Available strategies: {', '.join(strategy_names)}\n\n"
        f"Player's request:\n{brief.strip()}\n\n"
        f"Candidate cards (choose core cards ONLY from these exact names):\n"
        f"{json.dumps(shortlist, ensure_ascii=False)}"
    )
    body = {
        "model": settings.claude_model,
        "max_tokens": 1500,
        "system": _SYSTEM,
        "tools": [_SPEC_TOOL],
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


def validate_spec(
    spec: dict, valid_card_names: set[str], strategy_names: set[str]
) -> dict:
    """Sanitize a raw spec: keep only real candidate cards + sane knobs (pure)."""
    lower_valid = {n.lower(): n for n in valid_card_names}
    core = []
    for name in spec.get("core_cards", []) or []:
        canon = lower_valid.get(str(name).lower())
        if canon and canon not in core:
            core.append(canon)

    strategy = spec.get("strategy")
    if strategy not in strategy_names:
        strategy = None

    quotas = {}
    for role, val in (spec.get("quota_overrides") or {}).items():
        if role in _QUOTA_ROLES and isinstance(val, int):
            quotas[role] = max(0, min(20, val))

    land_count = spec.get("land_count")
    if not isinstance(land_count, int) or not (30 <= land_count <= 42):
        land_count = None

    return {
        "core_cards": core,
        "strategy": strategy,
        "theme": (spec.get("theme") or "").strip() or None,
        "quota_overrides": quotas,
        "avoid_combos": bool(spec.get("avoid_combos", False)),
        "land_count": land_count,
        "rationale": (spec.get("rationale") or "").strip(),
    }
