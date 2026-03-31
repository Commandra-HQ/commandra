#!/usr/bin/env python3
"""Push local docker/supabase/.env and optional landing .env into Railway service variables.

Reads files only on the machine that runs this script; does not print secret values.
Usage (from commandra repo root):
  python3 scripts/sync-local-env-to-railway.py [--landing path/to/landing/.env.local]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)


def load_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip()
    return data


def railway_set(service: str, pairs: list[tuple[str, str]]) -> None:
    args = ["railway", "variable", "set", "--skip-deploys", "-s", service]
    for k, v in pairs:
        args.append(f"{k}={v}")
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr or r.stdout or "")
        raise SystemExit(r.returncode)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--landing",
        type=Path,
        default=None,
        help="Optional landing .env.local (public + prod URLs applied for Railway)",
    )
    ap.add_argument("--skip-landing", action="store_true")
    args = ap.parse_args()

    supa_path = ROOT / "docker" / "supabase" / ".env"
    if not supa_path.is_file():
        print("Missing docker/supabase/.env", file=sys.stderr)
        raise SystemExit(1)
    s = load_env(supa_path)

    def gv(key: str) -> str:
        if key not in s:
            print(f"Missing {key} in docker/supabase/.env", file=sys.stderr)
            raise SystemExit(1)
        return s[key]

    db_host = "supabase-db.railway.internal"
    meta_host = "supabase-meta.railway.internal"
    analytics_host = "supabase-analytics.railway.internal"
    kong_host = "supabase-kong.railway.internal"

    PW = gv("POSTGRES_PASSWORD")
    JWT = gv("JWT_SECRET")
    pooler = s.get("POOLER_TENANT_ID", "commandra")

    postgresql_backend = (
        f"postgresql://supabase_admin:{PW}@{db_host}:5432/_supabase"
    )

    database_url = f"ecto://supabase_admin:{PW}@{db_host}:5432/_supabase"
    jwt_exp = s.get("JWT_EXPIRY", "3600")

    railway_set(
        "supabase-db",
        [
            ("POSTGRES_PASSWORD", PW),
            ("JWT_SECRET", JWT),
            ("JWT_EXP", jwt_exp),
            ("POSTGRES_PORT", "5432"),
            ("POSTGRES_DB", "postgres"),
            ("PORT", "5432"),
        ],
    )

    railway_set(
        "supabase-supavisor",
        [
            ("POSTGRES_PASSWORD", PW),
            ("SECRET_KEY_BASE", gv("SECRET_KEY_BASE")),
            ("VAULT_ENC_KEY", gv("VAULT_ENC_KEY")),
            ("API_JWT_SECRET", JWT),
            ("METRICS_JWT_SECRET", JWT),
            ("POOLER_TENANT_ID", pooler),
            ("POSTGRES_DB", "postgres"),
            ("POSTGRES_PORT", "5432"),
            ("POSTGRES_HOST", db_host),
            ("DATABASE_URL", database_url),
            ("CLUSTER_POSTGRES", "true"),
            ("POOLER_POOL_MODE", "transaction"),
            ("REGION", "local"),
            ("DB_POOL_SIZE", "5"),
            ("POOLER_DEFAULT_POOL_SIZE", "20"),
            ("POOLER_MAX_CLIENT_CONN", "100"),
            ("ERL_AFLAGS", "-proto_dist inet_tcp"),
        ],
    )

    railway_set(
        "supabase-meta",
        [
            ("POSTGRES_PASSWORD", PW),
            ("CRYPTO_KEY", gv("PG_META_CRYPTO_KEY")),
            ("PG_META_DB_HOST", db_host),
            ("PG_META_DB_NAME", "postgres"),
            ("PG_META_DB_PORT", "5432"),
            ("PG_META_DB_USER", "supabase_admin"),
            ("PG_META_PORT", "8080"),
        ],
    )

    railway_set(
        "supabase-analytics",
        [
            ("POSTGRES_PASSWORD", PW),
            ("DB_PASSWORD", PW),
            ("LOGFLARE_PUBLIC_ACCESS_TOKEN", gv("LOGFLARE_PUBLIC_ACCESS_TOKEN")),
            ("LOGFLARE_PRIVATE_ACCESS_TOKEN", gv("LOGFLARE_PRIVATE_ACCESS_TOKEN")),
            ("POSTGRES_BACKEND_URL", postgresql_backend),
            ("DB_HOSTNAME", db_host),
            ("DB_DATABASE", "_supabase"),
            ("DB_PORT", "5432"),
            ("DB_USERNAME", "supabase_admin"),
            ("DB_SCHEMA", "_analytics"),
            ("LOGFLARE_FEATURE_FLAG_OVERRIDE", "multibackend=true"),
            ("LOGFLARE_NODE_HOST", "127.0.0.1"),
            ("PHX_HTTP_IP", "0.0.0.0"),
            ("LOGFLARE_SINGLE_TENANT", "true"),
            ("LOGFLARE_SUPABASE_MODE", "true"),
            ("POSTGRES_BACKEND_SCHEMA", "_analytics"),
        ],
    )

    kong_public = f"http://{kong_host}:8000"
    railway_set(
        "supabase-studio",
        [
            ("POSTGRES_PASSWORD", PW),
            ("PG_META_CRYPTO_KEY", gv("PG_META_CRYPTO_KEY")),
            ("SUPABASE_PUBLIC_URL", kong_public),
            ("SUPABASE_ANON_KEY", gv("ANON_KEY")),
            ("SUPABASE_SERVICE_KEY", gv("SERVICE_ROLE_KEY")),
            ("AUTH_JWT_SECRET", JWT),
            ("LOGFLARE_PUBLIC_ACCESS_TOKEN", gv("LOGFLARE_PUBLIC_ACCESS_TOKEN")),
            ("LOGFLARE_PRIVATE_ACCESS_TOKEN", gv("LOGFLARE_PRIVATE_ACCESS_TOKEN")),
            ("STUDIO_DEFAULT_ORGANIZATION", "Default"),
            ("STUDIO_DEFAULT_PROJECT", "Default"),
            ("POSTGRES_HOST", db_host),
            ("POSTGRES_DB", "postgres"),
            ("POSTGRES_PORT", "5432"),
            ("PORT", "3000"),
            ("HOSTNAME", "0.0.0.0"),
            ("EDGE_FUNCTIONS_MANAGEMENT_FOLDER", "/app/edge-functions"),
            ("LOGFLARE_URL", f"http://{analytics_host}:4000"),
            ("NEXT_ANALYTICS_BACKEND_PROVIDER", "postgres"),
            ("NEXT_PUBLIC_ENABLE_LOGS", "true"),
            ("STUDIO_PG_META_URL", f"http://{meta_host}:8080"),
            ("SUPABASE_URL", kong_public),
        ],
    )

    railway_set(
        "supabase-kong",
        [
            ("DASHBOARD_USERNAME", gv("DASHBOARD_USERNAME")),
            ("DASHBOARD_PASSWORD", gv("DASHBOARD_PASSWORD")),
            ("SUPABASE_ANON_KEY", gv("ANON_KEY")),
            ("SUPABASE_SERVICE_KEY", gv("SERVICE_ROLE_KEY")),
            ("KONG_DATABASE", "off"),
            ("PORT", "8000"),
            ("KONG_ROUTER_FLAVOR", "traditional_compatible"),
        ],
    )

    if not args.skip_landing and args.landing:
        lp = load_env(args.landing)

        def req(k: str) -> str:
            if k not in lp:
                raise SystemExit(f"landing missing {k}")
            return lp[k]

        pairs = [
            ("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", req("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")),
            ("CLERK_SECRET_KEY", req("CLERK_SECRET_KEY")),
            ("NEXT_PUBLIC_CLERK_SIGN_IN_URL", req("NEXT_PUBLIC_CLERK_SIGN_IN_URL")),
            ("NEXT_PUBLIC_CLERK_SIGN_UP_URL", req("NEXT_PUBLIC_CLERK_SIGN_UP_URL")),
            ("NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL", req("NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL")),
            ("NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL", req("NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL")),
            ("JWT_SECRET", req("JWT_SECRET")),
            ("NEXT_PUBLIC_API_URL", "https://api.commandra.app"),
            ("NEXT_PUBLIC_DASHBOARD_URL", "https://dashboard.commandra.app"),
            ("NEXT_PUBLIC_SITE_URL", "https://commandra.app"),
            ("CLERK_WEBHOOK_SIGNING_SECRET", req("CLERK_WEBHOOK_SIGNING_SECRET")),
            ("COMMANDRA_SYNC_SECRET", req("COMMANDRA_SYNC_SECRET")),
        ]
        railway_set("landing", pairs)

    print("Railway variables updated (--skip-deploys). Redeploy services from Railway or: railway up --service …")


if __name__ == "__main__":
    main()
