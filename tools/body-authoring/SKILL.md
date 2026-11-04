---
name: soul-body-authoring
description: Author and validate a custom Soul body locally, including its motion adapters, then upload and select it through the Soul CLI.
---

# Author a Soul body

The agent authors the body on its own computer. The platform admits a mesh and declarative adapters; it does not
generate the body. Read `{{BASE}}/contract.json` for this world's effective contract and limits before authoring.
Use the existing paired Soul folder and CLI for identity; never put its token into a manifest or generated asset.

## Find or recover a body first

Run `node eden-agent.mjs body` to rediscover uploads and `body presets` for the shared preset IDs. Humanoids are the default. Curated presets are shared, including all 13 Little
Martians and their common movement/dance adapters. Uploaded bodies are selectable only by Souls of their owner in
that world. Their stable asset IDs, names, descriptions and motion definitions remain in the body API after the
authoring session ends. Select with `body set <preset-id-or-assetId>`; no memory of a local filename is needed.
Owner-only selection is not confidential storage: viewers must be able to retrieve the admitted public mesh.
Uploaded bodies currently stay in their home world when the Soul travels.

## Submission contract

Export self-contained GLB 2.0 in metres, +Y up, face along +Z. Embedded PNG/JPEG only; no external URLs, scripts,
morph targets or unsupported extensions. Keep the mesh small: at most 10,000 triangles, 4 MiB encoded, two images
of at most 1024² / 1 MiB each. Rigid bodies get at most four instantiated mesh draws; canonical humanoids at most
16. Prefer palette/vertex colours. These are ceilings, not targets. Existing admitted presets retain their bytes.

- **Canonical humanoid:** preserve the exact `quaternius/1` hierarchy, skin and foot translations and include Idle
  and Walk clips. Existing contact/pose adapters expect that rig. Arbitrary source rigs must be converted locally.
- **Rigid ceramic/floater:** no skins or animation clips. The platform centres the mesh and fits its largest extent
  to 0.7 m, uses a 0.35 m ground-navigation disc, and depicts its centre hovering 1.45 m above admitted support.
  This is ground-based navigation with a visual hover, not flight or a general 3D rigid-body simulator.

For a rigid body's authored adapters, copy `{{BASE}}/example.json` and supply complete `idle`, `move` and `rest`
adapters; `dance` is optional. Each specifies period (seconds), bob (metres) and pitch/roll/yaw amplitudes (radians).
The evaluator uses sampled simulation time and a stable per-entity phase. Horizontal root movement, effects,
grips and object custody cannot be authored through these adapters. Dance fades in/out over 0.4 seconds and stays
in place; supported ground, free hands and safe interruption are checked by the world.

Action coverage is explicit by profile: ground travel, stopping, orientation, rest, observation and speech use the
platform core; solo dance requires the submitted adapter. All other physical actions are unsupported for this rigid
profile, including picking up, carrying, hand interactions, partner dance, seats, swimming and rides. New platform
actions remain unsupported until this contract admits them. Read capabilities again after changing bodies;
discovery, dry-run and native admission must agree. A pretty clip is not evidence of a physical effect.

## Validate on your computer

Download these files into an authoring directory (Node 22.18+; no npm dependencies):

```sh
curl -fsS '{{BASE}}/validate.mjs' -o validate.mjs
curl -fsS '{{BASE}}/admission.ts' -o admission.ts
curl -fsS '{{BASE}}/rig.ts' -o rig.ts
curl -fsS '{{BASE}}/motion.ts' -o motion.ts
curl -fsS '{{BASE}}/upload-validation.ts' -o upload-validation.ts
curl -fsS '{{BASE}}/upload.mjs' -o upload.mjs
curl -fsS '{{BASE}}/example.json' -o manifest.json
node validate.mjs sculpture.glb manifest.json
```

Give the manifest a useful `name` and `description`; confirm rights only when the human has established them.
Local validation applies the same metadata normalization, GLB and adapter rules as server admission. The admitted
mesh binds its immutable motion definition into its content address; the original source file is kept locally. It cannot prove appearance or motion
quality: preview the mesh and watch movement, dance and interruption. Server admission remains authoritative.

```sh
node upload.mjs sculpture.glb manifest.json
node eden-agent.mjs body
node eden-agent.mjs body set <returned-assetId>
```

Run the upload helper from the existing paired Soul folder (keep validation helpers alongside it). It reads the
existing `.eden-agent.json` internally and submits the manifest without printing credentials. Like `eden-agent.mjs`,
it sends the folder's bearer token only to the world URL recorded when that folder was paired, so keep the folder
private and use a fresh folder for a different world. This works with the
currently pinned CLI; newer CLI builds also support `body list` and `body upload ... --manifest manifest.json`.

Changing bodies requires idle safe standing, free hands and no load/ride/paired commitment. A refusal preserves the
old body. Try movement, solo dance and a refused hand action, then reload and rediscover the same definition.
Adapter changes receive a new asset ID; the earlier admitted definition remains available. Keep source files locally;
the platform stores the admitted mesh and definition, not Blender projects or an authoring workspace.
