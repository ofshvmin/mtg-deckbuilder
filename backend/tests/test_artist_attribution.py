"""Artist credit for Scryfall art crops.

Scryfall's image policy only permits an `art_crop` where the illustrator is
credited in the same interface. The banner art and the artist therefore have to
travel together from the bulk sync all the way to the client: if either half can
go missing independently, a deck tile ends up rendering uncredited art.
"""
import asyncio

from app.repositories import card_prints as repo
from app.services.card_prints import print_doc


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d

        return gen()


class TestPrintDocStoresArtist:
    def _card(self, **kw):
        base = {
            "id": "abc-123",
            "oracle_id": "oid-1",
            "name": "Changeling Wayfinder",
            "set": "ECL",
            "collector_number": "1",
            "artist": "Rebecca Guay",
        }
        base.update(kw)
        return base

    def test_stores_artist(self):
        assert print_doc(self._card())["artist"] == "Rebecca Guay"

    def test_strips_surrounding_whitespace(self):
        assert print_doc(self._card(artist="  Rebecca Guay "))["artist"] == "Rebecca Guay"

    def test_omits_absent_artist(self):
        card = self._card()
        del card["artist"]
        assert "artist" not in print_doc(card)

    def test_blank_artist_is_omitted_not_stored_empty(self):
        # An empty string would satisfy a truthiness check downstream while
        # crediting nobody, so it must not reach the database at all.
        assert "artist" not in print_doc(self._card(artist="   "))


class TestEnrichAttachesArtist:
    """enrich_printings must carry artist alongside the image URLs it attaches."""

    def test_artist_attached_by_set_and_collector(self):
        stored = {
            "set": "ecl",
            "collector_number": "1",
            "image_uris": {"art_crop": "u"},
            "artist": "Rebecca Guay",
        }

        class FakeColl:
            def find(self, query, *a, **k):
                return FakeCursor([stored])

        class FakeDB:
            card_prints = FakeColl()

        printing = {
            "printing_key": "ecl|1|nonfoil",
            "edition": "ecl",
            "collector_number": "1",
            "finish": "nonfoil",
        }
        asyncio.run(repo.enrich_printings(FakeDB(), [("Changeling Wayfinder", [printing])]))
        assert printing["artist"] == "Rebecca Guay"


class TestArtByName:
    """art_by_name backs the deck-tile banners, so it must never return art
    without a credit, and must key lookups case-insensitively."""

    def _db(self, docs):
        class FakeColl:
            def find(self, query, projection=None, *a, **k):
                wanted = set(query["name_lower"]["$in"])
                # Mirror the real query's $exists guards.
                return FakeCursor(
                    [
                        d
                        for d in docs
                        if d["name_lower"] in wanted
                        and d.get("artist")
                        and (d.get("image_uris") or {}).get("art_crop")
                    ]
                )

        class FakeDB:
            card_prints = FakeColl()

        return FakeDB()

    def test_pairs_art_with_artist(self):
        db = self._db(
            [{"name_lower": "atraxa", "image_uris": {"art_crop": "u"}, "artist": "Guay"}]
        )
        out = asyncio.run(repo.art_by_name(db, ["Atraxa"]))
        assert out == {"atraxa": {"art_crop": "u", "artist": "Guay"}}

    def test_lookup_is_case_insensitive(self):
        db = self._db(
            [{"name_lower": "atraxa", "image_uris": {"art_crop": "u"}, "artist": "Guay"}]
        )
        assert "atraxa" in asyncio.run(repo.art_by_name(db, ["ATRAXA"]))

    def test_printing_without_artist_is_not_returned(self):
        # Uncredited art must be withheld entirely rather than shown bare.
        db = self._db([{"name_lower": "atraxa", "image_uris": {"art_crop": "u"}}])
        assert asyncio.run(repo.art_by_name(db, ["Atraxa"])) == {}

    def test_printing_without_art_crop_is_not_returned(self):
        db = self._db([{"name_lower": "atraxa", "image_uris": {}, "artist": "Guay"}])
        assert asyncio.run(repo.art_by_name(db, ["Atraxa"])) == {}

    def test_first_printing_wins_for_duplicate_names(self):
        db = self._db(
            [
                {"name_lower": "atraxa", "image_uris": {"art_crop": "first"}, "artist": "A"},
                {"name_lower": "atraxa", "image_uris": {"art_crop": "second"}, "artist": "B"},
            ]
        )
        out = asyncio.run(repo.art_by_name(db, ["Atraxa"]))
        assert out["atraxa"] == {"art_crop": "first", "artist": "A"}

    def test_empty_and_blank_names_skip_the_query(self):
        class ExplodingColl:
            def find(self, *a, **k):
                raise AssertionError("should not query for an empty name set")

        class FakeDB:
            card_prints = ExplodingColl()

        assert asyncio.run(repo.art_by_name(FakeDB(), [])) == {}
        assert asyncio.run(repo.art_by_name(FakeDB(), ["", None])) == {}
