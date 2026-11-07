# Local edge worlds

Tools for running the Mars and Little Martians edge worlds locally. Each world is one process with its own SQLite
database, behind a loopback routing proxy, and Eden runs beside them. Everything here is local and disposable: no
production data is written and no DNS, tunnel or paid-model changes are made. Never point a world's `dataDir` at
live data.

## One world: `world-server.mjs`

`openWorldServer(descriptor)` takes an explicit descriptor:

| Field | Meaning |
| --- | --- |
| `input` | source checkout the world runs from |
| `dataDir` | the world's own data directory (one process may own it; a lock refuses a second) |
| `worldKey` | `mars` or `littlemartians` |
| `worldId` | the history's id |
| `port` | a private port in 4963–4969 |
| `publicOrigin` | optional loopback HTTP origin, usually the proxy's |
| `webDir`, `marsWebDir`, `skillFile`, `cliFile` | built web app, Mars assets and the served Soul skill and CLI |
| `authMode` | `local-dev` (default), `public-preview` or `configured` (see below) |

`check` boots an existing disposable copy and reports its clock, head and hash before anything new is installed.

Notes:

- **Mars** is a separate history on the versioned 2026 campus map, and an older camp history is refused on that map.
- **Little Martians** runs the production factory. The authored map variant (`worldVariant: "authored"`) needs its own
  `worldId` (not `littlemartians-1`) and the exact `sceneSha256`. Its optional sidecars (`experiencesFile`,
  `placeData`, `activityData`, `nativeAliases`) are each bound to a sha256 of the exact file under
  `worlds/littlemartians/` and checked before the database opens.
- **Native cast.** The native cast may run on seeded fake choices. Owner- or agent-controlled Souls, and paired cast
  Souls, are never driven natively.

Auth modes (`world-auth-mode.mjs`):

- `local-dev`: development sign-in on a loopback HTTP origin.
- `public-preview`: requires `EDGE_PUBLIC=1` and `seedCast: false, nativeCast: false`.
- `configured`: uses the server's configured account verifier and refuses `DEV_AUTH`.

No credentials belong in descriptors or logs.

## The group: `local-worlds.mjs` and `proxy.mjs`

Save a config outside the repository and start the group:

```json
{
  "input": "/abs/souls-checkout",
  "dataDir": "/abs/scratch/local-worlds",
  "edenPort": 4970,
  "proxyPort": 4966,
  "webDir": "/abs/souls-checkout/apps/web/dist",
  "skillFile": "/abs/souls-checkout/tools/edge-skill/SKILL.md",
  "cliFile": "/abs/souls-checkout/tools/edge-skill/eden-agent.mjs",
  "marsWebDir": "/abs/mars-web",
  "mars": { "port": 4963, "worldId": "mars-2026-1" },
  "littlemartians": { "port": 4964, "worldId": "littlemartians-1" }
}
```

```sh
node tools/core/multiworld/local-worlds.mjs /abs/local-config.json
```

- It reuses an already running Eden server read-only. With `edenDescriptor` it starts its own Eden copy on a private
  port in 4950–4959 instead.
- A per-world `sourceDb` is copied with `copy-sqlite.mjs`: the source is attached read-only, every table is verified,
  and recording tables are left empty. An existing destination is refused.
- All three world identities are checked before the proxy starts. Ctrl-C or SIGTERM stops only the children it
  started.

The proxy routes HTTP, SSE streams, WebSocket upgrades and query strings to the selected world. `/__sim/worlds.json`
returns `local-worlds/1` metadata. Unknown world prefixes get a 404 `world.not-served`, never another world's API.
The opt-in `exposure: "shared-preview"` binds only loopback 4970 and needs Eden on a private 4950–4959 backend.
It also needs `expectedWorldIds` and `expectedBuild`, and verifies each backend's actual identity before listening.

## Proofs and fixtures

| Script | Does |
| --- | --- |
| `copy-sqlite.mjs` | compact, consistent, read-only copy of a world database |
| `eden-data-proof.mjs`, `verify-eden-data.py` | qualify an Eden activity-data/descriptor pair (`eden-data-descriptor-pair.json`) on a compact copy, using ordinary Edge acts |
| `native-day-proof.mjs` | an accelerated native-cast day and graceful-close replay on disposable databases with the fake backend |
| `replay-proof.mjs`, `make-main-lm-history.mjs` | build a scripted Little Martians history and check that the edge launcher keeps its exact clock, head and hash |
| `public-cli-acceptance.mjs` | two synthetic owners make ordinary requests through the published CLI; exits non-zero on any required refusal, failure or time limit |

```sh
node tools/core/multiworld/eden-data-proof.mjs <frozen-source> <descriptor.json> <read-only-baseline.db> <activity-spots.v1.json> <proof.json> [restart-only]
python3 tools/core/multiworld/verify-eden-data.py <activity-spots.v1.json> <eden-district-solids.v1.json>
node tools/core/multiworld/public-cli-acceptance.mjs <checkout>/tools/edge-skill/eden-agent.mjs http://127.0.0.1:<port> <proof-dir>
node --test tools/core/multiworld/*.test.mjs
```

Run the acceptance script only against a private server configured for scripted execution. It keeps credential files
inside its own proof folders; never print or commit them.
