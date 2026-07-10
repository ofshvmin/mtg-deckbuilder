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


def normalize_finish(foil) -> str:
    """Collapse a foil/finish value to the canonical set {"foil", "nonfoil"}.

    Import stores `foil` as "foil" (or a foil variant) when foiled, else "".
    """
    return "foil" if str(foil or "").strip().lower() in {"foil", "etched", "true", "yes"} else "nonfoil"


def printing_key(edition, collector_number, finish) -> str:
    """Stable identity for a specific owned printing (an inventory unit).

    ``{edition}|{collector_number}|{finish}``, lowercased. This is the seam that
    future features hang off of: a catalog FK (the full printing universe), a
    price/image lookup key, and the target of deck→copy allocation. Derived
    purely from fields already stored on each collection_item, so no migration
    is needed — it can be computed on read or persisted on write.
    """
    ed = str(edition or "").strip().lower()
    cn = str(collector_number or "").strip().lower()
    fin = normalize_finish(finish)
    return f"{ed}|{cn}|{fin}"
