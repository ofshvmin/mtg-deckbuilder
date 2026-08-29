"""What the collection browser gets to filter and sort on.

Two things are covered here. First, the oracle fields the ingest carries through
(`reserved`, `game_changer`) — they come from Scryfall's bulk file and are the
only reason a "Reserved List" filter can exist at all. Second, the availability
stamping on `/collection/cards`: the browser has to be able to answer "what's
free right now", and availability is derived from in-use decks per request, so
the wiring is the thing that can break.
"""
import asyncio

import pytest

from app.repositories import collection as collection_repo
from app.routers import collection
from app.services.scryfall import doc_from_card


# ---- ingest: Reserved List and Game Changers ----

def scryfall_card(**overrides) -> dict:
    card = {
        "oracle_id": "oid-1",
        "id": "print-1",
        "name": "Gaea's Cradle",
        "mana_cost": "",
        "cmc": 0.0,
        "type_line": "Legendary Land",
        "oracle_text": "T: Add G for each creature you control.",
        "color_identity": [],
        "rarity": "rare",
    }
    card.update(overrides)
    return card


class TestReservedAndGameChanger:
    def test_reserved_survives_the_ingest(self):
        assert doc_from_card(scryfall_card(reserved=True))["reserved"] is True

    def test_game_changer_survives_the_ingest(self):
        assert doc_from_card(scryfall_card(game_changer=True))["game_changer"] is True

    def test_absent_flags_read_as_false_not_none(self):
        # Scryfall omits both on most cards. They must land as real booleans, or
        # a Mongo query for {"reserved": False} would miss the whole collection.
        doc = doc_from_card(scryfall_card())
        assert doc["reserved"] is False
        assert doc["game_changer"] is False

    def test_flags_are_independent(self):
        doc = doc_from_card(scryfall_card(reserved=True, game_changer=False))
        assert (doc["reserved"], doc["game_changer"]) == (True, False)


# ---- /collection/cards: availability + the new filter fields ----

def unit(key, count):
    return {
        "printing_key": key,
        "edition": key.split("|")[0],
        "collector_number": key.split("|")[1],
        "finish": key.split("|")[2],
        "count": count,
    }


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d

        return gen()


class FakeDecks:
    def __init__(self, docs):
        self._docs = docs

    def find(self, query, projection=None):
        rows = [d for d in self._docs if d.get("user_id") == query.get("user_id")]
        if query.get("in_use") is True:
            rows = [d for d in rows if d.get("in_use")]
        return FakeCursor(rows)


class FakeDB:
    def __init__(self, deck_docs):
        self.decks = FakeDecks(deck_docs)


def in_use_deck(cards, _id="deck-1"):
    return {
        "_id": _id,
        "user_id": "user-1",
        "in_use": True,
        "created_at": "2026-01-01",
        "deck": {"cards": cards},
    }


class TestCollectionCardsEndpoint:
    """The handler stamps availability; `committed_by_printing` runs for real."""

    USER = {"_id": "user-1"}

    def _run(self, monkeypatch, rows, deck_docs=()):
        database = FakeDB(list(deck_docs))

        async def fake_list(db, user_id):
            return rows

        async def fake_enrich(db, pairs):
            return None

        monkeypatch.setattr(collection.collection_repo, "list_collection_cards", fake_list)
        monkeypatch.setattr(collection.card_prints_repo, "enrich_printings", fake_enrich)
        monkeypatch.setattr(collection.db, "get_db", lambda: database)
        return asyncio.run(collection.list_collection_cards(current_user=self.USER))

    def _row(self, **overrides):
        row = {
            "oracle_id": "sol-ring",
            "name": "Sol Ring",
            "mana_cost": "{1}",
            "cmc": 1.0,
            "type_line": "Artifact",
            "color_identity": [],
            "colors": [],
            "oracle_text": "",
            "rarity": "uncommon",
            "reserved": False,
            "game_changer": False,
            "total_count": 3,
            "printings": [unit("c13|261|nonfoil", 3)],
        }
        row.update(overrides)
        return row

    def test_untouched_collection_is_fully_available(self, monkeypatch):
        cards = self._run(monkeypatch, [self._row()])
        assert cards[0]["available_count"] == 3
        assert cards[0]["printings"][0]["available"] == 3

    def test_an_in_use_deck_holds_copies_back(self, monkeypatch):
        deck = in_use_deck([
            {"oracle_id": "sol-ring", "count": 1, "printing_allocation": {"c13|261|nonfoil": 1}},
        ])
        cards = self._run(monkeypatch, [self._row()], [deck])
        assert cards[0]["total_count"] == 3      # still owned
        assert cards[0]["available_count"] == 2  # but only two are free

    def test_available_count_sums_across_printings(self, monkeypatch):
        row = self._row(
            total_count=5,
            printings=[unit("c13|261|nonfoil", 3), unit("sld|1234|foil", 2)],
        )
        deck = in_use_deck([
            {"oracle_id": "sol-ring", "count": 3,
             "printing_allocation": {"c13|261|nonfoil": 2, "sld|1234|foil": 1}},
        ])
        cards = self._run(monkeypatch, [row], [deck])
        assert cards[0]["available_count"] == 2
        assert [p["available"] for p in cards[0]["printings"]] == [1, 1]

    def test_over_claimed_cards_go_negative_rather_than_clamping(self, monkeypatch):
        # Two decks may both sleeve up your only Sol Ring. The browser is told the
        # truth and clamps for display; silently flooring here would hide the
        # shortfall from every caller.
        decks = [
            in_use_deck([{"oracle_id": "sol-ring", "count": 2,
                          "printing_allocation": {"c13|261|nonfoil": 2}}], _id="deck-1"),
            in_use_deck([{"oracle_id": "sol-ring", "count": 2,
                          "printing_allocation": {"c13|261|nonfoil": 2}}], _id="deck-2"),
        ]
        cards = self._run(monkeypatch, [self._row()], decks)
        assert cards[0]["available_count"] == -1

    def test_a_free_deck_reserves_nothing(self, monkeypatch):
        deck = in_use_deck([
            {"oracle_id": "sol-ring", "count": 3, "printing_allocation": {"c13|261|nonfoil": 3}},
        ])
        deck["in_use"] = False
        cards = self._run(monkeypatch, [self._row()], [deck])
        assert cards[0]["available_count"] == 3

    def test_response_model_accepts_the_new_fields(self, monkeypatch):
        # The handler returns dicts; FastAPI validates them against
        # CollectionCardOut. Do that here so a field name drifting from the model
        # fails in the suite rather than silently vanishing from the payload.
        row = self._row(oracle_id="cradle", name="Gaea's Cradle", rarity="rare",
                        reserved=True, game_changer=False, colors=[])
        cards = self._run(monkeypatch, [row])
        out = collection.CollectionCardOut(**cards[0])
        assert out.reserved is True
        assert out.rarity == "rare"
        assert out.available_count == 3


class TestRepositoryRow:
    """`list_collection_cards` builds the row the browser filters on."""

    def test_row_carries_the_filterable_oracle_fields(self):
        card = {
            "_id": "cradle", "name": "Gaea's Cradle", "mana_cost": "",
            "cmc": 0.0, "type_line": "Legendary Land", "color_identity": [],
            "colors": [], "oracle_text": "", "rarity": "rare",
            "reserved": True, "game_changer": False,
        }
        row = _build_row(card, [unit("usg|321|nonfoil", 1)])
        assert row["rarity"] == "rare"
        assert row["reserved"] is True
        assert row["colors"] == []

    def test_missing_flags_default_to_false(self):
        # Cards synced before this change have no `reserved` key until the next
        # Scryfall sync. They must read as False, not None.
        card = {"_id": "x", "name": "Old Card", "type_line": "Instant"}
        row = _build_row(card, [unit("a|1|nonfoil", 1)])
        assert row["reserved"] is False
        assert row["game_changer"] is False
        assert row["rarity"] is None


def _build_row(card: dict, units: list[dict]) -> dict:
    """Run the row-building half of `list_collection_cards` without Mongo."""
    class _Cards:
        def find(self, query, projection=None):
            return FakeCursor([card])

    class _DB:
        cards = _Cards()

    async def fake_owned(db, user_id):
        return {card["_id"]: units}

    import app.repositories.collection as mod
    original = mod.owned_printings
    mod.owned_printings = fake_owned
    try:
        rows = asyncio.run(collection_repo.list_collection_cards(_DB(), "user-1"))
    finally:
        mod.owned_printings = original
    return rows[0]
