# Railway checklist

Use this after linking the repo so **api** and **web** both deploy and auto-deploy on push.

---

## Ports and how prod works

| Service | Set this port in Railway (Generate domain) | What runs on it |
|--------|--------------------------------------------|------------------|
| **API**  | **3001** | HTTP (REST, `/health`, `/api/*`) and WebSocket on path `/ws`. One public URL for everything. |
| **Web**  | **8080** | Next.js dashboard. |

**API in production**

- The API listens on **3001** inside the container (we set `PORT=3001`). Logs will show “API server running on http://localhost:3001” and “WebSocket server on path /ws (same port as API)”.
- Railway forwards your API domain to container port **3001**. Use port **3001** when generating the API domain.
- Browsers and the extension use:
  - **API:** `https://api-xxx.up.railway.app` (e.g. `/health`, `/api/auth/login`, etc.)
  - **WebSocket:** `wss://api-xxx.up.railway.app/ws` (same host, path `/ws`).

**Web in production**

- The dashboard listens on **8080** inside the container (start command uses `-p 8080`). Use port **8080** when generating the web domain.
- Dashboard URL: `https://web-xxx.up.railway.app`.

---

## 1. API service

- [ ] **Settings → Source**: Repo is connected; **branch** is the one you push to (e.g. `main`).
- [ ] **Settings → Source**: **Deploy on push** / automatic deploys are **on** (no “Disconnect”).
- [ ] **Settings → Build**: **Config File Path** is **empty** (so root `railway.toml` is used).
- [ ] **Settings → Networking**: Domain generated; selected port is **3001**.
- [ ] **Variables**: `PORT=3001`, `DATABASE_URL`, `JWT_SECRET`, `LLM_API_KEY`, `LLM_PROVIDER`, `CORS_ORIGINS` (web URL).

---

## 2. Web service

- [ ] **Settings → Source**: Same repo and **same branch** as API; **Deploy on push** is **on**.
- [ ] **Settings → Build**: **Config File Path** = **`apps/web/railway.toml`** (path from repo root).
- [ ] **Settings → Build**: **Root Directory** is **empty**.
- [ ] **Settings → Networking**: Domain generated; selected port is **8080**.
- [ ] **Variables**: `NEXT_PUBLIC_API_URL` = API domain (e.g. `https://api-xxx.up.railway.app`).

---

## 3. When does each service deploy?

- **API** deploys when you push changes under `apps/api/`, `packages/shared/`, or root `railway.toml`.
- **Web** deploys when you push changes under `apps/web/`, `packages/shared/`, root `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`, or `apps/web/railway.toml`.

If you only change API code, only the API service will redeploy. Push a change under `apps/web/` (or one of the paths above) to trigger a web deploy.

---

## 4. If web never deploys on push

1. In **web** service → **Settings → Source**, confirm the **same GitHub repo and branch** as the one you push to.
2. In **web** → **Settings → Source**, ensure the repo is **connected** and automatic deploys are **enabled** (Railway’s “Deploy on push”).
3. Push a change that matches web’s watch paths (e.g. edit `apps/web/package.json` or a file under `apps/web/`) and check **Deployments** for the web service.
4. If the GitHub App was installed with limited repo access, open [GitHub → Settings → Applications → Railway](https://github.com/settings/installations) and ensure this repo is allowed.

---

## 5. CLI: project, link, deploy

From the **`commandra/`** repo root (after `railway link` → project **commandra**):

```bash
railway status
railway service status --all

railway up --service api
railway up --service web
```

See [scripts/railway-setup.sh](../../scripts/railway-setup.sh) for first-time linking notes. Service names in production are **`api`** and **`web`** (not `commandra`).

---

## 6. Verify production (custom domains)

If **api.commandra.app** and **dashboard.commandra.app** are configured:

- `GET https://api.commandra.app/health` should return OK.
- Dashboard loads and can authenticate; browser uses `NEXT_PUBLIC_API_URL=https://api.commandra.app`.
- **CORS:** `CORS_ORIGINS` on the API must include `https://dashboard.commandra.app` (and the marketing origin if the landing site calls the API).
- **Landing ↔ API:** `SYNC_SECRET` on the API must match `COMMANDRA_SYNC_SECRET` on the landing service; `JWT_SECRET` must match where Clerk/JWT is shared (see landing `.env.local.example`).

---

## 7. Self-hosted Supabase on Railway

The six-service stack (Postgres, pooler, Kong, Studio, …) is documented under [docker/supabase/deploy/railway/PROVISION.md](../../docker/supabase/deploy/railway/PROVISION.md). It is separate from the managed **Postgres** plugin service often added for a quick start.

After Kong + pooler are live, update the **api** service variables:

- `DATABASE_URL` (Supavisor)
- `SUPABASE_URL` (public Kong URL, no trailing slash)
- `SUPABASE_SERVICE_ROLE_KEY`
- `LANDING_URL` / `CORS_ORIGINS` as needed

Then redeploy: `railway up --service api`.

---

## 8. Landing (marketing) site

The landing app lives outside this repo folder: `landing-page/` in the **commandra-hq** monorepo. It includes [railway.toml](../../../landing-page/railway.toml). Link that directory or repo in Railway, set variables from `landing-page/.env.local.example`, and deploy with `railway up --service <name>`.
