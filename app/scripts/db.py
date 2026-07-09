"""Shared SQLite connection helper for the MTG Deck Builder scripts.

Run any of the scripts in this folder with `python <script>.py --help` for usage.
"""
import sqlite3
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPTS_DIR.parent
DB_PATH = APP_DIR / "data" / "mtg.db"
SCHEMA_PATH = SCRIPTS_DIR / "schema.sql"


def get_connection(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def ensure_schema(conn: sqlite3.Connection, schema_path: Path = SCHEMA_PATH) -> None:
    with open(schema_path, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()


def normalize_name(name: str) -> str:
    """Normalize a card name for matching between Scryfall data and the collection CSV."""
    return " ".join(name.strip().lower().split())
