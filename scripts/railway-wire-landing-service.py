#!/usr/bin/env python3
import os
import pty
import select
import sys
import time

env = {**os.environ}

args = [
    "environment",
    "edit",
    "-m",
    "wire landing GitHub + railway.toml",
    "--service-config",
    "landing",
    "configFile",
    "/railway.toml",
    "--service-config",
    "landing",
    "source.repo",
    "Commandra-HQ/landing-page",
    "--service-config",
    "landing",
    "source.branch",
    "main",
]

pid, master = pty.fork()
if pid == 0:
    os.chdir("/Users/jayeshsadhwani/projects/commandra-hq/commandra")
    os.execvpe("railway", ["railway", *args], env)

buf = b""
deadline = time.time() + 120
applied = False
while time.time() < deadline:
    pid0, st0 = os.waitpid(pid, os.WNOHANG)
    if pid0 == pid:
        sys.exit(os.WEXITSTATUS(st0) if os.WIFEXITED(st0) else 1)
    r, _, _ = select.select([master], [], [], 0.25)
    if r:
        chunk = os.read(master, 65536)
        if not chunk:
            break
        buf += chunk
        sys.stderr.buffer.write(chunk)
        sys.stderr.buffer.flush()
    low = buf.decode(errors="replace").lower()
    if "> environment" in low and b"\n" not in buf[-5:]:
        os.write(master, b"\n")
    if not applied and "apply changes now?" in low:
        os.write(master, b"y\n")
        applied = True

st = os.waitpid(pid, 0)[1]
sys.exit(os.WEXITSTATUS(st) if os.WIFEXITED(st) else 1)
