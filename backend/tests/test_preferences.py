"""Unit tests for user preferences (max card price)."""
import pytest
from pydantic import ValidationError

from app.auth.routes import _public
from app.models.user import UpdatePreferencesRequest, UserPreferences


def test_preferences_default_is_no_cap():
    assert UserPreferences().max_card_price is None


def test_preferences_rejects_negative():
    with pytest.raises(ValidationError):
        UpdatePreferencesRequest(max_card_price=-5)


def test_preferences_accepts_value_and_null():
    assert UpdatePreferencesRequest(max_card_price=5).max_card_price == 5
    assert UpdatePreferencesRequest(max_card_price=None).max_card_price is None


def test_public_includes_preferences():
    user = {"_id": "u1", "email": "a@b.com", "created_at": "2026-01-01",
            "preferences": {"max_card_price": 10}}
    out = _public(user)
    assert out.preferences.max_card_price == 10


def test_public_defaults_when_no_preferences():
    user = {"_id": "u1", "email": "a@b.com", "created_at": "2026-01-01"}
    assert _public(user).preferences.max_card_price is None
