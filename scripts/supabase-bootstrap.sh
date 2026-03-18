#!/usr/bin/env bash
# Start self-hosted Supabase, wait for DB to be ready, then run Commandra migrations.
# Run from repo root. Requires docker/supabase/.env and repo .env (DATABASE_URL) configured.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Starting Supabase from docker/supabase..."
cd docker/supabase
docker compose up -d
cd "$ROOT"

echo "Waiting for Postgres (Supabase db) to be ready..."
SUPABASE_DIR="$ROOT/docker/supabase"
for i in {1..60}; do
  if (cd "$SUPABASE_DIR" && docker compose exec -T db pg_isready -U postgres -h localhost >/dev/null 2>&1); then
    echo "Postgres is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Timeout waiting for Postgres. Check: cd docker/supabase && docker compose logs db"
    exit 1
  fi
  sleep 2
done

# Supavisor may need a moment after db is up
echo "Waiting for Supavisor (connection pooler)..."
sleep 5

echo "Running Commandra migrations..."
pnpm db:migrate

echo "Done. Start Commandra with: pnpm dev"
echo "Open Supabase Studio at: http://localhost:8000"
