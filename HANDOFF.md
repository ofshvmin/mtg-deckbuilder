# Handoff — MTG Deck Builder

Updated 2026-07-14. Self-contained onboarding for a fresh clone — the project's machine-local
memory and per-feature design plans (kept under `~/.claude/`, not in git) have been folded into
this document.

---

## Current state

The app is named **Grimoire** (an MTG Commander deck builder). Everything is **deployed and working**:
- **Backend:** FastAPI on Fly.io at `https://mtg-deckbuilder-api.fly.dev`
- **Frontend:** React SPA on Vercel at `https://mtg-deckbuilder-bice.vercel.app`
- **Database:** MongoDB Atlas (`mtg_deckbuilder`) — 38K+ oracle cards, 96K+ combos
- **Git:** `github.com/ofshvmin/mtg-deckbuilder`, branch `main`
- **Backend tests:** **120+ passing** (`pytest`, excluding tests needing fastapi/pymongo in env)

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
  auth/                — JWT auth (argon2 + PyJWT): register/login/refresh/me, get_current_user
  models/responses.py  — Pydantic response schemas (incl. PrintingOut, CollectionCardOut)
  repositories/        — Data access:
    cards.py           — Scryfall reference cards; get_legal_pool (color-identity subset query)
    collection.py      — owned_counts, owned_printings, list_collection_cards
    decks.py           — saved-deck CRUD
    users.py
  routers/             — collection, commanders, pool, decks, explore
    decks.py           — /decks/generate (auto), /decks/compose (manual), saved-deck CRUD + export
    explore.py         — /explore/commanders (autocomplete), /explore/search (EDHREC),
                         /explore/precons + /explore/precon (MTGJSON), /explore/resolve (card
                         list resolution), /explore/deck (EDHREC + Archidekt URL import)
  services/
    csv_formats.py     — format detection / normalization / parse / export
    importer.py        — collection import (CSV/Excel → Mongo); stamps printing_key + added_at
    generator.py       — generate() greedy 99-card build; compose() analyze an exact card list
    external_decks.py  — EDHREC search/preview/page fetch, MTGJSON precon list/fetch (with
                         eager commander enrichment), Archidekt deck fetch, URL parsing
    edhrec.py, spellbook.py, pool.py, roles.py, mana_math.py
  util.py              — normalize_name, strip_diacritics, printing_key, normalize_finish
tests/                 — pytest (120): csv_formats, mana_math, roles, printings, compose, external_decks
```

Key endpoints: `POST /decks/generate` (auto), `POST /decks/compose` (manual — same
`GeneratedDeckResponse` shape, built from a fixed `oracle_ids` list), `GET /collection/cards`
(grouped-by-oracle browser data), `GET /explore/commanders` (all-commanders autocomplete),
`GET /explore/search` (EDHREC community decks), `GET /explore/precons` + `GET /explore/precon`
(MTGJSON precons), `GET /explore/deck` (EDHREC/Archidekt URL import), `POST /explore/resolve`
(resolve external card list against DB), `POST /collection/batch-add` (bulk import cards),
plus auth / collection / pool / saved-deck CRUD + export.

### Frontend (`clients/` — npm workspaces)
```
packages/shared/src/
  types.ts   — API types (GeneratedDeck, CollectionCard, Printing, …)
  client.ts  — framework-agnostic ApiClient w/ token refresh (composeDeck, listCollectionCards, …)

apps/web/src/
  App.tsx                    — routes: /login, /register, Layout → /, /build, /explore, /decks, /compare
  components/Layout.tsx      — header + NavLinks + Outlet context (summary, saved count)
  pages/
    CollectionPage.tsx       — import/export/add + CollectionGrid (landing)
    BuildPage.tsx            — commander → pool → Auto (DeckView) or Manual (ManualBuilder)
    ExplorePage.tsx          — Precons (MTGJSON) + Community (EDHREC) tabs, URL import
    DecksPage.tsx            — saved-deck tiles (commander art) → DeckView; Compare selection mode
    ComparePage.tsx          — side-by-side deck stats, curves, shared/unique cards
  components/
    CollectionGrid.tsx       — one row per card; row click → CardDetailModal
    CardDetailModal.tsx      — set banner + image + printing nav + detail panel
    ManualBuilder.tsx        — pool picker + live composed deck (seq-guarded)
    DeckCardList.tsx         — role-grouped masonry list (shared; optional per-row remove; ownership dimming)
    DeckView.tsx             — hero + stats + curve + DeckCardList + combos; showOwnership mode
    ImportCardsModal.tsx     — batch-add external deck cards to collection (ignore dupes / import all)
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
```

### Database collections
- `cards` — Scryfall **oracle** cards (one doc per oracle_id; no per-printing data). Indexed:
  name_normalized, color_identity, legal_commander, cmc.
- `users` — auth (email unique).
- `collection_items` — one doc per owned printing line: oracle_id, name, count, edition,
  collector_number, foil, finish, condition, language, purchase_price, printing_key, added_at.
  Indexed: user_id + oracle_id.
- `decks` — saved decks (user_id + updated_at; optional `source` + `source_url` for imported decks).
- `combos` — Commander Spellbook (cards multikey, identity). `edhrec_cache` — per-commander, 7-day TTL.

---

## Data model: printings & the Scryfall client-side approach

- **Owned-now, catalog-later.** We only know about printings the user *owns* (from their import).
  The `cards` collection is Scryfall **oracle_cards** — it has no set list, prices, or images.
- **Card images + set metadata are fetched CLIENT-SIDE from Scryfall**, not stored: images via
  `cards/{set}/{collector}?format=image` (name fallback), set name+logo via `/sets` (cached in
  localStorage). This keeps the DB lean; a server-side printing catalog is a future upgrade.
- **`printing_key` = `set|collector|finish`** is the stable identity every future feature hangs off:
  a catalog FK, a price/image lookup key, and the target of deck→copy **allocation**. Deck cards
  carry `selected_printing_key`. Danko's north star includes **inventory allocation** (a physical
  copy can be "in use" in one deck and thus unavailable to another — the airline-fleet model),
  market value, images, and preferred-printing rules — all additive on this model, no schema rework.

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

## Maintenance & data freshness

- Re-sync reference data periodically (~weekly): `backend/scripts/sync_scryfall.py` (cards) and
  `backend/scripts/sync_spellbook.py` (combos). `edhrec_cache` auto-refreshes per commander on a
  7-day TTL.

---

## Deployment

### Backend (Fly.io) — MANUAL deploy
```bash
cd backend && flyctl deploy
```
- App `mtg-deckbuilder-api`, region `iad`, shared-cpu-1x / 512MB, auto-stop when idle (cold-start
  on request). Fly auth = `superdanko@gmail.com`.
- Secrets: `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `CORS_ORIGIN_REGEX=https://.*\.vercel\.app`.
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

These are already **Fly secrets** in prod (`flyctl secrets list`): `MONGODB_URI`, `MONGODB_DB`,
`JWT_SECRET`, `CORS_ORIGIN_REGEX`, `CLAUDE_API`. On a new machine, copy the values from Atlas /
Anthropic consoles into a fresh local `.env` (they aren't retrievable from Fly).

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
- Client-side Scryfall image/set lookups depend on real set codes + collector numbers in the import
  (name-based fallback otherwise); no offline/catalog fallback yet.
- `openpyxl` handles `.xlsx` only (not legacy `.xls`); reads the active sheet only.
- Some backend tests (`test_brackets`, `test_combo_finishers`, `test_upgrades`, `test_preferences`)
  require fastapi/pymongo installed — they fail with import errors in the base test env. Run with
  `--ignore` flags or install deps.
- Mobile: `overflow-x: hidden` must be on `<html>` element (iOS Safari ignores it on inner divs).
  Mana costs and printing chips are hidden on mobile card rows to save horizontal space.
- **Engine caveats (by design, revisit later):** the mana-source model is raw no-mulligan
  (conservative vs Karsten's London-mulligan tables); `generator._color_pips` double-counts pips on
  MDFC/split cards (mana_cost is stored as "front // back"); the ramp/draw counts feeding the land
  formula are heuristic; a few role-tagger edge cases are accepted (e.g. Cyclonic Rift reads as
  removal rather than a board wipe).

---

## iOS / mobile app (React Native + Expo) — on branch `feature/mobile-app`

A native mobile app lives at **`clients/apps/mobile`** (an `@mtg/mobile` workspace member), **not yet
merged to `main`**. It reuses `@mtg/shared` (the `ApiClient` + types) unchanged against the live Fly
API — the backend needs **no changes** (JWT Bearer + REST work for native; CORS is browser-only).

**Stack:** Expo SDK 57 (managed) · React Native 0.86 · React 19.2 · **expo-router** (file-based routes)
· **NativeWind** (Tailwind-for-RN) · **expo-image** (cached Scryfall images) · **expo-secure-store**
(tokens). A `SecureTokenStore` implements `@mtg/shared`'s `TokenStore`; base URL is env-configurable
(`EXPO_PUBLIC_API_BASE_URL`, defaults to Fly). A `metro.config.js` resolves the workspace packages.

**Screens (MVP, all built):** auth (`login`/`register` + `AuthProvider`), a `(tabs)` group —
**Home** (stats + quick actions + recent decks), **Collection** (image `FlatList` grid + filter →
`CardDetailModal`), **Build** (commander search → auto-build with strategy/theme **or** the AI
**Describe** brief **with conversational refinement** → save; the hero), **Decks** (commander-art
tiles + bracket → full-screen `DeckDetailModal`, role-grouped with combos).

**Status.** Phases 0–2 complete (auth + read + build). Recent fixes on the branch:
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
the pull-list PDF (expo-print, not jsPDF), push notifications, offline caching, Android polish.

---

## What to work on next

The **original 6-phase plan is complete**, plus a large second wave (see *Shipped 2026-07-10 →
07-12* above). Remaining, all optional:

- **AI deck brief — Phase 2:** conversational refinement ("lower the curve / cut the combos / more
  draw" adjusts the spec and rebuilds), unowned "acquire" suggestions from the brief (max-price
  capped), streaming the rationale, tool-use grounding (`search_owned_pool`), a *hard* combo-avoid.
- **Server-side printing catalog** — ingest Scryfall prices/images so market value, deck totals, and
  card images don't depend on per-client Scryfall calls.
- **Inventory allocation** — which physical copies are committed to which decks (the fleet model).
- **Collection performance** — pagination/virtualization (grid caps at 400 rows today).
- **CI/CD** for the Fly backend (deploys are manual `flyctl deploy`).
- **Game Changers list refresh** — `app/data/game_changers.json` is the official WOTC list (from
  Scryfall `is:gamechanger`); re-pull periodically when WOTC revises it (query + update the JSON).

---

## Repo docs & machine-local notes

- In-repo docs: `README.md`, `DEPLOY.md`, and `MTG_Deckbuilder_Plan.md` (the original design doc /
  6-piece engine plan). `docker-compose.yml` runs backend + frontend locally.
- `backend/.env.example` lists the env vars the backend needs — copy to `backend/.env` and fill in
  the Atlas URI + a generated `JWT_SECRET` (real values are not in git).
- **Machine-local artifacts are now captured here.** Per-feature **design plans** lived under
  `~/.claude/plans/` and are transient — each has been implemented and shipped; their forward-looking
  items are in **What to work on next** above. Project **memory** under `~/.claude/` (architecture
  decisions, the printing/inventory model + roadmap, the visual-verification recipe, the macOS SSL
  fix, deployment/workflow, engine caveats, and working preferences) has been folded into this
  document, so a fresh clone needs nothing from those files.
