"""The commander picker's filters, as the Mongo query they become.

There's no Mongo in the test environment, so these pin the query shape and then
evaluate it with a tiny matcher covering just the operators it uses — enough to
prove "exact identity" really is exact, which is the part that's easy to get wrong.
"""
import re

from app.repositories.cards import commander_filter_query


def matches(doc: dict, query: dict) -> bool:
    for field, cond in query.items():
        value = doc.get(field)
        if "$size" in cond and len(value) != cond["$size"]:
            return False
        if "$all" in cond and not all(c in value for c in cond["$all"]):
            return False
        if "$lte" in cond and not value <= cond["$lte"]:
            return False
        if "$regex" in cond:
            flags = re.I if cond.get("$options") == "i" else 0
            if not re.search(cond["$regex"], value, flags):
                return False
    return True


def card(name, identity, cmc=3.0, type_line="Legendary Creature — Human Wizard", mana_cost="{3}"):
    return {
        "name": name,
        "name_normalized": name.lower(),
        "color_identity": identity,
        "cmc": cmc,
        "type_line": type_line,
        "mana_cost": mana_cost,
    }


TROSTANI = card("Trostani", ["G", "W"], 3.0, "Legendary Creature — Dryad")
ATRAXA = card("Atraxa", ["B", "G", "U", "W"], 4.0, "Legendary Creature — Phyrexian Angel Horror")
MARWYN = card("Marwyn", ["G"], 2.0, "Legendary Creature — Elf Druid")
KARN = card("Karn", [], 4.0, "Legendary Artifact Creature — Golem")
SELFLESS = card("Selfless Savior", ["W"], 1.0, "Legendary Creature — Dog")
KOZILEK = card("Kozilek", [], 10.0, "Legendary Creature — Eldrazi", "{8}{C}{C}")
ULALEK = card(
    "Ulalek", ["B", "G", "R", "U", "W"], 7.0, "Legendary Creature — Eldrazi Horror",
    "{2}{C/W}{C/U}{C/B}{C/R}{C/G}",
)
SLIVER_QUEEN = card("Sliver Queen", ["B", "G", "R", "U", "W"], 5.0, "Legendary Creature — Sliver", "{W}{U}{B}{R}{G}")
ALL = [TROSTANI, ATRAXA, MARWYN, KARN, SELFLESS, KOZILEK, ULALEK, SLIVER_QUEEN]


def names(**filters):
    q = commander_filter_query(**filters)
    return {c["name"] for c in ALL if matches(c, q)}


def test_no_filters_is_an_empty_fragment():
    # Older clients send only q/limit — the query must be exactly what it was.
    assert commander_filter_query() == {}
    assert commander_filter_query(colors=[]) == {}


def test_colors_are_an_exact_identity_not_a_superset():
    assert names(colors=["G", "W"]) == {"Trostani"}
    assert names(colors=["G"]) == {"Marwyn"}


def test_color_order_does_not_matter():
    assert names(colors=["W", "G"]) == {"Trostani"}


def test_colorless_alone_means_colorless_commanders_pip_or_not():
    assert names(colors=["C"]) == {"Karn", "Kozilek"}


def test_colorless_combines_with_colors_as_a_cost_pip():
    # Ulalek's {C/X} hybrids count; Sliver Queen has the identity but no {C}.
    assert names(colors=["W", "U", "B", "R", "G", "C"]) == {"Ulalek"}
    assert names(colors=["W", "U", "B", "R", "G"]) == {"Ulalek", "Sliver Queen"}


def test_max_mana_value_is_inclusive():
    assert names(max_mv=2) == {"Marwyn", "Selfless Savior"}
    assert names(max_mv=3) == {"Marwyn", "Selfless Savior", "Trostani"}


def test_creature_type_matches_a_whole_subtype_word():
    assert names(creature_type="elf") == {"Marwyn"}
    assert names(creature_type="Angel") == {"Atraxa"}
    # "elf" inside "Selfless" (the name, left of the dash) must not count.
    assert "Selfless Savior" not in names(creature_type="elf")


def test_creature_type_is_regex_escaped():
    assert names(creature_type="(") == set()


def test_filters_combine():
    assert names(colors=["G"], max_mv=2, creature_type="Druid") == {"Marwyn"}
    assert names(colors=["G"], creature_type="Dryad") == set()


# ---- set filter: which owned cards are even candidates ----

def run_search(monkeypatch, sets):
    """Call the router with a fake collection; return the owned ids it searched."""
    import asyncio

    from app.routers import commanders

    async def owned_counts(db, user_id):
        return {"trostani": 1, "atraxa": 2}

    async def owned_printings(db, user_id):
        return {
            "trostani": [{"edition": "GPT"}, {"edition": "c19"}],
            "atraxa": [{"edition": "c16"}],
        }

    searched = {}

    async def search(db, owned_ids, **kwargs):
        searched["ids"] = set(owned_ids)
        return []

    monkeypatch.setattr(commanders.db, "get_db", lambda: None)
    monkeypatch.setattr(commanders.collection_repo, "owned_counts", owned_counts)
    monkeypatch.setattr(commanders.collection_repo, "owned_printings", owned_printings)
    monkeypatch.setattr(commanders.cards_repo, "search_owned_commanders", search)
    asyncio.run(commanders.search_commanders(
        q="", limit=20, colors="", max_mv=None, creature_type="", sets=sets, current_user={"_id": "u"}
    ))
    return searched["ids"]


def test_no_sets_searches_the_whole_collection(monkeypatch):
    assert run_search(monkeypatch, None) == {"trostani", "atraxa"}


def test_sets_keep_commanders_owned_in_any_of_them(monkeypatch):
    # Set codes match case-insensitively, as the collection browser's do.
    assert run_search(monkeypatch, ["gpt"]) == {"trostani"}
    assert run_search(monkeypatch, ["c16", "c19"]) == {"trostani", "atraxa"}
    assert run_search(monkeypatch, ["m21"]) == set()


def test_commander_sets_count_only_eligible_commanders(monkeypatch):
    import asyncio

    from app.routers import commanders

    async def owned_printings(db, user_id):
        return {
            "trostani": [{"edition": "GPT"}, {"edition": "c19"}, {"edition": "c19"}],
            "atraxa": [{"edition": "c16"}, {"edition": "C19"}],
            "forest": [{"edition": "m21"}],  # not a commander: its set never appears
        }

    async def owned_commander_ids(db, owned_ids):
        return {"trostani", "atraxa"} & set(owned_ids)

    async def set_names(db, codes):
        return {"c19": "Commander 2019"}

    monkeypatch.setattr(commanders.db, "get_db", lambda: None)
    monkeypatch.setattr(commanders.collection_repo, "owned_printings", owned_printings)
    monkeypatch.setattr(commanders.cards_repo, "owned_commander_ids", owned_commander_ids)
    monkeypatch.setattr(commanders.card_prints_repo, "set_names", set_names)
    rows = asyncio.run(commanders.commander_sets(current_user={"_id": "u"}))
    assert [(r.code, r.name, r.commanders) for r in rows] == [
        ("c16", "C16", 1),
        ("c19", "Commander 2019", 2),
        ("gpt", "GPT", 1),
    ]
