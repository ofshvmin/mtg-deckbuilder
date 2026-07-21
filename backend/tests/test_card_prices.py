"""Per-printing price seeding for card_prints.

Prices used to be fetched live from Scryfall in the browser, one request per card,
which throttled and left the market-price field blank when browsing. These pin the
server-side path that replaces it: parse prices from the bulk file into card_prints,
and attach them to owned printings the same way images are.
"""
from app.services.card_prints import _price, print_doc


class TestPriceParsing:
    def test_parses_numeric_string(self):
        assert _price({"usd": "0.35"}, "usd") == 0.35

    def test_missing_key_is_none(self):
        assert _price({"usd": "0.35"}, "usd_foil") is None

    def test_null_and_empty_are_none(self):
        assert _price({"usd": None}, "usd") is None
        assert _price({"usd": ""}, "usd") is None

    def test_no_prices_object_is_none(self):
        assert _price(None, "usd") is None

    def test_garbage_is_none_not_raised(self):
        assert _price({"usd": "n/a"}, "usd") is None


class TestPrintDoc:
    def _card(self, **kw):
        base = {
            "id": "abc-123",
            "oracle_id": "oid-1",
            "name": "Changeling Wayfinder",
            "set": "ECL",
            "collector_number": "1",
            "prices": {"usd": "0.35", "usd_foil": "0.36"},
        }
        base.update(kw)
        return base

    def test_stores_both_prices(self):
        doc = print_doc(self._card())
        assert doc["price_usd"] == 0.35
        assert doc["price_usd_foil"] == 0.36

    def test_set_is_lowercased(self):
        assert print_doc(self._card())["set"] == "ecl"

    def test_omits_absent_prices_to_keep_docs_small(self):
        doc = print_doc(self._card(prices={"usd": "1.00"}))
        assert doc["price_usd"] == 1.0
        assert "price_usd_foil" not in doc

    def test_no_prices_object_stores_neither(self):
        doc = print_doc(self._card(prices=None))
        assert "price_usd" not in doc and "price_usd_foil" not in doc


class TestEnrichAttachesPrice:
    """enrich_printings must attach price the same way it attaches images.

    Verified against the real repo function with a fake async collection, so it
    exercises the actual matching logic rather than a copy.
    """

    def test_price_attached_by_set_and_collector(self):
        import asyncio

        from app.repositories import card_prints as repo

        stored = {
            ("ecl", "1"): {
                "set": "ecl", "collector_number": "1",
                "price_usd": 0.35, "price_usd_foil": 0.36,
                "image_uris": {"normal": "u"},
            }
        }

        class FakeCursor:
            def __init__(self, docs): self._docs = docs
            def __aiter__(self):
                async def gen():
                    for d in self._docs:
                        yield d
                return gen()

        class FakeColl:
            def find(self, query, *a, **k):
                # Only the set+collector branch is exercised here.
                return FakeCursor(list(stored.values()))

        class FakeDB:
            card_prints = FakeColl()

        printing = {"printing_key": "ecl|1|nonfoil", "edition": "ecl",
                    "collector_number": "1", "finish": "nonfoil"}
        asyncio.run(
            repo.enrich_printings(FakeDB(), [("Changeling Wayfinder", [printing])])
        )
        assert printing["price_usd"] == 0.35
        assert printing["price_usd_foil"] == 0.36
        assert printing["image_uris"] == {"normal": "u"}
