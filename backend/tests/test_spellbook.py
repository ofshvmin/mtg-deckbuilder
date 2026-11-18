"""Commander Spellbook: per-format legality and the in-place sync."""
import asyncio

import pytest

from app.services import spellbook


def _variant(vid, legal, oracle_ids=("a", "b"), identity="UR", popularity=10):
    return {
        "id": vid,
        "uses": [{"card": {"oracleId": oid, "name": oid.upper()}} for oid in oracle_ids],
        "produces": [{"feature": {"name": "Infinite mana"}}],
        "identity": identity,
        "popularity": popularity,
        "legalities": {
            "commander": "commander" in legal,
            "modern": "modern" in legal,
            "pauper": "pauper" in legal,
            "pauperCommander": "paupercommander" in legal,
            "brawl": True,  # a format we don't build: never listed
        },
    }


class TestComboDoc:
    def test_keeps_every_format_we_build(self):
        doc = spellbook.combo_doc(_variant("v1", {"commander", "modern", "pauper"}))
        assert doc["legal_in"] == ["commander", "modern", "pauper"]

    def test_non_commander_combos_are_kept(self):
        """The old sync dropped these; a Modern-only combo is now useful."""
        doc = spellbook.combo_doc(_variant("v2", {"modern"}))
        assert doc["legal_in"] == ["modern"]

    def test_pauper_commander_maps_to_our_key(self):
        doc = spellbook.combo_doc(_variant("v3", {"paupercommander"}))
        assert doc["legal_in"] == ["paupercommander"]

    def test_legal_nowhere_we_build_is_dropped(self):
        assert spellbook.combo_doc(_variant("v4", set())) is None

    def test_single_card_is_dropped(self):
        assert spellbook.combo_doc(_variant("v5", {"modern"}, oracle_ids=("a",))) is None


class TestLegalClause:
    def test_commander_accepts_docs_from_before_legal_in(self):
        assert spellbook._legal_clause("commander") == {"legal_in": {"$in": ["commander", None]}}

    def test_other_formats_need_the_tag(self):
        assert spellbook._legal_clause("modern") == {"legal_in": "modern"}


class _FakeCombos:
    """Just enough of an async Mongo collection for sync()."""

    def __init__(self, docs):
        self.docs = {d["_id"]: dict(d) for d in docs}

    async def count_documents(self, _query):
        return len(self.docs)

    async def bulk_write(self, ops, ordered=False):
        for op in ops:
            doc = op._doc
            self.docs[doc["_id"]] = dict(doc)

    async def delete_many(self, query):
        stamp = query["synced_at"]["$ne"]
        gone = [k for k, d in self.docs.items() if d.get("synced_at") != stamp]
        for k in gone:
            del self.docs[k]

        class _R:
            deleted_count = len(gone)

        return _R()

    async def create_index(self, _key):
        return None


class _FakeDb:
    def __init__(self, docs):
        self.combos = _FakeCombos(docs)


def _feed(n):
    async def gen():
        for i in range(n):
            yield spellbook.combo_doc(_variant(f"v{i}", {"commander"}))

    return gen


class TestSync:
    def test_upserts_then_prunes_what_the_feed_dropped(self, monkeypatch):
        db = _FakeDb([{"_id": "stale"}] + [{"_id": f"v{i}"} for i in range(9)])
        monkeypatch.setattr(spellbook, "iter_combos", _feed(10))
        count = asyncio.run(spellbook.sync(db))
        assert count == 10
        assert "stale" not in db.combos.docs
        assert all("legal_in" in d for d in db.combos.docs.values())

    def test_a_much_smaller_feed_stops_before_pruning(self, monkeypatch):
        db = _FakeDb([{"_id": f"old{i}"} for i in range(100)])
        monkeypatch.setattr(spellbook, "iter_combos", _feed(10))
        with pytest.raises(RuntimeError, match="not pruning"):
            asyncio.run(spellbook.sync(db))
        assert all(f"old{i}" in db.combos.docs for i in range(100))

    def test_first_sync_into_an_empty_collection(self, monkeypatch):
        db = _FakeDb([])
        monkeypatch.setattr(spellbook, "iter_combos", _feed(5))
        assert asyncio.run(spellbook.sync(db)) == 5


class _FakeResp:
    def __init__(self, payload: bytes, chunk=7):
        self._payload, self._chunk = payload, chunk

    async def aiter_bytes(self):
        for i in range(0, len(self._payload), self._chunk):
            yield self._payload[i : i + self._chunk]


def _parse(payload: bytes):
    import ijson

    async def run():
        return [v async for v in ijson.items_async(spellbook._AsyncBody(_FakeResp(payload)), "variants.item")]

    return asyncio.run(run())


class TestStreamingParse:
    def test_reads_variants_across_chunk_boundaries(self):
        payload = b'{"version": "1", "variants": [{"id": "a"}, {"id": "b"}]}'
        assert [v["id"] for v in _parse(payload)] == ["a", "b"]

    def test_truncated_feed_raises(self):
        """A cut-off download must fail, not read as a short feed (which would prune)."""
        import ijson

        payload = b'{"version": "1", "variants": [{"id": "a"}, {"id": "b'
        with pytest.raises(ijson.common.IncompleteJSONError):
            _parse(payload)
