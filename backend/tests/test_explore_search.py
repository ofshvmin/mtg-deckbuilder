"""Explore's one search box: themes, Archidekt results, and the fixes found while building it."""
from app.services import explore_search as es
from app.services.external_decks import extract_archidekt_cards

TAGS_PAGE = {"container": {"json_dict": {"cardlists": [{"cardviews": [
    {"name": "Tokens", "url": "/tags/tokens", "num_decks": 209103},
    {"name": "Aristocrats", "url": "/tags/aristocrats", "num_decks": 68750},
    {"name": "+1/+1 Counters", "url": "/tags/plus-1-plus-1-counters", "num_decks": 168260},
    {"name": "Treasure Tokens", "url": "/tags/treasure-tokens", "num_decks": 900},
    {"name": "Not a tag", "url": "/commanders/x", "num_decks": 5},
]}]}}}


class TestThemes:
    def test_index_parses_slugs_and_sorts_by_popularity(self):
        themes = es.parse_theme_index(TAGS_PAGE)
        assert [t["slug"] for t in themes] == [
            "tokens", "plus-1-plus-1-counters", "aristocrats", "treasure-tokens",
        ]

    def test_match_prefers_word_starts_then_popularity(self):
        themes = es.parse_theme_index(TAGS_PAGE)
        assert [t["name"] for t in es.match_themes(themes, "tok")] == ["Tokens", "Treasure Tokens"]
        assert [t["name"] for t in es.match_themes(themes, "counters")] == ["+1/+1 Counters"]

    def test_short_queries_match_nothing(self):
        assert es.match_themes(es.parse_theme_index(TAGS_PAGE), "t") == []

    def test_theme_page_top_commanders(self):
        page = {"container": {"json_dict": {"cardlists": [
            {"header": "New Commanders", "cardviews": [{"name": "New"}]},
            {"header": "Top Commanders", "cardviews": [{"name": "Teysa Karlov"}, {"name": "Meren"}]},
        ]}}}
        assert es.parse_theme_commanders(page, 5) == ["Teysa Karlov", "Meren"]


class TestArchidekt:
    def _result(self, **kw):
        base = {
            "id": 1, "name": "We Are The Borg", "owner": {"username": "precons"},
            "viewCount": 45000, "size": 100, "colors": {"W": 3, "U": 2, "B": 1, "R": 0, "G": 0},
            "edhBracket": None, "private": False, "unlisted": False,
            "featured": "https://card-images.archidekt.com/art/front/8/e/8ed939ba-bf8d-4a68-ae9f-f8ca4eb301ab.webp",
            "customFeatured": "",
        }
        return {**base, **kw}

    def test_parses_name_owner_colors_and_art_id(self):
        (deck,) = es.parse_archidekt_results({"results": [self._result()]})
        assert deck["name"] == "We Are The Borg" and deck["owner"] == "precons"
        assert deck["color_identity"] == ["W", "U", "B"]
        assert deck["art_print_id"] == "8ed939ba-bf8d-4a68-ae9f-f8ca4eb301ab"
        assert deck["url"] == "https://archidekt.com/decks/1"

    def test_art_id_from_the_storage_url_shape_and_custom_art_first(self):
        (deck,) = es.parse_archidekt_results({"results": [self._result(
            featured="https://storage.googleapis.com/archidekt-card-images/ltr/034e0929-b2c7-4b5f-94f2-8eaf4fb1a2a1_art_crop.jpg",
            customFeatured="https://storage.googleapis.com/archidekt-card-images/onc/5d8a1111-2222-3333-4444-555566667777_art_crop.jpg",
        )]})
        assert deck["art_print_id"] == "5d8a1111-2222-3333-4444-555566667777"

    def test_private_and_unlisted_decks_are_skipped(self):
        assert es.parse_archidekt_results({"results": [
            self._result(private=True), self._result(id=2, unlisted=True),
        ]}) == []


def test_archidekt_maybeboard_and_excluded_categories_are_left_out():
    raw = {
        "categories": [
            {"name": "Commander", "includedInDeck": True},
            {"name": "Ramp", "includedInDeck": True},
            {"name": "Maybeboard", "includedInDeck": False},
            {"name": "out", "includedInDeck": False},
        ],
        "cards": [
            {"quantity": 1, "categories": ["Commander"], "card": {"oracleCard": {"name": "Edgar Markov"}}},
            {"quantity": 1, "categories": ["Ramp"], "card": {"oracleCard": {"name": "Sol Ring"}}},
            {"quantity": 1, "categories": ["Maybeboard"], "card": {"oracleCard": {"name": "Maybe"}}},
            {"quantity": 1, "categories": ["out", "Ramp"], "card": {"oracleCard": {"name": "Cut"}}},
            {"quantity": 1, "categories": ["Ramp", "Maybeboard"], "card": {"oracleCard": {"name": "Kept"}}},
        ],
    }
    assert [c["name"] for c in extract_archidekt_cards(raw)] == ["Edgar Markov", "Sol Ring", "Kept"]
