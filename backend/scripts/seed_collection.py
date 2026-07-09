"""CLI: import a Moxfield collection CSV into MongoDB for a user.

Pre-auth seed helper. Once auth + the upload endpoint exist (Phase C/D), the
same importer service runs per authenticated user. Run from backend/:

    python scripts/seed_collection.py [csv_path] [--user-id seed-user]

Defaults to ../app/data/collection.csv and user "seed-user".
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.services import importer  # noqa: E402

DEFAULT_CSV = Path(__file__).resolve().parents[2] / "app" / "data" / "collection.csv"


async def main(csv_path: Path, user_id: str) -> int:
    await db.connect()
    if not await db.ping():
        print("ERROR: MongoDB is not reachable. Set MONGODB_URI in backend/.env.", file=sys.stderr)
        return 1
    if not csv_path.exists():
        print(f"ERROR: CSV not found: {csv_path}", file=sys.stderr)
        return 1

    text = csv_path.read_text(encoding="utf-8-sig")
    result = await importer.import_collection(db.get_db(), user_id, text)

    print(f"Imported {result.total} rows for user '{user_id}': "
          f"{result.matched} matched, {result.unmatched} unmatched.")
    print(f"Unique distinct cards owned: {result.unique_owned}")
    if result.unmatched_names:
        preview = ", ".join(result.unmatched_names[:10])
        print(f"Unmatched names ({result.unmatched}): {preview}"
              + (" ..." if result.unmatched > 10 else ""))
    await db.disconnect()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", nargs="?", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--user-id", default="seed-user")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.csv_path, args.user_id)))
