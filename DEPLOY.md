# Deployment

- **Backend** (FastAPI) → **Fly.io** (Docker container, config in `backend/fly.toml`)
- **Frontend** (React SPA) → **Vercel** (Git integration, config in `clients/vercel.json`)
- **Database** → **MongoDB Atlas** (already live)

Order matters: deploy the backend first (to get its URL), then the frontend
(pointed at that URL), then open CORS on the backend for the frontend URL.

## 1. Backend → Fly.io

```bash
cd backend
fly auth login                       # interactive (browser)
fly launch --no-deploy --copy-config # creates the app from fly.toml; pick a unique name if taken
```

Set secrets (never baked into the image). Rotate the Atlas password first and
use the **new** connection string here:

```bash
fly secrets set \
  MONGODB_URI="mongodb+srv://app_user:NEW_PASSWORD@mtg-cluster.fkwuyqb.mongodb.net/" \
  MONGODB_DB="mtg_deckbuilder" \
  JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  CORS_ORIGIN_REGEX="https://.*\.vercel\.app"
fly deploy
```

Note the backend URL (e.g. `https://mtg-deckbuilder-api.fly.dev`) and confirm
`GET /health` returns `db_connected: true`.

## 2. Atlas network access

Fly egress IPs are dynamic → in Atlas, **Network Access → Add IP → `0.0.0.0/0`**
(safe here because access still requires the rotated DB credentials).

## 3. Frontend → Vercel

In the Vercel dashboard: **Add New → Project → import `ofshvmin/mtg-deckbuilder`**.
- **Root Directory:** `clients`
- Build/output come from `clients/vercel.json` (build `@mtg/web`, output `apps/web/dist`).
- **Environment variable:** `VITE_API_BASE_URL = https://<your-fly-app>.fly.dev`
  (must be set **before** the build — it's inlined at build time).

Deploy. Note the frontend URL (e.g. `https://mtg-deckbuilder.vercel.app`).

## 4. Verify

Open the Vercel URL → register → import `app/data/collection.csv` → pick a
commander → build a deck. The `CORS_ORIGIN_REGEX` above already allows every
`*.vercel.app` origin (production and preview deploys).

## Ongoing

- Keeping data fresh (run periodically): `fly ssh console` then
  `python scripts/sync_scryfall.py` and `python scripts/sync_spellbook.py`.
- Frontend redeploys automatically on `git push` (Vercel Git integration).
- Backend redeploys with `fly deploy` from `backend/`.
