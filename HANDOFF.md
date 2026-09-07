# Handoff — MTG Deck Builder

Updated 2026-08-29. Self-contained onboarding for a fresh clone — the project's machine-local
memory and per-feature design plans (kept under `~/.claude/`, not in git) have been folded into
this document.

---

## Current state

The app is named **Grimoire** (an MTG Commander deck builder). Everything is **deployed and working**:
- **Backend:** FastAPI on Fly.io at `https://mtg-deckbuilder-api.fly.dev`
- **Frontend:** React SPA on Vercel — canonical domain **`https://grimoire.dankodev.app`**
  (`mtg-deckbuilder-bice.vercel.app` still resolves; the custom domain is what the app, the
  password-reset links and the outbound User-Agent all point at)
- **Database:** MongoDB Atlas (`mtg_deckbuilder`) — 38.6K oracle cards, 113K per-printing images, 96K+ combos
- **Git:** `github.com/ofshvmin/mtg-deckbuilder`, branch `main`
- **Backend tests:** **455 passing** (`pytest` from `backend/` with the venv — no ignores needed)
- **Transactional email:** Resend, sending as `noreply@dankodev.com` (password resets only)

The app: import your card collection, pick a commander, and build a legal, mana-curved, synergy/
combo-tuned 99-card Commander deck in one of **four ways** — auto-build, build by hand, **lock &
regenerate**, or **describe it in natural language and let Claude pick the core** (AI deck brief).
Every deck gets an estimated WOTC power bracket (1–5), combo detection, budget-upgrade and combo-
finisher suggestions (respecting a per-user max-price cap), a goldfish playtest sim, and text/
stacks/grid card views. Browse the collection as an image-rich inventory; save/export decks.

> ⚠️ **New required secret:** the AI deck brief needs an **`CLAUDE_API`** env var (Anthropic API
> key). It's already set as a **Fly secret** (prod) and must be added to **`backend/.env`** for
> local dev — see *Local dev* below. Without it, the AI-brief feature returns a friendly 503 and
> everything else works.

---

## What's built (cumulative)

**Foundation + engine** (earlier phases): Scryfall oracle-card sync, multi-format collection
import, legal-pool filtering (color identity ⊆ commander), self-hosted JWT auth, role tagger,
greedy 99-card generator, EDHREC synergy ranking, Commander Spellbook combo detection, hypergeometric
mana math.

**Multi-format import + persistence** (PRs #1–#7): CSV/XLSX auto-detect (Moxfield, Archidekt,
Dragon Shield, Deckbox, ManaBox), diacritics-tolerant matching, deck save/list/get/delete/export,
collection management UI.

**Card-printing preservation** (PR #9): set / edition / collector-number / finish now survive
import → deck output → CSV export instead of being collapsed to `{oracle_id → count}`. Owned
printings are modeled as **inventory units** with a stable `printing_key` (`set|collector|finish`)
and a per-deck-card `selected_printing_key` — the seams for future value/images/allocation. See
**Data model** below.

**UI feature wave** (PR #10 + direct-to-main `f36004e`, `cb637c5`, `5ca3905`, `60e6cc3`):
- **Real routing:** three routes under a shared `Layout` — **Collection `/`**, **Build `/build`**,
  **Saved Decks `/decks`** (react-router NavLinks; shared summary + saved-deck count via
  `useOutletContext`). Replaced the old single `Dashboard`.
- **Collection browser:** one row per card (`GET /collection/cards`), click → `CardDetailModal`
  with a per-printing card image, ‹›/arrow-key/swipe navigation across owned printings, and a
  **set-led** detail (set logo + full name banner; Owned / Purchase price / Finish / Condition +
  oracle text).
- **Deck experience redesign:** commander art on saved-deck tiles + a deck-detail hero banner;
  two-column featured layout (deck list left, combos blocks right); build-explanation demoted to a
  footer.
- **Authentic mana symbols:** `mana-font` (self-hosted) renders real MTG glyphs for mana costs and
  color identity everywhere. Deck list is a height-balanced CSS-columns masonry.
- **Manual deck builder:** Build page Auto/Manual toggle. Manual mode = pool picker + a live
  working deck that recomputes categories + stats as you add/remove cards, via `POST /decks/compose`.

**Shipped 2026-07-10 → 07-13 (this wave — all live):**
- **Import fixes:** Dragon Shield quoted-`sep=`/delimiter handling; **Android "Failed to fetch"**
  (read the picked file to memory with `arrayBuffer()` before upload — Android's picker hands a
  lazy `content://` ref `fetch` can't read). Add-card printing picker.
- **Deck strategy & theme** (`/decks/strategies`, `strategy`+`theme` on generate; `services/
  strategies.py`, `themes.py`).
- **Deck editing in place + lock & regenerate:** `generator.generate(locked_ids=…)` seeds pinned
  cards and builds around them; `POST /decks/generate` takes `locked`. Manual editor can open/update
  an existing deck; DeckView has pin toggles + "Regenerate".
- **Budget upgrades** (`GET /decks/upgrades`) — EDHREC recs you don't own, priced client-side.
- **Combo finishers** (`POST /decks/combo-finishers`) — cards that complete a deck combo, owned-first.
- **Commander bracket estimation** (`services/brackets.py`, `app/data/game_changers.json`) — WOTC
  1–5 from Game Changers + 2-card infinite combos + mass land denial + extra turns + tutors.
- **Max-price preference + Settings page** (`preferences.max_card_price`, `PATCH /auth/preferences`)
  — caps unowned suggestions across upgrades, combo finishers, and "one card away" combos.
- **Playtest (goldfish) sim** (client-side), **Text/Stacks/Grid** card view toggle.
- **Rebrand to Grimoire:** new nav (logo → home, avatar dropdown), **Home dashboard** at `/`,
  Collection moved to `/collection`; "The Open Tome" inline-SVG logo + favicon.
- **Uniform card detail:** every `CardDetailModal` shows a market price + oracle text; unowned cards
  resolve the cheapest printing. **CommanderFeature** panel (full card + details + price) on Build
  and deck views.
- **AI DECK BRIEF** (`POST /decks/brief`, `services/ai_brief.py`) — natural-language request →
  Claude (Anthropic API via httpx, forced tool-use) picks **core cards from the owned pool** + build
  knobs → validated → `generate(locked_ids=core, strategy, theme, quotas, avoid_combos, land_count)`.
  Build page "✨ Describe" mode; `AiPlanPanel` shows Claude's rationale + core cards. Needs `CLAUDE_API`.
- **Theme matching robustness** (`themes.py`): now checks card names (word-boundary), full type
  lines, and handles multi-word themes by extracting distinctive keywords with stopword filtering.
  "Urza's lands" matches Urza's Tower/Mine/etc.
- **Manual builder suggestions**: "Get suggestions" button runs the auto-builder with current
  strategy/theme and highlights recommended cards in the pool picker. Strategy/theme controls shared
  between auto and manual modes.
- **Regenerate variety**: `jitter` parameter (0.8) adds random scoring bonus when locked cards are
  present, so unlocked slots get different picks each time.
- **Visual playtester** (full rewrite): full-screen board with Scryfall card images, card zones
  (battlefield, hand, graveyard, exile, library, command zone), click-to-select action popup
  (Play/Cast, Discard, Exile, Tap/Untap, Sacrifice, Return), drag-and-drop between zones,
  commander in command zone, library/graveyard/exile browsers with card movement, undo (Ctrl+Z,
  50-state history), shuffle button, Monte Carlo stats shown by default. No rule enforcement — user
  manages their own rules.
- **Scavenger list PDF** (rewrite): 3-column print-ready PDF. Rares flat alphabetical per set;
  Commons by set → color → alphabetical. Sets merged into supersets via `parent_set_code` + name-
  prefix heuristic. Rarity fetched by set+collector with card-name fallback. Color grouping from
  deck data as fallback. Page footers with deck name + page numbers.
- **Mobile responsive**: hamburger nav, compact toolbars, `overflow-x: hidden` on `<html>` (iOS
  Safari), `overscroll-behavior: none`, mana costs/printing chips hidden on mobile card rows, hover
  preview disabled on touch devices (`pointer: coarse`), zone browsers go full-screen on mobile.
- **Card image fix**: retry named URL with cache-bust param when initial and fallback URLs are
  identical (fixes "No image found" on unowned combo cards).
- **Per-printing image cache** (PR #41): `card_prints` MongoDB collection (~113K docs) seeded from
  Scryfall's `default_cards` bulk export. Stores per-printing CDN image URLs (UUID-based, not rate-
  limited). Backend enriches every printing in collection + deck API responses with DB-resolved CDN
  URLs (2 queries max regardless of collection size). Also backfills missing `collector_number` on
  printings that only have edition. Frontend `CardImage` source chain: DB CDN URL → constructed CDN
  → Scryfall API (last resort). Virtually eliminates runtime Scryfall API dependency for images.
- **Per-printing image fix** (PR #39): set-filtered Scryfall named lookup (`&set=xxx`) for printings
  with edition but no collector_number, so CardDetailModal shows correct art per set tab.
- **Self-service password reset** (PR #40): "Forgot password?" flow — user enters email → receives
  a time-limited JWT reset link via SMTP → sets new password. Backend: `/auth/forgot-password` +
  `/auth/reset-password` endpoints, `services/email.py` (configurable SMTP). Frontend:
  `ForgotPasswordPage` + `ResetPasswordPage`. Non-existent emails don't leak user existence.
- **Explore page** (`/explore`, PRs #32–#35): two-tab layout for browsing external decks:
  - **Precons tab** (default): ~190 official Commander preconstructed decks from MTGJSON, searchable
    by name or set code. Tiles show face commander art from Scryfall (enriched via background batch
    fetch of all MTGJSON deck files, cached in memory). Deck list index + commander names eagerly
    cached on first request.
  - **Community tab**: EDHREC user decklists by commander name. **Commander autocomplete** (debounced
    typeahead, all legendary creatures from cards DB, with color pips). Partial names auto-resolved
    (e.g. "Caesar" → "Caesar, Legion's Emperor"). Deck names built from card-type composition
    (Creature-heavy, Enchantress, Artifacts, Spellslinger, Superfriends, Balanced) + price for
    differentiation. Single-request search (uses hash table directly, no N+1 preview calls).
  - **URL import**: paste any **EDHREC URL** (precon, commander page, deckpreview, average-decks) or
    **Archidekt URL** to fetch and resolve. EDHREC pages fetched via `json.edhrec.com/pages/` with
    structured deck extraction; commander pages fall back to EDHREC search.
  - **Ownership display**: unowned cards shown dimmed/italic (text view) or greyscale (image views).
  - **Save to My Decks**: saves with `source`/`source_url` fields. Source badge on deck tiles.
  - **Import Cards to Collection**: batch-add deck cards with "ignore duplicates" or "import all" mode.
- **Decklist import** (`POST /explore/import`, `services/deck_text.py`): paste a decklist or upload
  a `.txt`/`.csv` export on the **Saved Decks** page. Parses Moxfield-style lines
  (`1x Alms Collector (c17) 1 *F* [Creature]`), plain `1 Sol Ring`, Arena/MTGO, `SB:` prefixes and
  section headers, plus deck CSVs through the existing `csv_formats` detection. `[Commander{top}]`
  becomes the commander; `{noDeck}` / maybeboard / sideboard rows are held out of the deck and
  reported, as are names that match no card. Resolves through the same pipeline as an Explore
  import, previews owned/unowned, then saves via `/decks/save` (so the free-tier cap still applies).
- **Deck delete** (web + iOS): confirm dialog on the Decks page / `Alert` on mobile, and it says
  what happens to the cards. Deleting an **in-use** deck returns its copies to the available pool
  for free — availability is derived per request from the in-use decks that still exist
  (`services/availability.py`), so there is no counter to decrement.
- **Collection filtering & sorting** (PR #64, web): the browser could filter on a substring of the
  card name and nothing else. Now filters on text (name + type line + rules text), set, colors,
  card type, rarity, mana value range, finish, availability, copies owned, and the **Reserved List**
  / **Game Changers** lists; sorts by name, mana value, copies, value, recently added, color, type,
  set or rarity — from a dropdown or a column header. All of it is pure functions in
  `lib/collectionFilter.ts` over cards the page already holds, so no filter costs a round trip.
  Three things to know:
  - **Colors have a match mode** — *Any of* / *Exactly* / *At most*. "At most" is the deck-building
    question (what is legal in these colors) and is why this isn't five toggles. Reads color
    identity by default; the card's own `colors` are selectable because the two disagree on
    exactly the cards people go looking for.
  - **Active filters render as removable chips** with a count. A table quietly missing three
    thousand cards is a bug report.
  - **The Free column appears whenever anything is reserved**, not only under "Available only" — a
    card claimed by more in-use decks than you own reads negative, and that row is precisely the one
    that filter excludes.
  Filter state lives in the query string (back button steps through narrowings; a filtered view is
  a link). The build screen's set picker was lifted into `SetPicker` and is now shared.
- **Compare Decks** (`/compare`, PR #32): select 2 saved decks on the Decks page → side-by-side
  stats (total, lands, avg MV, bracket), mana curves, shared cards grouped by slot, and cards
  unique to each deck. Selection mode with checkbox overlays + "Compare Selected" button.
- **Commander art fix** (PR #35): crossover sets (Final Fantasy, Marvel) reprint commanders with
  different art and a `flavor_name`. `CommanderFeature` now picks the newest non-reskinned printing
  via `originalPrint()` helper (skips prints with `flavorName`).
- **Commander type_line regex fix** (PR #35): `"Legendary Creature"` → `"Legendary.*Creature"` so
  Legendary Artifact Creatures (e.g. Kilo, Apogee Mind), Legendary Enchantment Creatures, etc.
  appear in commander search.

---

## Feature detail: Playtest (visual goldfish simulator)

A **Playtest** button on any deck view opens a **full-screen visual goldfish simulator** with actual
MTG card art from Scryfall. Entirely **client-side** — no backend, no API.

- **Files:** `clients/apps/web/src/lib/playtest.ts` (pure sim helpers) and
  `clients/apps/web/src/components/PlaytestModal.tsx` (the UI).
- **Library construction (`buildLibrary`):** expands `deck.cards` into a flat array (one per
  physical copy). Each `LibCard` carries `{ uid, oracle_id, name, mana_cost, cmc, type_line,
  isLand, isCreature, etbTapped }`. Commander is in the **command zone**, not the library.

**Zones:** battlefield (creatures top, lands bottom), hand (bottom bar, horizontal scroll),
graveyard pile, exile pile, library pile (face-down), command zone (commander card with amber
border). All zone piles are clickable → browse sidebar with movement actions.

**Interactions (no rule enforcement — user manages rules):**
- **Click any card** → large centered Scryfall preview + action buttons:
  - Hand: Play/Cast, Discard, Exile
  - Battlefield: Tap/Untap, Sacrifice, Exile, Return to hand
  - Commander: Cast commander
- **Drag-and-drop**: cards draggable between hand, battlefield, graveyard pile, exile pile
- **Library browser**: Hand, Play (to battlefield), Top, Bottom + Shuffle button
- **Graveyard browser**: Hand, Play, Exile
- **Exile browser**: Hand, Play
- **Keyboard**: D = end turn (untap all + draw), U = untap all, Ctrl+Z = undo, Esc = close

**Game mechanics:**
- Commander free mulligan (first mull keeps 7), London mulligan with visual bottom selection
- Mana pool: tapping a land → +1 floating mana, untapping → -1. Pool resets each turn.
- Summoning sickness: creatures enter upside down (rotate-180), clears on next untap step
- Tapped cards rotate 90 degrees
- ETB tapped lands detected via oracle text
- Undo: 50-state history stack (Ctrl+Z or button)
- Stats: Monte Carlo 1,000-hand analysis shown by default, toggleable

**Mobile:** hover zoom disabled on touch devices; zone browsers go full-screen; top bar compact.

**Caveats / by design:** a sandbox tool, not a rules engine — no colored-mana requirements, no
card effects, no turn structure enforcement. User is responsible for following rules.

---

## Feature detail: Scavenger list (print-ready PDF)

A **Pull list** button on any deck view downloads a **print-ready PDF** — a physical pull-guide +
checklist laid out to match how the collection is stored (**by set, then color**). Entirely
**client-side** (no backend).

- **Files:** `clients/apps/web/src/lib/scavenger.ts` (data + PDF), `clients/apps/web/src/lib/
  scryfallSets.ts` (`loadSetIndex()` — set names + release dates + `parentCode`), and the
  button/handler in `DeckView`. Uses **`jspdf`** (dynamically imported for code-splitting).
- **`buildScavengerData(deck, deckName)`** (async, plain data object): expands `deck.cards` by
  owned printings (basics excluded); batch-fetches Scryfall `/cards/collection` by **set+collector**
  for rarity/colors/type_line, with **card-name fallback** for cards missing collector numbers; uses
  `loadSetIndex()` for set names + release dates.
- **Superset merging**: sets grouped by parent via `parent_set_code` chain + **name-prefix
  heuristic** for orphan masterpiece/promo sets (e.g. "Marvel Universe" → "Marvel Super Heroes").
  Cards deduplicated within each superset.
- **Output structure** (PDF, 3-column flow, US Letter):
  - **Rares & Mythics**: set (newest-first) → flat alphabetical. No color subgroups.
  - **Commons & Uncommons**: set → color (White/Blue/Black/Red/Green/Multicolor/Colorless/Lands) →
    alphabetical. Each card: drawn checkbox + name + rarity tag (M/R/U/C).
  - **Multiples** section: cards owned across 2+ supersets, with all set names.
  - Set headers: full name + code. Page footers: deck name + page numbers.
- **Color grouping fallback**: when Scryfall lookup fails, uses deck card's `color_identity` +
  `type_line` so every card gets a proper color group (no "Other" bucket).
- **Layout engine**: inline cursor (col + cy) flows content across 3 columns. Section labels are
  column-width (not full-page). `pageContentTop` tracks header clearance on page 1.
- **Reuse note:** `scryfallSets.ts` cache key `mtg.sets.v3` (includes `parentCode`).

---

## Architecture

### Backend (`backend/`)
```
app/
  main.py              — FastAPI app, lifespan, CORS, router mounts; /livez + /health
  db.py                — AsyncMongoClient (PyMongo native async, NOT Motor), connect/ensure_indexes
  config.py            — Pydantic settings (env vars)
  auth/                — JWT auth (argon2 + PyJWT): register/login/refresh/me/forgot/reset, get_current_user
  models/responses.py  — Pydantic response schemas (incl. PrintingOut, CollectionCardOut)
  repositories/        — Data access:
    cards.py           — Scryfall reference cards; get_legal_pool (color-identity subset query)
    card_prints.py     — per-printing image lookup + enrich_printings (batch CDN URL resolution)
    collection.py      — owned_counts, owned_printings, list_collection_cards
    decks.py           — saved-deck CRUD
    users.py           — auth lookups + entitlements: is_premium / is_premium_exempt,
                         set_premium (webhook), set_premium_exempt (comped accounts)
  routers/             — collection, commanders, pool, decks, explore, webhooks
    decks.py           — /decks/generate (auto), /decks/compose (manual), saved-deck CRUD + export
    explore.py         — /explore/commanders (autocomplete), /explore/search (EDHREC),
                         /explore/precons + /explore/precon (MTGJSON), /explore/resolve (card
                         list resolution), /explore/deck (EDHREC + Archidekt URL import),
                         /explore/import (pasted/uploaded decklist)
  services/
    csv_formats.py     — format detection / normalization / parse / export
    importer.py        — collection import (CSV/Excel → Mongo); stamps printing_key + added_at
    deck_text.py       — decklist parsing (text lines + deck CSVs → card entries); commander,
                         maybeboard/sideboard and unreadable-line reporting
    availability.py    — owned vs. committed-to-an-in-use-deck arithmetic, per printing_key
    generator.py       — generate() greedy 99-card build; compose() analyze an exact card list
    external_decks.py  — EDHREC search/preview/page fetch, MTGJSON precon list/fetch (with
                         eager commander enrichment), Archidekt deck fetch, URL parsing
    card_prints.py     — download Scryfall default_cards bulk data, seed card_prints collection
    email.py           — SMTP email sending (password reset)
    edhrec.py, spellbook.py, pool.py, roles.py, mana_math.py
  util.py              — normalize_name, strip_diacritics, printing_key, normalize_finish
scripts/               — sync_scryfall.py, sync_card_prints.py, sync_spellbook.py, seed_collection.py,
                         premium_exempt.py (grant/revoke/list permanent Premium exemptions)
tests/                 — pytest (455): csv_formats, mana_math, roles, printings, compose,
                         external_decks, deck_text, availability, collection_browser, premium, …
```

Key endpoints: `POST /decks/generate` (auto), `POST /decks/compose` (manual — same
`GeneratedDeckResponse` shape, built from a fixed `oracle_ids` list), `GET /collection/cards`
(grouped-by-oracle browser data — oracle fields the browser filters on, plus `available` per
printing and `available_count` per card), `GET /explore/commanders` (all-commanders autocomplete),
`GET /explore/search` (EDHREC community decks), `GET /explore/precons` + `GET /explore/precon`
(MTGJSON precons), `GET /explore/deck` (EDHREC/Archidekt URL import), `POST /explore/resolve`
(resolve external card list against DB), `POST /explore/import` (pasted/uploaded decklist),
`POST /collection/batch-add` (bulk import cards), plus auth / collection / pool / saved-deck
CRUD + export.

### Frontend (`clients/` — npm workspaces)
```
packages/shared/src/
  types.ts   — API types (GeneratedDeck, CollectionCard, Printing, …)
  client.ts  — framework-agnostic ApiClient w/ token refresh (composeDeck, listCollectionCards, …)

apps/web/src/
  App.tsx                    — routes: /login, /register, /forgot-password, /reset-password, Layout → /, /build, /explore, /decks, /compare
  components/Layout.tsx      — header + NavLinks + Outlet context (summary, saved count)
  pages/
    CollectionPage.tsx       — import/export/add + CollectionFilters + CollectionGrid (landing);
                               owns filter/sort state, mirrored into the query string
    BuildPage.tsx            — commander → pool → Auto (DeckView) or Manual (ManualBuilder)
    ExplorePage.tsx          — Precons (MTGJSON) + Community (EDHREC) tabs, URL import
    DecksPage.tsx            — saved-deck tiles (commander art) → DeckView; Compare selection mode;
                               Import deck (ImportDeckModal) + delete behind a confirm
    ComparePage.tsx          — side-by-side deck stats, curves, shared/unique cards
  components/
    CollectionGrid.tsx       — one row per card; sortable headers, Value + Free columns,
                               RL/GC badges, paged "Show more"; row click → CardDetailModal
    CollectionFilters.tsx    — search / sets / colors + match mode / sort, with the rest behind
                               "More filters"; active filters as removable chips
    SetPicker.tsx            — multi-select over the sets you own (shared with PoolControls)
    CardDetailModal.tsx      — set banner + image + printing nav + detail panel
    ManualBuilder.tsx        — pool picker + live composed deck (seq-guarded)
    DeckCardList.tsx         — role-grouped masonry list (shared; optional per-row remove; ownership dimming)
    DeckView.tsx             — hero + stats + curve + DeckCardList + combos; showOwnership mode
    ImportCardsModal.tsx     — batch-add external deck cards to collection (ignore dupes / import all)
    ImportDeckModal.tsx      — paste/upload a decklist → resolve preview (owned, unowned, misses) → save
    CommanderArt.tsx, SetSymbol.tsx, CardImage.tsx
    ManaCost.tsx, ColorPips.tsx (mana-font glyphs), ManaCurve, StatTile, PrintingChips,
    CommanderPicker, PoolTable, AddCardSearch, Import/ExportCollection, CollectionList
  lib/
    api.ts             — singleton ApiClient (localStorage TokenStore)
    scryfall.ts        — per-printing card image URLs (Scryfall image API + name fallback)
    scryfallPrints.ts  — fetch all printings by oracle_id; originalPrint() (skip reskinned), cheapestPrint()
    scryfallSets.ts    — /sets fetch (memoized, localStorage 24h) → code→{name, iconSvgUri}
    edhrec.ts          — client-side EDHREC helpers (slug conversion, hash list fetch)
    format.ts          — formatManaCost, COLOR_PIP, formatColorIdentity
    collectionFilter.ts — collection browser filter predicates, sort comparators, card-type
                          parsing, value/availability helpers, filter↔query-string round-trip
```

### Database collections
- `cards` — Scryfall **oracle** cards (one doc per oracle_id; includes card-level `image_uris`).
  Indexed: name_normalized, color_identity, legal_commander, cmc. Also carries `reserved` (WOTC
  Reserved List — 571 cards, never reprinted) and `game_changer` (WOTC Commander Game Changers —
  53), both straight from the oracle bulk file; **added 2026-08-18, so they only exist after a
  `sync_scryfall.py` run.**
- `card_prints` — per-printing CDN image URLs (~113K docs, seeded from Scryfall `default_cards`
  bulk export). Each doc: scryfall_id, oracle_id, name_lower, set, collector_number, image_uris,
  image_uris_back. Indexed: (set, collector_number), (name_lower, set), oracle_id. Seed:
  `python scripts/sync_card_prints.py`.
- `users` — auth (email unique). Entitlements live here too: a `premium` sub-document written by
  the RevenueCat webhook (`active`, `expires_at`, `product_id`) and an independent
  `premium_exempt: true` flag for permanently comped accounts (see *Freemium* below).
- `collection_items` — one doc per owned printing line: oracle_id, name, count, edition,
  collector_number, foil, finish, condition, language, purchase_price, printing_key, added_at.
  Indexed: user_id + oracle_id.
- `decks` — saved decks (user_id + updated_at; optional `source` + `source_url` for imported decks).
- `combos` — Commander Spellbook (cards multikey, identity). `edhrec_cache` — per-commander, 7-day TTL.

---

## Data model: printings & the Scryfall client-side approach

- **Owned-now, catalog-later.** We only know about printings the user *owns* (from their import).
  The `cards` collection is Scryfall **oracle_cards** — one doc per unique card, with card-level
  `image_uris` (CDN URLs from the oracle bulk data).
- **Per-printing images are DB-first.** The `card_prints` collection (seeded from Scryfall's
  `default_cards` bulk export) stores CDN image URLs for ~113K printings. The API enriches every
  printing in collection + deck responses with these URLs (2 queries max). Frontend tries DB CDN
  URLs first, falls back to constructed CDN, then Scryfall API as last resort. Set metadata (name +
  logo) is still fetched client-side via Scryfall `/sets` (cached in localStorage).
- **`printing_key` = `set|collector|finish`** is the stable identity every future feature hangs off:
  a catalog FK, a price/image lookup key, and the target of deck→copy **allocation**. Deck cards
  carry `selected_printing_key` plus a `printing_allocation` (key → copies).
- **Inventory allocation is built** (the airline-fleet model): a saved deck flagged `in_use` is
  sleeved up, so its copies leave the pool later builds draw on. `services/availability.py` is the
  arithmetic — owned minus committed, per `printing_key`, allowed to go negative when two decks
  claim the same copy (`deck_shortfalls` then decides which deck shows it as unowned). It is
  **derived per request, never stored**, which is why releasing a deck — or deleting it — returns
  its copies for free. Build endpoints take `pool_scope=owned|available`.
- Still on the north star, all additive on this model with no schema rework: market value, a full
  printing catalog, and preferred-printing rules.

---

## Freemium, Premium & the paywall

The app is free to download with two Premium gates, **both enforced server-side** (the clients only
decide how to *present* the block, never whether it applies):

- **AI deck brief** (`POST /decks/brief`) — `require_premium` dependency; gated because each call
  spends real Anthropic credits.
- **Saved-deck cap** — free accounts may save **`FREE_SAVED_DECK_LIMIT` (default 9)** decks; the
  save endpoint returns 402 past that. Premium is unlimited.

Those two are the *only* things Premium may gate — our compute and our storage. **Scryfall data
(card search, images, prices) must never sit behind the paywall**; see *Third-party data* below for
why that is a licence term, not a product choice.

Both refusals are **HTTP 402**, which is the clients' cue to open the paywall rather than show an
error: web's `isPremiumRequired()` → `PremiumUpgradeProvider` modal, mobile's `router.push("/paywall")`.

**Entitlements** are computed by `repositories/users.is_premium(user)`, which is true when *any* of:

1. `premium_exempt: true` on the user document,
2. the user's email is in the `PREMIUM_EXEMPT_EMAILS` setting (comma-separated, case-insensitive),
3. the `premium` sub-document is active and unexpired (`expires_at: None` = lifetime unlock).

(1) and (2) are the **permanent exemptions** — purchase-free, never expiring, for test / App Review /
comped accounts. They're checked *ahead of* the entitlement and live outside the `premium`
sub-document, so a RevenueCat webhook sync can never clear them. Grant them with:

```bash
cd backend
python scripts/premium_exempt.py list
python scripts/premium_exempt.py grant someone@example.com [more@example.com …]
python scripts/premium_exempt.py revoke someone@example.com
```

The script writes straight to Atlas — no redeploy needed, and it takes effect on the next request.
`PREMIUM_EXEMPT_EMAILS` does the same without database access, at the cost of a `fly secrets set`
(which restarts the machine). **All 9 accounts that existed on 2026-08-03 were granted the flag**,
so every current account is Premium; accounts created after that are not — grant them explicitly.

**Purchases** happen only in the iOS app, via RevenueCat (entitlement `premium`, offering `default`,
products `com.grimoire.mtg.premium.{monthly,annual,lifetime}`). Mobile calls `Purchases.logIn(user.id)`
so RevenueCat's `app_user_id` equals our Mongo `_id`; the `POST /webhooks/revenuecat` webhook
(authenticated with `REVENUECAT_WEBHOOK_TOKEN`) then writes `user.premium`. `is_premium` is exposed
on `/auth/me`, so the web app — which **cannot sell Premium**, the RevenueCat SDK being mobile-only —
unlocks automatically for the same account and its modal just explains that upgrades happen in the
iOS app. On mobile, `isPremium` unlocks when **either** RevenueCat (authoritative right after a
purchase, before the webhook lands) **or** the backend flag (webhook-synced entitlements *and* exempt
accounts, which have no RevenueCat entitlement at all) says so.

---

## Architecture decisions & intents (the "why")

- **PyMongo native async (`AsyncMongoClient`, ≥4.9), NOT Motor** — Motor was deprecated 2025-05-14
  (EOL 2026-05-14). `db.py` uses PyMongo's async client directly.
- **Mongo holds everything**, including the ~38K Scryfall reference cards. Deliberately **no
  serverless-hostile global in-memory cache** — rely on indexed queries (e.g. the color-identity
  subset query `{color_identity: {$not: {$elemMatch: {$nin: allowed}}}}` in `repositories/cards.py`).
- **Tailwind only** — hand-built components, no chart library (mana curve / role bars are SVG/CSS).
- **The monorepo is built for an upcoming React Native app.** `packages/shared` (`@mtg/shared`) is
  intentionally **DOM/React-free** portable TS (types + a fetch `ApiClient` + an injectable
  `TokenStore`) so a future `apps/mobile` (Expo/RN) can reuse it unchanged: web plugs in a
  localStorage `TokenStore`; mobile would plug in `expo-secure-store`. Keep new shared code
  framework-free.
- **Auth is provider-agnostic.** JWT (access ~15 min + refresh ~14 day, HS256) sent as
  `Authorization: Bearer` (no cookies → identical flow on web + RN). Users carry an `identities`
  array (`local` = argon2 hash today); **Google / Apple / social login can be added later with no
  migration** (find-or-link by email, then issue our own JWTs).
- **Client-agnostic REST API** — the single contract for web, future mobile, and any other client.

## Third-party data, services & the obligations that come with them

Audited 2026-08-03. Every card name, image and mana symbol in the app is Wizards IP, sublicensed
only through the Fan Content Policy that Scryfall itself operates under. The rules below are not
style preferences — they are the terms the data arrives with.

| Provider | Used for | Terms |
|---|---|---|
| **Scryfall** | all card data, images, prices, set icons | https://scryfall.com/docs/terms · images: https://scryfall.com/docs/api/images |
| **EDHREC** | commander recs, synergy scores, deck search | https://edhrec.com/terms (endpoints are undocumented — no API terms exist) |
| **Commander Spellbook** | combo database | MIT; no dedicated ToS |
| **MTGJSON** | precon deck lists | https://mtgjson.com/license/ (MIT) |
| **Archidekt** | deck import by URL | https://archidekt.com/terms (undocumented open-beta API) |
| **Moxfield** | *parsing only — no traffic* | direct import disabled at `explore.py`; they restrict API access |
| **Anthropic** | AI deck brief (Premium-gated) | https://www.anthropic.com/legal/commercial-terms |
| **Wizards of the Coast** | the underlying IP | https://company.wizards.com/en/legal/fancontentpolicy |

**Standing constraints — read before touching card display or the paywall:**

- **An `art_crop` may only be shown where the illustrator is credited in the same interface.**
  This is why `card_prints` stores `artist`, why `card_prints.art_by_name()` refuses to return art
  without a credit, and why the deck banners render the name. If you add a new art_crop surface,
  it must carry the credit or show the gradient instead. Do not "temporarily" ship uncredited art.
- **Scryfall data must not be paywalled.** Premium may gate *our* compute and storage (AI brief,
  saved-deck count) but never card search, images or prices.
- **Do not crop, distort, desaturate or colour-shift card images**, or cover the copyright line.
- **Prefer `cards.scryfall.io` CDN URLs** (from `card_prints`) over `api.scryfall.com/...?format=image`,
  which is rate-limited and drops images in bulk grids.
- **A descriptive User-Agent is required** and is shared by every outbound call —
  `util.USER_AGENT`, currently `Grimoire/1.0.0 (https://grimoire.dankodev.app; app.support@dankodev.com)`.
  Keep the version in step with the mobile `app.json`.
- **The Fan Content notice must appear on the content itself**, not only the policy pages:
  `shared/src/legal.ts` → web `Layout` footer + mobile Home tab. Keep both rendering it.

---

## Maintenance & data freshness

- Re-sync reference data periodically (~weekly or when new sets drop):
  - `backend/scripts/sync_scryfall.py` — oracle cards (38.6K)
  - `backend/scripts/sync_card_prints.py` — per-printing images + prices + artist (113K, from
    `default_cards` bulk)
  - `backend/scripts/sync_spellbook.py` — combos (96K)
- These run **from your machine against prod Atlas**, not on the server — no request path triggers
  a sync, so a Fly deploy is never needed to refresh data.
- **Adding a field to `doc_from_card` is a two-part change**: the code alone does nothing until a
  re-sync rewrites the 38.6K docs. `reserved` and `game_changer` were added this way (PR #64,
  re-synced 2026-08-18). Anything reading a new field must tolerate its absence until then.
- Both Scryfall syncs write with batched upserts then prune, never delete-then-insert, so the
  collections stay readable throughout. Safe to run against a live app.
- **Scryfall bulk format (changed 2026-08):** the plain-JSON `download_uri` is gone, replaced by a
  gzipped-JSONL `jsonl_download_uri`. `scryfall.iter_bulk_cards()` streams and inflates it, yielding
  one card per line; callers transform while streaming (the decompressed `default_cards` file is
  ~1.5GB, which will not fit in the 512MB machine otherwise). Both syncs were silently broken with
  a `KeyError` until this was fixed — if a sync dies at the index lookup, suspect another schema move.
- zlib accepts a **truncated** gzip stream without raising, and the syncs prune anything absent from
  the payload, so a short download would delete real cards. `iter_bulk_cards` refuses any stream
  that did not reach the gzip trailer. Do not remove that check.
- `edhrec_cache` auto-refreshes per commander on a 7-day TTL.

---

## Deployment

### Backend (Fly.io) — MANUAL deploy
```bash
cd backend && flyctl deploy
```
- App `mtg-deckbuilder-api`, region `iad`, shared-cpu-1x / 512MB, `min_machines_running = 1`
  (always-on, so App Review and RevenueCat webhooks never hit a cold start). Fly auth =
  `superdanko@gmail.com`.
- Secrets: `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `CORS_ORIGINS`,
  `CORS_ORIGIN_REGEX=https://.*\.vercel\.app`, `CLAUDE_API`, `REVENUECAT_WEBHOOK_TOKEN`.
- Freemium settings, both optional (defaults in `config.py` are what prod runs on unless set):
  `FREE_SAVED_DECK_LIMIT` (default 9) and `PREMIUM_EXEMPT_EMAILS` (default empty). Per-account
  exemptions go through `scripts/premium_exempt.py` instead and need no deploy — see *Freemium*.
- Password-reset email (Resend SMTP): `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`,
  `SMTP_USER=resend` (literal), `SMTP_PASSWORD=<Resend API key>`,
  `SMTP_FROM='Grimoire <noreply@dankodev.com>'`, `FRONTEND_URL=https://grimoire.dankodev.app`
  (the reset link's base — a wrong value sends users to a dead link).
  The setting is `SMTP_FROM`, **not** `FROM_EMAIL`: `config.py` declares `smtp_from`, so
  pydantic-settings reads `SMTP_FROM` and silently ignores anything else. This file previously
  documented `FROM_EMAIL` and claimed the SMTP secrets were set — neither was true, and password
  resets sent nothing in prod for months without anyone noticing. See the note below on why that
  is invisible from the outside.
- Resend sends from `noreply@dankodev.com`; DKIM and the bounce/Return-Path records live on the
  `send.dankodev.com` subdomain (Route 53), which is what keeps the root `MX`/SPF free for
  Google Workspace. Never add a second root SPF record — a domain may only have one.
- Health: `/livez` (dependency-free), `/health` (DB check). Config: `backend/fly.toml`.
- Quirk: the CLI may print `net/http: request canceled` on the health-check wait but the deploy
  usually still applies — verify with `flyctl status` and `curl .../livez`.

### Frontend (Vercel) — AUTO-deploys on push to `main`
- Root directory `clients`; env `VITE_API_BASE_URL=https://mtg-deckbuilder-api.fly.dev`.
- Config: `clients/vercel.json`. Feature-branch pushes get harmless preview deploys.

### Workflow
- Recent flow has been either feature-branch → PR → squash-merge, **or** direct-to-`main` for small
  frontend-only changes (Danko chooses per change).
- **Frontend-only** changes need only the push (Vercel). **Backend** changes need a manual
  `flyctl deploy` after the push.
- ⚠️ **`flyctl deploy` ships your working directory, not `main`.** The Dockerfile does
  `COPY app ./app`, so uncommitted and untracked files go to production too. Check `git status`
  first. To deploy exactly what is merged while other work is in flight, deploy from a throwaway
  worktree rather than stashing:
  ```bash
  git worktree add /tmp/deploy-main main
  cd /tmp/deploy-main/backend && flyctl deploy
  git worktree remove /tmp/deploy-main
  ```
- Deploying a branch is fine and has been done (v45 shipped from `third-party-compliance` before it
  merged, v49 from `collection-filters-backend`) — just know prod is then ahead of `main` until the
  PR lands.
- **Order matters when a change spans both.** Vercel ships the instant the PR merges; Fly does not.
  Deploy the backend **first** — otherwise there is a window where the live web app calls an
  endpoint or reads a field production doesn't have yet. Either deploy from the branch pre-merge or
  merge and deploy Fly immediately.
- ⚠️ **A Fly deploy can change the behaviour of the already-shipped iOS app**, with no new build and
  no App Review. The binary on people's phones talks to whatever production serves. Adding fields to
  a response is safe — the client ignores what it doesn't know — but *populating a field it already
  reads* is a live change. PR #64 did exactly that: `/collection/cards` began setting `available`,
  and `mobile/src/components/CardDetailModal.tsx` branches on `p.available != null`, so its "Owned
  Printings" rows went from `×3` to `2/3 free` the moment v49 went out. Before any backend deploy,
  grep the mobile app for the fields you touched.

---

## Local dev

```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
uvicorn app.main:app --reload            # :8000  (needs backend/.env)
python -m pytest tests/ -q

# Frontend
cd clients && npm install && npm run dev  # :5173  (defaults API base to http://localhost:8000)
```
`backend/.env` (gitignored — set it up on each machine) must supply:
- `MONGODB_URI`, `MONGODB_DB` — the Atlas connection string + db name (`mtg_deckbuilder`).
- `JWT_SECRET` — any generated secret (must match whatever prod uses if you want prod tokens to work,
  but for local dev any value is fine).
- `CLAUDE_API` — **Anthropic API key** for the AI deck brief (from console.anthropic.com; separate
  from a claude.ai Pro subscription, billed as prepaid API credits). Optional — the AI-brief feature
  returns a 503 without it and everything else runs. Optional `CLAUDE_MODEL` (default `claude-sonnet-5`).

Prod keeps these as **Fly secrets** — check with `flyctl secrets list -a mtg-deckbuilder-api`
rather than trusting this list, since it can drift. On a new machine, copy the values from the
Atlas / Anthropic / Resend consoles into a fresh local `.env` (they aren't retrievable from Fly).

SMTP is optional locally: with `SMTP_HOST`/`SMTP_FROM` unset, password resets are disabled and
`/auth/forgot-password` still returns 200 — it must, so it cannot leak whether an account exists.
That means a broken mailer looks identical to a working one from the client. The startup log line
`SMTP not configured — password reset emails are DISABLED` is the only outward signal; if you are
debugging "the reset email never arrived", check for it first.

**Visual verification recipe** (used throughout): register a throwaway user via the API, import
`backend/../app/data/collection.csv` (the seed collection, real set codes + collector numbers),
run Playwright from a scratchpad dir, seed the JWT into `localStorage` via
`context.addInitScript` (keys `mtg.access` / `mtg.refresh`) **before** first navigation (a
token-less first load triggers the client's 401 handler which clears storage), screenshot, then
delete the throwaway user's `users` + `collection_items` + `decks` docs.

**macOS python.org gotcha:** if Scryfall/Atlas calls fail with `CERTIFICATE_VERIFY_FAILED`, run
`/Applications/Python 3.13/Install Certificates.command` once.

---

## Working preferences (Danko)

- **Always ask before `git push`** (or any outward/publishing/deploy action). Committing locally
  when asked is fine; an earlier "yes push it" does NOT authorize later pushes — confirm each time.
- **No AI attribution** anywhere that could become public: no `Co-authored-by` trailers, no mention
  of AI in commit messages / PR descriptions / release notes / docs, unless explicitly requested.

---

## Known issues / tech debt

- Backend redeploy is manual — no CI/CD for Fly yet.
- Collection grid renders a flat list capped at 400 rows; large collections want pagination/virtualization.
- `mana-font`'s shipped CSS references `woff` (not `woff2`) → ~408KB one-time cached font download.
- Per-printing images are now DB-first (via `card_prints`), but full-card images for cards not in the
  bulk data (very new printings, tokens) still fall back to the rate-limited Scryfall API. Commander
  art no longer does — it shows the gradient instead, since uncredited art is not permitted. Re-run
  `sync_card_prints.py` after new set releases.
- ~794 printings have an `art_crop` but no `artist` (World Championship bio cards, punchcards,
  Unknown Event promos). They render as the gradient. No real commander is affected.
- `openpyxl` handles `.xlsx` only (not legacy `.xls`); reads the active sheet only.
- The browser calls Scryfall directly in a few places (`lib/scryfallPrices.ts`, `scavenger.ts`,
  `scryfallPrints.ts`, `scryfallSets.ts`). Requests are chunked at the documented 75-identifier
  maximum and serialized, but there is no explicit inter-request delay; a `setTimeout` in the
  scavenger loop is the fix if Scryfall ever complains. Browsers cannot set a User-Agent, so those
  calls are unavoidably anonymous — the policy targets server-side/bulk traffic, which we do control.
- Mobile has **no forgot-password entry point** — the link exists only in the web `AuthForm`. An iOS
  user who forgets their password must use the web app or email support.
- Mobile: `overflow-x: hidden` must be on `<html>` element (iOS Safari ignores it on inner divs).
  Mana costs and printing chips are hidden on mobile card rows to save horizontal space.
- **Engine caveats (by design, revisit later):** the mana-source model is raw no-mulligan
  (conservative vs Karsten's London-mulligan tables); `generator._color_pips` double-counts pips on
  MDFC/split cards (mana_cost is stored as "front // back"); the ramp/draw counts feeding the land
  formula are heuristic; a few role-tagger edge cases are accepted (e.g. Cyclonic Rift reads as
  removal rather than a board wipe).

---

## iOS / mobile app (React Native + Expo) — merged to `main`

A native mobile app lives at **`clients/apps/mobile`** (an `@mtg/mobile` workspace member), now on
**`main`** and in App Store submission prep (RevenueCat purchases wired up — see *Freemium* above).
It reuses `@mtg/shared` (the `ApiClient` + types) unchanged against the live Fly
API — the backend needs **no changes** (JWT Bearer + REST work for native; CORS is browser-only).

**Stack:** Expo SDK 57 (managed) · React Native 0.86 · React 19.2 · **expo-router** (file-based routes)
· **NativeWind** (Tailwind-for-RN) · **expo-image** (cached Scryfall images) · **expo-secure-store**
(tokens). A `SecureTokenStore` implements `@mtg/shared`'s `TokenStore`; base URL is env-configurable
(`EXPO_PUBLIC_API_BASE_URL`, defaults to Fly). A `metro.config.js` resolves the workspace packages.

**Screens (MVP, all built):** auth (`login`/`register` + `AuthProvider`), a `(tabs)` group —
**Home** (stats + quick actions + recent decks), **Collection** (image `FlatList` grid + filter →
`CardDetailModal`, plus **collection import** — see below), **Build** (commander search → auto-build with strategy/theme **or** the AI
**Describe** brief **with conversational refinement** → save; the hero), **Decks** (commander-art
tiles + bracket → full-screen `DeckDetailModal`, role-grouped with combos; in-use toggle and
delete-behind-an-`Alert` per tile).

**Status.** Phases 0–2 complete (auth + read + build). Recent fixes on the branch:
- **Collection import on mobile** (`src/components/ImportCollectionModal.tsx`) — closes the app's
  biggest gap: the empty Collection tab used to just tell users to go to the web app, so a
  mobile-only user had no way to get started at all. Uses **expo-document-picker** (a native module,
  so it needs `npx expo run:ios`, not just Metro). Three things are easy to get wrong here:
  - **Upload the file as a Blob, never as RN's `{uri, name, type}` descriptor.** The usual RN advice
    (pass a uri descriptor to `FormData`) is *wrong on Expo SDK 57*, which replaces the global
    `fetch` with its WinterCG one (`expo/src/winter/fetch`). Its multipart encoder
    (`convertFormData.ts`) accepts only strings, `Blob`s, and objects exposing `bytes()`, and throws
    `Unsupported FormDataPart implementation` on a uri part. Mobile therefore passes an
    **`expo-file-system` `File`** (`new File(asset.uri)`) — it implements `Blob` and carries its own
    `name`/`type`, which is what the encoder reads for the part headers. `ApiClient.importCollection`
    keeps its plain `Blob` signature; Expo's patched `FormData.append` honours the 3-arg
    `(name, blob, filename)` form, so web and mobile share one code path.
  - **That failure mode lies to you.** The body is encoded *before* the request is attempted (the
    `normalizeBodyInitAsync` call sits outside `fetch.ts`'s try/catch), so an encoding bug throws a
    plain `Error`, never reaches the network, and — under the web component's "anything that isn't an
    `ApiError` is a network error" rule — got retried 4× and reported as *"Couldn't reach the
    server"*. It reads exactly like a Fly cold start. The mobile modal now only retries errors whose
    message starts with `"fetch failed:"` (Expo's `FetchError` prefix); anything else surfaces
    immediately. **If import ever looks like an outage, check the backend log first — zero
    `/collection/import` lines with healthy `/health` lines means the bug is client-side.**
  - **The picker filter is `*/*` on purpose.** iOS maps `type` to UTIs, and CSVs arriving via iCloud
    Drive, AirDrop or a mail attachment are routinely typed `public.data`. A strict MIME allowlist
    greys out the user's own file in the picker with no explanation, so the extension is checked in
    JS afterwards instead, where the rejection can say why. `copyToCacheDirectory: true` gives a
    stable `file://` — the RN analogue of the web component's `arrayBuffer()` workaround.
  - **Home refetches on focus now** (`useFocusEffect`). It used to load its stats once on mount, so
    a collection imported from the Collection tab left Home reading "0 cards" until an app restart.
  - **`expo-file-system` is pinned to an exact `57.0.0`, and must stay pinned.** `npx expo install
    expo-file-system` resolves to the newest release in `~57.0.0` (57.0.6 at the time), whose
    compiled framework references `ExpoModulesCore.BaseModule.willDestroy()`. That method does not
    exist in the `expo-modules-core@57.0.3` bundled with this project's `expo@57.0.4`, so dyld
    aborts **at launch** before any JS runs:
    `Termination Reason: DYLD 4 Symbol missing … Referenced from: ExpoFileSystem.framework`.
    Build 14 shipped to TestFlight this way and crashed on open. `npx expo install --check` does
    *not* flag it — it instead wants the whole SDK moved to 57.0.20 / RN 0.86.3, which is a separate
    piece of work. If you ever do that upgrade, the pin can be relaxed.
  - **A JS-only reload does not re-link native modules — and that is how the above shipped.**
    `npx expo install <native module>` changes `package.json`, but the existing `ios/Podfile.lock`
    keeps pointing at whatever was resolved before (here, the *nested* `expo/node_modules/
    expo-file-system` at 57.0.0, which happened to be compatible). The simulator therefore ran a
    binary that did not match the manifest and looked fine, while EAS did a clean prebuild and got
    the broken pairing. **After touching a native dependency, `rm -rf ios && npx expo run:ios
    --configuration Release` before trusting any result** — clean pods, and Release rather than
    Debug. Both are free; a cloud build is not.
  - **No `app.json` plugin entry, deliberately.** expo-document-picker's config plugin only injects
    iCloud entitlements when `ios.usesIcloudStorage` is set (`plugin/build/withDocumentPickerIOS.js`).
    Leaving it unset means **no new capability and no provisioning-profile change** — reading a
    user-picked iCloud Drive file works without the entitlement.

  The scale-to-zero wake-up + retry ladder from the web `ImportCollection` is carried over verbatim;
  it matters *more* on mobile, since picking a file is a long enough pause for the Fly machine to
  autostop. Import **replaces** the collection, so a populated one is confirmed behind an `Alert`.
- **AI-brief refinement** ported from web (transcript + "refine" input → rebuild via prior spec).
- **Home** shows the true saved-deck count and opens a tapped recent deck directly.
- **NativeWind was wired up** — it had been configured but never activated (no `babel.config.js`, Metro
  not wrapped with `withNativeWind`), so `className` was inert and **every screen rendered unstyled**.
  Now fixed (babel preset + `withNativeWind` + `darkMode: 'class'`); type-checking is clean.

**Verified** (no Xcode yet, so via Expo **web** preview + a local backend + Playwright, driving the
real UI with a seeded account): login, collection, auto-build (99 cards), save, the AI Describe brief
+ refine (real Claude), and the deck views all work end-to-end, correctly styled. The **iOS bundle
exports cleanly** (`npx expo export --platform ios`).

**To run it.** `cd clients/apps/mobile && npx expo start` (press `i` for the iOS Simulator — needs
**Xcode** installed, Danko's action). For web preview, install `react-native-web` + `react-dom` and
point `EXPO_PUBLIC_API_BASE_URL` at a local backend whose `CORS_ORIGINS` allows the Expo web origin
(native has no CORS). **TestFlight** needs an **Apple Developer account ($99/yr)** + `eas.json`/EAS
Build — not done yet.

**Caveats.** The workspace's npm install **nests deps rather than hoisting** (two `react-native`
copies; `expo`/`babel-preset-expo`/`react-native-css-interop` nested), which is why several config
files resolve packages by explicit path. A proper monorepo hoisting cleanup would remove that class of
papercuts. `expo-secure-store` is a no-op on web, so the web preview needs a temporary localStorage
token shim (not committed).

**Out of scope so far:** manual builder, lock & regenerate, the full playtest sim, Compare, Explore,
**decklist import** (web-only — the paste/upload UI is `ImportDeckModal`; the endpoint is client-
agnostic, so mobile only needs the screen), the pull-list PDF (expo-print, not jsPDF), push
notifications, offline caching, Android polish.

---

## Backlog

The **original 6-phase plan is complete**, plus several large waves since (see *What's built*).
This is the single backlog — there are no GitHub issues and no other TODO file. Roughly ordered
within each group; nothing here is committed to a date.

### Blocked on someone, not on code

- **`app.support@dankodev.com` does not exist.** It is the contact in the outbound `User-Agent`
  every third-party API sees, and appears nine times across `privacy.html`, `terms.html` and
  `support.html` — including the GDPR data-rights channel and the password-recovery fallback.
  Create it as a Google Workspace alias (free, no extra seat) on `daniel@dankodev.com`.
- **`appstore.review@dankodev.com` bounces** — a Grimoire account with no mailbox behind it,
  confirmed by a real send. If Apple's reviewers ever need a password reset they are stuck.
- **`terms.html` describes no subscription at all** — zero mentions of billing, auto-renewal,
  cancellation or refunds, while the app sells an auto-renewing subscription. Apple's standard EULA
  in the App Description satisfies review; the page still doesn't describe what the app does.

### Correctness & compliance gaps found by comparing the two clients (2026-08-29)

- **Web has no account deletion.** `deleteAccount` is wired on mobile only (`app/account.tsx`),
  because Apple requires it. Web users have no self-service path, and `privacy.html` promises data
  rights. The endpoint (`DELETE /auth/me`) already exists — this is a Settings page button.
- **Mobile has no password reset.** `forgotPassword` is web-only. A user who forgets their password
  on iOS has no in-app route back in. Backend endpoints already exist.
- **Mobile can't edit preferences.** `updatePreferences` is web-only, so the max-card-price cap that
  gates upgrade suggestions can only be set on the web.

### Feature parity: mobile trails web

Backed by an API-surface diff (`shared/src/client.ts` methods called by each app). Mobile is
Commander-only and read-mostly; the backend already supports everything below.

- **Standard and Legacy on mobile.** The backend serves three formats (`services/formats.py`:
  Commander 99, Standard 60, Legacy 60) and the web has a picker via `listFormats`. Mobile hardcodes
  Commander — commander search *is* the entry point to its Build tab, so this is a real screen
  restructure, not a dropdown: the non-Commander formats have no commander step and use
  colors + `deck_size`/`max_copies` instead.
- **Collection editing on mobile** — `importCollection` shipped (see below); still no `addCard`,
  `removeCard`, or `batchAddToCollection`, so cards can only be added a whole file at a time.
- **Mobile decklist import** — web has it (`ImportDeckModal` → `POST /explore/import`); mobile needs
  a paste screen against the same endpoint. Delete already shipped on both.
- **Mobile collection filtering** — web got the full filter/sort bar (PR #64); mobile still filters
  on card name alone. The predicates in `web/src/lib/collectionFilter.ts` are framework-agnostic and
  would move to `packages/shared` cleanly.
- **No Explore tab on mobile** — precons, EDHREC community decks and URL import are web-only
  (`fetchPrecon`, `searchPrecons`, `searchExternalDecks`, `fetchEdhrecDeck`, `fetchExternalDeck`).
- **No Compare, no manual builder, no upgrades/combo-finishers on mobile** — `composeDeck`,
  `getUpgrades`, `getComboFinishers` are all web-only. Playtest and the scavenger PDF are too.

### Android

The code is closer than the tooling. `app.json` already has `android.package = com.grimoire.mtg`
and a full adaptive-icon set, and `PremiumContext.tsx` already reads
`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`. What's missing:

- **Google Play developer account** ($25 one-time) and a Play Console app entry.
- **`eas.json` has no Android anywhere** — no `android` block in any build profile, and
  `submit.production` is iOS-only. Needs a Play service-account JSON for `eas submit`.
- **RevenueCat Android** — the key is read but never set (only `EXPO_PUBLIC_REVENUECAT_IOS_KEY` is
  in `eas.json`), and Play Billing products/entitlements need creating on the RevenueCat side.
  Until then the paywall shows no packages on Android, exactly as it does for local iOS builds.
- **Store listing**: feature graphic (1024×500), Android screenshot sizes, Data Safety form,
  content rating questionnaire. Privacy policy URL already exists.
- Budget cloud build quota for this — see the EAS discipline note in `CLAUDE.md`.

### SEO (web)

Worth knowing before estimating: **there is currently nothing for a crawler to index.** The app is
a client-rendered SPA behind `clients/vercel.json`'s catch-all rewrite to `index.html`, and every
route is auth-gated, so a crawler following any URL sees the login screen. `index.html` carries only
charset, viewport, favicon and a title — no description, no Open Graph or Twitter tags, so shared
links have no preview. There is no `robots.txt` and no `sitemap.xml`.

Meta tags are the easy half hour; they will not move rankings on their own. The real question is
whether to publish **crawlable content** — a marketing landing page at `/`, and possibly public
read-only pages (a deck a user chooses to share, or per-commander pages built from data already in
Mongo). That is a product decision about what Grimoire exposes publicly, and it should be made
before anyone tunes a meta description.

### Engineering health

- **No CI at all.** There is no `.github/workflows`. 455 backend tests exist and run only when
  someone remembers; a PR can merge red. A workflow running `pytest` plus both `tsc --noEmit`s is
  the highest-leverage item in this section.
- **No web test tooling.** Zero component tests — `clients/apps/web` has no test runner, so React
  behaviour is verified by hand each time. Vitest + Testing Library.
- **No error monitoring.** Backend exceptions live in Fly logs and nothing aggregates or alerts;
  a 500 in production is invisible unless a user reports it.
- **No analytics.** No signal about which features are used, so this backlog is ordered by
  intuition rather than evidence.
- **No rate limiting** on auth endpoints.
- **CI/CD for the Fly backend** — deploys are a manual `flyctl deploy` from a working directory,
  which is the deploy hazard documented under *Deployment*.

### Product / engine

- **AI deck brief — Phase 2:** conversational refinement ("lower the curve / cut the combos / more
  draw" adjusts the spec and rebuilds), unowned "acquire" suggestions from the brief (max-price
  capped), streaming the rationale, tool-use grounding (`search_owned_pool`), a *hard* combo-avoid.
- **Empty-collection onboarding** — a new account lands on an import screen with no sample data and
  no way to try the builder first.
- **Point brackets at the `game_changer` field** — `app/data/game_changers.json` is a hand-kept copy
  of the WOTC list and `services/brackets.py` still resolves it by name. The `cards` docs now carry
  `game_changer` from Scryfall directly. The two agree today (53 each), so this is cleanup, not a
  bug — but the JSON drifts on the next WOTC revision and the field doesn't.
- **Per-printing rarity** — the collection's rarity filter reads oracle-level `cards.rarity`, i.e.
  the rarity of whichever printing Scryfall picked as representative, so a card reprinted at another
  rarity reads as one value (Black Lotus comes back `bonus`). Exact per-printing rarity means adding
  `rarity` to `card_prints` and re-running that 113K-doc sync.
- **Collection scale** — the grid renders 400 rows at a time behind a "Show more", and filtering /
  sorting is client-side over the whole collection in memory. Fine to a few thousand unique cards;
  past ~10K it wants virtualization and probably server-side filtering.
- **Accessibility pass** on the web app — keyboard paths and contrast have never been audited.

---

## Repo docs & machine-local notes

- In-repo docs: `README.md`, `DEPLOY.md`, and `MTG_Deckbuilder_Plan.md` (the original design doc /
  6-piece engine plan). `docker-compose.yml` runs backend + frontend locally.
- `backend/.env.example` lists the env vars the backend needs — copy to `backend/.env` and fill in
  the Atlas URI + a generated `JWT_SECRET` (real values are not in git).
- **Machine-local artifacts are now captured here.** Per-feature **design plans** lived under
  `~/.claude/plans/` and are transient — each has been implemented and shipped; their forward-looking
  items are in the **Backlog** above. Project **memory** under `~/.claude/` (architecture
  decisions, the printing/inventory model + roadmap, the visual-verification recipe, the macOS SSL
  fix, deployment/workflow, engine caveats, and working preferences) has been folded into this
  document, so a fresh clone needs nothing from those files.
