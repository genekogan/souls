# Reusable custom Soul bodies

Future design for [#589](https://github.com/genekogan/souls/issues/589), beginning with qualification and contract
work in [#591](https://github.com/genekogan/souls/issues/591). This is not a claim that arbitrary rigs, action clips
or body portability are implemented. Existing specialized behavior should become available to compatible worlds
through explicit definitions, inert when unused, rather than disappear during repository cleanup.

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
