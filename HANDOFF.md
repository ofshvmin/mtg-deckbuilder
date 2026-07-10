# Handoff — MTG Deck Builder

Updated 2026-07-10. Self-contained onboarding for a fresh clone.

---

## Current state

Everything is **deployed and working**:
- **Backend:** FastAPI on Fly.io at `https://mtg-deckbuilder-api.fly.dev`
- **Frontend:** React SPA on Vercel at `https://mtg-deckbuilder-bice.vercel.app`
- **Database:** MongoDB Atlas (`mtg_deckbuilder`) — 38K+ oracle cards, 96K+ combos
- **Git:** `github.com/ofshvmin/mtg-deckbuilder`, branch `main`, latest `60e6cc3`, clean
- **Backend tests:** 57 passing (`pytest`)

The app: a Commander (EDH) deck builder over your card collection. Import your collection,
pick a commander, and either auto-generate a tuned 99-card deck (role quotas + mana curve, ranked
by EDHREC synergy, with Commander Spellbook combo detection) or build one by hand from your legal
pool. Browse your collection as an image-rich inventory, save/export decks.

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
`backend/.env` must supply `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET` (not in git). The Atlas
connection string + a generated JWT secret live only on the dev machine's `.env`.

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

---

## What to work on next

- **Deck editing in place** — swap/lock individual cards on an auto-built deck, regenerate around
  locked cards (manual *building* from scratch is already done via the Build page).
- **Server-side printing catalog** — ingest Scryfall printings (sets/prices/images) to unlock market
  value, richer images, acquisition suggestions.
- **Inventory allocation** — track which physical copies are committed to which decks (the fleet model).
- **Playtest simulator**, **power-level / bracket estimation**, **budget upgrade suggestions**.
- **Pagination/virtualization** for large collections; **CI/CD** (GitHub Actions → tests + Fly deploy).
