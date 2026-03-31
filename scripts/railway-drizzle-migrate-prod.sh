#!/usr/bin/env bash
# Run Drizzle migrations against production Postgres (Railway).
# Uses POSTGRES_PASSWORD from supabase-db and connects as user `postgres` on the
# private hostname (transaction pooler user `postgres.<tenant>` cannot auth directly on DB).
#
# Prereqs: railway CLI, logged in, linked to project; service names match Railway.
# From repo root: ./scripts/railway-drizzle-migrate-prod.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RAILWAY_SVC_DB="${RAILWAY_SVC_DB:-supabase-db}"
RAILWAY_SVC_API="${RAILWAY_SVC_API:-api}"
MIGRATE_DB_HOST="${MIGRATE_DB_DIRECT_HOST:-supabase-db.railway.internal}"

PW="$(railway ssh -s "$RAILWAY_SVC_DB" -- printenv POSTGRES_PASSWORD | tr -d '\r\n')"
if [[ -z "$PW" ]]; then
	echo "Could not read POSTGRES_PASSWORD from $RAILWAY_SVC_DB." >&2
	exit 1
fi

MIGRATE_DATABASE_URL="postgresql://postgres:${PW}@${MIGRATE_DB_HOST}:5432/postgres"
export MIGRATE_DATABASE_URL
railway ssh -s "$RAILWAY_SVC_API" -- env MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL" DRIZZLE_MIGRATE_SSL_DISABLE=1 node /app/apps/api/dist/db/migrate.js
