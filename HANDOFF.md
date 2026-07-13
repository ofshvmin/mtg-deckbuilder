# Handoff — MTG Deck Builder

Updated 2026-07-12. Self-contained onboarding for a fresh clone — the project's machine-local
memory and per-feature design plans (kept under `~/.claude/`, not in git) have been folded into
this document.

---

## Current state

The app is named **Grimoire** (an MTG Commander deck builder). Everything is **deployed and working**:
- **Backend:** FastAPI on Fly.io at `https://mtg-deckbuilder-api.fly.dev`
- **Frontend:** React SPA on Vercel at `https://mtg-deckbuilder-bice.vercel.app`
- **Database:** MongoDB Atlas (`mtg_deckbuilder`) — 38K+ oracle cards, 96K+ combos
- **Git:** `github.com/ofshvmin/mtg-deckbuilder`, branch `main`, latest ~`b57e6ae`, clean
- **Backend tests:** **134 passing** (`pytest`)

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

**Shipped 2026-07-10 → 07-12 (this wave — all live):**
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

---

## Feature detail: Playtest (goldfish) simulator

A **🎴 Playtest** button on any deck view (built or saved) opens a goldfish simulator to feel a
deck's opening consistency. It is **entirely client-side** — no backend, no API — operating on the
deck's own card list.

- **Files:** `clients/apps/web/src/lib/playtest.ts` (pure sim helpers, no React) and
  `clients/apps/web/src/components/PlaytestModal.tsx` (the modal UI). Wired into `DeckView` via a
  `playtesting` state + the Playtest button.
- **Library construction (`buildLibrary(cards)`):** expands `deck.cards` into a flat array, one
  entry per physical copy (respecting `count`, so basics appear N times). The **commander is not in
  the library** (it lives in the command zone). A card is a land if `slot === "land"` or its
  `type_line` contains "Land". Each `LibCard` carries `{ uid, oracle_id, name, mana_cost, cmc,
  type_line, isLand }`.

**Interactive mode** (`PlaytestModal`, a `Game` state machine with phases `mulligan → bottoming →
play`):
- Shuffle the 99-card library (Fisher-Yates, `shuffle()`), draw an opening 7.
- **London mulligan:** "Mulligan (to N)" reshuffles everything and redraws 7, incrementing the
  mulligan count. On **Keep** after M mulligans you enter *bottoming*: click M cards to put on the
  bottom, then Confirm (they move to the end of the library). Zero mulligans → straight to play.
- **Turn stepping:** "Draw for turn" draws 1 and increments the turn; you may **play one land per
  turn** (click a land in hand → it moves to the battlefield). `landPlayedThisTurn` gates a second.
- **Mana model (simplification):** mana available = **number of lands in play**; card **colors are
  not simulated**. "Castable now" highlights nonland cards with `cmc ≤ lands` and shows a live count.
- "New game" reshuffles from scratch.

**Statistical mode (`sampleOpenerStats(cards, iterations = 1000)`):** a Monte-Carlo over the opening
7 (partial Fisher-Yates per iteration, counts lands in the drawn 7). Returns `OpenerStats {
iterations, avgLands, keepablePct (2–5 lands), screwPct (0–1), floodPct (6–7), landDist[0..7] }`,
rendered as headline numbers + a land-count histogram. The "Sample 1,000 opening hands" button runs
it on demand.

**Caveats / by design:** it's a *feel/consistency* tool, not a rules engine — no colored-mana
requirements, no card effects, no interaction. The rigorous complement is the hypergeometric
opening-hand math already shown in the deck stats (`p_2plus_lands_opening`, etc., from the Phase-2
`mana_math` engine). Colored-mana-aware simulation would be a future enhancement.

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
  routers/             — collection, commanders, pool, decks
    decks.py           — /decks/generate (auto), /decks/compose (manual), saved-deck CRUD + export
  services/
    csv_formats.py     — format detection / normalization / parse / export
    importer.py        — collection import (CSV/Excel → Mongo); stamps printing_key + added_at
    generator.py       — generate() greedy 99-card build; compose() analyze an exact card list
    edhrec.py, spellbook.py, pool.py, roles.py, mana_math.py
  util.py              — normalize_name, strip_diacritics, printing_key, normalize_finish
tests/                 — pytest (57): csv_formats, mana_math, roles, printings, compose
```

Key endpoints: `POST /decks/generate` (auto), `POST /decks/compose` (manual — same
`GeneratedDeckResponse` shape, built from a fixed `oracle_ids` list), `GET /collection/cards`
(grouped-by-oracle browser data), plus auth / collection / pool / saved-deck CRUD + export.

### Frontend (`clients/` — npm workspaces)
```
packages/shared/src/
  types.ts   — API types (GeneratedDeck, CollectionCard, Printing, …)
  client.ts  — framework-agnostic ApiClient w/ token refresh (composeDeck, listCollectionCards, …)

apps/web/src/
  App.tsx                    — routes: /login, /register, and Layout → /, /build, /decks
  components/Layout.tsx      — header + NavLinks + Outlet context (summary, saved count)
  pages/
    CollectionPage.tsx       — import/export/add + CollectionGrid (landing)
    BuildPage.tsx            — commander → pool → Auto (DeckView) or Manual (ManualBuilder)
    DecksPage.tsx            — saved-deck tiles (commander art) → DeckView
  components/
    CollectionGrid.tsx       — one row per card; row click → CardDetailModal
    CardDetailModal.tsx      — set banner + image + printing nav + detail panel
    ManualBuilder.tsx        — pool picker + live composed deck (seq-guarded)
    DeckCardList.tsx         — role-grouped masonry list (shared; optional per-row remove)
    DeckView.tsx             — hero + stats + curve + DeckCardList + combos
    CommanderArt.tsx, SetSymbol.tsx, CardImage.tsx
    ManaCost.tsx, ColorPips.tsx (mana-font glyphs), ManaCurve, StatTile, PrintingChips,
    CommanderPicker, PoolTable, AddCardSearch, Import/ExportCollection, CollectionList
  lib/
    api.ts             — singleton ApiClient (localStorage TokenStore)
    scryfall.ts        — per-printing card image URLs (Scryfall image API + name fallback)
    scryfallSets.ts    — /sets fetch (memoized, localStorage 24h) → code→{name, iconSvgUri}
    format.ts          — formatManaCost, COLOR_PIP, formatColorIdentity
```

### Database collections
- `cards` — Scryfall **oracle** cards (one doc per oracle_id; no per-printing data). Indexed:
  name_normalized, color_identity, legal_commander, cmc.
- `users` — auth (email unique).
- `collection_items` — one doc per owned printing line: oracle_id, name, count, edition,
  collector_number, foil, finish, condition, language, purchase_price, printing_key, added_at.
  Indexed: user_id + oracle_id.
- `decks` — saved decks (user_id + updated_at).
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
- Orphan `seed-user` collection in Atlas from early testing — harmless, deletable.
- Atlas password was pasted in chat long ago — worth rotating; confirm whether the Fly secret already
  uses a rotated value. Atlas Network Access is `0.0.0.0/0` (Atlas flags this; tighten later).
- **Engine caveats (by design, revisit later):** the mana-source model is raw no-mulligan
  (conservative vs Karsten's London-mulligan tables); `generator._color_pips` double-counts pips on
  MDFC/split cards (mana_cost is stored as "front // back"); the ramp/draw counts feeding the land
  formula are heuristic; a few role-tagger edge cases are accepted (e.g. Cyclonic Rift reads as
  removal rather than a board wipe).

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
