# Handoff — MTG Deck Builder

Updated 2026-07-09 for session transfer to a new machine/account.

---

## Current state

Everything is **deployed and working**:
- **Backend:** FastAPI on Fly.io at `https://mtg-deckbuilder-api.fly.dev`
- **Frontend:** React SPA on Vercel at `https://mtg-deckbuilder-bice.vercel.app`
- **Database:** MongoDB Atlas (`mtg_deckbuilder`), 38K+ cards, 96K+ combos
- **Git:** `github.com/ofshvmin/mtg-deckbuilder`, branch `main`, latest `edf98e0`, clean

---

## What was built this session (PRs #1–#7)

### Multi-format CSV/Excel import (#1, #2, #3)
- Auto-detect CSV format from headers (Moxfield, Archidekt, Dragon Shield, Deckbox, ManaBox)
- Format dropdown fallback for manual override
- XLSX/XLS support via openpyxl; MIME type detection fallback
- Dragon Shield `sep=,` prefix stripping; foil normalization across formats
- Latin-1 fallback for non-UTF-8 CSVs
- Unicode: NFC normalization + ASCII-folded diacritics fallback matching (Lim-Dul vs Lim-Dul)

### Deck saving (#4)
- `POST /decks/save` — save a named deck (full payload stored in MongoDB)
- `GET /decks/saved` — list saved decks (metadata only)
- `GET /decks/saved/:id` — load full saved deck
- `DELETE /decks/saved/:id` — delete
- Frontend: name input + save button on DeckView, saved decks grid on dashboard

### Export, update, re-import (#5)
- `GET /collection/export?format=Moxfield` — download collection as CSV in any format
- `GET /decks/saved/:id/export?format=Moxfield` — export deck card list
- `PUT /decks/saved/:id` — update deck name/data
- Reverse column mapping (`export_rows_csv`) for format-specific headers
- Collapsible import/export section on dashboard (later replaced by buttons in #6)

### Collection management UI (#6)
- Full collection list displayed by default on dashboard
- Three separate action buttons: Import, Export, Add card (each toggles a panel)
- `GET /collection/items` — list all collection items sorted by name
- `POST /collection/items` — add a single card by name (matched to Scryfall)
- `DELETE /collection/items/:oracle_id` — remove a card
- `GET /collection/search-cards?q=...` — general card search
- New components: `CollectionList`, `AddCardSearch`, `ExportCollection`

### Nav links (#7)
- Collection and Saved Decks links in the header navbar
- Collection clears deck/pool view; Saved Decks also refreshes the list
- Badge shows saved deck count

---

## Architecture

### Backend (`backend/`)
```
app/
  main.py              — FastAPI app, lifespan, CORS, router mounts
  db.py                — AsyncMongoClient, connect/disconnect, ensure_indexes
  config.py            — Pydantic settings (env vars)
  auth/                — JWT auth (register/login/refresh/me)
  models/responses.py  — All Pydantic response schemas
  repositories/        — Data access (cards, collection, decks, users)
  routers/             — API endpoints (collection, commanders, decks, pool)
  services/            — Business logic:
    csv_formats.py     — Format detection, normalization, parsing, export
    importer.py        — Collection import (CSV/Excel → MongoDB)
    generator.py       — 99-card deck generation (role quotas + mana curve)
    edhrec.py          — EDHREC synergy scores
    spellbook.py       — Commander Spellbook combo detection
    pool.py            — Legal pool builder
    roles.py           — Card role classification
    mana_math.py       — Hypergeometric mana calculations
  util.py              — normalize_name, strip_diacritics
tests/                 — pytest (40 tests: csv_formats, mana_math, roles)
```

### Frontend (`clients/`)
```
packages/shared/src/
  types.ts             — All API types (GeneratedDeck, CollectionItem, etc.)
  client.ts            — Framework-agnostic ApiClient with token refresh

apps/web/src/
  App.tsx              — Router: /login, /register, / (protected)
  pages/Dashboard.tsx  — Main page (collection, commander, pool, deck, saved decks)
  components/
    CollectionList.tsx  — Scrollable card list with remove buttons
    AddCardSearch.tsx   — Debounced card search + add to collection
    ImportCollection.tsx— File upload with format picker
    ExportCollection.tsx— Format picker + CSV download
    DeckView.tsx        — Generated deck display, save/update, export
    CommanderPicker.tsx — Commander search typeahead
    PoolTable.tsx       — Pool card list
    ManaCurve.tsx       — Mana curve chart
    StatTile.tsx        — Stat display box
    ColorPips.tsx       — Color identity badges
  auth/                — AuthContext, login/register pages, ProtectedRoute
  lib/
    api.ts             — Singleton ApiClient wired to localStorage
    format.ts          — formatManaCost, COLOR_PIP, formatColorIdentity
```

### Database collections
- `cards` — Scryfall oracle cards (indexed: name_normalized, color_identity, legal_commander, cmc)
- `users` — Auth (indexed: email unique)
- `collection_items` — User's owned cards (indexed: user_id + oracle_id)
- `decks` — Saved decks (indexed: user_id + updated_at)
- `combos` — Commander Spellbook (indexed: cards multikey, identity)
- `edhrec_cache` — Cached EDHREC synergy data

---

## Deployment

### Backend (Fly.io) — manual deploy
```bash
cd backend && fly deploy
```
- App: `mtg-deckbuilder-api`, region `iad`, shared-cpu-1x, 512MB
- Secrets set: `MONGODB_URI`, `MONGODB_DB`, `JWT_SECRET`, `CORS_ORIGIN_REGEX`
- Health: `/livez` (no deps), `/health` (with DB check)
- Auto-stop when idle, cold-start on request

### Frontend (Vercel) — auto-deploys on push to main
- Root directory: `clients`
- Env var: `VITE_API_BASE_URL=https://mtg-deckbuilder-api.fly.dev`
- Preview deployments on feature branches (standard Vercel behavior, harmless)

### Workflow
- Feature branches → PR → squash merge to main
- Frontend auto-deploys via Vercel on merge
- Backend requires manual `fly deploy` after merge

---

## Local dev

```bash
# Backend
cd backend && uvicorn app.main:app --reload  # :8000
python -m pytest tests/ -v

# Frontend
cd clients && npm install && npm run dev     # :5173
```

Backend needs `backend/.env` with `MONGODB_URI`, `JWT_SECRET`, etc.
Frontend needs no env — defaults to `http://localhost:8000`.

---

## Known issues / tech debt

- **Backend redeploy is manual** — no CI/CD for Fly.io yet
- Root `package.json` and `package-lock.json` are artifacts (not project files, gitignored effectively)
- `openpyxl` only handles `.xlsx`, not legacy `.xls` (would need `xlrd`)
- Multi-tab Excel files: only reads the active sheet
- Collection list loads all items at once (fine for ~5K, may need pagination at scale)
- Orphan `seed-user` collection in Atlas from early testing — harmless, can be deleted

---

## What to work on next

Possible directions (user hasn't specified yet):
- **Deck editing** — swap/lock individual cards, re-generate around locked cards
- **Playtest simulator** — draw hands, mulligan
- **Power level / bracket estimation**
- **Budget upgrade suggestions** (the "one card away" combos already surface candidates)
- **Card images** — display Scryfall card images in collection/deck views
- **Pagination** for large collections
- **CI/CD** — GitHub Actions for tests + auto Fly deploy
