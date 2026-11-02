# Project visibility and visual release history

Design for [#581](https://github.com/genekogan/souls/issues/581). The private project view is not yet deployed; the
[bounded owner-overview implementation](../operations/owner-overview.md) documents its collector and access boundary.
Keep it read-only and small. Conversation remains the place to change priorities or give feedback.

## One record, two audiences

Issues own work and dependencies; PRs are the implementation journals with acceptance and proof; release tags and
deployment receipts establish what is live. Generate views from those records, rather than asking workers to keep
a second project tracker current.

| View | Audience | Contents |
|---|---|---|
| Project overview, proposed `/ops` | Authenticated site owner | Now, Next, Needs you, Recently shipped; grouped by current outcome/domain, with proof and concise checkpoints |
| Existing `/__sim/health` | Authorized operator/site owner | Host/world health, load, backups and client errors; validate actual deployment before claiming coverage |
| `/changelog` and linked visual entries | Public | Released changes, with explicitly publishable images/clips and truthful historical provenance |

Domains organize the display; they do not require permanent agent departments. A card should show the outcome,
responsible worker, issue/PR, actual state, latest meaningful change, next checkpoint, blocker and ETA range. Lead
with the proof preview when there is one. Detailed logs and acceptance stay one link away.

## Checkpoints and estimates

A portable checkpoint contains:

- Issue/PR and branch/source SHA; current state: planned, active, blocked, ready for review, merged, released or
  live-verified. These are distinct, and some work has more than one relevant state.
- One sentence on what changed and the next checkpoint, plus a specific blocker/decision when present.
- Existing proof links with outcome, capture source/environment and publication classification.
- ETA range, what that estimate covers, confidence and evidence/assumptions; `unknown` is valid with the missing
  measurement identified. Separate implementation time, validation time and release waiting time.
- Observation time and worker update time. Re-fetching yesterday's checkpoint does not make it current.

Update at meaningful changes: a result, failed check, dependency, scope/estimate change, review or release. During
long tasks, a concise checkpoint every few hours is sufficient when there is new information. Do not create a
scheduled model loop to say nothing changed. Deterministic collection/rendering may refresh cached source records
without model calls. Stale sources remain visibly stale; never invent progress percentages or smooth an ETA into
a countdown. Display the next release estimate separately from completion of a broader program.

## Privacy and publication

Reuse site-owner authentication, checking its explicit owner configuration after world-slug changes. Both private
data and private evidence must be gated; hiding navigation or guarding only the HTML page is insufficient. No private
snapshot in a public build/CDN, no tokens in browser code, and no shared-cache leakage. Source unavailability must
fail closed for access while showing honest stale/unavailable status to an authorized owner.

The public changelog is an allowlisted projection, never an export of the private board. A published visual entry
has a title, concise result, shipped version/date, source/PR, optional preview/clip and relevant limitations. A clip
from a branch is not production verification. Stills illustrate appearance; only suitable uncut real-speed footage
proves a motion journey. Preserve rejected/failed takes privately and do not select them as successful feature proof.

Keep the existing static build-time changelog with stable anchors and lazy/user-initiated optional media. Text-only
entries remain useful. Private planning, internal host paths, personal account data and raw transcripts never enter
the public publication input. The world viewer must download no extra board/changelog assets on arrival.

## Historical recovery

The existing changelog starts at 3.0; [#585](https://github.com/genekogan/souls/issues/585) recovers earlier notes from
preserved records. Prefer recorded release dates and source receipts over commit dates. Keep a private provenance
map; publicly distinguish reconstructed historical summaries and uncertain dates from original release records.
Do not invent a release or imply deployed status from a branch merge.

Reuse existing Soul Actions and other journal media after checking availability, source, review outcome and privacy.
Headers and completion claims in old journals may be stale. Missing proof stays text-only: do not re-record old
features, generate substitute images or duplicate bulk assets to make a dense timeline. A verified historical subset
can ship while a particular earlier source is still missing.

## Operational telemetry

[Experience reports](experience-reports.md) add a separate future source: private, opt-in episodes joining edge
breadcrumbs and world facts when an interaction goes poorly, even without an exception. Link their evidence and
triage outcomes from the owner view; never export raw reports through the public changelog.

Build on the launcher health page, `metrics.mjs`, client-error ingestion, watchdog heartbeats and deployment receipts.
Separate project status from service health. Metrics code being present does not prove live collection, retention,
alert delivery or a successful incident drill. [#461](https://github.com/genekogan/souls/issues/461) retains those
qualification requirements; offsite backup verification remains separate.

No new external monitoring service or custom time-series database is required for the first view. Start with a small
health summary and links to existing diagnostics. If a later gap warrants another service, identify the concrete
benefit and operational cost before adding it. The overview is read-only: no deploy, delete or worker-launch controls.

## Delivery

[#583](https://github.com/genekogan/souls/issues/583) implements the private overview and access boundary;
[#584](https://github.com/genekogan/souls/issues/584) adds public visual release entries. Agree their small shared
publication/checkpoint format first, then build the first useful slice. Auth and data isolation require their own
tests and review; public UI requires desktop/phone proof. Existing release approvals, gate limits and no scheduled
agents remain binding.
