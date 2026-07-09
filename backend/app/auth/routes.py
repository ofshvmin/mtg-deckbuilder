"""Auth endpoints: register, login, refresh, me."""
from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db
from ..models.user import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from ..repositories import users as users_repo
from . import security
from .deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens_for(user_id: str) -> TokenResponse:
    return TokenResponse(
        access_token=security.create_access_token(user_id),
        refresh_token=security.create_refresh_token(user_id),
    )


def _public(user: dict) -> UserResponse:
    return UserResponse(id=user["_id"], email=user["email"], created_at=user["created_at"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest):
    database = db.get_db()
    if await users_repo.find_by_email(database, body.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists.")
    user = await users_repo.create_local_user(
        database, body.email, security.hash_password(body.password)
    )
    return _tokens_for(user["_id"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    database = db.get_db()
    user = await users_repo.find_by_email(database, body.email)
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    if user is None:
        raise invalid
    identity = users_repo.local_identity(user)
    if identity is None or not security.verify_password(body.password, identity["password_hash"]):
        raise invalid
    return _tokens_for(user["_id"])


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token.")
    try:
        payload = security.decode_token(body.refresh_token)
    except jwt.PyJWTError:
        raise invalid
    if payload.get("type") != security.REFRESH:
        raise invalid
    user = await users_repo.find_by_id(db.get_db(), payload.get("sub", ""))
    if user is None:
        raise invalid
    # Rotate both tokens on refresh.
    return _tokens_for(user["_id"])


@router.get("/me", response_model=UserResponse)
async def me(current_user: dict = Depends(get_current_user)):
    return _public(current_user)
