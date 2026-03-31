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

## 2b. Memory limits and **Railway cost**

Railway bills **allocated** resources (roughly **~$10 / GB RAM / month** plus vCPU and egress). Your **Observability** “estimated” total mostly tracks **sum of per-service limits** (plus CPU). Nine always-on services add up fast: **~3 GB of RAM caps ≈ ~$30/month RAM alone** before CPU — which matches dashboards in the **~$60–$70/mo** range when vCPU is included.

**Under ~$20/mo** with this full stack on Railway is usually **not realistic** unless you (a) **remove or sleep** services (e.g. stop **supabase-analytics** if you can live without Logflare logs), (b) move **Postgres** to a cheap external provider / single small VPS, or (c) run the **whole** Supabase stack on **one** small VM instead of nine Railway services.

**Log checks (recommended):** periodically  
`railway logs -s <service> -n 500 --since 7d | grep -iE 'OOM|out of memory|heap|SIGKILL|Memory cgroup'` — nginx/Kong may log **`signal 9`** on **reload/redeploy** (normal); correlate with OOM only if restarts coincide with errors.

Current caps are **balanced for stability vs ~\$20–\$40/mo** Railway RAM line (9 services add up; total limits ≈ **4.25 GiB**):

| Service | Cap (approx.) | Note |
|---------|----------------|------|
| **supabase-db** | 768 MiB | Postgres + extensions; **1 GiB** if monitoring shows DB OOM. |
| **supabase-studio** | 576 MiB | Admin Next app; **768 MiB** if Studio feels slow or OOM. |
| **api** | 576 MiB | **768 MiB** under heavy API load. |
| **web** | 576 MiB | Dashboard SSR/build; **768 MiB** if deploy/runtime OOM. |
| **landing** | 512 MiB | Marketing Next site. |
| **supabase-analytics** | 512 MiB | Logflare; **stop service** to save \~\$5+/mo if logs unused, or raise to **640 MiB** if OOM returns. |
| **supabase-kong** | 512 MiB | Image sets **`KONG_NGINX_WORKER_PROCESSES=1`** so small plans don’t spawn many workers and OOM-loop. |
| **supabase-supavisor** | 384 MiB | Pooler; **512 MiB** if many concurrent DB clients. |
| **supabase-meta** | 192 MiB | Light; **256 MiB** if Studio schema browser errors. |

Edit `memoryBytes` in each `railway.toml` and redeploy after changes.

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
- `HOSTNAME` = `0.0.0.0` (use **`0.0.0.0`**, not `::`, so Kong over **private IPv4** can reach Studio on Railway)
- `EDGE_FUNCTIONS_MANAGEMENT_FOLDER` = `/app/edge-functions`
- `LOGFLARE_URL` = `http://<supabase-analytics private host>:4000`
- `NEXT_ANALYTICS_BACKEND_PROVIDER` = `postgres`
- `NEXT_PUBLIC_ENABLE_LOGS` = `true`
- `STUDIO_PG_META_URL` — public or private URL for **meta** (your Railway **supabase-meta** URL)
- `SUPABASE_URL` — public URL of **Kong** (e.g. `https://db.commandra.app`) after Kong is live

**supabase-supavisor** — optional tuning env: `DB_POOL_SIZE`, `POOLER_DEFAULT_POOL_SIZE`, `POOLER_MAX_CLIENT_CONN`, `POOLER_POOL_MODE`, `CLUSTER_POSTGRES`, `REGION` (see [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)). [set-railway-variables-from-env.sh](../set-railway-variables-from-env.sh) sets the required secrets and `POSTGRES_HOST`.

## 4. Kong upstreams

Edit [kong/kong.yml](../kong/kong.yml): set `services[].url` for **meta** and **studio** to URLs Kong can reach (private `http://supabase-meta.railway.internal:8080/` style, or public `https://…up.railway.app/` — must match how your project resolves services). Redeploy **supabase-kong** after changes.

## 5a. Cloudflare **524** on `db.commandra.app`

524 means Cloudflare gave up waiting for the **origin** (Kong). Typical causes:

1. **Studio not reachable from Kong** — set **`HOSTNAME=0.0.0.0`** and **`PORT=3000`** on **supabase-studio**, and ensure `POSTGRES_HOST`, `LOGFLARE_URL`, `STUDIO_PG_META_URL`, `SUPABASE_PUBLIC_URL` match [§ Non-secret env](#3-variables-and-secrets). Re-run [set-railway-variables-from-env.sh](../set-railway-variables-from-env.sh) `studio` (with `RAILWAY_DB_PRIVATE_HOST`) or paste the same in Railway.
2. **Kong cannot resolve private DNS** — service names must match `*.railway.internal` hosts in [kong/kong.yml](../kong/kong.yml); private networking enabled on all services.
3. **Cloudflare SSL** — use **Full (strict)** toward Railway; avoid **Flexible** SSL with HTTPS origins.
4. After code changes, redeploy **supabase-kong** (config) and **supabase-studio** (env).

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

Your API’s `DATABASE_URL` usually points at **Supavisor** (`postgres.<tenant>`). That user **does not** authenticate on the raw Postgres container, and the **transaction** pooler often **resets** connections during Drizzle DDL — so use **primary Postgres** for migrations.

**Recommended (automated):** from `commandra/`, after `railway link` to the project:

```bash
./scripts/railway-drizzle-migrate-prod.sh
```

This reads `POSTGRES_PASSWORD` from **supabase-db** via `railway ssh` and runs `node apps/api/dist/db/migrate.js` inside **api** with  
`MIGRATE_DATABASE_URL=postgresql://postgres:…@supabase-db.railway.internal:5432/postgres`.

Override host if your DB service name differs (`MIGRATE_DB_DIRECT_HOST` in the script or edit the script).

**Alternatives:**

- Set **`MIGRATE_DATABASE_URL`** on the **api** service in Railway (full URL with `postgres` user and **`POSTGRES_PASSWORD`**) and run:  
  `railway ssh -s api -- env DRIZZLE_MIGRATE_SSL_DISABLE=1 node /app/apps/api/dist/db/migrate.js`
- Pooler-only helpers (`run-migrate-with-private-pooler.mjs`) may **`ECONNRESET`** on transaction mode (**5432**) or require **session** port **6543** to be exposed on Supavisor.

**Local laptop:** `railway run -s api pnpm db:migrate` only works if `DATABASE_URL` is reachable from your machine.

**CI/CD:** run the same `migrate.js` with `MIGRATE_DATABASE_URL` or direct postgres URL as a secret after deploy.

## 7. Data migration

Dump from your previous Postgres host and restore into **supabase-db**, or use your provider’s migration process. Plan downtime or a read-only window. See [DNS-CUTOVER.md](../DNS-CUTOVER.md).
