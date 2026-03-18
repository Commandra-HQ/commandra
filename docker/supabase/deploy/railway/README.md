# Deploy Supabase stack on Railway

Same Docker images as Fly: use `../docker/` Dockerfiles so prod matches local and Fly.

- **db**: Build from `../docker/Dockerfile.db`, add volume for `/var/lib/postgresql/data`, set env: `POSTGRES_PASSWORD`, `JWT_SECRET`, `POSTGRES_PORT=5432`, `POSTGRES_DB=postgres`, `JWT_EXPIRY=3600`.
- **supavisor**: Build from `../docker/Dockerfile.supavisor`. Set `POSTGRES_HOST` to Railway’s private hostname for the db service; set secrets from `docker/supabase/.env` (same as `set-secrets-from-env.sh` for Fly).
- **meta**, **analytics**, **studio**: Build from `../docker/Dockerfile.meta`, `Dockerfile.analytics`, `Dockerfile.studio`. Point to db (and each other) via Railway private hostnames.
- **kong**: Use `../fly/kong/` Dockerfile and kong config; replace `commandra-*.internal` hostnames with Railway service hostnames (or use a single private network and equivalent names).

Use the same secrets as in `docker/supabase/.env` (and optionally `commandra/.env` for `DATABASE_URL`) so Commandra connects with the same credentials. For `DATABASE_URL` in production, set the host to your Railway supavisor public URL or internal hostname.
