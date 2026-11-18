"""Analyze & upgrade, step 2: Claude judges the deterministic candidates.

Claude sees the deck, its shape against the strategy, and two keyed candidate
lists — cards it could cut, cards it could add (owned, and to buy, with prices) —
and returns a short verdict plus swaps that refer to those keys only. The router
validates every swap (`deck_analysis.validate_swaps`) before showing it, so a
garbled or invented answer is dropped rather than shown.
"""
from __future__ import annotations

import json

import httpx

from ..config import get_settings
from .ai_brief import _ANTHROPIC_VERSION, _API_URL, BriefError, BriefUnavailable

# Same failure modes as the brief: no key configured, or the call failed.
AnalysisUnavailable = BriefUnavailable
AnalysisError = BriefError

_TOOL = {
    "name": "submit_analysis",
    "description": "Submit the deck verdict and the recommended swaps.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {
                "type": "string",
                "description": "2-3 sentences: what the deck does well and where it's weakest.",
            },
            "swaps": {
                "type": "array",
                "maxItems": 10,
                "items": {
                    "type": "object",
                    "properties": {
                        "cut": {"type": "string", "description": "A key from the CUT list."},
                        "add": {"type": "string", "description": "A key from an ADD list."},
                        "count": {"type": "integer", "minimum": 1, "description": "Copies to swap."},
                        "reason": {"type": "string", "description": "One short sentence."},
                    },
                    "required": ["cut", "add", "count", "reason"],
                },
            },
        },
        "required": ["verdict", "swaps"],
    },
}

_SYSTEM = (
    "You are an expert Magic: The Gathering deckbuilder reviewing a player's deck. "
    "Recommend the swaps that most improve it: each swap cuts a card from the CUT list "
    "and adds one from an ADD list, the same number of copies, so the deck size holds. "
    "Use ONLY the keys given. Prefer swaps from the player's own collection (OWNED) "
    "when they're nearly as good as a card to buy. Keep the deck's plan and strategy; "
    "fix its weak spots (missing roles, a crowded or thin mana curve, weak cards). "
    "Never cut a card marked as a combo piece unless the add is clearly better. "
    "Suggest between 3 and 10 swaps, best first. Reasons are one plain sentence."
)


async def judge(
    *,
    format_label: str,
    commander: dict | None,
    strategy: str,
    deck_list: list[str],
    shape: dict,
    combos: list[str],
    cuts: list[dict],
    owned_adds: list[dict],
    buy_adds: list[dict],
    budget: float | None,
) -> dict:
    """Call Claude; returns the raw tool input ({verdict, swaps}) — validate separately."""
    settings = get_settings()
    if not settings.claude_api:
        raise AnalysisUnavailable("Deck analysis is not configured (no API key).")

    header = f"Format: {format_label}\nStrategy: {strategy}\n"
    if commander:
        header += f"Commander: {commander['name']}\n{commander.get('oracle_text', '')}\n"
    if budget is not None:
        header += f"Budget: at most ${budget:.2f} per card bought.\n"
    user = (
        f"{header}\n"
        f"Deck list:\n{chr(10).join(deck_list)}\n\n"
        "Deck shape — roles as [have, want], curve by mana value as [have, target]:\n"
        f"{json.dumps(shape)}\n\n"
        f"Combos in the deck: {json.dumps(combos) if combos else 'none'}\n\n"
        f"CUT (cards in the deck, weakest first):\n{json.dumps(cuts, ensure_ascii=False)}\n\n"
        f"ADD — OWNED (in the player's collection, free):\n{json.dumps(owned_adds, ensure_ascii=False)}\n\n"
        f"ADD — BUY (not owned; price in USD):\n{json.dumps(buy_adds, ensure_ascii=False)}"
    )
    body = {
        "model": settings.claude_model,
        "max_tokens": 1500,
        "system": _SYSTEM,
        "tools": [_TOOL],
        "tool_choice": {"type": "tool", "name": "submit_analysis"},
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
        raise AnalysisError(f"Claude request failed: {exc}") from exc

    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "submit_analysis":
            return block.get("input", {})
    raise AnalysisError("Claude did not return an analysis.")
