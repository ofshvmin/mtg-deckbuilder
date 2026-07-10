"""Unit tests for theme matching logic."""
from app.services.themes import ThemeMatcher, parse_subtypes, compute_theme_matches


def _card(oid, name, type_line, text="", keywords=None):
    return {
        "_id": oid,
        "name": name,
        "type_line": type_line,
        "oracle_text": text,
        "keywords": keywords or [],
    }


# --- parse_subtypes ---

def test_parse_subtypes_creature():
    assert parse_subtypes("Creature — Cat Warrior") == ["Cat", "Warrior"]


def test_parse_subtypes_no_dash():
    assert parse_subtypes("Instant") == []


def test_parse_subtypes_artifact_creature():
    assert parse_subtypes("Artifact Creature — Golem") == ["Golem"]


def test_parse_subtypes_regular_dash():
    assert parse_subtypes("Creature - Elf Druid") == ["Elf", "Druid"]


# --- Tribal matching ---

def test_tribal_matches_subtype():
    matcher = ThemeMatcher("cat")
    card = _card("A", "Leonin Warleader", "Creature — Cat Soldier")
    assert matcher.matches(card) is True


def test_tribal_no_match():
    matcher = ThemeMatcher("cat")
    card = _card("B", "Lightning Bolt", "Instant", "Deal 3 damage to any target.")
    assert matcher.matches(card) is False


def test_tribal_changeling_matches_everything():
    matcher = ThemeMatcher("cat")
    card = _card("C", "Changeling Outcast", "Creature — Shapeshifter", keywords=["changeling"])
    assert matcher.matches(card) is True


def test_tribal_oracle_text_reference():
    matcher = ThemeMatcher("cat")
    card = _card("D", "Feline Sovereign", "Enchantment", "Whenever a Cat enters the battlefield, you gain 1 life.")
    assert matcher.matches(card) is True


def test_tribal_case_insensitive():
    matcher = ThemeMatcher("Cat")
    card = _card("E", "Leonin Warleader", "Creature — Cat Soldier")
    assert matcher.matches(card) is True


# --- Mechanical matching ---

def test_landfall_keyword():
    matcher = ThemeMatcher("landfall")
    card = _card("F", "Avenger of Zendikar", "Creature — Plant", keywords=["landfall"])
    assert matcher.matches(card) is True


def test_landfall_oracle_text():
    matcher = ThemeMatcher("landfall")
    card = _card("G", "Tatyova", "Creature", "Whenever a land enters the battlefield under your control, draw a card.")
    assert matcher.matches(card) is True


def test_landfall_no_match():
    matcher = ThemeMatcher("landfall")
    card = _card("H", "Sol Ring", "Artifact", "{T}: Add {C}{C}.")
    assert matcher.matches(card) is False


def test_tokens_match():
    matcher = ThemeMatcher("tokens")
    card = _card("I", "Lingering Souls", "Sorcery", "Create two 1/1 white Spirit creature tokens with flying.")
    assert matcher.matches(card) is True


def test_sacrifice_match():
    matcher = ThemeMatcher("sacrifice")
    card = _card("J", "Viscera Seer", "Creature", "Sacrifice a creature: Scry 1.")
    assert matcher.matches(card) is True


def test_sacrifice_death_trigger():
    matcher = ThemeMatcher("sacrifice")
    card = _card("K", "Blood Artist", "Creature", "Whenever Blood Artist or another creature dies, ...")
    assert matcher.matches(card) is True


def test_blink_match():
    matcher = ThemeMatcher("blink")
    card = _card("L", "Conjurer's Closet", "Artifact", "At end of turn, exile target creature you control, then return that card to the battlefield.")
    assert matcher.matches(card) is True


def test_counters_match():
    matcher = ThemeMatcher("counters")
    card = _card("M", "Hardened Scales", "Enchantment", "If one or more +1/+1 counters would be placed, place that many plus one instead.")
    assert matcher.matches(card) is True


def test_voltron_match():
    matcher = ThemeMatcher("voltron")
    card = _card("N", "Sword of Fire", "Artifact — Equipment", "Equipped creature gets +2/+2.")
    assert matcher.matches(card) is True


def test_reanimator_match():
    matcher = ThemeMatcher("reanimator")
    card = _card("O", "Reanimate", "Sorcery", "Return target creature card from a graveyard to the battlefield.")
    assert matcher.matches(card) is True


# --- Name matching ---

def test_name_match_single_word():
    matcher = ThemeMatcher("urza")
    card = _card("P", "Urza's Tower", "Land — Urza's Tower", "{T}: Add {C}.")
    assert matcher.matches(card) is True


def test_name_match_no_substring_false_positive():
    """'cat' should not match 'Scatter' via name (word boundary)."""
    matcher = ThemeMatcher("cat")
    card = _card("Q", "Scatter to the Winds", "Instant", "Counter target spell.")
    assert matcher.matches(card) is False


def test_multiword_theme_filters_stopwords():
    """'Urza's lands' → distinctive keyword 'urza's' matches Urza's Mine."""
    matcher = ThemeMatcher("Urza's lands")
    card = _card("R", "Urza's Mine", "Land — Urza's Mine", "{T}: Add {C}.")
    assert matcher.matches(card) is True


def test_multiword_theme_no_match():
    matcher = ThemeMatcher("Urza's lands")
    card = _card("S", "Lightning Bolt", "Instant", "Deal 3 damage.")
    assert matcher.matches(card) is False


def test_type_line_match():
    """Theme keyword found in full type_line (e.g. 'Land — Urza's Tower')."""
    matcher = ThemeMatcher("urza's")
    card = _card("T", "Urza's Power Plant", "Land — Urza's Power-Plant", "{T}: Add {C}.")
    assert matcher.matches(card) is True


def test_name_match_dragon():
    """'dragon' matches a card named 'Dragon Tempest'."""
    matcher = ThemeMatcher("dragon")
    card = _card("U", "Dragon Tempest", "Enchantment", "Whenever a Dragon enters...")
    assert matcher.matches(card) is True


# --- compute_theme_matches ---

def test_compute_theme_matches_none():
    pool = [_card("A", "X", "Creature")]
    assert compute_theme_matches(pool, None) is None


def test_compute_theme_matches_empty_string():
    pool = [_card("A", "X", "Creature")]
    assert compute_theme_matches(pool, "") is None


def test_compute_theme_matches_returns_ids():
    pool = [
        _card("A", "Leonin", "Creature — Cat"),
        _card("B", "Bolt", "Instant", "Deal 3 damage."),
        _card("C", "Shapey", "Creature — Shapeshifter", keywords=["changeling"]),
    ]
    matches = compute_theme_matches(pool, "cat")
    assert matches == {"A", "C"}
