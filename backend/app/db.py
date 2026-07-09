"""MongoDB connection management using PyMongo's native async client.

Uses `AsyncMongoClient` (PyMongo >= 4.9), the officially recommended successor
to the now-deprecated Motor driver. The client is created once at app startup
(see main.py's lifespan) and shared across requests.

If MONGODB_URI is unset, the app still starts but `ping()` returns False and
`get_db()` raises — this keeps Phase A runnable before Atlas credentials exist.
"""
from __future__ import annotations

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from .config import get_settings

_client: AsyncMongoClient | None = None


async def connect() -> None:
    """Create the client and verify connectivity. Called on startup."""
    global _client
    settings = get_settings()
    if not settings.mongodb_uri:
        return
    _client = AsyncMongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
    await _client.admin.command("ping")  # fail fast if credentials/URI are wrong
    await ensure_indexes(_client[settings.mongodb_db])


async def disconnect() -> None:
    """Close the client. Called on shutdown."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None


def get_client() -> AsyncMongoClient:
    if _client is None:
        raise RuntimeError("MongoDB is not connected (MONGODB_URI unset or connect() not run).")
    return _client


def get_db() -> AsyncDatabase:
    return get_client()[get_settings().mongodb_db]


async def ping() -> bool:
    """True if the database answers a ping, else False (never raises)."""
    if _client is None:
        return False
    try:
        await _client.admin.command("ping")
        return True
    except Exception:
        return False


async def ensure_indexes(db: AsyncDatabase) -> None:
    """Create the indexes the app relies on. Idempotent — safe to run every startup."""
    await db.cards.create_index("name_normalized")
    await db.cards.create_index("color_identity")   # multikey — color-identity subset queries
    await db.cards.create_index("legal_commander")
    await db.cards.create_index("cmc")

    await db.users.create_index("email", unique=True)

    await db.collection_items.create_index([("user_id", 1), ("oracle_id", 1)])

    await db.decks.create_index([("user_id", 1), ("updated_at", -1)])

    await db.combos.create_index("cards")     # multikey — combo detection by owned oracle_ids
    await db.combos.create_index("identity")
