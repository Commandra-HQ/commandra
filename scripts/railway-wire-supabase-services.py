#!/usr/bin/env python3
"""Drive `railway environment edit` through a PTY for non-TTY environments."""
from __future__ import annotations

import os
import pty
import select
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Railway CLI reads ~/.railway/config.json; do not pass RAILWAY_TOKEN (format differs).
env = {**os.environ}


def run_edit(service: str, config_relpath: str, message: str) -> int:
    args = [
        "environment",
        "edit",
        "-m",
        message,
        "--service-config",
        service,
        "configFile",
        config_relpath,
        "--service-config",
        service,
        "source.repo",
        "Commandra-HQ/commandra",
        "--service-config",
        service,
        "source.branch",
        "main",
    ]

    pid, master = pty.fork()
    if pid == 0:
        os.chdir(ROOT)
        os.execvpe("railway", ["railway", *args], env)

    buf = b""
    deadline = time.time() + 180
    applied = False
    picked_env = False
    try:
        while time.time() < deadline:
            pid0, st0 = os.waitpid(pid, os.WNOHANG)
            if pid0 == pid:
                return os.WEXITSTATUS(st0) if os.WIFEXITED(st0) else 1
            r, _, _ = select.select([master], [], [], 0.25)
            if r:
                chunk = os.read(master, 65536)
                if not chunk:
                    break
                buf += chunk
                sys.stderr.buffer.write(chunk)
                sys.stderr.buffer.flush()
            text = buf.decode(errors="replace")
            low = text.lower()
            if not picked_env and "> environment" in low:
                os.write(master, b"\n")
                picked_env = True
            if not applied and "apply changes now?" in low:
                os.write(master, b"y\n")
                applied = True
        pid_, st = os.waitpid(pid, 0)
        return os.WEXITSTATUS(st) if os.WIFEXITED(st) else 1
    finally:
        try:
            os.close(master)
        except OSError:
            pass


def main() -> None:
    services = [
        ("supabase-db", "/docker/supabase/deploy/railway/supabase-db/railway.toml"),
        ("supabase-supavisor", "/docker/supabase/deploy/railway/supabase-supavisor/railway.toml"),
        ("supabase-meta", "/docker/supabase/deploy/railway/supabase-meta/railway.toml"),
        ("supabase-analytics", "/docker/supabase/deploy/railway/supabase-analytics/railway.toml"),
        ("supabase-studio", "/docker/supabase/deploy/railway/supabase-studio/railway.toml"),
        ("supabase-kong", "/docker/supabase/deploy/railway/supabase-kong/railway.toml"),
    ]
    for name, cf in services:
        print(f"\n=== {name} ===", file=sys.stderr)
        code = run_edit(name, cf, f"wire {name} (monorepo + Dockerfile)")
        if code != 0:
            sys.exit(code)
    print("\nOK: all supabase services configured.", file=sys.stderr)


if __name__ == "__main__":
    main()
