"""Inventory allocation: which physical copies a build can still draw on.

The rule Danko asked for is a fleet model. A saved deck marked ``in_use`` is
sleeved up, so its copies leave the pool. Over-allocation is deliberately legal —
two decks may both claim your only Sol Ring — and the arithmetic goes negative
rather than clamping, with ``deck_shortfalls`` deciding which deck has to show
the card as unowned.

These are pure-function tests over the shapes ``collection_repo.owned_printings``
returns, plus a fake ``decks`` collection for the two functions that read Mongo.
"""
import asyncio

import pytest

from app.services import availability


def unit(key, count, edition=None, available=None):
    u = {
        "printing_key": key,
        "edition": edition if edition is not None else key.split("|")[0],
        "collector_number": "1",
        "finish": "nonfoil",
        "count": count,
    }
    if available is not None:
        u["available"] = available
    return u


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d

        return gen()


class FakeDecks:
    """Stands in for db.decks, honouring the in_use / _id filters we rely on."""

    def __init__(self, docs):
        self._docs = docs

    def find(self, query, projection=None):
        rows = [d for d in self._docs if d.get("user_id") == query.get("user_id")]
        if query.get("in_use") is True:
            rows = [d for d in rows if d.get("in_use")]
        ne = (query.get("_id") or {}).get("$ne") if isinstance(query.get("_id"), dict) else None
        if ne is not None:
            rows = [d for d in rows if d["_id"] != ne]
        return FakeCursor(rows)


class FakeDB:
    def __init__(self, deck_docs):
        self.decks = FakeDecks(deck_docs)


def deck_doc(_id, cards, in_use=True, created_at="2026-01-01", user_id="u"):
    return {
        "_id": _id,
        "user_id": user_id,
        "in_use": in_use,
        "created_at": created_at,
        "deck": {"cards": cards},
    }


class TestCardAllocation:
    """The fallback chain that lets pre-existing saved decks be accounted for."""

    def test_prefers_explicit_allocation(self):
        card = {
            "count": 4,
            "selected_printing_key": "aaa|1|nonfoil",
            "printing_allocation": {"aaa|1|nonfoil": 2, "bbb|7|nonfoil": 2},
        }
        assert availability.card_allocation(card) == {
            "aaa|1|nonfoil": 2,
            "bbb|7|nonfoil": 2,
        }

    def test_falls_back_to_selected_key_for_legacy_decks(self):
        # Decks saved before this feature only carry selected_printing_key; the
        # whole count is charged to it, which is what the allocator would write.
        card = {"count": 3, "selected_printing_key": "aaa|1|nonfoil"}
        assert availability.card_allocation(card) == {"aaa|1|nonfoil": 3}

    def test_basics_claim_nothing(self):
        assert availability.card_allocation({"count": 12, "name": "Island"}) == {}

    def test_ignores_empty_and_zero_entries(self):
        card = {"count": 1, "printing_allocation": {"aaa|1|nonfoil": 0}, "selected_printing_key": "z|1|nonfoil"}
        # An allocation of all-zeros is not an allocation — fall through.
        assert availability.card_allocation(card) == {"z|1|nonfoil": 1}


class TestApplyCommitted:
    def test_subtracts_committed_copies(self):
        owned = {"oid": [unit("aaa|1|nonfoil", 3)]}
        result = availability.apply_committed(owned, {"oid": {"aaa|1|nonfoil": 2}})
        assert result["oid"][0]["available"] == 1
        # `count` stays the number owned so the UI can say "1 of 3 available".
        assert result["oid"][0]["count"] == 3

    def test_goes_negative_when_decks_over_claim(self):
        owned = {"oid": [unit("aaa|1|nonfoil", 1)]}
        result = availability.apply_committed(owned, {"oid": {"aaa|1|nonfoil": 3}})
        assert result["oid"][0]["available"] == -2

    def test_per_printing_not_per_card(self):
        owned = {"oid": [unit("aaa|1|nonfoil", 2), unit("bbb|5|nonfoil", 2)]}
        result = availability.apply_committed(owned, {"oid": {"aaa|1|nonfoil": 2}})
        by_key = {u["printing_key"]: u["available"] for u in result["oid"]}
        assert by_key == {"aaa|1|nonfoil": 0, "bbb|5|nonfoil": 2}

    def test_untouched_cards_are_fully_available(self):
        owned = {"oid": [unit("aaa|1|nonfoil", 2)]}
        result = availability.apply_committed(owned, {})
        assert result["oid"][0]["available"] == 2


class TestFilterUnitsBySet:
    def test_keeps_only_chosen_sets(self):
        owned = {
            "keep": [unit("sch|1|nonfoil", 1, edition="sch"), unit("blb|2|nonfoil", 1, edition="blb")],
            "drop": [unit("blb|3|nonfoil", 1, edition="blb")],
        }
        result = availability.filter_units_by_set(owned, ["sch"])
        assert set(result) == {"keep"}
        assert [u["edition"] for u in result["keep"]] == ["sch"]

    def test_is_case_insensitive(self):
        owned = {"oid": [unit("sch|1|nonfoil", 1, edition="sch")]}
        assert availability.filter_units_by_set(owned, ["SCH"])["oid"]

    @pytest.mark.parametrize("sets", [None, [], ["   "]])
    def test_no_filter_passes_everything_through(self, sets):
        owned = {"oid": [unit("blb|1|nonfoil", 1)]}
        assert availability.filter_units_by_set(owned, sets) == owned


class TestCountsFromUnits:
    def test_sums_owned_copies(self):
        owned = {"oid": [unit("a|1|nonfoil", 2), unit("b|1|nonfoil", 3)]}
        assert availability.counts_from_units(owned) == {"oid": 5}

    def test_sums_available_copies(self):
        owned = {"oid": [unit("a|1|nonfoil", 2, available=0), unit("b|1|nonfoil", 3, available=1)]}
        assert availability.counts_from_units(owned, key="available") == {"oid": 1}

    def test_drops_cards_with_nothing_left(self):
        # A card entirely spoken for isn't buildable, so it leaves the pool.
        owned = {"gone": [unit("a|1|nonfoil", 1, available=0)],
                 "here": [unit("b|1|nonfoil", 1, available=1)]}
        assert availability.counts_from_units(owned, key="available") == {"here": 1}

    def test_drops_over_claimed_cards(self):
        owned = {"oid": [unit("a|1|nonfoil", 1, available=-2)]}
        assert availability.counts_from_units(owned, key="available") == {}


class TestAllocate:
    def test_single_copy_takes_the_freest_printing(self):
        units = [unit("a|1|nonfoil", 3, available=0), unit("b|1|nonfoil", 1, available=1)]
        assert availability.allocate(units, 1) == {"b|1|nonfoil": 1}

    def test_splits_a_playset_across_printings(self):
        units = [unit("a|1|nonfoil", 2, available=2), unit("b|1|nonfoil", 2, available=2)]
        alloc = availability.allocate(units, 4)
        assert sum(alloc.values()) == 4
        assert alloc == {"a|1|nonfoil": 2, "b|1|nonfoil": 2}

    def test_falls_back_when_nothing_is_free(self):
        # Over-allocation is allowed; a deck card must still name a copy or it
        # loses its pull-list entry.
        units = [unit("a|1|nonfoil", 1, available=0)]
        assert availability.allocate(units, 1) == {"a|1|nonfoil": 1}

    def test_charges_only_the_shortfall_to_the_fallback(self):
        units = [unit("a|1|nonfoil", 4, available=1)]
        assert availability.allocate(units, 3) == {"a|1|nonfoil": 3}

    def test_uses_owned_count_when_availability_is_unknown(self):
        assert availability.allocate([unit("a|1|nonfoil", 2)], 2) == {"a|1|nonfoil": 2}

    def test_no_printings_means_no_allocation(self):
        assert availability.allocate([], 1) == {}


class TestPrimaryKey:
    def test_picks_the_largest_slice(self):
        assert availability.primary_key({"a|1|nonfoil": 1, "b|1|nonfoil": 3}) == "b|1|nonfoil"

    def test_ties_break_on_key_so_rebuilds_are_stable(self):
        assert availability.primary_key({"b|1|nonfoil": 2, "a|1|nonfoil": 2}) == "a|1|nonfoil"

    def test_none_for_an_empty_allocation(self):
        assert availability.primary_key({}) is None


class TestCommittedByPrinting:
    def _cards(self, key, count=1, oracle="oid"):
        return [{"oracle_id": oracle, "count": count, "selected_printing_key": key}]

    def test_sums_across_in_use_decks(self):
        db = FakeDB([
            deck_doc("d1", self._cards("a|1|nonfoil")),
            deck_doc("d2", self._cards("a|1|nonfoil")),
        ])
        got = asyncio.run(availability.committed_by_printing(db, "u"))
        assert got == {"oid": {"a|1|nonfoil": 2}}

    def test_ignores_decks_not_in_use(self):
        db = FakeDB([
            deck_doc("d1", self._cards("a|1|nonfoil"), in_use=True),
            deck_doc("d2", self._cards("a|1|nonfoil"), in_use=False),
        ])
        got = asyncio.run(availability.committed_by_printing(db, "u"))
        assert got == {"oid": {"a|1|nonfoil": 1}}

    def test_excluded_deck_frees_its_own_copies(self):
        # Reopening an in-use deck to regenerate it must not have it compete
        # with itself for its own cards.
        db = FakeDB([deck_doc("d1", self._cards("a|1|nonfoil"))])
        got = asyncio.run(availability.committed_by_printing(db, "u", exclude_deck_id="d1"))
        assert got == {}

    def test_ignores_other_users(self):
        db = FakeDB([deck_doc("d1", self._cards("a|1|nonfoil"), user_id="someone-else")])
        assert asyncio.run(availability.committed_by_printing(db, "u")) == {}


class TestDeckShortfalls:
    """Oldest deck keeps the physical copy; the newer one shows it as unowned."""

    def _card(self, key="a|1|nonfoil", count=1):
        return [{"oracle_id": "oid", "count": count, "selected_printing_key": key}]

    def test_older_deck_is_clean(self):
        owned = {"oid": [unit("a|1|nonfoil", 1)]}
        db = FakeDB([
            deck_doc("old", self._card(), created_at="2026-01-01"),
            deck_doc("new", self._card(), created_at="2026-06-01"),
        ])
        assert asyncio.run(availability.deck_shortfalls(db, "u", "old", owned)) == {"oid": False}

    def test_newer_deck_is_short(self):
        owned = {"oid": [unit("a|1|nonfoil", 1)]}
        db = FakeDB([
            deck_doc("old", self._card(), created_at="2026-01-01"),
            deck_doc("new", self._card(), created_at="2026-06-01"),
        ])
        assert asyncio.run(availability.deck_shortfalls(db, "u", "new", owned)) == {"oid": True}

    def test_enough_copies_for_everyone(self):
        owned = {"oid": [unit("a|1|nonfoil", 2)]}
        db = FakeDB([
            deck_doc("old", self._card(), created_at="2026-01-01"),
            deck_doc("new", self._card(), created_at="2026-06-01"),
        ])
        assert asyncio.run(availability.deck_shortfalls(db, "u", "new", owned)) == {"oid": False}

    def test_partial_coverage_still_counts_as_short(self):
        # Two copies owned, an older deck holds one, this deck wants two.
        owned = {"oid": [unit("a|1|nonfoil", 2)]}
        db = FakeDB([
            deck_doc("old", self._card(count=1), created_at="2026-01-01"),
            deck_doc("new", self._card(count=2), created_at="2026-06-01"),
        ])
        assert asyncio.run(availability.deck_shortfalls(db, "u", "new", owned)) == {"oid": True}

    def test_deck_not_in_use_has_no_shortfalls(self):
        owned = {"oid": [unit("a|1|nonfoil", 1)]}
        db = FakeDB([
            deck_doc("other", self._card(), created_at="2026-01-01"),
            deck_doc("mine", self._card(), in_use=False, created_at="2026-06-01"),
        ])
        assert asyncio.run(availability.deck_shortfalls(db, "u", "mine", owned)) == {}


class TestDeletingADeckFreesItsCards:
    """Deleting a saved deck must put its copies back on the shelf.

    Nothing writes an "available" number anywhere — it is derived per request
    from the in-use decks that still exist — so the guarantee is that the same
    pool arithmetic, run against a ``decks`` collection the deck has been removed
    from, reports the copies as free again. These tests pin that end to end so a
    future move to a stored counter can't quietly break it.
    """

    OWNED = {
        "sol": [unit("c17|1|nonfoil", 1)],
        "swamp": [unit("khm|396|nonfoil", 2)],
    }

    def _deck(self):
        return deck_doc("d1", [
            {"oracle_id": "sol", "count": 1, "selected_printing_key": "c17|1|nonfoil"},
            {"oracle_id": "swamp", "count": 2, "selected_printing_key": "khm|396|nonfoil"},
        ])

    def _available(self, db):
        committed = asyncio.run(availability.committed_by_printing(db, "u"))
        stamped = availability.apply_committed(self.OWNED, committed)
        return availability.counts_from_units(stamped, key="available")

    def test_in_use_deck_holds_its_copies(self):
        assert self._available(FakeDB([self._deck()])) == {}

    def test_deleting_the_deck_returns_every_copy(self):
        db = FakeDB([self._deck()])
        db.decks._docs.clear()          # what `delete_deck` leaves behind
        assert self._available(db) == {"sol": 1, "swamp": 2}

    def test_only_the_deleted_deck_releases(self):
        db = FakeDB([self._deck(), deck_doc("d2", [
            {"oracle_id": "swamp", "count": 1, "selected_printing_key": "khm|396|nonfoil"},
        ], created_at="2026-02-01")])
        db.decks._docs = [d for d in db.decks._docs if d["_id"] != "d1"]
        # d2 still claims one Swamp; the other Swamp and the Sol Ring come back.
        assert self._available(db) == {"sol": 1, "swamp": 1}

    def test_deleting_an_over_claimed_deck_clears_the_negative(self):
        db = FakeDB([self._deck(), deck_doc("d2", [
            {"oracle_id": "sol", "count": 1, "selected_printing_key": "c17|1|nonfoil"},
        ], created_at="2026-02-01")])
        def sol_available():
            committed = asyncio.run(availability.committed_by_printing(db, "u"))
            return availability.apply_committed(self.OWNED, committed)["sol"][0]["available"]

        assert sol_available() == -1     # two decks, one Sol Ring
        db.decks._docs = [d for d in db.decks._docs if d["_id"] != "d2"]
        assert sol_available() == 0      # back to "spoken for", not "over-spent"


class TestScopeHelpers:
    @pytest.mark.parametrize("value", [None, "", "nonsense", "OWNED"])
    def test_unknown_scopes_fall_back_to_owned(self, value):
        assert availability.normalize_scope(value) == availability.SCOPE_OWNED

    def test_available_is_accepted(self):
        assert availability.normalize_scope("available") == availability.SCOPE_AVAILABLE

    def test_is_filtered(self):
        assert not availability.is_filtered(availability.SCOPE_OWNED, None)
        assert not availability.is_filtered(availability.SCOPE_OWNED, [])
        assert availability.is_filtered(availability.SCOPE_AVAILABLE, None)
        assert availability.is_filtered(availability.SCOPE_OWNED, ["sch"])

    def test_empty_pool_message_names_the_filter(self):
        # The generic "no legal cards" text reads as a broken collection; these
        # have to point at the filter the user just set.
        assert "already in a deck" in availability.empty_pool_message(
            "Commander", availability.SCOPE_AVAILABLE, None
        )
        assert "SCH" in availability.empty_pool_message("Commander", availability.SCOPE_OWNED, ["sch"])
        assert availability.empty_pool_message("Commander", availability.SCOPE_OWNED, None) == (
            "No Commander-legal cards in your collection."
        )
