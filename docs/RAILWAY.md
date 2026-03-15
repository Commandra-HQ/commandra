# Railway checklist

Use this after linking the repo so **api** and **web** both deploy and auto-deploy on push.

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
