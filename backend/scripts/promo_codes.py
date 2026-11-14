"""CLI: generate and track single-use promo codes for printed promo cards.

Each code grants one account `--days` of Premium when redeemed at
`<base-url>/redeem?code=XXXX-XXXX` — the URL the card's QR code encodes. Run
from backend/:

    python scripts/promo_codes.py generate --count 200 --batch magiccon-2026
    python scripts/promo_codes.py generate --count 50 --batch store-night --days 90 --expires 2027-06-30
    python scripts/promo_codes.py list --batch magiccon-2026

`generate` writes the codes to MongoDB (whatever MONGODB_URI points at — that is
production from backend/.env) and to a CSV of code + redeem URL, ready for
printing. `list` shows which codes have been redeemed.
"""
import argparse
import asyncio
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.repositories import promo_codes as promo_repo  # noqa: E402

DEFAULT_BASE_URL = "https://grimoire.dankodev.app"


def redeem_url(base_url: str, code: str) -> str:
    return f"{base_url.rstrip('/')}/redeem?code={promo_repo.display_code(code)}"


async def generate(args) -> int:
    expires_at = None
    if args.expires:
        # End of the given day, UTC — a card dated "until June 30" works all of June 30.
        day = datetime.strptime(args.expires, "%Y-%m-%d")
        expires_at = day.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc).isoformat()

    out = Path(args.out or f"promo-codes-{args.batch}.csv")
    if out.exists():
        print(f"ERROR: {out} already exists; pass --out to choose another file.", file=sys.stderr)
        return 1

    codes = await promo_repo.create_batch(
        db.get_db(), args.count, args.days, args.batch, expires_at
    )
    with out.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["code", "url", "days", "expires_at", "batch"])
        for code in codes:
            writer.writerow([
                promo_repo.display_code(code), redeem_url(args.base_url, code),
                args.days, expires_at or "", args.batch,
            ])
    print(f"Created {len(codes)} codes in batch '{args.batch}' ({args.days} days each).")
    print(f"Wrote {out}")
    return 0


async def list_codes(args) -> int:
    docs = await promo_repo.list_codes(db.get_db(), args.batch)
    if not docs:
        print("No promo codes." if not args.batch else f"No codes in batch '{args.batch}'.")
        return 0
    redeemed = [d for d in docs if d.get("redeemed_by")]
    for d in docs:
        status = f"redeemed {d['redeemed_at'][:10]}" if d.get("redeemed_by") else "unused"
        print(f"{promo_repo.display_code(d['_id'])}  {d['batch']:<20} {d['days']:>4}d  {status}")
    print(f"\n{len(redeemed)} of {len(docs)} redeemed.")
    return 0


async def main(args) -> int:
    await db.connect()
    if not await db.ping():
        print("ERROR: MongoDB is not reachable. Set MONGODB_URI in backend/.env.", file=sys.stderr)
        return 1
    try:
        return await (generate(args) if args.action == "generate" else list_codes(args))
    finally:
        await db.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)

    gen = sub.add_parser("generate", help="create a batch of codes and write a CSV")
    gen.add_argument("--count", type=int, required=True)
    gen.add_argument("--batch", required=True, help="label for this print run, e.g. magiccon-2026")
    gen.add_argument("--days", type=int, default=365, help="Premium days per code (default 365)")
    gen.add_argument("--expires", help="last day the code can be redeemed, YYYY-MM-DD (default: never)")
    gen.add_argument("--base-url", default=DEFAULT_BASE_URL)
    gen.add_argument("--out", help="CSV path (default promo-codes-<batch>.csv)")

    ls = sub.add_parser("list", help="show codes and whether they've been redeemed")
    ls.add_argument("--batch")

    args = parser.parse_args()
    if args.action == "generate" and not (0 < args.count <= 5000 and args.days > 0):
        parser.error("--count must be 1–5000 and --days positive")
    raise SystemExit(asyncio.run(main(args)))
