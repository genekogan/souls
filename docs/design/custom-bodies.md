# Reusable custom Soul bodies

Future design for [#589](https://github.com/genekogan/souls/issues/589), beginning with qualification and contract
work in [#591](https://github.com/genekogan/souls/issues/591). This is not a claim that arbitrary rigs, action clips
or body portability are implemented. Existing specialized behavior should become available to compatible worlds
through explicit definitions, inert when unused, rather than disappear during repository cleanup.

## First implementation: agent-local authoring

[#667](https://github.com/genekogan/souls/issues/667) implements a bounded first slice: the downloadable
[authoring skill](../../tools/body-authoring/SKILL.md), the server's identical local validator, and `body-motion/1`
declarations for rigid bodies. Required idle/move/rest adapters and optional solo dance contain bounded numeric
motion data. Ground navigation, support, stopping and effects stay authoritative. This is a visual hover over the
existing ground-navigation disc, not a new 3D physics model. The native dance reserves the actor, keeps its root
fixed and records a finite timeline for deterministic playback and interruption. Rigid hand actions remain refused.

[#719](https://github.com/genekogan/souls/issues/719) adds the local kit: `body kit <dir>` in the Soul CLI copies the
world's served contract, skill and validator modules with one starter (generated sculpture, canonical CC0 humanoid
or shared Pip), and `validate.mjs --report` / `--preview` give a body-report/1 summary and a visual-only local
preview. The served file list, server routes and web client are unchanged; the definition reference stays the
content address `body_<sha256>`.

[#722](https://github.com/genekogan/souls/issues/722) adds two shared examples built exactly like Pip: Grumble the
monster (`tools/body-authoring/monster/`, original geometry on the canonical rig with its core canonical clips: idle, walk, solo dance, seat, ground sit, lying and swimming; the
plain humanoid profile) and Wisp the ghost (`tools/body-authoring/ghost/`, dependency-free rigid mesh with
`body-motion/1` adapters). The server builds their bytes lazily from that source, through ordinary admission, and
refuses drift from the pinned asset ids in `apps/server/src/edge/body/shared-bodies.ts`. They are appended to the
presets, so existing preset ids and Pip's asset id are unchanged. The ghost's hover is appearance only.

[#723](https://github.com/genekogan/souls/issues/723) adds Juniper, a compact centaur foal (`tools/body-authoring/centaur/`),
under a second declared action profile, `quadruped-torso/1`. The profile has the same disposition as `rolling-gripper/1`,
in its own words:
- supported ground travel (walk gait only);
- upright standby rest;
- an authored standing dance;
- canonical hands;
- everything else refused.

The canonical legs are the forelegs. Two extra hind chains replay the same-side foreleg half a stride later.

Support stays the 0.28 m humanoid disc. Owner admission skins `Idle`, `Standby_Loop` and `Dance_Loop` at their key times
(every key time; more than 64 distinct key times in a standing clip is refused, `body.too-complex`; so is a body needing more than
1,000,000 vertex poses to measure, which bounds this synchronous check to well under a second). It centres on the Idle pose as the renderer stands the body, and refuses `body.footprint` when a
lower-body vertex leaves the disc; vertices weighted only to arm joints are not counted. The hooves are visual and the
walk's stride is not bounded. The shared preset `centaur` is pinned like the others.

All 13 curated Little Martians presets share the authored motion definition and remain available to every owner;
humanoids remain the default. Uploaded definitions remain owner-scoped and world-scoped, rediscoverable with
`body list` by stable asset ID, name and description. Their rendered mesh is publicly retrievable; owner-scoped
selection does not imply confidential asset storage. Changing adapters creates a new definition ID. Upload storage
and asset serving reuse the existing world database. Cross-world upload portability and a public body library remain
separate work.

New uploads are limited to 4 MiB, 10,000 instantiated triangles, two embedded images of at most 1024² / 1 MiB each,
and four rigid or sixteen canonical-humanoid mesh draws. Existing admitted assets retain their bytes. A world may
narrow admitted families with `WORLD_BODY_TYPES` (comma-separated supported types, including the default humanoid);
the discovery API and assignment/upload admission use the same policy. Numeric ceilings are platform ceilings,
not evidence of universal phone/crowd performance. Canonical humanoids still use their existing rig/contact adapters.
The remainder of #589 below is future scope; this slice does not claim arbitrary rigs, handless carrying or a new CDN.

## Existing foundation

Source inspected at `6134d3c8`:

- [Body admission](../../apps/server/src/edge/body/admission.ts) validates self-contained GLB files, resource
  budgets, geometry, images and rig/clip structure. Humanoids require the canonical rig and Idle/Walk clips;
  rigid ceramic/floating uploads currently reject skeletons and animation clips.
- [Body routes](../../apps/server/src/edge/body/routes.ts) expose limits and presets, accept moderated owner
  uploads, enforce storage quotas and check authority and safe standing before assignment. Uploaded bytes are
  stored in the world's database and served through body-asset routes; this is not a general CDN upload contract.
- [Body protocol](../../packages/protocol/src/body-v1.ts) and existing floaters/animals already distinguish some
  non-humanoid bodies. The current [client instructions](../../tools/edge-skill/SKILL.md) describe uploads and
  restricted capabilities. Their presence is not fresh end-to-end qualification.

Reuse these paths. Audit their limits and consumers before extending them; do not build another upload system or
replace all existing motion. The remaining world/name coupling belongs to
[#579](https://github.com/genekogan/souls/issues/579).

## Collections and public references (#717, body-library/1)

Discovery is separate from authorship, secrecy and Soul control. An admitted definition (its immutable
`body_<sha256>` content address and descriptor) is recorded with its creator Soul, owner, source world, licence and
rights in a collection store beside the identity-only account registry (`BODY_COLLECTION_PATH`, else
`body-collections.sqlite` next to `ACCOUNT_REGISTRY_PATH`; a standalone world keeps a local-only store in its own
database). See [collections.ts](../../apps/server/src/edge/body/collections.ts).

- `GET /v1/edge/body/library?scope=core|mine&q=&cursor=&limit=`: bounded pages (at most 20, search text at most 60
  characters) of the shared presets this world admits, or of the caller owner's saved references across worlds.
- `PUT|DELETE /v1/edge/body/library/<ref>/public`: the definition's owner publishes it as a public reference, or stops.
  Uploads start unpublished: until published, a reference answers like an unknown one to everyone but its owner.
- `GET /v1/edge/body/library/<ref>`: lookup by explicit reference (the owner's own, or a published one), with attribution,
  status and whether this world can select it. Holding a reference grants no authorship, membership or control of
  another Soul.
- `PUT|DELETE /v1/edge/body/library/<ref>`: save or forget a visible reference in the caller owner's collection only.
- `PUT /v1/edge/body {ref}`: select by explicit reference when the definition is the caller owner's own or published,
  active, the world admits its type and the bytes are here or can be pulled. Unpublishing stops new selections; bodies
  already worn stay. A definition withdrawn by its source world's moderation (written through to the
  store when the moderation entry is appended), or hidden by this world's or the site's moderation, cannot be newly
  selected.
- Routine discovery (`GET /v1/edge/body`) carries only `library:{mine, next}`; catalogs load on request.
- Each world imports its own owner uploads into the store at boot, idempotently; asset ids, descriptors and rights
  are never rewritten. An upload enters its owner's collection once (an import marker per world, owner and
  reference), so a forget survives restarts. Bytes stay in the admitting world. The source world is recorded by its
  stable world id, never its public slug, so a reslug keeps withdrawals and pulls working.
- Another world's definition is pulled through at selection, never on serve or observation, and only after the Soul's
  authority, the safe-swap guard and a throttle (two fetches per Soul per minute) pass: the launcher's
  `GET /__sim/site/body/<world id>/<ref>.glb` (it also resolves a slug or an alias) (site key and loopback only, binary, at most 4 MiB) reads the source world's
  private `/v1/site/body/<ref>.glb`, which answers only for active admitted bytes. The selecting world checks the
  sha256 against the reference, re-admits the bytes under its own policy and caches them once (no owner row, so no
  quota is charged). Tampered, oversized, withdrawn or unreachable sources refuse with `body.source-unavailable` or
  `body.withdrawn`. Pulled bytes are re-admitted but not re-classified: the source world's upload intake ran on them.
  Forks (`BODY_COLLECTION_PATH=local`) and standalone worlds keep a local-only store; a shared store that cannot open
  leaves the world on a local-only store with the diagnostic `body.collection-store-unavailable`, never down. Uploads
  admitted before this store existed import with the creator Soul `unrecorded`.

### Versioned core presets (#795 A1, D027)

A core preset id names one immutable, content-addressed definition, recorded in an append-only ledger
([core-revisions.ts](../../apps/server/src/edge/body/core-revisions.ts)). The core listing and lookup show it as
`<preset>@<n> → body_<sha>` (`version: "pip@1"`, `asset: "body_0ac8…"`), and `PUT /v1/edge/body {preset: "pip@1"}`
selects that exact revision. A released revision is never re-pinned: a changed preset ships as a new id, `<family>-<n>`
(`pip-2`, shown as `pip@2`), and the old id keeps its source in `tools/body-authoring`, stays selectable and stays served
by its address. Served bytes are rebuilt from that source and refused if they drift from the address, so a toolchain
change that alters an old revision's bytes fails its tests loudly rather than re-pinning it. `edge-body-core-revisions.test.ts` holds the released entries and fails if one changes. Selections need no
migration: a world stores what a Soul wears as its content address (`model: body_<sha>`), never as the preset id, so
restarts and newer revisions leave it unchanged. Versions apply to the authored presets served by content address
(Pip, the monster, the ghost, the centaur). The engine-native presets (the default humanoid, whose look has its own
`core/humanoid@2` definition, the Little Martian floaters and the procedural creatures) are selected by id and listed
without a version. The listed `asset` is the address worn and served, not a reference to look up or select: use the id or the
version. Per-world copies of preset bytes and a release-side archive of old revisions were considered and not
chosen.

## Capabilities, not an obligation to imitate a human

Recommended contract: a small required core and explicit optional physical capabilities. Every action in the
versioned platform catalogue must have an explicit disposition for a body: validated supplied motion, a compatible
built-in/procedural adapter, or unsupported with an understandable reason. A missing entry must not silently imply
support. Older body versions keep their contract; adding a new action does not invalidate every existing body.
Specify the required core during #591, including movement/stop, rest and orientation/observation requirements.

| Example | Required meaning |
|---|---|
| Rigid floating movement | Depiction can hover over admitted ground/support; it does not grant unrestricted flight or passage through obstacles |
| Rigid dance | Rhythmic tilt, turn or wiggle within validated bounds, without secretly translating the Soul |
| Carrying on the head | Candidate adaptation only: actual support/attachment, load limits, clearance, release and safe interruption must work |
| No carrying adaptation | Discovery and native admission agree that carrying is unsupported, with a specific reason |
| Humanoid manipulation | Compatible reach/contact and load ownership; an attractive clip alone cannot implement picking up |

Agents submit a complete body definition, including each claimed action's motion/adaptation and physical
requirements. They may reference approved shared adapters instead of uploading a duplicate clip for every action.
The server owns navigation, support, contact timing, object custody and effects. Client animation observes that
state; it cannot move the authoritative body, create reach, bypass consent or report an unperformed action as done.
Capability discovery, dry-run resolution, native admission and displayed motion must agree.

## Admission and world policy

Publish a versioned machine-readable authoring schema, effective limits, examples and a local validator. Server
validation is authoritative even after local validation passes. Rejections name the field, reason, measured value
and allowed range where applicable. World rules may narrow platform limits and choose supported families; they
cannot relax global safety limits. Authorship/usage rights and moderation remain part of admission.

Bound encoded bytes and decoded CPU/GPU memory; vertices/triangles, materials/draw calls and texture dimensions;
nodes, bones, skin weights, clips, channels and keyframes; parse/evaluation time and owner storage. Validate finite
geometry/transforms, dimensions and collision/support envelopes, rig mappings, contact/attachment points, motion
extents, root motion and safe endpoints/interruption. Refuse unsupported extensions, external resources and
executable code. Use isolated, resource-limited validation before admitted publication. Calibrate numeric budgets
on supported phones and crowded scenes rather than assuming one small file or a triangle limit proves safety.
Static checks alone cannot prove every animation physically valid; only the supported motion model is admitted,
with runtime authority checks and representative journey qualification.

Owner-client flow: inspect requirements → author/validate → upload for admission → receive an immutable admitted
asset ID → request assignment. Recheck ownership, world policy and safe state when assigning; refusal keeps the
old body intact. No body change during an unsafe load, ride or shared action. Validate save/replay and restoration.
Extend approved asset serving/CDN publication with integrity, moderation withdrawal, cache behavior and quotas;
do not publish rejected/quarantined assets or bypass existing access policy. Cross-world availability requires
explicit asset/rights/policy handling, not merely a URL that happens to load.

## Reuse and proof

A versioned definition can expose bounded parameters; validate the realized geometry and capabilities of each
variant. Separate scanned Little Martians meshes may share locomotion/dance adapters while retaining their own
geometry, bounds, contact points, rights and asset identity. No runtime arbitrary author script is required.
Cooperative [physical coordination](physical-coordination.md) must match a participant's actual capabilities to
its role before the readiness barrier; bodies without hands must not acquire imaginary grips.

Qualify a humanoid and a rigid asymmetric body in two differently named worlds: author/upload, accepted and refused
actions, interruption, safe body changes, reload/restart and actual motion. Include malformed/oversize/unauthorized
uploads, policy changes and a crowd/phone performance budget. Features absent or distant add no Soul context or
global per-world scans. Existing bodies and deliberate world restrictions keep compatibility until their replacements
are proven. Split admission, serving, adapters and reusable definitions into reviewable implementation issues after
the initial contract/qualification; do not conflate this with a wholesale engine rewrite.
