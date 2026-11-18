"""The scheduled sync: cards, printings and combos run in order, and any failure is a non-zero exit."""
import asyncio

from app.jobs import sync_cards


def _patch(monkeypatch, *, ping=True, cards_error=None):
    calls = []

    async def connect():
        calls.append("connect")

    async def disconnect():
        calls.append("disconnect")

    async def do_ping():
        return ping

    async def cards_sync(db):
        calls.append("cards")
        if cards_error:
            raise cards_error
        return 10

    async def prints_sync(db):
        calls.append("prints")
        return 20

    async def combos_sync(db):
        calls.append("combos")
        return 30

    monkeypatch.setattr(sync_cards.db, "connect", connect)
    monkeypatch.setattr(sync_cards.db, "disconnect", disconnect)
    monkeypatch.setattr(sync_cards.db, "ping", do_ping)
    monkeypatch.setattr(sync_cards.db, "get_db", lambda: object())
    monkeypatch.setattr(sync_cards.scryfall, "sync", cards_sync)
    monkeypatch.setattr(sync_cards.card_prints, "sync", prints_sync)
    monkeypatch.setattr(sync_cards.spellbook, "sync", combos_sync)
    return calls


def test_runs_cards_then_prints_then_combos(monkeypatch):
    calls = _patch(monkeypatch)
    assert asyncio.run(sync_cards.run()) == 0
    assert calls == ["connect", "cards", "prints", "combos", "disconnect"]


def test_a_failed_sync_exits_non_zero_and_skips_the_rest(monkeypatch):
    calls = _patch(monkeypatch, cards_error=RuntimeError("scryfall down"))
    assert asyncio.run(sync_cards.run()) == 1
    assert "prints" not in calls
    assert "combos" not in calls
    assert calls[-1] == "disconnect"


def test_unreachable_database_exits_non_zero(monkeypatch):
    calls = _patch(monkeypatch, ping=False)
    assert asyncio.run(sync_cards.run()) == 1
    assert "cards" not in calls
