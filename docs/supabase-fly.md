# Deploy Supabase to Fly.io (or Railway / VPS)

**Recommended:** Deploy the **same** self-hosted stack as local using **`docker/supabase/deploy/`**. It’s Dockerfile-based and vendor-agnostic: the same images work on Fly, Railway, or your own server.

---

## Deploy on Fly.io (Option B — same stack as local)

1. **flyctl** installed and logged in: `fly auth login`
2. From **`commandra/docker/supabase/`** follow **`deploy/DEPLOY-STEPS.txt`** (launch each app, create volume for db, set secrets, deploy).

**Deploy layout (`docker/supabase/deploy/`):**

| Path | Purpose |
|------|--------|
| **`deploy/docker/`** | Shared Dockerfiles (db, supavisor, meta, analytics, studio). Used by Fly and by Railway/VPS. |
| **`deploy/fly/`** | Fly-only: one `fly.toml` per app; Kong Dockerfile + config. Builds use the shared Dockerfiles. |
| **`deploy/set-secrets-from-env.sh`** | Syncs `docker/supabase/.env` to Fly secrets (same values as local). Run from `deploy/`: `./set-secrets-from-env.sh db`, … or `all`. |
| **`deploy/DEPLOY-STEPS.txt`** | Step-by-step Fly deploy. |
| **`deploy/railway/`** | Notes for the same stack on Railway. |

Secrets: run the script (from `docker/supabase/.env`) or set the same vars in the Fly UI after deploy.

---

## Alternative: Fly Supabase extension (Option A — different stack)

Fly’s managed **Supabase extension** (`fly extensions supabase create`) gives you a different stack than `docker/supabase`. Use only if you want a managed DB and accept dev/prod mismatch. See [Fly Supabase extension docs](https://fly.io/docs/flyctl/extensions-supabase/). After creation, enable `vector` and set `DATABASE_URL` in Commandra.

---

## Summary

| Goal | Use |
|------|-----|
| Same stack as local, portable (Fly → Railway → VPS) | **deploy/** + DEPLOY-STEPS.txt (Fly) or deploy/railway/ (Railway) or [supabase-production.md](supabase-production.md) (VPS). |
| Managed Fly-only shortcut | Fly extension (Option A); different from local. |
