# Production deployment

This guide covers deploying Commandra to production: **backend API**, **admin dashboard (web)**, and **Chrome extension** (Chrome Web Store).

---

## 1. Backend (API)

The API runs as a Node.js app with Postgres (pgvector). You can run it with Docker (recommended) or on any Node host.

### 1.1 Environment variables

Create a production `.env` (or set in your host/CI). Required:

| Variable | Description | Example |
|----------|-------------|---------|
| `LLM_PROVIDER` | `anthropic` or `openai` | `anthropic` |
| `LLM_API_KEY` | Provider API key | `sk-ant-...` |
| `DATABASE_URL` | Postgres connection string (must include pgvector) | `postgresql://user:pass@host:5432/afe` |
| `JWT_SECRET` | Secret for signing JWTs (use a long random value) | `openssl rand -base64 32` |
| `PORT` | HTTP port | `3001` |
| `WS_PORT` | WebSocket port | `3002` |
| `CORS_ORIGINS` | Allowed origins for dashboard (comma-separated) | `https://app.yourdomain.com` |

Optional: `LLM_MODEL_STRONG`, `LLM_MODEL_FAST`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`. See `.env.example` for all options.

### 1.2 Deploy with Docker

**Option A: Docker Compose (single server)**

- Use the repo’s `docker-compose.yml`. For production:
  - Set `DATABASE_URL` to a real Postgres instance (e.g. managed Neon, RDS) or keep the `db` service and set a strong `POSTGRES_PASSWORD`.
  - Set `CORS_ORIGINS` to your dashboard URL (e.g. `https://app.yourdomain.com`).
- Run: `docker compose up -d` (after configuring `.env`).

**Option B: API only (you manage Postgres)**

- Build: `docker build -f apps/api/Dockerfile -t commandra-api .`
- Run the image with `DATABASE_URL`, `JWT_SECRET`, `LLM_API_KEY`, `CORS_ORIGINS`, `PORT`, `WS_PORT` set. Expose both HTTP and WebSocket ports (or put a reverse proxy in front).

### 1.3 Reverse proxy (recommended for production)

Put the API behind HTTPS and optionally expose WebSocket on the same host:

- **HTTP**: e.g. `https://api.yourdomain.com` → `http://localhost:3001`
- **WebSocket**: e.g. `wss://api.yourdomain.com` → `http://localhost:3002` (or a path like `/ws` if your proxy supports it)

Then:
- Dashboard will call `https://api.yourdomain.com`.
- Extension will be built with `API_URL=https://api.yourdomain.com` and `WS_URL=wss://api.yourdomain.com` (or the URL your proxy uses for WS).

### 1.4 Database migrations

Run migrations before or on first start:

```bash
pnpm --filter @afe/api db:migrate
```

With Docker, run the same in the API container or in a one-off migration job.

### 1.5 Deploy to Railway

Railway gives each service **one public port**. The API supports **single-port mode**: HTTP and WebSocket both use that port; WebSocket is on path **`/ws`**. This repo includes config-as-code so you can deploy **API** and **Dashboard** as two services with **per-folder auto-deploy** (watch paths).

**Config files (already in repo)**

- **Root `railway.toml`** → API service: Dockerfile build, watch `apps/api/**` and `packages/shared/**`, healthcheck `/health`.
- **`apps/web/railway.toml`** → Dashboard service: pnpm build/start from monorepo root, watch `apps/web/**` and `packages/shared/**`.

**1. Create a project and add Postgres (with pgvector)**

- [Railway](https://railway.app) → New Project.
- Add **Postgres**: use the [pgvector template](https://railway.app/template/3jJFCA) or add Postgres and enable the pgvector extension.
- Connect Postgres to the API service (or copy `DATABASE_URL` into the API service variables).

**2. API service (first service from this repo)**

- Your existing **commandra** service that’s linked to GitHub is the API. Ensure it uses the **root** config (don’t set a custom Config File Path so it uses `railway.toml` at repo root).
- **Variables**: `DATABASE_URL` (from Postgres), `JWT_SECRET`, `LLM_API_KEY`, `LLM_PROVIDER`, `CORS_ORIGINS` (dashboard URL; set after you have the web domain). Do **not** set `PORT` or `WS_PORT`.
- **Settings** → **Networking** → **Generate Domain** for the API.
- Deploy. Then run migrations once (CLI or one-off): `pnpm --filter @afe/api db:migrate`.

**3. Dashboard service (second service, same repo)**

- **+ Add** → **GitHub Repo** → select the **same** repo.
- In the new service: **Settings** → **Build** → set **Config File Path** to `apps/web/railway.toml` (path from repo root). Leave **Root Directory** empty.
- **Variables**: `NEXT_PUBLIC_API_URL` = the API’s Railway URL (e.g. `https://commandra-xxx.up.railway.app`).
- **Settings** → **Networking** → **Generate Domain** for the web service.
- Add that dashboard URL to the **API** service’s `CORS_ORIGINS` variable.
- Deploy.

**4. Auto-deploy**

- Both services use **watch patterns** from their config files. Pushes that only touch `apps/api` or `packages/shared` trigger API deploys; pushes that only touch `apps/web` or `packages/shared` trigger dashboard deploys. Enable **Deploy on push** in each service’s **Settings** → **Source** if you use GitHub.

**5. Extension**

- Build the extension with `API_URL=<your-api-railway-url>`; `WS_URL` is derived as `wss://<api-host>/ws`. Do not deploy the extension as a Railway service.

---

## 2. Admin dashboard (Next.js)

The dashboard is in `apps/web`. It talks to the API via `NEXT_PUBLIC_API_URL`.

### 2.1 Build-time env

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Public API base URL (no trailing slash) | `https://api.yourdomain.com` |

### 2.2 Build and run

```bash
cd apps/web
pnpm build
pnpm start
```

Or in the monorepo root:

```bash
pnpm --filter @afe/shared build
NEXT_PUBLIC_API_URL=https://api.yourdomain.com pnpm --filter @afe/web build
pnpm --filter @afe/web start
```

### 2.3 Deploy to a host

- **Node host**: Build as above, run `pnpm start` (or `node .next/standalone/server.js` if you add `output: 'standalone'` to Next config).
- **Docker**: Add a `Dockerfile` in `apps/web` that runs `pnpm build && pnpm start` (and set `NEXT_PUBLIC_API_URL` at build time).
- **Vercel / Netlify**: Set `NEXT_PUBLIC_API_URL` in the dashboard, connect the repo, and use the default Next build. Ensure your API allows CORS from the deployed dashboard origin and add that origin to the API’s `CORS_ORIGINS`.

After deployment, users open the dashboard URL (e.g. `https://app.yourdomain.com`), sign up or log in, then use “Reveal Extension Token” and paste the token into the extension.

---

## 3. Chrome extension (Chrome Web Store)

The extension in `apps/extension` must be built with your **production API and WebSocket URLs** and then submitted as a zip.

### 3.1 Build for production

From the repo root, set the API and WS URLs and build:

```bash
pnpm --filter @afe/shared build
API_URL=https://api.yourdomain.com WS_URL=wss://api.yourdomain.com pnpm --filter @afe/extension build
```

- **API_URL**: Same base URL the dashboard uses (e.g. `https://api.yourdomain.com`). No trailing slash.
- **WS_URL**: Optional. For HTTPS API URLs the extension derives `wss://<same-host>/ws` automatically (single-port mode, e.g. Railway). Override only if your WS is elsewhere (e.g. `wss://api.yourdomain.com:3002`).

Output is in `apps/extension/dist`. The packaged extension is that folder zipped (see below).

### 3.2 Chrome Web Store requirements

- **Developer account**: [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). One-time registration fee applies.
- **Listing**: Name, short and long description, icons (e.g. 128×128 for store), screenshots (often 1280×800 or 640×400), optional promo images. Avoid keyword spam; description must match what the extension does.
- **Privacy**: If you collect data, you need a privacy policy URL. Declare permissions clearly (this extension uses e.g. `activeTab`, `sidePanel`, `storage`, `tabs`, `scripting`, `alarms`, `<all_urls>` for automation).
- **Package**: Upload a **zip of the extension directory** (the contents of `dist`, not the folder itself). From repo root:
  ```bash
  cd apps/extension/dist && zip -r ../../../commandra-extension.zip . && cd ../../..
  ```
  Or zip `dist` contents from your file manager and upload that zip.

### 3.3 Submit and updates

1. In the developer dashboard, create a new item and upload the zip.
2. Fill in the listing (description, icons, screenshots, policy URL if needed).
3. Submit for review. Review can take from hours to a few days.
4. For updates: bump `version` in `apps/extension/manifest.json`, rebuild with the same `API_URL`/`WS_URL`, re-zip the new `dist` contents, and upload the new zip in the same item’s “Package” section.

### 3.4 Backend CORS

The API already allows any `chrome-extension://` origin. No extra CORS config is needed for the extension. Ensure `CORS_ORIGINS` includes your **dashboard** origin so the dashboard can call the API from the browser.

---

## Checklist

- [ ] Postgres (with pgvector) provisioned and `DATABASE_URL` set.
- [ ] API env set: `LLM_API_KEY`, `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGINS` (dashboard URL).
- [ ] Migrations run: `pnpm --filter @afe/api db:migrate`.
- [ ] API deployed (Docker or Node), HTTP and WS reachable (direct or via reverse proxy).
- [ ] Dashboard built with `NEXT_PUBLIC_API_URL` and deployed; users can sign up and get a token.
- [ ] Extension built with `API_URL` and `WS_URL`, zipped from `apps/extension/dist`, and submitted to Chrome Web Store with listing and policy (if required).
