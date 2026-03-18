#!/bin/bash
# Use a subdirectory for PGDATA so Fly volume mount (which contains lost+found) works.
# See: initdb "directory exists but is not empty - Create a subdirectory under the mount point"
set -e
VOL_DIR="/var/lib/postgresql/vol"
PGDATA_DIR="${VOL_DIR}/pgdata"
mkdir -p "$PGDATA_DIR"
chown -R postgres:postgres "$VOL_DIR"
export PGDATA="$PGDATA_DIR"

# Supabase image runs postgres -D /etc/postgresql; we need -D $PGDATA so replace it in args
args=()
while [ $# -gt 0 ]; do
  if [ "$1" = "-D" ] && [ "$2" = "/etc/postgresql" ]; then
    args+=(-D "$PGDATA_DIR")
    shift 2
  else
    args+=("$1")
    shift
  fi
done
# So Fly TCP health check can reach Postgres (default is 127.0.0.1 only)
args+=(-c "listen_addresses=*")
exec /usr/local/bin/docker-entrypoint.sh "${args[@]}"
