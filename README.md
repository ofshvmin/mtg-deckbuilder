# MTG Commander Deck Builder

A full-stack app that takes your owned card collection + a chosen commander +
playstyle preferences and recommends a legal, mana-curve-balanced 99-card
Commander deck that maximizes synergies and combos — with its reasoning shown.

See `MTG_Deckbuilder_Plan.md` for the product plan and phased roadmap.

## Architecture

- **Backend** (`backend/`) — Python + FastAPI, async. Client-agnostic JSON REST API.
- **Database** — MongoDB Atlas (all data, incl. the ~38k Scryfall reference cards).
  Driver: PyMongo native async (`AsyncMongoClient`).
- **Clients** (`clients/`) — npm workspace monorepo:
  - `packages/shared` (`@mtg/shared`) — portable TS: API client, types, domain logic.
  - `apps/web` (`@mtg/web`) — React + Vite + TypeScript + Tailwind.
  - `apps/mobile` — React Native app (planned; reuses `@mtg/shared`).
- **Auth** — self-hosted JWT (Bearer tokens), provider-agnostic identities
  (social login can be added later without migration).

## Local development

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # then fill in MONGODB_URI + JWT_SECRET
uvicorn app.main:app --reload # http://localhost:8000  (/health, /docs)
pytest
```

### Web

```bash
cd clients
npm install
npm run dev                   # http://localhost:5173
```

The web app reads `VITE_API_BASE_URL` (defaults to `http://localhost:8000`).

## Status

Phase 1 (data foundation) and Phase 2 (mana math) are built and verified as
local scripts in `app/scripts/`. The full-stack re-platform is in progress —
see `MTG_Deckbuilder_Plan.md`.
