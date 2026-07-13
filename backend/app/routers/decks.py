"""Deck generation and saved-deck management endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel

from .. import db
from ..auth.deps import get_current_user
from ..config import get_settings
from ..models.responses import (
    BracketOut,
    BracketSignal,
    BriefDeckResponse,
    BriefSpecOut,
    CardSummary,
    ComboFinisher,
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
from ..services import ai_brief, brackets, csv_formats, edhrec, generator
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

    # Add jitter when regenerating (locked cards present) so the unlocked
    # slots get different picks each time. 0.8 is enough to shuffle the
    # mid-tier cards without overriding strong role/synergy signals.
    use_jitter = 0.8 if locked_ids else 0.0

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
        jitter=use_jitter,
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

    pool_by_id = {card["_id"]: card for card in result.pool}
    bracket = await _estimate_bracket(database, result.commander, deck, deck_combos, pool_by_id)

    return _deck_response(
        result.commander, result.color_identity, deck, edhrec_available,
        deck_combos, pool_near, bracket,
    )


class BriefRequest(BaseModel):
    commander: str
    brief: str


@router.post("/brief", response_model=BriefDeckResponse)
async def brief_deck(body: BriefRequest, current_user: dict = Depends(get_current_user)):
    """Interpret a natural-language deck request with Claude, then build the deck.

    Claude selects core cards from the owned pool + build knobs; the generator
    builds a legal, curved, synergy/combo-layered deck around that core.
    """
    if not get_settings().claude_api:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI deck brief isn't configured on this server yet.",
        )
    brief = body.brief.strip()
    if not brief:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Describe the deck you want to build.")

    database = db.get_db()
    try:
        result = await pool_service.get_pool(database, current_user["_id"], body.commander)
    except pool_service.CommanderNotFound as e:
        detail = f"No card found matching '{e.name}'."
        if e.suggestions:
            detail += " Did you mean: " + ", ".join(e.suggestions[:5])
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail)

    basics = await _basics_by_color(database)
    score_map = await edhrec.get_score_map(database, result.commander)
    quality = {c["_id"]: score_map.get(c["name_normalized"], 0.0) for c in result.pool}
    edhrec_available = any(v > 0 for v in quality.values())

    pool_ids = {c["_id"] for c in result.pool} | {result.commander["_id"]}
    pool_full, pool_near = await spellbook.detect(database, pool_ids, result.color_identity)
    combo_pieces = {oid for combo in pool_full for oid in combo["cards"]}

    # Ask Claude for a build spec, then sanitize it.
    shortlist = ai_brief.build_shortlist(result.pool, quality, combo_pieces)
    strat_names = [s["name"] for s in strategies.list_strategies()]
    try:
        raw_spec = await ai_brief.interpret_brief(result.commander, brief, shortlist, strat_names)
    except ai_brief.BriefUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except ai_brief.BriefError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI deck brief failed: {e}")

    spec = ai_brief.validate_spec(
        raw_spec, {c["name"] for c in result.pool}, set(strat_names)
    )

    # Resolve core card names to owned oracle_ids.
    name_to_id = {normalize_name(c["name"]): c["_id"] for c in result.pool}
    core_ids = {
        name_to_id[normalize_name(n)] for n in spec["core_cards"] if normalize_name(n) in name_to_id
    }

    strat = strategies.get_strategy(spec["strategy"]) if spec["strategy"] else None
    theme_matches = themes.compute_theme_matches(result.pool, spec["theme"])

    deck = generator.generate(
        result.commander,
        result.pool,
        result.color_identity,
        basics,
        land_count=spec["land_count"],
        quotas=spec["quota_overrides"] or None,
        quality=quality,
        combo_pieces=set() if spec["avoid_combos"] else combo_pieces,
        printings=result.printings,
        strategy=strat if spec["strategy"] else None,
        theme_matches=theme_matches,
        locked_ids=core_ids,
        avoid_combos=spec["avoid_combos"],
    )
    deck.theme = spec["theme"]
    if not edhrec_available:
        deck.warnings.append(
            "EDHREC data unavailable for this commander — ranked by curve and role fit only."
        )

    deck_ids = {dc.oracle_id for dc in deck.cards} | {result.commander["_id"]}
    deck_combos = [c for c in pool_full if set(c["cards"]) <= deck_ids]
    pool_by_id = {c["_id"]: c for c in result.pool}
    bracket = await _estimate_bracket(database, result.commander, deck, deck_combos, pool_by_id)
    deck_resp = _deck_response(
        result.commander, result.color_identity, deck, edhrec_available,
        deck_combos, pool_near, bracket,
    )

    core_summaries = [
        CardSummary(
            oracle_id=pool_by_id[oid]["_id"],
            name=pool_by_id[oid]["name"],
            mana_cost=pool_by_id[oid].get("mana_cost", ""),
            cmc=pool_by_id[oid].get("cmc", 0.0),
            type_line=pool_by_id[oid].get("type_line", ""),
            color_identity=pool_by_id[oid].get("color_identity", []),
            oracle_text=pool_by_id[oid].get("oracle_text", ""),
        )
        for oid in core_ids
        if oid in deck_ids and oid in pool_by_id
    ]

    return BriefDeckResponse(
        deck=deck_resp,
        rationale=spec["rationale"],
        core_cards=core_summaries,
        spec=BriefSpecOut(
            strategy=spec["strategy"],
            theme=spec["theme"],
            avoid_combos=spec["avoid_combos"],
            land_count=spec["land_count"],
            quota_overrides=spec["quota_overrides"],
        ),
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

    bracket = await _estimate_bracket(database, result.commander, deck, deck_combos, pool_by_id)

    return _deck_response(
        result.commander, result.color_identity, deck, edhrec_available,
        deck_combos, near_combos, bracket,
    )


class ComboFinishRequest(BaseModel):
    commander: str
    oracle_ids: list[str]


def _build_finishers(
    finishers: list[dict],
    docs_by_id: dict[str, dict],
    owned_ids: set[str],
    commander_id: str,
    limit: int,
) -> list[ComboFinisher]:
    """Enrich + rank combo finishers (pure): owned first, then by combos/popularity."""
    out: list[ComboFinisher] = []
    for f in finishers:
        oid = f["oracle_id"]
        doc = docs_by_id.get(oid)
        if oid == commander_id or doc is None:
            continue
        combos = f["combos"]
        out.append(
            ComboFinisher(
                oracle_id=oid,
                name=doc["name"],
                mana_cost=doc.get("mana_cost", ""),
                cmc=doc.get("cmc", 0.0),
                type_line=doc.get("type_line", ""),
                color_identity=doc.get("color_identity", []),
                owned=oid in owned_ids,
                combo_count=f["combo_count"],
                popularity=f["popularity"],
                produces=combos[0].get("produces", []) if combos else [],
                combos=[
                    ComboOut(
                        id=c["_id"],
                        cards=c.get("card_names", []),
                        produces=c.get("produces", []),
                        popularity=c.get("popularity", 0),
                        missing_name=doc["name"],
                    )
                    for c in combos[:5]
                ],
            )
        )
    # Owned finishers first (addable now), then most combos, then most popular.
    out.sort(key=lambda r: (not r.owned, -r.combo_count, -r.popularity))
    return out[:limit]


@router.post("/combo-finishers", response_model=list[ComboFinisher])
async def combo_finishers(body: ComboFinishRequest, current_user: dict = Depends(get_current_user)):
    """Cards that would complete a combo with the current deck's cards.

    Owned finishers can be added immediately; unowned ones are acquisition
    suggestions. Prices are fetched client-side (and later gated by a max-price
    preference, which only applies to unowned cards).
    """
    database = db.get_db()
    try:
        result = await pool_service.get_pool(database, current_user["_id"], body.commander)
    except pool_service.CommanderNotFound as e:
        detail = f"No card found matching '{e.name}'."
        if e.suggestions:
            detail += " Did you mean: " + ", ".join(e.suggestions[:5])
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail)

    deck_ids = set(body.oracle_ids) | {result.commander["_id"]}
    finishers = await spellbook.combo_finishers(database, deck_ids, result.color_identity)
    if not finishers:
        return []

    docs_by_id: dict[str, dict] = {}
    cursor = database.cards.find({"_id": {"$in": [f["oracle_id"] for f in finishers]}})
    async for doc in cursor:
        docs_by_id[doc["_id"]] = doc

    owned = await collection_repo.owned_counts(database, current_user["_id"])
    return _build_finishers(finishers, docs_by_id, set(owned), result.commander["_id"], limit=30)


async def _estimate_bracket(
    database, commander: dict, deck, deck_combos: list[dict], pool_by_id: dict[str, dict]
) -> BracketOut:
    """Estimate the WOTC bracket from the deck's full card docs + its combos."""
    deck_docs = [pool_by_id[dc.oracle_id] for dc in deck.cards if dc.oracle_id in pool_by_id]
    deck_docs.append(commander)
    gc_ids = await brackets.game_changer_ids(database)
    res = brackets.estimate(deck_docs, deck_combos, gc_ids)
    return BracketOut(
        bracket=res.bracket,
        label=res.label,
        explanation=res.explanation,
        signals=[
            BracketSignal(key=s.key, label=s.label, count=s.count, cards=s.cards)
            for s in res.signals
        ],
        caveat=res.caveat,
    )


def _deck_response(
    commander: dict,
    identity: list[str],
    deck,  # generator.GeneratedDeck
    edhrec_available: bool,
    deck_combos: list[dict],
    near_combos: list[dict],
    bracket: BracketOut | None = None,
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
        bracket=bracket,
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
    deck_id = await decks_repo.save_deck(
        database, current_user["_id"], name, deck_data,
        source=body.source, source_url=body.source_url,
    )
    saved = await decks_repo.get_deck(database, current_user["_id"], deck_id)
    return SavedDeckResponse(
        id=saved["_id"],
        name=saved["name"],
        deck=saved["deck"],
        created_at=saved["created_at"],
        updated_at=saved["updated_at"],
        source=saved.get("source"),
        source_url=saved.get("source_url"),
    )


@router.get("/saved", response_model=list[SavedDeckSummary])
async def list_saved_decks(current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    docs = await decks_repo.list_decks(database, current_user["_id"])
    summaries = []
    for doc in docs:
        b = doc["deck"].get("bracket") or {}
        summaries.append(
            SavedDeckSummary(
                id=doc["_id"],
                name=doc["name"],
                commander_name=doc["deck"].get("commander", {}).get("name", "Unknown"),
                color_identity=doc["deck"].get("color_identity", []),
                total=doc["deck"].get("total", 0),
                created_at=doc["created_at"],
                updated_at=doc["updated_at"],
                bracket=b.get("bracket"),
                bracket_label=b.get("label"),
                source=doc.get("source"),
            )
        )
    return summaries


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
        source=doc.get("source"),
        source_url=doc.get("source_url"),
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
