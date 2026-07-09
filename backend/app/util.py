"""Small shared helpers."""


def normalize_name(name: str) -> str:
    """Normalize a card name for matching Scryfall data against collection CSV rows.

    (Same rule used across Phase 1 scripts: trim, lowercase, collapse whitespace.)
    """
    return " ".join(name.strip().lower().split())
