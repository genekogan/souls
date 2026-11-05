#!/bin/bash
# Row-verified compact copy of every world + registry; preserve all rows for rollback.
# Usage: compact-backup.sh <label> [production|legacy] (default production)
set -euo pipefail
L="$1"; STAGE="${2:-production}"; D=/srv/sim-worlds-data/$STAGE
case "$L" in ''|*[!A-Za-z0-9_-]*) echo 'invalid backup label'; exit 2;; esac
case "$STAGE" in production|legacy) ;; *) echo 'invalid backup stage'; exit 2;; esac
COPY="$(cd "$(dirname "$0")" && pwd)/compact-copy.py"
[ -f "$COPY" ] || { echo 'missing reviewed compact-copy.py'; exit 1; }
mkdir -p /srv/sim-worlds-data/release-backups
B="$(mktemp -d "/srv/sim-worlds-data/release-backups/$L-$STAGE-$(date -u +%Y%m%d-%H%M%S)-XXXXXX")"
mkdir -p "$B/worlds" "$B/forks"
for w in "$D"/worlds/*/; do s=$(basename "$w"); [ -f "$w/sim.db" ] || continue; mkdir -p "$B/worlds/$s"; python3 "$COPY" "$w/sim.db" "$B/worlds/$s/sim.db" --keep-takes; done
for f in accounts.sqlite body-collections.sqlite forks/accounts.sqlite; do [ -f "$D/$f" ] && python3 "$COPY" "$D/$f" "$B/$f" --keep-takes; done
[ -f "$D/worlds.json" ] && cp "$D/worlds.json" "$B/" || true
chown -R simworlds:simworlds "$B"; chmod -R go-rwx "$B"; du -sh "$B"; echo "$B"
