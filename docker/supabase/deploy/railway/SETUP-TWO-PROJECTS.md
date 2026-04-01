# Railway: Commandra + Commandra Dev (two Supabase stacks)

CLI-first setup for **two isolated** self-hosted Supabase deployments as separate Railway projects:

| Railway project   | Studio label (`STUDIO_DEFAULT_PROJECT`) | Typical Kong URL |
|-------------------|----------------------------------------|------------------|
| **Commandra**     | `Commandra`                            | e.g. `db.commandra.app` |
| **Commandra Dev** | `Commandra Dev`                        | e.g. `*.up.railway.app` or `db-dev.commandra.app` |

Each project needs its **own** Postgres volume, secrets, and `SUPABASE_PUBLIC_URL`. Private DNS (`*.railway.internal`) is scoped per project, so you can reuse the **same** [kong/kong.yml](../kong/kong.yml) and the same six **service names** (`supabase-db`, …).

Full service table and memory limits: [PROVISION.md](PROVISION.md).

## 1. Create projects (CLI)

```bash
mkdir -p /tmp/railway-new && cd /tmp/railway-new
railway init -n "Commandra"
railway init -n "Commandra Dev"
```

If production already exists under another name, rename it to **Commandra** in Railway (Project → Settings → General), then only create **Commandra Dev**.

Confirm: `railway list`.

## 2. Link the repo (CLI)

From the **commandra** repo root:

```bash
cd /path/to/commandra
railway link -p "Commandra"          # or "Commandra Dev" when working on dev
```

Switch `railway link` when pushing variables or deploying the other stack, **or** use two clones each linked to a different project.

## 3. Add six services (CLI)

With the target project linked:

```bash
./scripts/railway-add-supabase-services.sh
```

Optional: `export RAILWAY_GITHUB_REPO=YourOrg/commandra` if the default `Commandra-HQ/commandra` is wrong.

Then wire **Config file path** + **GitHub source** for each service:

```bash
python3 scripts/railway-wire-supabase-services.py
```

PTY required; see [PROVISION.md](PROVISION.md). Alternatively set **Config File Path** in the Railway UI per [PROVISION.md §1](PROVISION.md).

Enable **private networking** on all six services (dashboard). Attach a **volume** to **supabase-db** at **`/var/lib/postgresql`** (not `.../data` — avoids ext4 `lost+found` breaking `initdb`; see [PROVISION.md](PROVISION.md)).

## 4. Domains and Kong

- Generate a public URL for **supabase-kong** on port **8000**:

  ```bash
  railway domain -s supabase-kong -p 8000
  ```

- Point **Commandra Dev**’s `SUPABASE_PUBLIC_URL` at the dev Kong URL (see `.env.dev` below).

- [kong/kong.yml](../kong/kong.yml) should use internal hosts such as `http://supabase-meta.railway.internal:8080` and `http://supabase-studio.railway.internal:3000` (same as [PROVISION.md §4](PROVISION.md)). Redeploy **supabase-kong** after edits: `railway up --service supabase-kong`.

## 5. Secrets and Studio labels (CLI)

**Production (Commandra):** use `docker/supabase/.env` (from `.env.example`, keys via `utils/generate-keys.sh --update-env`). Defaults in `.env.example` use `STUDIO_DEFAULT_PROJECT=Commandra`.

**Development (Commandra Dev):** maintain a **separate** env file with **different** keys and URLs:

```bash
cd docker/supabase
cp .env.dev.example .env.dev
SUPABASE_ENV_FILE=.env.dev sh ./utils/generate-keys.sh --update-env
# Edit .env.dev: SUPABASE_PUBLIC_URL, POOLER_TENANT_ID, DASHBOARD_USERNAME, etc.
```

Push variables (from `docker/supabase/deploy/`, with `railway link` set to the **same** project you are configuring):

```bash
cd docker/supabase/deploy
export RAILWAY_DB_PRIVATE_HOST="<private hostname of supabase-db in THIS project>"
ENV_FILE=../.env.dev ./set-railway-variables-from-env.sh all    # Commandra Dev

ENV_FILE=../.env ./set-railway-variables-from-env.sh all          # Commandra (prod), default ENV_FILE
```

`set-railway-variables-from-env.sh` runs Railway commands from the **commandra** repo root so `railway link` resolves correctly.

## 6. Deploy services (CLI)

From **commandra** repo root, project linked:

```bash
railway up --service supabase-db
railway up --service supabase-meta
railway up --service supabase-analytics
railway up --service supabase-studio
railway up --service supabase-supavisor
railway up --service supabase-kong
```

## 7. Commandra API against dev Supabase (local laptop)

From **`commandra/`**, copy [`.env.example`](../../../../.env.example) to **`.env`** and set:

- `SUPABASE_URL` — dev Kong public URL (HTTPS, no trailing slash), e.g. from `SUPABASE_PUBLIC_URL` in `.env.dev`.
- `SUPABASE_SERVICE_ROLE_KEY` — dev `SERVICE_ROLE_KEY` from `docker/supabase/.env.dev`.
- `DATABASE_URL` — Postgres reachable **from your machine** (see below).

### 7a. Railway TCP proxy (required for `pnpm db:migrate` from a laptop)

Railway’s default public hostname (`*.up.railway.app`) does **not** accept raw Postgres on port **5432** from the internet, so `DATABASE_URL` must use a **[TCP Proxy](https://docs.railway.com/reference/tcp-proxy)** on the **`supabase-db`** service (internal port **5432**). The proxy gives a hostname (often `*.proxy.rlwy.net`) and an **external port that is not 5432**.

**Recommended URL shape** (direct Postgres through the proxy — matches [PROVISION.md](PROVISION.md) guidance for migrations):

```text
postgresql://postgres:<POSTGRES_PASSWORD>@<TCP_HOST>:<TCP_PORT>/postgres?sslmode=disable
```

Use **`postgres`** and **`POSTGRES_PASSWORD`** from `docker/supabase/.env.dev` for that stack.

**Create or discover the proxy (CLI):** with `railway link` pointing at **Commandra Dev**:

```bash
./scripts/railway-tcp-proxy-postgres.sh
# Optional: include password in output (avoid logging; paste into .env instead):
# POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' docker/supabase/.env.dev | cut -d= -f2-)" \
#   ./scripts/railway-tcp-proxy-postgres.sh
```

**Dashboard:** Project → **supabase-db** → **Settings** → **Networking** → **TCP Proxy** → map internal **5432**.

**Note:** A TCP proxy to **supabase-supavisor** (pooler) can misbehave from some local clients; **supabase-db** is the reliable choice for local API + Drizzle.

### 7b. Migrations and API (repo root)

```bash
pnpm db:migrate
pnpm --filter @afe/api dev
```

`pnpm db:migrate` loads **`commandra/.env`** (see `apps/api/src/db/migrate.ts`). If you already export `DATABASE_URL` in the shell, that wins.

### 7c. Alternatives (CI, no laptop DB access)

**Deployed `api` + private network:** `railway ssh` runs migrate **inside** the **`api`** service. From the repo root:

```bash
pnpm --filter @afe/api build
./scripts/railway-drizzle-migrate-commandra-dev.sh
```

Optional: `RAILWAY_PROJECT_ID=…` if your Commandra Dev project is not linked (see `railway list --json`).

If **`api` is not deployed** to the dev project, apply SQL manually: `./scripts/drizzle-sql-bundle.sh > /tmp/commandra-drizzle.sql` and run it in **Supabase Studio → SQL Editor**.

**Production project:** `RAILWAY_PROJECT="Commandra" ./scripts/railway-drizzle-migrate-prod.sh`

## Cost

Duplicating the full stack roughly **doubles** baseline RAM usage; see [PROVISION.md §2b](PROVISION.md).
