"""Unit tests for csv_formats — detection, preprocessing, and normalization."""
import pytest

from app.services.csv_formats import (
    detect_format,
    get_format_by_name,
    normalize_row,
    preprocess_csv,
)


# ---- Detection ----

@pytest.mark.parametrize("headers,expected_name", [
    (["Count", "Tradelist Count", "Name", "Edition", "Condition", "Language", "Foil", "Tags"], "Moxfield"),
    (["Name", "Quantity", "Edition Code", "Edition Name", "Finish", "Collector Number"], "Archidekt"),
    (["Card Name", "Quantity", "Set Code", "Folder Name", "Printing", "Card Number"], "Dragon Shield"),
    (["Name", "Count", "Edition Code", "My Price", "Condition", "Language", "Foil"], "Deckbox"),
    (["Name", "Quantity", "Set code", "Foil", "Scryfall ID", "Collector Number", "Language"], "ManaBox"),
])
def test_detect_format(headers, expected_name):
    fmt = detect_format(headers)
    assert fmt is not None
    assert fmt.name == expected_name


def test_detect_format_unknown():
    assert detect_format(["foo", "bar", "baz"]) is None


# ---- Preprocessing ----

def test_preprocess_strips_sep_line():
    raw = "sep=,\nCard Name,Quantity\nSol Ring,1\n"
    assert preprocess_csv(raw) == "Card Name,Quantity\nSol Ring,1\n"


def test_preprocess_noop_for_normal_csv():
    raw = "Name,Count\nSol Ring,1\n"
    assert preprocess_csv(raw) == raw


# ---- get_format_by_name ----

def test_get_format_by_name():
    assert get_format_by_name("Moxfield") is not None
    assert get_format_by_name("moxfield") is not None
    assert get_format_by_name("Dragon Shield") is not None


def test_get_format_by_name_unknown():
    assert get_format_by_name("Unknown Platform") is None


# ---- Row normalization ----

def test_normalize_moxfield_row():
    fmt = get_format_by_name("Moxfield")
    row = {"Name": "Sol Ring", "Count": "2", "Edition": "C21", "Foil": "", "Condition": "NM"}
    canonical = normalize_row(row, fmt)
    assert canonical["name"] == "Sol Ring"
    assert canonical["count"] == "2"
    assert canonical["edition"] == "C21"
    assert canonical["foil"] == ""
    assert canonical["condition"] == "NM"


def test_normalize_archidekt_row():
    fmt = get_format_by_name("Archidekt")
    row = {"Name": "Sol Ring", "Quantity": "1", "Edition Code": "C21", "Finish": "Foil"}
    canonical = normalize_row(row, fmt)
    assert canonical["name"] == "Sol Ring"
    assert canonical["count"] == "1"
    assert canonical["edition"] == "C21"
    assert canonical["foil"] == "foil"


def test_normalize_dragon_shield_row():
    fmt = get_format_by_name("Dragon Shield")
    row = {"Card Name": "Sol Ring", "Quantity": "3", "Set Code": "C21", "Printing": "Foil"}
    canonical = normalize_row(row, fmt)
    assert canonical["name"] == "Sol Ring"
    assert canonical["count"] == "3"
    assert canonical["edition"] == "C21"
    assert canonical["foil"] == "foil"


def test_normalize_deckbox_row():
    fmt = get_format_by_name("Deckbox")
    row = {"Name": "Sol Ring", "Count": "1", "Edition Code": "C21", "Foil": "foil"}
    canonical = normalize_row(row, fmt)
    assert canonical["name"] == "Sol Ring"
    assert canonical["count"] == "1"
    assert canonical["foil"] == "foil"


def test_normalize_manabox_row():
    fmt = get_format_by_name("ManaBox")
    row = {"Name": "Sol Ring", "Quantity": "4", "Set code": "c21", "Foil": ""}
    canonical = normalize_row(row, fmt)
    assert canonical["name"] == "Sol Ring"
    assert canonical["count"] == "4"
    assert canonical["edition"] == "c21"
    assert canonical["foil"] == ""


# ---- Foil normalization edge cases ----

@pytest.mark.parametrize("raw_foil,expected", [
    ("Foil", "foil"),
    ("foil", "foil"),
    ("FOIL", "foil"),
    ("Etched", "foil"),
    ("Normal", ""),
    ("", ""),
    ("Non-Foil", ""),
])
def test_foil_normalization(raw_foil, expected):
    fmt = get_format_by_name("Moxfield")
    row = {"Name": "X", "Count": "1", "Edition": "X", "Foil": raw_foil}
    assert normalize_row(row, fmt)["foil"] == expected
