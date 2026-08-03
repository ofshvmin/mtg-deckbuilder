"""CLI: permanently exempt accounts from paywall limits (no purchase involved).

Sets `premium_exempt` on the user document, which `is_premium` honours ahead of
the RevenueCat entitlement — so the grant never expires and webhook syncs can't
clear it. Run from backend/:

    python scripts/premium_exempt.py list
    python scripts/premium_exempt.py grant test@danko.com liliana@test.com
    python scripts/premium_exempt.py revoke test@danko.com

The PREMIUM_EXEMPT_EMAILS env var does the same thing without database access;
use this script when you'd rather not redeploy/restart to change the list.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.repositories import users as users_repo  # noqa: E402


async def main(action: str, emails: list[str]) -> int:
    await db.connect()
    if not await db.ping():
        print("ERROR: MongoDB is not reachable. Set MONGODB_URI in backend/.env.", file=sys.stderr)
        return 1
    database = db.get_db()

    if action == "list":
        cursor = database.users.find({"premium_exempt": True}, {"email": 1})
        found = [doc.get("email") async for doc in cursor]
        print("\n".join(found) if found else "No exempt accounts.")
        await db.disconnect()
        return 0

    exit_code = 0
    for email in emails:
        ok = await users_repo.set_premium_exempt(database, email, action == "grant")
        if ok:
            print(f"{'Exempted' if action == 'grant' else 'Revoked'}: {email}")
        else:
            print(f"No such user: {email}", file=sys.stderr)
            exit_code = 1
    await db.disconnect()
    return exit_code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["grant", "revoke", "list"])
    parser.add_argument("emails", nargs="*", help="account emails (not needed for `list`)")
    args = parser.parse_args()
    if args.action != "list" and not args.emails:
        parser.error(f"`{args.action}` needs at least one email")
    raise SystemExit(asyncio.run(main(args.action, args.emails)))
