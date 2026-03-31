# Railway variables checklist (Supabase stack)

Use this when wiring production on Railway. Values come from the same source as local: `docker/supabase/.env` (see `utils/generate-keys.sh`).

See also [set-railway-variables-from-env.sh](set-railway-variables-from-env.sh) (Railway CLI helper).

Replace **`RAILWAY_DB_PRIVATE_HOST`** / **`RAILWAY_META_URL`** / **`RAILWAY_STUDIO_URL`** below with your project’s private hostnames or public service URLs after services exist.

## Service: `supabase-db` (or `commandra-db`)

| Variable | Notes |
|----------|--------|
| `POSTGRES_PASSWORD` | From `.env` |
| `JWT_SECRET` | Same as stack / Commandra API signing for Supabase JWTs |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_DB` | `postgres` |
| `JWT_EXPIRY` | `3600` |

**Volume:** mount Postgres data directory per Railway docs (persistent disk).

## Service: `supabase-supavisor`

| Variable | Notes |
|----------|--------|
| `POSTGRES_PASSWORD` | |
| `SECRET_KEY_BASE` | |
| `VAULT_ENC_KEY` | |
| `API_JWT_SECRET` | Use stack `JWT_SECRET` |
| `METRICS_JWT_SECRET` | Use stack `JWT_SECRET` |
| `POOLER_TENANT_ID` | e.g. from `.env` `POOLER_TENANT_ID` |
| `POSTGRES_DB` | `postgres` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_HOST` | **Private hostname of db service** (e.g. from Railway networking) |
| `CLUSTER_POSTGRES` | `true` |
| `POOLER_POOL_MODE` | `transaction` |
| `PORT` | `4000` (if required by image) |

Expose **5432** (and 6543 if you use session pool) on the service.

## Service: `supabase-meta`

| Variable | Notes |
|----------|--------|
| `POSTGRES_PASSWORD` | |
| `CRYPTO_KEY` | `PG_META_CRYPTO_KEY` from `.env` |

## Service: `supabase-analytics`

| Variable | Notes |
|----------|--------|
| `POSTGRES_PASSWORD` | |
| `LOGFLARE_PUBLIC_ACCESS_TOKEN` | |
| `LOGFLARE_PRIVATE_ACCESS_TOKEN` | |
| `POSTGRES_BACKEND_URL` | `postgresql://supabase_admin:POSTGRES_PASSWORD@RAILWAY_DB_PRIVATE_HOST:5432/_supabase` |

## Service: `supabase-studio`

| Variable | Notes |
|----------|--------|
| `POSTGRES_PASSWORD` | |
| `PG_META_CRYPTO_KEY` | |
| `SUPABASE_PUBLIC_URL` | **Public URL of Kong** (e.g. `https://db.commandra.app`) |
| `SUPABASE_ANON_KEY` | `ANON_KEY` from `.env` |
| `SUPABASE_SERVICE_KEY` | `SERVICE_ROLE_KEY` from `.env` |
| `AUTH_JWT_SECRET` | stack `JWT_SECRET` |
| `LOGFLARE_PUBLIC_ACCESS_TOKEN` | |
| `LOGFLARE_PRIVATE_ACCESS_TOKEN` | |
| `STUDIO_DEFAULT_ORGANIZATION` | optional |
| `STUDIO_DEFAULT_PROJECT` | optional |

## Service: `supabase-kong`

| Variable | Notes |
|----------|--------|
| `DASHBOARD_USERNAME` | |
| `DASHBOARD_PASSWORD` | |
| `SUPABASE_ANON_KEY` | `ANON_KEY` |
| `SUPABASE_SERVICE_KEY` | `SERVICE_ROLE_KEY` |
| `KONG_DATABASE` | `off` |

**Config:** [kong/kong.yml](kong/kong.yml) lists upstream URLs for meta and studio. Edit hosts to match your Railway **meta** and **studio** services (private `http://…railway.internal:port/` or public `https://…up.railway.app/`). The Kong image entrypoint sets `KONG_DECLARATIVE_CONFIG` if unset.

Expose **8000** and generate public domain for **Kong** (this becomes `SUPABASE_URL` host for Commandra Storage and Studio via Kong).

## Commandra `api` service (after stack is up)

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | `postgresql://postgres.TENANT:PASSWORD@SUPAVISOR_HOST:5432/postgres` |
| `SUPABASE_URL` | `https://<kong-public-host>` (no trailing slash) |
| `SUPABASE_SERVICE_ROLE_KEY` | same as `SERVICE_ROLE_KEY` in `.env` |
| `LANDING_URL` | marketing site origin |

## Landing page service (separate repo path `landing-page/`)

See [landing-page `.env.local.example`](../../../../landing-page/.env.local.example) (monorepo sibling of `commandra/`). Use `railway variable set` from `landing-page/` after `railway link`.

## Suggested Railway service names

| Role | Suggested name |
|------|----------------|
| Postgres | `supabase-db` |
| Pooler | `supabase-supavisor` |
| Meta | `supabase-meta` |
| Analytics | `supabase-analytics` |
| Studio | `supabase-studio` |
| API gateway | `supabase-kong` |
