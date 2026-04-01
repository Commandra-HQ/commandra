#!/usr/bin/env bash
# Concatenate apps/api/drizzle/*.sql in journal order (for pasting into SQL editor
# or running with psql when railway ssh cannot run migrate.js — e.g. no api service).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
J="$ROOT/apps/api/drizzle/meta/_journal.json"
DIR="$ROOT/apps/api/drizzle"
if [[ ! -f "$J" ]]; then
	echo "Missing $J" >&2
	exit 1
fi
while IFS= read -r tag; do
	f="$DIR/${tag}.sql"
	if [[ ! -f "$f" ]]; then
		echo "Missing migration file for tag $tag: $f" >&2
		exit 1
	fi
	printf '\n-- %s\n' "$tag"
	cat "$f"
done < <(grep -o '"tag": "[^"]*"' "$J" | sed 's/.*"tag": "\([^"]*\)".*/\1/')
