"""Pool endpoint: the user's legal owned-card pool for a chosen commander or format."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import CardSummary, CurveBucket, PoolCard, PoolResponse
from ..services import formats
from ..services import pool as pool_service

router = APIRouter(tags=["pool"])


def _card_summary(c: dict) -> CardSummary:
    return CardSummary(
        oracle_id=c["_id"],
        name=c["name"],
        mana_cost=c.get("mana_cost", ""),
        cmc=c.get("cmc", 0.0),
        type_line=c.get("type_line", ""),
        color_identity=c.get("color_identity", []),
        oracle_text=c.get("oracle_text", ""),
        image_uris=c.get("image_uris"),
        image_uris_back=c.get("image_uris_back"),
    )


@router.get("/pool", response_model=PoolResponse)
async def get_pool(
    commander: str | None = None,
    format: str = Query("commander"),
    current_user: dict = Depends(get_current_user),
):
    """The user's legal owned pool.

    Commander needs a commander name (its identity defines the pool). Constructed
    formats need nothing at all — that's what makes zero-input auto-generate work,
    and the returned pool is deliberately unfiltered by color so the client can
    retoggle colors without refetching.
    """
    spec = formats.get_format(format)
    database = db.get_db()

    if spec.requires_commander:
        if not commander:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{spec.label} requires a commander."
            )
        try:
            result = await pool_service.get_pool(database, current_user["_id"], commander)
        except pool_service.CommanderNotFound as e:
            detail = f"No card found matching '{e.name}'."
            if e.suggestions:
                detail += " Did you mean: " + ", ".join(e.suggestions[:5])
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail)
    else:
        result = await pool_service.get_pool_for_format(database, current_user["_id"], spec)
        if not result.pool:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"No {spec.label}-legal cards in your collection.",
            )

    return PoolResponse(
        commander=_card_summary(result.commander) if result.commander else None,
        color_identity=result.color_identity,
        pool_size=len(result.pool),
        land_count=pool_service.land_count(result.pool),
        curve=[CurveBucket(**b) for b in pool_service.nonland_curve(result.pool)],
        format=spec.key,
        colors=result.colors,
        deck_size=spec.deck_size + (1 if spec.requires_commander else 0),
        max_copies=spec.max_copies,
        supports_upgrades=spec.supports_upgrades,
        pool=[
            PoolCard(
                oracle_id=d["_id"],
                name=d["name"],
                mana_cost=d.get("mana_cost", ""),
                cmc=d.get("cmc", 0.0),
                type_line=d.get("type_line", ""),
                color_identity=d.get("color_identity", []),
                copies_owned=d.get("copies_owned", 0),
                is_land=pool_service.is_land(d),
            )
            for d in result.pool
        ],
    )
