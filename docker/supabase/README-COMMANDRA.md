# Supabase for Commandra (local and production)

Commandra uses this folder to run **self-hosted Supabase** (Postgres + Studio). Same stack for local and production.

## Quick start (local)

1. **Create and configure `.env`**
   ```bash
   cp .env.example .env
   cd docker/supabase && sh ./utils/generate-keys.sh --update-env
   ```
   Then edit `.env`: set **POOLER_TENANT_ID** (e.g. `commandra`) and **DASHBOARD_USERNAME** (e.g. `admin`). Optionally set **DISABLE_SIGNUP=true**, **ENABLE_EMAIL_SIGNUP=false**, **ENABLE_PHONE_SIGNUP=false** (Commandra does not use Supabase Auth).

2. **Start Supabase**
   ```bash
   cd docker/supabase && docker compose up -d
   ```
   **Optional (dev):** Add Inbucket (mail), DB seed, and direct Studio on 8082:
   ```bash
   cd docker/supabase && docker compose -f docker-compose.yml -f ./dev/docker-compose.dev.yml up -d
   ```

3. **Commandra repo root `.env`**  
   Set:
   ```env
   DATABASE_URL=postgresql://postgres.POOLER_TENANT_ID:POSTGRES_PASSWORD@localhost:5432/postgres
   ```
   (Use the same `POOLER_TENANT_ID` and `POSTGRES_PASSWORD` from `docker/supabase/.env`.)

4. **Migrations**
   ```bash
   pnpm db:migrate
   ```

5. **Studio**  
   Open http://localhost:8000 and log in with **DASHBOARD_USERNAME** / **DASHBOARD_PASSWORD**.

## Production (db.commandra.app)

- **VPS / your server:** [docs/supabase-production.md](../../docs/supabase-production.md) — self-host the full stack, HTTPS at db.commandra.app.
- **Railway:** [docs/supabase-railway.md](../../docs/supabase-railway.md) — deploy the self-hosted stack via **docker/supabase/deploy/** (Dockerfile-based; same secrets as `.env`; use `deploy/set-railway-variables-from-env.sh`). See **deploy/DEPLOY-STEPS.txt** for steps. For **two** stacks (prod **Commandra** + dev **Commandra Dev**), see **deploy/railway/SETUP-TWO-PROJECTS.md** (`railway init`, `ENV_FILE=../.env.dev`, etc.).
- **Env:** See [env.production.example](./env.production.example) for URL and auth-disabled overrides; generate secrets with `sh ./utils/generate-keys.sh --update-env`, then set production URLs and the variables in the example file.

## Auth

Commandra uses **its own auth** (JWT, API routes). Supabase Auth is not used. To avoid accidental sign-ups, set in `.env`:

- `DISABLE_SIGNUP=true`
- `ENABLE_EMAIL_SIGNUP=false`
- `ENABLE_PHONE_SIGNUP=false`

## More

- **Local detailed steps:** [docs/supabase-local.md](../../docs/supabase-local.md)
- **Official Supabase self-hosting:** https://supabase.com/docs/guides/self-hosting/docker
