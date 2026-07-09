"""Auto-detection and normalization for multiple collection CSV/Excel formats.

Supports: Moxfield, Archidekt, Dragon Shield, Deckbox, ManaBox.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass

import openpyxl


@dataclass(frozen=True)
class CsvFormat:
    name: str
    required_headers: frozenset[str]
    discriminator_headers: frozenset[str]
    column_map: dict[str, str]  # format column → canonical field name


# Canonical field names mirror CollectionItem fields:
#   name, count, edition, condition, language, foil, tags,
#   collector_number, purchase_price, tradelist_count, altered, proxy

FORMATS: list[CsvFormat] = [
    CsvFormat(
        name="Moxfield",
        required_headers=frozenset({"Name", "Count", "Edition"}),
        discriminator_headers=frozenset({"Tradelist Count"}),
        column_map={
            "Name": "name",
            "Count": "count",
            "Edition": "edition",
            "Condition": "condition",
            "Language": "language",
            "Foil": "foil",
            "Tags": "tags",
            "Collector Number": "collector_number",
            "Purchase Price": "purchase_price",
            "Tradelist Count": "tradelist_count",
            "Alter": "altered",
            "Proxy": "proxy",
        },
    ),
    CsvFormat(
        name="Archidekt",
        required_headers=frozenset({"Name", "Quantity", "Edition Code"}),
        discriminator_headers=frozenset({"Edition Name"}),
        column_map={
            "Name": "name",
            "Quantity": "count",
            "Edition Code": "edition",
            "Finish": "foil",
            "Collector Number": "collector_number",
        },
    ),
    CsvFormat(
        name="Dragon Shield",
        required_headers=frozenset({"Card Name", "Quantity", "Set Code"}),
        discriminator_headers=frozenset({"Folder Name"}),
        column_map={
            "Card Name": "name",
            "Quantity": "count",
            "Set Code": "edition",
            "Printing": "foil",
            "Card Number": "collector_number",
        },
    ),
    CsvFormat(
        name="Deckbox",
        required_headers=frozenset({"Name", "Count", "Edition Code"}),
        discriminator_headers=frozenset({"My Price"}),
        column_map={
            "Name": "name",
            "Count": "count",
            "Edition Code": "edition",
            "Condition": "condition",
            "Language": "language",
            "Foil": "foil",
        },
    ),
    CsvFormat(
        name="ManaBox",
        required_headers=frozenset({"Name", "Quantity", "Set code"}),
        discriminator_headers=frozenset({"Scryfall ID", "Set code"}),
        column_map={
            "Name": "name",
            "Quantity": "count",
            "Set code": "edition",
            "Foil": "foil",
            "Collector Number": "collector_number",
            "Language": "language",
            "Condition": "condition",
            "Purchase Price": "purchase_price",
        },
    ),
]

_FORMAT_BY_NAME: dict[str, CsvFormat] = {fmt.name: fmt for fmt in FORMATS}

# Values that mean "foil" across formats (case-insensitive).
_FOIL_VALUES = {"foil", "etched"}


def parse_csv(text: str) -> tuple[list[str], list[dict[str, str]]]:
    """Parse CSV text into (headers, rows-as-dicts)."""
    text = preprocess_csv(text)
    reader = csv.DictReader(io.StringIO(text))
    return list(reader.fieldnames or []), list(reader)


def parse_excel(raw: bytes) -> tuple[list[str], list[dict[str, str]]]:
    """Parse an XLSX file into (headers, rows-as-dicts)."""
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.active
    row_iter = ws.iter_rows(values_only=True)
    headers = [str(c or "").strip() for c in next(row_iter)]
    rows = [{h: str(v or "") for h, v in zip(headers, row)} for row in row_iter]
    wb.close()
    return headers, rows


def preprocess_csv(text: str) -> str:
    """Strip Dragon Shield's ``sep=,`` first line if present."""
    if text.startswith("sep="):
        _, _, rest = text.partition("\n")
        return rest
    return text


def detect_format(headers: list[str]) -> CsvFormat | None:
    """Match CSV headers to a known format. Returns ``None`` if no match."""
    header_set = {h.strip() for h in headers}
    best: CsvFormat | None = None
    best_score = -1
    for fmt in FORMATS:
        if not fmt.required_headers.issubset(header_set):
            continue
        score = len(fmt.discriminator_headers & header_set)
        if score > best_score:
            best = fmt
            best_score = score
    return best


def get_format_by_name(name: str) -> CsvFormat | None:
    """Look up a format by its display name (case-insensitive)."""
    return _FORMAT_BY_NAME.get(name) or next(
        (f for f in FORMATS if f.name.lower() == name.lower()), None
    )


def normalize_row(row: dict[str, str], fmt: CsvFormat) -> dict[str, str]:
    """Map a CSV row through a format's column_map to canonical field names."""
    canonical: dict[str, str] = {}
    for src_col, dest_field in fmt.column_map.items():
        val = row.get(src_col, "")
        if dest_field == "foil":
            val = "foil" if val.strip().lower() in _FOIL_VALUES else ""
        canonical[dest_field] = val
    return canonical


def _reverse_map(fmt: CsvFormat) -> dict[str, str]:
    """Canonical field → format-specific column name."""
    return {v: k for k, v in fmt.column_map.items()}


def _format_foil(value: str, fmt: CsvFormat) -> str:
    """Convert canonical 'foil' back to format-specific value."""
    if not value:
        return ""
    rev = _reverse_map(fmt)
    foil_col = rev.get("foil", "")
    if foil_col == "Printing":   # Dragon Shield
        return "Foil"
    if foil_col == "Finish":     # Archidekt
        return "Foil"
    return "foil"                # Moxfield, Deckbox, ManaBox


def export_rows_csv(rows: list[dict], fmt: CsvFormat) -> str:
    """Convert canonical rows to CSV text in the given format."""
    rev = _reverse_map(fmt)
    headers = list(fmt.column_map.keys())
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        out: dict[str, str] = {}
        for col in headers:
            canonical_field = fmt.column_map[col]
            val = row.get(canonical_field, "")
            if canonical_field == "foil":
                val = _format_foil(val, fmt)
            out[col] = val
        writer.writerow(out)
    return buf.getvalue()
