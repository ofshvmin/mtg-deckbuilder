# Deployment Handoff — MTG Deck Builder

Written 2026-07-09 to continue the deployment on a fresh Claude session. This
picks up mid-deploy. **Read this, then read the memory files** at
`~/.claude/projects/-Users-danko-Claude-Projects-MTG-Deck-Builder/memory/`
(`MEMORY.md` is the index) for full project history — a Claude Code session on
this machine loads them automatically.

Address the user as **Danko** (per `~/.claude/CLAUDE.md`). No AI attribution in
commits/PRs.

---

## TL;DR of where we are

- **Backend: DONE and LIVE.** FastAPI on **Fly.io** at
  **https://mtg-deckbuilder-api.fly.dev**, connected to Atlas
  (`/health` → `db_connected: true`). Verified end-to-end in prod (register /
  login / me all work).
- **Frontend: NOT deployed yet.** This is the **one remaining step**. Danko was
  about to import the GitHub repo into **Vercel** (Git integration, so future
  pushes auto-deploy). He chose the dashboard-import path (not the MCP file
  deploy) specifically to get auto-deploy.
- **Database:** MongoDB Atlas, live and populated (38,233 cards, 96,161 combos,
  per-commander EDHREC cache). Network Access = `0.0.0.0/0`.
- **Git:** all pushed to `github.com/ofshvmin/mtg-deckbuilder`, branch `main`,
  latest commit `d908ef8`, clean working tree, upstream tracking set.

---

## THE NEXT STEP: finish the Vercel frontend deploy

Danko does this in the Vercel dashboard (team **"Daniel's projects"**):

1. vercel.com → **Add New → Project** → import **`ofshvmin/mtg-deckbuilder`**.
2. **Root Directory = `clients`** ← the one critical setting. Build/output come
   from `clients/vercel.json`; don't override them. Framework Preset may show
   "Other" — fine.
3. Add env var **`VITE_API_BASE_URL` = `https://mtg-deckbuilder-api.fly.dev`**
   (all environments). Must exist **before** the build — it's inlined at build time.
4. Click **Deploy**.

**CORS is already handled:** the backend has `CORS_ORIGIN_REGEX=https://.*\.vercel\.app`,
so any `*.vercel.app` origin works with no backend change.

### Monitoring the build
A **Vercel MCP** was connected on the previous account (team id
`team_Bq83W1SW8Ca7ZfbQCNTUW24X`). If this session also has Vercel MCP tools,
use them to watch the build: `list_projects` → find the new project →
`list_deployments` / `get_deployment` / `get_deployment_build_logs` /
`get_runtime_errors`. If not, Danko monitors in the dashboard and reports errors.

### Verify once it's green
Open the Vercel URL → **register** → **import** `app/data/collection.csv` →
pick a commander (e.g. "Korvold, Fae-Cursed King") → **Build 99-card deck**.
Expect a legal 99-card deck with ◆ synergy markers, a "Combos in this deck"
section, and "One card away" suggestions. (You can also drive it headlessly —
see the `browser-visual-verification` memory; point it at the Vercel URL and set
localStorage tokens, or just register through the UI.)

---

## Key facts / credentials / commands

**Fly (backend)**
- App: `mtg-deckbuilder-api` · org `personal` · region `iad` · URL `https://mtg-deckbuilder-api.fly.dev`
- Config: `backend/fly.toml` (Docker build, internal_port 8000, `/livez` health check,
  `auto_stop_machines=stop`, `min_machines_running=0` → ~10s cold start after idle;
  set to 1 to keep warm).
- Secrets already set (via `fly secrets set`): `MONGODB_URI`, `MONGODB_DB=mtg_deckbuilder`,
  `JWT_SECRET`, `CORS_ORIGIN_REGEX=https://.*\.vercel\.app`.
- Redeploy backend: `cd backend && fly deploy --ha=false`.
- Logs: `fly logs` · status: `fly status`.

**Atlas (database)**
- Cluster `mtg-cluster`, DB `mtg_deckbuilder`, user `app_user`, MongoDB 8.0.
- Network Access includes `0.0.0.0/0` (needed for Fly's dynamic egress IPs).

**Vercel (frontend)**
- Team "Daniel's projects" (`team_Bq83W1SW8Ca7ZfbQCNTUW24X`). No `mtg-deckbuilder`
  project yet (check `list_projects` — Danko may have created it after this was written).
- Config: `clients/vercel.json` (buildCommand `npm run build -w @mtg/web`,
  outputDirectory `apps/web/dist`, SPA rewrites). Root Directory must be set to
  `clients` in project settings.

**Local dev**
- Backend: `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload` (:8000).
  Local secrets in `backend/.env` (gitignored). Tests: `./.venv/bin/pytest`.
- Frontend: `cd clients && npm run dev` (:5173).

---

## Gotchas already hit and fixed (don't re-debug these)

- **Fly `fly deploy` sometimes errors** `net/http: request canceled` while waiting
  on health checks — the deploy usually still APPLIED. Verify with `fly status`
  and `curl https://mtg-deckbuilder-api.fly.dev/livez` rather than trusting the
  CLI exit.
- **Atlas `TLSV1_ALERT_INTERNAL_ERROR`** during SSL handshake = the connecting IP
  is NOT in Atlas Network Access (fixed with `0.0.0.0/0`). Not an auth error.
- Backend startup no longer crashes if Mongo is unreachable (commit `3291a3c`),
  and the Fly health check uses dependency-free `/livez` not `/health` (`d908ef8`).
- macOS python.org SSL: fixed earlier via `Install Certificates.command`.

---

## Open follow-ups (not blocking the deploy)

- **Rotate the Atlas password** if not already done — it was pasted in an earlier
  chat. (Danko set the Fly `MONGODB_URI` secret during deploy; confirm whether it
  used a freshly-rotated password, and update both Fly secret + `backend/.env` if
  he rotates it now.)
- Optional hardening: scope `app_user` to least privilege (`readWrite` on
  `mtg_deckbuilder` only) since Network Access is open.
- Optional: `min_machines_running = 1` in `backend/fly.toml` to remove cold starts.
- Orphan `seed-user` collection (~5,622 docs) still in Atlas from Phase B
  verification — harmless, can be deleted.
- Data freshness: re-run `backend/scripts/sync_scryfall.py` and
  `sync_spellbook.py` periodically (weekly-ish).

---

## After deployment: resume feature work

All 4 foundation phases (A–D) + engine Phases 1–4 (data, mana math, role tagger +
generator, EDHREC ranking, Commander Spellbook combos) are DONE and committed.

**Next feature work is engine Phase 5:** per-card explanations, manual deck
editing (swap/lock cards), and **deck persistence** (the `decks` collection and
its index exist but are unused — add save/list/get/delete). Then Phase 6:
playtest simulator, power-level/bracket estimation, budget upgrade suggestions
(the "one card away" combos already surface good candidates).

See `MTG_Deckbuilder_Plan.md` and the `project-status` memory for the full roadmap.
