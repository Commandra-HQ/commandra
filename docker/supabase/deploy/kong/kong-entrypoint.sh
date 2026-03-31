#!/bin/bash
set -euo pipefail
export KONG_DECLARATIVE_CONFIG="${KONG_DECLARATIVE_CONFIG:-/usr/local/kong/declarative/kong.yml}"
mkdir -p "$(dirname "$KONG_DECLARATIVE_CONFIG")"
# Stale sockets after OOM/unclean exit confuse the next start and can loop restarts.
rm -rf /usr/local/kong/sockets 2>/dev/null || true
mkdir -p /usr/local/kong/sockets

export LUA_AUTH_EXPR="\$((headers.authorization ~= nil and headers.authorization:sub(1, 10) ~= 'Bearer sb_' and headers.authorization) or headers.apikey)"
export LUA_RT_WS_EXPR="\$(query_params.apikey)"
awk '{
  result = ""
  rest = $0
  while (match(rest, /\$[A-Za-z_][A-Za-z_0-9]*/)) {
    varname = substr(rest, RSTART + 1, RLENGTH - 1)
    if (varname in ENVIRON) {
      result = result substr(rest, 1, RSTART - 1) ENVIRON[varname]
    } else {
      result = result substr(rest, 1, RSTART + RLENGTH - 1)
    }
    rest = substr(rest, RSTART + RLENGTH)
  }
  print result rest
}' /home/kong/temp.yml > "$KONG_DECLARATIVE_CONFIG"
sed -i '/^[[:space:]]*- key:[[:space:]]*$/d' "$KONG_DECLARATIVE_CONFIG"
exec /entrypoint.sh kong docker-start
