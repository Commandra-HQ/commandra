# Local Supabase (self-hosted) for Commandra

Commandra uses **self-hosted Supabase** as the database instead of a standalone Postgres container. Same Drizzle ORM and schema; only the connection target changes. You get Supabase Studio to view and manage the database.

**Same setup everywhere:** We use the **same** `docker/supabase` stack locally and in production (VPS, Railway, or customer infra). That keeps dev and prod identical, avoids vendor lock-in, and lets enterprises run the full product on their own infrastructure. Do not use managed/vendor Postgres shortcuts if you want full self-hosted parity with this stack.

**Production:** For deploying the same stack at **db.commandra.app** (or any server), see [supabase-production.md](supabase-production.md). For Railway, see [supabase-railway.md](supabase-railway.md).

---

## How to run (quick)

1. **Configure** `docker/supabase/.env`: copy from `.env.example`, run `sh ./utils/generate-keys.sh --update-env`, then set `POOLER_TENANT_ID` and `DASHBOARD_USERNAME`. (Optional: set `DISABLE_SIGNUP=true`, `ENABLE_EMAIL_SIGNUP=false`, `ENABLE_PHONE_SIGNUP=false` — Commandra does not use Supabase Auth.)
2. **Start:** `cd docker/supabase && docker compose up -d`
3. **Commandra `.env`** (repo root): `DATABASE_URL=postgresql://postgres.POOLER_TENANT_ID:POSTGRES_PASSWORD@localhost:5432/postgres`
4. **Migrate:** `pnpm db:migrate`
5. **Studio:** http://localhost:8000 (login: `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`)

See also **docker/supabase/README-COMMANDRA.md** for a short checklist.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- Git (for cloning Supabase docker files; already in repo under `docker/supabase/`)

## Where Supabase lives

- **Path**: `docker/supabase/` (official Supabase Docker setup, copied into the repo)
- **Studio (UI)**: After starting Supabase, open **http://localhost:8000** and sign in with the credentials you set in `docker/supabase/.env`

## 1. Configure Supabase secrets (required before first start)

Do **not** start with default secrets. From the Supabase docs:

1. **Copy and edit env**  
   `docker/supabase/.env` is created from `.env.example`. Edit `docker/supabase/.env` and set at least:

   - **`POSTGRES_PASSWORD`** — Use only letters and numbers to avoid URL encoding issues in `DATABASE_URL`.
   - **`JWT_SECRET`**, **`ANON_KEY`**, **`SERVICE_ROLE_KEY`** — Generate via:
     ```bash
     cd docker/supabase && sh ./utils/generate-keys.sh
     ```
     Then paste the output into the corresponding variables in `.env`.
   - **`DASHBOARD_USERNAME`** / **`DASHBOARD_PASSWORD`** — Studio login. Must include at least one letter (no numbers-only). Change from defaults.
   - **`POOLER_TENANT_ID`** — Tenant id used in the Postgres connection string (e.g. `your-tenant-id` or `commandra`).
   - Other required keys from the [Supabase self-hosting docs](https://supabase.com/docs/guides/self-hosting/docker#configuring-and-securing-supabase): `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`, `LOGFLARE_PUBLIC_ACCESS_TOKEN`, `LOGFLARE_PRIVATE_ACCESS_TOKEN`, etc.

2. **Optional: avoid port clash**  
   If port 5432 is already in use, set `POSTGRES_PORT=5433` (or another port) in `docker/supabase/.env`. Use that port in Commandra’s `DATABASE_URL` (e.g. `localhost:5433`).

## 2. Start Supabase

From the **repo root** (or from `docker/supabase`):

```bash
cd docker/supabase && docker compose up -d
```

Wait until services are healthy (about a minute). Check:

```bash
docker compose -f docker/supabase/docker-compose.yml ps
```

## 3. Set Commandra’s DATABASE_URL

Connection string format (Supavisor session mode):

```text
postgresql://postgres.POOLER_TENANT_ID:POSTGRES_PASSWORD@HOST:PORT/postgres
```

- **Local dev (API on host)**  
  In the repo root `.env` (copy from `.env.example` if needed):

  ```text
  DATABASE_URL=postgresql://postgres.YOUR_TENANT_ID:YOUR_POSTGRES_PASSWORD@localhost:5432/postgres
  ```

  Replace `YOUR_TENANT_ID` and `YOUR_POSTGRES_PASSWORD` with the values from `docker/supabase/.env` (`POOLER_TENANT_ID` and `POSTGRES_PASSWORD`). Use the same port as Supabase’s Supavisor (default 5432, or the one you set in `POSTGRES_PORT`).

- **Commandra API in Docker, Supabase on host**  
  In the same `.env` (or override in `docker-compose.dev.yml`), use the host machine as the DB host:

  ```text
  DATABASE_URL=postgresql://postgres.YOUR_TENANT_ID:YOUR_POSTGRES_PASSWORD@host.docker.internal:5432/postgres
  ```

## 4. Run Commandra migrations

With `DATABASE_URL` in `.env` pointing at Supabase:

```bash
pnpm db:migrate
```

This applies all migrations in `apps/api/drizzle/`, including `CREATE EXTENSION IF NOT EXISTS vector` and every table. No schema changes are required.

## 5. Start Commandra

- **All on host**  
  ```bash
  pnpm dev
  ```
- **API + Web in Docker**  
  ```bash
  docker compose -f docker-compose.yml -f ./dev/docker-compose.dev.yml up -d
  ```
  Ensure `.env` has `DATABASE_URL` (with `host.docker.internal` if Supabase is on the host).

## 6. View the database (Studio)

- Open **http://localhost:8000** (or your host IP if remote).
- Log in with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` from `docker/supabase/.env`.
- Use **Database** and **SQL Editor** to inspect tables (users, sites, pages, flows, conversations, embeddings, etc.) created by Drizzle migrations.

## Order of operations (summary)

1. Configure `docker/supabase/.env` (secrets, keys, dashboard password, `POOLER_TENANT_ID`).
2. Start Supabase: `cd docker/supabase && docker compose up -d`.
3. Set `DATABASE_URL` in the repo root `.env` (and use `host.docker.internal` if API runs in Docker).
4. Run migrations: `pnpm db:migrate`.
5. Start Commandra: `pnpm dev` or Docker Compose.
6. Open Studio at http://localhost:8000 to host and view the database.

## Optional: one-command bootstrap

From the repo root you can use:

```bash
pnpm supabase:local
```

This starts Supabase from `docker/supabase`, waits for Supavisor to be ready, then runs `pnpm db:migrate`. You must have already configured `docker/supabase/.env` and (for migrations) `DATABASE_URL` in the repo `.env`.

## Stopping Supabase

```bash
cd docker/supabase && docker compose down
```

To remove data as well: `docker compose down -v` (and optionally delete `docker/supabase/volumes/db/data`).

## References

- [Production (db.commandra.app)](supabase-production.md)
- [Railway / hosting](supabase-railway.md)
- [Supabase self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Configuring and securing Supabase](https://supabase.com/docs/guides/self-hosting/docker#configuring-and-securing-supabase)
- [Accessing Postgres through Supavisor](https://supabase.com/docs/guides/self-hosting/docker#accessing-postgres-through-supavisor)
