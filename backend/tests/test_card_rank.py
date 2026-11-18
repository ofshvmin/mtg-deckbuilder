"""Card rank: Scryfall's edhrec_rank as a card-quality signal.

60-card formats had no way to tell a strong card from a weak one that fills the
same role at the same cost. These tests pin the score's shape, that it decides
between otherwise-equal cards, and that Commander output ignores it.
"""
from app.services import generator, scryfall
from app.services.formats import get_format
from app.services.strategies import get_strategy

STANDARD = get_format("standard")
COMMANDER = get_format("commander")

BASICS = {
    "G": {
        "name": "Forest",
        "type_line": "Basic Land — Forest",
        "color_identity": ["G"],
        "produced_mana": ["G"],
    }
}


def _doc(oid, name, type_line, cmc, text="", rank=None, copies=4):
    return {
        "_id": oid,
        "name": name,
        "name_normalized": name.lower(),
        "type_line": type_line,
        "cmc": cmc,
        "mana_cost": f"{{{int(cmc)}}}" if cmc else "",
        "color_identity": ["G"],
        "colors": ["G"],
        "oracle_text": text,
        "produced_mana": None,
        "keywords": [],
        "is_basic_land": False,
        "copies_owned": copies,
        "edhrec_rank": rank,
        "rank_score": scryfall.rank_score(rank),
    }


class TestRankScore:
    def test_top_card_scores_one(self):
        assert scryfall.rank_score(1) == 1.0

    def test_unranked_scores_zero(self):
        assert scryfall.rank_score(None) == 0.0
        assert scryfall.rank_score(0) == 0.0

    def test_log_scale(self):
        assert 0.5 < scryfall.rank_score(100) < 0.6
        assert 0.3 < scryfall.rank_score(1_000) < 0.36
        assert scryfall.rank_score(10) > scryfall.rank_score(100) > scryfall.rank_score(1_000)

    def test_past_the_floor_is_zero(self):
        assert scryfall.rank_score(scryfall.RANK_FLOOR * 2) == 0.0

    def test_doc_from_card_stores_both(self):
        card = {
            "oracle_id": "x",
            "name": "Lightning Bolt",
            "type_line": "Instant",
            "edhrec_rank": 12,
        }
        doc = scryfall.doc_from_card(card)
        assert doc["edhrec_rank"] == 12
        assert doc["rank_score"] == scryfall.rank_score(12)


def _twins_pool():
    """Filler, plus two removal spells identical but for rank.

    The low-ranked twin comes first: the greedy fill keeps the first of equal
    scores, so without the rank signal it would win every tie.
    """
    pool = [_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 2, copies=4) for i in range(12)]
    pool.append(_doc("bulk", "Bulk Kill", "Instant", 2, "Destroy target creature.", rank=20_000, copies=4))
    pool.append(_doc("staple", "Staple Kill", "Instant", 2, "Destroy target creature.", rank=20, copies=4))
    return pool


# Room for exactly one playset of removal, so the twins compete for it.
ONE_PLAYSET_OF_REMOVAL = {"removal": 4}


def _build(spec, pool, **kw):
    return generator.generate(
        None, pool, ["G"], BASICS, spec=spec, strategy=get_strategy(None, spec), **kw
    )


def _count(deck, oid):
    return sum(c.count for c in deck.cards if c.oracle_id == oid)


class TestGeneratorUsesRank:
    def test_formats_carry_the_weight(self):
        assert STANDARD.rank_weight > 0
        assert COMMANDER.rank_weight == 0
        for key in ("pioneer", "modern", "legacy", "pauper"):
            assert get_format(key).rank_weight > 0

    def test_higher_ranked_twin_takes_the_removal_slots(self):
        deck = _build(STANDARD, _twins_pool(), quotas=ONE_PLAYSET_OF_REMOVAL)
        removal = {c.oracle_id: c.count for c in deck.cards if c.slot == "removal"}
        assert removal == {"staple": 4}

    def test_without_rank_the_first_twin_wins(self):
        """Control: with rank off the tie goes to pool order — rank is what decides."""
        deck = _build(STANDARD, _twins_pool(), quotas=ONE_PLAYSET_OF_REMOVAL, rank_weight=0.0)
        removal = {c.oracle_id: c.count for c in deck.cards if c.slot == "removal"}
        assert removal == {"bulk": 4}

    def test_unranked_cards_still_fill_the_deck(self):
        pool = [_doc(f"c{i}", f"Card {i}", "Creature — Cat", 2, copies=4) for i in range(12)]
        deck = _build(STANDARD, pool)
        assert sum(c.count for c in deck.cards) == 60

    def test_widely_played_reason(self):
        pool = [_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 2, copies=4) for i in range(12)]
        pool.append(_doc("famous", "Famous Bear", "Creature — Bear", 2, rank=5, copies=4))
        deck = _build(STANDARD, pool)
        famous = next(c for c in deck.cards if c.oracle_id == "famous")
        assert famous.reason == "Widely played"


class TestCommanderUnaffected:
    def test_rank_does_not_change_commander_output(self):
        """Commander's rank_weight is 0: ranked and unranked pools build the same deck."""
        commander = {"_id": "cmdr", "name": "Cmdr", "color_identity": ["G"]}
        ranked = [_doc(f"c{i}", f"Card {i}", "Creature — Elf", 2, rank=i * 500 + 1, copies=1) for i in range(80)]
        unranked = [{**d, "edhrec_rank": None, "rank_score": 0.0} for d in ranked]
        a = generator.generate(commander, ranked, ["G"], BASICS, spec=COMMANDER)
        b = generator.generate(commander, unranked, ["G"], BASICS, spec=COMMANDER)
        assert [(c.oracle_id, c.count, c.reason) for c in a.cards] == [
            (c.oracle_id, c.count, c.reason) for c in b.cards
        ]


class TestCommanderOnlyCards:
    def test_color_identity_cards_need_a_commander(self):
        from app.repositories.cards import needs_a_commander

        tower = {"oracle_text": "{T}: Add one mana of any color in your commander's color identity."}
        signet = {"oracle_text": "{T}: Add one mana of any color in your commander’s color identity."}
        bolt = {"oracle_text": "Lightning Bolt deals 3 damage to any target."}
        assert needs_a_commander(tower)
        assert needs_a_commander(signet)  # curly apostrophe
        assert needs_a_commander(bolt) is False


def _land(oid, name, makes, rank, copies=4, type_line="Land"):
    doc = _doc(oid, name, type_line, 0, "", rank=rank, copies=copies)
    doc["produced_mana"] = makes
    return doc


def _spells():
    return [_doc(f"cat{i}", f"Cat {i}", "Creature — Cat", 2, copies=4) for i in range(12)]


def _lands(deck):
    return {c.oracle_id: c.count for c in deck.cards if c.slot == "land"}


class TestConstructedManaBase:
    def test_obscure_lands_lose_to_basics(self):
        """The old bug: every owned nonbasic went in before a single Forest."""
        pool = _spells() + [
            _land(f"util{i}", f"Utility {i}", ["W", "U", "B", "R", "G"], rank=3_000)
            for i in range(8)
        ]
        lands = _lands(_build(STANDARD, pool))
        assert set(lands) == {"basic:G"}

    def test_widely_played_lands_still_make_the_cut(self):
        pool = _spells() + [_land("good", "Good Land", ["G"], rank=200)]
        lands = _lands(_build(STANDARD, pool))
        assert lands.get("good") == 4

    def test_mono_color_keeps_most_lands_basic(self):
        pool = _spells() + [
            _land(f"good{i}", f"Good Land {i}", ["G"], rank=100 + i) for i in range(10)
        ]
        deck = _build(STANDARD, pool)
        total = sum(_lands(deck).values())
        basics = _lands(deck).get("basic:G", 0)
        assert basics >= round(total * 0.75)

    def test_lands_that_miss_the_deck_colors_are_skipped(self):
        pool = _spells() + [_land("blue", "Island Dual", ["U", "W"], rank=50)]
        assert "blue" not in _lands(_build(STANDARD, pool))

    def test_mono_color_skips_rainbow_lands(self):
        pool = _spells() + [_land("orchard", "Exotic Orchard", ["W", "U", "B", "R", "G"], rank=9)]
        assert "orchard" not in _lands(_build(STANDARD, pool))


def _commander_build(lands, spells=70):
    commander = {"_id": "cmdr", "name": "Cmdr", "color_identity": ["G"]}
    pool = [_doc(f"c{i}", f"Card {i}", "Creature — Elf", 2, copies=1) for i in range(spells)]
    return generator.generate(commander, pool + lands, ["G"], BASICS, spec=COMMANDER)


class TestCommanderManaBase:
    def test_obscure_lands_lose_to_basics(self):
        lands = [_land(f"util{i}", f"Utility {i}", ["G"], rank=9_000, copies=1) for i in range(5)]
        assert set(_lands(_commander_build(lands))) == {"basic:G"}

    def test_keeps_a_quarter_basics_however_many_good_lands(self):
        lands = [_land(f"good{i}", f"Good {i}", ["G"], rank=50 + i, copies=1) for i in range(40)]
        deck = _commander_build(lands)
        assert _lands(deck)["basic:G"] >= round(deck.land_count * 0.25)

    def test_colorless_utility_lands_are_allowed(self):
        lands = [_land("tower", "Reliquary Tower", ["C"], rank=10, copies=1)]
        assert _lands(_commander_build(lands)).get("tower") == 1

    def test_unsynced_cards_skip_the_rank_floor(self):
        """Before the sync adds rank_score, lands aren't judged as unplayed."""
        lands = [_land(f"util{i}", f"Utility {i}", ["G"], rank=None, copies=1) for i in range(5)]
        for land in lands:
            del land["rank_score"]
        assert all(_lands(_commander_build(lands)).get(f"util{i}") == 1 for i in range(5))

    def test_off_color_fetchlands_are_skipped(self):
        delta = _land("delta", "Polluted Delta", [], rank=40, copies=1)
        delta["oracle_text"] = "{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle."
        heath = _land("heath", "Windswept Heath", [], rank=45, copies=1)
        heath["oracle_text"] = "{T}, Pay 1 life, Sacrifice Windswept Heath: Search your library for a Forest or Plains card, put it onto the battlefield, then shuffle."
        lands = _lands(_commander_build([delta, heath]))
        assert "delta" not in lands
        assert lands.get("heath") == 1
