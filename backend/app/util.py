"""Small shared helpers."""

import re
import unicodedata

COLORS = frozenset("WUBRG")
_MANA_SYMBOL = re.compile(r"\{([^}]+)\}")


def colors_in_cost(mana_cost: str) -> set[str]:
    """Every color appearing in a mana cost, hybrids counting as all their halves.

    A card costing {G/U} is both green and blue, so hybrid symbols contribute each
    side. Used to recover colors for the few cards Scryfall records none for.
    """
    out: set[str] = set()
    for symbol in _MANA_SYMBOL.findall(mana_cost or ""):
        out |= set(symbol.split("/")) & COLORS
    return out


def cost_castable_in(mana_cost: str, allowed: set[str]) -> bool:
    """Can this mana cost be paid using only `allowed` colors?

    Reads the *cost*, not the card's color. Those differ more often than you'd
    expect: a devoid card like Void Grafter is colorless (`colors == []`) yet still
    costs {1}{G}{U}, so filtering on `colors` lets it into a deck that can't cast it.

    Rules:
      - Generic/colorless symbols ({2}, {C}, {X}) are always payable.
      - A colored symbol is payable if its color is allowed.
      - A hybrid symbol ({G/U}, {2/W}) is payable if *any* of its halves is allowed.
      - A double-faced cost ("{1}{G} // {3}{U}") is payable if *either* face is —
        you only need to be able to cast one side.
    """
    if not mana_cost:
        return True
    if "//" in mana_cost:
        return any(cost_castable_in(face, allowed) for face in mana_cost.split("//"))
    for symbol in _MANA_SYMBOL.findall(mana_cost):
        needed = set(symbol.split("/")) & COLORS
        if needed and not (needed & allowed):
            return False
    return True


def card_castable_in(doc: dict, allowed: set[str]) -> bool:
    """Can this card go in a deck of exactly `allowed` colors?

    Lands are judged on color identity — a land's "cost" says nothing about what it
    taps for, and an off-color dual shouldn't be credited as fixing. Everything else
    is judged on its casting cost, falling back to color identity when no cost is
    recorded (tokens, oddities).
    """
    if "land" in (doc.get("type_line") or "").lower():
        return set(doc.get("color_identity") or []) <= allowed
    mana_cost = doc.get("mana_cost") or ""
    if mana_cost:
        return cost_castable_in(mana_cost, allowed)
    return set(doc.get("color_identity") or []) <= allowed


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
