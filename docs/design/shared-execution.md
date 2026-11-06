# Shared execution within independent Soul action streams (PC02)

**This is the contract for the first shared carry. It is not implemented API documentation.** Issue:
[#681](https://github.com/genekogan/souls/issues/681), part of [#560](https://github.com/genekogan/souls/issues/560)
and [#623](https://github.com/genekogan/souls/issues/623) S4b. The programme design is
[physical-coordination.md](physical-coordination.md), and the inventory is
[physical-coordination-manifest.json](physical-coordination-manifest.json).

It specifies the smallest contract one consensual two-Soul ground carry needs (PC06,
[#685](https://github.com/genekogan/souls/issues/685)), and how PC04–PC11 grow it. Where it changes current behaviour,
it says *Change:* and names the current rule. Everything else describes code on `main` at `df69a3ca`.

## Principles

- **One identity system.** A shared session *is* a together invitation: `Invite` in
  `apps/server/src/edge/ledger/together.ts`, persisted in `edge_invites_v1`. It is not a new session table, logger or
  controller. Its operation runs as the native `carry` action (`mars/viewer/engine/carry/actions.ts`) with a crew of
  several bodies. Each member keeps their own `EdgeReceipt` (`apps/server/src/edge/contract.ts`).
- **Each stream stays its owner's.** A shared session claims named physical capabilities of a member's body for one
  bounded manoeuvre. It never claims the mind, the conversation, the owner's messages or later work.
- **Accepted is not started, and stop requested is not released.** A receipt reports what the world did, measured on
  the world clock.

## 1. Session, revision and roles (A1)

A session is an `Invite` with `kind: 'shared'`. *Change:* today `kind` is `'paired' | 'give' | 'activity' | 'ride'`. The
new kind adds these fields to the invite body; the existing `body` JSON column holds them, so the schema does not
change:

| field | meaning |
|---|---|
| `template` | `{id: 'carry', version: 1}`: the versioned activity, which fixes the roles, cleanup policy and envelope (§4) |
| `revision` | an integer starting at 1. Any material change bumps it: the load, the destination, the role set, or the crew range |
| `load` | `{entity, def}`, where `def` is the def name with its revision (for example `core-rack-beam@2`): loose-load identity only (§4) |
| `destination` | a place id on level 0, resolved the way the solo carry resolves `to` (`resolvePlaceForVerb`) |
| `roles` | `[{role: 'carrier', slot: <grip index>, soulId: string \| null}]`. The host takes a slot like any member |
| `crew` | `[min, max]`, from the def's `handling.carryCrew` and `ceil(mass / MAX_KG_PER_CARRIER)` (`carry/formation.ts`) |
| `cleanup` | `'set-down-here'`: the only cleanup the first template discloses (§3) |
| `op` | `null` until commit, then the operation record (§2) |

The existing fields keep their meaning:
- `host` is the proposer;
- `guests` are the Souls asked;
- `responses` holds the answers;
- `hostReceipt` and `guestReceipts` link receipts to the invite;
- `expiresTick` bounds the proposal.

### Lifecycle

| step | meaning |
|---|---|
| **Propose** | The host's act `carry-with` creates the invite at revision 1, with `state: 'pending'`. Its parameters are the load, `to`, and `with` (the Souls asked). It opens the host's receipt in `waiting`. A proposal moves nobody, and conversation membership is not consent. *Change:* `awaitingAnswer` and `hostAlone` cover only `paired`/`give` today (`together.ts`); they extend to `shared`, so the host's receipt names who is still undecided. |
| **Accept / decline** | A guest acts `accept {invite, revision}` or `decline {invite}` (extending today's `accept:<invite>` and `decline:<invite>` offers). Acceptance creates the guest's receipt for the shared operation, in `waiting`, linked in `guestReceipts`. `accept` checks the §4 envelope itself (body, hands), so a floater cannot accept a carry even though floaters may `accept` other invitations. If the revision is stale, the world refuses with `shared.revision-changed`, naming the current revision and what changed. |
| **Amend** | Only the host's `carry-with {invite, …}` with changed parameters bumps `revision`: the load, `to`, the role set or the crew range. A bump clears every acceptance, and those receipts end `failed` / `shared.revision-changed`, so nobody holds a silently changed agreement. |
| **Leave before commit** | Before commit, a member may leave freely: a guest acts `decline {invite}`, which *Change:* is still offered after accepting, and the host withdraws the offer (`withdraw:<invite>`, today offered only for rps, hold-hands and hand-over). Any other body act by a guest ends that guest's `waiting` shared receipt as `failed` / `shared.left`, never `replaced`, and frees their role; the rest of the session stays pending. Any other body act by the host closes the invite: every member's receipt ends `failed` / `shared.left`. |
| **Expiry** | If the roles are not all filled and ready by `expiresTick`, the open responses become `expired` and the open receipts end `failed` / `invite.expired`, as today. Expiry never applies after commit (§2). |
| **Readiness** | Derived each tick and never stored. A member is ready while all of these hold: they accepted the current revision; their body passes §4; their hands are empty (`hands.full`); they have no other open receipt; and they are on level 0 within `SHARED_GATHER_RADIUS` (10 m) of the load. Members do **not** walk to their grips before commit. The native `carry` gather phase does that walking (`carry/actions.ts`, bounded by `GATHER_TIMEOUT_S`), so no pre-commit walk can replace a shared receipt. |
| **Commit** | When every role is filled and every member is ready, the world commits atomically (§2). The host does not commit for the others; each member's own acceptance is their consent. The commit either acquires every claim and starts one native crew `carry`, or changes nothing. If it cannot proceed yet, the session stays pending, each member's receipt names the blocker (`shared.not-ready`, with who and why), and the world tries again when readiness changes, until `expiresTick`. If it is refused for good, for example the native `plan()` refuses with `carry.no-route` or `carry.crew-too-small`, every receipt ends `failed` with that diagnostic. |

## 2. Operation, claims, per-member receipts and retries (A1)

**Atomic commit.** The commit goes through the host's existing atomic decision path,
`enqueueObjectDecision(author, payload, guard, journal)` in `apps/server/src/world.ts`:

- **Guard.** It is checked under `BEGIN IMMEDIATE`. It refuses unless the invite is `pending` at this revision, every
  role is accepted and ready, and `op` is still `null`.
- **Fold.** The decision event is appended and folded in the same transaction. The fold must return `programOk` and a
  `programId`, otherwise the transaction rolls back and the native/kernel head is restored.
- **Journal.** It writes `op` and `state: 'committed'` into the invite row and moves every member's receipt to
  `started`, all in that transaction.

Either the event, the program and the `op` all exist, or none does. A second commit attempt finds `op` set and is
refused by the guard, so a retry or a duplicated tick never submits a second carry.

**Who runs the program.** The decision is the host's, with one step: `mars:carry {crew: [host, ...guests], item, to}`.
The guests' bodies are borrowed by that program, so the engine's `actorBorrowed` reports them busy to everything
else. This is the intended mechanism, not a verified one: PC05 must show that the native `carry` runs as an edge
decision step with borrowed crew. If it cannot, PC05 names the smallest engine change, which is T3 engine work.

**Operation identity.** `op = {id: 'op_' + invite + '_r' + revision, programId, eventSeq, committedTick, phase,
claims}`.
- `programId` is the engine program, and `eventSeq` is the decision event's sequence number. The native action
  record starts later and is not stored.
- `phase` is `started`, then `stopping`, then optionally `blocked`, then `ended`.
- The id is a pure function of invite and revision.
- *Change:* `Invite.state` gains `'committed'`, so the expiry sweep, which today closes every `pending` invite once
  `tick > expiresTick` (`together.ts`), never touches a running operation.

**Claims.** `claims` lists `{soulId, capabilities: ['hands', 'locomotion']}` for each member, plus `{entity: load, by:
op}`
for the load. The load claim is the native `reservedBy`. Claims name the capability they hold, so the busy refusal in
§3 can say what is occupied. The first template claims only `hands` and `locomotion`. `stance` and equipment claims
come with the templates that need them (PC13 onward).

**Per-member receipts.** Each member has exactly one receipt for the operation: the host's receipt from the proposal,
and each guest's receipt from acceptance. Phases use the existing `ReceiptPhase`:

| phase | meaning |
|---|---|
| `waiting` | accepted and not committed. `awaitingAnswer` names who is still undecided (§1, *Change:* for `shared`) |
| `started` | committed; `startedTick = committedTick`. `firstMotionTick` (#790/#810) is the tick this member's body first moved |
| `completed` | the native `carry` ended and the claims are released |
| `failed` | expired, revision-changed, left (`shared.left`), or the commit failed for good, with the diagnostic |

`replaced` never applies to a shared receipt (§1, §3). A completed receipt's `outcome` (`EdgeOutcomeV1`) has a `shared`
detail: `{op, role, slot, result}`. `result` is one of:
- `arrived`;
- `stopped` (after `stop-carry`, set down early);
- `stopped-at-destination` (a stop was asked, but no earlier spot was clear).

A `blocked` interval is reported in the receipt's `reason` while it lasts, and in the outcome's `detail` afterwards.

The `summary` says who carried what, from where to where. Each member's `for` links to *their own* owner message,
through `OwnerLoop.link` on their own act. Nobody's receipt is linked to another owner's message.

**Retries.**
- HTTP retries of `carry-with`, `accept`, `decline` and `stop-carry` use the existing `Idempotency-Key` middleware
  (`edge/events/idempotency.ts`): the same key returns the original response and acts once.
- A logical retry, meaning a second `accept` of the same revision by the same member, is a no-op that returns the
  existing receipt.
- A retry after an unknown result reads `GET /v1/edge/receipts/:id`, or uses the durable operation lookup
  (`edge-operation-lookup.test.ts`). A row that has expired answers unknown, never a replay.

**Restart ownership.**
- The invite row is the authority for the session and its `op`.
- The engine's checkpoint and log are the authority for the carry's motion: `construction.test.ts` shows the host
  replaying a native mid-carry.
- The commit's single transaction holds both the decision event and the `op` (above). If it did not commit, neither
  exists.
- On start, reconciliation reads the invites in state `committed`, which `pending()` does not return:
  - An `op` whose `programId` is live in the replayed engine keeps its phase.
  - An `op` whose program ended is closed with that program's outcome.
  - A `pending` session has no program; it stays pending and readiness is re-derived.
- A restart never commits on its own behalf after `expiresTick`, and never commits a revision some member no longer
  accepts. PC10 ([#689](https://github.com/genekogan/souls/issues/689)) proves this at every phase.

## 3. Streams during execution: speech, busy, stop and release (A2, A6)

**What still works.**
- Speech and conversation go through `say` and `converse`, the comms routes.
- Observation works: `look`, `here`, `wait`, events.
- Attention acts (`insertDone` with `keepActivity`) still work.
- Owner messages arrive and can be acked.

None of these touches the claims, so a member can talk and look around while carrying. This matches the
solo-walk evidence in S3 entry 2.

**Incompatible body acts.** Today, any body act replaces every open receipt of that Soul (`ledger.ts` `insert`,
`keepActivity = false`: "A newer action from this Soul replaced it.").

*Change:* while a member's receipt for a shared operation is `started`, a new act from that member that needs a
claimed capability is **refused** instead. The refusal is `shared.busy`, and its `reason` names:
- the operation;
- the claimed capabilities ("your hands and walking are committed to carrying the beam with Bo");
- the safe stop on offer: a `stop-carry:<op>` capability in `alternatives` (#824/#826, approved, not on `main` yet).

It replaces nothing. As with every refusal today, no receipt is created: the refusal is the act's response and is
recorded by `recordRefusal`. The owner's message that asked for it stays in the owner's inbox, unacked by the world.
Nothing is silently lost, and the agent decides whether to stop.

An act that needs no claimed capability, for example `say` or an attention act, is unaffected. Solo actions outside a
shared session are unchanged.

**Stopping.** After commit, any member, the host included, may act `stop-carry {op}`. The name is distinct from
today's `withdraw:<invite>`, which withdraws an unanswered offer before commit.

- **Acknowledge at once.** The stop act is inserted with `keepActivity` (as `insertDone` does for attention acts), so
  it cannot replace the member's shared receipt. Its own receipt completes in the same tick with the outcome "stop
  requested". This is the prompt acknowledgment, not a physical release. `op.phase` becomes `stopping`, and every
  member's shared receipt gets `reason: 'stopping: <name> asked to stop'`.
- **Supported cleanup.** *Change:* the stop calls `engine.stop(op.programId)`, and the logged `edge-stop` event carries
  `programId` in its payload so that the stop replays deterministically. Today's `edge-stop` fold stops
  `programOf(entityId)` (`fold.ts`), which is the wrong program for a borrowed guest. The engine cancels the native
  `carry`, and that cancel never drops a load:
  - during gather, the walkers simply stop;
  - during lift, the load is lowered back where it lay;
  - during move, it becomes a controlled set-down at the current pose if that spot is clear.

  Members' bodies finish only that disclosed cleanup.
- **When no safe release is possible yet.** When the native cancel refuses (`carry.cancel-unsafe` on a flight, which
  the first template excludes, or a set-down spot that is not clear), the engine sets
  `p.stopping`, keeps the formation moving along its already validated route, and retries the cancel every tick
  (`packages/engine-mars/src/engine.ts` `stop` and `advance`). The load is set down at the first clear pose, or at the
  destination. The ledger reads this from the program, which needs a reader that does not exist yet: `p.stopping` is
  private engine state. *Change (PC08):* `engine-contract` gains a read-only `programStoppingV1(id)`. The ledger reports
  it like this:
  - the op stays `stopping`, and each receipt's reason says the crew is carrying on to the first clear spot;
  - if the formation itself is held up by an obstacle while stopping, the op becomes `blocked`, the receipts name
    the native blocker, the claims are kept because the load is still supported, and the assistance route is named
    (clear the obstacle, or a ready replacement in PC08).

  No timeout fakes a release, and there is no global lock. Unrelated Souls, and every member's speech, continue.
  Holding the load still in place is not offered, because the native carry has no such phase.
- **Release.** When the program ends, the claims are released in the same tick, and each member's receipt ends
  `completed` with `result` (§2). Each stream is back to its own idle, with nothing resumed. The world does not replay
  the act it refused with `shared.busy`. Before anything is resumed, the agent reconciles with the owner's latest
  intent, as in S3 entry 4: a cancelled walk is never resumed.

**Mind disconnect and fade.** A disconnected mind's body keeps its accepted manoeuvre to its end, and never joins
anything new. A member who *fades* (`ledger.ts`) fails their open receipts and stops their program today. For a
borrowed member that would cut across a running carry. PC09 owns the rule: fading during a shared operation is
treated as a stop request with supported cleanup. A pending acceptance from a disconnected mind still counts until
`expiresTick`. On reconnect, the same receipt
shows the actual outcome. PC09 ([#688](https://github.com/genekogan/souls/issues/688)) proves this.

## 4. Envelope of the first template (A3)

| dimension | v1 | refusal before any movement |
|---|---|---|
| body | humanoid family (`packages/protocol/src/body-v1.ts`) with two free hands | `body.unsupported` (`edge/body/actions.ts`) for floater, ceramic and creature bodies. `body-v1` declares no capabilities, so v1 admits exactly `family: 'humanoid'` with `type: 'humanoid'`. A custom-GLB humanoid is admitted only when its body uses the standard humanoid hands; the declared capability table of [custom-bodies.md](custom-bodies.md) replaces this rule when it exists. Hands: `hands.full` for an edge item, `carry.hands-full` for a native grip |
| body swap | none while invited, accepted or committed | `body.safe-standing-required`. Already refused today: `bodyAssignmentReady` (`ledger.ts`) fails while any invite is open (`together.awaiting`) or any receipt is open, and the engine's `bodyAssignmentProblemV1` fails on a grip, a carrier or a borrowed body |
| load | a loose def with `components.carryable`, `handling.grips` covering the crew, and opt-in tag `shared-carry` (PC03) | `carry.no-grips`, `carry.crew-too-small`, `carry.crew-too-large` |
| crew | 2 for PC06 and 2–4 for PC11, never beyond the native maximum of 8 or the def's `carryCrew` | `carry.crew-too-small` with the arithmetic (`MAX_KG_PER_CARRIER = 30`) |
| ground | level 0 only, the start and destination on the same level, no stair flights | `carry.ground-only` (exists for the solo carry) |
| route | the whole formation, planned by the native planner at commit | `carry.no-route` and the planner's named blocker |
| world | a physical world only: on a non-physical world `engine.stop` ends the program while the action is still active, so the supported-cleanup contract of §3 does not hold | `shared.unsupported-world` |

The solo upright carry, `fixtureCarry` through `mars:move_fixture`, is unchanged. Its `carry.crew-too-small` refusal
exists only for `upright-carry` fixtures (`god/engine-bridge.ts`). The loose `core-rack-beam@1` (12 kg, two grips)
has no solo carry offer today, only the one-hand item path PC03 replaces. *Change:* a `shared-carry` load offers
`carry-with` and nothing solo, and an upright fixture's `carry.crew-too-small` refusal offers `carry-with` in
`alternatives`.

**Loose loads only.** A load is identified by entity id and def revision. Its state is the native support:
- `lying` on a floor;
- `held` by a crew;
- `in-hand` for small items.

Sockets, reciprocal connections and structural support are not part of this contract. They begin at PC12
([#691](https://github.com/genekogan/souls/issues/691)), and a carried beam cannot be installed through it.

## 5. Evidence, trace and viewer (A5)

There is no new logger. The existing records carry the shared fields as follows.

- **soul-trace** (`tools/soul-trace/tap.mjs`) `receipt` facts gain one optional whitelisted field:
  `shared: {invite, revision, op, role, phase}`. This is the operation's phase (`pending`, `started`, `stopping`,
  `blocked` or `ended`), not the receipt's phase. Each member's tap records only that member's own HTTP exchanges,
  so a member's trace holds their own receipts and refusals and never another owner's prompts or tool calls.
- **Joining.** Traces from several members join by `op` only, and only when each owner has consented to share their
  file. A missing member's trace stays a visible gap. World facts anyone may see in the scene, such as who carried
  what and where, come from the world, not from another owner's trace.
- **Viewer.** The S2 local inspector (#624) shows the `shared` block on a member's own receipt rows. It shows
  another participant's activity only as the world reports it to that member. The inspector is not on `main` yet,
  and this contract adds nothing to it beyond the field.
- **Receipt readers** (`GET /v1/edge/receipts/:id`, `wait`, `act --wait`) are unchanged. `shared` arrives inside the
  receipt.

## 6. What S3 already qualifies (A6)

Pre-S4b qualification: [#623 comment](https://github.com/genekogan/souls/issues/623#issuecomment-6638951260).

- **Action identity and receipts.** `for` (#805/#823) and `firstMotionTick` (#810) are approved, but neither is on
  `main` yet.
- **Retries.** Idempotency keys and the durable operation lookup are on `main`.
- **Owner steering and waits.** The steer receipt is kept (#836), and an owner message interrupts a wait in 16–54 ms.
- **Latest intent.** S3 entry 4 shows a cancelled walk never resumed.
- **Recovery.** `alternatives` (#826, #857).

#826 and #836 are approved but not on `main` yet, and §3's `alternatives` and the receipt-keeping wait depend on
them. This contract builds on all of them. Its new boundary questions are the ones above:
- busy refuses rather than replaces;
- a stop is acknowledged at once, cleanup is supported, and a member can be blocked;
- commit is idempotent.

## 7. Surface map, fixture and order (A4)

| contract piece | current surface | PC |
|---|---|---|
| loose beam and sheet defs, opt-in `shared-carry`, a new `core-rack-beam` revision, and a conformance supplement | `packages/world-compiler/src/core-kit/authoring/work.mjs`, `packages/conformance/conformance/` | PC03 [#682](https://github.com/genekogan/souls/issues/682) |
| `kind: 'shared'` invites, revision, accept and decline against a revision, expiry; a test that a host body act closes the invite (`shared.left` for every member) | `edge/ledger/together.ts` | PC04 [#683](https://github.com/genekogan/souls/issues/683) |
| readiness, atomic commit (`enqueueObjectDecision`), the `committed` state, claims, borrowed crew, `shared.busy` instead of `replaced`, `shared.left`, per-member receipts | `edge/ledger/ledger.ts` `insert`, `world.ts`, `god/engine-bridge.ts`, `packages/engine-mars/src/engine.ts` | PC05 [#684](https://github.com/genekogan/souls/issues/684) |
| the native crew `carry` through the bridge, `carry-with` offers, the solo refusal's alternative | `god/engine-bridge.ts`, `mars/viewer/engine/carry/` | PC06 [#685](https://github.com/genekogan/souls/issues/685) |
| a brief obstruction wait, detour or lasting blockage for the formation | native `planner.ts` and `blockedWait` | PC07 [#686](https://github.com/genekogan/souls/issues/686) |
| `stop-carry`, stopping a program by `op.programId`, `stopping`, `blocked`, release; old `edge-stop` events without `programId` keep replaying through `programOf(entityId)`, unchanged | the ledger, `fold.ts` `edge-stop`, engine `stop`/`advance`, the native `cancel` | PC08 [#687](https://github.com/genekogan/souls/issues/687) |
| disconnect, reconnect, and fade during an operation | the ledger and the owner loop | PC09 [#688](https://github.com/genekogan/souls/issues/688) |
| restart reconciliation | the invite row plus host checkpoint and log replay | PC10 [#689](https://github.com/genekogan/souls/issues/689) |
| a different load and a crew of 3–4 | data and def only | PC11 [#690](https://github.com/genekogan/souls/issues/690) |

**Order.** PC03 → PC04 → PC05 → PC06 is a hard chain: defs, then the agreement, then commit and claims, then the
visible carry. PC07–PC10 each need PC06 and are independent of one another. PC11 needs PC06 and PC03's second def.
This keeps #560's order. The only reconciliation is that PC05 owns the `shared.busy` change to `insert`, because it
creates the first claimed receipts.

**First fixture** (PC06):
- **Scene.** A fake-mind world. Two owned humanoid Souls, Ada and Bo, each with their own owner and CLI, stand on
  level-0 ground. One loose beam is there: a `core-rack-beam` revision with `shared-carry`, two grips, crew `[2, 2]`.
  A named destination is 8 m away, with no obstacle between.
- **Propose.** Ada's owner asks for "carry the beam to the shed with Bo". Ada acts `carry-with`, and her receipt is
  `waiting` with `awaitingAnswer` naming Bo.
- **Accept.** Bo's owner says yes. Bo acts `accept {invite, revision: 1}`, and Bo's receipt is `waiting`.
- **Commit.** Ada and Bo both stand within 10 m of the beam, so they are ready, and both receipts become `started`
  with the same `op` in the commit's tick. The native gather then walks both of them to their grips.
- **During the carry.** Bo says something, and the carry continues. Bo's owner asks Bo to sit, which is refused
  with `shared.busy` and offers `stop-carry`; Bo does not stop.
- **Arrival.** Both receipts end `completed` with `result: 'arrived'`. Each `for` links to its own owner's message.
  Afterwards, a third unrelated Soul has walked throughout.

The PC06 proof is this journey on the real client at real speed. PC08 reuses it, with Bo acting `stop-carry` mid-move.

## Later templates

`raise-hold` (PC13, [#692](https://github.com/genekogan/souls/issues/692)) uses this session, op and stop as they are, with
no destination: its `destination` is a placeholder and its `cleanup` is `lower-here`. Its native programme doesn't end by
itself. Holding is a phase, so the claims and receipts stay for as long as it is held, and the only way out is the stop.
See [soul actions](../architecture/soul-actions.md).

`connect-beam` (PC14, [#693](https://github.com/genekogan/souls/issues/693)) keeps the same session and op, with exactly two
members. Its `destination` names the two uprights, the column and the seat height. Its `beam` field holds the two uprights
and their seat connectors. It ends `arrived` (the receipts' `shared.seated`) once the beam is seated. A stop lowers a
lifted beam back where it lay. A raise whose upright a beam joins changes its stop: the crew lets go only when the frame
stands on its own, and until then keeps holding.

`install-joist` and `lay-sheet` (PC15, [#694](https://github.com/genekogan/souls/issues/694)) keep the same session and op,
with exactly two members. The session's `seat` field holds the engine step it commits (`install_joist_v1` or
`lay_sheet_v1` and its params, the crew added at commit) and, for a joist, where along the bay it goes. They end
`arrived` (`shared.seated`) once every bearing connector is joined; a stop lowers a lifted part back where it lay.

## Exclusions

- No universal animation language, all-body support, scheduler or building bridge.
- No multi-manoeuvre advance consent. Each commit covers one bounded manoeuvre, and another manoeuvre needs a new
  proposal.
