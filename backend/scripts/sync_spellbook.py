"""CLI: sync the Commander Spellbook combo database into MongoDB.

Reads MONGODB_URI from backend/.env. Run from backend/:
    python scripts/sync_spellbook.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.services import spellbook  # noqa: E402


async def main() -> int:
    await db.connect()
    if not await db.ping():
        print("ERROR: MongoDB is not reachable. Set MONGODB_URI in backend/.env.", file=sys.stderr)
        return 1
    print("Downloading Commander Spellbook combos and loading into MongoDB ...", file=sys.stderr)
    count = await spellbook.sync(db.get_db())
    print(f"Loaded {count} Commander-legal combos into the 'combos' collection.")
    await db.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
