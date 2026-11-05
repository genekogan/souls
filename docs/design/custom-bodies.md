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
