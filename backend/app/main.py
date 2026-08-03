"""FastAPI application entrypoint.

Run locally from the backend/ directory:
    uvicorn app.main:app --reload
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .auth.routes import router as auth_router
from .config import get_settings
from .routers.collection import router as collection_router
from .routers.commanders import router as commanders_router
from .routers.decks import router as decks_router
from .routers.explore import router as explore_router
from .routers.pool import router as pool_router
from .routers.webhooks import router as webhooks_router

settings = get_settings()

log = logging.getLogger("uvicorn.error")


def _warn_if_email_disabled() -> None:
    """Say out loud when password-reset email cannot be sent.

    /auth/forgot-password always returns 200 so it cannot leak whether an
    account exists, which means a dead mailer is indistinguishable from a
    working one to every client. Prod ran for months with no SMTP secrets set
    at all and nothing surfaced it. Startup is the one place that can.
    """
    missing = [
        name
        for name, value in (
            ("SMTP_HOST", settings.smtp_host),
            ("SMTP_FROM", settings.smtp_from),
        )
        if not value
    ]
    if missing:
        log.warning(
            "SMTP not configured (%s unset) — password reset emails are DISABLED. "
            "/auth/forgot-password will still return 200.",
            ", ".join(missing),
        )
        return
    # Host and sender alone satisfy send_reset_email's check, so an unauthenticated
    # relay looks configured right up until the send is rejected.
    if not settings.smtp_password:
        log.warning(
            "SMTP_HOST is set but SMTP_PASSWORD is not — reset emails will fail "
            "against any relay that requires authentication."
        )
    if settings.frontend_url.startswith("http://localhost"):
        log.warning(
            "FRONTEND_URL is still %s — password reset links will point at localhost.",
            settings.frontend_url,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to Mongo (no-op if MONGODB_URI is unset) and build indexes.
    await db.connect()
    _warn_if_email_disabled()
    yield
    # Shutdown: close the client.
    await db.disconnect()


app = FastAPI(title="MTG Deck Builder API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(collection_router)
app.include_router(commanders_router)
app.include_router(pool_router)
app.include_router(decks_router)
app.include_router(explore_router)
app.include_router(webhooks_router)


@app.get("/livez")
async def livez():
    """Fast liveness probe with NO dependencies — used by the Fly health check so
    the machine stays routable even when the database is briefly unreachable."""
    return {"status": "ok"}


@app.get("/health")
async def health():
    """Readiness: liveness + DB connectivity, for smoke tests and monitoring."""
    return {
        "status": "ok",
        "service": "mtg-deckbuilder-backend",
        "version": app.version,
        "db_configured": bool(settings.mongodb_uri),
        "db_connected": await db.ping(),
    }
