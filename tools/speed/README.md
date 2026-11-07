# Speed probes

Client load and frame-time measurements on fresh local Mars and Little Martians dev worlds. The fixtures use fake
minds and no production data. The tools accept only localhost URLs on the fixture ports: 5890–5899 by default,
or the ports in `SPEED_PORTS`. They always refuse 4930–4990.

## Run

```sh
pnpm --filter @souls/web build                    # fixtures serve apps/web/dist
node tools/speed/fixtures.mjs                   # starts both fixture worlds, prints their PIDs
node tools/speed/matrix.mjs before|after|phone-before|phone|all [output-dir]
node tools/speed/character-transfer.mjs http://127.0.0.1:5890 <out.json>
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPEED_PORTS` | `5890,5891` | Mars and Little Martians fixture ports |
| `SPEED_SCRATCH` | (set it) | fixture data, logs, `fixtures.json` and default matrix output |

`fixtures.mjs` refuses occupied ports before clearing its own data. It creates one idle resident (`Phone probe`),
slows the clock to 0.1 and never calls a model. Stop the two printed PIDs with SIGTERM when finished.

`matrix.mjs` probes both worlds with pinned arrival cameras (`eye`/`at`), clear weather and a 60 Mbit/s link.
`before` loads with `?loadqueue=0` (deferred loading) and `after` with the nearest-first queue, from the same bundle.
`phone` and `phone-before` add phone emulation, and `all` runs before, after and phone in sequence. Each output
records the `index.html` hash of the bundle under test.

`character-transfer.mjs` checks that the character GLBs served gzip-encoded decompress byte for byte to the identity
response, and records the timings.

For one configuration:

```sh
node tools/speed/probe.mjs <world-url> [--sizes 1440x900] [--dprs 1,2] [--seconds 6] [--mobile] [--cpu 4]
    [--label <name>] [--out <dir>] [--settle-max 120] [--mbps 60]
node tools/speed/profile-arrival.mjs <world-url> --out <dir> [--cpu 4] [--mbps 60] [--desktop] [--stranger] [--warm]
```

`--mobile` means 390×844 at DPR 3, touch input and 4× CPU throttling. The app may cap its render pixel ratio below the
emulated DPR, and both are reported. Probes need real Chrome on a hardware GPU and refuse software renderers. A
probe holds a Chrome lease for its whole run, so two probes never share the GPU. `profile-arrival.mjs` records a
sampled V8 CPU profile from navigation to the arrival card's ready signal (`arrival.cpuprofile`, plus a summary by
source file and function).

Phone tiers can be isolated with `?phoneOff=detail,lod,cards,bodies,worker`, and desktop distance detail with
`?desktopDetail=0`.

## Measures

- `firstEntityFrameMs`: the first active-entity render call after navigation (50 ms poll). `cardDoneMs` is the
  arrival overlay's ready signal.
- `settledMs`: confirmed complete settling. Every deferred asset and GLB request is done, processing has finished,
  drawn triangles are stable for 3 s and there has been no GLB activity for 7 s; that quiet time is included.
  `settled: false` means the deadline was hit.
- Frame p50/p95, renderer CPU time and GPU timer queries over a still window and a real-input orbit (mouse on
  desktop, CDP touch on phone). GPU time is null when the timer extension is missing.
- `network.cdpEncodedBytes` and `glbEncodedBytes`: completed-response transfer bytes from a fresh, cache-disabled
  context. WebSocket traffic and aborted requests are excluded (aborted requests stay in the failure log).
- `textureStorage`: an estimate of scene texture payload (`texture-storage.mjs`). RGBA8 mip chains are estimated and
  compressed mips are actual bytes. It is not total GPU memory.
- Phone checks after the timing windows: camera controls, touch help, touch drag, following the resident, and
  fixture speech readability. UI failures are findings and never discard timing results.

Compare equal, fully settled corpora on the same machine, viewport, weather and network settings. Use a quiet
measurement machine. These are single-run measurements, not device qualification; mobile emulation throttles the
CPU but not the GPU or memory.

## Tests

```sh
node --test tools/speed/texture-storage.test.mjs apps/web/src/gen-mesh/lazy-assets.test.ts
```
