"""Mana math CLI — Phase 2 deliverable.

Standalone tools built on mana_math.py. Four subcommands:

  prob      General hypergeometric query (any deck/successes/draws).
              python mana_calc.py prob --deck 99 --successes 37 --draws 7 --at-least 2

  sources   Karsten colored-source recommender. No args prints the full table;
            --pips/--turn answers one question.
              python mana_calc.py sources
              python mana_calc.py sources --pips 2 --turn 3

  lands     Land-probability summary for a given land count in a deck.
              python mana_calc.py lands --deck 99 --lands 37

  analyze   Read a decklist (one "<count> <name>" per line), look up each
            card's mana cost / mana production in the local card DB, and report
            the mana curve, colored-pip demand, colored sources, Karsten
            source gaps, and a recommended land count.
              python mana_calc.py analyze mydeck.txt
              python mana_calc.py analyze mydeck.txt --commander "Korvold, Fae-Cursed King"

`analyze` needs the card DB built (scryfall_sync.py). The others are pure math.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import mana_math as mm

COLOR_ORDER = ["W", "U", "B", "R", "G"]
COLOR_NAMES = {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green"}

# {...} mana symbols, e.g. {2}, {B}, {B/R}, {B/P}, {2/W}, {X}, {C}
SYMBOL_RE = re.compile(r"\{([^}]+)\}")


# --------------------------------------------------------------------------
# Mana-cost parsing
# --------------------------------------------------------------------------

def color_pips(mana_cost: str) -> dict:
    """Count colored pips per color in a mana cost string.

    Hybrid symbols ({B/R}) count toward each color they contain, since either
    could be needed. Phyrexian ({B/P}) counts toward its color (payable with
    life, so it's a soft requirement, but we count it to stay conservative).
    Generic/colorless ({2}, {X}, {C}) contribute nothing to color demand.
    """
    pips = {c: 0 for c in COLOR_ORDER}
    if not mana_cost:
        return pips
    for sym in SYMBOL_RE.findall(mana_cost):
        parts = sym.split("/")
        for c in COLOR_ORDER:
            if c in parts:
                pips[c] += 1
    return pips


def produced_colors(produced_mana_json: str) -> set:
    """Set of colors this card can produce (from Scryfall produced_mana)."""
    try:
        produced = json.loads(produced_mana_json) if produced_mana_json else []
    except (json.JSONDecodeError, TypeError):
        produced = []
    return {c for c in produced if c in COLOR_ORDER}


# --------------------------------------------------------------------------
# Decklist parsing + DB lookup
# --------------------------------------------------------------------------

LINE_RE = re.compile(r"^\s*(?:(\d+)\s*x?\s+)?(.+?)\s*$")
# strip trailing annotations: "(SET) 123", "*CMDR*", "*F*", "[tag]"
ANNOT_RE = re.compile(r"\s*(\((?:[^)]*)\)\s*[\w-]*|\*[^*]+\*|\[[^\]]*\])\s*$")


def parse_decklist(path: Path) -> list:
    """Return a list of (count, name) from a plain-text decklist.

    Accepts "1 Sol Ring", "1x Sol Ring", or bare "Sol Ring". Skips blank lines,
    comments (# or //), and section headers (lines with no alphabetic content).
    """
    entries = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        m = LINE_RE.match(line)
        if not m:
            continue
        count = int(m.group(1)) if m.group(1) else 1
        name = m.group(2)
        prev = None
        while prev != name:  # peel multiple trailing annotations
            prev = name
            name = ANNOT_RE.sub("", name).strip()
        if not any(ch.isalpha() for ch in name):
            continue
        entries.append((count, name))
    return entries


def lookup_cards(entries: list):
    """Match decklist entries against the cards table. Returns (matched, unmatched)
    where matched is a list of dicts with count + card fields."""
    from db import get_connection, normalize_name

    conn = get_connection()
    if conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0:
        sys.exit("cards table is empty — run scryfall_sync.py first.")

    matched, unmatched = [], []
    for count, name in entries:
        row = conn.execute(
            "SELECT name, mana_cost, cmc, type_line, oracle_text, color_identity, "
            "produced_mana, is_basic_land FROM cards WHERE name_normalized = ?",
            (normalize_name(name),),
        ).fetchone()
        if row is None:
            unmatched.append(name)
        else:
            d = dict(row)
            d["count"] = count
            matched.append(d)
    conn.close()
    return matched, unmatched


# --------------------------------------------------------------------------
# Ramp / cheap-draw heuristic (rough; real tagging is Phase 3)
# --------------------------------------------------------------------------

def is_ramp(card: dict) -> bool:
    text = (card.get("oracle_text") or "").lower()
    is_land = "land" in (card.get("type_line") or "").lower()
    if is_land:
        return False
    produces = bool(produced_colors(card.get("produced_mana")) or
                    "c" in [c.lower() for c in json.loads(card.get("produced_mana") or "[]")])
    cmc = card.get("cmc") or 0
    if produces and cmc <= 3:
        return True
    return ("add {" in text or "search your library for a" in text and "land" in text) and cmc <= 3


def is_cheap_draw(card: dict) -> bool:
    text = (card.get("oracle_text") or "").lower()
    cmc = card.get("cmc") or 0
    return "draw" in text and "card" in text and cmc <= 3 and "land" not in (card.get("type_line") or "").lower()


def _deck_identity(matched: list, commander: str = None) -> set:
    """Colors the deck can actually produce/use. If a commander name is given,
    look up its color identity; otherwise take the union of every card's color
    identity (all legal cards sit within the commander's identity, so the union
    reconstructs it as long as each color is represented)."""
    from db import get_connection, normalize_name
    if commander:
        conn = get_connection()
        row = conn.execute("SELECT color_identity FROM cards WHERE name_normalized=?",
                           (normalize_name(commander),)).fetchone()
        conn.close()
        if row:
            return set(json.loads(row["color_identity"] or "[]")) & set(COLOR_ORDER)
    ident = set()
    for c in matched:
        ident |= set(json.loads(c.get("color_identity") or "[]"))
    return ident & set(COLOR_ORDER)


def karsten_land_count(avg_cmc: float, cheap_ramp_draw: int) -> float:
    """Frank Karsten's Commander land-count formula (99-card deck):
    lands = 31.42 + 3.13 * avg_nonland_mana_value - 0.28 * (cheap ramp + cheap draw)."""
    return 31.42 + 3.13 * avg_cmc - 0.28 * cheap_ramp_draw


# --------------------------------------------------------------------------
# Subcommand handlers
# --------------------------------------------------------------------------

def cmd_prob(args):
    N, K, n = args.deck, args.successes, args.draws
    print(f"Deck {N}, {K} favorable cards, drawing {n}:")
    if args.exactly is not None:
        p = mm.hypergeometric_exactly(N, K, n, args.exactly)
        print(f"  P(exactly {args.exactly}) = {p*100:.2f}%")
    if args.at_least is not None:
        p = mm.hypergeometric_at_least(N, K, n, args.at_least)
        print(f"  P(at least {args.at_least}) = {p*100:.2f}%")
    if args.at_most is not None:
        p = mm.hypergeometric_at_most(N, K, n, args.at_most)
        print(f"  P(at most {args.at_most}) = {p*100:.2f}%")
    if args.exactly is None and args.at_least is None and args.at_most is None:
        # default: show the distribution
        print("  count  P(exactly)  P(at least)")
        for k in range(0, min(K, n) + 1):
            pe = mm.hypergeometric_exactly(N, K, n, k)
            pa = mm.hypergeometric_at_least(N, K, n, k)
            print(f"  {k:>5}  {pe*100:>9.2f}%  {pa*100:>10.2f}%")


def cmd_sources(args):
    if args.pips is not None and args.turn is not None:
        s = mm.sources_needed(args.pips, args.turn, args.deck, args.threshold)
        p = mm.prob_have_sources(args.deck, s, args.turn, args.pips)
        print(f"To cast a spell needing {args.pips} colored pip(s) of one color on "
              f"turn {args.turn} in a {args.deck}-card deck")
        print(f"with >= {args.threshold*100:.0f}% reliability: {s} sources "
              f"(gives {p*100:.1f}%).")
        return
    print(f"Karsten-style colored sources needed ({args.deck}-card deck, "
          f">= {args.threshold*100:.0f}%, on the play, on curve, no mulligan):")
    table = mm.karsten_table(args.deck, args.threshold, max_pips=3, max_turn=7)
    print("        " + "".join(f"turn {t:<2}" for t in range(1, 8)))
    for pips, row in table.items():
        label = f"{pips} pip " if pips == 1 else f"{pips} pips"
        cells = "".join(f"{row[t]:<7}" if t in row else f'{"-":<7}' for t in range(1, 8))
        print(f"  {label} {cells}")
    print("\nNote: raw no-mulligan model (conservative). See mana_math.py docstring.")


def cmd_lands(args):
    N, L = args.deck, args.lands
    print(f"{N}-card deck with {L} lands — opening hand of 7:")
    for x in (1, 2, 3, 4):
        p = mm.hypergeometric_at_least(N, L, 7, x)
        print(f"  P(>= {x} land{'s' if x>1 else ' '} in opener) = {p*100:.1f}%")
    print("  Lands seen by turn (on the play), P(>= that turn's land drop):")
    for turn in range(1, 6):
        seen = mm.cards_seen(turn, on_play=True)
        p = mm.hypergeometric_at_least(N, L, seen, turn)
        print(f"    by turn {turn} ({seen} cards seen): P(>= {turn} lands) = {p*100:.1f}%")


def cmd_analyze(args):
    entries = parse_decklist(args.decklist)
    if args.commander:
        entries = [(c, n) for c, n in entries
                   if n.strip().lower() != args.commander.strip().lower()]
    matched, unmatched = lookup_cards(entries)
    if not matched:
        sys.exit("No cards matched the DB. Check the decklist and that scryfall_sync ran.")

    total = sum(c["count"] for c in matched)
    lands = [c for c in matched if "land" in (c["type_line"] or "").lower()]
    nonlands = [c for c in matched if c not in lands]
    land_ct = sum(c["count"] for c in lands)
    nonland_ct = sum(c["count"] for c in nonlands)

    print(f"=== Deck analysis: {args.decklist.name} ===")
    if args.commander:
        print(f"Commander (excluded from counts): {args.commander}")
    print(f"Total cards: {total}   Lands: {land_ct}   Nonlands: {nonland_ct}")
    if unmatched:
        print(f"Unmatched (ignored): {len(unmatched)} -> {', '.join(unmatched[:8])}"
              + (" ..." if len(unmatched) > 8 else ""))

    # Deck color identity: from the commander if given, else the union across
    # all cards. Used to cap "any color" sources (Command Tower etc., which
    # Scryfall lists as producing all 5) to colors the deck can actually use.
    deck_identity = _deck_identity(matched, args.commander)

    # ---- Mana curve (bucket 7+ together) ----
    curve = {}
    total_cmc = 0.0
    for c in nonlands:
        cmc = min(int(c["cmc"] or 0), 7)
        curve[cmc] = curve.get(cmc, 0) + c["count"]
        total_cmc += (c["cmc"] or 0) * c["count"]
    avg_cmc = total_cmc / nonland_ct if nonland_ct else 0.0
    print(f"\nMana curve (nonlands, avg MV {avg_cmc:.2f}):")
    peak = max(curve.values()) if curve else 1
    for cmc in range(0, 8):
        n = curve.get(cmc, 0)
        label = "7+" if cmc == 7 else str(cmc)
        bar = "#" * round(n / peak * 24)
        print(f"  MV {label:>2} : {n:>3}  {bar}")

    # ---- Color pip demand vs. sources ----
    pip_totals = {c: 0 for c in COLOR_ORDER}
    for c in nonlands:
        for color, n in color_pips(c["mana_cost"]).items():
            pip_totals[color] += n * c["count"]
    source_totals = {c: 0 for c in COLOR_ORDER}
    for c in matched:  # lands + rocks/dorks both count as sources
        for color in produced_colors(c["produced_mana"]) & deck_identity:
            source_totals[color] += c["count"]

    active = [c for c in COLOR_ORDER if pip_totals[c] or source_totals[c]]
    print("\nColor demand vs. sources:")
    print("  color   pips  sources")
    for c in active:
        print(f"  {COLOR_NAMES[c]:<7} {pip_totals[c]:>4}   {source_totals[c]:>4}")

    # ---- Karsten source gaps (per-card, on curve) ----
    gaps = []
    for c in nonlands:
        pips = color_pips(c["mana_cost"])
        turn = max(1, min(int(c["cmc"] or 1), 6))
        for color, need_pips in pips.items():
            if need_pips <= 0:
                continue
            required = mm.sources_needed(need_pips, turn, total or 99)
            have = source_totals[color]
            if have < required:
                gaps.append((have - required, c["name"], color, need_pips, turn, have, required))
    if gaps:
        gaps.sort()
        print("\nUnder-supported colors (Karsten, on curve) — biggest gaps first:")
        for deficit, name, color, p, turn, have, req in gaps[:12]:
            print(f"  {name}: needs {req} {COLOR_NAMES[color]} sources by turn {turn} "
                  f"({p} pip), deck has {have}  [short {req-have}]")
        if len(gaps) > 12:
            print(f"  ... and {len(gaps)-12} more")
    else:
        print("\nColor sources: every card meets its Karsten on-curve target. ✓")

    # ---- Land count recommendation ----
    cheap = sum(c["count"] for c in nonlands if is_ramp(c) or is_cheap_draw(c))
    ramp_override = args.ramp if args.ramp is not None else cheap
    rec = karsten_land_count(avg_cmc, ramp_override)
    src = "provided" if args.ramp is not None else "heuristic"
    print(f"\nLand-count recommendation (Karsten formula):")
    print(f"  avg nonland MV {avg_cmc:.2f}, cheap ramp+draw {ramp_override} ({src})")
    print(f"  recommended lands: {rec:.1f}  (you have {land_ct})")
    delta = land_ct - rec
    if abs(delta) >= 1.5:
        direction = "more lands" if delta < 0 else "fewer lands / more spells"
        print(f"  -> consider ~{abs(round(delta))} {direction}.")
    else:
        print("  -> land count is in a healthy range. ✓")


# --------------------------------------------------------------------------
# Argument parsing
# --------------------------------------------------------------------------

def build_parser():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    pp = sub.add_parser("prob", help="general hypergeometric query")
    pp.add_argument("--deck", type=int, default=99)
    pp.add_argument("--successes", type=int, required=True, help="favorable cards in deck")
    pp.add_argument("--draws", type=int, default=7, help="cards seen (default opening 7)")
    pp.add_argument("--exactly", type=int)
    pp.add_argument("--at-least", type=int, dest="at_least")
    pp.add_argument("--at-most", type=int, dest="at_most")
    pp.set_defaults(func=cmd_prob)

    ps = sub.add_parser("sources", help="Karsten colored-source recommender")
    ps.add_argument("--deck", type=int, default=99)
    ps.add_argument("--pips", type=int)
    ps.add_argument("--turn", type=int)
    ps.add_argument("--threshold", type=float, default=0.90)
    ps.set_defaults(func=cmd_sources)

    pl = sub.add_parser("lands", help="land-probability summary")
    pl.add_argument("--deck", type=int, default=99)
    pl.add_argument("--lands", type=int, default=37)
    pl.set_defaults(func=cmd_lands)

    pa = sub.add_parser("analyze", help="analyze a decklist file")
    pa.add_argument("decklist", type=Path)
    pa.add_argument("--commander", help="commander name to exclude from counts")
    pa.add_argument("--ramp", type=int, help="override cheap ramp+draw count for land formula")
    pa.set_defaults(func=cmd_analyze)

    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
