-- MTG Deck Builder — SQLite schema
-- cards: one row per unique Oracle card (from Scryfall's "oracle_cards" bulk file).
-- collection: one row per line in your Moxfield collection CSV export (per printing/foil/condition).

CREATE TABLE IF NOT EXISTS cards (
    oracle_id       TEXT PRIMARY KEY,
    name            TEXT NOT NULL,       -- "Front // Back" for multi-faced cards, matches Moxfield's Name column
    name_normalized TEXT NOT NULL,       -- lowercased/trimmed, for matching against collection CSV rows
    mana_cost       TEXT,                -- e.g. "{2}{W}{W}"; empty for lands/back faces
    cmc             REAL,
    type_line       TEXT,
    oracle_text     TEXT,                -- combined text of all faces, newline separated
    colors          TEXT,                -- JSON list, e.g. ["W","U"]
    color_identity  TEXT,                -- JSON list, e.g. ["W","U"] -- used for Commander legality
    keywords        TEXT,                -- JSON list, e.g. ["Flying","Trample"]
    produced_mana   TEXT,                -- JSON list if the card can tap for mana, else null
    power           TEXT,
    toughness       TEXT,
    loyalty         TEXT,
    layout          TEXT,                -- "normal", "transform", "modal_dfc", "split", etc.
    legal_commander TEXT,                -- "legal" | "not_legal" | "banned" | "restricted"
    is_basic_land   INTEGER DEFAULT 0,
    released_at     TEXT,
    updated_at      TEXT                 -- when our local sync last touched this row
);

CREATE INDEX IF NOT EXISTS idx_cards_name_normalized ON cards(name_normalized);

CREATE TABLE IF NOT EXISTS collection (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    count           INTEGER NOT NULL,
    tradelist_count INTEGER,
    name            TEXT NOT NULL,       -- as it appears in the Moxfield CSV
    name_normalized TEXT NOT NULL,
    edition         TEXT,                -- Scryfall set code, Moxfield's "Edition" column
    condition       TEXT,
    language        TEXT,
    foil            TEXT,                -- "", "foil", "etched"
    tags            TEXT,
    collector_number TEXT,
    altered         TEXT,
    proxy           TEXT,
    purchase_price  REAL,
    oracle_id       TEXT,                -- FK to cards.oracle_id once matched; NULL if unmatched
    FOREIGN KEY (oracle_id) REFERENCES cards(oracle_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_oracle_id ON collection(oracle_id);
CREATE INDEX IF NOT EXISTS idx_collection_name_normalized ON collection(name_normalized);

-- Convenience view: one row per unique card you own at least one copy of,
-- with total copies owned across all printings/foils.
CREATE VIEW IF NOT EXISTS owned_cards AS
SELECT
    c.oracle_id,
    c.name,
    c.mana_cost,
    c.cmc,
    c.type_line,
    c.oracle_text,
    c.colors,
    c.color_identity,
    c.keywords,
    c.produced_mana,
    c.legal_commander,
    c.is_basic_land,
    SUM(col.count) AS copies_owned
FROM collection col
JOIN cards c ON c.oracle_id = col.oracle_id
GROUP BY c.oracle_id;
