# Protocol: events and WebSocket messages

Everything that crosses a process boundary is typed in `packages/protocol/src` (types and zod schemas; `PROTO = 1`).
This page is the prose.

## Log events

`LogEvent { seq, tick, kind, author, payload, at }`, one row per event in the `events` table. `WorldHost` assigns
`seq` and `tick` at the start of a tick; `fold.ts` applies the event to the engine and the kernel. The full
`EventKind` union is in `packages/protocol/src/index.ts`.

| Kind | Typical author | Effect when folded |
|---|---|---|
| `birth` | `world`, `soul:<id>` | Spawn the Soul's body at the arrival point, its kernel Thing and its mind |
| `decision` | `edge:<soulId>`, `brain:*` | Start an engine program (the resolved verb steps) for that body, replacing what it was doing |
| `edge-stop`, `edge-relocate`, `edge-attention` | `edge:<soulId>` | Stop a body's program, move a body (for example back to its sleeping place), set where it looks |
| `body-assignment-v1` | owner, world | Give a Soul's body a look or body kind |
| `world-edit` | god | Apply the physics derived from a god's committed edit (new or moved objects, terrain) |
| `edge-god-walkout` | world | Move bodies out of space that a god's edit has just filled |
| `retire` | `soul:<id>` | Remove the body, the Soul's Thing, what it made and its mind |
| `rules` | `world`, `admin`, operator | World rules and policies: clock rate, day configuration, vocabulary, runtime policies |
| `intent-*-v2`, `intent-arrival-v1`, `intent-sleep-stop-v1` | system | Structured intent requests, admission, controller and arrival facts used by the Eden world |
| `mandate`, `play`, `mint`, `deck`, `intent`, `scene` | owner, brain | Kernel/cards steering used by the central mind driver (see [brain](brain.md)) |
| `admin` | `admin` | Recorded; no world effect |

Replay applies the same events at the same ticks and reproduces the engine state hash and the kernel hash. Replay never
calls a model: a model's choice is already a logged `decision`.

`publicEvent()` produces the public projection: owner words, private notes, reflection text and recovery details are
removed, and account ids are hidden.

## WebSocket (`/ws`, JSON)

Each connection belongs to one world (`<world base>/ws`). The hub also routes the Soul event stream
(`/v1/edge/events/ws`, see [Souls](souls.md)).

Client → server (validated; at most 20 messages per 10 s, else the socket closes with 1008; 64 KB each):

| Message | Meaning |
|---|---|
| `{t:'hello', proto, token?, since?, epoch?, …}` | Join. `token` = the user's session token (optional); `since` = last batch seq for resume. An anonymous hello may also come in the URL (`/ws?hello=…`) |
| `{t:'resync', reason}` | Ask for a fresh snapshot |
| `{t:'ping', n}` | Latency probe |

A socket with no hello within 15 s is closed.

Server → client:

| Message | When | Content |
|---|---|---|
| `welcome` | after hello | build, proto, world id, rules version, schema, dt, clock rate, server tick and time, process `epoch`, paused |
| `snapshot` | join, resync, or when a resume is impossible | entities, regions, environment, paths, Souls, view hash |
| `batch` | every 10 ticks (500 ms) | paths, field changes, Souls, removed Souls, public log lines |
| `heartbeat` | every 100 ticks (5 s) | tick, seq, view hash, keyframes, clients, clock rate, paused |
| `takes` | as chunks are recorded | recorded pose chunks for the 3D view |
| `log`, `kernel`, `plays`, `talk` | join, then live | public events, kernel view, plays, rendered speech |
| `brain` | signed-in viewers | model calls about the viewer's own Souls (admins: all) |
| `camera`, `ticker`, `narrative`, `stats`, `me`, `station`, `pong`, `error` | live | broadcast shot, ticker lines, narrator plans, server counters, the viewer's own state |

God edits reach viewers as `world-diff` messages broadcast through the same hub.

Limits: 30 connections per IP, 2,000 per world (beyond: close 1013). A client more than 1 MB behind is skipped and
resyncs at the next heartbeat. The last 600 batches are kept so a reconnecting client resumes with `since`; a changed
`epoch` (a new process) forces a snapshot.

`paths[]` entries are `PathCommit { entity, startTick, speed, waypoints, activity, actionId }`; the Mars adapter sends
two-point keyframe paths for moving bodies every 5 ticks. `changes[]` entries are `[tick, entityId, field, value]`.

## Client replica (`packages/client`)

`Replica` applies snapshots and batches (a gap in `seq` triggers a resync) and samples any entity's pose at a tick.
`Connection` reconnects with jittered exponential backoff and resumes from the ring buffer. On each heartbeat it
recomputes the view hash (sorted `[id, activity, seat, x mm, z mm]` for every human) and resyncs on mismatch. A
`welcome.build` different from the page's own build reloads the page once.

## Recorded takes

The 3D view draws recorded poses, not a live runtime. The server records pose chunks (`mars-take/4`): absolute tick
range `fromTick..toTick` plus a take whose pose samples are relative to its `startTick`. `/v1/take?after=<tick>` returns
the hot chunks; `/v1/takes` pages history (1–120 per page) with a `next` cursor. The viewer samples about a second
behind the server. Units: metres, Y up, yaw 0 faces +X; pose samples store millimetres and milliradians
(`[relativeTick, x, y, z, yaw]`). Structural decoders (`recordedTakeSchema`, `recordedTakeChunkSchema`, …) are
exported from `@souls/protocol`; they validate shape, not physics or privacy.
