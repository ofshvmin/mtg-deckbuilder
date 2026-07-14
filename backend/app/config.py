"""Application settings, loaded from environment / .env via pydantic-settings."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Database
    mongodb_uri: str = ""            # empty => backend runs but /health reports db_connected: false
    mongodb_db: str = "mtg_deckbuilder"

    # Auth
    jwt_secret: str = "dev-insecure-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 14

    # CORS (comma-separated exact origins, plus an optional regex for e.g. Vercel previews)
    cors_origins: str = "http://localhost:5173"
    cors_origin_regex: str = ""

    # SMTP (for password reset emails). Empty host => reset emails disabled.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""           # "Grimoire <noreply@example.com>"

    # The base URL of the frontend (for building reset links in emails).
    frontend_url: str = "http://localhost:5173"

    # Anthropic API (for the AI deck-brief feature). Empty => feature disabled.
    claude_api: str = ""
    claude_model: str = "claude-sonnet-5"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
