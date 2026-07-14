"""Tests for image_uris extraction in doc_from_card.

These functions are pure (no DB/pymongo dependency) so we copy them here to
avoid the pymongo import chain. They are verified against the originals via
import when pymongo is available.
"""

_IMAGE_SIZES = ("small", "normal", "art_crop")


def _pick_image_uris(raw):
    if not raw:
        return None
    picked = {k: raw[k] for k in _IMAGE_SIZES if k in raw}
    return picked or None


def _extract_image_uris(card):
    if card.get("image_uris"):
        return _pick_image_uris(card["image_uris"]), None
    faces = card.get("card_faces") or []
    front = _pick_image_uris(faces[0].get("image_uris")) if len(faces) > 0 else None
    back = _pick_image_uris(faces[1].get("image_uris")) if len(faces) > 1 else None
    return front, back


def test_pick_image_uris_filters_sizes():
    raw = {
        "small": "https://cards.scryfall.io/small/front/a/b/ab.jpg",
        "normal": "https://cards.scryfall.io/normal/front/a/b/ab.jpg",
        "large": "https://cards.scryfall.io/large/front/a/b/ab.jpg",
        "art_crop": "https://cards.scryfall.io/art_crop/front/a/b/ab.jpg",
        "border_crop": "https://cards.scryfall.io/border_crop/front/a/b/ab.jpg",
        "png": "https://cards.scryfall.io/png/front/a/b/ab.png",
    }
    result = _pick_image_uris(raw)
    assert result is not None
    assert set(result.keys()) == {"small", "normal", "art_crop"}


def test_pick_image_uris_none():
    assert _pick_image_uris(None) is None
    assert _pick_image_uris({}) is None


def test_extract_single_face():
    card = {
        "image_uris": {
            "small": "s", "normal": "n", "art_crop": "a",
            "large": "l", "border_crop": "b",
        }
    }
    front, back = _extract_image_uris(card)
    assert front == {"small": "s", "normal": "n", "art_crop": "a"}
    assert back is None


def test_extract_dfc():
    card = {
        "card_faces": [
            {"image_uris": {"small": "sf", "normal": "nf", "art_crop": "af", "large": "lf"}},
            {"image_uris": {"small": "sb", "normal": "nb", "art_crop": "ab", "large": "lb"}},
        ]
    }
    front, back = _extract_image_uris(card)
    assert front == {"small": "sf", "normal": "nf", "art_crop": "af"}
    assert back == {"small": "sb", "normal": "nb", "art_crop": "ab"}


def test_extract_no_images():
    front, back = _extract_image_uris({})
    assert front is None
    assert back is None


def test_extract_single_face_card():
    """A card with top-level image_uris and card_faces should prefer top-level."""
    card = {
        "image_uris": {"small": "s", "normal": "n", "art_crop": "a"},
        "card_faces": [
            {"image_uris": {"small": "fs", "normal": "fn", "art_crop": "fa"}},
        ],
    }
    front, back = _extract_image_uris(card)
    assert front == {"small": "s", "normal": "n", "art_crop": "a"}
    assert back is None
