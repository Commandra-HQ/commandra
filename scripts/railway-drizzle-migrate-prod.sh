#!/usr/bin/env bash
# Run Drizzle migrations against production Postgres (Railway).
# Uses POSTGRES_PASSWORD from supabase-db and connects as user `postgres` on the
# private hostname (transaction pooler user `postgres.<tenant>` cannot auth directly on DB).
#
# Prereqs: railway CLI, logged in, linked to project; service names match Railway.
# From repo root: ./scripts/railway-drizzle-migrate-prod.sh
#
# Optional: RAILWAY_PROJECT=<id or exact name from `railway list`> to target prod without changing link.
# Uses RAILWAY_ENVIRONMENT (default: production) with -p. Example:
#   RAILWAY_PROJECT=<project-id> ./scripts/railway-drizzle-migrate-prod.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RAILWAY_SVC_DB="${RAILWAY_SVC_DB:-supabase-db}"
RAILWAY_SVC_API="${RAILWAY_SVC_API:-api}"
MIGRATE_DB_HOST="${MIGRATE_DB_DIRECT_HOST:-supabase-db.railway.internal}"

# Avoid "${arr[@]}" with set -u when the array is empty (some bash versions treat it as unset).
# When `RAILWAY_PROJECT` overrides the linked project, Railway must also get the target
# environment (`-e`); otherwise the CLI keeps the linked project's environment id and fails.
railway_ssh() {
	if [[ -n "${RAILWAY_PROJECT:-}" ]]; then
		railway ssh -p "$RAILWAY_PROJECT" -e "${RAILWAY_ENVIRONMENT:-production}" "$@"
	else
		railway ssh "$@"
	fi
}

PW="$(railway_ssh -s "$RAILWAY_SVC_DB" -- printenv POSTGRES_PASSWORD | tr -d '\r\n')"
if [[ -z "$PW" ]]; then
	echo "Could not read POSTGRES_PASSWORD from $RAILWAY_SVC_DB." >&2
	exit 1
fi

MIGRATE_DATABASE_URL="postgresql://postgres:${PW}@${MIGRATE_DB_HOST}:5432/postgres"
export MIGRATE_DATABASE_URL
railway_ssh -s "$RAILWAY_SVC_API" -- env MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL" DRIZZLE_MIGRATE_SSL_DISABLE=1 node /app/apps/api/dist/db/migrate.js
