"""FastAPI dependency that resolves the current user from a Bearer access token."""
from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .. import db
from ..repositories import users as users_repo
from . import security

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if credentials is None:
        raise _UNAUTHORIZED
    try:
        payload = security.decode_token(credentials.credentials)
    except jwt.PyJWTError:
        raise _UNAUTHORIZED
    if payload.get("type") != security.ACCESS:
        raise _UNAUTHORIZED
    user = await users_repo.find_by_id(db.get_db(), payload.get("sub", ""))
    if user is None:
        raise _UNAUTHORIZED
    return user
