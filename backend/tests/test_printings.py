"""Unit tests for printing identity, finish normalization, and export selection.

The `owned_printings` aggregation runs in Mongo and is verified end-to-end via
the API; here we cover the pure logic it and the exporter depend on.
"""
import pytest

from app.routers.decks import _selected_printing
from app.util import normalize_finish, printing_key


# ---- normalize_finish ----

@pytest.mark.parametrize("raw,expected", [
    ("foil", "foil"),
    ("Foil", "foil"),
    ("FOIL", "foil"),
    ("etched", "foil"),
    ("", "nonfoil"),
    (None, "nonfoil"),
    ("Normal", "nonfoil"),
    ("nonfoil", "nonfoil"),
])
def test_normalize_finish(raw, expected):
    assert normalize_finish(raw) == expected


# ---- printing_key ----

def test_printing_key_is_stable_and_lowercased():
    assert printing_key("C13", "261", "") == "c13|261|nonfoil"
    assert printing_key("c13", "261", "nonfoil") == "c13|261|nonfoil"


def test_printing_key_distinguishes_printings():
    # Different set, collector number, or finish → different unit.
    c13 = printing_key("C13", "261", "")
    sld = printing_key("SLD", "1234", "")
    foil = printing_key("C13", "261", "foil")
    assert len({c13, sld, foil}) == 3


def test_printing_key_handles_missing_fields():
    # A row with no edition/collector number still yields a stable key.
    assert printing_key(None, None, None) == "||nonfoil"


# ---- _selected_printing (export pull-list choice) ----

def _unit(key, edition, finish="nonfoil"):
    return {"printing_key": key, "edition": edition, "collector_number": "1", "finish": finish}


def test_selected_printing_prefers_selected_key():
    card = {
        "selected_printing_key": "sld|1|nonfoil",
        "printings": [_unit("c13|261|nonfoil", "C13"), _unit("sld|1|nonfoil", "SLD")],
    }
    assert _selected_printing(card)["edition"] == "SLD"


def test_selected_printing_falls_back_to_first():
    card = {
        "selected_printing_key": "nonexistent",
        "printings": [_unit("c13|261|nonfoil", "C13"), _unit("sld|1|nonfoil", "SLD")],
    }
    assert _selected_printing(card)["edition"] == "C13"


def test_selected_printing_none_for_basics():
    assert _selected_printing({"name": "Forest", "printings": []}) is None
    assert _selected_printing({"name": "Forest"}) is None
