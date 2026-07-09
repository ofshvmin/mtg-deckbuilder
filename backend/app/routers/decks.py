"""Deck generation and saved-deck management endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import (
    CardSummary,
    ComboOut,
    CurveBucket,
    DeckCardOut,
    GeneratedDeckResponse,
    SaveDeckRequest,
    SavedDeckResponse,
    SavedDeckSummary,
)
from ..repositories import decks as decks_repo
from ..services import edhrec, generator
from ..services import pool as pool_service
from ..services import spellbook
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

    # EDHREC quality signal: name-match the commander's recommended cards to the
    # user's pool, keyed by oracle_id. Empty if EDHREC is unavailable.
    score_map = await edhrec.get_score_map(database, result.commander)
    quality = {
        card["_id"]: score_map.get(card["name_normalized"], 0.0) for card in result.pool
    }
    edhrec_available = any(v > 0 for v in quality.values())

    # Commander Spellbook: combos assemblable from the pool (incl. the commander).
    pool_ids = {card["_id"] for card in result.pool} | {result.commander["_id"]}
    pool_full, pool_near = await spellbook.detect(database, pool_ids, result.color_identity)
    combo_pieces = {oid for combo in pool_full for oid in combo["cards"]}

    deck = generator.generate(
        result.commander,
        result.pool,
        result.color_identity,
        basics,
        land_count=body.land_count or generator.DEFAULT_LAND_COUNT,
        quotas=body.quotas,
        quality=quality,
        combo_pieces=combo_pieces,
    )
    if not edhrec_available:
        deck.warnings.append(
            "EDHREC data unavailable for this commander — ranked by curve and role fit only."
        )

    # Which of the pool's combos actually assembled in the final deck?
    deck_ids = {dc.oracle_id for dc in deck.cards} | {result.commander["_id"]}
    deck_combos = [c for c in pool_full if set(c["cards"]) <= deck_ids]
    combo_card_ids = {oid for combo in deck_combos for oid in combo["cards"]}

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
        edhrec_available=edhrec_available,
        combos=[_combo_out(c) for c in deck_combos],
        near_combos=[_combo_out(c) for c in pool_near],
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
                quality=dc.quality,
                in_combo=dc.oracle_id in combo_card_ids,
            )
            for dc in deck.cards
        ],
    )


def _combo_out(combo: dict) -> ComboOut:
    return ComboOut(
        id=combo["_id"],
        cards=combo.get("card_names", []),
        produces=combo.get("produces", []),
        popularity=combo.get("popularity", 0),
        missing_name=combo.get("missing_name"),
    )


# ---- Saved decks ----


@router.post("/save", response_model=SavedDeckResponse, status_code=status.HTTP_201_CREATED)
async def save_deck(body: SaveDeckRequest, current_user: dict = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Deck name cannot be empty.")
    database = db.get_db()
    deck_data = body.deck.model_dump()
    deck_id = await decks_repo.save_deck(database, current_user["_id"], name, deck_data)
    saved = await decks_repo.get_deck(database, current_user["_id"], deck_id)
    return SavedDeckResponse(
        id=saved["_id"],
        name=saved["name"],
        deck=saved["deck"],
        created_at=saved["created_at"],
        updated_at=saved["updated_at"],
    )


@router.get("/saved", response_model=list[SavedDeckSummary])
async def list_saved_decks(current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    docs = await decks_repo.list_decks(database, current_user["_id"])
    return [
        SavedDeckSummary(
            id=doc["_id"],
            name=doc["name"],
            commander_name=doc["deck"].get("commander", {}).get("name", "Unknown"),
            color_identity=doc["deck"].get("color_identity", []),
            total=doc["deck"].get("total", 0),
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
        )
        for doc in docs
    ]


@router.get("/saved/{deck_id}", response_model=SavedDeckResponse)
async def get_saved_deck(deck_id: str, current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    doc = await decks_repo.get_deck(database, current_user["_id"], deck_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")
    return SavedDeckResponse(
        id=doc["_id"],
        name=doc["name"],
        deck=doc["deck"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


@router.delete("/saved/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_deck(deck_id: str, current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    deleted = await decks_repo.delete_deck(database, current_user["_id"], deck_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")
