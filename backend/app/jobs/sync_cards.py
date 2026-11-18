"""Refresh the card database: Scryfall oracle cards, then printings, then the
Commander Spellbook combos.

    python -m app.jobs.sync_cards

Runs daily on a scheduled Fly machine (see HANDOFF.md, "Scheduled card sync"),
so a new set's cards, art and the market prices stay current without anyone
remembering to run the sync scripts. Lives in `app/` so it ships in the API's
image and reads the same MONGODB_URI secret.

All three syncs upsert in place and then prune, so the live API keeps serving
throughout. The combo sync also refuses to prune when the feed comes back much
smaller than what's stored. Exits non-zero if either fails, so a failed run shows in the
machine's logs and exit status rather than passing silently.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time

from .. import db
from ..services import card_prints, scryfall, spellbook

log = logging.getLogger("sync_cards")


async def run() -> int:
    await db.connect()
    try:
        if not await db.ping():
            log.error("MongoDB is not reachable; check MONGODB_URI.")
            return 1
        database = db.get_db()

        started = time.monotonic()
        cards = await scryfall.sync(database)
        log.info("cards: %d oracle cards (%.0fs)", cards, time.monotonic() - started)

        started = time.monotonic()
        prints = await card_prints.sync(database)
        log.info("card_prints: %d printings (%.0fs)", prints, time.monotonic() - started)

        started = time.monotonic()
        combos = await spellbook.sync(database)
        log.info("combos: %d combos (%.0fs)", combos, time.monotonic() - started)
        return 0
    except Exception:
        log.exception("Card sync failed")
        return 1
    finally:
        await db.disconnect()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    sys.exit(asyncio.run(run()))
