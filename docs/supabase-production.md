# Production: Supabase at db.commandra.app

Deploy **the same self-hosted Supabase stack** you run locally (`docker/supabase`) so production and dev match. Commandra uses its own auth (no Supabase Auth). No vendor lock-in—enterprises can run this stack on their own VPS or on-prem.

**Fly.io:** To run the same `docker/supabase` stack on Fly (multiple apps + private networking), see [supabase-fly.md](supabase-fly.md) Option B.

## Prerequisites

- A server (VPS) with Docker and Docker Compose
- Domain **db.commandra.app** pointing to that server’s IP
- HTTPS in front of Supabase (Caddy, Nginx, or cloud load balancer)

## 1. Server setup

On the server that will host Supabase:

```bash
# Clone or copy the Commandra repo (or only docker/supabase)
git clone <your-repo> commandra && cd commandra
# Or copy just the Supabase stack:
# scp -r docker/supabase user@server:/opt/commandra/
```

## 2. Configure docker/supabase/.env for production

Use **one** `.env` in `docker/supabase/` and set values for **production**. Generate secrets (never use defaults).

### Generate all secrets

```bash
cd docker/supabase
cp .env.example .env
sh ./utils/generate-keys.sh --update-env
```

Then edit `.env` and set the following.

### URLs (required for prod)

| Variable | Local | Production |
|----------|--------|------------|
| **SUPABASE_PUBLIC_URL** | `http://localhost:8000` | `https://db.commandra.app` |
| **API_EXTERNAL_URL** | `http://localhost:8000` | `https://db.commandra.app` |
| **SITE_URL** | `http://localhost:3000` | `https://app.commandra.app` (or your main app URL) |

### Auth disabled (Commandra uses its own auth)

Set these so Supabase Auth is not used for sign-up:

| Variable | Value |
|----------|--------|
| **DISABLE_SIGNUP** | `true` |
| **ENABLE_EMAIL_SIGNUP** | `false` |
| **ENABLE_PHONE_SIGNUP** | `false` |
| **ENABLE_ANONYMOUS_USERS** | `false` |

### Identity / Studio

| Variable | What to set |
|----------|----------------|
| **POOLER_TENANT_ID** | e.g. `commandra` (used in DATABASE_URL) |
| **DASHBOARD_USERNAME** | Studio login username |
| **DASHBOARD_PASSWORD** | Strong Studio login password (must include a letter) |

(If you ran `generate-keys.sh --update-env`, **POSTGRES_PASSWORD** and **DASHBOARD_PASSWORD** are already set; change **DASHBOARD_PASSWORD** to something you’ll remember.)

### Checklist

Ensure these are **not** left as placeholders:

- [ ] POSTGRES_PASSWORD
- [ ] JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY
- [ ] SECRET_KEY_BASE, VAULT_ENC_KEY, PG_META_CRYPTO_KEY
- [ ] LOGFLARE_PUBLIC_ACCESS_TOKEN, LOGFLARE_PRIVATE_ACCESS_TOKEN
- [ ] DASHBOARD_USERNAME, DASHBOARD_PASSWORD
- [ ] POOLER_TENANT_ID
- [ ] SUPABASE_PUBLIC_URL=https://db.commandra.app
- [ ] API_EXTERNAL_URL=https://db.commandra.app
- [ ] DISABLE_SIGNUP=true, ENABLE_EMAIL_SIGNUP=false, ENABLE_PHONE_SIGNUP=false

## 3. HTTPS in front of Supabase (db.commandra.app)

Supabase (Kong) listens on port 8000. Expose it as **https://db.commandra.app** using a reverse proxy.

### Option A: Caddy (recommended, automatic HTTPS)

```bash
# Install Caddy, then:
# Caddyfile:
db.commandra.app {
    reverse_proxy localhost:8000
}
```

Reload Caddy so it obtains a certificate and proxies to Kong.

### Option B: Nginx + Certbot

Proxy `https://db.commandra.app` to `http://127.0.0.1:8000` and use Certbot for TLS.

### Option C: Cloud load balancer

Point your cloud LB (e.g. AWS ALB, Cloudflare) at the server’s port 8000 and terminate TLS at the LB with a cert for db.commandra.app.

## 4. Run Supabase on the server

```bash
cd /path/to/commandra/docker/supabase
docker compose up -d
```

Wait for services to be healthy:

```bash
docker compose ps
```

## 5. Commandra production DATABASE_URL

Your Commandra API (wherever it runs in prod) must use:

```text
DATABASE_URL=postgresql://postgres.POOLER_TENANT_ID:POSTGRES_PASSWORD@db.commandra.app:5432/postgres
```

Use **TLS** if your Postgres client supports it and you expose 5432 over TLS. If Kong is the only public entry and 5432 is not exposed, use an **SSH tunnel** or a **private network** from the API host to the Supabase server and set the host in `DATABASE_URL` to the internal hostname/IP.

If you expose Supavisor (port 5432) publicly on db.commandra.app:

- Prefer restricting by IP (firewall or LB) to your API server(s).
- Or use a VPN / private network between API and DB server and keep 5432 internal.

## 6. Run migrations (once)

From your **local** machine (or a CI job) with `DATABASE_URL` pointing at production:

```bash
DATABASE_URL=postgresql://postgres.commandra:YOUR_PROD_POSTGRES_PASSWORD@db.commandra.app:5432/postgres pnpm db:migrate
```

Or set `DATABASE_URL` in `.env` to the prod URL temporarily and run `pnpm db:migrate`.

## 7. View database in production

- Open **https://db.commandra.app**
- Log in with **DASHBOARD_USERNAME** and **DASHBOARD_PASSWORD** from `docker/supabase/.env`

## Enterprise / fully self-hosted

The same `docker/supabase` stack runs identically on your own server, a customer’s VPS, or on-prem. There is no dependency on a managed DB vendor. Enterprises can:

- Run `docker/supabase` on their infrastructure (same images and `.env` pattern as above).
- Point Commandra at their instance via `DATABASE_URL`; run migrations once.
- Use Studio on their chosen domain (e.g. `db.customer.com`) with their own secrets and HTTPS.

Local dev, your production, and customer deployments all use the same stack for parity and no lock-in.

## Summary

| Step | Action |
|------|--------|
| 1 | Server + Docker; domain db.commandra.app → server IP |
| 2 | `docker/supabase/.env`: generate secrets, set prod URLs, disable auth sign-up |
| 3 | Put HTTPS in front of port 8000 (Caddy/Nginx/cloud LB) |
| 4 | `cd docker/supabase && docker compose up -d` |
| 5 | Set Commandra prod `DATABASE_URL` to `postgresql://postgres.TENANT:PASSWORD@db.commandra.app:5432/postgres` (or internal host if 5432 is not public) |
| 6 | Run `pnpm db:migrate` against prod once |
| 7 | Use Studio at https://db.commandra.app to view the DB |
