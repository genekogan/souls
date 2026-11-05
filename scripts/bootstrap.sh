#!/usr/bin/env bash
# Provider-neutral checkout bootstrap. Any executor's setup step can run it from a checkout of this repository
# (a Claude or Codex cloud environment, a CI runner, a fresh clone); provider hooks are thin wrappers around it.
#   - pnpm install --frozen-lockfile when the lockfile or package.json files changed since the last successful install
#   - pnpm assets:pull when tools/assets/manifest.json changed since the last successful pull (skip with --no-media)
# Node and pnpm come from the executor's image. Output is a few lines; full logs go to $TMPDIR. A failed step is
# reported and leaves no stamp, so the next run retries it; the script still exits 0 so a session always starts.
#
#   scripts/bootstrap.sh [--no-media]
set -uo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 0

media_wanted=1
for arg in "$@"; do [ "$arg" = --no-media ] && media_wanted=0; done

log="${TMPDIR:-/tmp}/sim-session-start.log"
state=node_modules/.cache/sim-session-start
if command -v sha256sum >/dev/null 2>&1; then hash() { sha256sum; }; else hash() { shasum -a 256; }; fi
fingerprint() { git ls-files -s -- "$@" 2>/dev/null | hash | cut -c1-16; }
stamp() { cat "$state/$1" 2>/dev/null; }
limit() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }

deps=$(fingerprint pnpm-lock.yaml package.json '*/package.json' '*/*/package.json')
if [ ! -d node_modules ] || [ "$(stamp deps)" != "$deps" ]; then
  if pnpm install --frozen-lockfile >"$log" 2>&1; then
    mkdir -p "$state" && echo "$deps" > "$state/deps"; echo "bootstrap: dependencies installed"
  else
    echo "bootstrap: pnpm install --frozen-lockfile FAILED (log: $log)"; tail -5 "$log"
  fi
fi

media=$(fingerprint tools/assets/manifest.json)
if [ "$media_wanted" = 1 ] && [ -f tools/assets/manifest.json ] && [ "$(stamp media)" != "$media" ]; then
  if limit 480 pnpm assets:pull --quiet >>"$log" 2>&1; then
    mkdir -p "$state" && echo "$media" > "$state/media"; echo "bootstrap: media pulled"
  else
    echo "bootstrap: pnpm assets:pull failed or timed out (log: $log); media-dependent tests will fail until it succeeds"
  fi
fi
exit 0
