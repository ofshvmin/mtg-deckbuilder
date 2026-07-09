"""Download Scryfall's Oracle card data and load it into the local cards table.

IMPORTANT: This script needs to reach api.scryfall.com and a scryfall-hosted
download URL over the internet. Run it on your own machine (not inside a
restricted sandbox) - e.g.:

    python scryfall_sync.py

It's safe to re-run any time; it fully replaces the cards table with the
latest data. Scryfall regenerates the "oracle_cards" bulk file (one row per
unique card, not per printing) roughly daily, so running this weekly or after
each new set release is plenty.

Per Scryfall's API policy: requests are sent with a descriptive User-Agent
and Accept header, and this script makes only two HTTP requests total (one
to look up the current bulk-data download URL, one to fetch the file), well
within their 10 req/sec guidance.
"""
import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone

from db import get_connection, ensure_schema, normalize_name

BULK_DATA_INDEX_URL = "https://api.scryfall.com/bulk-data"
USER_AGENT = "MTGDeckBuilder/0.1 (personal project; contact: daniel.g.mathews@gmail.com)"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json;q=0.9,*/*;q=0.8"}

BASIC_LAND_NAMES = {"plains", "island", "swamp", "mountain", "forest", "wastes"}


def _get_json(url: str):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def find_oracle_cards_download_uri() -> str:
    index = _get_json(BULK_DATA_INDEX_URL)
    for item in index["data"]:
        if item["type"] == "oracle_cards":
            return item["download_uri"]
    raise RuntimeError("Could not find 'oracle_cards' entry in Scryfall bulk-data index.")


def download_oracle_cards(download_uri: str):
    req = urllib.request.Request(download_uri, headers=HEADERS)
    print(f"Downloading {download_uri} ...", file=sys.stderr)
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    print(f"Downloaded {len(data)} cards.", file=sys.stderr)
    return data


def extract_faces_text(card: dict) -> str:
    """Oracle text for transform/modal/split cards lives on `card_faces`, not
    the top-level `oracle_text`. Combine both faces so text-based rules
    (role tagging, combo search) always have something to match against."""
    if card.get("oracle_text"):
        return card["oracle_text"]
    faces = card.get("card_faces") or []
    return "\n//\n".join(f.get("oracle_text", "") for f in faces if f.get("oracle_text"))


def extract_mana_cost(card: dict) -> str:
    if card.get("mana_cost"):
        return card["mana_cost"]
    faces = card.get("card_faces") or []
    return " // ".join(f.get("mana_cost", "") for f in faces if f.get("mana_cost"))


def row_from_card(card: dict) -> dict:
    name = card["name"]
    return {
        "oracle_id": card["oracle_id"],
        "name": name,
        "name_normalized": normalize_name(name),
        "mana_cost": extract_mana_cost(card),
        "cmc": card.get("cmc"),
        "type_line": card.get("type_line", ""),
        "oracle_text": extract_faces_text(card),
        "colors": json.dumps(card.get("colors", [])),
        "color_identity": json.dumps(card.get("color_identity", [])),
        "keywords": json.dumps(card.get("keywords", [])),
        "produced_mana": json.dumps(card["produced_mana"]) if card.get("produced_mana") else None,
        "power": card.get("power"),
        "toughness": card.get("toughness"),
        "loyalty": card.get("loyalty"),
        "layout": card.get("layout"),
        "legal_commander": card.get("legalities", {}).get("commander", "not_legal"),
        "is_basic_land": 1 if name.lower() in BASIC_LAND_NAMES else 0,
        "released_at": card.get("released_at"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def load_into_db(cards: list[dict]) -> None:
    conn = get_connection()
    ensure_schema(conn)
    rows = [row_from_card(c) for c in cards]
    conn.execute("DELETE FROM cards;")
    conn.executemany(
        """
        INSERT INTO cards (
            oracle_id, name, name_normalized, mana_cost, cmc, type_line, oracle_text,
            colors, color_identity, keywords, produced_mana, power, toughness, loyalty,
            layout, legal_commander, is_basic_land, released_at, updated_at
        ) VALUES (
            :oracle_id, :name, :name_normalized, :mana_cost, :cmc, :type_line, :oracle_text,
            :colors, :color_identity, :keywords, :produced_mana, :power, :toughness, :loyalty,
            :layout, :legal_commander, :is_basic_land, :released_at, :updated_at
        )
        """,
        rows,
    )
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"Loaded {count} unique Oracle cards into {conn.execute('PRAGMA database_list').fetchone()[2]}")
    conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    download_uri = find_oracle_cards_download_uri()
    cards = download_oracle_cards(download_uri)
    load_into_db(cards)


if __name__ == "__main__":
    main()
