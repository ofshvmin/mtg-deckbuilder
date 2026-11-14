"""Commander picker: search the user's owned commander-eligible cards."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import CommanderOption
from ..repositories import cards as cards_repo
from ..repositories import collection as collection_repo

router = APIRouter(prefix="/commanders", tags=["commanders"])


@router.get("", response_model=list[CommanderOption])
async def search_commanders(
    q: str = "",
    limit: int = Query(20, ge=1, le=200),
    colors: str = Query("", pattern="^[WUBRGC]*$"),
    max_mv: float | None = Query(None, ge=0),
    creature_type: str = "",
    current_user: dict = Depends(get_current_user),
):
    """`colors` is an exact color identity as WUBRG letters ("GW"), plus "C" for
    a colorless {C} pip in the cost ("WUBRGC" finds Ulalek); "C" alone means
    colorless commanders. Every filter is optional, so older clients sending only
    `q` and `limit` get the same results as before."""
    database = db.get_db()
    owned = await collection_repo.owned_counts(database, current_user["_id"])
    docs = await cards_repo.search_owned_commanders(
        database,
        list(owned.keys()),
        query=q,
        limit=limit,
        colors=list(colors),
        max_mv=max_mv,
        creature_type=creature_type,
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
