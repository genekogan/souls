#!/usr/bin/env bash
# The guarded activation, run on the release host by ship.sh: bash -s -- <args> < host-activate.sh
# Everything it needs is a positional argument. It runs under the host's environment, so it must not read a variable
# that only the operator's machine sets (the 4.15 run stopped on exactly that).
# On a failed reload or health check it rolls code back to the previous build and exits non-zero. Data is never touched.
set -euo pipefail
root=$1; data=$2; conf=$3; unit=$4; origin=$5; build=$6; previous=$7; manifest=$8; worlds=$9; config=${10}
rel=$root/releases/$build; old=$root/releases/$previous
[ "$(readlink "$root/production")" = "$old" ] || { echo 'the stage link is not the expected previous release' >&2; exit 80; }
[ "$(sha256sum "$rel/RELEASE-MANIFEST.json" | cut -d' ' -f1)" = "$manifest" ] || { echo 'host manifest differs from the upload' >&2; exit 80; }
[ "$(sha256sum "$conf" | cut -d' ' -f1)" = "$config" ] || { echo 'host config changed since the snapshot' >&2; exit 80; }
mainpid=$(systemctl show -p MainPID --value "$unit")
node --input-type=module - "$data" "$mainpid" "$old" "$previous" <<'JS'
import fs from 'node:fs'; import crypto from 'node:crypto';
const [data, pid, old, previous] = process.argv.slice(2);
const k = JSON.parse(fs.readFileSync(`${data}/keeper.json`, 'utf8'));
if (String(k.keeper?.pid) !== pid || !(Number(pid) > 1)) throw Error('live keeper pid mismatch');
const sha = crypto.createHash('sha256').update(fs.readFileSync(`${old}/tools/world-launcher/keeper.mjs`)).digest('hex');
if (k.keeper?.sha !== sha || k.active?.build !== previous) throw Error('keeper, source or active build drifted');
if (k.handover && !['done', 'failed', 'rolled-back'].includes(k.handover.state)) throw Error('another handover is active');
JS
rollback_on_error() {
  rc=$?; trap - EXIT INT TERM HUP
  if [ "$rc" != 0 ]; then
    echo "activation or health failed ($rc): code-only rollback to $previous; data and settings kept" >&2
    target=$(readlink "$root/production")
    if [ "$target" = "$rel" ]; then bash "$old/tools/world-launcher/deploy/activate.sh" production "$old" --reload || exit 90
    elif [ "$target" != "$old" ]; then echo 'unexpected active target: no further change' >&2; exit 91; fi
  fi
  exit "$rc"
}
trap rollback_on_error EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
bash "$rel/tools/world-launcher/deploy/activate.sh" production "$rel" --reload
curl -fsS --max-time 20 "$origin/__sim/healthz" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x["ok"] and x["build"]==sys.argv[1] and x["worlds"]==int(sys.argv[2]) and x["hostOk"]' "$build" "$worlds"
[ "$(systemctl show -p MainPID --value "$unit")" = "$mainpid" ]
[ "$(sha256sum "$conf" | cut -d' ' -f1)" = "$config" ]
trap - EXIT INT TERM HUP
echo "activated $build"
