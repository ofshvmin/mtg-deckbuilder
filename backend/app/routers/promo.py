"""Promo-card redemption: a printed single-use code buys one account free Premium.

Web only, by design. App Store guideline 3.1.1 bars unlocking features inside
the iOS app with our own codes, so the cards point at the web app. Premium is
account-wide, and the iOS app already honours the backend's `is_premium`, so a
code redeemed on the web unlocks the app too (multiplatform access, 3.1.3(b)).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import db
from ..auth.deps import get_current_user
from ..repositories import promo_codes as promo_repo
from ..repositories import users as users_repo

router = APIRouter(prefix="/promo", tags=["promo"])

# Failed attempts allowed per account per window. Codes are ~40 bits, so this is
# belt-and-braces against scripted guessing rather than the only defence.
MAX_FAILURES = 10
FAILURE_WINDOW_SECONDS = 3600


class RedeemRequest(BaseModel):
    code: str = Field(min_length=1, max_length=40)


class RedeemResponse(BaseModel):
    premium_until: str
    days: int


@router.post("/redeem", response_model=RedeemResponse)
async def redeem(body: RedeemRequest, current_user: dict = Depends(get_current_user)):
    database = db.get_db()

    if users_repo.promo_failures_in_window(current_user, FAILURE_WINDOW_SECONDS) >= MAX_FAILURES:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many attempts. Please wait an hour and try again.",
        )

    async def fail(code: int, message: str):
        await users_repo.record_promo_failure(database, current_user, FAILURE_WINDOW_SECONDS)
        raise HTTPException(code, message)

    code = promo_repo.normalize_code(body.code)
    doc = await promo_repo.find(database, code) if promo_repo.is_well_formed(code) else None
    if doc is None:
        await fail(status.HTTP_404_NOT_FOUND, "That code isn't valid. Check it and try again.")

    # Checks that cost the user nothing come before anything is written, so a
    # code is never burned on an account that can't use it.
    if doc["redeemed_by"] == current_user["_id"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already redeemed this code.")
    if doc["redeemed_by"] is not None:
        await fail(status.HTTP_409_CONFLICT, "That code has already been redeemed.")
    if doc.get("expires_at") and doc["expires_at"] <= datetime.now(timezone.utc).isoformat():
        await fail(status.HTTP_410_GONE, "That code has expired.")
    if current_user.get("promo"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This account has already redeemed a promo code."
        )
    if users_repo.is_premium(current_user):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This account already has Premium — pass the card on to a friend!",
        )

    now = datetime.now(timezone.utc)
    until = (now + timedelta(days=doc["days"])).isoformat()
    promo = {"code": code, "until": until, "redeemed_at": now.isoformat()}
    if not await users_repo.reserve_promo(database, current_user["_id"], promo):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This account has already redeemed a promo code."
        )
    if await promo_repo.claim(database, code, current_user["_id"]) is None:
        # Someone else claimed it between our read and now.
        await users_repo.release_promo(database, current_user["_id"], code)
        raise HTTPException(status.HTTP_409_CONFLICT, "That code has already been redeemed.")

    return RedeemResponse(premium_until=until, days=doc["days"])
