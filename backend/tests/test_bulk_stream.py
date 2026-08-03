"""Reading Scryfall's gzipped-JSONL bulk files.

Scryfall replaced the plain-JSON `download_uri` with a gzipped JSONL
`jsonl_download_uri`. The old reader called `resp.json()` on a whole array, so
there was nothing to get wrong; the new one inflates a gzip stream and splits
records on newlines as chunks arrive, which introduces a failure mode the pure
transform tests cannot see — a record straddling two chunks would be silently
truncated, and every other test in this suite would still pass.

These tests drive the reader with a fake httpx client at deliberately hostile
chunk sizes so that boundary handling is exercised rather than assumed.
"""
import gzip
import json

import httpx
import pytest

from app.services.scryfall import bulk_download_uri, iter_bulk_cards

URI = "https://data.scryfall.io/default-cards/default-cards-20260803090856.jsonl.gz"

# A non-ASCII artist is deliberate: Scryfall serves raw UTF-8, so a multi-byte
# name is the case that would break a reader splitting on decoded text.
CARDS = [
    {"id": "1", "name": "Forest", "lang": "en", "artist": "David Robert Hovey"},
    {"id": "2", "name": "Edgar Markov", "lang": "en", "artist": "Volkan Baǵa"},
    {"id": "3", "name": "Fury Sliver", "lang": "en", "artist": "Paolo Parente"},
]


def _jsonl_gz(records, *, trailing_newline=True, blank_lines=False) -> bytes:
    sep = "\n\n" if blank_lines else "\n"
    body = sep.join(json.dumps(r, ensure_ascii=False) for r in records)
    if trailing_newline:
        body += "\n"
    return gzip.compress(body.encode("utf-8"))


def _index(*entries) -> dict:
    return {"object": "list", "has_more": False, "data": list(entries)}


class _IndexResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _StreamResponse:
    def __init__(self, body, chunk_size, error=None):
        self._body = body
        self._chunk_size = chunk_size
        self._error = error

    def raise_for_status(self):
        if self._error:
            raise self._error

    async def aiter_bytes(self):
        for i in range(0, len(self._body), self._chunk_size):
            yield self._body[i : i + self._chunk_size]


class _StreamContext:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *exc_info):
        return False


class FakeClient:
    """Stands in for httpx.AsyncClient: `get` for the index, `stream` for the file."""

    def __init__(self, index, body=b"", chunk_size=64, stream_error=None):
        self._index = index
        self._body = body
        self._chunk_size = chunk_size
        self._stream_error = stream_error
        self.streamed_urls = []

    async def get(self, url, **kwargs):
        return _IndexResponse(self._index)

    def stream(self, method, url, **kwargs):
        # httpx.stream is not a coroutine — it returns an async context manager.
        self.streamed_urls.append((method, url))
        return _StreamContext(
            _StreamResponse(self._body, self._chunk_size, self._stream_error)
        )


class TestBulkDownloadUri:
    async def test_selects_the_requested_type(self):
        client = FakeClient(
            _index(
                {"type": "oracle_cards", "jsonl_download_uri": "https://example/oracle.jsonl.gz"},
                {"type": "default_cards", "jsonl_download_uri": URI},
            )
        )
        assert await bulk_download_uri(client, "default_cards") == URI

    async def test_legacy_download_uri_only_entry_is_rejected(self):
        """The exact shape that broke the sync: the entry exists, but carries
        only the retired plain-JSON field. Falling back to it would download an
        array the JSONL reader cannot parse, so it must raise instead."""
        client = FakeClient(
            _index({"type": "default_cards", "download_uri": "https://example/default.json"})
        )
        with pytest.raises(RuntimeError, match="default_cards"):
            await bulk_download_uri(client, "default_cards")

    async def test_absent_type_raises(self):
        client = FakeClient(_index({"type": "oracle_cards", "jsonl_download_uri": URI}))
        with pytest.raises(RuntimeError, match="rulings"):
            await bulk_download_uri(client, "rulings")

    async def test_empty_index_raises(self):
        with pytest.raises(RuntimeError):
            await bulk_download_uri(FakeClient({}), "default_cards")


class TestIterBulkCards:
    def _client(self, body, chunk_size=64, stream_error=None):
        return FakeClient(
            _index({"type": "default_cards", "jsonl_download_uri": URI}),
            body=body,
            chunk_size=chunk_size,
            stream_error=stream_error,
        )

    async def _collect(self, client):
        return [card async for card in iter_bulk_cards(client, "default_cards")]

    async def test_yields_every_record(self):
        assert await self._collect(self._client(_jsonl_gz(CARDS))) == CARDS

    async def test_streams_from_the_resolved_uri(self):
        client = self._client(_jsonl_gz(CARDS))
        await self._collect(client)
        assert client.streamed_urls == [("GET", URI)]

    # 1 byte splits every record and every multi-byte character; 7 and 13 are
    # coprime with the record lengths so boundaries land mid-token; a chunk
    # larger than the body exercises the single-pass case.
    @pytest.mark.parametrize("chunk_size", [1, 3, 7, 13, 64, 512, 10**6])
    async def test_survives_hostile_chunk_boundaries(self, chunk_size):
        body = _jsonl_gz(CARDS)
        assert await self._collect(self._client(body, chunk_size=chunk_size)) == CARDS

    @pytest.mark.parametrize("chunk_size", [1, 7, 10**6])
    async def test_multibyte_artist_survives_chunking(self, chunk_size):
        body = _jsonl_gz(CARDS)
        cards = await self._collect(self._client(body, chunk_size=chunk_size))
        assert cards[1]["artist"] == "Volkan Baǵa"

    async def test_final_record_without_trailing_newline_is_not_dropped(self):
        """Nothing guarantees the file ends in a newline; the last record is only
        emitted by the post-loop flush, which is easy to omit."""
        body = _jsonl_gz(CARDS, trailing_newline=False)
        assert await self._collect(self._client(body, chunk_size=7)) == CARDS

    async def test_blank_lines_are_skipped(self):
        body = _jsonl_gz(CARDS, blank_lines=True)
        assert await self._collect(self._client(body, chunk_size=7)) == CARDS

    async def test_empty_file_yields_nothing(self):
        assert await self._collect(self._client(gzip.compress(b""))) == []

    async def test_http_error_aborts_before_yielding(self):
        error = httpx.HTTPStatusError(
            "429", request=httpx.Request("GET", URI), response=httpx.Response(429)
        )
        with pytest.raises(httpx.HTTPStatusError):
            await self._collect(self._client(_jsonl_gz(CARDS), stream_error=error))

    async def test_truncated_gzip_raises_rather_than_returning_partial_data(self):
        """A cut-off download must fail loudly.

        zlib does not help here: decompress() and flush() both accept a
        truncated stream without complaint, so a short read looks exactly like a
        small bulk file. The callers replace the collection wholesale and prune
        anything absent, so partial data would silently delete real printings.
        """
        # Enough records that half the compressed bytes still decode to some of
        # them — the dangerous case is partial success, not total failure.
        cards = [dict(CARDS[0], id=str(i)) for i in range(500)]
        body = _jsonl_gz(cards)
        with pytest.raises(RuntimeError, match="[Tt]runcated"):
            await self._collect(self._client(body[: len(body) // 2], chunk_size=512))

    async def test_complete_stream_is_not_mistaken_for_truncation(self):
        # Guards the eof check itself: a whole file must still pass cleanly at a
        # chunk size that lands the gzip trailer in its own chunk.
        body = _jsonl_gz(CARDS)
        assert await self._collect(self._client(body, chunk_size=len(body) - 1)) == CARDS
