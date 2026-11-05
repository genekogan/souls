# Agency quality: fluid agent–Soul control

Design direction for [tranche #623](https://github.com/genekogan/souls/issues/623), developed from the owner's
November 2 review and November 3, 2026 controllability reassessment. This is a planning specification, not a claim
of implemented behavior or authorization to collect telemetry, run live/model experiments, replace a harness,
relax world rules or deploy. Issues hold
execution state; this document holds the shared reasoning and contracts. Candidate solutions earn adoption
through evidence and can be revised, rejected or left inconclusive.

## The experience to improve

An owner should be able to ask an ordinary agent to control a Soul without understanding whether it is using
a thin CLI, an inner agent or a managed controller. Simple directions should begin useful activity promptly.
Longer intentions should survive distractions, conversation and recovery. Reasonable actions should work;
necessary refusals should be understandable and recoverable. The Soul should be expressive, reactive, accurate
and honest about progress, while its owner can understand a delay and change course.

Treat these as several outcomes, not one speed score. A quicker acknowledgment is not earlier movement; a
quick answer that loses the errand is not good control. Intentional waiting, physical travel and chosen social
attention can be appropriate. Measure the owner's repair work, surprise and trust alongside completion,
responsiveness and system cost. No universal first-action latency target is established by this design.

## Deliver useful control improvements incrementally

The objective is a Soul that carries an intention over short and long horizons, receives relevant changes
promptly, acts without avoidable delay and remains steerable while doing so. Observation is an enabling tool,
not the product finish line. The chosen sequence is basic passive telemetry, a bounded local debugging UI,
core controllability, then advanced demonstrations and physical collaboration. A comprehensive dashboard,
fleet reporting system or harness replacement must not expand the initial diagnostic phases indefinitely.

The ordered assignments and release journal live in [#623](https://github.com/genekogan/souls/issues/623).
Each implementation slice owns one independently useful outcome and its proof, normally within a single-digit
number of active hours including relevant verification. Split larger work without hiding unfinished acceptance.
The initial exceptions to visible product benefit are a bounded current-path/contract audit and measurement
qualification. Their endpoint is enough trustworthy evidence to select and prove the first improvement.

Every product PR states the expected user benefit, the observed baseline, changed mechanism, acceptance,
unrelated behavior/cost guardrails and rollback. Demonstrate the benefit by measurement or uncut real-speed
visual evidence; use both when the claim involves timing and visible behavior. Protocol tests support but do
not replace real-agent evidence for agent-quality claims. A clip proves what occurred in that episode, not a
population-wide improvement. No-op qualification can retire an obsolete finding with evidence; it is not a
new improvement. Reject an ineffective candidate rather than manufacture a PR or mark the product goal met.

Begin with one supported control path used in ordinary play, documenting how it was identified. Distinguish
direct chat, legacy live and managed control; do not claim cross-host coverage from one adapter. Reuse existing
listeners, dashboards, task state and receipts. Add only missing fields necessary for the next question. A
small trace/readout establishes the contract for the early browser viewer and subsequent control fixes.
Expand coverage by a named subsequent slice, never silently drop other supported paths.

### Running intentions and responsive activity

An intention is more than a queued command or a successful receipt. Preserve its requested outcome, constraints,
latest owner revision, completed effects, remaining work and actual wait/dependency across interruptions.
Represent the distinctions using existing task/session state before inventing another planner or intent store.
The following behavior is required, independent of internal representation:

- A temporary question updates understanding and permits an appropriate response without erasing the errand.
- An owner change to destination, constraint or priority updates the relevant work. Explicit replacement or
  cancellation invalidates obsolete queued steps; completed or uncertain public effects are not blindly replayed.
- A sustained activity can coexist with compatible conversation, or pause/resume through native mechanics.
  Model-turn interruption does not automatically cancel the body. Incompatible activities obey physical rules.
- Waiting has a reason and a wake condition or a bounded progress check where supported. Slow travel, deliberate
  reading and provider delay are not automatically a deadlock. A missing receipt or host connection remains
  unknown until reconciled; exhausted recovery reports a useful blocked state instead of silent success.
- An event burst must not cause endless replanning, starvation of the owner's task or lost critical updates.
  Coalesce redundant observations where safe; preserve owner revisions, required events and terminal receipts.
- Restart/reconnect restores the latest intention without repeating completed effects or resurrecting cancelled
  work. Host exit, unsupported wake mechanisms and operating-system sleep remain explicit availability limits.

Measure reception, host delivery, useful response and physical course correction separately. "Immediate" means
avoiding unnecessary blocking and promptly offering urgent information through supported host mechanisms;
it cannot promise zero inference/network delay or cognitive incorporation at every instant. Set practical
per-slice latency/progress bounds from baseline before comparing candidates, and report misses and unknowns.

### Stress and transfer as part of each slice

Reuse existing test/playtest machinery. Establish a small versioned family of tasks and perturbations rather
than a new test platform or a large Cartesian scenario catalogue. Select the relevant subset for each change:
simple travel/action, an interrupted sustained activity, a multi-step intention, and an expressive composition
of existing actions. Vary wording, targets, starting state and relevant ambiguity; reserve examples before tuning.

Stress factors include slow/refused observations, overlapping read and speech, event bursts during a model
turn, owner revision/cancel while work is queued, lost/duplicate/out-of-order receipts, temporary disconnect,
controller restart and bounded crowd/load. Seed one fault at a time for causal diagnosis, then a small selected
combination for integration. Inject faults only in isolated fixtures, never production traffic.

Use deterministic/fake-host cases for fidelity, ordering, no duplicate effects, retry limits and bounded
recovery. Use separately authorized real-agent comparisons for usefulness and expressivity. Keep model/effort
and relevant conditions matched, retain all attempts, use repetitions appropriate to the claim and label
insufficient samples honestly. Existing minimum repeats remain required but do not establish significance.
Long-horizon proof names actual elapsed duration, interruptions and restarts; a compressed clock test proves
state mechanics, not hours of reliable ordinary play. No claim of indefinite unattended operation from a clip.

For expressive composition, use at least two materially different unseen intentions involving existing
movement/activity, communication and owner revisions or social interruptions. Judge satisfied intent,
appropriate response, continued progress and owner repair burden, allowing different valid plans and dialogue.
More action types, chatter or shorter average time alone are not evidence of more expressive agency.

### Release and learn while development continues

Release independently useful qualified changes in small coherent batches through the existing release owner,
not one release per ticket and not one final big-bang release. The coordinator maintains issue-to-PR-to-release
links and separates implemented, proved, reviewed, merged, released and observed in use.

Each candidate batch records its intended benefit, exact versions, scoped proof, consented observation plan,
sampling window/budget, denominators where known, regression thresholds and rollback/disable procedure before
activation. Existing admission/world health and unrelated-actor behavior are guardrails. Monitor correct useful
starts, response/correction delay, preserved intentions, avoidable refusals and owner repairs alongside those
guardrails, with missing observations explicit. Use existing health evidence and opted-in episodes; do not add
background agent monitors or silent calls home. A human review request is not permission to collect their data.

At the end of the bounded observation window, record retain, revise or roll back with evidence and uncertainty.
If natural-use feedback is unavailable, report that limitation; staging success is not field validation.
Critical loss/duplication of actions, stale cancelled work, access violations or world-health regression stop
further rollout and invoke the authorized rollback path. Define smaller practical regression limits before
rollout rather than selecting them after seeing results. Preserve required gates and original failed evidence.

Gene reviews the first visible benefit batch and material product choices, such as changing a justified action
restriction, adopting a different host architecture or expanding scope/resources. Group required T3/T4 approvals
into coherent review packets where allowed; do not waive them. Routine milestones continue within the authorized
agenda. Independent technical review and a resolved shared contract are still needed before dependent work.

## What is known, and what is only suspected

The original [continuity plan #22](https://github.com/genekogan/souls/issues/22) and
[follow-ups #464](https://github.com/genekogan/souls/issues/464) already cover asynchronous intake, durable goals
and gatherings. The current managed supervisor receives independently of inference and uses host steering;
the thin skill also supports direct control, with a managed controller as an option. Source inspection found
one structured call per managed decision, freshness/replan rules and substantial controller instructions.
Their contribution to a particular delay is unmeasured. Inventory actual installed/served paths before
generalizing from the source. A closed historical issue is not current behavioral qualification.

These source leads were inspected at main `9c0862b0621d0cffbb8473f6c5dc9143fb5da8b3`: the
[managed supervisor](../../tools/soul-runtime/supervisor.mjs),
[thin skill](../../tools/world-launcher/soul/skill.md),
[request admission](../../apps/server/src/load/admission.ts) and
[activity offers](../../apps/server/src/edge/ledger/activities.ts). They are audit inputs, not incident traces.

The [responsiveness investigation #344](https://github.com/genekogan/souls/issues/344) repaired event fidelity
and explored combined acknowledgment/listening; [study #345](https://github.com/genekogan/souls/issues/345)
did not establish a general speedup. Earlier dance fixes and server capacity work are also inputs to verify,
not proof that the current failure still exists. Preserve original failed and inconclusive evidence.

| Hypothesis | Evidence that would distinguish it | Reasons to reject or narrow it |
|---|---|---|
| The first observation lacks the decisive destination/action facts | Retained input lacks an unambiguous target or usable offer; focused discovery supplies it before action | Necessary facts were already present, or time is dominated by admission/startup |
| Irrelevant context or instructions impede simple choices | A controlled relevance/size/instruction comparison improves correct useful action with constraints preserved | Smaller inputs increase guessing, or matched results show no practical benefit |
| Serial tool/model cycles and restart/replan rules add friction | Attributed spans show redundant handoffs or discarded useful work; a narrow host-loop change removes them | Native alternatives lose continuity, increase errors or show no transfer |
| Event delivery is prompt but incorporation/action is late | Correlated intake, host, decision and native activity stages separate the gap | Missing host evidence cannot establish the gap's cause |
| Refusals are avoidable | Stable-state offers disagree with admission, geometry is wrong, or a restriction has no justified product purpose | The state changed or the refusal protects an actual physical/consent boundary |
| Busy handling blocks legitimate interaction | Normal concurrent requests cause exclusion, retries, cooldowns or relaunches with known limiting resources | The observed delay is another component or a candidate harms fairness/health |
| The observer changes what it measures | Capture/viewer/export modes alter latency, wake patterns or behavior relative to off | Effect is below a declared useful bound with adequate measurement sensitivity |

These causes can reinforce each other: missing information leads to more calls, contention/refusals, more
recovery context and more decisions. Locate the chain before changing several factors at once. Large context
causing more reasoning is a hypothesis, not an established model property. Unattributed host time is unknown.

## Observe one episode accurately

[Contract #592](https://github.com/genekogan/souls/issues/592) defines the common record used by the
[local inspector #624](https://github.com/genekogan/souls/issues/624) and
[experience reports #590](https://github.com/genekogan/souls/issues/590). Reuse current receipts, event cursors,
host/tool events and diagnostic hooks before adding fields. A simple walk and a refusal are initial observer
fixtures, not the program's behavioral benchmark. Extend the schema only when another real episode needs it.

Each record needs a schema version, source and clock/process identity, sequence/causal links, evidence type,
collection scope and omission status. Correlate episode/task/owner revision, controller/host session/turn/tool,
observation, logical operation/request attempt, receipt and native activity where those identifiers exist.
Keep logical operations separate from retries. Record missing links instead of joining by nearby timestamps.
Preserve many-to-many relations: one intention may require several actions; an observation can affect several
decisions. A parent chat's handoff to an inner mind needs linkage when the host exposes it.

| Stage | Facts to retain within consented scope | Distinction the viewer must preserve |
|---|---|---|
| Owner and controller | Request/revisions, first observable origin, control mode, host/client/world version, connection and lease state | Pairing/listener presence does not prove the mind is available; a missing origin cannot be reconstructed |
| Perception | Capture/source time, receipt/delivery time, requested scope, actual permitted response, freshness, truncation/omission and bytes | What the world knew, what the client received and what was delivered to the agent differ |
| Host and decision | Input offered/accepted, observable incorporation evidence, turn/tool lifecycle, selected action, replan/interrupt/restart reasons | Host ACK is not comprehension; visible output is not access to hidden reasoning |
| Transport and admission | Logical operation and each attempt, send/receive, queue/service bounds, refusal source, retry guidance/actual wait | Sender admission, listener caps, host busy and target activity are different |
| Physical world | Receipt accepted, native program started, actual movement/activity/seat observation, progress and terminal result | Accepted, started, arrived, physically doing and completed are distinct |
| Feedback and experience | Response shown, expected/observed annotation and source, task closure and owner correction | A completion claim is not completion evidence; dissatisfaction is a report, not a diagnosis |

Use local monotonic durations within clock segments, server ticks/sequences and wall-clock timestamps for
display. Retain clock uncertainty across hosts, restarts and clock adjustments. Never subtract unrelated
clocks and call it exact latency. Show intervals or unknowns when only bounds are defensible. Timestamp an
image's capture and delivery separately; inspecting it later must not make it look fresh. Retain available
input/output/cache/token accounting with provenance; bytes are not tokens and neither is reasoning duration.

Qualify the observer with known delayed/reordered/duplicated events, retries, unknown writes, restart, skew,
missing origins and dropped/truncated records. Check that evidence really distinguishes the milestones above.
Timeline reconstruction is not deterministic replay unless retained inputs, state and versions support replay.

## Local inspection, sharing and observer cost

The localhost browser should make a selected episode inspectable across owner intent, agent/tool work,
observations, transport/admission, physical activity and feedback. Link each interval to permitted payloads,
receipts and already-collected visual samples. Show active controller mode and why it is waiting, with explicit
unknowns. Filtering and summaries must retain a route to original permitted evidence and visible missing data.
This is separate from the project board and operational health dashboard.

Local capture and remote sharing are independent explicit opt-ins, both disabled by default. Opening local
detail must not enable calls home. Separate consent for selected text/media, ongoing upload and external-model
analysis; preview the selected export. Do not collect credentials, environment files or hidden reasoning.
Protect other participants' private content and local access: loopback binding alone is insufficient without
origin/access checks. Render world strings as data, never HTML or agent instructions. Retention, deletion,
redaction, quotas and authorized server joins remain in the [reporting design](experience-reports.md).

Capture mechanically at existing boundaries; no per-action narration, extra model evaluation, gameplay polling
or additional pictures solely for telemetry. A compact optional agent/human annotation can say what was expected,
what happened and where it became confusing. Agent frustration detection is a hypothesis about experience.
It must not automatically authorize upload or production repair. Include successful and ordinary episodes,
not just failures; self-selected reports do not establish population-wide rates.

The observer is a passive subscriber with its own bounded diagnostic buffer, separate from durable gameplay
state. It cannot advance the controller's consumption cursor, issue actions or become a second controller.
Bound storage, queue depth, payload sizes and retention; count dropped/truncated diagnostics. Gameplay cannot
wait for a slow viewer, disk or export, and dropped telemetry cannot justify dropping a required world event.
Use asynchronous bounded export with capped retries; no action retries caused by logging failure.

Measure off, local capture, open viewer and export modes under idle, active, crowded, slow-consumer/disk and
offline conditions. Report CPU, I/O, memory/storage, events/bytes, wakeups and effect on gameplay timing. Off
adds no reporting traffic, capture-driven model calls or model context. Declare practical overhead budgets
from baseline and before comparisons; do not claim literal zero observer cost. Heavy visual capture belongs
in a separately identified mode, if requested, whose perturbation cannot be hidden in normal-mode results.

## Investigations that can earn implementation

### Native hosts and fluid control

[Investigation #626](https://github.com/genekogan/souls/issues/626) compares actual direct/managed paths and the
current structured-decision loop with supported persistent host/tool behavior. Prefer the mainstream host's
session continuity, tool loop and documented steering/background mechanisms where qualified. Revalidate
[Codex App Server steering](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn),
[Claude Code Channels](https://code.claude.com/docs/en/channels) and
[SDK streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) against installed
versions, availability and authentication. Native input delivery is not a guarantee of immediate incorporation.
Instructions alone cannot create unattended availability through host exit, OS sleep or an unsupported wake API.

Keep receiving, thinking and physical execution independent, with one authoritative decision owner. Promptly
retain information; coalesce ordinary observations and deliver urgent relevant changes through supported host
mechanisms. Avoid an endless replan loop in a busy venue. Distinguish updating understanding, changing a plan,
pausing/resuming, replacing an activity and explicitly cancelling it. Model interruption must not implicitly
cancel the body. Allow compatible activity/conversation overlap only where native mechanics support it.

Retain necessary Soul-specific durability, action receipts, deduplication and uncertain-write reconciliation.
Do not rebuild host memory/scheduling without a demonstrated gap. Compare the smallest architectural change;
disclose unavoidable bundled differences. Coordinate [#476](https://github.com/genekogan/souls/issues/476),
[#485](https://github.com/genekogan/souls/issues/485) and
[#481](https://github.com/genekogan/souls/issues/481): prompt replies must preserve the original read, errand,
constraints and deadlines. A human should not need to choose an internal harness to get understandable control.

### Relevant information and useful first action

[Investigation #627](https://github.com/genekogan/souls/issues/627) asks when sufficient authoritative facts first
became available and what happened afterward. Compare missing/ambiguous information, irrelevant volume,
instruction complexity, repeated snapshots and ritual discovery separately from startup, provider and server
waits. Include cold/warm and long-session contexts. Preserve identity, freshness, ambiguity and owner constraints.
Explore focused retrieval, progressive detail and directly executable offers before more instructions or a
universal smaller context limit. Do not require a validation round trip before every already-clear action.

Measure correctness and repair alongside first physical progress. A smaller prompt that hides the needed
offer or encourages guessing fails. No special park route or benchmark-only fast path; retained observations
and controlled comparisons must explain gains and transfer to unseen requests.

### Reasonable actions and honest refusals

[Investigation #628](https://github.com/genekogan/souls/issues/628) separates necessary physical/consent
constraints, questionable product rules, false geometric refusals, misleading offers, changed state and bad
invocation. An old constant or coding precaution is not sufficient product justification. In unchanged valid
state an advertised available action should execute or expose a specific remaining precondition.

Reconcile existing dance repairs before proposing more clearance changes. Seek a valid expressive action with
understandable limits; preserve actual support/collision/ownership. A smaller motion or actionable alternative
may help, but never silently relocate “here,” substitute the goal or claim completion on refusal. Include
legitimate impossible cases and unseen environments. Reduced aggregate refusal rate is not enough if achieved
by hiding invalid actions or suppressing useful feedback. Coordinate body and cooperative-action contracts.

### Busy is a resource diagnosis

[Investigation #629](https://github.com/genekogan/souls/issues/629) attributes each refusal before changing
limits. The inspected server admits one outstanding heavy request per Soul across reads, acts and speech;
this is request lifetime, not the lifetime of physical activity. Listener caps and host busy responses also
need separate attribution. A conversation refusal does not by itself prove the recipient could not listen.

Examine normal async overlap, exclusion duration, queue waits, retry jitter, strikes/cooldowns and host
relaunches. Candidates include duplicate-read coalescing, bounded deadline-aware queues, cheap reads, bounded
capacity for communication/cancellation and withdrawal of obsolete queued work. No unbounded queue, stale
intent execution, blind retry of uncertain writes or removal of all capacity protection. Faster control that
harms unrelated Souls or world tick health is a regression. Coordinate existing capacity/calibration
[#450](https://github.com/genekogan/souls/issues/450)/[#451](https://github.com/genekogan/souls/issues/451)
and host recovery [#470](https://github.com/genekogan/souls/issues/470).

## Evidence that reflects real play

[Method investigation #625](https://github.com/genekogan/souls/issues/625) defines how evidence earns confidence.
Three kinds of evidence complement each other:

1. Deterministic protocol/invariant and seeded observer tests establish that measurements and mechanics mean
   what they claim. They do not establish that ordinary agents feel fluid.
2. Bounded controlled comparisons isolate plausible causes, with matched or randomized/counterbalanced
   conditions and repeated stochastic runs. State what a test can and cannot identify.
3. Held-out transfer and opt-in ordinary-use episodes check whether gains matter beyond the development tasks.
   Human/owner review includes positive, negative and ordinary experiences and visible sampling bias.

Before a comparison, write the causal hypothesis, falsifying outcome, changed factor, alternatives/confounders,
primary outcome and guardrails, task distribution, sampling unit, budget/repeats/stopping rules and exclusions.
Separate exploration from confirmation and disclose adaptations. Match host/model/effort/version, session
history/cache, cold/warm state, world/load and device where appropriate. Deliberately vary them later to test
transfer. Shared-world interference and correlated steps from the same user/session are not independent trials.

Use diverse unseen wording, targets, worlds, starting states, interruptions, ambiguity and multi-step activities.
Do not grade an exact script when multiple valid approaches satisfy the intention. Reserve tasks before tuning;
failed examples may become regressions but cannot remain the only evidence. Avoid expanding E2E coverage into
an exhaustive brittle catalogue. A focused correctness fix can proceed with proportionate proof while broader
quality hypotheses remain open.

Check that candidate measures agree with owner/human judgments and inspect counterexamples. Collect judgments
without arm/metric disclosure where feasible. Correlation is evidence about a proxy's usefulness, not proof
of a causal intervention. Keep measures provisional where validity is weak. Faster first action, fewer tokens,
fewer refusals or higher completion can each conceal worse choice, lost intent or reduced expressivity.

Report all attempts and denominators, failures/censored timeouts/missing data, distributions and tails where
sample size permits, practical effects and appropriate uncertainty. Two repeats meet a process minimum, not
statistical proof. Do not infer a stable tail from a handful of runs, rerun until green, erase invalid runs or
pool pilot-informed results as independent confirmation. No single favorable mean, scripted pass or impressive
clip establishes general improvement. Qualify observer fidelity/perturbation before interpreting timing.

Each investigation ends with **adopt, revise, reject or inconclusive**, with evidence, limits and the next
decision. Adoption needs a credible mechanism, useful effect on valued outcomes, guardrail/cost results and
transfer beyond tuned examples. Small samples can justify a narrow reversible trial with explicit limitations
and rollback conditions, not a universal claim. Stop at the declared resource budget rather than running an
endless study. Existing safety/security/proof/release requirements remain; no gate waiver is proposed.

## Ownership and implementation handoff

Follow the [development coordinator contract](https://github.com/genekogan/souls/blob/main/docs/process/development-coordinator.md)
and #623's current dated agenda. Start with #592's bounded current-path/evidence inventory, qualify the minimal
passive trace and #625's small baseline/stress specification, then deliver #624's bounded local inspector.
Select demonstrated control defects for the first useful core batch. Elaborate viewer/reporting expansion is
not a prerequisite; a separately urgent evidenced correctness fix can proceed with a recorded ordering exception.
File implementation children when their outcome and evidence are concrete; retain the
15 original work issues as scope/evidence owners, not 15 giant assignments or a completion percentage.

#626 host-loop changes and #450/#451 capacity work are conditional routes to a demonstrated control benefit,
not unconditional foundations. Prefer supported mainstream host facilities and the smallest necessary Soul
bridge. A bounded comparison may reject a rewrite. Do not launch every lane or adopt all candidates. Record
the future coordinator's actual implementation, model/resource, merge and release authority before dispatch;
this design revision itself launches no workers, model runs, collection or deployment.

The existing continuity, scalability, action and reporting owners remain authoritative. Physical collaboration
[#560](https://github.com/genekogan/souls/issues/560) is a major workstream inside #623, with its full acceptance
preserved. Expressive actions [#26](https://github.com/genekogan/souls/issues/26)/
[#426](https://github.com/genekogan/souls/issues/426) retain their unrelated scope; accepted activities are reused.
Client performance #556, project visibility #581/#583 and operational alerting #461
are related but do not substitute for this experience-level work.

Apply independent review at the repository cadence and before shared-contract adoption; Gene's review points
are the product/release decisions above, not an automatic pause every one or two tasks. Determine proof tier
from actual surfaces: planning T0, local UI at least T2, shared behavior/runtime/engine changes often T3.
No production migration, automatic issue flood,
continuous model critic or central social director is implied. Preserve rejected hypotheses and historical
failures, update issues with dispositions and link implementation proof and eventual release evidence separately.

## Physical collaboration within the same control framework

The [physical collaboration design](physical-coordination.md) supplies the largest advanced application of this
control contract. Independently owned Souls agree to bounded execution together, retain their own intentions,
and return to independent activity. Mars construction is the first demanding application; partner movement,
performances, tools, preparation and games establish broader reuse. More animations alone do not establish
better agency, and core responsiveness must not wait for the construction programme to finish.

Use one existing decision owner per Soul and one authoritative world operation for a coupled maneuver. A shared
session is a temporary physical commitment, not a second mind, scheduler or global Soul lock. Receive owner
revisions and relevant events during execution; allow compatible speech and observation. An incompatible
physical change requests the accepted safe cleanup. Report stop receipt, cleanup progress, supported blockage
and actual resource release separately. Prompt reception cannot promise instantaneous inference or safe release.

| Shared boundary | Required integration |
|---|---|
| Evidence | Extend the common episode record with shared session/revision, role, capability/resource claims, operation and per-member outcomes; reuse the local inspector and report path |
| Intention | Keep the latest owner's outcome/constraints distinct from an assembly project's remaining structure; cancellation invalidates obsolete future work without erasing completed effects |
| Busy | Distinguish request admission, host availability and physical claims; holding a beam does not justify rejecting unrelated speech or all observations |
| Recovery | Reconcile host intent and uncertain writes with authoritative load/claims/effects; reconnect grants no new consent and cannot revive cancelled tasks |
| Discovery | Show compact relevant invitations, feasible roles and actual prerequisites; deeper blueprint/geometry details stay on request |
| Proof | Reuse the same fault probes, varied tasks and timing contract; add current-rig contact, support/custody and actual audio when relevant |

Correlation across participants is not permission to inspect another owner's private agent trace. Each owner
controls capture/export of their own diagnostic content. Join authorized world/session facts with consented
records, preserve redaction and missing links, and show partial visibility honestly. A coordinator or world owner
does not gain another participant's private prompts, observations or media merely by organizing shared work.

Inventory the interface constraints early; reconcile the minimum shared execution contract against the qualified
core behavior before building consumers. Do not freeze a universal collaboration API before the first carry.
Physical scope owners remain responsible for consent, readiness, atomic claims, safe cleanup and world state;
core control owners remain responsible for input delivery, retries and intent continuity. Contract changes have
one reviewed owner and named consumers, not duplicate implementations or evidence pipelines.

Qualify ordinary-agent discovery/agreement, compatible conversation, owner course correction, limited competing
claims and unrelated-Soul progress with the first safe carry. Each later family checks its own interruption and
restart semantics; final combined qualification tests interactions and full coverage rather than discovering
these requirements for the first time. Demonstrate the latest intent after release, including explicit cancellation.

One combined coordinator uses one serial implementation worker by default for this agenda. Keep proof/review
capacity inside actual limits and preserve other active owners. The durable order is diagnostics, inspector,
core control, expressive composition, safe carry, portable usable bay, other collaboration families, extended
Lab recovery and combined delivery. Exact assignments, dependency evidence, estimates and status live in #623
and #560. Carry and the first bay can ship independently; full closure still requires every required Lab,
activity-family and asset outcome. Source omissions trigger explicit work and reforecasting, not silent exclusion.
