"""Commander picker: search the user's owned commander-eligible cards."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import CommanderOption, CommanderSetOut
from ..repositories import card_prints as card_prints_repo
from ..repositories import cards as cards_repo
from ..repositories import collection as collection_repo
from ..services import availability, formats

router = APIRouter(prefix="/commanders", tags=["commanders"])


@router.get("", response_model=list[CommanderOption])
async def search_commanders(
    q: str = "",
    limit: int = Query(20, ge=1, le=200),
    colors: str = Query("", pattern="^[WUBRGC]*$"),
    max_mv: float | None = Query(None, ge=0),
    creature_type: str = "",
    sets: list[str] | None = Query(None, description="Set codes; matches commanders owned in any of them"),
    format: str = Query("commander", description="Whose commander rules apply"),
    current_user: dict = Depends(get_current_user),
):
    """`colors` is an exact color identity as WUBRG letters ("GW"), plus "C" for
    a colorless {C} pip in the cost ("WUBRGC" finds Ulalek); "C" alone means
    colorless commanders. `sets` keeps commanders you own a printing of from one
    of those sets — the collection browser's set filter. Every filter is optional, so older clients sending only
    `q` and `limit` get the same results as before."""
    database = db.get_db()
    if sets:
        printings = await collection_repo.owned_printings(database, current_user["_id"])
        owned_ids = list(availability.filter_units_by_set(printings, sets))
    else:
        owned_ids = list(await collection_repo.owned_counts(database, current_user["_id"]))
    docs = await cards_repo.search_owned_commanders(
        database,
        owned_ids,
        query=q,
        limit=limit,
        colors=list(colors),
        max_mv=max_mv,
        creature_type=creature_type,
        format_key=formats.get_format(format).key,
    )
    return [
        CommanderOption(
            oracle_id=d["_id"],
            name=d["name"],
            type_line=d.get("type_line", ""),
            color_identity=d.get("color_identity", []),
            image_uris=d.get("image_uris"),
        )
        for d in docs
    ]


@router.get("/sets", response_model=list[CommanderSetOut])
async def commander_sets(
    format: str = Query("commander", description="Whose commander rules apply"),
    current_user: dict = Depends(get_current_user),
):
    """The sets the picker's set filter offers: only sets you own an eligible
    commander from, each with how many. A commander owned in two sets counts
    once in each. Sorted by name, like the collection's set list."""
    database = db.get_db()
    printings = await collection_repo.owned_printings(database, current_user["_id"])
    eligible = await cards_repo.owned_commander_ids(
        database, list(printings), formats.get_format(format).key
    )

    counts: dict[str, int] = {}
    for oracle_id in eligible:
        codes = {(u.get("edition") or "").lower() for u in printings.get(oracle_id, [])}
        for code in codes - {""}:
            counts[code] = counts.get(code, 0) + 1

    names = await card_prints_repo.set_names(database, list(counts))
    rows = [
        CommanderSetOut(code=code, name=names.get(code) or code.upper(), commanders=n)
        for code, n in counts.items()
    ]
    rows.sort(key=lambda r: r.name.lower())
    return rows
