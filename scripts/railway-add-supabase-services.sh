#!/usr/bin/env bash
# Add the six self-hosted Supabase services to the currently linked Railway project.
# Run from commandra/ after: railway link -p "Commandra"   (or "Commandra Dev")
#
# Optional: RAILWAY_GITHUB_REPO=YourOrg/commandra (default: Commandra-HQ/commandra)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${RAILWAY_GITHUB_REPO:-Commandra-HQ/commandra}"
SERVICES=(
  supabase-db
  supabase-supavisor
  supabase-meta
  supabase-analytics
  supabase-studio
  supabase-kong
)

for name in "${SERVICES[@]}"; do
  echo "==> railway add --service $name --repo $REPO"
  railway add --service "$name" --repo "$REPO"
done

echo ""
echo "Next: wire config paths with python3 scripts/railway-wire-supabase-services.py"
echo "      (or set Config File Path per deploy/railway/PROVISION.md), enable private networking, attach db volume."
