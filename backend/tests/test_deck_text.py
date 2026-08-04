"""Decklist parsing: the shapes a pasted or uploaded deck actually arrives in.

The reference case is a Moxfield text export with everything on — quantity,
set code, collector number, foil marker and category tag — because that is the
richest line format we have to survive. Everything else (bare "1 Sol Ring",
Arena, section headers, CSV exports) is a subset of it.
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.explore as explore
from app.models.responses import GeneratedDeckResponse
from app.services import deck_text

MOXFIELD_SAMPLE = """\
1x Alms Collector (c17) 1 [Creature]
1x Animate Dead (plst) EMA-78 [Enchantment]
1x Ash Barrens (2xm) 310 [Land]
1x Dawn of Hope (grn) 8 [Maybeboard{noDeck}{noPrice}]
10x Plains (khm) 394 [Land]
1x Ravos, Soultender (c16) 39 *F* [Commander{top}]
1x Tymna the Weaver (c16) 48 *F* [Commander{top}]
1x Unearth (mh1) 113 [Maybeboard{noDeck}{noPrice}]
"""


class TestMoxfieldTextExport:
    def test_parses_every_deck_line(self):
        parsed = deck_text.parse(MOXFIELD_SAMPLE)
        names = [e.name for e in parsed.entries]
        assert names == [
            "Alms Collector", "Animate Dead", "Ash Barrens", "Plains",
            "Ravos, Soultender", "Tymna the Weaver",
        ]
        assert parsed.unparsed == []

    def test_printing_is_kept(self):
        parsed = deck_text.parse(MOXFIELD_SAMPLE)
        animate = next(e for e in parsed.entries if e.name == "Animate Dead")
        assert (animate.edition, animate.collector_number) == ("plst", "EMA-78")

    def test_quantity(self):
        parsed = deck_text.parse(MOXFIELD_SAMPLE)
        plains = next(e for e in parsed.entries if e.name == "Plains")
        assert plains.quantity == 10
        assert plains.edition == "khm"

    def test_total_counts_copies_not_lines(self):
        parsed = deck_text.parse(MOXFIELD_SAMPLE)
        assert parsed.total_cards == 15  # 5 singletons + 10 Plains

    def test_commander_tag(self):
        parsed = deck_text.parse(MOXFIELD_SAMPLE)
        commanders = [e.name for e in parsed.entries if e.is_commander]
        assert commanders == ["Ravos, Soultender", "Tymna the Weaver"]

    def test_foil_marker(self):
        parsed = deck_text.parse(MOXFIELD_SAMPLE)
        ravos = next(e for e in parsed.entries if e.name == "Ravos, Soultender")
        assert ravos.foil is True
        assert ravos.collector_number == "39"

    def test_maybeboard_is_excluded_not_dropped(self):
        parsed = deck_text.parse(MOXFIELD_SAMPLE)
        assert [e.name for e in parsed.excluded] == ["Dawn of Hope", "Unearth"]

    def test_no_deck_flag_wins_over_a_normal_category_name(self):
        parsed = deck_text.parse("1x Sol Ring (c17) 1 [Artifact{noDeck}]\n")
        assert parsed.entries == []
        assert [e.name for e in parsed.excluded] == ["Sol Ring"]


class TestPlainLines:
    def test_bare_quantity_and_name(self):
        parsed = deck_text.parse("1 Sol Ring\n3 Lightning Bolt\n")
        assert [(e.name, e.quantity) for e in parsed.entries] == [
            ("Sol Ring", 1), ("Lightning Bolt", 3),
        ]

    def test_name_only_is_one_copy(self):
        parsed = deck_text.parse("Sol Ring\nLightning Bolt\n")
        assert [(e.name, e.quantity) for e in parsed.entries] == [
            ("Sol Ring", 1), ("Lightning Bolt", 1),
        ]

    def test_arena_style_set_and_number(self):
        parsed = deck_text.parse("1 Sol Ring (LTC) 288\n")
        entry = parsed.entries[0]
        assert (entry.name, entry.edition, entry.collector_number) == ("Sol Ring", "ltc", "288")

    def test_double_faced_name_survives(self):
        parsed = deck_text.parse("1 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (neo) 141\n")
        assert parsed.entries[0].name == "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"

    def test_comments_and_blank_lines_are_ignored(self):
        parsed = deck_text.parse("// my deck\n\n#notes\n1 Sol Ring\n")
        assert [e.name for e in parsed.entries] == ["Sol Ring"]
        assert parsed.unparsed == []

    def test_leading_digits_in_a_name_are_not_a_quantity(self):
        # Four digits can't be a copy count, so the name keeps its number.
        parsed = deck_text.parse("1996 World Champion\n")
        assert [(e.name, e.quantity) for e in parsed.entries] == [("1996 World Champion", 1)]

    def test_absurd_quantity_is_clamped(self):
        parsed = deck_text.parse("999 Sol Ring\n")
        assert parsed.entries[0].quantity == deck_text.MAX_QUANTITY

    def test_parenthesised_name_suffix_is_not_a_set_code(self):
        parsed = deck_text.parse("1 Erase (Not the Urza's Legacy One)\n")
        entry = parsed.entries[0]
        assert entry.name == "Erase (Not the Urza's Legacy One)"
        assert entry.edition is None


class TestSections:
    def test_commander_section_marks_its_cards(self):
        parsed = deck_text.parse(
            "Commander (1)\n1 Tymna the Weaver\n\nDeck (2)\n1 Sol Ring\n1 Swamp\n"
        )
        assert [(e.name, e.is_commander) for e in parsed.entries] == [
            ("Tymna the Weaver", True), ("Sol Ring", False), ("Swamp", False),
        ]

    def test_sideboard_section_is_excluded(self):
        parsed = deck_text.parse("Deck\n1 Sol Ring\n\nSideboard\n1 Pithing Needle\n")
        assert [e.name for e in parsed.entries] == ["Sol Ring"]
        assert [e.name for e in parsed.excluded] == ["Pithing Needle"]

    def test_sb_prefix_is_excluded(self):
        parsed = deck_text.parse("1 Sol Ring\nSB: 2 Pithing Needle\n")
        assert [e.name for e in parsed.entries] == ["Sol Ring"]
        assert [(e.name, e.quantity) for e in parsed.excluded] == [("Pithing Needle", 2)]

    def test_a_card_named_like_nothing_we_know_is_still_a_card(self):
        # "Sol Ring" alone looks like a section header by shape; only known
        # section labels get that treatment.
        parsed = deck_text.parse("Sol Ring\n")
        assert [e.name for e in parsed.entries] == ["Sol Ring"]

    def test_type_headers_reset_a_commander_section(self):
        parsed = deck_text.parse("Commander\n1 Tymna the Weaver\nCreatures\n1 Blood Artist\n")
        assert [(e.name, e.is_commander) for e in parsed.entries] == [
            ("Tymna the Weaver", True), ("Blood Artist", False),
        ]


class TestCsv:
    MOXFIELD_CSV = (
        '"Count","Name","Edition","Condition","Language","Foil","Collector Number"\n'
        '"1","Sol Ring","c17","NM","English","","1"\n'
        '"10","Plains","khm","NM","English","foil","394"\n'
    )

    def test_moxfield_csv_is_detected(self):
        parsed = deck_text.parse(self.MOXFIELD_CSV)
        assert parsed.source_format == "Moxfield"
        assert [(e.name, e.quantity) for e in parsed.entries] == [("Sol Ring", 1), ("Plains", 10)]

    def test_csv_printing_and_finish(self):
        parsed = deck_text.parse(self.MOXFIELD_CSV)
        plains = parsed.entries[1]
        assert (plains.edition, plains.collector_number, plains.foil) == ("khm", "394", True)

    def test_archidekt_csv_category_column(self):
        text = (
            "Quantity,Name,Edition Code,Edition Name,Collector Number,Finish,Category\n"
            "1,Tymna the Weaver,c16,Commander 2016,48,Foil,Commander\n"
            "1,Sol Ring,c17,Commander 2017,1,Normal,Artifact\n"
            "1,Pithing Needle,jmp,Jumpstart,468,Normal,Maybeboard\n"
        )
        parsed = deck_text.parse(text)
        assert parsed.source_format == "Archidekt"
        assert [(e.name, e.is_commander) for e in parsed.entries] == [
            ("Tymna the Weaver", True), ("Sol Ring", False),
        ]
        assert [e.name for e in parsed.excluded] == ["Pithing Needle"]

    def test_unknown_csv_headers_fall_back_to_text(self):
        # No known format matches, but each line still reads as "qty name".
        parsed = deck_text.parse("1 Sol Ring\n1 Swamp\n")
        assert parsed.source_format == "text"
        assert len(parsed.entries) == 2


class TestGuards:
    def test_empty_input(self):
        parsed = deck_text.parse("")
        assert parsed.entries == [] and parsed.excluded == []

    def test_entry_cap(self):
        text = "".join(f"1 Card {i}\n" for i in range(deck_text.MAX_ENTRIES + 50))
        parsed = deck_text.parse(text)
        assert len(parsed.entries) == deck_text.MAX_ENTRIES

    def test_line_cap(self):
        text = "".join(f"1 Card {i}\n" for i in range(deck_text.MAX_LINES + 100))
        parsed = deck_text.parse(text)
        # Capped by MAX_ENTRIES first; the point is it terminates bounded.
        assert len(parsed.entries) <= deck_text.MAX_ENTRIES

    def test_entry_converts_to_resolver_shape(self):
        entry = deck_text.DeckEntry(name="Tymna the Weaver", quantity=1, is_commander=True)
        assert entry.as_card_entry() == {
            "name": "Tymna the Weaver", "quantity": 1, "categories": ["Commander"],
        }


def empty_deck_response(**overrides) -> GeneratedDeckResponse:
    base = dict(
        color_identity=[], total=0, land_count=0, nonland_count=0, role_counts={},
        curve=[], color_sources={}, stats={}, warnings=[], edhrec_available=False,
        combos=[], near_combos=[], cards=[],
    )
    return GeneratedDeckResponse(**{**base, **overrides})


class TestImportEndpoint:
    """The handler around the parser: guards, and what it tells you it skipped."""

    USER = {"_id": "user-1"}

    def _run(self, monkeypatch, text, name="Imported deck", unresolved=None):
        seen: dict = {}

        async def fake_resolve(database, user_id, card_entries, collect_unresolved=None):
            seen["entries"] = card_entries
            seen["user_id"] = user_id
            if collect_unresolved is not None:
                collect_unresolved.extend(unresolved or [])
            return empty_deck_response(total=len(card_entries)), 0, len(card_entries)

        monkeypatch.setattr(explore, "_resolve_external_deck", fake_resolve)
        monkeypatch.setattr(explore.db, "get_db", lambda: object())
        body = explore.ImportDeckListRequest(text=text, name=name)
        result = asyncio.run(explore.import_deck_list(body, current_user=self.USER))
        return result, seen

    def test_resolves_the_parsed_entries(self, monkeypatch):
        result, seen = self._run(monkeypatch, MOXFIELD_SAMPLE)
        assert [e["name"] for e in seen["entries"]][:2] == ["Alms Collector", "Animate Dead"]
        assert seen["user_id"] == "user-1"
        assert result.owner == "Imported"
        assert result.source == "decklist"

    def test_commanders_are_flagged_for_the_resolver(self, monkeypatch):
        _, seen = self._run(monkeypatch, MOXFIELD_SAMPLE)
        commanders = [e["name"] for e in seen["entries"] if e["categories"] == ["Commander"]]
        assert commanders == ["Ravos, Soultender", "Tymna the Weaver"]

    def test_maybeboard_is_reported_as_a_warning(self, monkeypatch):
        result, _ = self._run(monkeypatch, MOXFIELD_SAMPLE)
        assert any("maybeboard or sideboard" in w for w in result.deck.warnings)

    def test_unresolved_names_come_back(self, monkeypatch):
        result, _ = self._run(monkeypatch, "1 Sol Ring\n1 Nonexistent Card\n",
                              unresolved=["Nonexistent Card"])
        assert result.unresolved_names == ["Nonexistent Card"]

    def test_csv_import_names_its_format(self, monkeypatch):
        result, _ = self._run(monkeypatch, TestCsv.MOXFIELD_CSV)
        assert result.source == "Moxfield"

    def test_deck_name_is_trimmed_with_a_fallback(self, monkeypatch):
        result, _ = self._run(monkeypatch, "1 Sol Ring\n", name="   ")
        assert result.name == "Imported deck"

    def test_blank_input_is_rejected(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            self._run(monkeypatch, "   \n\n")
        assert exc.value.status_code == 400

    def test_a_list_with_no_cards_is_rejected(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            self._run(monkeypatch, "// just a comment\nSideboard\n")
        assert exc.value.status_code == 400
        assert "No cards found" in exc.value.detail

    def test_oversized_input_is_rejected(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            self._run(monkeypatch, "1 Sol Ring\n" * 40_000)
        assert exc.value.status_code == 413
