"""Explore endpoints: resolve external deck card lists against our DB."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import (
    CardSummary,
    CurveBucket,
    DeckCardOut,
    ExternalDeckResponse,
    GeneratedDeckResponse,
    PrintingOut,
)
from ..repositories import collection as collection_repo
from ..services import external_decks
from ..services.generator import compose
from ..util import normalize_name, strip_diacritics

router = APIRouter(prefix="/explore", tags=["explore"])


class SearchSummary(BaseModel):
    external_id: str
    source: str
    name: str
    owner: str
    card_count: int
    url: str
    commander_name: str
    color_identity: list[str]
    bracket: int | None = None
    price: int | None = None


@router.get("/search", response_model=list[SearchSummary])
async def search_decks(
    commander: str = Query(..., min_length=1),
    page_size: int = Query(20, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Search EDHREC for commander decklists, fully server-side.

    Fetches hash table from json.edhrec.com, then batch-fetches previews
    from edhrec.com/api/deckpreview to build summaries.
    """
    try:
        results = await external_decks.search_edhrec(commander, page_size)
    except httpx.TimeoutException:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "External service timeout.")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return []
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"External service error ({e.response.status_code}).")
    except httpx.HTTPError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "External service unavailable.")
    return [SearchSummary(**r) for r in results]


@router.get("/edhrec-deck")
async def fetch_edhrec_deck(
    hash: str = Query(..., min_length=1),
    current_user: dict = Depends(get_current_user),
):
    """Fetch a single EDHREC deck preview by hash (server-side proxy)."""
    try:
        preview = await external_decks.fetch_edhrec_preview(hash)
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Failed to fetch deck from EDHREC.")
    if not preview:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found.")
    return preview


class ResolveCardEntry(BaseModel):
    name: str
    quantity: int = 1
    is_commander: bool = False


class ResolveDeckRequest(BaseModel):
    """Card list from a client-side EDHREC/external fetch, to resolve against our DB."""
    cards: list[ResolveCardEntry]
    source: str = "edhrec"
    source_url: str = ""
    name: str = "Untitled"
    owner: str = "Unknown"


@router.post("/resolve", response_model=ExternalDeckResponse)
async def resolve_deck(
    body: ResolveDeckRequest,
    current_user: dict = Depends(get_current_user),
):
    """Resolve a list of card names against our DB with ownership check.

    The client fetches deck data from EDHREC (browser-side, avoids Cloudflare
    blocking), then sends the card list here for resolution + ownership.
    """
    if not body.cards:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No cards provided.")

    card_entries = [
        {
            "name": c.name,
            "quantity": c.quantity,
            "categories": ["Commander"] if c.is_commander else [],
        }
        for c in body.cards
    ]

    database = db.get_db()
    deck_response, unowned_count, owned_count = await _resolve_external_deck(
        database, current_user["_id"], card_entries,
    )

    return ExternalDeckResponse(
        source=body.source,
        source_url=body.source_url,
        name=body.name,
        owner=body.owner,
        deck=deck_response,
        unowned_count=unowned_count,
        owned_count=owned_count,
    )


@router.get("/deck", response_model=ExternalDeckResponse)
async def fetch_deck(
    url: str | None = Query(None),
    archidekt_id: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """Fetch a full deck from Archidekt by URL or ID and resolve against our DB.

    For Archidekt URLs only — EDHREC search/preview is done client-side.
    """
    source: str | None = None
    source_id: str | None = None
    source_url: str = ""

    if url:
        parsed = external_decks.parse_deck_url(url)
        if not parsed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Unsupported URL. Supported: archidekt.com/decks/...",
            )
        source, source_id = parsed
        source_url = url
    elif archidekt_id:
        source = "archidekt"
        source_id = archidekt_id
        source_url = f"https://archidekt.com/decks/{archidekt_id}"
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Provide 'url' or 'archidekt_id'.",
        )

    if source == "moxfield":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Moxfield direct import is not currently available. "
            "Try searching by commander name instead.",
        )

    if source not in ("archidekt",):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported source for direct fetch.")

    try:
        raw = await external_decks.fetch_archidekt_deck(source_id)
        card_entries = external_decks.extract_archidekt_cards(raw) if raw else []
        metadata = external_decks.extract_deck_metadata(raw, "archidekt") if raw else {}
    except httpx.TimeoutException:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "External service temporarily unavailable (timeout).",
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found or is private.")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"External service error ({e.response.status_code}).",
        )
    except httpx.HTTPError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "External service temporarily unavailable.",
        )

    if not raw:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found or is private.")
    if not card_entries:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck has no cards.")

    database = db.get_db()
    deck_response, unowned_count, owned_count = await _resolve_external_deck(
        database, current_user["_id"], card_entries,
    )

    return ExternalDeckResponse(
        source=source,
        source_url=source_url,
        name=metadata.get("name", "Untitled"),
        owner=metadata.get("owner", "Unknown"),
        deck=deck_response,
        unowned_count=unowned_count,
        owned_count=owned_count,
    )


async def _resolve_external_deck(
    database, user_id: str, card_entries: list[dict],
) -> tuple[GeneratedDeckResponse, int, int]:
    """Resolve external card entries against our DB and build a GeneratedDeckResponse."""
    name_set: set[str] = set()
    for entry in card_entries:
        name_set.add(normalize_name(entry["name"]))
        if " // " in entry["name"]:
            name_set.add(normalize_name(entry["name"].split(" // ")[0]))

    docs_by_norm: dict[str, dict] = {}
    if name_set:
        cursor = database.cards.find({"name_normalized": {"$in": list(name_set)}})
        async for doc in cursor:
            docs_by_norm[doc["name_normalized"]] = doc

    stripped_lookup: dict[str, str] = {}
    missing = name_set - set(docs_by_norm.keys())
    if missing:
        stripped_names = []
        for n in missing:
            stripped = normalize_name(strip_diacritics(n))
            if stripped != n:
                stripped_names.append(stripped)
                stripped_lookup[stripped] = n
        if stripped_names:
            cursor = database.cards.find({"name_normalized": {"$in": stripped_names}})
            async for doc in cursor:
                original_norm = stripped_lookup.get(doc["name_normalized"])
                if original_norm:
                    docs_by_norm[original_norm] = doc

    user_printings = await collection_repo.owned_printings(database, user_id)

    resolved_docs: list[dict] = []
    commander_doc: dict | None = None
    unresolved_count = 0

    for entry in card_entries:
        norm = normalize_name(entry["name"])
        doc = docs_by_norm.get(norm)
        if doc is None and " // " in entry["name"]:
            doc = docs_by_norm.get(normalize_name(entry["name"].split(" // ")[0]))
        if doc is None:
            unresolved_count += 1
            continue

        is_commander = "Commander" in (entry.get("categories") or [])
        if is_commander and commander_doc is None:
            commander_doc = doc
            continue

        for _ in range(entry.get("quantity", 1)):
            resolved_docs.append(doc)

    if commander_doc is None:
        for doc in resolved_docs:
            tl = doc.get("type_line", "")
            if "Legendary" in tl and "Creature" in tl:
                commander_doc = doc
                resolved_docs.remove(doc)
                break

    if commander_doc is None:
        commander_doc = {
            "_id": "unknown", "name": "Unknown Commander",
            "name_normalized": "unknown commander", "mana_cost": "", "cmc": 0,
            "type_line": "Legendary Creature", "oracle_text": "",
            "color_identity": [], "colors": [], "keywords": [],
        }

    identity = commander_doc.get("color_identity", [])
    deck = compose(resolved_docs, identity, printings=user_printings)

    warnings: list[str] = []
    if unresolved_count > 0:
        warnings.append(f"{unresolved_count} card(s) could not be resolved against our database.")

    owned_count = 0
    unowned_count = 0
    for dc in deck.cards:
        if dc.printings:
            owned_count += dc.count
        else:
            unowned_count += dc.count

    deck_response = GeneratedDeckResponse(
        commander=CardSummary(
            oracle_id=commander_doc["_id"],
            name=commander_doc["name"],
            mana_cost=commander_doc.get("mana_cost", ""),
            cmc=commander_doc.get("cmc", 0.0),
            type_line=commander_doc.get("type_line", ""),
            color_identity=commander_doc.get("color_identity", []),
            oracle_text=commander_doc.get("oracle_text", ""),
        ),
        color_identity=identity,
        total=sum(dc.count for dc in deck.cards),
        land_count=deck.land_count,
        nonland_count=deck.nonland_count,
        role_counts=deck.role_counts,
        curve=[CurveBucket(**b) for b in deck.curve],
        color_sources=deck.color_sources,
        stats=deck.stats,
        warnings=warnings,
        edhrec_available=False,
        combos=[], near_combos=[],
        strategy=None, theme=None, theme_count=0, bracket=None,
        cards=[
            DeckCardOut(
                oracle_id=dc.oracle_id, name=dc.name, mana_cost=dc.mana_cost,
                cmc=dc.cmc, type_line=dc.type_line, color_identity=dc.color_identity,
                roles=dc.roles, slot=dc.slot, reason=dc.reason, count=dc.count,
                quality=dc.quality, in_combo=False,
                printings=[PrintingOut(**p) for p in dc.printings],
                selected_printing_key=dc.selected_printing_key,
            )
            for dc in deck.cards
        ],
    )

    return deck_response, unowned_count, owned_count
