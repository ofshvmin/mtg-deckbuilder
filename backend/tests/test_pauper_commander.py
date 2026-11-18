"""Pauper Commander: who may lead, what the 99 draw from, which strategies apply."""
import asyncio

from app.repositories import cards as cards_repo
from app.services import card_prints, strategies
from app.services.formats import get_format

PDH = get_format("paupercommander")


class TestPrintings:
    def test_print_doc_keeps_rarity_and_paper(self):
        doc = card_prints.print_doc(
            {"id": "p", "oracle_id": "o", "name": "X", "set": "dom", "rarity": "uncommon",
             "games": ["paper", "arena"]}
        )
        assert doc["rarity"] == "uncommon" and doc["paper"] is True

    def test_arena_only_printings_are_not_paper(self):
        doc = card_prints.print_doc(
            {"id": "p", "oracle_id": "o", "name": "X", "set": "y22", "rarity": "uncommon", "games": ["arena"]}
        )
        assert "paper" not in doc

    def test_mtgo_counts(self):
        doc = card_prints.print_doc(
            {"id": "p", "oracle_id": "o", "name": "X", "set": "vma", "rarity": "uncommon", "games": ["mtgo"]}
        )
        assert doc["paper"] is True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class _FakeDb:
    """card_prints.distinct + cards.find, just as pdh_commander_ids uses them."""

    def __init__(self, printings, cards):
        self.card_prints = self._Prints(printings)
        self.cards = self._Cards(cards)

    class _Prints:
        def __init__(self, rows):
            self.rows = rows

        async def distinct(self, field, q):
            ids = set(q["oracle_id"]["$in"])
            return sorted({
                r["oracle_id"] for r in self.rows
                if r["oracle_id"] in ids and r.get("rarity") == q["rarity"] and r.get("paper") == q["paper"]
            })

    class _Cards:
        def __init__(self, docs):
            self.docs = docs

        def find(self, q, _proj=None):
            ids = set(q["_id"]["$in"])
            return _Cursor([
                d for d in self.docs
                if d["_id"] in ids and "Creature" in d["type_line"]
                and d.get("legalities", {}).get("paupercommander") != "banned"
            ])


def _eligible(printings, cards, ids):
    return asyncio.run(cards_repo.pdh_commander_ids(_FakeDb(printings, cards), ids))


class TestCommanderRule:
    CARDS = [
        {"_id": "tatyova", "type_line": "Legendary Creature — Merfolk Druid"},
        {"_id": "mystic", "type_line": "Creature — Human Wizard"},
        {"_id": "bolt", "type_line": "Instant"},
        {"_id": "ghalta", "type_line": "Legendary Creature — Elder Dinosaur"},
        {"_id": "banned", "type_line": "Creature — Horror", "legalities": {"paupercommander": "banned"}},
        {"_id": "arena", "type_line": "Creature — Elf"},
    ]
    PRINTS = [
        {"oracle_id": "tatyova", "rarity": "uncommon", "paper": True},
        {"oracle_id": "mystic", "rarity": "uncommon", "paper": True},
        {"oracle_id": "bolt", "rarity": "uncommon", "paper": True},
        {"oracle_id": "ghalta", "rarity": "rare", "paper": True},
        {"oracle_id": "banned", "rarity": "uncommon", "paper": True},
        {"oracle_id": "arena", "rarity": "uncommon"},  # Arena-only printing
    ]

    def test_creatures_printed_at_uncommon_qualify(self):
        ids = [c["_id"] for c in self.CARDS]
        assert _eligible(self.PRINTS, self.CARDS, ids) == {"tatyova", "mystic"}

    def test_legendary_is_not_required(self):
        assert _eligible(self.PRINTS, self.CARDS, ["mystic"]) == {"mystic"}

    def test_nothing_before_the_printings_sync(self):
        """No rarity on card_prints yet: no commanders, rather than wrong ones."""
        bare = [{"oracle_id": p["oracle_id"]} for p in self.PRINTS]
        assert _eligible(bare, self.CARDS, [c["_id"] for c in self.CARDS]) == set()


def test_pdh_uses_the_commander_strategies():
    names = [s["name"] for s in strategies.list_strategies(PDH)]
    assert names == [s["name"] for s in strategies.list_strategies(get_format("commander"))]
