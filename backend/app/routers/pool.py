"""Pool endpoint: the user's legal owned-card pool for a chosen commander."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import CardSummary, CurveBucket, PoolCard, PoolResponse
from ..services import pool as pool_service

router = APIRouter(tags=["pool"])


@router.get("/pool", response_model=PoolResponse)
async def get_pool(
    commander: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        result = await pool_service.get_pool(db.get_db(), current_user["_id"], commander)
    except pool_service.CommanderNotFound as e:
        detail = f"No card found matching '{e.name}'."
        if e.suggestions:
            detail += " Did you mean: " + ", ".join(e.suggestions[:5])
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail)

    c = result.commander
    return PoolResponse(
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
        pool_size=len(result.pool),
        land_count=pool_service.land_count(result.pool),
        curve=[CurveBucket(**b) for b in pool_service.nonland_curve(result.pool)],
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
