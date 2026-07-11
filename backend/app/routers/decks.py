"""Deck generation and saved-deck management endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import (
    CardSummary,
    ComboOut,
    CurveBucket,
    DeckCardOut,
    GeneratedDeckResponse,
    PrintingOut,
    SaveDeckRequest,
    SavedDeckResponse,
    SavedDeckSummary,
    UpdateDeckRequest,
    UpgradeSuggestion,
)
from ..repositories import collection as collection_repo
from ..repositories import decks as decks_repo
from ..services import csv_formats, edhrec, generator
from ..services import pool as pool_service
from ..services import roles as roles_service
from ..services import spellbook, strategies, themes
from ..util import normalize_name

router = APIRouter(prefix="/decks", tags=["decks"])


class GenerateRequest(BaseModel):
    commander: str
    land_count: int | None = None
    quotas: dict[str, int] | None = None
    strategy: str | None = None
    theme: str | None = None
    locked: list[str] | None = None   # oracle_ids to keep and build around


async def _basics_by_color(database) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for color, name in generator.BASIC_FOR_COLOR.items():
        doc = await database.cards.find_one({"name_normalized": normalize_name(name)})
        if doc:
            result[color] = doc
    return result


@router.get("/strategies")
async def list_strategies():
    return strategies.list_strategies()


_ROLE_LABELS = {
    "ramp": "Ramp",
    "card_draw": "Card draw",
    "removal": "Removal",
    "board_wipe": "Board wipe",
    "counterspell": "Counterspell",
    "protection": "Protection",
    "tutor": "Tutor",
}


def _upgrade_reason(synergy: float, roles: list[str]) -> str:
    """Short human explanation of why a card is suggested."""
    if synergy >= 0.3:
        base = "High synergy with this commander"
    elif synergy > 0:
        base = "Often played with this commander"
    else:
        base = "Popular staple"
    label = next((_ROLE_LABELS[r] for r in roles if r in _ROLE_LABELS), None)
    return f"{base} · {label}" if label else base


def _build_upgrades(
    scored: list[dict],
    docs: list[dict],
    owned_ids: set[str],
    identity: set[str],
    limit: int,
) -> list[UpgradeSuggestion]:
    """Pure ranking step (no DB): EDHREC recs the user lacks, in-identity, top N.

    ``scored`` is edhrec.get_scored_cards output; ``docs`` are the matching card
    documents looked up by normalized name.
    """
    by_name = {c["n"]: c for c in scored}
    out: list[UpgradeSuggestion] = []
    for doc in docs:
        oid = doc["_id"]
        if oid in owned_ids or doc.get("is_basic_land"):
            continue
        if not set(doc.get("color_identity", [])) <= identity:
            continue
        entry = by_name.get(doc["name_normalized"])
        if entry is None:
            continue
        roles = sorted(roles_service.tag_roles(doc))
        synergy = float(entry.get("syn", 0.0))
        out.append(
            UpgradeSuggestion(
                oracle_id=oid,
                name=doc["name"],
                mana_cost=doc.get("mana_cost", ""),
                cmc=doc.get("cmc", 0.0),
                type_line=doc.get("type_line", ""),
                color_identity=doc.get("color_identity", []),
                roles=roles,
                synergy=synergy,
                score=float(entry.get("s", 0.0)),
                reason=_upgrade_reason(synergy, roles),
            )
        )
    out.sort(key=lambda s: s.score, reverse=True)
    return out[:limit]


@router.get("/upgrades", response_model=list[UpgradeSuggestion])
async def deck_upgrades(
    commander: str = Query(...),
    limit: int = Query(40, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Cards the user doesn't own that EDHREC recommends for this commander.

    Powers budget-upgrade suggestions. Excludes owned cards and the commander,
    keeps only cards inside the commander's color identity, and ranks by EDHREC
    quality score. Prices/images are fetched client-side.
    """
    database = db.get_db()
    try:
        result = await pool_service.get_pool(database, current_user["_id"], commander)
    except pool_service.CommanderNotFound as e:
        detail = f"No card found matching '{e.name}'."
        if e.suggestions:
            detail += " Did you mean: " + ", ".join(e.suggestions[:5])
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail)

    scored = await edhrec.get_scored_cards(database, result.commander)
    if not scored:
        return []

    owned = await collection_repo.owned_counts(database, current_user["_id"])
    owned_ids = set(owned) | {result.commander["_id"]}
    identity = set(result.color_identity)

    names = [c["n"] for c in scored]
    docs: list[dict] = []
    cursor = database.cards.find({"name_normalized": {"$in": names}})
    async for doc in cursor:
        docs.append(doc)

    return _build_upgrades(scored, docs, owned_ids, identity, limit)


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

    # Resolve strategy and theme
    strat = strategies.get_strategy(body.strategy)
    theme_matches = themes.compute_theme_matches(result.pool, body.theme)

    # Locked cards to keep and build around (only those actually in the pool).
    pool_id_set = {card["_id"] for card in result.pool}
    locked_ids = {oid for oid in (body.locked or []) if oid in pool_id_set}

    deck = generator.generate(
        result.commander,
        result.pool,
        result.color_identity,
        basics,
        land_count=body.land_count,
        quotas=body.quotas,
        quality=quality,
        combo_pieces=combo_pieces,
        printings=result.printings,
        strategy=strat if body.strategy else None,
        theme_matches=theme_matches,
        locked_ids=locked_ids,
    )
    # Attach theme string so frontend can display it
    deck.theme = body.theme if body.theme and body.theme.strip() else None

    if not edhrec_available:
        deck.warnings.append(
            "EDHREC data unavailable for this commander — ranked by curve and role fit only."
        )
    if theme_matches is not None and len(theme_matches) == 0:
        deck.warnings.append(
            f"No cards in your pool matched the '{body.theme}' theme — deck built without theme bias."
        )

    # Which of the pool's combos actually assembled in the final deck?
    deck_ids = {dc.oracle_id for dc in deck.cards} | {result.commander["_id"]}
    deck_combos = [c for c in pool_full if set(c["cards"]) <= deck_ids]

    return _deck_response(
        result.commander, result.color_identity, deck, edhrec_available, deck_combos, pool_near
    )


class ComposeRequest(BaseModel):
    commander: str
    oracle_ids: list[str]


@router.post("/compose", response_model=GeneratedDeckResponse)
async def compose_deck(body: ComposeRequest, current_user: dict = Depends(get_current_user)):
    """Analyze an exact user-chosen card list into the deck shape (categories +
    stats), for the manual builder. Same rendering as an auto-built deck."""
    database = db.get_db()
    try:
        result = await pool_service.get_pool(database, current_user["_id"], body.commander)
    except pool_service.CommanderNotFound as e:
        detail = f"No card found matching '{e.name}'."
        if e.suggestions:
            detail += " Did you mean: " + ", ".join(e.suggestions[:5])
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail)

    # Keep only ids that are actually in this commander's legal owned pool.
    pool_by_id = {card["_id"]: card for card in result.pool}
    chosen_docs = [pool_by_id[oid] for oid in body.oracle_ids if oid in pool_by_id]

    score_map = await edhrec.get_score_map(database, result.commander)
    quality = {card["_id"]: score_map.get(card["name_normalized"], 0.0) for card in result.pool}
    edhrec_available = any(v > 0 for v in quality.values())

    deck = generator.compose(
        chosen_docs, result.color_identity, quality=quality, printings=result.printings
    )

    # Combos present in the current deck, plus combos it's one card away from.
    deck_ids = {dc.oracle_id for dc in deck.cards} | {result.commander["_id"]}
    deck_combos, near_combos = await spellbook.detect(database, deck_ids, result.color_identity)

    return _deck_response(
        result.commander, result.color_identity, deck, edhrec_available, deck_combos, near_combos
    )


def _deck_response(
    commander: dict,
    identity: list[str],
    deck,  # generator.GeneratedDeck
    edhrec_available: bool,
    deck_combos: list[dict],
    near_combos: list[dict],
) -> GeneratedDeckResponse:
    """Assemble a GeneratedDeckResponse from a computed deck (shared by generate + compose)."""
    combo_card_ids = {oid for combo in deck_combos for oid in combo["cards"]}
    return GeneratedDeckResponse(
        commander=CardSummary(
            oracle_id=commander["_id"],
            name=commander["name"],
            mana_cost=commander.get("mana_cost", ""),
            cmc=commander.get("cmc", 0.0),
            type_line=commander.get("type_line", ""),
            color_identity=commander.get("color_identity", []),
            oracle_text=commander.get("oracle_text", ""),
        ),
        color_identity=identity,
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
        near_combos=[_combo_out(c) for c in near_combos],
        strategy=deck.strategy,
        theme=deck.theme,
        theme_count=deck.theme_count,
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
                printings=[PrintingOut(**p) for p in dc.printings],
                selected_printing_key=dc.selected_printing_key,
            )
            for dc in deck.cards
        ],
    )


def _selected_printing(card: dict) -> dict | None:
    """The owned printing a deck card earmarks, for export as a pull-list.

    Prefers the card's ``selected_printing_key``; falls back to the first owned
    printing. Returns None for cards with no owned printing (e.g. basics), which
    export with blank edition/collector-number columns.
    """
    prints = card.get("printings") or []
    if not prints:
        return None
    key = card.get("selected_printing_key")
    return next((p for p in prints if p.get("printing_key") == key), prints[0])


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


@router.put("/saved/{deck_id}", response_model=SavedDeckResponse)
async def update_saved_deck(
    deck_id: str, body: UpdateDeckRequest, current_user: dict = Depends(get_current_user),
):
    database = db.get_db()
    deck_data = body.deck.model_dump() if body.deck else None
    name = body.name.strip() if body.name else None
    doc = await decks_repo.update_deck(
        database, current_user["_id"], deck_id, name=name, deck_data=deck_data,
    )
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


@router.get("/saved/{deck_id}/export")
async def export_saved_deck(
    deck_id: str,
    format: str = Query("Moxfield"),
    current_user: dict = Depends(get_current_user),
):
    fmt = csv_formats.get_format_by_name(format)
    if not fmt:
        supported = ", ".join(f.name for f in csv_formats.FORMATS)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown format '{format}'. Supported: {supported}")

    database = db.get_db()
    doc = await decks_repo.get_deck(database, current_user["_id"], deck_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")

    cards = doc["deck"].get("cards", [])
    rows = []
    for c in cards:
        p = _selected_printing(c)
        rows.append({
            "name": c["name"],
            "count": str(c.get("count", 1)),
            "edition": (p.get("edition") or "") if p else "",
            "collector_number": (p.get("collector_number") or "") if p else "",
            "foil": "foil" if (p and p.get("finish") == "foil") else "",
        })
    csv_text = csv_formats.export_rows_csv(rows, fmt)

    safe_name = doc["name"].replace(" ", "-").replace('"', "")
    filename = f"{safe_name}-{fmt.name.lower().replace(' ', '-')}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
