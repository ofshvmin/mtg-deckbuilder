"""Tests for the external_decks service (URL parsing, card extraction, slug conversion)."""
import pytest

from app.services.external_decks import (
    commander_to_slug,
    extract_archidekt_cards,
    extract_deck_metadata,
    extract_edhrec_cards,
    extract_moxfield_cards,
    parse_deck_url,
)


class TestParseDeckUrl:
    def test_archidekt_url(self):
        result = parse_deck_url("https://archidekt.com/decks/12345/some-deck-name")
        assert result == ("archidekt", "12345")

    def test_archidekt_url_with_trailing_slash(self):
        result = parse_deck_url("https://archidekt.com/decks/99999/")
        assert result == ("archidekt", "99999")

    def test_moxfield_url(self):
        result = parse_deck_url("https://www.moxfield.com/decks/abc-123-def")
        assert result == ("moxfield", "abc-123-def")

    def test_moxfield_url_simple(self):
        result = parse_deck_url("https://moxfield.com/decks/Xk3nZ")
        assert result == ("moxfield", "Xk3nZ")

    def test_edhrec_preview_url(self):
        result = parse_deck_url("https://edhrec.com/deckpreview/l4dyWqugVo_vuSUTOHRpLQ")
        assert result == ("edhrec", "l4dyWqugVo_vuSUTOHRpLQ")

    def test_unsupported_url(self):
        assert parse_deck_url("https://scryfall.com/card/foo") is None

    def test_empty_string(self):
        assert parse_deck_url("") is None

    def test_random_text(self):
        assert parse_deck_url("just some text") is None

    def test_url_in_text(self):
        result = parse_deck_url("check out https://archidekt.com/decks/42/my-deck please")
        assert result == ("archidekt", "42")


class TestCommanderToSlug:
    def test_basic(self):
        assert commander_to_slug("Atraxa, Praetors' Voice") == "atraxa-praetors-voice"

    def test_simple_name(self):
        assert commander_to_slug("Krenko, Mob Boss") == "krenko-mob-boss"

    def test_hyphens(self):
        assert commander_to_slug("Lim-Dul the Necromancer") == "lim-dul-the-necromancer"

    def test_caesar(self):
        assert commander_to_slug("Caesar, Legion's Emperor") == "caesar-legions-emperor"

    def test_no_punctuation(self):
        assert commander_to_slug("Sol Ring") == "sol-ring"


class TestExtractEdhrecCards:
    def test_basic_extraction(self):
        preview = {
            "deck": ["1 Sol Ring", "1 Command Tower", "1 Atraxa, Praetors' Voice"],
            "commanders": ["Atraxa, Praetors' Voice"],
        }
        cards = extract_edhrec_cards(preview)
        assert len(cards) == 3
        sol = next(c for c in cards if c["name"] == "Sol Ring")
        assert sol["quantity"] == 1
        assert sol["categories"] == []
        atraxa = next(c for c in cards if "Atraxa" in c["name"])
        assert "Commander" in atraxa["categories"]

    def test_multiple_quantity(self):
        preview = {"deck": ["4 Lightning Bolt"], "commanders": []}
        cards = extract_edhrec_cards(preview)
        assert len(cards) == 1
        assert cards[0]["quantity"] == 4

    def test_empty_deck(self):
        assert extract_edhrec_cards({}) == []
        assert extract_edhrec_cards({"deck": []}) == []

    def test_malformed_lines_skipped(self):
        preview = {"deck": ["", "  ", "nocount"], "commanders": []}
        cards = extract_edhrec_cards(preview)
        # "nocount" doesn't have a number prefix, so qty defaults to 1
        # but "" and "  " should be skipped
        assert len(cards) <= 1


class TestExtractArchidektCards:
    def test_basic_extraction(self):
        raw = {
            "cards": [
                {
                    "card": {
                        "oracleCard": {"name": "Sol Ring"},
                        "edition": {"editioncode": "c21"},
                        "collectorNumber": "266",
                    },
                    "quantity": 1,
                    "categories": ["Ramp"],
                },
                {
                    "card": {
                        "oracleCard": {"name": "Command Tower"},
                        "edition": {"editioncode": "c21"},
                        "collectorNumber": "284",
                    },
                    "quantity": 1,
                    "categories": ["Land"],
                },
            ]
        }
        cards = extract_archidekt_cards(raw)
        assert len(cards) == 2
        assert cards[0]["name"] == "Sol Ring"
        assert cards[0]["quantity"] == 1
        assert cards[0]["set_code"] == "c21"
        assert cards[0]["collector_number"] == "266"
        assert cards[1]["name"] == "Command Tower"

    def test_empty_cards(self):
        assert extract_archidekt_cards({}) == []
        assert extract_archidekt_cards({"cards": []}) == []

    def test_cards_without_name_skipped(self):
        raw = {
            "cards": [
                {"card": {"oracleCard": {}}, "quantity": 1, "categories": []},
            ]
        }
        assert extract_archidekt_cards(raw) == []

    def test_commander_category(self):
        raw = {
            "cards": [
                {
                    "card": {
                        "oracleCard": {"name": "Atraxa, Praetors' Voice"},
                        "edition": {"editioncode": "c16"},
                        "collectorNumber": "28",
                    },
                    "quantity": 1,
                    "categories": ["Commander"],
                },
            ]
        }
        cards = extract_archidekt_cards(raw)
        assert len(cards) == 1
        assert "Commander" in cards[0]["categories"]


class TestExtractMoxfieldCards:
    def test_basic_extraction(self):
        raw = {
            "boards": {
                "mainboard": {
                    "cards": {
                        "abc123": {
                            "card": {"name": "Sol Ring", "set": "c21", "cn": "266"},
                            "quantity": 1,
                        },
                    }
                },
                "commanders": {
                    "cards": {
                        "def456": {
                            "card": {"name": "Atraxa, Praetors' Voice", "set": "c16", "cn": "28"},
                            "quantity": 1,
                        },
                    }
                },
            }
        }
        cards = extract_moxfield_cards(raw)
        assert len(cards) == 2
        sol = next(c for c in cards if c["name"] == "Sol Ring")
        assert sol["set_code"] == "c21"
        atraxa = next(c for c in cards if "Atraxa" in c["name"])
        assert "Commander" in atraxa["categories"]

    def test_sideboard_excluded(self):
        raw = {
            "boards": {
                "mainboard": {
                    "cards": {"a": {"card": {"name": "Card A"}, "quantity": 1}}
                },
                "sideboard": {
                    "cards": {"b": {"card": {"name": "Card B"}, "quantity": 1}}
                },
            }
        }
        cards = extract_moxfield_cards(raw)
        assert len(cards) == 1
        assert cards[0]["name"] == "Card A"

    def test_empty_boards(self):
        assert extract_moxfield_cards({}) == []
        assert extract_moxfield_cards({"boards": {}}) == []


class TestExtractDeckMetadata:
    def test_archidekt_metadata(self):
        raw = {"name": "My Deck", "owner": {"username": "player1"}}
        meta = extract_deck_metadata(raw, "archidekt")
        assert meta["name"] == "My Deck"
        assert meta["owner"] == "player1"

    def test_moxfield_metadata(self):
        raw = {"name": "Cool Deck", "createdByUser": {"displayName": "Bob", "userName": "bob123"}}
        meta = extract_deck_metadata(raw, "moxfield")
        assert meta["name"] == "Cool Deck"
        assert meta["owner"] == "Bob"

    def test_moxfield_fallback_username(self):
        raw = {"name": "Deck", "createdByUser": {"userName": "bob123"}}
        meta = extract_deck_metadata(raw, "moxfield")
        assert meta["owner"] == "bob123"

    def test_edhrec_metadata(self):
        raw = {"header": "Deck with Atraxa"}
        meta = extract_deck_metadata(raw, "edhrec")
        assert meta["name"] == "Deck with Atraxa"
        assert meta["owner"] == "EDHREC"

    def test_unknown_source(self):
        meta = extract_deck_metadata({}, "unknown")
        assert meta["name"] == "Untitled"
        assert meta["owner"] == "Unknown"
