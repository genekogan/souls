#!/usr/bin/env bash
# Set up N self-hosted GitHub Actions runner instances for this repository on one Linux host, each a systemd service
# running as one dedicated unprivileged user, with the label the CI's heavy jobs ask for (CI_HEAVY_RUNNER, docs/testing.md).
#
# Run it ON the runner host as root. It is idempotent: an instance that is already registered is only (re)started, and
# the user, packages and runner download are reused. Nothing here names a host, user or address: pass them in.
#
#   sudo bash tools/ci/setup-runners.sh --token <registration token> [--count 4] [--user <runner user>] \
#        [--label souls-ci] [--prefix souls-ci] [--repo genekogan/souls] [--root /opt] [--version <x.y.z>] [--no-playwright]
#
# From a workstation, without copying the file there (the token is minted with your gh login, valid for one hour):
#
#   TOKEN=$(gh api -X POST repos/<owner>/<repo>/actions/runners/registration-token --jq .token) && \
#     ssh <runner-host> "sudo bash -s -- --token $TOKEN --count 4 --user <runner user>" < tools/ci/setup-runners.sh
#
# One instance runs one job at a time, so --count is the number of parallel heavy CI legs the host takes on.
set -euo pipefail

TOKEN="" COUNT=4 RUNNER_USER="ci-runner" LABEL="souls-ci" PREFIX="souls-ci" REPO="genekogan/souls" ROOT="/opt" VERSION="" PLAYWRIGHT=1
# The Playwright the repository locks (pnpm-lock.yaml); its install-deps knows each supported OS's package names.
PLAYWRIGHT_VERSION="1.64.1"

usage() { sed -n '2,16p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; }
die() { echo "setup-runners: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --count) COUNT="${2:-}"; shift 2 ;;
    --user) RUNNER_USER="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --no-playwright) PLAYWRIGHT=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (--help lists them)" ;;
  esac
done

[ -n "$TOKEN" ] || die "--token is required (gh api -X POST repos/$REPO/actions/runners/registration-token --jq .token)"
[[ "$COUNT" =~ ^[1-9][0-9]?$ ]] || die "--count must be 1-99"
[[ "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "--user must be a plain user name"
[[ "$PREFIX" =~ ^[A-Za-z0-9_-]+$ && "$LABEL" =~ ^[A-Za-z0-9_-]+$ ]] || die "--prefix and --label: letters, digits, - and _"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "--repo must be owner/name"
[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash $0 ...)"
[ "$(uname -s)" = Linux ] || die "Linux only"
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) die "unsupported CPU $(uname -m)" ;; esac

# ---- the OS, first: it decides whether Playwright's browser packages can be installed at all
. /etc/os-release
OS="${ID:-unknown}-${VERSION_ID:-unknown}"
echo "== host: ${PRETTY_NAME:-$OS}, $(nproc) cores, load $(cut -d' ' -f1-3 /proc/loadavg)"
command -v apt-get >/dev/null || die "apt-based systems only (Debian or Ubuntu)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates tar git jq >/dev/null

# ---- the dedicated runner user: unprivileged, no sudo
if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  echo "== creating user $RUNNER_USER"
  useradd --create-home --shell /bin/bash "$RUNNER_USER"
fi
if id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -qxE 'sudo|wheel|admin'; then
  echo "warning: $RUNNER_USER is in an admin group; CI jobs run as this user" >&2
fi

# ---- Playwright's system packages for Chromium (the browser legs)
if [ "$PLAYWRIGHT" = 1 ]; then
  case "$OS" in
    ubuntu-22.04|ubuntu-24.04|debian-12|debian-13)
      echo "== Playwright $PLAYWRIGHT_VERSION system packages for Chromium ($OS)"
      if command -v npx >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; then
        npx -y "playwright@$PLAYWRIGHT_VERSION" install-deps chromium
      else
        # no Node on the host: the same set install-deps uses for Chromium, by name (24.04 and Debian 13 use the t64 names)
        pkgs=(libnss3 libnspr4 libdbus-1-3 libdrm2 libgbm1 libxkbcommon0 libx11-6 libxcb1 libxcomposite1 libxdamage1
              libxext6 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 fonts-liberation fonts-noto-color-emoji)
        for p in libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libglib2.0-0; do
          if apt-cache show "${p}t64" >/dev/null 2>&1; then pkgs+=("${p}t64"); else pkgs+=("$p"); fi
        done
        apt-get install -y -qq "${pkgs[@]}" >/dev/null
      fi ;;
    ubuntu-20.04)
      echo "warning: Playwright $PLAYWRIGHT_VERSION has no system-package list for Ubuntu 20.04; skipping it." >&2
      echo "         Browser legs stay on GitHub-hosted runners (ci.yml keeps them there); upgrade the OS to add them." >&2 ;;
    *)
      echo "warning: Playwright packages are not known for $OS; skipping them (--no-playwright silences this)." >&2 ;;
  esac
fi

# ---- the runner release
if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name)"
  VERSION="${VERSION#v}"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not resolve the runner version ($VERSION); pass --version"
CACHE="$ROOT/.actions-runner-cache"
TARBALL="$CACHE/actions-runner-linux-$ARCH-$VERSION.tar.gz"
mkdir -p "$CACHE"
if [ ! -s "$TARBALL" ]; then
  echo "== downloading actions/runner $VERSION ($ARCH)"
  curl -fsSL -o "$TARBALL.part" "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-$ARCH-$VERSION.tar.gz"
  mv "$TARBALL.part" "$TARBALL"
fi

# the directory of an instance already registered under this name, wherever an earlier setup put it
registered_dir() {
  local f
  for f in "$ROOT"/*/.runner; do
    [ -f "$f" ] || continue
    if tr -d '\r\357\273\277' < "$f" | jq -e --arg n "$1" '.agentName == $n' >/dev/null 2>&1; then dirname "$f"; return 0; fi
  done
  return 1
}

DEPS_DONE=0
for i in $(seq 1 "$COUNT"); do
  NAME="$PREFIX-$i"
  if DIR="$(registered_dir "$NAME")"; then
    echo "== $NAME: already registered in $DIR"
  else
    DIR="$ROOT/actions-runner-$NAME"
    echo "== $NAME: installing in $DIR"
    mkdir -p "$DIR"
    tar -xzf "$TARBALL" -C "$DIR"
    if [ "$DEPS_DONE" = 0 ]; then "$DIR/bin/installdependencies.sh" >/dev/null; DEPS_DONE=1; fi
    chown -R "$RUNNER_USER:$RUNNER_USER" "$DIR"
    ( cd "$DIR" && runuser -u "$RUNNER_USER" -- ./config.sh --unattended --url "https://github.com/$REPO" --token "$TOKEN" \
        --name "$NAME" --labels "$LABEL" --work _work --replace )
  fi
  # a systemd service per instance (actions.runner.<owner>-<repo>.<name>.service), running as the runner user
  ( cd "$DIR"
    if [ ! -f .service ]; then ./svc.sh install "$RUNNER_USER" >/dev/null; fi
    ./svc.sh start >/dev/null
    systemctl is-active --quiet "$(cat .service)" && echo "   service $(cat .service): active" || echo "   service $(cat .service): NOT active" >&2 )
done

echo "== done: $COUNT instance(s) labelled $LABEL for $REPO. Check them with:"
echo "   gh api repos/$REPO/actions/runners --jq '.runners[] | \"\\(.name) \\(.status) busy=\\(.busy)\"'"
