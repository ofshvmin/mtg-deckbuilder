"""Role tagger unit tests (no DB — pure function on card-shaped dicts)."""
from app.services import roles


def card(name, type_line, text, produced=None):
    return {"name": name, "type_line": type_line, "oracle_text": text, "produced_mana": produced}


def test_ramp_rock_and_land():
    assert roles.RAMP in roles.tag_roles(card("Sol Ring", "Artifact", "{T}: Add {C}{C}.", ["C"]))
    assert roles.RAMP in roles.tag_roles(
        card("Cultivate", "Sorcery", "Search your library for up to two basic land cards, "
             "reveal them, put one onto the battlefield tapped and the other into your hand.")
    )


def test_removal_vs_board_wipe():
    assert roles.REMOVAL in roles.tag_roles(card("Swords", "Instant", "Exile target creature."))
    assert roles.BOARD_WIPE in roles.tag_roles(card("Wrath", "Sorcery", "Destroy all creatures."))


def test_pinger_is_not_a_board_wipe():
    # "damage to each opponent" must NOT be tagged as a board wipe.
    tags = roles.tag_roles(card("Pinger", "Creature", "Deals 1 damage to each opponent."))
    assert roles.BOARD_WIPE not in tags


def test_tutor_and_counter_and_draw():
    assert roles.TUTOR in roles.tag_roles(
        card("Demonic Tutor", "Sorcery", "Search your library for a card and put it into your hand.")
    )
    assert roles.COUNTERSPELL in roles.tag_roles(
        card("Counterspell", "Instant", "Counter target spell.")
    )
    assert roles.CARD_DRAW in roles.tag_roles(
        card("Divination", "Sorcery", "Draw two cards.")
    )
