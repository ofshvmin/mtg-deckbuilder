"""CLI: sync Scryfall oracle cards into MongoDB.

Reads MONGODB_URI from backend/.env (or the environment). Run from backend/:
    python scripts/sync_scryfall.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.services import scryfall  # noqa: E402


async def main() -> int:
    await db.connect()
    if not await db.ping():
        print("ERROR: MongoDB is not reachable. Set MONGODB_URI in backend/.env.", file=sys.stderr)
        return 1
    print("Downloading Scryfall oracle cards and loading into MongoDB ...", file=sys.stderr)
    count = await scryfall.sync(db.get_db())
    print(f"Loaded {count} unique Oracle cards into the 'cards' collection.")
    await db.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
