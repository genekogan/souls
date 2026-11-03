# Private owner overview (bounded v1)

The launcher serves a read-only overview at `/ops` (and `<base>/ops` on a base-mounted launcher). The root `/ops`
route must reach that launcher in the reverse proxy before it is a public production URL. This source change does
not deploy it. `/ops` is a reserved root namespace and cannot be the launcher `--base`; `/ops/children`
is also rejected by the existing one-segment base contract. A world named Ops remains valid at `/w/ops`
(or `<base>/w/ops`), including its normal aliases. No world is started and no GitHub call is made when someone
opens the page; ordinary world arrivals load none of its CSS, scripts, records or media.

## Access and storage

Configure the existing Clerk launcher authentication and an explicit `SIM_SITE_OWNERS` comma-separated account list,
or `CATALOG_GENE_OWNER_ID`. These are existing account IDs, never Clerk secrets, browser configuration or world
slugs. An explicit list survives the `eden-2026` slug migration. Unlike the health diagnostic endpoint, `/ops` JSON
has no loopback bypass and no flagship-world-owner fallback. Missing owner/auth configuration fails closed.
The existing health dashboard's behavior is unchanged.

The HTML shell contains only public authentication settings and UI code. Every data request verifies the existing
Clerk identity and current site-owner list. JSON, HTML, errors and HEAD responses use `private, no-store`, vary by
Authorization/Cookie, and prohibit indexing/framing. The snapshot is never in `apps/web`, a static build, a CDN or
a public metadata endpoint. `/ops/*` does not serve snapshot files or media. No browser storage or embedded remote
proofs are used; only allowlisted links to this repository's GitHub journals/releases can leave the view. Private
media hosting/proxying is deferred; a private artifact must not be added as a public journal link to work around it.

The snapshot belongs in the launcher's private `DATA_DIR`, outside served roots. Create/update it explicitly:

```sh
node tools/world-launcher/owner-overview-collect.mjs /path/to/DATA_DIR/owner-overview.json
```

The collector uses the operator's already authenticated `gh` CLI without reading credential files. It fetches the
six initial issues (#26, #415, #556, #560, #577, #583), their comments, up to 100 recent PRs and 10 release records.
It writes an atomic, mode-0600 projection only after all sources succeed. A failure preserves the old file. No new
account/service, task database, model call, scheduled agent or automatic task launch is involved. The authorized
operator decides when to run this bounded deterministic command; the page's Refresh view button rereads the cache.
Do not publish the cache or commit it, even when the underlying selected GitHub records happen to be public.

Collection older than 24 hours is visibly stale. File absence/corruption reports unavailable (or retains the last
valid snapshot as stale). Worker updates also become stale after 24 hours, independently of collection time. Current
collection cannot make yesterday's worker update current. API requests have 30-second timeouts and bounded output;
no partial successful observation replaces an old complete one.

## Portable checkpoint (optional)

Issues and PRs remain authoritative. A worker may add this tiny fenced JSON block to an **issue comment** when a
material checkpoint changes. Plain existing issues remain useful without it: owner, literal source excerpt, source
date, linked PRs and lifecycle are shown, with missing worker checkpoints and estimates made explicit. Do not add a
second checkpoint solely for this page if the issue's source journal is sufficient.

````markdown
```ops-checkpoint
{
  "at": "2026-11-02T10:00:00Z",
  "state": "active",
  "changed": "Focused checks pass on the candidate branch.",
  "next": "Finish the remaining validation measurement and link its proof.",
  "blocker": null,
  "branch": "agent/123-example",
  "sha": "0123456789abcdef0123456789abcdef01234567",
  "eta": {
    "range": "unknown",
    "covers": "validation; release waiting is separate",
    "confidence": "unknown",
    "basis": "The stable-head measurement has not completed."
  },
  "proofs": [{
    "url": "https://github.com/genekogan/souls/pull/123",
    "outcome": "candidate; not production qualified",
    "environment": "local fake minds"
  }]
}
```
````

Allowed worker states are `planned`, `active`, `blocked`, `ready for review`, `merged`, `released`, `live-verified`.
The UI labels them **Worker reports**; they never override PR merge/release provenance. The `at` value cannot be in
the future or later than a known GitHub comment update (the CLI does not expose edit times for every comment). Only comments by the repository owner, assigned issue owners or GitHub OWNER/MEMBER/COLLABORATOR identities qualify.
The newest valid trusted checkpoint wins; untrusted/malformed ones stay absent.
The actual assigned GitHub owner and the checkpoint author are separate. Unassigned means unassigned; no worker
account is invented. Estimates are displayed verbatim with confidence, coverage and basis; no synthetic countdown.

Needs you contains blocked worker reports or explicit `needs:gene`/decision/maintainer/blocked issue labels. Recently shipped
requires a closed issue and a release body reference to a linked merged PR, with no current active checkpoint/PR/claim.
Now contains active/review checkpoints, open linked PRs or claimed issues. Old related merged/released changes stay
visible separately; they never imply that an open multi-outcome parent is complete. Next is the remaining selected records: it means no indexed active checkpoint/PR/claim,
not proof that nobody is already working. Linked PRs come from closing references or a deliberate `Refs #n` / `Part of #n` / `Tracking issue: #n` line in
the 100-record window. Older/missing references can be absent. The view must never infer released/live-verified
from merged, or close an issue from a card's section. A release record alone does not qualify the live service.

## Deliberate limits

This v1 links existing health diagnostics and release records. It does not qualify heartbeat/load/refusal/error
telemetry or paging (#461), synthesize deployment receipts, embed proof previews, or serve private media. Source
journals remain one click away. The full #583 criteria remain open for live owner/non-owner sign-in qualification,
private proof delivery if later needed, richer health integration and live deployment validation. Use the normal
T3 auth review and release-owner process before production activation; no full Modal gate is needed for this slice.
