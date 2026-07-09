"""List your owned cards that are legal to play in a deck led by a given commander.

Usage:
    python query_pool.py "Atraxa, Praetors' Voice"

Filters your owned collection down to cards whose color identity is a subset
of the commander's color identity and that are legal in the Commander format
(excludes banned cards; does not yet special-case the "Game Changers" bracket
list, only the base ban list). This is the Phase 1 deliverable: given a
commander, see your legal card pool before any synergy/curve logic is applied.
"""
import argparse
import json
import sys

from db import get_connection, ensure_schema, normalize_name

COLOR_ORDER = ["W", "U", "B", "R", "G"]


def find_commander(conn, name: str):
    row = conn.execute(
        "SELECT * FROM cards WHERE name_normalized = ?", (normalize_name(name),)
    ).fetchone()
    if row is None:
        # fall back to a loose search so partial/typo'd names still get somewhere
        candidates = conn.execute(
            "SELECT name FROM cards WHERE name_normalized LIKE ? LIMIT 10",
            (f"%{normalize_name(name)}%",),
        ).fetchall()
        hint = ""
        if candidates:
            hint = "\nDid you mean:\n  " + "\n  ".join(c["name"] for c in candidates)
        raise SystemExit(f"No card found matching '{name}'.{hint}")
    return row


def format_color_identity(color_identity_json: str) -> str:
    colors = json.loads(color_identity_json or "[]")
    ordered = [c for c in COLOR_ORDER if c in colors]
    return "".join(ordered) if ordered else "C"  # colorless


def is_subset(card_colors_json: str, commander_colors: set) -> bool:
    card_colors = set(json.loads(card_colors_json or "[]"))
    return card_colors.issubset(commander_colors)


def get_legal_pool(conn, commander_name: str):
    commander = find_commander(conn, commander_name)
    commander_identity = set(json.loads(commander["color_identity"] or "[]"))

    owned = conn.execute("SELECT * FROM owned_cards").fetchall()
    pool = [
        row
        for row in owned
        if row["oracle_id"] != commander["oracle_id"]
        and row["legal_commander"] == "legal"
        and is_subset(row["color_identity"], commander_identity)
    ]
    return commander, commander_identity, pool


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commander", help="Exact or partial commander name")
    args = parser.parse_args()

    conn = get_connection()
    ensure_schema(conn)

    if conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0:
        sys.exit("cards table is empty - run scryfall_sync.py first.")
    if conn.execute("SELECT COUNT(*) FROM collection").fetchone()[0] == 0:
        sys.exit("collection table is empty - run import_collection.py first.")

    commander, identity, pool = get_legal_pool(conn, args.commander)

    print(f"Commander: {commander['name']}  (color identity: {format_color_identity(commander['color_identity'])})")
    print(f"Legal owned card pool: {len(pool)} unique cards\n")

    by_cmc = {}
    for row in sorted(pool, key=lambda r: (r["cmc"] or 0, r["name"])):
        by_cmc.setdefault(row["cmc"], []).append(row["name"])

    for cmc in sorted(by_cmc):
        names = by_cmc[cmc]
        print(f"CMC {cmc:g} ({len(names)}):")
        for n in names:
            print(f"  {n}")
    conn.close()


if __name__ == "__main__":
    main()
