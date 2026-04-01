# Self-hosted Supabase on Railway

Deploy the same stack as local using **`docker/supabase/deploy/`** — Dockerfiles are platform-agnostic.

## Steps

1. **Railway CLI** (optional): `railway login`; link the **commandra** project from the [`commandra/`](../../) repo root for API/dashboard deploys.
2. From **`commandra/docker/supabase/`** follow **[deploy/railway/PROVISION.md](../../docker/supabase/deploy/railway/PROVISION.md)** for the Supabase services. For **two** Railway projects (**Commandra** + **Commandra Dev**), see **[deploy/railway/SETUP-TWO-PROJECTS.md](../../docker/supabase/deploy/railway/SETUP-TWO-PROJECTS.md)**.
3. Variables: [RAILWAY-SECRETS-CHECKLIST.md](../../docker/supabase/deploy/RAILWAY-SECRETS-CHECKLIST.md), [set-railway-variables-from-env.sh](../../docker/supabase/deploy/set-railway-variables-from-env.sh), and [sync-local-env-to-railway.py](../../scripts/sync-local-env-to-railway.py) (optional landing env).
4. Kong gateway image and config: [deploy/kong/](../../docker/supabase/deploy/kong/).
5. Quick reference: [deploy/DEPLOY-STEPS.txt](../../docker/supabase/deploy/DEPLOY-STEPS.txt).

## Layout (`docker/supabase/deploy/`)

| Path | Purpose |
|------|---------|
| **`deploy/docker/`** | Shared Dockerfiles (db, supavisor, meta, analytics, studio). |
| **`deploy/kong/`** | Kong Dockerfile + `kong.yml`. |
| **`deploy/railway/`** | `railway.toml` per Supabase service (includes conservative **memory caps** for cost control). |
| **`deploy/set-railway-variables-from-env.sh`** | Push `docker/supabase/.env` (or `ENV_FILE=../.env.dev`) groups to Railway services. |
| **`deploy/railway/SETUP-TWO-PROJECTS.md`** | CLI workflow for prod + dev stacks (`railway init`, `./scripts/railway-add-supabase-services.sh`). |
| **`deploy/DEPLOY-STEPS.txt`** | Railway quick reference. |
| **`deploy/DNS-CUTOVER.md`** | Custom domains and retiring old infrastructure. |

## Summary

| Goal | Use |
|------|-----|
| Same stack as local on Railway | **deploy/railway/PROVISION.md** + **deploy/kong/** |
| Prod + dev stacks on Railway | **deploy/railway/SETUP-TWO-PROJECTS.md** |
| Same stack on your VPS | [supabase-production.md](supabase-production.md) |
