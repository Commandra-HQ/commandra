# Supabase: local setup done / what to change for prod

## What’s already set (local)

- **docker/supabase/.env**  
  - All secrets generated (JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, POSTGRES_PASSWORD, DASHBOARD_PASSWORD, etc.).  
  - **POOLER_TENANT_ID** = `commandra`  
  - **DASHBOARD_USERNAME** = `admin`  
  - Auth disabled: **DISABLE_SIGNUP=true**, **ENABLE_EMAIL_SIGNUP=false**, **ENABLE_PHONE_SIGNUP=false**

- **Repo root .env**  
  - **DATABASE_URL** points at local Supabase:  
    `postgresql://postgres.commandra:<POSTGRES_PASSWORD>@localhost:5432/postgres`

## View the UI locally

1. Start Supabase (if not already running):
   ```bash
   cd commandra/docker/supabase && docker compose up -d
   ```
   Wait 1–2 minutes for all services to be healthy (first run pulls images).

2. Open Studio: **http://localhost:8000**

3. Log in:
   - **Username:** `admin`  
   - **Password:** value of **DASHBOARD_PASSWORD** in `docker/supabase/.env` (set by `generate-keys.sh`)

4. (Optional) Run Commandra migrations:
   ```bash
   pnpm db:migrate
   ```
   Then you’ll see Commandra tables in Studio (Database / Tables).

---

## What to change before prod (db.commandra.app)

Use the **same** `.env` and keys; only these values change for production.

### 1. docker/supabase/.env (on the prod server)

Update these three URLs:

| Variable | Local (current) | Production |
|----------|-----------------|------------|
| **SUPABASE_PUBLIC_URL** | `http://localhost:8000` | `https://db.commandra.app` |
| **API_EXTERNAL_URL** | `http://localhost:8000` | `https://db.commandra.app` |
| **SITE_URL** | `http://localhost:3000` | `https://app.commandra.app` (or your main app URL) |

Optional: set a **DASHBOARD_PASSWORD** you’ll remember (e.g. a strong password) so you can log in to Studio in prod. The rest of the secrets stay as-is (prod-ready).

### 2. Repo root .env (or your prod env / secrets manager)

Update **DATABASE_URL** so the host is your prod Supabase host:

| Environment | DATABASE_URL host |
|-------------|--------------------|
| Local | `localhost:5432` |
| Production | `db.commandra.app:5432` (or your server’s internal host if 5432 is not public) |

Format (same for both, only host changes):

```text
DATABASE_URL=postgresql://postgres.commandra:POSTGRES_PASSWORD@HOST:5432/postgres
```

Use the **same** **POSTGRES_PASSWORD** from `docker/supabase/.env` (no need to change it for prod).

### 3. Server and HTTPS

- Point **db.commandra.app** DNS at the server where Supabase runs.
- Put HTTPS in front of Kong (port 8000), e.g. Caddy/Nginx or a load balancer.  
  See [docs/supabase-production.md](../../docs/supabase-production.md).

---

## Summary

| Goal | Action |
|------|--------|
| View UI locally | `cd docker/supabase && docker compose up -d`, then open http://localhost:8000, login **admin** / **DASHBOARD_PASSWORD** from `.env` |
| Push to prod | On prod server: same `docker/supabase/.env`, but set **SUPABASE_PUBLIC_URL**, **API_EXTERNAL_URL**, **SITE_URL** to https://db.commandra.app (and app URL). In Commandra prod env: set **DATABASE_URL** host to **db.commandra.app**. |

No need to regenerate keys for prod; the ones you have are already production-ready.
