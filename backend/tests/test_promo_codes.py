"""Promo-card redemption.

The things that matter: a code works exactly once, an account gets at most one,
a code is never burned on an account that can't use it, and the grant actually
makes `is_premium` true — on its own field, out of the RevenueCat webhook's way.

Runs the real router and repositories against a small in-memory Mongo stand-in
that understands only the operators they use.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.repositories import promo_codes as promo_repo
from app.repositories import users as users_repo
from app.routers import promo


# ---- a tiny Mongo stand-in ----

def _get(doc, dotted):
    for part in dotted.split("."):
        if not isinstance(doc, dict) or part not in doc:
            return None, False
        doc = doc[part]
    return doc, True


def _matches(doc, query):
    for key, cond in query.items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in cond):
                return False
            continue
        value, present = _get(doc, key)
        if isinstance(cond, dict):
            if "$exists" in cond and present != cond["$exists"]:
                return False
            if "$gt" in cond and not (value is not None and value > cond["$gt"]):
                return False
        elif value != cond:
            return False
    return True


class FakeCollection:
    def __init__(self):
        self.docs: dict[str, dict] = {}

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = dict(doc)

    async def find_one(self, query):
        return next((d for d in self.docs.values() if _matches(d, query)), None)

    async def _update(self, query, update):
        doc = await self.find_one(query)
        if doc is None:
            return None
        before = dict(doc)
        doc.update(update.get("$set", {}))
        for key in update.get("$unset", {}):
            doc.pop(key, None)
        return before

    async def find_one_and_update(self, query, update):
        return await self._update(query, update)

    async def update_one(self, query, update):
        class Result:
            modified_count = 0

        result = Result()
        if await self._update(query, update) is not None:
            result.modified_count = 1
        return result


class FakeDB:
    def __init__(self):
        self.users = FakeCollection()
        self.promo_codes = FakeCollection()


@pytest.fixture
def database(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(promo.db, "get_db", lambda: fake)
    return fake


def run(coro):
    return asyncio.run(coro)


def add_user(database, _id="u1", **fields):
    database.users.docs[_id] = {"_id": _id, "email": f"{_id}@example.com", **fields}
    return _id


def redeem(database, user_id, code):
    """Redeem as the user as stored right now — the router gets a fresh read per request."""
    user = dict(database.users.docs[user_id])
    return run(promo.redeem(promo.RedeemRequest(code=code), current_user=user))


def make_code(database, days=365, expires_at=None):
    return run(promo_repo.create_batch(database, 1, days, "test", expires_at))[0]


# ---- codes ----

class TestCodes:
    def test_generated_codes_are_well_formed_and_distinct(self, database):
        codes = run(promo_repo.create_batch(database, 50, 365, "b"))
        assert len(set(codes)) == 50
        assert all(promo_repo.is_well_formed(c) for c in codes)

    def test_alphabet_has_no_lookalike_letters(self):
        assert not set("ILOU") & set(promo_repo.ALPHABET)

    def test_normalize_accepts_the_printed_form(self):
        assert promo_repo.normalize_code(" 7k3q-m9xd ") == "7K3QM9XD"

    def test_normalize_folds_lookalikes(self):
        assert promo_repo.normalize_code("O1IL-0000") == "01110000"

    def test_display_form(self):
        assert promo_repo.display_code("7K3QM9XD") == "7K3Q-M9XD"


# ---- redemption ----

class TestRedeem:
    def test_grants_premium_for_the_codes_days(self, database):
        code = make_code(database, days=365)
        uid = add_user(database)
        res = redeem(database, uid, promo_repo.display_code(code).lower())
        user = database.users.docs[uid]
        assert res.days == 365
        assert users_repo.is_premium(user)
        assert users_repo.promo_premium_until(user) == res.premium_until
        until = datetime.fromisoformat(res.premium_until)
        assert timedelta(days=364) < until - datetime.now(timezone.utc) <= timedelta(days=365)
        assert database.promo_codes.docs[code]["redeemed_by"] == uid

    def test_a_code_works_once(self, database):
        code = make_code(database)
        add_user(database, "a")
        add_user(database, "b")
        redeem(database, "a", code)
        with pytest.raises(HTTPException) as e:
            redeem(database, "b", code)
        assert e.value.status_code == 409
        assert "promo" not in database.users.docs["b"]

    def test_one_code_per_account(self, database):
        first, second = make_code(database), make_code(database)
        uid = add_user(database)
        redeem(database, uid, first)
        with pytest.raises(HTTPException) as e:
            redeem(database, uid, second)
        assert e.value.status_code == 409
        # The second card is still good for someone else.
        assert database.promo_codes.docs[second]["redeemed_by"] is None

    def test_already_premium_does_not_burn_the_code(self, database):
        code = make_code(database)
        uid = add_user(database, premium_exempt=True)
        with pytest.raises(HTTPException) as e:
            redeem(database, uid, code)
        assert e.value.status_code == 409
        assert database.promo_codes.docs[code]["redeemed_by"] is None

    def test_unknown_code(self, database):
        uid = add_user(database)
        with pytest.raises(HTTPException) as e:
            redeem(database, uid, "ZZZZ-ZZZZ")
        assert e.value.status_code == 404

    def test_malformed_code_is_just_invalid(self, database):
        uid = add_user(database)
        with pytest.raises(HTTPException) as e:
            redeem(database, uid, "not a code!")
        assert e.value.status_code == 404

    def test_expired_code(self, database):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        code = make_code(database, expires_at=past)
        uid = add_user(database)
        with pytest.raises(HTTPException) as e:
            redeem(database, uid, code)
        assert e.value.status_code == 410
        assert database.promo_codes.docs[code]["redeemed_by"] is None

    def test_losing_the_race_releases_the_account(self, database, monkeypatch):
        # Between our read and the claim, someone else takes the code.
        code = make_code(database)
        uid = add_user(database)

        async def lost(db, c, u):
            return None

        monkeypatch.setattr(promo.promo_repo, "claim", lost)
        with pytest.raises(HTTPException) as e:
            redeem(database, uid, code)
        assert e.value.status_code == 409
        assert "promo" not in database.users.docs[uid]

    def test_guessing_is_throttled(self, database):
        uid = add_user(database)
        for _ in range(promo.MAX_FAILURES):
            with pytest.raises(HTTPException):
                redeem(database, uid, "ZZZZ-ZZZZ")
        # Even a real code is refused once the account is locked out.
        code = make_code(database)
        with pytest.raises(HTTPException) as e:
            redeem(database, uid, code)
        assert e.value.status_code == 429
        assert database.promo_codes.docs[code]["redeemed_by"] is None


# ---- the grant itself ----

class TestPromoPremium:
    def test_lapses_at_its_end_date(self):
        past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        user = {"promo": {"code": "X", "until": past}}
        assert users_repo.promo_premium_until(user) is None
        assert not users_repo.is_premium(user)

    def test_survives_an_inactive_revenuecat_entitlement(self):
        # The webhook rewrites `premium` wholesale; the promo lives beside it.
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        user = {"promo": {"code": "X", "until": future}, "premium": {"active": False}}
        assert users_repo.is_premium(user)
