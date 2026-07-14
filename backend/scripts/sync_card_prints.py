"""CLI: sync Scryfall per-printing image URLs into MongoDB.

Run from backend/:
    python scripts/sync_card_prints.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.services import card_prints  # noqa: E402


async def main() -> int:
    await db.connect()
    if not await db.ping():
        print("ERROR: MongoDB is not reachable. Set MONGODB_URI in backend/.env.", file=sys.stderr)
        return 1
    print("Downloading Scryfall default_cards (this may take a minute)...", file=sys.stderr)
    n = await card_prints.sync(db.get_db())
    print(f"Loaded {n} per-printing image records into 'card_prints'.")
    await db.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
