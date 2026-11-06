# Remote gate

The release gate runs the full CPU test contract on [Modal](https://modal.com) containers, compares the candidate
with a baseline and writes a receipt. Nothing runs locally except `git archive` and the Modal client. The gate
never merges, pushes or deploys. A release attaches its receipt; see [release](../release.md).

Requirements: `pip install modal && modal token new`, and a committed checkout (only committed files are shipped).

## The contract

| Step | Covers |
| --- | --- |
| V1 | workspace type checks |
| V2 | both web builds (root base and `/worlds/` base) |
| V3 | package test trees, native Mars engine, client CLI, launcher unit tests, harness self-tests, walk audit, bundle checks |
| V4 | web unit tests, including TSX |
| V5 | recursive server tests |
| V6 | fake-mind API scenarios: god, Souls, party, joins (Clerk and dev auth), two-Soul Mars and Little Martians |
| V7 | real-Chrome walks (GPU); run separately with `v7-walks.sh` |
| V8 | local production-history boots; never leaves the machine that holds the data |

`REQUIRED_STEPS` in `tools/test-harness/release-gate.mjs` is the exact list of step ids. V7 and V8 are excluded
from the CPU gate.

## `release-gate.sh`

```sh
tools/test-harness/release-gate.sh <candidate-ref> [--baseline <ref>] [--out <dir>] [--node 22|26]
    [--scope full|auto] [--cache <dir> | --no-cache] [--dry-run]
    [--baseline-results <dir> [--candidate-results <dir>]] [--baseline-bundle-carry <cache-dir>]
tools/test-harness/release-gate.sh cache-add <completed-run-dir> [--cache <dir>]
```

The gate pins the baseline (default `main`), the candidate and the invoking checkout's harness
(`tools/test-harness`). Both source archives get the identical committed harness. A dirty harness blocks. The gate
prints one `RELEASE_GATE` line and writes `receipt.json` to `--out` (default `.lane/release-gate/<timestamp>`). The
receipt holds source, harness, archive and quarantine hashes, actual Node and pnpm versions, raw-log hashes, and the
fixed, quarantined and new failures. It never overwrites an output directory that already holds a receipt.

- Exit 1: `blocked`.
- Exit 0: `pass`, `quarantined` (only known, listed failures; inspect them before shipping) or `not-gated`.
- `--dry-run` prints the plan (refs, scope, cache hit or miss, Modal runs) without contacting Modal or writing.

### What blocks

- A failure not listed in `quarantine.json`, even one added to the list in the same change.
- Missing steps or logs, cancellations, timeouts (each V5 shard has a fixed time envelope).
- Changed skips or TODOs, removed baseline assertions (unless a reviewed [rename](#renames) is satisfied), test files
  that fail to load, dropped V6 scenarios.

Failures are identified by raw TAP leaf ids, so a second failure in an already failing file cannot hide.

### Quarantine

`tools/test-harness/quarantine.json` lists every retained failure, skip and TODO with its step, exact test id,
status, reason and owner. Add an entry only for a known, explained failure; remove it when the test is fixed (the
receipt reports it as fixed).

### Renames

`tools/test-harness/renames.json` lists reviewed renames and replacements of baseline assertions, with the same
discipline as the quarantine. Each entry has `step`, `from` (the baseline's test id exactly as the receipt prints it:
package prefix and ` > `-joined ancestors for a nested test, `\#` for a `#`), `to` (the replacement
id, or a list of ids when one assertion became several), `reason` and `pr` (`#<number>`). The gate validates it
strictly: a known step, never a V6 scenario step, non-empty fields and one entry per step and `from`.

A baseline id that is gone from the candidate counts as `renamed`, not removed, only when every `to` id is new (absent
from the baseline) and ran and passed in the candidate's same step. If a replacement is missing, failing, skipped or
TODO, or already ran in the baseline, the id stays under `removed` with `rename.notPassing` or `rename.inBaseline`
naming it, and the gate still blocks. Several old ids may name the same new replacement (tests merged into one). Anything unlisted blocks as before. The receipt lists
`renamed` and records `renamesSha256` beside `quarantineSha256`.

Add an entry in the PR that renames or replaces the test, or when a gate reports the removal, citing the PR that made
it. An entry whose `from` still runs has no effect, and because a replacement must be absent from the baseline, an old
entry cannot later excuse deleting a test that happens to reuse its `from` name. `renames.json` executes nowhere, but like `quarantine.json` it stays in the suite tree, so changing it re-runs
the baseline once.

### Scope

`--scope full` (default) runs the whole contract. Only full gates qualify a release or fill the cache.

`--scope auto` picks steps from `git diff --name-only <baseline> <candidate>` using `SCOPE_RULES`:

| Changed path | Steps |
| --- | --- |
| `apps/server/` | V1, V3-packages, V3-walk, V5, V6 |
| `apps/web/` | V1, V2, V3-bundle, V4 |
| `packages/` | V1, V3-packages, V3-mars-engine, V3-walk, V5 |
| `tools/world-launcher/` | V3-launcher-unit, V6 |
| `tools/edge-skill/`, `tools/client-eval/` | V3-client-cli |
| `tools/god-skill/` | V6 |
| other `tools/`, `docs/`, root `*.md`, `LICENSE` | none |
| anything else (lockfile, `mars/`, `worlds/`, `vendor/`, `e2e/`, `.github/`, root files) | full contract |

If nothing maps to a step, the gate exits 0 with status `not-gated` and makes no Modal call. A scoped run executes
only its steps against the full baseline and never enters the cache.

### Baseline cache

The baseline is not re-run when the cache holds a validated run of it. The cache key is
`<baselineSha>-<suiteTree>-node<major>`. `suiteTree` hashes the `tools/test-harness` entries that execute inside the
containers, leaving out the driver-only files (`DRIVER_ONLY` in `release-gate.mjs`). A driver change therefore does
not invalidate cached baselines. A hit requires unchanged file hashes and a complete, matching run. If the candidate
runs a different Node or pnpm version than the cached run, the baseline is re-run. A miss runs the baseline once
beside the candidate and caches it when it validates. Every passing full gate caches its candidate, which becomes the
next gate's baseline once it is on `main`.

The cache directory comes from `--cache`, else `SIM_GATE_CACHE`, else `.lane/gate-cache` in the checkout.
`--no-cache` disables reads and writes. `cache-add <run-dir>` seeds the cache from a passed gate's `candidate`
directory or from a bare `remote-suite.sh` run, after validating the same identity an import requires.

### Imports

`--baseline-results <dir>` imports a completed baseline run (same harness tree, Node and pnpm, complete contract)
and runs only the candidate. Adding `--candidate-results <dir>` imports a completed pair, which must share the exact
harness commit, tree and archive. Runs restricted with `--server-files` or `--skip` never qualify a release.

## Revalidate retained results without a new gate

`--no-remote` refuses every planned Modal call before execution, including any baseline fallback. Use it when
checking transferred evidence or preparing a release without authorization for a new gate. It does not reserve a
budget slot, create a shared cache, waive failures or qualify another source commit.

Transfer the complete original gate directory (`receipt.json`, `baseline/out/`, `candidate/out/`, raw suite logs
and metadata), preserving the original evidence. Keep the original harness/source commits available locally.
From a clean tooling checkout, name the **original gate harness commit**, candidate and baseline explicitly:

```sh
tools/test-harness/release-gate.sh "$CANDIDATE" --baseline "$ACTUAL_BASELINE" \
  --baseline-results "$RETAINED_GATE/baseline" --candidate-results "$RETAINED_GATE/candidate" \
  --no-remote --results-harness "$ORIGINAL_HARNESS" --no-cache --out "$NEW_REVALIDATION_DIR"
```

This writes a separate comparison receipt and rechecks the full raw contract; a copied summary alone is insufficient.
Mismatched source/harness/runtime, incomplete logs or failed assertions remain blocked. If the original gate used a
cached baseline, transfer that baseline's complete `out/` directory to the explicit baseline-results path instead;
never substitute a tag with an author-rewritten SHA or edit execution metadata to make it match.
The receipt retains the original harness identity. `--results-harness` requires both imports and `--no-remote`;
it cannot select a different harness for a new execution. A new candidate requires its own qualification.

A validated retained run can seed a cache with `release-gate.sh cache-add <completed-run-dir> --cache <cache-dir>`.
Cache seeding is local validation, not cross-host once-per-head or daily-budget accounting. Revalidating CPU results
also leaves V7 and the live release proof outstanding; combine the exact-source V7 receipt below.

## V7 and the ship receipt

From a clean checkout of the same candidate commit:

```sh
tools/test-harness/v7-walks.sh <out>-v7          # prints RELEASE_GATE_V7, writes v7-receipt.json
node tools/test-harness/ship-receipt.mjs <out>/receipt.json <out>-v7/v7-receipt.json   # writes ship-receipt.json
```

`v7-walks.sh` builds the web app (or installs prebuilt release bundles from `SIM_PREBUILT_WEB_ROOT`, verified by
the same checker the release uses). It needs a real GPU Chrome, the Mars web asset overlay in `.lane/mars-web`, and
free ports 5870–5879. It walks the existing worlds, a launcher-created world, the God modal, and the two approval
flows (approval link stays on top; in-window approval).

`ship-receipt.mjs` combines the two receipts. The result has the gate's status only when the V7 source equals the
gate's candidate, the V7 checkout was clean, every V7 check passed, the gate was not blocked and its scope was
`full`. Otherwise it is `blocked` (exit 1). It records both input hashes and the remaining exclusion (V8).

## `remote-suite.sh` (raw runner)

```sh
tools/test-harness/remote-suite.sh <outDir> [--ref HEAD] [--baseline-ref main|none] [--harness-ref HEAD]
    [--skip V7,V8] [--node 22] [--only <steps>] [--server-files "<files>"]
```

It ships `git archive <ref>` (plus the baseline for V4's failure-set comparison) and the committed harness to
`modal_suite.py`, which builds a `node:<version>-bookworm` image with pinned pnpm. Each container runs
`pnpm install --frozen-lockfile` and `one-validation.sh` with V7 and V8 skipped. Frozen fixtures also get a Git
object pack with exactly the historical source files they declare (`historical-inputs.mjs`). The ref's
`pnpm-lock.yaml` keys a prebuilt dependency layer, so an unchanged lockfile installs offline from it.

The steps run as groups in parallel containers (`GROUPS`, `LARGE`, `V5_SHARDS` in `modal_suite.py`): one larger
container for the builds and web tests, one task for the long serial steps and four shorter V5 tasks. The small
tasks keep one 4-CPU container for the serial steps and two 4-CPU containers for queued V5 tasks; the larger container
has its separate one-container cap. Increasing the task count does not increase simultaneous resources.
`merge()` rebuilds the serial output layout
and retains each group's preflight and assets diagnostics. A missing group or shard, a duplicated row, an unexpected
file collision or an inexact shard cover fails closed. V5 shards
are balanced by `v5-durations.json`; after large test changes, regenerate it from a run's
`out/groups/v5-*/V5-server-full-files.jsonl` and check the split with `node tools/test-harness/v5-shard.mjs`.
The V5 summary's seconds column reports the longest task, not elapsed time across queued waves; each task's
duration remains in its group summary, and the Modal log records the full run's elapsed time.

Results: `<outDir>/out/suite/SUMMARY.tsv` and one log per step, install logs in `<outDir>/out/`, per-group output in
`<outDir>/out/groups/<name>/`, the Modal client log in `<outDir>/modal.log`. The raw runner returns artifacts even
for failing assertions; use `release-gate.sh` to judge a release.

Useful bounded runs:

```sh
# install + preflight only
tools/test-harness/remote-suite.sh <out> --baseline-ref none --skip V1,V2,V3,V4,V5,V6,V7,V8
# reproduce specific server test files
tools/test-harness/remote-suite.sh <out> --server-files "src/foo.test.ts" --skip V1,V2,V3,V4,V6,V7,V8
```

Run V7 or V8 locally with `tools/test-harness/one-validation.sh <out> --skip V1,V2,V3,V4,V5,V6`.

Modal spend rules (one full gate per release head, cached baselines) are in
[modal policy](../process/modal-policy.md).
