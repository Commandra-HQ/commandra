# Local development (API, Dashboard, Extension) with hot reload

Two ways to run everything locally with hot reload:

- **Option A: Docker Compose** — API + Dashboard + DB + Inngest in containers; extension on the host.
- **Option B: All on host** — Everything (including DB via Docker) on your machine with `pnpm dev`.

---

## Option A: Docker Compose (API + Dashboard + DB + Inngest)

Runs the API and dashboard in containers with **hot reload** via volume mounts. DB and Inngest run in Docker; the extension runs on your machine.

### 1. Prerequisites

- Docker and Docker Compose
- `.env` in repo root (copy from `.env.example`). Use `DATABASE_URL=postgresql://afe:afe_dev@localhost:5433/afe` only when running API **on the host**; the dev compose overrides this to `postgresql://afe:afe_dev@db:5432/afe` inside the network.

### 2. Start API, Dashboard, DB, and Inngest

**Foreground (single log stream):**
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

**Background (then view each service’s logs in separate terminals):**
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
# In separate terminals:
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api    # API only
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f web    # Dashboard only
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f db     # DB only
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f inngest # Inngest only
```

- **API**: http://localhost:3001 (hot reload via `tsx watch`)
- **Dashboard**: http://localhost:3000 (Next.js HMR)
- **DB**: localhost:5433 (from base compose)
- **Inngest**: http://localhost:8288

Edit `apps/api` or `apps/web` on your host; changes are reflected in the containers. If you change `packages/shared`, rebuild inside the API container then restart (or rebuild the dev image):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api pnpm --filter @afe/shared build
```

### 3. Run the extension on the host (with hot reload)

The Chrome extension must be loaded from your filesystem, so run it **outside** Docker:

```bash
pnpm --filter @afe/extension dev
```

Then in Chrome: **Extensions** → **Manage** → **Load unpacked** → choose `apps/extension/dist`. Vite will rebuild on change; reload the extension (Extensions page → refresh icon) when the build updates.

Defaults: extension uses `API_URL=http://localhost:3001` and `WS_URL=ws://localhost:3002` (set in `apps/extension/vite.config.ts` or via `.env`).

---

## Option B: Everything on the host

Best if you want a single `pnpm dev` and no app code in Docker.

### 1. Start only DB (and optionally Inngest)

```bash
docker compose up -d db inngest
```

Use `DATABASE_URL=postgresql://afe:afe_dev@localhost:5433/afe` in your `.env` (port 5433 is the host-mapped DB port).

### 2. Run API, Dashboard, and Extension with hot reload

From the repo root:

```bash
pnpm dev
```

This runs Turbo’s `dev` for all apps:

- **API**: http://localhost:3001 (`tsx watch`)
- **Dashboard**: http://localhost:3000 (Next.js)
- **Extension**: Vite dev server (builds to `apps/extension/dist`; load that folder as an unpacked extension in Chrome)

### 3. Run apps separately (e.g. separate terminals)

- API: `pnpm --filter @afe/api dev`
- Dashboard: `pnpm --filter @afe/web dev`
- Extension: `pnpm --filter @afe/extension dev`

Load the extension from `apps/extension/dist` in Chrome. If the extension dev server runs on port 5173, you can use that for HMR; otherwise reload the extension after changes.

---

## Env quick reference (local)

| App        | Env (when needed) |
|-----------|--------------------|
| API       | `DATABASE_URL`, `JWT_SECRET`, `LLM_*`, `PORT=3001`, `WS_PORT=3002` |
| Dashboard | `NEXT_PUBLIC_API_URL=http://localhost:3001` (default) |
| Extension | `API_URL=http://localhost:3001`, `WS_URL=ws://localhost:3002` (defaults in code) |

Dashboard and extension default to `http://localhost:3001` and `ws://localhost:3002` if not set.
