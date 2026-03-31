# Supabase stack on Railway

Config-as-code for six services lives in subfolders here; each contains a `railway.toml` whose paths are relative to the **Commandra repo root**.

| Directory | Role |
|-----------|------|
| `supabase-db/` | Postgres (Supabase image) |
| `supabase-supavisor/` | Pooler |
| `supabase-meta/` | postgres-meta |
| `supabase-analytics/` | Logflare |
| `supabase-studio/` | Studio UI |
| `supabase-kong/` | Kong gateway |

**How to use**

1. Read **[PROVISION.md](PROVISION.md)** (step-by-step).
2. Secrets + env: **[RAILWAY-SECRETS-CHECKLIST.md](../RAILWAY-SECRETS-CHECKLIST.md)** and [set-railway-variables-from-env.sh](../set-railway-variables-from-env.sh).
3. Kong config: [kong/kong.yml](../kong/kong.yml) (relative to `deploy/`).
4. DNS cutover / decommissioning old hosts: [DNS-CUTOVER.md](../DNS-CUTOVER.md).

Shared Dockerfiles: [../docker/](../docker/). Kong image: [../kong/](../kong/).
