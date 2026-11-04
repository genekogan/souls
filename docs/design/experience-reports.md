# Experience reports and episode diagnosis

Future design for [#590](https://github.com/genekogan/souls/issues/590), with correlation/contract qualification in
[#592](https://github.com/genekogan/souls/issues/592). No new collection is enabled by this document.
The goal is to inspect an actual game episode, understand an undesirable experience and turn a supported diagnosis
into a reproducible improvement—even when no exception occurred.

This is also the field-learning component of [agency quality](agency-quality.md) and
[tranche #623](https://github.com/genekogan/souls/issues/623). The shared correlation/timing contract remains
#592; [#624](https://github.com/genekogan/souls/issues/624) adds a localhost episode inspector and
[#625](https://github.com/genekogan/souls/issues/625) defines evaluation validity. Local capture and remote
sharing are independent opt-ins, both disabled by default. Develop one useful local episode before expanding
upload/aggregation. No feature or data collection is enabled by this planning expansion.
The November 3 controllability revision starts with a minimal trace/readout; neither a complete browser viewer
nor this reporting service blocks a demonstrated control fix. Each small release can use existing health
evidence and deliberately opted-in local episodes, with a bounded observation window and honest missing feedback.

## Reuse the evidence we have

Edge actions already have client references and [receipts/outcomes](../architecture/souls.md). The client has a
durable queue and owner-result reporting. [Own-request diagnostics](../../apps/server/src/own-request-diagnostics.ts),
[God trace](../../apps/server/src/god/trace.ts), load/heartbeat records and client-error reporting are additional
sources to qualify. Some diagnose a different request path or current state rather than failure-time state; verify
coverage and retention before relying on them. The existing CLI `report` answers the owner and is not a remote
experience-report upload service.

Keep this distinct from [operational alerting #461](https://github.com/genekogan/souls/issues/461) and
[project visibility](project-visibility.md). A healthy server can still deliver a bad experience.

## A small first journey

An owner or authorized agent opts in and reports: “I asked to dance here; nothing happened for several minutes.”
The report includes expected versus observed outcome, a bounded time span, available request/queue/action/receipt
identifiers, and optional deliberately selected context. A deterministic client helper attaches permitted local
breadcrumbs; the server joins relevant retained facts within the reporter's authorized scope. The result is a
private episode record with a concise timeline, evidence links, missing stages and candidate explanations.

| Stage | What to establish |
|---|---|
| Owner request / edge processing | Was it received, queued and dispatched? Local duration, client/version identity and available request correlation |
| Resolution | Which destination/action was resolved, or why no confident match was available |
| Admission | Accepted, refused or deferred; actual code, busy state, queue/load and retry/backoff where recorded |
| Execution | Native start, progress/wait, interruption, replacement and terminal receipt; preserve accepted versus completed |
| Owner experience | What the client reported, when, and how it differed from the requested/observed outcome |

Separate edge processing, local queueing, network uncertainty, server admission and physical execution. Use local
monotonic durations plus server ticks/sequences/timestamps and explicit clock uncertainty; do not subtract clocks
from unrelated machines and call the difference latency. Use existing IDs where reliable; carry missing correlation
explicitly through a future protocol addition rather than guessing from nearby timestamps.

No server record may mean the edge never sent a request, or the record expired. A current body state is not a
historical snapshot. An absent prompt, local wait or network interval is unknown, not proof of who caused the delay.
Bounded server history and optional local capture must exist before an episode can be recovered; reporting later
cannot reconstruct facts that were never retained.

## Opt-in capture without burdening the mind

Start with the smallest shared evidence contract and a useful local episode/readout, then selected manual reports;
optional upload, bounded anomaly triggers and aggregation follow only after that journey works. Local inspection
does not require sharing. The agent can flag an unexpected result in one report, without narrating every
action, repeatedly polling, or performing extra model calls. A bounded local ring and asynchronous upload queue
belong in client code, not model instructions. Exclude report data from ordinary Soul context and perception.

Specify byte/time/count caps, rate limits, deduplication, retry ceilings, expiry and dropped-record counts. Uploads
must yield to gameplay; offline or overloaded collectors cannot block an action or retry the action itself. With
debug off, add no report traffic or model-context growth. Measure local CPU/I/O, server assembly and request/tick
latency for debug off/on, idle/distant/active, slow collector and disconnect cases. Set budgets from those results.
Use bounded indexed server queries and queues, not an unbounded synchronous scan or full-world snapshot per report.

Capture successful and ordinary episodes as well as failures. Distinguish human feedback, agent-reported confusion
and measured facts; retain selection bias and denominators when known. Agent annotations are optional and linked
to evidence, not authoritative diagnoses. Keep raw permitted events separate from derived summaries, with schema,
controller/host/client/world versions, omissions and clock provenance. The localhost viewer uses the same records;
it must not consume gameplay cursors or create a second polling/control loop. Selected text/media, ongoing upload
and external-model analysis require explicit scopes; an anomaly trigger cannot authorize sharing by itself.

## Privacy and supervision

Default to structured operational facts. Do not upload raw agent transcripts, hidden reasoning, credentials,
environment files, owner conversations or screenshots. Selected text/media requires explicit attachment consent
and scope; redact locally before transfer, with defensive server validation as well. Let the sender see what will
be shared. Confirm reporter, Soul/world access and referenced records server-side; a guessed identifier cannot
retrieve another owner's private context. Other participants' private content stays outside the reporter's bundle.

Define retention, deletion, access audit and per-owner/world storage limits. Protect evidence downloads and caches
as well as the page itself. Reports and logs are untrusted data, never instructions to a triage agent. Collecting a
private report does not authorize its publication or transmission to an external model. Make any analysis consent
explicit; keep raw reports out of public issues and changelogs. Sanitized findings can be promoted after review.

The owner-only project view can link private episodes. A compact diagnosis separates observed facts, the reported
expectation, hypotheses, confidence and the smallest reproduction. Group repeated symptoms and distinguish bugs,
latency, unclear refusals, misleading feedback and supported behavior that still disappointed the owner. Keep a
bounded triage inbox; avoid an automatic issue per refusal or self-triggered remediation loop.

## Qualification and follow-through

Exercise busy-loop dance, an unresolved place, a slow accepted walk, an offline edge with no server receipt, a
successful slow action and an unauthorized cross-owner report. Demonstrate useful reconstruction without an
exception. Preserve missing/expired data, unsynchronized clocks and capture-off cases honestly.

Where retained state/inputs permit it, reproduce in an isolated fake-mind fixture. Timeline reconstruction is not
deterministic replay; label it replay only when inputs, state, build and dependencies support that claim. A confirmed
finding becomes a sanitized issue, then a focused regression, PR and visual proof where required. Link the outcome
back to the episode. No always-on model observer, new third-party service, scheduled agent or automatic production
change is needed for the first version.
