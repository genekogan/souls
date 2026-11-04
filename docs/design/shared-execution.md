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
| **Propose** | The host's act `carry-with` (the parameters are the load, `to`, and `with`, the Souls asked) creates the invite at revision 1 and opens the host's receipt in `waiting`. A proposal moves nobody. Conversation membership does not count as consent. |
| **Accept / decline** | A guest acts `accept {invite, revision}` or `decline {invite}`, extending the current `accept:<invite>` and `decline:<invite>` offers. The guest's receipt for the shared operation is created at acceptance, in `waiting`, and linked in `guestReceipts`. If the revision is stale, the world refuses with `shared.revision-changed`, naming the current revision and what changed. A revision bump clears every acceptance, and each of those receipts ends `failed` / `shared.revision-changed`, so nobody holds a silently changed agreement. If nobody accepts by `expiresTick`, the responses become `expired` and the open receipts end `failed` / `invite.expired`, as they do today. |
| **Readiness** | Derived each tick and never stored. A member is ready while every one of these holds: they accepted the current revision; their body passes §4; their hands are empty (`hands.full` otherwise); locomotion is idle or at the grip spot; and they stand within reach of their slot's carrier spot. Moving away makes a member unready, without a message. Before commit, a member may leave freely (`decline`). |
| **Commit** | When every role is filled and every member is ready, the world commits in **one tick** (§2). The host does not commit for the others; readiness is each member's own act of standing at the load. The world either acquires every claim and submits one native `carry` with the members as its crew, or it changes nothing. A commit that cannot proceed leaves the session pending and names the blocker on each member's receipt (`shared.not-ready`, naming who and why), and the world tries again when readiness changes, until `expiresTick`. A commit that is refused for good (for example `carry.no-route`) ends every receipt `failed` with that diagnostic. |

## 2. Operation, claims, per-member receipts and retries (A1)

**Operation identity.** At commit, `op = {id: 'op_' + invite + '_r' + revision, actionId, committedTick, claims}`.
`actionId` is the native `carry` record. The id is a pure function of invite and revision, so a repeated commit,
whether a retry, a duplicated tick or a replay, finds the existing `op` and never submits a second `carry`.

**Claims.** `claims` lists `{soulId, capabilities: ['hands', 'locomotion']}` for each member, plus `{entity: load, by: op}`
for the load. The load claim is the native `reservedBy`. Claims name the capability they hold, so the busy refusal in
§3 can say what is occupied. The first template claims only `hands` and `locomotion`. `stance` and equipment claims
come with the templates that need them (PC13 onward).

**Per-member receipts.** Each member has exactly one receipt for the operation: the host's receipt from the proposal,
and each guest's receipt from acceptance. Phases use the existing `ReceiptPhase`:

| phase | meaning |
|---|---|
| `waiting` | accepted and not committed. `awaitingAnswer` keeps naming who is still undecided, as it does today |
| `started` | committed; `startedTick = committedTick`. `firstMotionTick` (#790/#810) is the tick this member's body first moved |
| `completed` | the native `carry` ended and the claims are released |
| `failed` | refused, expired, revision-changed, or the commit failed for good, with the diagnostic |

`replaced` never applies to a shared receipt (§3). A completed receipt's `outcome` (`EdgeOutcomeV1`) has a `shared`
detail: `{op, role, slot, result}`. `result` is one of:
- `arrived`;
- `stopped` (withdrawal, set down early);
- `blocked-then-released`.

The `summary` says who carried what, from where to where. Each member's `for` links to *their own* owner message,
through `OwnerLoop.link` on their own act. Nobody's receipt is linked to another owner's message.

**Retries.**
- HTTP retries of `carry-with`, `accept`, `decline` and `withdraw` use the existing `Idempotency-Key` middleware
  (`edge/events/idempotency.ts`): the same key returns the original response and acts once.
- A logical retry, meaning a second `accept` of the same revision by the same member, is a no-op that returns the
  existing receipt.
- A retry after an unknown result reads `GET /v1/edge/receipts/:id`, or uses the durable operation lookup
  (`edge-operation-lookup.test.ts`). A row that has expired answers unknown, never a replay.

**Restart ownership.**
- The invite row is the authority for the session and its `op`.
- The engine's checkpoint and log are the authority for the carry's motion: `construction.test.ts` shows the host
  replaying a native mid-carry.
- Commit writes `op` into the invite in the same transaction that logs the engine submit. If the transaction did not
  commit, neither exists.
- On start, reconciliation works like this:
  - An `op` whose `actionId` is live in the engine stays `started`.
  - An `op` whose action ended is closed with that action's outcome.
  - A session without `op` stays pending, and readiness is re-derived.
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
- the safe stop on offer: a `withdraw:<op>` capability in `alternatives` (#824/#826).

It replaces nothing, and the refused act's own receipt records the refusal. The owner's message that asked for it
stays in the owner's inbox, unacked by the world. Nothing is silently lost, and the agent decides whether to withdraw.

An act that needs no claimed capability, for example `say` or an attention act, is unaffected. Solo actions outside a
shared session are unchanged.

**Withdrawal.** Any member, the host included, may act `withdraw {op}`.

- **Acknowledge at once.** The withdraw act's own receipt completes in the same tick, with the outcome "stop
  requested". This is the prompt stop acknowledgment. It is not a physical release. The op's phase becomes `stopping`,
  and every member's shared receipt gets `reason: 'stopping: <name> withdrew'`.
- **Supported cleanup.** The world cancels the native `carry`. Its cancel never drops a load:
  - during gather, the walkers simply stop;
  - during lift, the load is lowered back where it lay;
  - during move, it becomes a controlled set-down at the current pose if that spot is clear.

  Members' bodies finish only that disclosed cleanup.
- **Inability to release safely.** The native cancel refuses in two cases: `carry.cancel-unsafe` on a stair flight,
  which the first template excludes, and a set-down spot that is not clear. Then the op enters `blocked`:
  - the claims are kept, because the load is still supported;
  - every member's receipt names the reason and the blocker;
  - the world retries the cancel every 1 s of world time, and the set-down succeeds as soon as it can;
  - the assistance route is spelled out: clear the named obstacle, or ask a ready replacement (PC08).

  Unrelated Souls and every member's speech continue. No timeout fakes a release, and there is no global lock.
- **Release.** When the native action ends, the claims are released in the same tick, and each member's receipt ends
  `completed` with `result` (§2). Each stream is back to its own idle, with nothing resumed.

  The world does not replay the act it refused with `shared.busy`. Before anything is resumed, the agent reconciles
  with the owner's latest intent, as in S3 entry 4: a cancelled walk is never resumed.

**Mind disconnect.** A disconnected mind's body keeps its accepted manoeuvre to its end, and never joins anything
new. A pending acceptance from a disconnected mind still counts until `expiresTick`. On reconnect, the same receipt
shows the actual outcome. PC09 ([#688](https://github.com/genekogan/souls/issues/688)) proves this.

## 4. Envelope of the first template (A3)

| dimension | v1 | refusal before any movement |
|---|---|---|
| body | humanoid family (`packages/protocol/src/body-v1.ts`) with two free hands | `body.unsupported` (`edge/body/actions.ts`) for floater, ceramic and creature bodies, or any custom body whose capabilities lack hands; `hands.full` |
| body swap | none while invited, accepted or committed | `body.safe-standing-required`. *Change:* `bodyAssignmentReady` treats an accepted shared role like `together.awaiting` |
| load | a loose def with `components.carryable`, `handling.grips` covering the crew, and opt-in tag `shared-carry` (PC03) | `carry.no-grips`, `carry.crew-too-small`, `carry.crew-too-large` |
| crew | 2 for PC06 and 2–4 for PC11, never beyond the native maximum of 8 or the def's `carryCrew` | `carry.crew-too-small` with the arithmetic (`MAX_KG_PER_CARRIER = 30`) |
| ground | level 0 only, the start and destination on the same level, no stair flights | `carry.ground-only` (exists for the solo carry) |
| route | the whole formation, planned by the native planner at commit | `carry.no-route` and the planner's named blocker |

The solo upright carry, `fixtureCarry` through `mars:move_fixture`, is unchanged. A load that needs more than one
carrier keeps refusing solo with `carry.crew-too-small`. *Change:* the refusal's `alternatives` offers `carry-with`.

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

This contract builds on all of them. Its new boundary questions are the ones above:
- busy refuses rather than replaces;
- withdraw is acknowledged at once, cleanup is supported, and a member can be blocked;
- commit is idempotent.

## 7. Surface map, fixture and order (A4)

| contract piece | current surface | PC |
|---|---|---|
| loose beam and sheet defs, opt-in `shared-carry`, a new `core-rack-beam` revision, and a conformance supplement | `packages/world-compiler/src/core-kit/authoring/work.mjs`, `packages/conformance/conformance/` | PC03 [#682](https://github.com/genekogan/souls/issues/682) |
| `kind: 'shared'` invites, revision, accept and decline against a revision, expiry | `edge/ledger/together.ts` | PC04 [#683](https://github.com/genekogan/souls/issues/683) |
| readiness, atomic commit, claims, `shared.busy` instead of `replaced`, per-member receipts | `edge/ledger/ledger.ts` `insert`, `god/engine-bridge.ts` (crew `carry` submit) | PC05 [#684](https://github.com/genekogan/souls/issues/684) |
| the native crew `carry` through the bridge, `carry-with` offers, the solo refusal's alternative | `god/engine-bridge.ts`, `mars/viewer/engine/carry/` | PC06 [#685](https://github.com/genekogan/souls/issues/685) |
| a brief obstruction wait, detour or lasting blockage for the formation | native `planner.ts` and `blockedWait` | PC07 [#686](https://github.com/genekogan/souls/issues/686) |
| `withdraw`, `stopping`, `blocked` and release | the ledger plus the native `cancel` | PC08 [#687](https://github.com/genekogan/souls/issues/687) |
| disconnect and reconnect | the ledger and the owner loop | PC09 [#688](https://github.com/genekogan/souls/issues/688) |
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
- **Commit.** Both walk to their grip spots, and within one tick of both being ready both receipts are `started`
  with the same `op`.
- **During the carry.** Bo says something, and the carry continues. Bo's owner asks Bo to sit, which is refused
  with `shared.busy` and offers `withdraw`; Bo does not withdraw.
- **Arrival.** Both receipts end `completed` with `result: 'arrived'`. Each `for` links to its own owner's message.
  Afterwards, a third unrelated Soul has walked throughout.

The PC06 proof is this journey on the real client at real speed. PC08 reuses it, with Bo withdrawing mid-move.

## Exclusions

- No universal animation language, all-body support, scheduler or building bridge.
- No multi-manoeuvre advance consent. Each commit covers one bounded manoeuvre, and another manoeuvre needs a new
  proposal.
