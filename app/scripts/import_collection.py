"""Import a Moxfield-format collection CSV into the local database.

Usage:
    python import_collection.py path/to/collection.csv

Expected columns (Moxfield's collection export/import format):
Count, Tradelist Count, Name, Edition, Condition, Language, Foil, Tags,
Last Modified, Collector Number, Alter, Proxy, Purchase Price

Requires the `cards` table to already be populated by scryfall_sync.py -
each row is matched to a card by normalized name. Unmatched rows (e.g. a
typo, a card too new for your last sync, or a non-paper/funny card Scryfall
excludes from oracle_cards) are reported at the end and written to
unmatched_cards.csv for review; they simply won't be considered part of your
usable collection until resolved.
"""
import argparse
import csv
import sys
from pathlib import Path

from db import get_connection, ensure_schema, normalize_name


def parse_float(value: str):
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def parse_int(value: str, default=0):
    try:
        return int(value) if value not in (None, "") else default
    except ValueError:
        return default


def import_csv(csv_path: Path) -> None:
    conn = get_connection()
    ensure_schema(conn)

    name_to_oracle_id = {
        row["name_normalized"]: row["oracle_id"]
        for row in conn.execute("SELECT oracle_id, name_normalized FROM cards")
    }
    if not name_to_oracle_id:
        print(
            "WARNING: the cards table is empty. Run scryfall_sync.py first, "
            "otherwise every row here will be 'unmatched'.",
            file=sys.stderr,
        )

    conn.execute("DELETE FROM collection;")

    matched, unmatched = 0, []
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["Name"].strip()
            name_norm = normalize_name(name)
            oracle_id = name_to_oracle_id.get(name_norm)
            if oracle_id is None:
                unmatched.append(row)
            else:
                matched += 1
            conn.execute(
                """
                INSERT INTO collection (
                    count, tradelist_count, name, name_normalized, edition, condition,
                    language, foil, tags, collector_number, altered, proxy, purchase_price, oracle_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    parse_int(row.get("Count"), 1),
                    parse_int(row.get("Tradelist Count"), 0),
                    name,
                    name_norm,
                    row.get("Edition"),
                    row.get("Condition"),
                    row.get("Language"),
                    row.get("Foil"),
                    row.get("Tags"),
                    row.get("Collector Number"),
                    row.get("Alter"),
                    row.get("Proxy"),
                    parse_float(row.get("Purchase Price")),
                    oracle_id,
                ),
            )
    conn.commit()

    total_rows = matched + len(unmatched)
    print(f"Imported {total_rows} collection rows: {matched} matched, {len(unmatched)} unmatched.")

    if unmatched:
        report_path = csv_path.parent / "unmatched_cards.csv"
        with open(report_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=unmatched[0].keys())
            writer.writeheader()
            writer.writerows(unmatched)
        print(f"Unmatched rows written to {report_path}")

    unique_owned = conn.execute("SELECT COUNT(*) FROM owned_cards").fetchone()[0]
    print(f"Unique distinct cards owned (at least 1 copy): {unique_owned}")
    conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path, help="Path to the Moxfield collection CSV export")
    args = parser.parse_args()
    import_csv(args.csv_path)


if __name__ == "__main__":
    main()
