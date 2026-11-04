# Browser end-to-end checks

Markdown scenarios in `e2e/scenarios/` drive the app in headless Chromium from an explicit browser cache, never a
signed-in browser profile. `e2e/config.mjs` holds the paths, the client fixture's reserved ports and the attempt cap.

Install Chromium into the workspace cache first:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" pnpm --filter mars-campus-viewer exec playwright install chromium
```

## Local smoke

`local-smoke.md` is the quick proof that the app works: one command boots an isolated instance on a free port, opens
the world list and one world, and checks that a person is drawn with no console errors and no failed requests. Any
agent, laptop, cloud session or CI runner can run it; it takes about 30 seconds after the builds.

```sh
pnpm install --frozen-lockfile
pnpm assets:pull --set web,runtime
PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" pnpm --filter mars-campus-viewer exec playwright install chromium
node e2e/local-smoke.mjs --build                 # any free port; or --port 9950, or E2E_PORT=9950
node e2e/local-smoke.mjs --port 9950 --clip      # also one uncut, real-speed clip of the whole run
```

- **Isolated.** It runs the world launcher (`tools/world-launcher/launcher.mjs`) on the port and its one world on the
  next two ports, with fake minds, dev sign-in and a data dir under the run directory. It creates a `hello-hamlet`
  world as `dev:smoke` and one Soul, Ada. It refuses ports reserved in `e2e/config.mjs`, and ports in use.
- **Checks**, step by step: the launcher answers healthy; the world list shows the world's card; clicking it opens
  the world, whose canvas has a live WebGL context and draws Ada's figure (a skinned person rig) with no "could not be
  prepared" notice; Explore → "Ada" → Enter follows her into the frame. Each step fails on any console error, page
  error, failed request or HTTP error. Requests the page cancels itself (`net::ERR_ABORTED`, an AbortController
  superseding a fetch) are listed as `cancelledRequests` and don't fail it.
- **Output** in `.local/e2e/<UTC timestamp>/` (`--out` to choose): `summary.json` (status, commit, port, PIDs, timings,
  every assertion, every error and failed request, teardown), `shots/1-world-list.png`, `2-world.png`,
  `3-person.png`, `launcher.log`, and with `--clip` `clip.mp4` (`clip.webm` without ffmpeg).
- **Teardown** always: it closes the browser and stops the launcher and its world by their exact PIDs, and records
  in the summary that both are gone. The data dir is removed after a pass (`--keep-data` keeps it).
- **Exit** 0 pass, 1 a check failed, 2 a precondition is missing: the message names the command that fixes it
  (`--build` builds the web app and the viewer's static build when they are missing).
- **People need the served character kit.** Preflight checks the selected `--mars-web` directory, otherwise the
  launcher's `.lane/mars-web` overlay, otherwise `MARS_WEB_DIR` or the viewer build. It checks the kit manifest and
  character animation file before launch. A valid viewer build does not repair an incomplete selected overlay.
  Pass `--mars-web <complete-isolated-overlay>` to select an already prepared overlay without changing the shared
  pointer. The V7 helper shows how it combines shared static assets with this checkout's modular assets. `--build`
  builds viewer assets only when the viewer directory is selected. These local checks do not qualify a production-CDN
  web build on loopback; production CDN/CORS behavior requires its live origin.

- CI runs it on PRs that touch `apps/web`, `apps/server` or `e2e` (the `smoke` job in `.github/workflows/ci.yml`).
- Use it as a PR's proof: upload `summary.json` and the screenshots (and the clip) with `node tools/proof/upload.mjs`.
  It is a scripted e2e, so it proves the page loads and draws; a T2 change still needs a clip of its own journey
  (the `proof` skill).

## Client fixture scenarios (`e2e/scenarios/client-fixture-arrival.md`)

Scenarios are Markdown files with front matter (`id`, `tier`, `fixture`, `critical_path`) and numbered steps of
actions plus `expect`, `expect-url`, `expect-console` and `screenshot` lines. An agent runs them with the `e2e` repo
skill and writes screenshots, page text and a machine-readable summary under `.e2e/runs/` (gitignored); a scenario
with a `runner` in its front matter runs as that command instead.

`client-fixture-arrival.md` covers arrival, camera and selection, and leaving and re-entering an isolated world:

- The fixture is a private, test-flagged world started from a tracked genesis with fake minds, served on
  loopback port 7830. Read-only bundle proxies run on 7834 (candidate) and 7835 (control). Chrome is driven over
  CDP on 7838 with a scratch profile, and an optional phone observer uses 7839.
- Arrival is complete when the entity layer is active, the asset queue is empty, every selected LOD asset has
  loaded and a hardware WebGL renderer is in use.
- The scenario leaves through the fixture's `/healthz` page and checks that re-entry creates a new document with
  exactly one world canvas. This proves full-document navigation only, not same-document renderer cleanup.

Rules for fixture runs:

- Whoever boots the fixture records its process IDs and stops only those processes. Never kill a process just
  because it holds a port, and never point scenarios at production worlds or production data.
- Build the browser bundle under test from a committed tree and record its path and hash with the fixture.
- Re-run a passing scenario only after a source change. Performance A/B samples are planned measurements
  (see [the speed tools](../../tools/speed/README.md)), not repeated smoke attempts.

The release-time real-Chrome walks (V7) are separate; see [remote gate](remote-gate.md).

## Custom journeys with owned attempts

`tools/proof/owned-attempt.mjs` enforces the lifecycle for new custom browser proofs. It reuses the dev-world boot
helper and owns one world child, fresh mutable data, a fresh persistent Chromium profile and video directory. It
accepts a world recipe, never an arbitrary running URL. Assets and an explicitly selected browser cache/executable
may be shared read-only. Build the served assets from the committed product source first.

Call `runOwnedAttempt` from a committed driver wrapper with an ignored private ledger, the concrete agent identity,
product checkout, tracked driver module (`driver: {root, path}`), world recipe, explicit browser cache/executable,
and a predeclared cycle. Each production attempt requires a fresh Node process; the process-global guard rejects
reuse, even through another module URL. Wrappers import the runner only and must not preload driver modules. This
keeps relative driver imports fresh across committed repairs. The helper binds its own actual checkout and loaded source bytes; the product, helper and
driver checkouts must all be clean. A driver default export receives `{page, base, paths, signal, check, fixture,
arm, repeat}` and uses real input and named `check(key, ok, detail)` assertions. Optional `prepare` runs against the
owned world before the browser; `beforeNavigation` installs observation and may return an owned cleanup function.
Imports must have no side effects. Preparation, observation setup, the journey and cleanup are bounded; drivers
should honor the signal and stop their own asynchronous work when cancelled.

The cycle has an explicit `id`, `fix: {root, from, to, paths, scope}`, pinned `arms: {baseline: {root, head},
candidate: {root, head}}` and ordered `plan: [{arm, repeat}, ...]`. Declare both repeats per arm before measurement.
Each passing slot advances to the next planned measurement. A failure pins that slot: changing repeat/sample IDs
cannot skip it, and all tries, including boot aborts, consume its three-attempt repair ceiling. Every retry needs
a relevant committed change (`repair`, with the same change fields plus a concrete `hypothesis`). A commit alone
does not reset counters. A completed passing plan cannot rerun without an explicitly named new corrective cycle
and a relevant material change. Keep historical capture count and hashed original evidence in `history`; capture
ordinals remain cumulative across cycles, separately from corrective repair-attempt numbers.

Before attempt three, supply a fresh `review` with the independent **agent** identity (not the shared GitHub
account), `evidenceOnly: true`, time after the preceding attempt, both preceding immutable `reportHash` values,
the current source identities, a different concrete hypothesis, and `change: {path, line}` in the actual committed
repair. Only `decision: 'TRY'` proceeds; missing, stale, self, source-mismatched or `ESCALATE` reviews stop. The
ledger pins the implementing identity. Never remove a lock or edit a failed record to manufacture another try.

Private reports retain screenshots, accessibility, console, world-log tail, explanation, source identities,
capture/repair numbering and teardown results without overwrite. Boot abort, interruption, evidence failure and
cleanup failure cannot qualify. A world crash stays a failure even when browser assertions pass. A crash leaves
in-flight ownership visible; failed cleanup retains the lock for explicit diagnosis. A browser launch still pending
at cancellation also retains ownership; any late context is closed and gets a separate immutable cleanup record,
without changing the failed attempt's verdict. These records contain local
operational mappings: publish only a separately sanitized summary and manually inspected media, checked with the
publication checker. `createTestRunner` is injection-only and always produces **unqualified** reports. Tests of
the helper are not feature/browser acceptance; clip duration, audio, framing, native resolution, product criteria,
quiet-machine measurements and independent product review remain the proof author's responsibilities.

## God modal edit observation (E1/F1)

E1 captures the accepted owner-button ACK sequence and two first snapshot reads before taking screenshots. A unique
query must be a launcher cache MISS with public `seq >= ACK.seq` and the exact original bench removed/restored. That
single immediate check is never retried into a pass. Separately, the unchanged public URL must converge to the same
sequence/state within 3000ms of the ACK: the documented hot C3 cache TTL is 2000ms, with 1000ms for request/scheduling.
The first same-URL response, cache headers and monotonic timestamps remain in the report, including stale hits.
Rejected ACKs, missing/stale sequences, replacement identities, late convergence and page errors fail. This observes
the existing cache policy; it changes neither production caching nor Undo/Redo admission. Earlier release receipts
retain their original verdicts. Focused regression: `node --test tools/world-launcher/edit-observation.test.mjs`.

F1 uses the same observation boundary for Rain: capture the weather POST ACK, then require public `seq >= ACK.seq`
and the requested rain kind, amount and intensity on the single immediate cache MISS. Retain the first unchanged-URL
response and separately require its convergence within the same bound. This matters when E1's final convergence read
has just primed the unchanged URL with pre-weather state. The owner Rain note and absence of page errors remain required;
a note alone cannot prove weather changed. The regression covers this exact Redo-to-weather ordering with primed caches.
