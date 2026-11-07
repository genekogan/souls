# Cloud playtests

`tools/playtest/cloud/run-replay.sh` runs a playtest on a dedicated Linux machine: the frozen replay set, one
scenario or one directed cast. It runs against a server branch and commits the results to the `playtest-results`
branch. `cloud/pull-results.sh` brings them back for scoring. See [playtests](playtests.md) for the framework.

## Run

From a clone of this repository:

```sh
bash tools/playtest/cloud/run-replay.sh <server-branch> <out-name> [repeats=1]
PLAYTEST_SCENARIO=tools/playtest/scenarios/<x>.json   bash tools/playtest/cloud/run-replay.sh ...   # one scenario
PLAYTEST_DIRECT=tools/playtest/scenarios/casts/<x>.json bash tools/playtest/cloud/run-replay.sh ...  # one directed cast
```

`<out-name>` may use letters, digits, `.`, `_` and `-`. Rerunning with the same out-name resumes every step. A replay
can take hours, so start it detached when the shell that runs it has a time limit:

```sh
nohup setsid bash tools/playtest/cloud/run-replay.sh main fix-r1 2 > replay-fix-r1.log 2>&1 &
```

## Steps

Everything is created beside the clone, in its parent directory.

1. Check out `origin/<server-branch>` detached in `../server` (a rerun moves it to the branch's current head).
2. `pnpm install --frozen-lockfile` in the clone and in `../server`. Build `../server/apps/web` unless
   `dist/.built-sha` already names that commit.
3. `node tools/playtest/arena/assets-overlay.mjs ../mars-web --server-root ../server` builds the Mars web asset
   overlay from the public site, resumably, with an `overlay-manifest.json` of url, bytes and sha256. It also sets
   `PLAYTEST_MARS_WEB`. A dev world without an overlay would proxy those assets from an origin a sandboxed network may
   not reach.
4. `playtest.mjs preflight --server-root ../server --force-machine` writes `cloud-preflight.json`. The play is skipped
   if preflight is not ok.
5. The play itself is one of:
   - `replay-set --frozen tools/playtest/frozen/frozen.json --repeats N --force-machine`
   - `run $PLAYTEST_SCENARIO` once per repeat
   - `direct $PLAYTEST_DIRECT --headless` once per repeat (the cast's console script plays the console; the verdict is
     in `<run>/director/VERDICT.md`)

   The machine is dedicated, so machine-gate breaches are recorded instead of waited on.
6. `cloud/compress-shots.mjs` converts every PNG to JPEG (≤ 1024 px, q75) and rewrites `.png` references in text files.
7. `CLOUD.md` records the server and playtest commits, toolchain, memory and load before and after, and per-step
   timings.
8. A secret guard scans the results for token-shaped strings and refuses to commit if it finds any. Otherwise the
   results are committed under `results/<out-name>/` on `playtest-results` (an orphan branch on first use) and pushed
   with backoff. Files over 95 MB are left out and listed in `OMITTED-LARGE-FILES.txt`.

Exit codes: the play's own (0 ok, 2 preflight or gate), 3 secret guard, 4 push failed (results stay committed
locally in `../results-branch`).

`PLAYTEST_CLOUD_SKIP=step,step` skips named steps. For example, check the git plumbing from a throwaway clone whose
`origin` is a scratch bare repository:

```sh
PLAYTEST_CLOUD_SKIP=install-playtest,install-server,web-build,overlay,preflight,replay-set \
  bash tools/playtest/cloud/run-replay.sh <branch> <out-name> 1
```

## Environment

Linux with Node 22 (the script adds `--experimental-strip-types` below 22.18), pnpm 10 (installed through corepack if
missing), the global `playwright` module with browsers (`/opt/pw-browsers` is used when present), an authenticated
`claude` CLI, and network access to package registries, the public Souls and asset sites, and the Git remote.
ImageMagick is installed with apt when no image tool exists. Codex is optional: `direct` substitutes a Claude seat
(`PLAYTEST_CODEX_SUBSTITUTE_MODEL`, default `sonnet`) when `codex` is not installed.

`tools/playtest/lib/platform.mjs` holds the platform differences:

- Playwright comes from `PLAYTEST_PLAYWRIGHT_PKG`, then the global `playwright`, then `<server-root>/mars/viewer`.
- Chromium on macOS uses the scenario's GPU setting. On Linux it always runs headless SwiftShader with
  `--no-sandbox --disable-dev-shm-usage`.
- The memory gate reads `vm_stat` on macOS and `MemAvailable` on Linux.
- Thumbnails come from `sips` on macOS, else ImageMagick, else ffmpeg.
- The plan-usage check is skipped when `PLAYTEST_USAGE_PY` points at nothing.

## Frozen bundle

A cloud machine does not have the original run folders, so `tools/playtest/frozen/frozen.json` carries each frozen
run's replay scenario and baseline measures. Rebuild it where the run folders are after the oracles or the frozen set
change, and commit it:

```sh
node tools/playtest/playtest.mjs freeze-bundle --runs-root <runs-dir> [--baseline <replay-set-dir>]
```

`--baseline` stores a previous replay set's measures per label. `replay-set` then prefers them over the original
runs (scripted replay against scripted replay), and the scorecard names the baseline used for each run.

## Pull results

```sh
bash tools/playtest/cloud/pull-results.sh <out-name> <dest-root> [<baseline-out-name>]
```

This extracts `results/<out-name>` from `origin/playtest-results` into `<dest-root>/<out-name>`. With a baseline
(already pulled), it rescores with `replay-set --score-only` and writes `SCORECARD-vs-<baseline>.md`.
