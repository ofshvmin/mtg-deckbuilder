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
