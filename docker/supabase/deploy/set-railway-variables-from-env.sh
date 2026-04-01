#!/usr/bin/env bash
# Push variables from docker/supabase/.env (or ENV_FILE) to Railway (grouped per Supabase service).
# Run from this directory (deploy/): ./set-railway-variables-from-env.sh [db|supavisor|meta|analytics|studio|kong|all]
#
# Optional: ENV_FILE=../.env.dev  (path relative to this script's directory, or absolute)
#
# Prereqs: railway CLI, logged in, `railway link` from commandra/ (or pass RAILWAY_PROJECT).
# Set service names to match your Railway project (defaults are suggestions):
#   export RAILWAY_SVC_DB=supabase-db
#   export RAILWAY_SVC_SUPAVISOR=supabase-supavisor
#   ... etc.
# For supavisor and analytics, set:
#   export RAILWAY_DB_PRIVATE_HOST=<internal hostname of db service>
#   export RAILWAY_META_URL=<https or http URL for meta>
#   export RAILWAY_STUDIO_URL=<https or http URL for studio>

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE_REL="${ENV_FILE:-../.env}"
if [[ "$ENV_FILE_REL" = /* ]]; then
  ENV_FILE="$ENV_FILE_REL"
else
  ENV_FILE="$(cd "$SCRIPT_DIR" && pwd)/$ENV_FILE_REL"
fi
cd "$REPO_ROOT"

RAILWAY_SVC_DB="${RAILWAY_SVC_DB:-supabase-db}"
RAILWAY_SVC_SUPAVISOR="${RAILWAY_SVC_SUPAVISOR:-supabase-supavisor}"
RAILWAY_SVC_META="${RAILWAY_SVC_META:-supabase-meta}"
RAILWAY_SVC_ANALYTICS="${RAILWAY_SVC_ANALYTICS:-supabase-analytics}"
RAILWAY_SVC_STUDIO="${RAILWAY_SVC_STUDIO:-supabase-studio}"
RAILWAY_SVC_KONG="${RAILWAY_SVC_KONG:-supabase-kong}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy docker/supabase/.env.example to .env (or set ENV_FILE for .env.dev) and run utils/generate-keys.sh --update-env."
  exit 1
fi

while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    eval "export $(printf '%q=%q' "$key" "$value")"
  fi
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" || true)

POOLER_TENANT_ID="${POOLER_TENANT_ID:-commandra}"
SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://db.commandra.app}"

require_db_host() {
  if [[ -z "${RAILWAY_DB_PRIVATE_HOST:-}" ]]; then
    echo "Set RAILWAY_DB_PRIVATE_HOST to the Railway private hostname of the db service (required for supavisor/analytics/all)."
    exit 1
  fi
}
build_postgres_backend_url() {
  require_db_host
  echo "postgresql://supabase_admin:${POSTGRES_PASSWORD}@${RAILWAY_DB_PRIVATE_HOST}:5432/_supabase"
}

# Supavisor Ecto repo (metadata); must match docker-compose DATABASE_URL pattern.
build_supavisor_database_url() {
  require_db_host
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" RAILWAY_DB_PRIVATE_HOST="$RAILWAY_DB_PRIVATE_HOST" python3 - <<'PY'
import os, urllib.parse
pw = urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe="")
h = os.environ["RAILWAY_DB_PRIVATE_HOST"]
print(f"ecto://supabase_admin:{pw}@{h}:5432/_supabase", end="")
PY
}

railway_set() {
  local svc="$1"
  shift
  railway variable set --skip-deploys -s "$svc" "$@"
}

set_vars_db() {
  # Mount the Railway volume at /var/lib/postgresql (not .../data) so PGDATA=/var/lib/postgresql/data
  # is a clean directory inside the volume (avoids ext4 lost+found on the mount root). See PROVISION.md.
  railway_set "$RAILWAY_SVC_DB" \
    "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
    "JWT_SECRET=$JWT_SECRET" \
    "JWT_EXP=${JWT_EXPIRY:-3600}" \
    "POSTGRES_PORT=5432" \
    "POSTGRES_DB=postgres" \
    "PORT=5432"
}

set_vars_supavisor() {
  require_db_host
  local region="${REGION:-stub}"
  local db_url
  db_url="$(build_supavisor_database_url)"
  railway_set "$RAILWAY_SVC_SUPAVISOR" \
    "DATABASE_URL=$db_url" \
    "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
    "SECRET_KEY_BASE=$SECRET_KEY_BASE" \
    "VAULT_ENC_KEY=$VAULT_ENC_KEY" \
    "API_JWT_SECRET=$JWT_SECRET" \
    "METRICS_JWT_SECRET=$JWT_SECRET" \
    "POOLER_TENANT_ID=$POOLER_TENANT_ID" \
    "POSTGRES_DB=postgres" \
    "POSTGRES_PORT=5432" \
    "POSTGRES_HOST=$RAILWAY_DB_PRIVATE_HOST" \
    "CLUSTER_POSTGRES=true" \
    "POOLER_POOL_MODE=transaction" \
    "PORT=4000" \
    "REGION=$region" \
    "ERL_AFLAGS=-proto_dist inet_tcp"
}

set_vars_meta() {
  railway_set "$RAILWAY_SVC_META" \
    "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
    "CRYPTO_KEY=$PG_META_CRYPTO_KEY"
}

set_vars_analytics() {
  require_db_host
  railway_set "$RAILWAY_SVC_ANALYTICS" \
    "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
    "DB_PASSWORD=$POSTGRES_PASSWORD" \
    "LOGFLARE_PUBLIC_ACCESS_TOKEN=$LOGFLARE_PUBLIC_ACCESS_TOKEN" \
    "LOGFLARE_PRIVATE_ACCESS_TOKEN=$LOGFLARE_PRIVATE_ACCESS_TOKEN" \
    "POSTGRES_BACKEND_URL=$(build_postgres_backend_url)" \
    "PORT=4000" \
    "DB_HOSTNAME=$RAILWAY_DB_PRIVATE_HOST" \
    "DB_DATABASE=_supabase" \
    "DB_PORT=5432" \
    "DB_USERNAME=supabase_admin" \
    "DB_SCHEMA=_analytics" \
    "LOGFLARE_FEATURE_FLAG_OVERRIDE=multibackend=true" \
    "LOGFLARE_NODE_HOST=0.0.0.0" \
    "LOGFLARE_SINGLE_TENANT=true" \
    "LOGFLARE_SUPABASE_MODE=true" \
    "POSTGRES_BACKEND_SCHEMA=_analytics"
}

set_vars_studio() {
  # Studio needs bind address + DB/analytics/meta URLs or SSR can hang; Kong then sits until Cloudflare returns 524.
  local analytics_host="${RAILWAY_ANALYTICS_PRIVATE_HOST:-supabase-analytics.railway.internal}"
  local meta_url="${RAILWAY_META_URL:-http://supabase-meta.railway.internal:8080}"
  local args=(
    "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
    "PG_META_CRYPTO_KEY=$PG_META_CRYPTO_KEY"
    "SUPABASE_PUBLIC_URL=$SUPABASE_PUBLIC_URL"
    "SUPABASE_URL=$SUPABASE_PUBLIC_URL"
    "SUPABASE_ANON_KEY=$ANON_KEY"
    "SUPABASE_SERVICE_KEY=$SERVICE_ROLE_KEY"
    "AUTH_JWT_SECRET=$JWT_SECRET"
    "LOGFLARE_PUBLIC_ACCESS_TOKEN=$LOGFLARE_PUBLIC_ACCESS_TOKEN"
    "LOGFLARE_PRIVATE_ACCESS_TOKEN=$LOGFLARE_PRIVATE_ACCESS_TOKEN"
    "STUDIO_DEFAULT_ORGANIZATION=${STUDIO_DEFAULT_ORGANIZATION:-Commandra}"
    "STUDIO_DEFAULT_PROJECT=${STUDIO_DEFAULT_PROJECT:-Commandra}"
    "HOSTNAME=0.0.0.0"
    "PORT=3000"
    "EDGE_FUNCTIONS_MANAGEMENT_FOLDER=/app/edge-functions"
    "LOGFLARE_URL=http://${analytics_host}:4000"
    "NEXT_ANALYTICS_BACKEND_PROVIDER=postgres"
    "NEXT_PUBLIC_ENABLE_LOGS=true"
    "STUDIO_PG_META_URL=$meta_url"
  )
  if [[ -n "${RAILWAY_DB_PRIVATE_HOST:-}" ]]; then
    args+=(
      "POSTGRES_HOST=$RAILWAY_DB_PRIVATE_HOST"
      "POSTGRES_DB=postgres"
      "POSTGRES_PORT=5432"
    )
  else
    echo "Warning: RAILWAY_DB_PRIVATE_HOST unset — set POSTGRES_HOST manually on Studio or re-run with RAILWAY_DB_PRIVATE_HOST." >&2
  fi
  railway_set "$RAILWAY_SVC_STUDIO" "${args[@]}"
}

set_vars_kong() {
  railway_set "$RAILWAY_SVC_KONG" \
    "DASHBOARD_USERNAME=${DASHBOARD_USERNAME:-admin}" \
    "DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD" \
    "SUPABASE_ANON_KEY=$ANON_KEY" \
    "SUPABASE_SERVICE_KEY=$SERVICE_ROLE_KEY" \
    "KONG_DATABASE=off"
}

APP="${1:-all}"
case "$APP" in
  db)        set_vars_db ;;
  supavisor) set_vars_supavisor ;;
  meta)      set_vars_meta ;;
  analytics) set_vars_analytics ;;
  studio)    set_vars_studio ;;
  kong)      set_vars_kong ;;
  all)
    require_db_host
    set_vars_db
    set_vars_supavisor
    set_vars_meta
    set_vars_analytics
    set_vars_studio
    set_vars_kong
    ;;
  *)
    echo "Usage: $0 [db|supavisor|meta|analytics|studio|kong|all]"
    exit 1
    ;;
esac

echo "Railway variables set for: $APP (using env file: $ENV_FILE; cwd: $REPO_ROOT — ensure \`railway link\` points at this stack's project)"
