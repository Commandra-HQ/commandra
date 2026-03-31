# Provision the Supabase stack on Railway

Use this with the **commandra** GitHub repo (or your fork). Paths below are from the **monorepo root** [`commandra/`](../../..).

**CLI tip:** If the Railway dashboard is inconvenient, you can wire all six services’ **GitHub source + config file path** from a machine where `railway login` works and PTY is available:

- [`scripts/railway-wire-supabase-services.py`](../../../../scripts/railway-wire-supabase-services.py)
- For **landing** (repo `Commandra-HQ/landing-page`): [`scripts/railway-wire-landing-service.py`](../../../../scripts/railway-wire-landing-service.py)

## 1. Create six services

In Railway project **commandra** (or a dedicated project), add **six** empty services from the same repository and branch as production.

Suggested **service names** (must match `*.railway.internal` assumptions in [kong/kong.yml](../kong/kong.yml) if you use private DNS):

| Service name      | Config file path |
|-------------------|------------------|
| `supabase-db`     | `docker/supabase/deploy/railway/supabase-db/railway.toml` |
| `supabase-supavisor` | `docker/supabase/deploy/railway/supabase-supavisor/railway.toml` |
| `supabase-meta`   | `docker/supabase/deploy/railway/supabase-meta/railway.toml` |
| `supabase-analytics` | `docker/supabase/deploy/railway/supabase-analytics/railway.toml` |
| `supabase-studio` | `docker/supabase/deploy/railway/supabase-studio/railway.toml` |
| `supabase-kong`  | `docker/supabase/deploy/railway/supabase-kong/railway.toml` |

For each service: **Settings → Build → Root Directory** = empty (repo root). **Config File Path** = path above.

Enable **private networking** between all six services (Railway dashboard → service → Networking).

## 2. Volume (db)

For **supabase-db**, attach a **volume** for Postgres data. The stock image expects a data directory; align mount path with [Dockerfile.db](../docker/Dockerfile.db) / Supabase docs. If the container fails on an empty volume, use a dedicated PGDATA subdir per [Supabase self-hosting docs](https://supabase.com/docs/guides/self-hosting/docker).

## 2b. Memory limits (cost control)

Each service’s `railway.toml` sets **`[deploy.limitOverride.containers] memoryBytes`** (caps on billed RAM). Rough tiers:

| Tier | Services | Rationale |
|------|-----------|-----------|
| **Data** | **supabase-db** (~1 GiB) | Postgres needs the most stable headroom. |
| **User-facing / hot** | **api**, **web**, **studio**, **landing** (~896 MiB each) | Commandra app + Studio + marketing; avoid CPU/memory thrashing. |
| **Edge + pooler** | **supabase-kong**, **supabase-supavisor** (~640 MiB each) | Throughput to Studio and `DATABASE_URL` without overspending. |
| **Analytics** | **supabase-analytics** (~896 MiB) | Logflare is memory-heavy; 512 MiB often OOMs. Raise toward **1 GiB** only if logs still show OOM. |
| **Internal light** | **supabase-meta** (~256 MiB) | postgres-meta only; increase if Studio schema browser degrades. |

Raise **supabase-db** first if Postgres OOMs; then analytics; then tune others from Railway logs.

## 3. Variables and secrets

1. Copy values from `docker/supabase/.env` (generated keys).
2. Apply **[RAILWAY-SECRETS-CHECKLIST.md](../RAILWAY-SECRETS-CHECKLIST.md)** per service.
3. Or run from `deploy/`:  
   `RAILWAY_DB_PRIVATE_HOST=<db private host> ./set-railway-variables-from-env.sh all`  
   after linking the Railway project (`railway link` from `commandra/`).

### Non-secret env

Set these in Railway **Variables** when not covered by the shell scripts:

**supabase-meta**

- `PG_META_DB_HOST` — private hostname of **supabase-db**
- `PG_META_DB_NAME` = `postgres`
- `PG_META_DB_PORT` = `5432`
- `PG_META_DB_USER` = `supabase_admin`
- `PG_META_PORT` = `8080`

**supabase-analytics**

- `DB_HOSTNAME` — private hostname of **supabase-db**
- `DB_DATABASE` = `_supabase`
- `DB_PORT` = `5432`
- `DB_USERNAME` = `supabase_admin`
- `DB_SCHEMA` = `_analytics`
- `LOGFLARE_FEATURE_FLAG_OVERRIDE` = `multibackend=true`
- `LOGFLARE_NODE_HOST` = `0.0.0.0` (bind for Railway health checks / public port; adjust if your image expects loopback only)
- `LOGFLARE_SINGLE_TENANT` = `true`
- `LOGFLARE_SUPABASE_MODE` = `true`
- `POSTGRES_BACKEND_SCHEMA` = `_analytics`

**supabase-studio**

- `POSTGRES_HOST` — private hostname of **supabase-db**
- `POSTGRES_DB` = `postgres`
- `POSTGRES_PORT` = `5432`
- `HOSTNAME` = `::`
- `EDGE_FUNCTIONS_MANAGEMENT_FOLDER` = `/app/edge-functions`
- `LOGFLARE_URL` = `http://<supabase-analytics private host>:4000`
- `NEXT_ANALYTICS_BACKEND_PROVIDER` = `postgres`
- `NEXT_PUBLIC_ENABLE_LOGS` = `true`
- `STUDIO_PG_META_URL` — public or private URL for **meta** (your Railway **supabase-meta** URL)
- `SUPABASE_URL` — public URL of **Kong** (e.g. `https://db.commandra.app`) after Kong is live

**supabase-supavisor** — optional tuning env: `DB_POOL_SIZE`, `POOLER_DEFAULT_POOL_SIZE`, `POOLER_MAX_CLIENT_CONN`, `POOLER_POOL_MODE`, `CLUSTER_POSTGRES`, `REGION` (see [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)). [set-railway-variables-from-env.sh](../set-railway-variables-from-env.sh) sets the required secrets and `POSTGRES_HOST`.

## 4. Kong upstreams

Edit [kong/kong.yml](../kong/kong.yml): set `services[].url` for **meta** and **studio** to URLs Kong can reach (private `http://supabase-meta.railway.internal:8080/` style, or public `https://…up.railway.app/` — must match how your project resolves services). Redeploy **supabase-kong** after changes.

## 5. Ports and domains

| Service | Container port | Railway public domain |
|---------|----------------|------------------------|
| supabase-kong | **8000** | Yes — custom domain for DB/API (e.g. `db.commandra.app`) |
| supabase-studio | **3000** | Usually internal; served via Kong `/` |
| supabase-meta | **8080** | Usually internal |
| supabase-analytics | **4000** | Usually internal |
| supabase-supavisor | **5432** (and optional **6543**) | Optional; Commandra `api` can use private hostname |

## 6. Commandra `api` service

After pooler and Kong work:

- `DATABASE_URL` → Supavisor connection string.
- `SUPABASE_URL` → `https://<kong public host>` (no trailing slash).
- `SUPABASE_SERVICE_ROLE_KEY` → same as `SERVICE_ROLE_KEY` in `docker/supabase/.env`.

Redeploy **api**: from `commandra/`, `railway up --service api`.

### Commandra Drizzle migrations (tables / schema)

Migrations live in `apps/api/drizzle/`. Locally: from the `commandra/` repo root, `pnpm db:migrate` (requires local Supabase or a reachable `DATABASE_URL`).

**Production (Railway), initial or ad-hoc run:**

1. **Prefer private pooler DNS** so connections work from inside the project network. The API’s `DATABASE_URL` should use the **private** hostname for **supabase-supavisor** (from Railway → service → **Networking** / private address), not only the public TCP proxy URL. Public proxy endpoints often **time out** when used from `railway ssh` or from another service.

2. **One-off migrate inside the running API container** (uses the image’s compiled migrator and `DATABASE_URL`):

   ```bash
   cd commandra && railway ssh -s api -- node apps/api/dist/db/migrate.js
   ```

3. If that still cannot reach Postgres, run the helper that rewrites the pooler host to private DNS (default `supabase-supavisor.railway.internal`; override with `MIGRATE_POOLER_HOST` if your service name differs):

   ```bash
   railway ssh -s api -- node apps/api/scripts/run-migrate-with-private-pooler.mjs
   ```

4. **Optional env on service `api`:** `MIGRATE_DATABASE_URL` — if set, `dist/db/migrate.js` uses it instead of `DATABASE_URL` (e.g. direct `postgresql://supabase_admin:…@supabase-db.railway.internal:5432/postgres` for DDL when the transaction pooler rejects migrations). Remove after use if you want only `DATABASE_URL` long term.

5. **From your laptop:** `railway run -s api pnpm db:migrate` only works if the URL in `DATABASE_URL` is reachable from your machine (often it is not for private-only DBs).

6. **CI/CD (later):** run `node apps/api/dist/db/migrate.js` with `DATABASE_URL` / `MIGRATE_DATABASE_URL` injected as a secret, after deploy.

## 7. Data migration

Dump from your previous Postgres host and restore into **supabase-db**, or use your provider’s migration process. Plan downtime or a read-only window. See [DNS-CUTOVER.md](../DNS-CUTOVER.md).
