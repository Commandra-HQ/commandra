#!/usr/bin/env bash
# Railway setup: link project, add web service, set variables. No deploy.
# Run from repo root: ./scripts/railway-setup.sh
# You deploy from the UI after this.
set -e

REPO_SLUG="Commandra-HQ/commandra"
PROJECT_NAME="commandra"
API_SERVICE="api"
WEB_SERVICE="web"

echo "==> Linking to Railway project: $PROJECT_NAME"
if ! railway link -p "$PROJECT_NAME" 2>/dev/null; then
  echo "Link failed or already linked. Ensure you're logged in (railway login) and run: railway link"
  echo "Select project '$PROJECT_NAME', then re-run this script."
  exit 1
fi

echo "==> Adding web service (same repo)..."
railway add --service "$WEB_SERVICE" --repo "$REPO_SLUG" 2>/dev/null || echo "Add skipped (service may already exist)."

echo "==> Setting API service variables (no deploy)..."
JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "CHANGE_ME")
railway variable set "JWT_SECRET=$JWT_SECRET" "LLM_PROVIDER=anthropic" -s "$API_SERVICE" --skip-deploys 2>/dev/null || true

echo "==> Setting Web service variables (placeholder)..."
railway variable set "NEXT_PUBLIC_API_URL=https://YOUR_API_DOMAIN.up.railway.app" -s "$WEB_SERVICE" --skip-deploys 2>/dev/null || true

echo ""
echo "=== Railway setup done (no deploy). Finish in the UI ==="
echo ""
echo "API service ($API_SERVICE):"
echo "  • Variables: DATABASE_URL (from Postgres), LLM_API_KEY, CORS_ORIGINS (after web domain)."
echo "  • Generate domain."
echo ""
echo "Web service ($WEB_SERVICE):"
echo "  • Settings → Build → Config File Path = apps/web/railway.toml"
echo "  • Generate domain."
echo "  • Variable: NEXT_PUBLIC_API_URL = API domain (replace placeholder)."
echo ""
echo "Deploy from CLI (from repo root): railway up --service api && railway up --service web"
echo "Or use the Railway dashboard Deploy button."
echo ""
