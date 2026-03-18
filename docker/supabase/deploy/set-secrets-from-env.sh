#!/usr/bin/env bash
# Set Fly secrets from docker/supabase/.env so prod uses the same values as local/Commandra.
# Run from deploy/:  ./set-secrets-from-env.sh [db|supavisor|meta|analytics|studio|kong|all]
# Requires: flyctl, and ../.env (copy from .env.example and run utils/generate-keys.sh --update-env).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ENV_FILE="../.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy docker/supabase/.env.example to .env and run utils/generate-keys.sh --update-env."
  exit 1
fi

# Load only KEY=value lines (avoid 'Organization: foo' etc. breaking shell); quote values so spaces work
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    eval "export $(printf '%q=%q' "$key" "$value")"
  fi
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" || true)

APP="${1:-all}"

set_secrets_db() {
  fly secrets set -a commandra-db \
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    JWT_SECRET="$JWT_SECRET" \
    POSTGRES_PORT=5432 \
    POSTGRES_DB=postgres \
    JWT_EXPIRY=3600
}

set_secrets_supavisor() {
  fly secrets set -a commandra-supavisor \
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    SECRET_KEY_BASE="$SECRET_KEY_BASE" \
    VAULT_ENC_KEY="$VAULT_ENC_KEY" \
    API_JWT_SECRET="$JWT_SECRET" \
    METRICS_JWT_SECRET="$JWT_SECRET" \
    POOLER_TENANT_ID="${POOLER_TENANT_ID:-commandra}" \
    POSTGRES_DB=postgres \
    POSTGRES_PORT=5432
}

set_secrets_meta() {
  fly secrets set -a commandra-meta \
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    CRYPTO_KEY="$PG_META_CRYPTO_KEY"
}

set_secrets_analytics() {
  # POSTGRES_BACKEND_URL for logflare (supabase_admin user)
  POSTGRES_BACKEND_URL="postgresql://supabase_admin:${POSTGRES_PASSWORD}@commandra-db.internal:5432/_supabase"
  fly secrets set -a commandra-analytics \
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    LOGFLARE_PUBLIC_ACCESS_TOKEN="$LOGFLARE_PUBLIC_ACCESS_TOKEN" \
    LOGFLARE_PRIVATE_ACCESS_TOKEN="$LOGFLARE_PRIVATE_ACCESS_TOKEN" \
    POSTGRES_BACKEND_URL="$POSTGRES_BACKEND_URL"
}

set_secrets_studio() {
  fly secrets set -a commandra-studio \
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    PG_META_CRYPTO_KEY="$PG_META_CRYPTO_KEY" \
    SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://db.commandra.app}" \
    SUPABASE_ANON_KEY="$ANON_KEY" \
    SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY" \
    AUTH_JWT_SECRET="$JWT_SECRET" \
    LOGFLARE_PUBLIC_ACCESS_TOKEN="$LOGFLARE_PUBLIC_ACCESS_TOKEN" \
    LOGFLARE_PRIVATE_ACCESS_TOKEN="$LOGFLARE_PRIVATE_ACCESS_TOKEN" \
    STUDIO_DEFAULT_ORGANIZATION="${STUDIO_DEFAULT_ORGANIZATION:-Default}" \
    STUDIO_DEFAULT_PROJECT="${STUDIO_DEFAULT_PROJECT:-Default}"
}

set_secrets_kong() {
  fly secrets set -a commandra-kong \
    DASHBOARD_USERNAME="${DASHBOARD_USERNAME:-admin}" \
    DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
    SUPABASE_ANON_KEY="$ANON_KEY" \
    SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY"
}

case "$APP" in
  db)        set_secrets_db ;;
  supavisor) set_secrets_supavisor ;;
  meta)      set_secrets_meta ;;
  analytics) set_secrets_analytics ;;
  studio)    set_secrets_studio ;;
  kong)      set_secrets_kong ;;
  all)
    set_secrets_db
    set_secrets_supavisor
    set_secrets_meta
    set_secrets_analytics
    set_secrets_studio
    set_secrets_kong
    ;;
  *)
    echo "Usage: $0 [db|supavisor|meta|analytics|studio|kong|all]"
    exit 1
    ;;
esac

echo "Secrets set for: $APP"
