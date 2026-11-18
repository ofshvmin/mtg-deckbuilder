"""Card choice: Staples · Balanced · Hidden gems.

Balanced must be exactly today's deck in every format — shipped apps never send
the field. The other two must move the deck's popularity the way their names say,
without breaking its shape.
"""
from app.services import card_choice, generator, scryfall
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


def _doc(oid, cmc, rank, type_line="Creature — Elf", text="", copies=4):
    return {
        "_id": oid,
        "name": oid,
        "name_normalized": oid,
        "type_line": type_line,
        "cmc": cmc,
        "mana_cost": f"{{{int(cmc)}}}",
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


def _pool(copies=4):
    """Many interchangeable cards at every rank, so popularity is what decides.

    Commander (singletons) gets a deeper pool, or a 62-spell deck would simply use
    all of it and no setting could change anything.
    """
    ranks = [5, 50, 300, 900, 2_500, 6_000, 9_000, 20_000, None]
    pool = []
    for i, rank in enumerate(ranks * (6 if copies > 1 else 20)):
        pool.append(_doc(f"c{i}", 1 + i % 4, rank, copies=copies))
    for i, rank in enumerate(ranks):
        pool.append(_doc(f"kill{i}", 2, rank, "Instant", "Destroy target creature.", copies))
    return pool


def _build(choice, spec=STANDARD, commander=None, copies=4):
    t = card_choice.tuning(choice, spec)
    return generator.generate(
        commander, _pool(copies), ["G"], BASICS,
        spec=spec, strategy=get_strategy(None, spec),
        rank_weight=t.rank_weight, quality_weight=t.quality_weight,
    )


def _median_rank(deck, pool):
    ranks = {d["_id"]: d["edhrec_rank"] for d in pool}
    vals = sorted(
        ranks[c.oracle_id] or 30_000
        for c in deck.cards
        for _ in range(c.count)
        if c.oracle_id in ranks
    )
    return vals[len(vals) // 2]


class TestTuning:
    def test_balanced_is_the_format_default(self):
        for spec in (STANDARD, COMMANDER):
            t = card_choice.tuning("balanced", spec)
            assert t.rank_weight == spec.rank_weight
            assert t.quality_weight == generator.QUALITY_WEIGHT
            assert t.jitter == 0.0

    def test_missing_or_unknown_is_balanced(self):
        assert card_choice.tuning(None, STANDARD) == card_choice.tuning("balanced", STANDARD)
        assert card_choice.tuning("chaos", STANDARD) == card_choice.tuning("balanced", STANDARD)

    def test_hidden_gems_flips_rank(self):
        assert card_choice.tuning("hidden_gems", STANDARD).rank_weight < 0
        assert card_choice.tuning("hidden_gems", COMMANDER).rank_weight < 0


class TestBalancedIsToday:
    def test_sixty_card(self):
        default = generator.generate(
            None, _pool(), ["G"], BASICS, spec=STANDARD, strategy=get_strategy(None, STANDARD)
        )
        balanced = _build("balanced")
        assert [(c.oracle_id, c.count) for c in default.cards] == [
            (c.oracle_id, c.count) for c in balanced.cards
        ]

    def test_commander(self):
        cmdr = {"_id": "cmdr", "name": "Cmdr", "color_identity": ["G"]}
        default = generator.generate(cmdr, _pool(1), ["G"], BASICS, spec=COMMANDER)
        balanced = _build("balanced", COMMANDER, cmdr, copies=1)
        assert [(c.oracle_id, c.count) for c in default.cards] == [
            (c.oracle_id, c.count) for c in balanced.cards
        ]


class TestSettingsMoveTheDeck:
    def test_staples_more_popular_than_hidden_gems(self):
        pool = _pool()
        staples = _median_rank(_build("staples"), pool)
        balanced = _median_rank(_build("balanced"), pool)
        gems = _median_rank(_build("hidden_gems"), pool)
        assert staples <= balanced < gems

    def test_commander_hidden_gems_less_popular(self):
        cmdr = {"_id": "cmdr", "name": "Cmdr", "color_identity": ["G"]}
        pool = _pool(1)
        staples = _median_rank(_build("staples", COMMANDER, cmdr, copies=1), pool)
        gems = _median_rank(_build("hidden_gems", COMMANDER, cmdr, copies=1), pool)
        assert staples < gems

    def test_every_setting_builds_a_full_deck(self):
        for choice in ("staples", "balanced", "hidden_gems"):
            assert sum(c.count for c in _build(choice).cards) == 60


class TestGemBonus:
    def test_unranked_and_obscure_earn_nothing(self):
        assert generator.gem_bonus(0.0) == 0.0
        assert generator.gem_bonus(scryfall.rank_score(25_000)) == 0.0

    def test_sweet_spot_beats_staples_and_obscurities(self):
        sweet = generator.gem_bonus(scryfall.rank_score(2_000))
        assert sweet == 1.0
        assert generator.gem_bonus(scryfall.rank_score(100)) < sweet
        assert generator.gem_bonus(scryfall.rank_score(8_000)) < sweet

    def test_staples_earn_nothing(self):
        assert generator.gem_bonus(scryfall.rank_score(10)) == 0.0
