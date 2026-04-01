#!/usr/bin/env bash
# Run Drizzle migrations against Commandra Dev Postgres on Railway.
# Same mechanism as railway-drizzle-migrate-prod.sh: runs migrate.js inside the
# deployed api container (paths /app/apps/api/...). Requires an api service in
# the dev project with a build that includes apps/api/dist and apps/api/drizzle.
#
# Prereqs: railway CLI, logged in; api deployed to this project.
# From repo root:
#   ./scripts/railway-drizzle-migrate-commandra-dev.sh
#
# Optional: RAILWAY_PROJECT_ID to override (defaults to Commandra Dev project id).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-10125fe5-7a1b-4255-9d2b-5207092afe82}"
RAILWAY_SVC_DB="${RAILWAY_SVC_DB:-supabase-db}"
RAILWAY_SVC_API="${RAILWAY_SVC_API:-api}"
MIGRATE_DB_HOST="${MIGRATE_DB_DIRECT_HOST:-supabase-db.railway.internal}"

PW="$(railway ssh -p "$RAILWAY_PROJECT_ID" -s "$RAILWAY_SVC_DB" -- printenv POSTGRES_PASSWORD | tr -d '\r\n')"
if [[ -z "$PW" ]]; then
	echo "Could not read POSTGRES_PASSWORD from $RAILWAY_SVC_DB." >&2
	exit 1
fi

MIGRATE_DATABASE_URL="postgresql://postgres:${PW}@${MIGRATE_DB_HOST}:5432/postgres"
export MIGRATE_DATABASE_URL
railway ssh -p "$RAILWAY_PROJECT_ID" -s "$RAILWAY_SVC_API" -- env MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL" DRIZZLE_MIGRATE_SSL_DISABLE=1 node /app/apps/api/dist/db/migrate.js
