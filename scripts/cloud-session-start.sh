#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json) for Claude Code cloud sessions. Does nothing on a local machine.
# A thin wrapper: the checkout bootstrap itself (locked install, media pull, skipped when unchanged) is the
# provider-neutral scripts/bootstrap.sh, which other executors run directly.
#   - PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers for the session when that directory exists
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

if [ -d /opt/pw-browsers ]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers" >> "$CLAUDE_ENV_FILE"
fi

exec bash "$root/scripts/bootstrap.sh"
