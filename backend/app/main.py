"""FastAPI application entrypoint.

Run locally from the backend/ directory:
    uvicorn app.main:app --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .auth.routes import router as auth_router
from .config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to Mongo (no-op if MONGODB_URI is unset) and build indexes.
    await db.connect()
    yield
    # Shutdown: close the client.
    await db.disconnect()


app = FastAPI(title="MTG Deck Builder API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.get("/health")
async def health():
    """Liveness + DB connectivity, for smoke tests and container health checks."""
    return {
        "status": "ok",
        "service": "mtg-deckbuilder-backend",
        "version": app.version,
        "db_configured": bool(settings.mongodb_uri),
        "db_connected": await db.ping(),
    }
