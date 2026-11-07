# Contracts

The interfaces other programs depend on, their version names, and the rules a change must keep. Types and structural
schemas are in `packages/protocol/src`; producer-side checks are in `apps/server/src/contracts.test.ts`.

## Versioned surfaces

| Contract | Where | Notes |
|---|---|---|
| WebSocket `PROTO = 1` | `packages/protocol/src/index.ts`, `apps/server/src/hub.ts` | `welcome` carries a process `epoch`; a new epoch invalidates batch-sequence resume |
| `eden-edge/1`, additive `eden-edge/1.1` | `apps/server/src/edge/contract.ts` | The Soul API. New fields are additive; boot responses declare `apiContract: 'eden-edge/1.1'` |
| `account-soul-approval/1` | `apps/server/src/accounts/` | Agent approval start/poll/cancel, advertised in `/v1/config` |
| `travel/1` | `apps/server/src/travel/travel.ts` | Passport and travel routes between worlds of one site |
| `local-worlds/1` | `tools/world-launcher/launcher.mjs` | The launcher's world list (`__sim/worlds.json`) |
| `moderation/1` | `apps/server/src/moderation/routes.ts` | Hidden-content list read by viewers |
| `mars-take/4` | `mars/viewer/engine/take/` | Recorded pose takes; decoders also accept older /1–/3 shapes |
| `sim-mars-snapshot/1` | `packages/engine-mars/src/engine.ts` | Adapter snapshot format |

## Identity and routes

- Every HTTP, WebSocket, MCP and skill path is relative to the selected world's base (`/worlds/w/<slug>` or `/w/<key>`).
  A token belongs to one world; it is never valid in another.
- Soul ids (`s_…`) and body entity ids (`h_…`) are different. Owner routes use the Soul id; public world summaries use
  the entity id; public WebSocket Soul entries carry both.
- A Soul token binds one live Soul in one world. Revocation, retirement and handoff invalidate it. A god token binds one
  world; handoff revokes all of them.

## Recorded presentation

- `takes` messages are `{t: 'takes', serverTick, chunks: [{fromTick, toTick, take}]}`. `/v1/take?after=<tick>` gives
  the hot equivalent; `/v1/takes?from=&to=&limit=` gives stored chunks (limit 1–120) and a nullable `next` cursor.
  Stored reads may have gaps; a gap is never a reason to call a model or regenerate motion.
- `fromTick`, `toTick`, `serverTick` and `take.startTick` are absolute world ticks; `take.ticks` is a duration; pose
  samples, changes and events inside a take are relative to `startTick`.
- Units: metres, Y up, x–z ground, yaw 0 faces +X. Pose tracks store integer millimetres and milliradians
  (`[relativeTick, x, y, z, yaw]`; seven components add pitch and roll). Speed is cm/s. `null` in a change means a
  clear. Discrete fields hold their last value.
- A label is not authority: depiction never invents a gesture, contact, speech, consent or completion.
- `Engine.renderScene()` returns the `RenderScene` envelope validated by `scenePublicationSchema` (bounds, arrays,
  optional clock and ground). New takes may name a `renderSceneRef`, resolved at `/v1/scenes/:hash` (content-addressed,
  scoped to the world; unknown or foreign references are a uniform 404).
- Structural decoders (`recordedTakeSchema`, `recordedTakeChunkSchema`, `recordedTakeStreamSchema`,
  `recordedTakeHistorySchema`, `scenePublicationSchema`) validate shape and chunk origins. They do not verify hashes,
  physics, references or privacy. Unknown take schemas fail explicitly.

## Steering results

`steerReceiptSchema` and `SteerReceipt` (`packages/protocol/src/owner-views.ts`) describe the result of the older
mandate steering route: an accepted rule with `text, tick, seq, via, minted`, or a rejection with a reason. A rule being
accepted is not the same as its being carried out. `ownerSoulDashboardSchema` validates the owner dashboard's core
fields and preserves additive ones. On edge worlds, an action's lifecycle is its receipt (accepted → started →
completed / failed / replaced), read from `/v1/edge/receipts/:id` or the event stream. `started` (`startedTick`) means
the body program began executing, not that the body visibly moved: a walk from idle can read `started` for about ten
ticks before the first step. `firstMotionTick` is the first tick at or after it at which the body's engine activity changed
or its root moved more than 5 cm; it is absent until then, on receipts with no body program, and on a receipt still running across a server
restart that had not moved before it (#790, D021).

## Privacy

Public surfaces (`/v1/world`, `/v1/kernel`, `/v1/log`, takes, scenes, public Soul records) carry physical and public
state only. Owner words, private rules, journals, prompts, provider credentials and recovery details never cross them;
the server produces the permitted projection before serialization (structural validation is not redaction). Prompt
lookups (`/v1/prompt/:hash`) require the current owner of a Soul in that call or an admin, and answer the same 404 for
missing, pruned and foreign references.

## Changing a contract

Add fields; do not change the meaning of existing ones. A behaviour change to the engine or a world's rules ships as a
new logged policy or rules fact adopted from a tick onward, so earlier history replays unchanged. Once a world has
adopted such a fact, rolling back requires a reader that understands it.
