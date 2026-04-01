#!/usr/bin/env bash
# Create a Railway TCP proxy to supabase-db:5432 for the linked project, then print a DATABASE_URL template.
# Requires: `railway link` to Commandra Dev (or target project), `jq`, `curl`, and a Railway CLI login (`railway whoami`).
#
# Usage:
#   ./scripts/railway-tcp-proxy-postgres.sh
#   POSTGRES_PASSWORD=... ./scripts/railway-tcp-proxy-postgres.sh   # includes full URL (avoid shell history; prefer pasting password manually)
#
# The printed URL uses `sslmode=disable` (matches the `postgres` JS client through Railway’s TCP proxy in typical setups).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v jq >/dev/null; then
	echo "jq is required" >&2
	exit 1
fi

TOKEN="$(jq -r '.user.token' "${RAILWAY_CONFIG_PATH:-$HOME/.railway/config.json}" 2>/dev/null || true)"
if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
	echo "Railway token not found. Run: railway login" >&2
	exit 1
fi

STATUS="$(railway status --json 2>/dev/null)" || {
	echo "railway status failed. Run: railway link -p \"Commandra Dev\"" >&2
	exit 1
}

ENV_ID="$(echo "$STATUS" | jq -r '.environments.edges[0].node.id')"
DB_SID="$(echo "$STATUS" | jq -r '.environments.edges[0].node.serviceInstances.edges[] | select(.node.serviceName=="supabase-db") | .node.serviceId')"

if [[ -z "$ENV_ID" || "$ENV_ID" == "null" || -z "$DB_SID" || "$DB_SID" == "null" ]]; then
	echo "Could not resolve environmentId or supabase-db serviceId from railway status --json." >&2
	exit 1
fi

EXISTING="$(curl -sS -X POST https://backboard.railway.com/graphql/v2 \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d "$(jq -n \
		--arg env "$ENV_ID" \
		--arg sid "$DB_SID" \
		'{query: ("query { tcpProxies(environmentId: \"" + $env + "\", serviceId: \"" + $sid + "\") { id domain proxyPort applicationPort } }")}')")"

if [[ "$(echo "$EXISTING" | jq '.data.tcpProxies | length')" -gt 0 ]]; then
	HOST="$(echo "$EXISTING" | jq -r '.data.tcpProxies[0].domain' | sed 's/\.$//')"
	PORT="$(echo "$EXISTING" | jq -r '.data.tcpProxies[0].proxyPort')"
	echo "TCP proxy already exists for supabase-db in this project."
	echo "Host: $HOST"
	echo "External port: $PORT"
	echo ""
	if [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
		ENC_PW="$(python3 -c "import urllib.parse, os; print(urllib.parse.quote(os.environ['POSTGRES_PASSWORD'], safe=''))")"
		echo "DATABASE_URL=postgresql://postgres:${ENC_PW}@${HOST}:${PORT}/postgres?sslmode=disable"
	else
		echo "DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@${HOST}:${PORT}/postgres?sslmode=disable"
	fi
	echo ""
	echo "Then: pnpm db:migrate && pnpm --filter @commandra/api dev"
	exit 0
fi

QUERY="$(jq -n \
	--arg env "$ENV_ID" \
	--arg sid "$DB_SID" \
	'{query: ("mutation { tcpProxyCreate(input: { environmentId: \"" + $env + "\", serviceId: \"" + $sid + "\", applicationPort: 5432 }) { id domain proxyPort applicationPort } }")}')"

RESP="$(curl -sS -X POST https://backboard.railway.com/graphql/v2 \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d "$QUERY")"

ERR="$(echo "$RESP" | jq -r '.errors[0].message // empty')"
if [[ -n "$ERR" ]]; then
	echo "GraphQL error: $ERR" >&2
	echo "$RESP" | jq . >&2
	exit 1
fi

DOMAIN="$(echo "$RESP" | jq -r '.data.tcpProxyCreate.domain')"
PORT="$(echo "$RESP" | jq -r '.data.tcpProxyCreate.proxyPort')"
# GraphQL sometimes returns FQDN with trailing dot
HOST="${DOMAIN%.}"

echo ""
echo "TCP proxy created (or returned if idempotent — if you see \"already exists\"-style errors, use the Railway dashboard Networking tab)."
echo "Host: $HOST"
echo "External port: $PORT"
echo ""

if [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
	ENC_PW="$(python3 -c "import urllib.parse, os; print(urllib.parse.quote(os.environ['POSTGRES_PASSWORD'], safe=''))")"
	echo "DATABASE_URL=postgresql://postgres:${ENC_PW}@${HOST}:${PORT}/postgres?sslmode=disable"
else
	echo "Add to commandra/.env (password = POSTGRES_PASSWORD from docker/supabase/.env.dev for this stack):"
	echo "  DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@${HOST}:${PORT}/postgres?sslmode=disable"
fi
echo ""
echo "Then from repo root: pnpm db:migrate && pnpm --filter @commandra/api dev"
