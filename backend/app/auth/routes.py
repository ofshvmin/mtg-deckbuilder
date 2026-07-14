"""Auth endpoints: register, login, refresh, me, password reset."""
from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db
from ..config import get_settings
from ..models.user import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdatePreferencesRequest,
    UserPreferences,
    UserResponse,
)
from ..repositories import users as users_repo
from ..services import email as email_service
from . import security
from .deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens_for(user_id: str) -> TokenResponse:
    return TokenResponse(
        access_token=security.create_access_token(user_id),
        refresh_token=security.create_refresh_token(user_id),
    )


def _public(user: dict) -> UserResponse:
    return UserResponse(
        id=user["_id"],
        email=user["email"],
        created_at=user["created_at"],
        preferences=UserPreferences(**(user.get("preferences") or {})),
    )


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


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
async def forgot_password(body: ForgotPasswordRequest):
    """Send a password-reset email. Always returns 200 to avoid leaking
    whether an account exists for the given email.
    """
    database = db.get_db()
    user = await users_repo.find_by_email(database, body.email)
    if user and users_repo.local_identity(user):
        token = security.create_reset_token(user["_id"])
        settings = get_settings()
        reset_url = f"{settings.frontend_url}/reset-password?token={token}"
        email_service.send_reset_email(user["email"], reset_url)
    return {"ok": True}


@router.post("/reset-password", response_model=TokenResponse)
async def reset_password(body: ResetPasswordRequest):
    """Set a new password using a valid reset token. Returns auth tokens so
    the user is logged in immediately after resetting.
    """
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link.")
    try:
        payload = security.decode_token(body.token)
    except jwt.PyJWTError:
        raise invalid
    if payload.get("type") != security.RESET:
        raise invalid
    user_id = payload.get("sub", "")
    database = db.get_db()
    user = await users_repo.find_by_id(database, user_id)
    if user is None or users_repo.local_identity(user) is None:
        raise invalid
    new_hash = security.hash_password(body.password)
    await users_repo.update_password(database, user_id, new_hash)
    return _tokens_for(user_id)


@router.get("/me", response_model=UserResponse)
async def me(current_user: dict = Depends(get_current_user)):
    return _public(current_user)


@router.patch("/preferences", response_model=UserResponse)
async def update_preferences(
    body: UpdatePreferencesRequest, current_user: dict = Depends(get_current_user)
):
    updated = await users_repo.update_preferences(
        db.get_db(), current_user["_id"], body.model_dump()
    )
    return _public(updated or current_user)
