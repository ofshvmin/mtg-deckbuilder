"""Small shared helpers."""

import unicodedata


def normalize_name(name: str) -> str:
    """Normalize a card name for matching Scryfall data against collection CSV rows.

    NFC-normalizes Unicode so that e.g. composed û and decomposed u+combining-circumflex
    produce the same string. Then trims, lowercases, and collapses whitespace.
    """
    return " ".join(unicodedata.normalize("NFC", name).strip().lower().split())


def strip_diacritics(name: str) -> str:
    """Fold diacritics to ASCII: Lim-Dûl → Lim-Dul, Séance → Seance."""
    nfkd = unicodedata.normalize("NFKD", name)
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
