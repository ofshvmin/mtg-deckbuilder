"""Deck generation and saved-deck management endpoints."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel

from .. import db
from ..auth.deps import get_current_user, require_premium
from ..config import get_settings
from ..models.responses import (
    BracketOut,
    BracketSignal,
    BriefDeckResponse,
    BriefSpecOut,
    CardSummary,
    ColorAlternate,
    ColorRationale,
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
    AnalysisCard,
    AnalysisResponse,
    AnalysisSwap,
)
from ..repositories import card_prints as card_prints_repo
from ..repositories import cards as cards_repo
from ..repositories import collection as collection_repo
from ..repositories import decks as decks_repo
from ..repositories import users as users_repo
from ..services import ai_brief, ai_upgrade, availability, deck_analysis, brackets, color_select, csv_formats, edhrec, formats, generator
from ..services import card_choice as card_choice_service
from ..services import pool as pool_service
from ..services import roles as roles_service
from ..services import spellbook, strategies, themes
from ..util import card_castable_in, normalize_name

router = APIRouter(prefix="/decks", tags=["decks"])


class PoolScopeMixin(BaseModel):
    """The slice of the collection a build may draw on.

    Defaults reproduce the old behavior exactly — everything you own, from every
    set — so clients that don't know about pool scoping are unaffected.
    """
    pool_scope: str = "owned"                 # "owned" | "available"
    sets: list[str] | None = None             # set codes to narrow the pool to
    # When rebuilding an in-use deck, the deck's own copies must read as free or
    # it would be unable to keep any of its cards.
    exclude_deck_id: str | None = None


class GenerateRequest(PoolScopeMixin):
    # Optional because non-Commander formats have none. `format` defaulting to
    # "commander" is what keeps every pre-format client working unchanged.
    commander: str | None = None
    format: str = "commander"
    colors: list[str] | None = None      # user-locked colors; None/[] => auto
    auto_fill_colors: bool = True        # fill remaining colors around the locks
    land_count: int | None = None
    quotas: dict[str, int] | None = None
    strategy: str | None = None
    theme: str | None = None
    locked: list[str] | None = None   # oracle_ids to keep and build around
    # Staples / Balanced / Hidden gems. Missing = Balanced = the deck we always built.
    card_choice: str | None = None


async def _resolve_pool(database, user_id: str, body):
    """Load the pool for a request's format, raising the right HTTP errors.

    Branches early on `requires_commander` rather than threading an optional
    commander through the shared helpers, so there's no chance of a None deref.
    """
    spec = formats.get_format(getattr(body, "format", None))
    scope = availability.normalize_scope(getattr(body, "pool_scope", None))
    sets = getattr(body, "sets", None)
    exclude_deck_id = getattr(body, "exclude_deck_id", None)
    if spec.requires_commander:
        if not body.commander:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{spec.label} requires a commander."
            )
        try:
            result = await pool_service.get_pool(
                database, user_id, body.commander,
                scope=scope, sets=sets, exclude_deck_id=exclude_deck_id, spec=spec,
            )
        except pool_service.CommanderNotFound as e:
            detail = f"No card found matching '{e.name}'."
            if e.suggestions:
                detail += " Did you mean: " + ", ".join(e.suggestions[:5])
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail)
        except pool_service.CommanderNotEligible as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    else:
        result = await pool_service.get_pool_for_format(
            database, user_id, spec,
            scope=scope, sets=sets, exclude_deck_id=exclude_deck_id,
        )
    # Commander has always tolerated an empty pool (you get a pile of basics and a
    # warning), so only fail it when a pool filter is what emptied it — otherwise
    # the user has no way to tell an over-narrow filter from a broken collection.
    if not result.pool and (
        not spec.requires_commander or availability.is_filtered(scope, sets)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            availability.empty_pool_message(spec.label, scope, sets),
        )
    return spec, result


async def _enrich_pool_printings(database, result) -> None:
    """Attach per-printing CDN image URLs to the pool's owned printings."""
    name_map: dict[str, str] = {c["_id"]: c["name"] for c in result.pool}
    if result.commander:
        name_map[result.commander["_id"]] = result.commander["name"]
    await card_prints_repo.enrich_printings(
        database, [(name_map.get(oid, ""), prints) for oid, prints in result.printings.items()]
    )


async def _basics_by_color(database) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for color, name in generator.BASIC_FOR_COLOR.items():
        doc = await database.cards.find_one({"name_normalized": normalize_name(name)})
        if doc:
            result[color] = doc
    return result


@router.get("/formats")
async def list_formats():
    """Formats the build UI can offer. Drives the format picker."""
    return formats.list_formats()


@router.get("/formats/catalog")
async def format_catalog(current_user: dict = Depends(get_current_user)):
    """Every format, with its family and how many of the user's cards it allows.

    The count answers "which format should I build in?" before the user picks —
    the thing only a collection-aware builder can say.
    """
    database = db.get_db()
    owned_ids = list(await collection_repo.owned_counts(database, current_user["_id"]))
    entries = formats.list_catalog()
    available = [e for e in entries if e["available"]]
    counts = await asyncio.gather(*(
        cards_repo.count_legal_owned(
            database, owned_ids, formats.get_format(str(e["key"])).legality_field
        )
        for e in available
    ))
    for entry, n in zip(available, counts):
        entry["legal_owned"] = n
    return entries


@router.get("/strategies")
async def list_strategies(format: str = Query("commander")):
    """Strategy presets for a format. Commander's are EDH-tuned (34-39 lands);
    constructed formats get their own table (22-26)."""
    return strategies.list_strategies(formats.get_format(format))


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
    format: str = Query("commander"),
    limit: int = Query(40, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Cards the user doesn't own that EDHREC recommends for this commander.

    Powers budget-upgrade suggestions. Excludes owned cards and the commander,
    keeps only cards inside the commander's color identity, and ranks by EDHREC
    quality score. Prices/images are fetched client-side.

    Commander-only: the entire ranking comes from EDHREC, which is keyed by
    commander slug and has no constructed-format equivalent.
    """
    spec = formats.get_format(format)
    if not spec.supports_upgrades:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Upgrade suggestions aren't available for {spec.label} — they're derived "
            "from EDHREC, which only covers Commander.",
        )
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
    spec, result = await _resolve_pool(database, current_user["_id"], body)

    await _enrich_pool_printings(database, result)
    basics = await _basics_by_color(database)

    # EDHREC quality signal: name-match the commander's recommended cards to the
    # user's pool, keyed by oracle_id. Empty if EDHREC is unavailable.
    # Commander-only — there is no equivalent data source for constructed formats.
    quality: dict[str, float] = {}
    edhrec_available = False
    if spec.supports_quality:
        score_map = await edhrec.get_score_map(database, result.commander)
        quality = {
            card["_id"]: score_map.get(card["name_normalized"], 0.0) for card in result.pool
        }
        edhrec_available = any(v > 0 for v in quality.values())

    # Commander Spellbook: combos assemblable from the pool (incl. the commander).
    pool_full: list[dict] = []
    pool_near: list[dict] = []
    combo_pieces: set[str] = set()
    # 60-card formats have no colors yet — they're detected after color selection.
    if spec.supports_combos and spec.requires_commander:
        pool_ids = {card["_id"] for card in result.pool} | {result.commander["_id"]}
        pool_full, pool_near = await spellbook.detect(
            database, pool_ids, result.color_identity, format_key=spec.key
        )
        combo_pieces = {oid for combo in pool_full for oid in combo["cards"]}

    # Resolve strategy and theme
    strat = strategies.get_strategy(body.strategy, spec)
    theme_matches = themes.compute_theme_matches(result.pool, body.theme)

    tuning = card_choice_service.tuning(body.card_choice, spec)

    # Colors. Commander takes them from the commander's identity; constructed formats
    # either use what the user locked or search for the best combination by building
    # a deck for each candidate. The pool stays unfiltered so the client can retoggle
    # colors without refetching — the filter is applied here instead.
    color_choice = None
    identity = result.color_identity
    pool_cards = result.pool
    if not spec.requires_commander:
        color_choice = color_select.select_colors(
            result.pool, spec, strat, basics,
            theme_matches=theme_matches,
            locked_colors=body.colors,
            auto_fill=body.auto_fill_colors,
            rank_weight=tuning.rank_weight,
        )
        identity = color_choice.colors
        allowed = set(identity)
        pool_cards = [c for c in result.pool if color_select._castable_in(c, allowed)]
        if theme_matches is not None:
            pool_ids_in_colors = {c["_id"] for c in pool_cards}
            theme_matches = theme_matches & pool_ids_in_colors

    if spec.supports_combos and not spec.requires_commander:
        pool_full, pool_near = await spellbook.detect(
            database, {c["_id"] for c in pool_cards}, identity, format_key=spec.key
        )
        combo_pieces = {oid for combo in pool_full for oid in combo["cards"]}

    # Locked cards to keep and build around (only those actually in the pool).
    pool_id_set = {card["_id"] for card in pool_cards}
    locked_ids = {oid for oid in (body.locked or []) if oid in pool_id_set}

    # Add jitter when regenerating (locked cards present) so the unlocked
    # slots get different picks each time. 0.8 is enough to shuffle the
    # mid-tier cards without overriding strong role/synergy signals.
    use_jitter = 0.8 if locked_ids else 0.0

    deck = generator.generate(
        result.commander,
        pool_cards,
        identity,
        basics,
        land_count=body.land_count,
        quotas=body.quotas,
        quality=quality,
        combo_pieces=combo_pieces,
        printings=result.printings,
        strategy=strat if body.strategy else None,
        theme_matches=theme_matches,
        locked_ids=locked_ids,
        jitter=max(use_jitter, tuning.jitter),
        spec=spec,
        rank_weight=tuning.rank_weight,
        quality_weight=tuning.quality_weight,
    )
    # Attach theme string so frontend can display it
    deck.theme = body.theme if body.theme and body.theme.strip() else None

    if spec.supports_quality and not edhrec_available:
        deck.warnings.append(
            "EDHREC data unavailable for this commander — ranked by curve and role fit only."
        )
    if theme_matches is not None and len(theme_matches) == 0:
        deck.warnings.append(
            f"No cards in your pool matched the '{body.theme}' theme — deck built without theme bias."
        )

    # Which of the pool's combos actually assembled in the final deck?
    deck_ids = {dc.oracle_id for dc in deck.cards}
    if result.commander:
        deck_ids |= {result.commander["_id"]}
    deck_combos = [c for c in pool_full if set(c["cards"]) <= deck_ids]

    pool_by_id = {card["_id"]: card for card in pool_cards}
    bracket = None
    if spec.supports_brackets:
        bracket = await _estimate_bracket(
            database, result.commander, deck, deck_combos, pool_by_id
        )

    return _deck_response(
        result.commander, identity, deck, edhrec_available,
        deck_combos, pool_near, bracket, pool_by_id=pool_by_id,
        spec=spec, color_choice=color_choice,
    )


class BriefRequest(PoolScopeMixin):
    commander: str | None = None
    format: str = "commander"
    brief: str
    # When refining an existing brief-built deck: the prior spec + core card names,
    # so Claude adjusts the current build instead of starting over.
    prior_spec: dict | None = None
    card_choice: str | None = None


@router.post("/brief", response_model=BriefDeckResponse)
async def brief_deck(body: BriefRequest, current_user: dict = Depends(require_premium)):
    """Interpret a natural-language deck request with Claude, then build the deck.

    Premium-only (Guideline gate + it spends Anthropic credits per call). Claude
    selects core cards from the owned pool + build knobs; the generator builds a
    legal, curved, synergy/combo-layered deck around that core.
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
    fmt, result = await _resolve_pool(database, current_user["_id"], body)

    await _enrich_pool_printings(database, result)
    basics = await _basics_by_color(database)

    quality: dict[str, float] = {}
    edhrec_available = False
    if fmt.supports_quality:
        score_map = await edhrec.get_score_map(database, result.commander)
        quality = {c["_id"]: score_map.get(c["name_normalized"], 0.0) for c in result.pool}
        edhrec_available = any(v > 0 for v in quality.values())

    pool_full: list[dict] = []
    pool_near: list[dict] = []
    combo_pieces: set[str] = set()
    # 60-card formats have no colors yet — they're detected after color selection.
    if fmt.supports_combos and fmt.requires_commander:
        pool_ids = {c["_id"] for c in result.pool} | {result.commander["_id"]}
        pool_full, pool_near = await spellbook.detect(
            database, pool_ids, result.color_identity, format_key=fmt.key
        )
        combo_pieces = {oid for combo in pool_full for oid in combo["cards"]}

    # Ask Claude for a build spec, then sanitize it. For constructed formats the
    # shortlist is ranked structurally (rarity, copies owned, role, curve) since
    # there's no community quality signal to sort by.
    shortlist = ai_brief.build_shortlist(result.pool, quality, combo_pieces, spec=fmt)
    strat_names = [s["name"] for s in strategies.list_strategies(fmt)]
    try:
        raw_spec = await ai_brief.interpret_brief(
            result.commander, brief, shortlist, strat_names,
            prior_spec=body.prior_spec, spec=fmt,
        )
    except ai_brief.BriefUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except ai_brief.BriefError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI deck brief failed: {e}")

    spec = ai_brief.validate_spec(
        raw_spec, {c["name"] for c in result.pool}, set(strat_names), fmt=fmt
    )

    strat = strategies.get_strategy(spec["strategy"], fmt) if spec["strategy"] else None
    theme_matches = themes.compute_theme_matches(result.pool, spec["theme"])

    tuning = card_choice_service.tuning(body.card_choice, fmt)

    # Colors: Claude's pick if it gave one, otherwise the collection-based search.
    color_choice = None
    identity = result.color_identity
    pool_cards = result.pool
    if not fmt.requires_commander:
        color_choice = color_select.select_colors(
            result.pool,
            fmt,
            strat or strategies.get_strategy(None, fmt),
            basics,
            theme_matches=theme_matches,
            locked_colors=spec["colors"] or None,
            auto_fill=not spec["colors"],
            rank_weight=tuning.rank_weight,
        )
        identity = color_choice.colors
        allowed = set(identity)
        pool_cards = [c for c in result.pool if color_select._castable_in(c, allowed)]
        if theme_matches is not None:
            theme_matches = theme_matches & {c["_id"] for c in pool_cards}

    if fmt.supports_combos and not fmt.requires_commander:
        pool_full, pool_near = await spellbook.detect(
            database, {c["_id"] for c in pool_cards}, identity, format_key=fmt.key
        )
        combo_pieces = {oid for combo in pool_full for oid in combo["cards"]}

    # Resolve core card names to owned oracle_ids, keeping Claude's copy counts.
    name_to_id = {normalize_name(c["name"]): c["_id"] for c in pool_cards}
    core_ids: set[str] = set()
    core_counts: dict[str, int] = {}
    for name in spec["core_cards"]:
        oid = name_to_id.get(normalize_name(name))
        if oid:
            core_ids.add(oid)
            core_counts[oid] = spec["core_counts"].get(name, 1)

    deck = generator.generate(
        result.commander,
        pool_cards,
        identity,
        basics,
        land_count=spec["land_count"],
        quotas=spec["quota_overrides"] or None,
        quality=quality,
        combo_pieces=set() if spec["avoid_combos"] else combo_pieces,
        printings=result.printings,
        strategy=strat if spec["strategy"] else None,
        theme_matches=theme_matches,
        locked_ids=core_ids,
        locked_counts=core_counts,
        avoid_combos=spec["avoid_combos"],
        spec=fmt,
        jitter=tuning.jitter,
        rank_weight=tuning.rank_weight,
        quality_weight=tuning.quality_weight,
    )
    deck.theme = spec["theme"]
    if fmt.supports_quality and not edhrec_available:
        deck.warnings.append(
            "EDHREC data unavailable for this commander — ranked by curve and role fit only."
        )

    deck_ids = {dc.oracle_id for dc in deck.cards}
    if result.commander:
        deck_ids |= {result.commander["_id"]}
    deck_combos = [c for c in pool_full if set(c["cards"]) <= deck_ids]
    pool_by_id = {c["_id"]: c for c in pool_cards}
    bracket = None
    if fmt.supports_brackets:
        bracket = await _estimate_bracket(
            database, result.commander, deck, deck_combos, pool_by_id
        )
    deck_resp = _deck_response(
        result.commander, identity, deck, edhrec_available,
        deck_combos, pool_near, bracket, pool_by_id=pool_by_id,
        spec=fmt, color_choice=color_choice,
    )

    core_summaries = [
        _card_summary(pool_by_id[oid])
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
            # The colors actually built, not just what Claude asked for — so a
            # refinement turn starts from the deck the player is looking at.
            colors=identity if not fmt.requires_commander else [],
        ),
    )


class ComposeRequest(PoolScopeMixin):
    commander: str | None = None
    format: str = "commander"
    # Repeat an id to represent multiple copies (constructed formats run up to 4).
    oracle_ids: list[str]
    # Also accept legal cards the user doesn't own, and basics ("basic:G") — for a
    # deck that's had upgrade swaps applied, which may include cards to buy.
    include_unowned: bool = False


@router.post("/compose", response_model=GeneratedDeckResponse)
async def compose_deck(body: ComposeRequest, current_user: dict = Depends(get_current_user)):
    """Analyze an exact user-chosen card list into the deck shape (categories +
    stats), for the manual builder. Same rendering as an auto-built deck."""
    database = db.get_db()
    spec, result = await _resolve_pool(database, current_user["_id"], body)

    await _enrich_pool_printings(database, result)

    # Keep only ids that are actually in the legal owned pool. Repeats are preserved
    # so a 4-of arrives as four entries and `compose` counts it as four cards.
    pool_by_id = {card["_id"]: card for card in result.pool}
    if body.include_unowned:
        await _add_unowned_to(database, pool_by_id, body.oracle_ids, spec)
    chosen_docs = [pool_by_id[oid] for oid in body.oracle_ids if oid in pool_by_id]

    quality: dict[str, float] = {}
    edhrec_available = False
    if spec.supports_quality:
        score_map = await edhrec.get_score_map(database, result.commander)
        quality = {
            card["_id"]: score_map.get(card["name_normalized"], 0.0) for card in result.pool
        }
        edhrec_available = any(v > 0 for v in quality.values())

    identity = result.color_identity
    if not spec.requires_commander:
        # The deck's colors are whatever the chosen cards actually need.
        identity = sorted(
            {c for doc in chosen_docs for c in (doc.get("colors") or [])},
            key=lambda c: generator.COLOR_ORDER.index(c) if c in generator.COLOR_ORDER else 9,
        )

    deck = generator.compose(
        chosen_docs, identity, quality=quality, printings=result.printings, spec=spec
    )

    deck_combos: list[dict] = []
    near_combos: list[dict] = []
    bracket = None
    if spec.supports_combos:
        deck_ids = {dc.oracle_id for dc in deck.cards}
        if result.commander:
            deck_ids |= {result.commander["_id"]}
        deck_combos, near_combos = await spellbook.detect(
            database, deck_ids, identity, format_key=spec.key
        )
    if spec.supports_brackets:
        bracket = await _estimate_bracket(
            database, result.commander, deck, deck_combos, pool_by_id
        )

    return _deck_response(
        result.commander, identity, deck, edhrec_available,
        deck_combos, near_combos, bracket, pool_by_id=pool_by_id, spec=spec,
    )


class ComboFinishRequest(BaseModel):
    # Optional for 60-card decks, which send `format` instead; their colors are
    # whatever the deck's cards are.
    commander: str | None = None
    oracle_ids: list[str]
    format: str = "commander"


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
    spec = formats.get_format(body.format)
    if not spec.supports_combos:
        return []
    commander_id = ""
    if spec.requires_commander:
        if not body.commander:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{spec.label} requires a commander.")
        try:
            result = await pool_service.get_pool(
                database, current_user["_id"], body.commander, spec=spec
            )
        except pool_service.CommanderNotFound as e:
            detail = f"No card found matching '{e.name}'."
            if e.suggestions:
                detail += " Did you mean: " + ", ".join(e.suggestions[:5])
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail)
        commander_id = result.commander["_id"]
        deck_ids = set(body.oracle_ids) | {commander_id}
        identity = result.color_identity
    else:
        deck_ids = set(body.oracle_ids)
        identity = sorted({
            c
            async for doc in database.cards.find({"_id": {"$in": list(deck_ids)}}, {"colors": 1})
            for c in (doc.get("colors") or [])
        })
    finishers = await spellbook.combo_finishers(database, deck_ids, identity, format_key=spec.key)
    if not finishers:
        return []

    docs_by_id: dict[str, dict] = {}
    cursor = database.cards.find({"_id": {"$in": [f["oracle_id"] for f in finishers]}})
    async for doc in cursor:
        docs_by_id[doc["_id"]] = doc

    owned = await collection_repo.owned_counts(database, current_user["_id"])
    return _build_finishers(finishers, docs_by_id, set(owned), commander_id, limit=30)


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


def _card_summary(doc: dict) -> CardSummary:
    """Build a CardSummary from a card document, including image URIs."""
    return CardSummary(
        oracle_id=doc["_id"],
        name=doc["name"],
        mana_cost=doc.get("mana_cost", ""),
        cmc=doc.get("cmc", 0.0),
        type_line=doc.get("type_line", ""),
        color_identity=doc.get("color_identity", []),
        oracle_text=doc.get("oracle_text", ""),
        image_uris=doc.get("image_uris"),
        image_uris_back=doc.get("image_uris_back"),
    )


def _color_rationale(choice) -> ColorRationale | None:
    if choice is None:
        return None
    return ColorRationale(
        colors=choice.colors,
        score=choice.score,
        components=choice.components,
        alternates=[ColorAlternate(colors=c, score=s) for c, s in choice.alternates],
        short_pool=choice.short_pool,
    )


def _deck_response(
    commander: dict | None,
    identity: list[str],
    deck,  # generator.GeneratedDeck
    edhrec_available: bool,
    deck_combos: list[dict],
    near_combos: list[dict],
    bracket: BracketOut | None = None,
    pool_by_id: dict[str, dict] | None = None,
    spec=None,
    color_choice=None,
) -> GeneratedDeckResponse:
    """Assemble a GeneratedDeckResponse from a computed deck (shared by generate + compose)."""
    fmt = spec or formats.get_format(None)
    combo_card_ids = {oid for combo in deck_combos for oid in combo["cards"]}
    return GeneratedDeckResponse(
        commander=_card_summary(commander) if commander else None,
        color_identity=identity,
        format=fmt.key,
        colors=identity,
        deck_size=fmt.deck_size + (1 if fmt.requires_commander else 0),
        max_copies=fmt.max_copies,
        supports_upgrades=fmt.supports_upgrades,
        color_rationale=_color_rationale(color_choice),
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
                printing_allocation=dc.printing_allocation,
                **({"image_uris": pool_by_id[dc.oracle_id].get("image_uris"),
                    "image_uris_back": pool_by_id[dc.oracle_id].get("image_uris_back")}
                   if pool_by_id and dc.oracle_id in pool_by_id else {}),
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
    if not users_repo.is_premium(current_user):
        limit = get_settings().free_saved_deck_limit
        if await decks_repo.count_decks(database, current_user["_id"]) >= limit:
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED,
                f"Free accounts can save up to {limit} decks. "
                "Upgrade to Grimoire Premium for unlimited saved decks.",
            )
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
    commander_names = [
        doc["deck"].get("commander", {}).get("name", "") for doc in docs
    ]
    art = await card_prints_repo.art_by_name(database, commander_names)
    summaries = []
    for doc in docs:
        b = doc["deck"].get("bracket") or {}
        commander_name = doc["deck"].get("commander", {}).get("name", "Unknown")
        banner = art.get(commander_name.lower()) or {}
        summaries.append(
            SavedDeckSummary(
                id=doc["_id"],
                name=doc["name"],
                commander_name=commander_name,
                color_identity=doc["deck"].get("color_identity", []),
                total=doc["deck"].get("total", 0),
                created_at=doc["created_at"],
                updated_at=doc["updated_at"],
                bracket=b.get("bracket"),
                bracket_label=b.get("label"),
                source=doc.get("source"),
                in_use=bool(doc.get("in_use")),
                commander_art_crop=banner.get("art_crop"),
                commander_artist=banner.get("artist"),
            )
        )
    return summaries


async def _refresh_ownership(database, user_id: str, doc: dict) -> None:
    """Re-attach live collection data to a stored deck, in place.

    The `printings` on a saved deck are a snapshot from build time. Anything that
    happened since — a re-import, a new copy bought, another deck marked in use —
    would leave the printing picker choosing between stale options and the
    availability numbers wrong. So the deck's ownership facts are recomputed on
    every read: which printings you own, how many of each are free, and whether
    older in-use decks already spoke for every copy of a card this deck wants.

    Deliberately not persisted — this is derived data, and writing it back on a
    GET would churn `updated_at` and make every deck look freshly edited.
    """
    cards = (doc.get("deck") or {}).get("cards") or []
    if not cards:
        return
    owned = await collection_repo.owned_printings(database, user_id)
    committed = await availability.committed_by_printing(database, user_id)
    with_availability = availability.apply_committed(owned, committed)
    shortfalls = await availability.deck_shortfalls(
        database, user_id, str(doc["_id"]), owned
    )
    names = {c.get("oracle_id"): c.get("name", "") for c in cards}
    await card_prints_repo.enrich_printings(
        database,
        [(names.get(oid, ""), units) for oid, units in with_availability.items() if oid in names],
    )
    for card in cards:
        units = with_availability.get(card.get("oracle_id")) or []
        card["printings"] = units
        card["available_count"] = sum(int(u.get("available") or 0) for u in units) if units else None
        card["short"] = bool(shortfalls.get(card.get("oracle_id")))
        # A printing that vanished from the collection can't stay earmarked.
        keys = {u["printing_key"] for u in units}
        alloc = {k: v for k, v in availability.card_allocation(card).items() if k in keys}
        if not alloc and units:
            alloc = availability.allocate(units, int(card.get("count") or 1))
        card["printing_allocation"] = alloc or None
        card["selected_printing_key"] = availability.primary_key(alloc)


def _saved_deck_response(doc: dict) -> SavedDeckResponse:
    return SavedDeckResponse(
        id=doc["_id"],
        name=doc["name"],
        deck=doc["deck"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        source=doc.get("source"),
        source_url=doc.get("source_url"),
        in_use=bool(doc.get("in_use")),
    )


@router.get("/saved/{deck_id}", response_model=SavedDeckResponse)
async def get_saved_deck(deck_id: str, current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    doc = await decks_repo.get_deck(database, current_user["_id"], deck_id)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")
    await _refresh_ownership(database, current_user["_id"], doc)
    return _saved_deck_response(doc)


@router.put("/saved/{deck_id}", response_model=SavedDeckResponse)
async def update_saved_deck(
    deck_id: str, body: UpdateDeckRequest, current_user: dict = Depends(get_current_user),
):
    database = db.get_db()
    deck_data = body.deck.model_dump() if body.deck else None
    name = body.name.strip() if body.name else None
    doc = await decks_repo.update_deck(
        database, current_user["_id"], deck_id,
        name=name, deck_data=deck_data, in_use=body.in_use,
    )
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")
    await _refresh_ownership(database, current_user["_id"], doc)
    return _saved_deck_response(doc)


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


# ---- Analyze & upgrade (Premium) ----

ANALYSES_PER_DAY = 25    # fresh (uncached) analyses per user per day; each is a Claude call


class AnalyzeCardIn(BaseModel):
    oracle_id: str
    count: int = 1


class AnalyzeRequest(BaseModel):
    commander: str | None = None
    format: str = "commander"
    cards: list[AnalyzeCardIn]
    strategy: str | None = None
    colors: list[str] | None = None   # 60-card: the deck's colors; derived if missing
    budget: float | None = None       # max per card bought; defaults to the user's preference


def _analysis_key(user_id: str, body: AnalyzeRequest, budget: float | None) -> str:
    import hashlib
    import json as _json

    cards = sorted((c.oracle_id, c.count) for c in body.cards)
    raw = _json.dumps(
        [user_id, body.format, body.commander, body.strategy, sorted(body.colors or []), budget, cards]
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def _analysis_card(c: deck_analysis.Candidate, count: int, owned: bool) -> AnalysisCard:
    d = c.doc
    return AnalysisCard(
        oracle_id=d["_id"], name=d["name"], count=count,
        mana_cost=d.get("mana_cost", ""), type_line=d.get("type_line", ""),
        owned=owned, price_usd=None if owned else c.price,
    )


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_deck(body: AnalyzeRequest, current_user: dict = Depends(require_premium)):
    """Premium: a verdict on the deck plus cut-X/add-Y swaps.

    Candidates come from the deterministic scorer (`deck_analysis`); Claude only
    chooses among them, and every swap is validated. Results are cached per deck
    version, so reopening an analysis doesn't cost another call.
    """
    from datetime import datetime, timedelta, timezone

    database = db.get_db()
    user_id = current_user["_id"]
    spec = formats.get_format(body.format)
    prefs = current_user.get("preferences") or {}
    budget = body.budget if body.budget is not None else prefs.get("max_card_price")

    key = _analysis_key(user_id, body, budget)
    cached = await database.analysis_cache.find_one({"_id": key})
    if cached:
        return AnalysisResponse(**cached["result"], cached=True)

    since = datetime.now(timezone.utc) - timedelta(days=1)
    if await database.analysis_cache.count_documents(
        {"user_id": user_id, "created_at": {"$gte": since}}
    ) >= ANALYSES_PER_DAY:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "That's today's limit for deck analyses — try again tomorrow.",
        )

    # The deck and the owned legal pool.
    if spec.requires_commander:
        if not body.commander:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{spec.label} requires a commander.")
        try:
            result = await pool_service.get_pool(database, user_id, body.commander, spec=spec)
        except pool_service.CommanderNotFound as e:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"No card found matching '{e.name}'.")
        except pool_service.CommanderNotEligible as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    else:
        result = await pool_service.get_pool_for_format(database, user_id, spec)
    commander = result.commander

    counts: dict[str, int] = {}
    for c in body.cards:
        if c.oracle_id.startswith("basic:") or (commander and c.oracle_id == commander["_id"]):
            continue
        counts[c.oracle_id] = counts.get(c.oracle_id, 0) + max(1, c.count)
    deck_docs = {
        d["_id"]: d async for d in database.cards.find({"_id": {"$in": list(counts)}})
    }
    nonland = [
        (d, counts[oid]) for oid, d in deck_docs.items() if not deck_analysis._is_land(d)
    ]
    if not nonland:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The deck has no spells to analyze.")

    if spec.requires_commander:
        colors = list(result.color_identity)
    else:
        colors = body.colors or sorted({c for d, _ in nonland for c in (d.get("colors") or [])})
    allowed = set(colors)

    strat = strategies.get_strategy(body.strategy, spec)
    tuning_rank = spec.rank_weight

    quality: dict[str, float] = {}
    if spec.supports_quality and commander:
        score_map = await edhrec.get_score_map(database, commander)
        top = max(score_map.values(), default=0.0)
        if top > 0:
            quality = {
                d["_id"]: score_map.get(d["name_normalized"], 0.0) / top
                for d in list(deck_docs.values()) + result.pool
            }

    deck_ids = set(counts) | ({commander["_id"]} if commander else set())
    combo_names: list[str] = []
    combo_pieces: set[str] = set()
    finisher_ids: set[str] = set()
    if spec.supports_combos:
        full, _near = await spellbook.detect(database, deck_ids, colors, format_key=spec.key)
        combo_pieces = {oid for combo in full for oid in combo["cards"]}
        combo_names = [" + ".join(c.get("card_names", [])) for c in full[:8]]
        finishers = await spellbook.combo_finishers(database, deck_ids, colors, format_key=spec.key)
        finisher_ids = {f["oracle_id"] for f in finishers[:60]}

    shape = deck_analysis.deck_shape(nonland, spec, strat)
    cuts = deck_analysis.cut_candidates(nonland, shape, quality, combo_pieces, tuning_rank)

    # Owned adds: legal owned cards in colors, with copies left over after the deck.
    owned_pool = [
        d for d in result.pool
        if (not commander or d["_id"] != commander["_id"])
        and (spec.requires_commander or card_castable_in(d, allowed))
    ]
    owned_allowed = {
        d["_id"]: min(d.get("copies_owned", 1) or 1, spec.max_copies) - counts.get(d["_id"], 0)
        for d in owned_pool
    }
    owned_adds = deck_analysis.add_candidates(
        owned_pool, shape, quality, finisher_ids, owned=True, copies_allowed=owned_allowed
    )

    # Cards to buy: widely played, legal, in colors, not owned.
    owned_ids = set(await collection_repo.owned_counts(database, user_id))
    query = {
        spec.legality_field: "legal",
        "rank_score": {"$gte": 0.25},
        "_id": {"$nin": list(owned_ids | deck_ids)},
        "color_identity": {"$not": {"$elemMatch": {"$nin": colors}}},
    }
    buy_docs = [
        d async for d in database.cards.find(query).sort("rank_score", -1).limit(600)
        if spec.requires_commander
        or (card_castable_in(d, allowed) and not cards_repo.needs_a_commander(d))
    ]
    prices = await _cheapest_prices(database, [d["_id"] for d in buy_docs])
    buy_adds = deck_analysis.add_candidates(
        buy_docs, shape, quality, finisher_ids, owned=False,
        copies_allowed={d["_id"]: spec.max_copies for d in buy_docs},
        prices=prices, max_price=budget,
    )

    cut_keys = {f"c{i}": c for i, c in enumerate(cuts, 1)}
    add_keys = {f"o{i}": a for i, a in enumerate(owned_adds, 1)}
    add_keys.update({f"b{i}": a for i, a in enumerate(buy_adds, 1)})

    verdict, swaps, ai = "", [], True
    try:
        raw = await ai_upgrade.judge(
            format_label=spec.label.split(" — ")[0],
            commander=commander,
            strategy=strat.name,
            deck_list=[f"{n}x {d['name']}" for d, n in nonland],
            shape=shape.summary(),
            combos=combo_names,
            cuts=[deck_analysis.prompt_entry(k, c) for k, c in cut_keys.items()],
            owned_adds=[deck_analysis.prompt_entry(k, a) for k, a in add_keys.items() if k[0] == "o"],
            buy_adds=[deck_analysis.prompt_entry(k, a) for k, a in add_keys.items() if k[0] == "b"],
            budget=budget,
        )
        verdict = str(raw.get("verdict") or "").strip()
        swaps = deck_analysis.validate_swaps(raw.get("swaps") or [], cut_keys, add_keys, spec.max_copies)
    except (ai_upgrade.AnalysisUnavailable, ai_upgrade.AnalysisError):
        ai = False
    if not swaps:
        ai = False
        swaps = deck_analysis.pair_swaps(cuts, owned_adds + buy_adds, spec.max_copies)
        swaps.sort(key=lambda s: -s.add.score)
    if not verdict:
        short = [r.replace("_", " ") for r in deck_analysis.QUOTA_ROLES if shape.role_short(r)]
        verdict = (
            f"Short on {', '.join(short)} for a {strat.name} plan." if short
            else "The deck covers its roles; these swaps trade weaker cards for stronger ones."
        )

    response = AnalysisResponse(
        verdict=verdict,
        swaps=[
            AnalysisSwap(
                cut=_analysis_card(s.cut, s.cut_count, owned=True),
                add=_analysis_card(s.add, s.add_count, owned=s.add.owned),
                source="owned" if s.add.owned else "buy",
                reason=s.reason,
            )
            for s in swaps
        ],
        ai=ai,
    )
    await database.analysis_cache.replace_one(
        {"_id": key},
        {
            "_id": key,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "result": response.model_dump(exclude={"cached"}),
        },
        upsert=True,
    )
    return response


async def _add_unowned_to(database, pool_by_id: dict, oracle_ids: list[str], spec) -> None:
    """Extend a compose pool with what an upgraded deck may hold beyond the owned
    pool: legal cards bought as upgrades (0 copies owned) and basic lands."""
    basics = await _basics_by_color(database)
    for oid in set(oracle_ids) - set(pool_by_id):
        if oid.startswith("basic:"):
            color = oid.split(":", 1)[1]
            if color in basics:
                pool_by_id[oid] = {**basics[color], "_id": oid, "is_basic_land": True}
    missing = [oid for oid in set(oracle_ids) - set(pool_by_id) if not oid.startswith("basic:")]
    if missing:
        async for doc in database.cards.find({"_id": {"$in": missing}, spec.legality_field: "legal"}):
            pool_by_id[doc["_id"]] = {**doc, "copies_owned": 0}


async def _cheapest_prices(database, oracle_ids: list[str]) -> dict[str, float]:
    """Cheapest USD price across each card's printings."""
    if not oracle_ids:
        return {}
    cursor = await database.card_prints.aggregate([
        {"$match": {"oracle_id": {"$in": oracle_ids}, "price_usd": {"$ne": None}}},
        {"$group": {"_id": "$oracle_id", "price": {"$min": "$price_usd"}}},
    ])
    return {row["_id"]: float(row["price"]) async for row in cursor}
