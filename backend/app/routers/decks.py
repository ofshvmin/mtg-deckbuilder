"""Deck generation endpoint (Phase 3)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import (
    CardSummary,
    CurveBucket,
    DeckCardOut,
    GeneratedDeckResponse,
)
from ..services import generator
from ..services import pool as pool_service
from ..util import normalize_name

router = APIRouter(prefix="/decks", tags=["decks"])


class GenerateRequest(BaseModel):
    commander: str
    land_count: int | None = None
    quotas: dict[str, int] | None = None


async def _basics_by_color(database) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for color, name in generator.BASIC_FOR_COLOR.items():
        doc = await database.cards.find_one({"name_normalized": normalize_name(name)})
        if doc:
            result[color] = doc
    return result


@router.post("/generate", response_model=GeneratedDeckResponse)
async def generate_deck(body: GenerateRequest, current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    try:
        result = await pool_service.get_pool(database, current_user["_id"], body.commander)
    except pool_service.CommanderNotFound as e:
        detail = f"No card found matching '{e.name}'."
        if e.suggestions:
            detail += " Did you mean: " + ", ".join(e.suggestions[:5])
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail)

    basics = await _basics_by_color(database)
    deck = generator.generate(
        result.commander,
        result.pool,
        result.color_identity,
        basics,
        land_count=body.land_count or generator.DEFAULT_LAND_COUNT,
        quotas=body.quotas,
    )

    c = result.commander
    return GeneratedDeckResponse(
        commander=CardSummary(
            oracle_id=c["_id"],
            name=c["name"],
            mana_cost=c.get("mana_cost", ""),
            cmc=c.get("cmc", 0.0),
            type_line=c.get("type_line", ""),
            color_identity=c.get("color_identity", []),
            oracle_text=c.get("oracle_text", ""),
        ),
        color_identity=result.color_identity,
        total=sum(dc.count for dc in deck.cards),
        land_count=deck.land_count,
        nonland_count=deck.nonland_count,
        role_counts=deck.role_counts,
        curve=[CurveBucket(**b) for b in deck.curve],
        color_sources=deck.color_sources,
        stats=deck.stats,
        warnings=deck.warnings,
        cards=[
            DeckCardOut(
                oracle_id=dc.oracle_id,
                name=dc.name,
                mana_cost=dc.mana_cost,
                cmc=dc.cmc,
                type_line=dc.type_line,
                color_identity=dc.color_identity,
                roles=dc.roles,
                slot=dc.slot,
                reason=dc.reason,
                count=dc.count,
            )
            for dc in deck.cards
        ],
    )
