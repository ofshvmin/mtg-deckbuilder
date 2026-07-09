"""User + auth request/response schemas.

The Mongo `users` doc is provider-agnostic:
  { _id: uuid, email, identities: [{provider, provider_user_id?, password_hash?}], created_at }
so Google/Apple identities can be appended later with no migration.
"""
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    created_at: str
