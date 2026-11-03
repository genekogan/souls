---
id: local-smoke
tier: smoke
fixture: hello-hamlet
runner: e2e/local-smoke.mjs
mocks: []
critical_path: true
---
# A plain local instance shows its worlds and draws people

Quick proof that the app works on this machine: a visitor opens the world list, enters a world from its card and sees
a person in it, with no console errors and no failed requests. Any agent, laptop, cloud session or CI runner can run
it against a fresh local instance on any free port:

```sh
node e2e/local-smoke.mjs [--port 9950] [--clip] [--build]
```

The runner performs every step below and writes `.local/e2e/<UTC timestamp>/summary.json` (one entry per step and
assertion) and `shots/`, plus `clip.mp4` (or `clip.webm` without ffmpeg) with `--clip`. How to set it up:
[docs/testing/e2e.md](../../docs/testing/e2e.md#local-smoke).

## Preconditions
- `pnpm install --frozen-lockfile`, `pnpm assets:pull --set web,runtime`, the web build (`apps/web/dist`) and the
  selected static overlay's character kit (`--mars-web`, the launcher overlay, or the viewer build; `--build` builds the viewer when selected).
- Chromium in `PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers` or `.e2e/browsers`; never a signed-in profile.
- A free port and the two after it (`--port`, `E2E_PORT`, or one the runner picks). Not the client fixture's ports in
  `e2e/config.mjs`.

## Steps
1. Boot a world launcher on the port with a fresh data dir under the run directory. Its worlds run with fake minds
   and dev sign-in. Create a world from the `hello-hamlet` template as `dev:smoke` (its god), then one Soul, Ada.
   - expect-api: GET /__sim/healthz ok, auth dev
   - expect-api: POST /__sim/worlds → the world is running
   - expect-api: POST /w/<slug>/v1/souls → a Soul with a body
2. Open the world list at `/`.
   - expect: a card for "Smoke Hamlet" that links to /w/smoke-hamlet/
   - expect-console: no application errors
   - expect-network: no failed requests and no HTTP errors (requests the page cancels itself, `net::ERR_ABORTED`, are
     recorded as `cancelledRequests`, not failures)
   - screenshot: 1-world-list.png
3. Click the card.
   - expect-url: matches /w/smoke-hamlet/
   - expect: the canvas has a live WebGL context and the scene draws the world's things
   - expect: Ada's figure (a skinned person rig named after her body) is in the scene and visible; no "could not be
     prepared" notice
   - expect-console: no application errors
   - expect-network: no failed requests and no HTTP errors
   - screenshot: 2-world.png
4. Open Explore, type "Ada" and press Enter.
   - expect: the "Following Ada" chip shows and Ada is inside the frame
   - expect-console: no application errors
   - expect-network: no failed requests and no HTTP errors
   - screenshot: 3-person.png
5. Teardown: close the browser, stop the launcher (it stops its world), check both exact PIDs are gone, and remove
   the data dir after a pass (`--keep-data` keeps it).

## Proof required
- `summary.json` with `status: "pass"` and the three screenshots; `clip.mp4` when the run is a PR's clip.
