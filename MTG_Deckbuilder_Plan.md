# MTG Commander Deck Builder — Proposed Plan

## Goal

A local web app that takes your owned card collection plus a chosen commander and playstyle preferences, and outputs a legal, mana-curve-balanced 99-card decklist that maximizes card synergies and combo potential — with the reasoning shown, not just the list.

## What this needs, and where the data comes from

**Rules and card data — Scryfall.** Scryfall publishes a free bulk-data API with every card's oracle text, mana cost, color identity, type line, legality, and keywords, refreshed weekly. No API key is needed; it just requires a descriptive User-Agent header and staying under 10 requests/second. Since deck generation only needs the weekly bulk file (not live queries), this comfortably avoids rate-limit issues — pull the `oracle_cards` bulk file once a week into a local SQLite database and work from that. This also gives us a built-in Commander legality and banned-list check for free (Scryfall tags legality per format).

**Your collection.** Neither Moxfield nor Archidekt expose an official collection API, so the cleanest path is CSV import — Moxfield's collection CSV format (Count, Name, Edition, Foil, etc.) is a de facto standard several tools already read and write. I'd build the importer against that schema, plus a manual "search and add" screen for one-off entries or corrections. If you already keep your collection somewhere (Moxfield, a spreadsheet, a binder-tracking app), exporting to that CSV shape is the fastest path in; we can also add other formats later since the importer is just a column-mapping layer.

**Combos.** Commander Spellbook is an open-source (MIT-licensed), community-maintained database of 30,000+ known EDH combos with a public API (`find-my-combos`) that takes a decklist and returns which combos are present or nearly present. This is far more reliable than trying to detect combos from oracle text alone, and it's the same data source EDHREC and Archidekt lean on. I'd cache their combo dataset locally and refresh periodically.

**Popularity/synergy signal.** EDHREC exposes an unofficial but open JSON API (`json.edhrec.com`) with per-commander data: which cards are played with a given commander, inclusion rate, and a synergy/"lift" score (they're mid-transition from "synergy score" to a statistically cleaner "lift score" — same idea, corrects for cards like Sol Ring that are in everything regardless of synergy). This is useful as a *tiebreaker and suggestion signal* — it tells us what the wider playerbase found worked with a commander — but the actual scoring for your deck should prioritize combos and role-fit computed directly from your own collection, since EDHREC reflects the whole meta, not what you own.

## Core engine components

**1. Collection & legality layer** — owned cards joined against Scryfall data, filtered to the commander's color identity, singleton rule enforced, banned list applied.

**2. Card role tagger** — classify each card (yours + generally) into functional roles: ramp, card draw, targeted removal, board wipe, protection/interaction, tutor, win condition. Done via oracle-text pattern rules (e.g., "search your library for a" → tutor; "add {" → ramp) plus manual overrides for edge cases. This gives the deck-shape targets to build toward — Commander decks generally want something like ~35-38 lands, ~10 ramp, ~10 draw, ~8-10 interaction/removal, with the rest split between the game plan and win conditions; these are starting guidelines the tool should let you override per playstyle.

**3. Mana base calculator** — implements Frank Karsten's hypergeometric method: for each color pip requirement in your chosen cards, calculates how many colored sources you need to reliably (~90%) cast it by the turn you want it online, then recommends a land/rock count and color split. I confirmed the underlying math directly — e.g., a 99-card deck with 37 lands has an ~81% chance of 2+ lands in your opening 7 and ~53% chance of 3+; these numbers, not rules of thumb, drive the land count recommendation.

**4. Synergy & combo engine** — for cards you own within the commander's color identity: (a) flag every known Commander Spellbook combo fully or partially assembled in your pool, (b) build a lightweight interaction graph scoring pairs/triads that combo or strongly synergize (tutors that find your combo pieces, payoffs for a sub-theme like sacrifice or +1/+1 counters, etc.), (c) pull EDHREC's synergy/lift data as a secondary signal for cards you own that the wider meta rates highly with your commander.

**5. Probability engine** — general-purpose hypergeometric calculator so the deck output can state things like "62% chance to see a ramp piece by turn 2" or "X% chance to draw into a combo piece by turn 8," using your actual deck composition rather than generic advice.

**6. Recommendation engine** — given the commander, your filtered collection, and your stated playstyle (e.g. combo-focused vs. midrange value vs. casual synergy, and a target power level), scores every eligible owned card on role-fit + synergy/combo weight + curve fit, then fills the 99 slots to satisfy the role quotas and curve targets while maximizing total synergy score — and shows its reasoning per card (why it's in, what it combos with).

## Interface

Local web app: Python backend (FastAPI) serving the data/rules/synergy/mana engines, SQLite for storage, a simple React or server-rendered frontend for browsing your collection, picking a commander, setting preferences, and reviewing the generated deck with a mana curve chart, role breakdown, and flagged combos. Runs entirely on your machine.

## Phased build order

1. **Data foundation** — Scryfall bulk sync into SQLite, collection CSV importer, commander legality/color-identity filter. Deliverable: you can see your legal card pool for any commander.
2. **Mana math tools** — hypergeometric probability calculator + Karsten-based land/rock recommender, usable standalone against any decklist.
3. **Role tagging + basic deck generator** — rule-based tagger, fills role quotas from your owned cards ranked by EDHREC signal, no deep combo logic yet. Deliverable: first end-to-end generated decklist.
4. **Synergy/combo engine** — Commander Spellbook integration + interaction-graph scoring layered into the generator's ranking.
5. **UI polish + explanations** — proper deck review screen, per-card reasoning, manual swap/lock-in editing.
6. **Stretch** — playtest simulator (simulate draws across a game to sanity-check consistency), power-level/bracket estimation, budget/upgrade suggestions for cards you don't yet own.

## Decided

Collection input: CSV in Moxfield's layout (Count, Name, Edition, Foil, Condition, etc.), provided by you directly.
