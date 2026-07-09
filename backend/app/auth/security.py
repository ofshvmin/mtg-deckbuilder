"""Password hashing (argon2) and JWT creation/verification.

Kept provider-agnostic and stateless: whatever proves identity (a password
check now, a Google/Apple ID-token check later), the result is one of *our*
JWTs. Tokens carry `sub` (user id) and `type` ("access" | "refresh").
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error

from ..config import get_settings

_ph = PasswordHasher()

ACCESS = "access"
REFRESH = "refresh"


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (Argon2Error, Exception):
        return False


def _create_token(sub: str, token_type: str, expires_delta: timedelta) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(sub: str) -> str:
    settings = get_settings()
    return _create_token(sub, ACCESS, timedelta(minutes=settings.access_token_minutes))


def create_refresh_token(sub: str) -> str:
    settings = get_settings()
    return _create_token(sub, REFRESH, timedelta(days=settings.refresh_token_days))


def decode_token(token: str) -> dict:
    """Decode + verify a JWT. Raises jwt.PyJWTError on any invalid/expired token."""
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
