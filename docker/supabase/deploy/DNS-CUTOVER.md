# DNS cutover (Railway)

Run this after the Supabase stack and landing page deploy successfully on Railway and you have verified Studio, Storage (via Kong), and pooler connectivity.

## 1. Kong / DB API hostname

- In your DNS provider, point **`db.commandra.app`** (or your Kong host) to Railway **supabase-kong** (CNAME to Railway target from **Settings → Networking → Custom domain**).
- Wait for TLS to provision in Railway. Confirm `https://db.commandra.app` loads Studio (basic auth) or health.

## 2. Marketing / landing

- Point **`commandra.app`** (apex + `www` if used) to the **landing** Railway service custom domain.
- Update **`LANDING_URL`** on Commandra **api** and **`CORS_ORIGINS`** if the marketing origin changed.
- Redeploy **api** if needed: `railway up --service api` from `commandra/`.

## 3. Commandra `api` / `web`

- No DNS change if **`api.commandra.app`** and **`dashboard.commandra.app`** already target Railway.
- Confirm **`SUPABASE_PUBLIC_URL`** (studio) and **`SUPABASE_URL`** (commandra api) both match the public Kong URL after cutover.

## 4. Decommission old hosting

- After traffic is fully on Railway for 24–48h, tear down old apps, disks, and DNS records so you are not paying twice.
- Remove obsolete deploy tokens from CI.
