"""Unit tests for account deletion (App Store Guideline 5.1.1(v) compliance).

Verifies the DELETE /auth/me handler purges *all* of a user's data — their
collection rows and saved decks — before removing the user document itself.
"""
import asyncio

import app.auth.routes as routes


def test_delete_account_purges_all_user_data(monkeypatch):
    calls: list[tuple[str, str]] = []

    async def fake_delete_collection(db, user_id):
        calls.append(("collection", user_id))
        return 12

    async def fake_delete_decks(db, user_id):
        calls.append(("decks", user_id))
        return 3

    async def fake_delete_user(db, user_id):
        calls.append(("user", user_id))
        return True

    monkeypatch.setattr(routes.collection_repo, "delete_all_for_user", fake_delete_collection)
    monkeypatch.setattr(routes.decks_repo, "delete_all_for_user", fake_delete_decks)
    monkeypatch.setattr(routes.users_repo, "delete_user", fake_delete_user)
    monkeypatch.setattr(routes.db, "get_db", lambda: object())

    result = asyncio.run(routes.delete_account(current_user={"_id": "user-123"}))

    # 204 No Content -> handler returns None.
    assert result is None
    # Every owned collection is purged, and the user is removed, for this id.
    assert calls == [
        ("collection", "user-123"),
        ("decks", "user-123"),
        ("user", "user-123"),
    ]


def test_delete_account_removes_user_last(monkeypatch):
    """The user document must be deleted only after their data is purged, so a
    mid-way failure never orphans data behind a still-deletable account."""
    order: list[str] = []

    async def rec(name):
        order.append(name)
        return 0

    monkeypatch.setattr(routes.collection_repo, "delete_all_for_user",
                        lambda db, uid: rec("collection"))
    monkeypatch.setattr(routes.decks_repo, "delete_all_for_user",
                        lambda db, uid: rec("decks"))
    monkeypatch.setattr(routes.users_repo, "delete_user",
                        lambda db, uid: rec("user"))
    monkeypatch.setattr(routes.db, "get_db", lambda: object())

    asyncio.run(routes.delete_account(current_user={"_id": "u"}))

    assert order.index("user") == len(order) - 1
