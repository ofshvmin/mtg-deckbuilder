"""The build pool under the availability and set filters.

Exercises `services/pool.py` end-to-end against fake collections, because the
interesting behavior is the composition — owned printings, then the set filter,
then the in-use subtraction, then the per-oracle copy counts the generator caps
against. The first test here is the regression guard that matters most: with no
filters, the pool must be byte-identical to what the app built before pools were
a concept.
"""
import asyncio

from app.services import pool as pool_service


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d

        return gen()


class FakeCollectionItems:
    """Replays a fixed set of collection rows through the aggregate() pipeline.

    `owned_printings` groups on (oracle_id, edition, collector_number, foil,
    condition, language), so we do the same grouping here rather than trying to
    interpret the pipeline — the repo's real aggregation is covered by the API.
    """

    def __init__(self, rows):
        self._rows = rows

    async def aggregate(self, pipeline):
        groups: dict[tuple, dict] = {}
        for r in self._rows:
            key = (
                r["oracle_id"], r.get("edition"), r.get("collector_number"),
                r.get("foil"), r.get("condition"), r.get("language"),
            )
            g = groups.setdefault(key, {"_id": {
                "oracle_id": r["oracle_id"], "edition": r.get("edition"),
                "collector_number": r.get("collector_number"), "foil": r.get("foil"),
                "condition": r.get("condition"), "language": r.get("language"),
            }, "count": 0, "purchase_price": None, "added_at": None})
            g["count"] += r.get("count", 1)
        return FakeCursor(list(groups.values()))


class FakeCards:
    def __init__(self, docs):
        self._docs = docs

    def find(self, query, projection=None):
        ids = (query.get("_id") or {}).get("$in")
        rows = [d for d in self._docs if ids is None or d["_id"] in ids]
        if "legal_commander" in query:
            rows = [d for d in rows if d.get("legal_commander") == query["legal_commander"]]
        allowed = ((query.get("color_identity") or {}).get("$not") or {}).get("$elemMatch")
        if allowed and "$nin" in allowed:
            ok = set(allowed["$nin"])
            rows = [d for d in rows if all(c in ok for c in d.get("color_identity", []))]
        return FakeCursor(rows)

    async def find_one(self, query, *a, **kw):
        for d in self._docs:
            if d.get("name_normalized") == query.get("name_normalized"):
                return d
        return None


class FakeDecks:
    def __init__(self, docs):
        self._docs = docs

    def find(self, query, projection=None):
        rows = [d for d in self._docs if d.get("user_id") == query.get("user_id")]
        if query.get("in_use") is True:
            rows = [d for d in rows if d.get("in_use")]
        return FakeCursor(rows)


class FakeDB:
    def __init__(self, *, rows, cards, decks=()):
        self.collection_items = FakeCollectionItems(rows)
        self.cards = FakeCards(cards)
        self.decks = FakeDecks(list(decks))


COMMANDER = {
    "_id": "cmd", "name": "Test Commander", "name_normalized": "test commander",
    "color_identity": ["G"], "legal_commander": "legal", "type_line": "Legendary Creature",
}


def card(oid, name, colors=("G",)):
    return {
        "_id": oid, "name": name, "name_normalized": name.lower(),
        "color_identity": list(colors), "legal_commander": "legal",
        "type_line": "Creature", "cmc": 2.0, "mana_cost": "{1}{G}",
    }


def row(oid, name, edition, count=1, collector="1"):
    return {
        "user_id": "u", "oracle_id": oid, "name": name, "edition": edition,
        "collector_number": collector, "foil": "", "condition": "NM",
        "language": "en", "count": count,
    }


def deck_doc(_id, oracle_id, printing_key, count=1, in_use=True, created_at="2026-01-01"):
    return {
        "_id": _id, "user_id": "u", "in_use": in_use, "created_at": created_at,
        "deck": {"cards": [{
            "oracle_id": oracle_id, "count": count,
            "selected_printing_key": printing_key,
        }]},
    }


def get_pool(db, **kw):
    return asyncio.run(pool_service.get_pool(db, "u", "Test Commander", **kw))


def copies(result) -> dict[str, int]:
    return {c["_id"]: c["copies_owned"] for c in result.pool}


class TestDefaultScopeIsUnchanged:
    """The regression guard: an unfiltered build sees the whole collection."""

    def test_owned_counts_match_the_collection(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=3), row("b", "Beta", "blb", count=1)],
            cards=[COMMANDER, card("a", "Alpha"), card("b", "Beta")],
        )
        assert copies(get_pool(db)) == {"a": 3, "b": 1}

    def test_in_use_decks_do_not_shrink_the_owned_pool(self):
        # Marking a deck in use must not change the default build at all — the
        # subtraction only applies when you ask for it.
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=1)],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil")],
        )
        assert copies(get_pool(db)) == {"a": 1}

    def test_copies_sum_across_printings(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=2), row("a", "Alpha", "blb", count=1, collector="7")],
            cards=[COMMANDER, card("a", "Alpha")],
        )
        assert copies(get_pool(db)) == {"a": 3}

    def test_commander_is_excluded_from_its_own_pool(self):
        db = FakeDB(
            rows=[row("cmd", "Test Commander", "sch"), row("a", "Alpha", "sch")],
            cards=[COMMANDER, card("a", "Alpha")],
        )
        assert "cmd" not in copies(get_pool(db))


class TestAvailableScope:
    def test_drops_a_fully_committed_card(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=1), row("b", "Beta", "sch", count=1)],
            cards=[COMMANDER, card("a", "Alpha"), card("b", "Beta")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil")],
        )
        assert copies(get_pool(db, scope="available")) == {"b": 1}

    def test_reduces_copies_rather_than_dropping_when_some_remain(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=3)],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil")],
        )
        assert copies(get_pool(db, scope="available")) == {"a": 2}

    def test_a_deck_not_in_use_reserves_nothing(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=1)],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil", in_use=False)],
        )
        assert copies(get_pool(db, scope="available")) == {"a": 1}

    def test_excluding_a_deck_restores_its_own_cards(self):
        # Rebuilding an in-use deck: its copies have to read as free, or it
        # couldn't keep a single one of its own cards.
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=1)],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil")],
        )
        assert copies(get_pool(db, scope="available")) == {}
        assert copies(get_pool(db, scope="available", exclude_deck_id="d1")) == {"a": 1}

    def test_claims_are_per_printing(self):
        # A deck holding the Strixhaven copy leaves the Bloomburrow one free.
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=1), row("a", "Alpha", "blb", count=1, collector="7")],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil")],
        )
        assert copies(get_pool(db, scope="available")) == {"a": 1}

    def test_over_claimed_cards_stay_out(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=1)],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[
                deck_doc("d1", "a", "sch|1|nonfoil", created_at="2026-01-01"),
                deck_doc("d2", "a", "sch|1|nonfoil", created_at="2026-02-01"),
            ],
        )
        assert copies(get_pool(db, scope="available")) == {}


class TestSetFilter:
    def test_drops_cards_owned_only_in_other_sets(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch"), row("b", "Beta", "blb")],
            cards=[COMMANDER, card("a", "Alpha"), card("b", "Beta")],
        )
        assert copies(get_pool(db, sets=["sch"])) == {"a": 1}

    def test_counts_only_copies_from_the_chosen_sets(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=2), row("a", "Alpha", "blb", count=5, collector="7")],
            cards=[COMMANDER, card("a", "Alpha")],
        )
        assert copies(get_pool(db, sets=["sch"])) == {"a": 2}

    def test_multiple_sets_are_a_union(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch"), row("b", "Beta", "blb"), row("c", "Gamma", "otj")],
            cards=[COMMANDER, card("a", "Alpha"), card("b", "Beta"), card("c", "Gamma")],
        )
        assert set(copies(get_pool(db, sets=["sch", "blb"]))) == {"a", "b"}

    def test_composes_with_the_available_scope(self):
        # The order Danko described: available first, then narrowed to a set.
        db = FakeDB(
            rows=[
                row("a", "Alpha", "sch", count=1),
                row("b", "Beta", "sch", count=1),
                row("c", "Gamma", "blb", count=1),
            ],
            cards=[COMMANDER, card("a", "Alpha"), card("b", "Beta"), card("c", "Gamma")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil")],
        )
        # "b" survives: in the set, and not claimed. "a" is claimed, "c" is out of set.
        assert copies(get_pool(db, scope="available", sets=["sch"])) == {"b": 1}


class TestPoolEchoesItsFilters:
    def test_scope_and_sets_come_back(self):
        db = FakeDB(rows=[row("a", "Alpha", "sch")], cards=[COMMANDER, card("a", "Alpha")])
        result = get_pool(db, scope="available", sets=["sch"])
        assert result.scope == "available"
        assert result.sets == ["sch"]

    def test_defaults_when_unfiltered(self):
        db = FakeDB(rows=[row("a", "Alpha", "sch")], cards=[COMMANDER, card("a", "Alpha")])
        result = get_pool(db)
        assert result.scope == "owned"
        assert result.sets == []


class TestPrintingsCarryAvailability:
    def test_units_are_stamped_with_free_copies(self):
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=3)],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil", count=2)],
        )
        units = get_pool(db).printings["a"]
        assert [(u["count"], u["available"]) for u in units] == [(3, 1)]

    def test_availability_is_stamped_even_under_the_owned_scope(self):
        # The owned scope doesn't *filter* on availability, but the number still
        # has to reach the client so a deck can show "1 of 3 available".
        db = FakeDB(
            rows=[row("a", "Alpha", "sch", count=2)],
            cards=[COMMANDER, card("a", "Alpha")],
            decks=[deck_doc("d1", "a", "sch|1|nonfoil")],
        )
        assert get_pool(db).printings["a"][0]["available"] == 1
