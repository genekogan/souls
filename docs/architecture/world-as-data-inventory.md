# World-as-data inventory

Pinned to `origin/main` at `9fa4cbea0` for [#1123](https://github.com/soulsimulation/souls/issues/1123). Read-only: nothing here
moves, renames or deletes anything. Every destination is a **proposal for Gene**. Rows marked **retire** need Gene's OK
before anything is removed, and nothing is closed or deleted on the strength of this document. It builds on the #381
dependency map ([mars-import-inventory.md](mars-import-inventory.md)) and the #680 PC01 manifest
([physical-coordination-manifest.json](../design/physical-coordination-manifest.json)) and does not copy them.

## How to read this

Each row is one Mars-specific behaviour, asset family or tool. Row ids (`M01`, `M02`, …) run through the whole document
so later steps can cite them. Columns:

- **Source**: repository-relative paths. A trailing `/` is a whole directory. Named files in prose ("details-2026-*")
  are groups inside the listed directory.
- **What it does**: one line.
- **Consumers**: who imports or uses it. For `mars/` rows the numbers are distinct importing files outside the row,
  from `python3 tools/inventory/mars-imports.py --consumers`: *engine-mars* is `packages/engine-mars/src` (its tests in
  brackets), *server* and *web* are `apps/server` and `apps/web` (tests in brackets), *other pkgs* are other
  `packages/`, *engine tests* are `mars/viewer/engine/test`. "Viewer only" means nothing outside `mars/` imports it; the
  Mars viewer itself (Lab, studio) may. For rows outside `mars/` the column names the importing files.
- **Destination**, exactly one of:
  - **Soul action**: general behaviour any world can use. This includes the Soul actions themselves and the engine and
    renderer code they run on or are drawn with (runtime, navigation, bodies, camera). Such substrate rows move with
    [#382](https://github.com/soulsimulation/souls/issues/382) into a package named for Souls.
  - **catalogue object**: a library def in `packages/world-compiler/src/core-kit/` (or the body and asset files a def
    points at).
  - **template data**: world template data, the way `worlds/templates/eden-2026.json` and `worlds/eden/` hold Eden.
  - **retire (needs Gene's OK)**: delete once nothing depends on it, with the reason.
- **Notes / already done by**: the PC or issue that already delivers it, blockers, and "unsure: why" where the
  destination is a best guess.

PC numbers are the [#560](https://github.com/soulsimulation/souls/issues/560) physical-coordination queue. At the pinned
commit PC01–PC14 are landed except PC11 (#690, open), PC15 (#694) is in review as PR #1122, and PC16 onwards are planned.
Since then (statuses only; the rows stay as pinned): PC15 landed (#1122), and PC16 (#695, stairs) is in review as PR #1132.
Several rows below are behind the `SIM_SHARED_CARRY=1` flag.

## Engine

`mars/viewer/engine/`. Construction, carry, forklift and the stock catalogue are in their own sections below.

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M01 | `mars/viewer/engine/core/` | Deterministic math, seeded RNG, hashing and ordering. | engine-mars 14 (7) · server 4 (4) · web 2 · engine tests 104 | Soul action | Substrate; #382. |
| M02 | `mars/viewer/engine/runtime/` | Fixed 1/20 s tick runtime, snapshot, codec, compaction, invariants, waits. | engine-mars 25 (21) · server 1 (3) · web (3) · other pkgs 2 · engine tests 141 | Soul action | Substrate; #382. Keep rules versions and replay hashes stable across the move. |
| M03 | `mars/viewer/engine/actions/types.ts` | Action and verb type contract. | engine-mars 5 (2) · other pkgs 1 · engine tests 65 | Soul action | Substrate; #382. |
| M04 | `mars/viewer/engine/api/` (registry, controller, schemas, seeds, edit, edit-static, pause, index) | The one verb registry, controller facade, op schemas and MCP descriptors; design edits. | engine-mars 1 (2) · engine tests 48 | Soul action | Substrate; #382. `seeds.ts` also publishes campus years (M46): split it at the move. `api/camera-vocab.ts` is in M12. |
| M05 | `mars/viewer/engine/world/types.ts`, `factory.ts`, `entity-list.ts`, `relevant.ts` | World model types (asset def, entity, regions) and world-state helpers. | engine-mars 27 (19) · server 16 (36) · web 4 (9) · other pkgs 1 · engine tests 113 | Soul action | Substrate; #382. The `CATALOG` registry itself is in `catalog.ts` (M77). |
| M06 | `mars/viewer/engine/spatial/` | Navigation grid, routes, ground, nav trust, scene edits (upper floors). | engine-mars 15 (12) · server 9 (12) · web 5 (4) · other pkgs 2 · tools 1 · engine tests 120 | Soul action | Substrate; #382. |
| M07 | `mars/viewer/engine/locomotion/walk.ts`, `spline.ts`, `swim.ts` | `walk_to` route following with stairs, path smoothing, swimming. | engine-mars 3 (2) · server 1 · other pkgs 1 · engine tests 57 | Soul action | Substrate; #382. |
| M08 | `mars/viewer/engine/locomotion/shore.ts`, `connected-shore.ts` | Calm-water fixture controller for the old Eden commons shore. | engine-mars 6 (3) · server 1 (1) | template data | Eden shore (M118, M145). Unsure: the controller is generic, the bed and gate coordinates are Eden's. |
| M09 | `mars/viewer/engine/sequence/` | Sequence templates, binding and the deterministic step runner. | engine tests 23 | Soul action | Basis for procedure templates (#383, PC17 #696). |
| M10 | `mars/viewer/engine/rehearsal/`, `mars/viewer/engine/history/` | Plan rehearsal and staleness envelopes; versioned checkpoint history. | engine tests 19 and 22 | Soul action | Used by the studio and Lab; no server use today. Unsure: may retire if PC17/PC18 persist projects differently. |
| M11 | `mars/viewer/engine/take/` | Take recording, replay, chapters, metrics, library. | engine-mars 5 (14) · server 1 (10) · web 12 (16) · tools 7 · engine tests 27 | Soul action | Substrate; #382. The web recorded-replay path depends on it. |
| M12 | `mars/viewer/engine/camera/`, `mars/viewer/engine/api/camera-vocab.ts` | Autonomous camera: shots, solving, occluders, take sampling, camera sentences. | web 2 · engine tests 21 | Soul action | `WorldBroadcast.ts` and `WorldRenderedVisibility.ts` use `camera/shots.ts`. The sentence parser serves the studio (M37). |
| M13 | `mars/viewer/engine/bodies/` (body, humanoid, action-profile, motion, navigation, index, take), `mars/viewer/engine/body/model.ts` | Body families, humanoid dims, action profiles, body-motion data, hand landmarks. | engine-mars 2 (3) · server 10 (5) · web 2 (4) · other pkgs 3 · tools 1 · engine tests 8 | Soul action | Substrate; #382. `motion.ts` exports `LITTLE_MARTIANS_MOTION` (see M127). |
| M14 | `mars/viewer/engine/bodies/models.ts`, `float.ts`, `policy.ts`, `pose.ts` | Little Martians floater bodies: models, glide planning, verb policy, hover pose. | engine-mars 1 (1) · server 1 · tools 1 · engine tests 1 | catalogue object | Floater bodies as body defs; `models.ts` mirrors `worlds/littlemartians/characters/manifest.json`. #579. |
| M15 | `mars/viewer/engine/bodies/creatures.ts` | Duck, snail and dog creature bodies. | engine-mars 1 · server 2 (1) | catalogue object | `packages/world-compiler/src/core-kit/creatures.json` exists; check overlap. |
| M16 | `mars/viewer/engine/items/` | Item custody: take, put, serve, eat, hand-over, let-go, cup, drink, watering, repair, reach presentation. | engine-mars 7 (1) · server 4 · other pkgs 1 · tools 4 · web (1) · engine tests 35 | Soul action | Already general Soul actions (entries 34, 41, 43, 44, #442) run on it through `apps/server/src/god/tea.ts`, `watering.ts`, `held.ts`. |
| M17 | `mars/viewer/engine/social/` | Social verbs, ambient life, slots, hand-hold, paired poses, rock-paper-scissors, hand actuator, frisbee clearance. | engine-mars 3 (5) · server 9 (2) · web 1 (6) · tools 5 · engine tests 30 | Soul action | Already used by `together.ts` and god actuators. |
| M18 | `mars/viewer/engine/objects/`, `mars/viewer/engine/games/chess-rules.ts` | Object state for chess, classroom display, drawing pad, garden, seedbed, reading, workstation. | engine tests 36 | Soul action | Viewer only. The server has its own `apps/server/src/edge/comms/objects/chess.ts`: check for duplicates. |
| M19 | `mars/viewer/engine/activities/` (classroom, reading-circle, music-gathering, open-jam, group-warmup, gallery-tour, art-sharing, communal-supper, shared-food-break, paired-walk, computer-music, computer-workshop, library-reading) | Bounded group activities above ordinary actions. | engine-mars 1 · engine tests 21 | Soul action | PC22–PC25 (#701–#704) and #730 (PC47) coverage. Many are marked hypothetical in source. |
| M20 | `mars/viewer/engine/activities/` (garden-care, garden-circuit, seed-planting, prepare-food, room-preparation, room-setup, table-cleanup, stow, sleep, drawing) | Bounded chores and routines. | engine-mars 2 · engine tests 12 | Soul action | PC28/PC29 (#707, #708) for preparation; the rest #730. |
| M21 | `mars/viewer/engine/activities/` (living-intention, purposeful-routine, gathering-continuation, turns, types, index) | Authored commitments and activity coordination above ordinary actions. | engine-mars 1 · engine tests 16 | Soul action | Unsure: overlaps the edge intent layer (#481 continuity); may retire instead. |
| M22 | `mars/viewer/engine/env/daylight.ts` | Daylight and twilight factors from solar elevation. | web 2 (2) · engine tests 2 | Soul action | Used by `apps/web/src/daylight.ts`, `atmosphere/astro.ts`. |
| M23 | `mars/viewer/engine/env/sun.ts` | Solar position for one fixed desert site. | web 4 (3) · engine tests 3 | template data | The site's latitude and longitude should be per-world template data; today every world's sun uses the Mars site (`site-north.ts`, `daylight.ts`). #579. |
| M24 | `mars/viewer/engine/vehicles/` (actions, profiles, curve, traffic, invariants, index) | Riding verbs and movement profiles for EUC and bicycle; vehicle traffic. | engine tests 7 | Soul action | Viewer only today. |
| M25 | `mars/viewer/engine/vehicles/carrier.ts`, `boat.ts` | Carriers with seats (balloon, gondola, punt) and the boat controller. | engine-mars 9 (6) · server 3 (3) · web (1) · engine tests 1 | Soul action | Already serves rides (`apps/server/src/god/rides.ts`, `apps/server/src/punt-install.ts`). |
| M26 | `mars/viewer/engine/test/` (198 test files, `fixtures/`) | The engine suite (`pnpm test:mars`). | root `test:mars` script | Soul action | Moves with #382. Campus-history fixtures are M51; campus, year-build and camp tests follow their rows. |

## Viewer

`mars/viewer/` outside the engine: the React and three.js app, renderer pieces apps/web reuses, and Mars-only tools.

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M27 | `mars/viewer/app/engine-view/` (people, humans, human-appearance, body-rig, rig, character-wire, clip-library, expression, people-light, palette, posture, frame-gait, running-gait, walk-ease, ground-foot-fit) | Draws people: rigs, gaits, looks, expressions. | web 11 (18) · tools 3 · engine tests 1 | Soul action | Renderer for every world (`WorldBodyModels.ts`, `people-kit.ts`). #382 viewer move. |
| M28 | `mars/viewer/app/engine-view/floaters.ts`, `creatures.ts` | Draws floater and creature bodies. | web 2 (3) · tools 1 | Soul action | Renderer side of M14/M15. |
| M29 | `mars/viewer/app/engine-view/` (stair-frame, stair-gait, stair-mesh-profile(s), stair-rig-contact, stair-shoe-refs, stair-sole, stair-trajectory) | Stair stepping, foot contact and stair mesh profiles. | web 1 (1) · other pkgs 2 · tools 1 | Soul action | `tools/mesh-floors/` reads the profiles. |
| M30 | `mars/viewer/app/engine-view/` (recorded-*, take-log, take-replay, take-walk, water-*, wave-blend, shore-preview, native-boat, rowing-motion, rowing-punt, sleep, prone, recorded-sleep-pose, play-motion) | Draws recorded motion, water transitions, rowing, sleep and prone poses. | web 7 (8) · tools 1 · engine tests 3 | Soul action | `shore-preview.ts` and `recorded-shore.ts` are Eden-shore specific (M118). |
| M31 | `mars/viewer/app/engine-view/` (activity-poses, hand-games, piano-hands, piano-score, chess, drawing, paint, poster-sheet, seedbed, solar-mesh, equipment-mesh, fire, items, bicycle, workstation, imported-workstation, station-depiction, vegetation, fixtures, components, social-render-types) | Draws activities, props and equipment. | web 11 (10) · tools 1 · engine tests 1 | Soul action | `solar-mesh.ts` belongs with PC39 (#720). |
| M32 | `mars/viewer/cinematography/director.ts`, `types.ts`, `shots.ts`, `composition.ts`, `observation.ts`, `activity-observation.ts`, `physical.ts`, `provider.ts`, `replay.ts` | Autonomous activity camera director. | web 1 (`WorldBroadcast.ts`) · engine tests 1 | Soul action | Broadcast camera for every world. |
| M33 | `mars/viewer/cinematography/` (capture*.mjs, bridge.mjs, evaluate-jev.mjs, jev-client.ts, jev-server.ts, lab-driver.ts, record-comparison.ts, suite-record.ts, review.html, README.md) | Camera capture, model-judged evaluation and review pages. | viewer only | retire (needs Gene's OK) | Research tooling for the studio camera; no product use. |
| M34 | `mars/viewer/lib/` (depth-fit, ground-triangles, layout, layout-transforms, render-batches, retry, snapshot-order, three-resources, quad-ground.test) | Shared renderer and geometry helpers. | web 11 (11) · tools 1 · engine tests 1 | Soul action | #382 viewer move. |
| M35 | `mars/viewer/lib/authored-boundaries.ts`, `office-stair-guards.ts`, `platform-floor.ts` | Exact authored walls, office stair guards and declared render floors for old Eden. | server 1 (2) · web 6 (6) · other pkgs 1 | template data | Eden geometry (M138). Unsure: `platform-floor.ts` is also read by `apps/server/src/edge/eyes/platforms.ts`. |
| M36 | `mars/viewer/app/lab/` (81 files) | `/lab`: live engine sandbox with scenario HUDs. | engine tests 13 | retire (needs Gene's OK) | Its scenarios are the PC01 manifest's `lab` rows; retire after #730 (PC47) closes the coverage matrix. |
| M37 | `mars/viewer/app/studio/` | `/studio`: campus scenes by year, take replay, direct camera, presentation. | engine tests 3 | retire (needs Gene's OK) | Mars campus presentation tool. Take replay and broadcast now live in apps/web. |
| M38 | `mars/viewer/app/studio-2020/` | The 2020 campus studio. | viewer only | retire (needs Gene's OK) | Named in #387. |
| M39 | `mars/viewer/app/camera-lab/` | Camera replay and suite pages. | viewer only | retire (needs Gene's OK) | Research pages for M33. |
| M40 | `mars/viewer/simulation/` (worker, engine-room, engine-tools, control, commands, model, legacy, shared, storage-bytes, workload, wrangler.jsonc, catalog.json, README.md), `mars/viewer/app/simulation-guide/`, `mars/viewer/public/simulation-agent-guide.md` | Cloudflare Worker and Durable Object host with MCP tools, and its agent guide. | engine tests 4 | retire (needs Gene's OK) | The Souls server replaces it. Unsure whether anything still deploys it. Campus years are M49. |
| M41 | `mars/viewer/e2e/` (81 specs, `playwright.config.ts`, `take-fixture.ts`) | Playwright tests of the Lab and studio. | `pnpm --filter mars-campus-viewer e2e` | retire (needs Gene's OK) | Goes with M36–M38. Baseline images are M103. |
| M42 | `mars/viewer/experiments/nav-eval/` | Navigation library experiments (Recast, Rapier, BVH). | viewer only | retire (needs Gene's OK) | Finished experiment. |
| M43 | `mars/viewer/package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`, `mars/viewer/app/page.tsx`, `main.tsx`, `globals.css`, `mars/viewer/public/favicon.svg` | The viewer workspace, its build and app shell. | `tools/assets/mars-web.mjs`, root `build` and `predev` | retire (needs Gene's OK) | Blocker: the server serves people's character set from this build (M98, M148). Move that first. |

## Campus and campus years

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M44 | `mars/viewer/engine/campus/assembly.ts`, `bom.ts`, `sequence.ts`, `parts-b.ts`, `sequence-b.ts` | Assembly graph, bill of materials and build sequence (phase A skeleton, phase B floors, stairs, walls, solar) for one rack building of a campus year. | engine tests 7 | template data | Blueprint and procedure data for #383. PC17 (#696) procedure, PC40/PC41 (#721, #724) generated builds, PC42/PC43 (#725, #726) phase B. Marked hypothetical in source. |
| M45 | `mars/viewer/engine/campus/extract.ts`, `geom.ts`, `load.ts`, `node.ts`, `types.ts`, `regions.ts`, `world.ts` | Campus scene file to provenance-tagged `SpatialScene`; 2026 regions; canonical 2026 world state. | engine-mars 1 (`mars-2026-map.ts`) · engine tests 10 | template data | Mars College 2026 for #386. `worlds/templates/mars-two.json` already lays out the 2026 campus from `core/mars-*` defs. |
| M46 | `mars/viewer/engine/campus/history.ts`, `history-extract.ts`, `history-node.ts` | Protected historical campus years 2020–2025. | engine tests 20 | retire (needs Gene's OK) | Named in #387 (campus history). |
| M47 | `mars/viewer/app/history/` (year-2021 … year-2025, year-2027, details-2021 … details-2025, cad-components, kit, scenes, screens, historical-helpers, photographic-corrections, id-migration.json, og-bus-cad-ids.json) | Procedural reconstructions of campus years other than 2026, and a 2027 draft. | viewer only | retire (needs Gene's OK) | Named in #387. Unsure for `year-2027.ts`: Mars College 2027 is the #560 delivery target (PC21, PC48). |
| M48 | `mars/viewer/app/history/` (details-2026*, gallery-2026-anchors, interior-2026-views) | The 2026 campus details: Chiba, Mimos, auditorium, gallery, tool library, vehicles, structure. | viewer only | template data | Already captured as data by `tools/god-skill/scripts/mars-two/` into `worlds/templates/mars-two.json` and `worlds/core-assets/mars/`. Keep until #386 confirms parity. |
| M49 | `mars/viewer/simulation/campus-years.ts`, `history-catalogs.json` | Campus-years catalogue for the Cloudflare host. | viewer only | retire (needs Gene's OK) | With M40, M46. |
| M50 | `mars/viewer/deploy/` (history-*.mjs and tests, review-2026-*.mjs, engine-scene.mjs, catalog.mjs, history-catalog.mjs, group-2026-frames.mjs, record-campus-take.mjs, year-layout.test.mjs, og-vehicles-2026.test.mjs, draft-2027.test.mjs, history-2022/2023 owner-id json, `fixtures/`) | Campus extraction, history reconciliation, review exports and their tests. | viewer only | retire (needs Gene's OK) | Generates the campus scene files M45 reads; keep one export path until #386 lands. |
| M51 | `mars/viewer/engine/test/fixtures/campus-history-pre-review-7648dbf/`, `campus-history-pre-w51/` | Frozen campus-history fixtures. | engine tests | retire (needs Gene's OK) | With M46. |

## Scenarios and Lab

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M52 | `mars/viewer/engine/scenarios/eden-camp.ts` | The Mars camp scene (kitchen, living room, bunk house, lookout), scene `eden-camp`. | engine-mars 3 (4) · server 3 (3) · web (1) · engine tests 1 | template data | `worlds/mars/world.json` runs it; `worlds/templates/mars-camp.json` is the camp in the new vocabulary. #579, #386. |
| M53 | `mars/viewer/engine/scenarios/eden-commons.ts` | Old Eden commons scene. | engine-mars 1 (`load.ts`) | template data | Eden; `worlds/templates/eden-2026.json` is the data form. |
| M54 | `mars/viewer/engine/scenarios/greenfield.ts` | Green field default for `eden` and unknown world keys. | engine-mars 1 (1) · web (1) | template data | Unsure: a blank field may simply be "no template". #579. |
| M55 | `mars/viewer/engine/scenarios/littlemartians.ts` | Little Martians scene. | engine-mars 1 (`load.ts`) | template data | `worlds/templates/littlemartians-garden.json`, `littlemartians-two.json` exist. #579. |
| M56 | `mars/viewer/engine/scenarios/` (art-sharing, chess, classroom, communal-supper, computer-music, computer-workshop, creative-afternoon, design-studio, drawing-work, gallery-tour, garden-afternoon, garden-care, garden-circuit, group-warmup, library-reading, living-day, meal, music-gathering, open-jam, paired-meal-walk, preparation, prepared-day, reading, reading-circle, room-preparation, seed-planting, sleep, table-cleanup, work-break) | Lab activity set-ups: furnished rooms and casts that exercise one activity each. | engine-mars 1 (`meal.ts`) · engine tests ~70 | template data | Example set-ups. The PC01 manifest maps each to a PC (mostly #730); keep until PC47 closes. Build scenarios are M75–M76. |
| M57 | `mars/viewer/engine/scenes/proving-ground.ts`, `mars/viewer/engine/carry/scenes.ts` | Synthetic navigation and carry proving scenes. | engine tests 48 · server (1) | Soul action | Test fixtures for the substrate; move with M26. |
| M58 | `mars/viewer/deploy/scenario-coverage.json`, `scenario-contracts.mjs`, `evidence-gate.mjs`, `evidence-report.mjs`, `engine-proof.mjs`, `engine-proof-reporter.mjs`, `mars/viewer/app/lab/scenario-contracts.ts` | Lab scenario coverage and evidence gates. | engine tests 1 | retire (needs Gene's OK) | Superseded by the PC01 manifest and `tools/physical-manifest/` (M150) once #730 closes. |
| M59 | `mars/viewer/deploy/` (gate.mjs, gate-runtime.mjs, perf-*.mjs, performance-alpha.mjs, smoke.mjs, determinism-probe.mjs, compress-browser.mjs, http-compress.mjs, upload.mjs, downloads.mjs, configure.mjs, deployment.json, prepare.py, browser-model.py, director-demo.mjs, prepare-camera-demo.mjs, tool-trace.mjs, simulation-integration.mjs and the remaining *.test.mjs) | The viewer's release gate, perf probes, upload and deployment scripts. | `pnpm test:mars:release` | retire (needs Gene's OK) | Goes with M43. |

## Construction

`mars/viewer/engine/construction/` plus the carry and forklift primitives. Primitive-to-PC mapping follows the PC01
manifest's `native` and `lab` rows.

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M60 | `mars/viewer/engine/construction/rules.ts`, `invariants.ts`, `lying.ts`, `children.ts`, `access.ts`, `liftcrew.ts`, `stance.ts`, `index.ts` | Pallet-rack assembly model v1, construction invariants, crew access and lift choreography, verb registration. | engine-mars 3 (`raise-hold.ts`, `beam-connect.ts`) · engine tests | Soul action | PC12–PC14 already read `rules.ts`, `children.ts`, `liftcrew.ts`, `access.ts` from engine-mars. |
| M61 | `mars/viewer/engine/construction/raise.ts`, `raise-lower.ts` | `raise_upright` and its controlled reversal. | engine-mars 1 (`raise-hold.ts`) · engine tests | Soul action | Done by PC13 (#692): `mars:raise_hold_v1`, behind `SIM_SHARED_CARRY`. |
| M62 | `mars/viewer/engine/construction/beam.ts` | `connect_beam` and `release_support`. | engine tests | Soul action | Done by PC14 (#693): `mars:connect_beam_v1`, behind the flag. |
| M63 | `mars/viewer/engine/construction/deck.ts`, `contributor.ts` | Joists and plywood decks; construction changes navigation. | engine tests | Soul action | PC15 (#694): `deck-install.ts` in PR #1122 (in review, not on main). |
| M64 | `mars/viewer/engine/construction/stairs.ts`, `setpart.ts` | Stair flights and treads; phase B stringers, risers, posts, handrails. | engine tests | Soul action | PC16 (#695) in review as #1132 (library deck stair and tread; native verbs stay); phase B parts PC42 (#725). |
| M65 | `mars/viewer/engine/construction/frame.ts`, `framemove.ts` | Climbing an upright's bracing (`climb_frame`) and walking a beam (`beam_walk`). | engine tests | Soul action | The PC01 manifest lists them under PC14, but PC14's landed scope is `connect_beam_v1`. Unsure: no open PC names them. |
| M66 | `mars/viewer/engine/construction/handup.ts`, `passup.ts`, `aloft.ts`, `moves-b.ts` | Hand-up and pass-up to elevated receivers, parts staged aloft, phase B logistics. | engine tests | Soul action | PC33 (#712), PC34 prone receive (#713). |
| M67 | `mars/viewer/engine/construction/framing.ts` | Roof framing: top plates, rafters, blocking. | engine tests | Soul action | PC38 (#718). |
| M68 | `mars/viewer/engine/construction/wall.ts` | Plywood wall panels on rack framing. | engine tests | Soul action | PC37 (#716). |
| M69 | `mars/viewer/engine/construction/solar.ts`, `mars/viewer/engine/carry/fragile.ts` | Panel rails, panels, electrical equipment; fragile two-person panel carry. | engine tests | Soul action | PC39 (#720). |
| M70 | `mars/viewer/engine/construction/bundle.ts`, `cut.ts` | `take_from_bundle` from strapped piles; cutting stock to size with offcuts. | engine tests | Soul action | PC32 (#711). The two-person saw is PC26 (#705), a different primitive. |
| M71 | `mars/viewer/engine/construction/disassembly.ts` | Reverse of progressive construction. | engine-mars 3 (1) | Soul action | PC19 (#698). The camp lookout take-down already uses it (M114). |
| M72 | `mars/viewer/engine/work/paint.ts` | Painting panels. | server 1 (`art/painting-completion.ts`) · engine tests 1 | Soul action | Lab `solar-paint` maps to PC39 (#720). |
| M73 | `mars/viewer/engine/carry/` (actions, formation, planner, sweep, validate, invariants, contact, fixture, climb) | Crew carry as one rigid formation with an SE(2) planner; carrying on stairs. | engine-mars 2 · server 1 · other pkgs 1 · tools 1 · engine tests 20 | Soul action | Done by PC03–PC10 (shared carry reuses native `carry`); PC11 (#690) open. Carry on stairs is PC35 (#714). |
| M74 | `mars/viewer/engine/vehicles/forklift.ts` | Rule-based forklift for lifting sheets to upper levels. | engine tests 4 | Soul action | PC36 (#715); `core-forklift` exists in the library. |
| M75 | `mars/viewer/engine/scenarios/build-bay.ts`, `build-bay-v2.ts`, `build-bay-v3.ts` | The six-volunteer rack bay build, three revisions. | engine tests 8 | template data | Blueprint for PC17 (#696); portability PC20 (#699). |
| M76 | `mars/viewer/engine/scenarios/year-build.ts` | Generated year builds (2022 first bay, east house). | engine tests 5 | template data | PC40 (#721), PC41 (#724). |

## Stock and catalogue

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M77 | `mars/viewer/engine/world/catalog.ts` | Mars construction vocabulary (rack uprights 8/9/12/19 ft, beams, plywood, stair flights) and the `CATALOG` registry. | engine-mars 10 (10) · server 17 (6) · tools 3 · engine tests 35 | catalogue object | Rack parts are already library defs (M85). The registry mechanism is substrate; `packages/engine-mars/src/catalog-adapter.ts` registers library defs into it. |
| M78 | `mars/viewer/engine/world/catalog-stock.ts`, `catalog-phase-b.ts` | Stock, piles, site equipment; phase B stock and parts. | via `catalog.ts` · engine tests 1 | catalogue object | #385. Bundles PC32 (#711), joists PC15 (#694), walls PC37 (#716). Sizes marked provisional in source. |
| M79 | `mars/viewer/engine/world/catalog-framing.ts` | 2x4 framing members. | via `catalog.ts` · engine tests 1 | catalogue object | PC37/PC38 (#716, #718). |
| M80 | `mars/viewer/engine/world/catalog-solar.ts` | Panels, rails, electrical equipment. | via `catalog.ts` · engine tests 1 | catalogue object | PC39 (#720); `core-solar-panel` exists. |
| M81 | `mars/viewer/engine/world/catalog-items.ts` | Tables and small hand-held items. | engine-mars 1 · engine tests 1 | catalogue object | Mostly covered by `furniture.json`, `kitchen.json`, `props.json` in core-kit; check before moving. |
| M82 | `mars/viewer/engine/world/catalog-activities.ts`, `catalog-chess.ts`, `catalog-drawing.ts`, `catalog-garden.ts` | Classroom, chess, drawing and garden objects. | via `catalog.ts` · engine tests 1 | catalogue object | Pairs with M18. |
| M83 | `mars/viewer/engine/world/catalog-commons.ts`, `catalog-shore.ts` | Physical defs for the old Eden dry commons and shore. | via `catalog.ts` | template data | Eden (M117, M118). |
| M84 | `mars/components/catalog.json` | Nominal stock dimensions of rack building components. | `mars/viewer/deploy/catalog.mjs`, `mars/viewer/simulation/model.ts`, `mars/scripts/modular_report.py` | catalogue object | Source data for M77/M78 sizes. |
| M85 | `packages/world-compiler/src/core-kit/work.json` (rack and plywood entries), `packages/world-compiler/src/joints.ts`, `packages/world-compiler/src/handling.ts` | Library rack parts: `core-pallet-rack@1`, `core-rack-beam@1–3`, `core-rack-upright@1–2`, `core-plywood-sheet@1`, `core-plywood-stack@1`, `core-work-table@1`; joints and handling checks. | god mode, edge ledger, engine-mars `catalog-adapter.ts` | catalogue object | Already done: PC03 (#682), PC12 (#691), PC11 (#690, open). `core-pallet-rack@1` has a surface and shelf sockets. |
| M86 | `packages/world-compiler/src/core-kit/mars.json` | 128 `core-mars-*` furniture and fixture defs from the 2026 campus. | `worlds/templates/mars-two.json` | catalogue object | Already done. |

## Scripts and tools

Inside `mars/`. Tools outside `mars/` are the last section.

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M87 | `mars/scripts/` (sfm.py, sfm_campus.py, align_cameras.py, alignment_maps.py, close_alignment.py, gps_scale.py, localize_stills.py, match_maps.py, reconstruct.swift) | Photogrammetry and structure-from-motion of campus photos. | none in repo; need source media not in git | retire (needs Gene's OK) | Named in #387. |
| M88 | `mars/scripts/` (prepare_campus.py, prepare_campus_checks.py, history_cad.py, history_cad_review.py, cad_structure_data.py, inspect_cad.py, render_cad_chiba.py, constrain_campus.py, validate_campus.py, validate_holdout.py, extract_wall_surfaces.py, remove_occluded_finishes.py, replace_silhouettes.py, inspect_silhouettes.py, apply_appearance.py, finish_sources.py, canonicalize.py, refresh_plywood.py, export_model.py, package_mesh.py, review_interiors.py, top_view.py, storyboards.py) | CAD and campus model preparation, checks and renders. | none in repo | retire (needs Gene's OK) | Named in #387. |
| M89 | `mars/scripts/` (build_modular.py, finalize_modular.py, refine_modular.py, optimize_modular_glb.py, verify_modular.py, modular_report.py, render_modular_checks.py, render_modular_cutaway.py, prepare_modular_evidence.py, prepare_people.py, prepare_animated_people.py) | Builds the modular humanoid character kit. | none in repo | catalogue object | Unsure: keep with the kit (M100) if the kit will be rebuilt; retire if the built media is final. |
| M90 | `mars/scripts/prepare_euc.py`, `inspect_euc.py` | Prepares the electric unicycle model. | none in repo | retire (needs Gene's OK) | The built model is media. Unsure if an EUC library def is wanted. |
| M91 | `mars/scripts/` (_paths.py, inventory.py, build_manifest.py, build_report.py, metric_summary.py, render_checks.py, component_probe.py, verify_deliverables.py, start_viewer.sh), `mars/requirements.lock.txt` | Shared helpers, reports and the Python lock file. | none in repo | retire (needs Gene's OK) | Goes with M87–M90. |

## Docs and briefs

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M92 | `docs/mars/` (engine-guide, movement, carry, construction, items, social, body-model, poses, vehicles, takes-and-plans, planning-budget, camera, camera-direction) | Engine behaviour docs. | linked from `mars/AGENTS.md`, `mars/README.md` | Soul action | Move with #382 and rewrite for the Souls package. |
| M93 | `docs/mars/` (README, campus, campus-scene, history, studio-replay, lab, spec, design-decisions) | Campus, studio, Lab docs and the original spec. | same | retire (needs Gene's OK) | `spec.md` and `design-decisions.md` hold the rack model's reasoning: keep a summary where #383–#385 land. |
| M94 | `mars/README.md`, `mars/AGENTS.md`, `mars/viewer/cinematography/README.md`, `mars/viewer/simulation/README.md`, `mars/viewer/app/lab/README.md`, `mars/viewer/public/modular/ASSETS.md`, `mars/viewer/public/modular/humanoid/README.md` | Directory READMEs and the engine invariants file. | contributors | retire (needs Gene's OK) | Keep `mars/AGENTS.md` invariants in the root `AGENTS.md` (already restated there). The humanoid README moves with M98. |
| M95 | `mars/docs/engineering/briefs/` (*.capture.json, *.manifest.json, classroom-assets.json, raise-cancel.cost.json, `raise-cancel-proof/`) | Captured evidence for past engine briefs. | none in repo | retire (needs Gene's OK) | The raise-cancel proof is the PC01 `specialRoutes` row; PC13 (#692) has landed. |
| M96 | `mars/docs/engineering/questions/` (index.html, `diagrams/`, `tools/`) | Construction design questions: ground, span, deck, strip, wall, stair, solar, roof options. | none in repo | retire (needs Gene's OK) | Reference for PC15, PC16, PC37–PC39 before deletion. |
| M97 | `mars/docs/engineering/evidence.json` | Index of construction evidence. | PC01 manifest provenance | retire (needs Gene's OK) | After #730 (PC47). |

## Assets

Media is not in git; `tools/assets/manifest.json` lists it. Counts below are manifest entries.

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M98 | `mars/viewer/public/modular/humanoid/` (`kit.json` + 216 media files) | The people's character set: parts, rigs, animated bodies, clips. | every world: served from the viewer build by `apps/server/src/mars-static.ts`; `apps/server/src/main.ts` warns when missing | catalogue object | The main blocker for deleting `mars/`. Unsure: it is a body kit, not a placeable object; the nearest home is next to `packages/world-compiler/src/core-kit/humanoid2.ts`. |
| M99 | `mars/viewer/public/modular/` environment media (14) | Environment parts of the modular kit. | not traced | retire (needs Gene's OK) | Unsure: not checked whether any world draws them. |
| M100 | `mars/viewer/public/` history and 2020 media (67 + 12) | Campus-year models and 2020 screens. | studio (M37, M38), `mars-static.ts` routes `/history`, `/2020` | retire (needs Gene's OK) | With M46–M47. |
| M101 | `mars/viewer/public/` engine takes (12) | Recorded takes of the bay build and 2022 east-house builds. | studio (M37) | retire (needs Gene's OK) | Historical 8× runs; PC40/PC41 need current real-speed proof instead. |
| M102 | `mars/viewer/public/models/retro-computer-monitor.credit.json` (+ the model in media) | CC BY retro computer and monitor. | engine-view workstation | catalogue object | Check for an existing core-kit computer def. |
| M103 | `mars/viewer/e2e/` baselines (63 media) | Lab and studio visual baselines. | M41 | retire (needs Gene's OK) | With M41. |
| M104 | `worlds/core-assets/mars/` (GLBs, `*.footprint.json`, `placements.json`, `versions.json`, `index.part.json`, `legacy/`) | Mars 2026 library meshes, building footprints and legacy meshes for upgrades. | `worlds/templates/mars-two.json`, `packages/world-compiler/src/core-kit/mars.json` | catalogue object | Already done. |
| M105 | `worlds/core-assets/mars-fidelity/`, `worlds/core-assets/mars-fidelity.index.json` | Cosmetic variants of the Mars meshes. | mars-two upgrades | catalogue object | Already done (M151 builds it). |
| M106 | `worlds/mars/` (`world.json`, `camp/`) | The old Mars world on the Mars engine, scene `eden-camp`, with cast and customs. | `WORLD_KEY=mars`, launcher fork | template data | Already data; it names a scene in code (M52). #579, #386. |
| M107 | `worlds/templates/mars-camp.json`, `mars-two.json`, `mars-two-upgrade-e6613f11.json`, `unified-mars-live-proof-20261027.json`, `worlds/meaning/mars-camp.json`, `worlds/meaning/mars-two.json`, `worlds/meaning/live/mars-two.json`, `worlds/render/mars-fork-land.json` | Mars as templates, upgrade lists, meaning sidecars and the fork's land render. | launcher templates, god skill | template data | Already done; this is the #386 starting point. |
| M108 | `worlds/eden/`, `worlds/templates/eden-2026.json`, `eden-district.json`, `worlds/patches/` (eden-*) | Eden as data: places, activity spots, rides, the 2026 template and patches. | launcher, `apps/web/src/place-names.ts`, `WorldEdenPlaceData.ts` | template data | Already done; the model for #386. |
| M109 | `worlds/littlemartians/`, `worlds/littlemartians-two/`, `worlds/templates/littlemartians-garden.json`, `littlemartians-two.json`, `packages/world-compiler/src/core-kit/littlemartians.json` | Little Martians scene, characters, buildings and templates. | `WORLD_KEY=littlemartians`, launcher | template data | Mostly data already; code branches are M113, M126, M137. |

## Outside mars/: packages/engine-mars

`packages/engine-mars/src/` (89 test files). `load.ts` loads engine files by path; see the #381 map.

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M110 | `packages/engine-mars/src/load.ts`, `engine.ts`, `index.ts`, `catalog-adapter.ts`, `entity-physics.ts`, `ground-bridge.ts`, `checkpoint-hash.ts`, `stall.ts`, `body-location.ts`, `body-motion-action.ts`, `birth.ts`, `arrival-search.ts`, `region-arrival.ts`, `terrain.ts`, `water-geometry.ts`, `upper-floors.ts`, `native-test-state.ts` | The engine adapter behind the engine contract: library defs, entity physics, ground, arrivals, stall release, upper floors. | `apps/server` (`ENGINE=mars`), tools | Soul action | Substrate; #382 renames and moves it. |
| M111 | `packages/engine-mars/src/raise-hold.ts` | Crew raises and holds a loose upright; a stop lowers it. | `engine.ts` registry | Soul action | Done: PC13 (#692), behind `SIM_SHARED_CARRY`. |
| M112 | `packages/engine-mars/src/beam-connect.ts` | Two Souls seat a beam between held uprights; support released once the frame stands. | `engine.ts` registry | Soul action | Done: PC14 (#693), behind the flag. PC15's `deck-install.ts` is in review (PR #1122). |
| M113 | `packages/engine-mars/src/engine.ts` (`LITTLE_MARTIANS_WORLD`, `GREEN_FIELD_WORLD`, `EDEN_COMMONS_WORLD`, the `cfg.scene` branches, the Little Martians character-name list), `load.ts` scenario imports | Chooses scenes, bodies and render data by scene name. | `apps/server/src/main.ts`, `eden-bootstrap.ts` | template data | The core of #579: scene, cast bodies and render roots should come from the world's template. |
| M114 | `packages/engine-mars/src/construction.ts`, `disassembly.ts` | Finite build and take-down of the camp's pallet-rack lookout. | `engine.ts`, `apps/server/src/camp.ts` | template data | Lookout as blueprint plus procedure. Superseded by PC17 (#696) and PC19 (#698) once they land. |
| M115 | `packages/engine-mars/src/mars-2026-map.ts` | The camp placed on the 2026 campus map; campus buildings become obstacles and regions. | `engine.ts` (`map`) | template data | #386; `mars-two.json` already models the campus as defs. |
| M116 | `packages/engine-mars/src/camp-expansion.ts`, `camp-expansion-engine.ts` | Additive ground infrastructure for the Mars camp. | `engine.ts`, server camp tests | template data | Mars camp. |
| M117 | `packages/engine-mars/src/` (commons-kitchen*.ts, commons-life-engine.ts, commons-provisions*.ts, commons-transition.ts, newcomer-resources*.ts, food-delivery.ts, sleep-snapshot-engine.ts, green-landmark.ts, eden-ground*.ts, eden-lecture*.ts, social-eden.ts, crew-removal-engine.ts, gathering-observation.ts, classroom-observation.ts) | Old Eden commons transitions and readers: kitchen, provisions, newcomers, lecture, ground, social seats. | `apps/server/src/eden-bootstrap.ts`, `main.ts`, `tools/core/` harnesses | template data | Eden. Unsure: several are fork-compatibility readers that may simply retire with the old Eden fork. |
| M118 | `packages/engine-mars/src/` (shore-runtime.ts, shore-fixture.ts, shore-capture-fixture.ts, connected-shore.ts, connected-shore-engine.ts, connected-shore-fixture.ts, retained-shore.ts, retained-shore-engine.ts) | Old Eden shore fixtures and transitions. | server installers, tests | template data | Eden. |
| M119 | `packages/engine-mars/src/` (boat-runtime.ts, boat-fixture.ts, connected-boat.ts, connected-boat-engine.ts, connected-boat-fixture.ts, punt.ts, carrier-preview-reference.fixture.ts, punt-search-reference.fixture.ts) | Boats and punts on admitted water. | `apps/server/src/punt-install.ts`, tests | Soul action | Rides any world with water can use (M25, M130). |
| M120 | `packages/engine-mars/src/drink-engine.ts` | Opt-in drink profile. | tests | Soul action | Pairs with `items/drink.ts`. |
| M121 | `packages/engine-mars/src/fixtures/` (7 json) | Eden expansion world, social Eden, shore bed, newcomer layouts, green landmark. | engine-mars tests | template data | Eden fixtures. |
| M122 | `packages/engine-mars/src/*.test.ts` (89) | Adapter and behaviour tests. | `node --test` | Soul action | General tests move with #382; Mars and Eden ones (`mars.test.ts`, `mars-2026-map*.test.ts`, `worlds.test.ts`, `commons*.test.ts`, `eden-*.test.ts`) follow M113–M118. |

## Outside mars/: world-name branches in server and web

The subject of [#579](https://github.com/soulsimulation/souls/issues/579). Brand uses of "Eden" (the eden.art site mark,
the `eden-edge` contract name, `EDEN_GOD_*` variables) and imports of the general engine (#382's subject) are excluded.

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M123 | `apps/server/src/config.ts` (`KNOWN_WORLD_KEYS`, `worldEngine`), `apps/server/src/world-config.ts` | Fixed world keys `toy`, `mars`, `littlemartians`, `eden`; any other key becomes a green-field entity world. | `main.ts` | template data | Each old world should declare its template and capabilities. |
| M124 | `apps/server/src/main.ts` (factory choice by world key, `living.camp = worldKey === 'mars'`, `FloaterCards` for `littlemartians`, Eden core and life flags) | Wires world-specific engines and card packs by world key. | process entry | template data | #579 A1. |
| M125 | `apps/server/src/camp.ts`, `camp-resources.ts`, `living.ts` (camp adoption), `apps/server/src/worlds/mars-edge.ts` | Mars camp activity cards, personal resource bindings and edge offers. | `main.ts`; `mars-edge.ts` only via `tools/core/multiworld/world-server.mjs` | template data | Mars camp cards as world data. |
| M126 | `apps/server/src/floaters.ts`, `edge-runtime-rules.ts` (`LITTLE_MARTIANS_WORLD_KEYS`), `apps/server/src/worlds/floater-edge.ts`, `authored-lm-edge.ts`, `experiences-edge.ts`, `apps/server/src/worlds/testdata/` | Little Martians place cards, Soul-feature exclusion by world key, authored aliases and experiences. | `main.ts`; the `worlds/*` files only via `tools/core/multiworld/world-server.mjs` | template data | Little Martians. |
| M127 | `apps/server/src/edge/body/routes.ts` (`LITTLE_MARTIANS_MOTION`, floater body defaults) | Floater body offers for the Little Martians characters. | edge body API | catalogue object | With M14. |
| M128 | `apps/server/src/eden-bootstrap.ts`, `eden-steering-mode.ts`, `thinking-budget.ts`, `brain.ts` (Eden-only checks) | Old Eden control plane, steering mode and an Eden-only thinking ceiling. | `main.ts`, `config.ts` | template data | Unsure: operational modes of one fork; may retire with it. Budget limits stay as they are. |
| M129 | `apps/server/src/commons-kitchen.ts`, `commons-kitchen-install.ts`, `commons-provisions.ts`, `food-delivery.ts`, `social-eden.ts`, `social-eden-install.ts`, `retained-shore-install.ts` | Old Eden commons kitchen, provisions, food delivery, social seats and shore install. | `eden-bootstrap.ts`; `social-eden-install.ts` and `retained-shore-install.ts` only via `tools/core/` | template data | Eden (M117, M118). |
| M130 | `apps/server/src/punt-install.ts` | Installs two-seat rowing rides from the engine's admitted water. | `main.ts` | Soul action | General rides (M119). |
| M131 | `apps/server/src/edge/content/eden-library-catalogue.ts`, `eden-place-lore.ts` | Authored Eden books and place lore served to every world's edge. | `edge/ledger/ledger.ts`, `edge/outcomes/routes.ts`, `store.ts` | template data | Content for one world, served globally. |
| M132 | `apps/server/src/http.ts`, `agent-reader.ts` ("Little Martians" display name), `apps/server/src/edge/intents/strict.ts` (drops the word "eden") | Display name and intent matching special-cased by world name. | HTTP shell, strict intents | template data | Display name from the template. |
| M133 | `apps/server/src/mars-static.ts`, `apps/server/src/config.ts` (`marsWebDir`) | Serves the Mars viewer build (character set, campus media) and proxies misses to the public Mars origin. | `http.ts` | catalogue object | Serves M98. Unsure: the destination is "wherever the body kit goes". |
| M134 | `apps/server/src/god/assets.ts` (tag alias `martian`) | Asset search alias to `littlemartians`. | god asset search | catalogue object | Tag data on defs. |
| M135 | `apps/web/src/mars-fork.ts`, `WorldMarsForkLand.ts`, `main.tsx` (backdrop prefetch), `site-north.ts` | The Mars fork's campus backdrop, land and bearing. | `LiveWorld.tsx`, `WorldGeometry.ts` | template data | #386. |
| M136 | `apps/web/src/WorldMarsDesert.ts`, `WorldGeometry.ts` (`isMarsCamp`) | Desert ground drawn when the scene has a `camp-ground` surface. | `WorldGeometry.ts` | template data | Ground style from the template. |
| M137 | `apps/web/src/LiveWorld.tsx`, `WorldGeometry.ts` (default asset root `/world-assets/littlemartians`) | Floater, kin and building asset roots fixed to Little Martians. | world page | template data | #579 A2 "rendering/asset roots". |
| M138 | `apps/web/src/old-eden.ts`, `WorldEdenExpansion.ts`, `WorldEdenPlaces.ts`, `WorldEdenSurfaceStudy.ts`, `WorldEdenTransport.ts`, `WorldEdenWind.ts`, `WorldEdenActivation.ts`, `old-scene-kit.ts`, `WorldEdenSurfaceSource.json`, `WorldEdenWindSource.json` | Old Eden's hand-built town, loaded as its own chunk. | `LiveWorld.tsx` | template data | Eden; `tools/god-skill/scripts/eden-2026/` already extracted it into `worlds/templates/eden-2026.json`. |
| M139 | `mars/viewer/app/engine-view/content/assets/` (eden-*), `mars/viewer/app/engine-view/content/environment/` (eden-*), `mars/viewer/app/engine-view/content/details/` (eden-*), `mars/viewer/app/engine-view/content/eden-expansion/` | The builders behind M138: districts, interiors, regions, facades, street props, landscape, wind. | web 9 (24) for assets · web 6 (5) for environment and details · tools 1 | template data | Listed here because only apps/web consumes them. |
| M140 | `mars/viewer/app/engine-view/content/` (commons*, current-*, native-*, captured-*, connected-native-shore, safe-commons-understory, dry-*, shore-*, scene-fog, provisional-commons-rest, commons-contrast, commons-prefabs, shore-boat) | Old Eden commons and shore scenery. | web 10 (3) | template data | Eden. |
| M141 | `mars/viewer/app/engine-view/content/` (*-proposal, garden-*, dwelling-kit, seating-prefabs, room-furnishing-kit, social-place-kit, transport-prop-family, pavilion-vines, decorative-motion, vertex-soup, volcanic-landscape-kit, forest-understory, planter-blossoms, wetland-plant-family, below-window-groundcover) | Scenery proposals and kits used by the Eden expansion. | web 3 (5); mostly via M139 | template data | Unsure: reusable kits could become catalogue objects. |
| M142 | `mars/viewer/app/engine-view/content/details/human-presets/`, `candidate05-rich-sidecar/`, `surface-refinement-v2/` | Human look presets and surface refinements. | web 3 (1) · server (1) | catalogue object | Look presets as body defs. |
| M143 | `apps/web/src/WorldEdenPlaceData.ts`, `place-names.ts`, `WorldGroundDetails.ts`, `WorldSnapshots.ts` (Eden place filters) | Eden places compiled into the client and used by every world's place naming. | world page, shell | template data | Generated from `worlds/eden/places.v1.json`. |
| M144 | `apps/web/src/WorldAtmosphere.ts` (`eden` profile default), `atmosphere/palettes.ts`, `atmosphere/indoors.ts`, `WorldBalloonRide.ts` | Eden lighthouse, fog banks, balloons, fire pits and indoor list as the default atmosphere. | world page | template data | Profile from the template. |
| M145 | `apps/web/src/WorldCommons.ts`, `WorldShore.ts`, `WorldShoreBankEdges.ts` | Old Eden commons and shore drawing. | `WorldGeometry.ts`, `WorldEdenExpansion.ts` | template data | Eden. |
| M146 | `apps/web/src/eden-release.ts`, `local-navigation.ts`, `world-title.ts`, `snapshot-prefetch.ts` (`OLD_WORLD_KEYS`), `world-kind.ts` | Path checks for `/w/eden`, display name for `littlemartians`, the fixed old-world key list. | shell, `main.tsx` | template data | #579. |
| M147 | `apps/web/src/WorldEdenRealism.ts`, `WorldEdenSurfaceKit.ts` | Surface and realism helpers named for Eden but used by general building and area meshes. | `gen-mesh/building-kit.ts`, `areas.mesh.ts`, `WorldEntityLayer.ts` | Soul action | Name only; unsure, not read in depth. |

## Outside mars/: tools

| ID | Source | What it does | Consumers | Destination | Notes / already done by |
|---|---|---|---|---|---|
| M148 | `tools/assets/mars-web.mjs`, `mars-web.test.mjs` | Builds the viewer site so the server can serve the character set. | root `build`, `predev`, `build:viewer`, CI | catalogue object | Goes wherever M98 goes. |
| M149 | `tools/inventory/mars-imports.py`, `docs/architecture/mars-import-inventory.md` | The #381 import scanner and map. | this inventory | retire (needs Gene's OK) | After #382 and #387. |
| M150 | `tools/physical-manifest/`, `docs/design/physical-coordination-manifest.json` | PC01 manifest and its checker. | #560 workers | retire (needs Gene's OK) | After PC47/PC48 (#730, #731); it is the Lab coverage record until then. |
| M151 | `tools/mars-fidelity/` | Builds cosmetic variants of the Mars meshes. | M105 | catalogue object | Already done. |
| M152 | `tools/mars-m2/` | Probes, shots and proofs against local copies of the Mars two world. | one-off proofs | retire (needs Gene's OK) | Proof scripts for past PRs. |
| M153 | `tools/mars-rotation/` | Rotates the campus to a true bearing and adds water defs with ordinary god edits; proofs. | god patches | template data | Patch pipeline for the Mars template. |
| M154 | `tools/god-skill/scripts/mars-two/`, `tools/god-skill/e2e/` (mars-lived.mjs, mars-two.mjs, mars-two-walkthrough.mjs, marsland-*.mjs) | Builds `mars-two.json` and its library defs; walks it end to end. | god skill | template data | The #386 path. |
| M155 | `tools/god-skill/scripts/eden-2026/`, `tools/god-skill/scripts/lm-two/`, `tools/god-skill/e2e/lm-two.mjs`, `lm-two-walkthrough.mjs` | Builds Eden 2026 and Little Martians two templates from the old worlds. | god skill | template data | Already done; the model for #386. |
| M156 | `tools/upper-floors/old-eden-hotels.mjs`, `old-eden-office.mjs` | Upper floors for old Eden buildings. | operators | template data | Eden. |
| M157 | `tools/blobs/campus-parts.mjs`, `compare-campus.mjs`, `shrink-campus.mjs` | The Mars campus backdrop as shared parts. | fork backdrop (M135) | template data | Unsure: may be superseded by `mars-two.json`. |
| M158 | `tools/world-launcher/fork-world.mjs`, `fork.test.mjs`, `tools/test-harness/old-worlds.mjs`, `tools/test-harness/campus-assets.json`, `tools/test-harness/mars-two-admission-read.test.mjs` | Old worlds (eden, mars, littlemartians) as launcher forks; local old-world servers. | launcher, harness | template data | Unsure: retire when the forks become templates. |
| M159 | `tools/core/local-eden-expanded.mjs`, `edge-server.mjs`, `eden-activity-spots.v1.json`, `eden-district-solids.v1.json`, `tools/core/multiworld/` | Old Eden and Little Martians server harnesses. | operators | template data | Unsure: may retire with the forks. |
| M160 | `tools/parity/` | Old/new world comparison pages, including Eden. | operators | retire (needs Gene's OK) | After #386. |
| M161 | `tools/capability-stall/evidence/base-mars-summary.json`, `mars-check-summary.json` | Recorded stall evidence on Mars. | none | retire (needs Gene's OK) | Evidence only. |
| M162 | `tools/playtest/scenarios/` (look-mars-two.json, wayfind-mars-two.json, unified/mars.json, casts/podium-mars-room.json, look-eden-2026.json, wayfind-eden-2026.json, unified/eden.json, casts/podium-eden-hall.json) | Playtests bound to Mars and Eden templates. | `tools/playtest/` | template data | Keep; they test templates, not code branches. |

## #384, #383 and #385 against the #560 PCs

"Landed" means merged on `main` at the pinned commit; "in review" means an open PR; "planned" means an open issue.
These are recommendations. Nothing is closed without Gene's OK.

### #384: construction actions as general Soul actions

| Primitive or deliverable | PC (issue) | State | Rows |
|---|---|---|---|
| Raise an upright and hold it | PC13 (#692) | landed, behind `SIM_SHARED_CARRY` | M61, M111 |
| Lower or cancel a raise safely | PC13 (#692) | landed | M61 |
| Connect a beam | PC14 (#693) | landed, behind the flag | M62, M112 |
| Release a support once the frame stands | PC14 (#693) | landed | M62, M112 |
| Install joists and plywood decks | PC15 (#694) | in review (PR #1122) | M63 |
| Stair flights and treads | PC16 (#695) | in review (#1132) | M64 |
| Roof framing: top plates, rafters, blocking | PC38 (#718) | planned | M67 |
| Lift crews | PC13/PC14 reuse `liftcrew.ts`; larger crews PC11 (#690) | PC11 open | M60, M73 |
| Hand-ups | PC33 (#712), prone receive PC34 (#713), forklift PC36 (#715) | planned | M66, M74 |
| Disassembly | PC19 (#698) | planned | M71 |
| Reach and support invariants | PC12 (#691) support graph, PC13/PC14 invariants | landed | M60, M85 |
| Independent participation and safe cancellation | PC04/PC05 (#683, #684), PC08 (#687) | landed | — |
| Safe checkpoints and restart | PC10 (#689) for carry; each construction PC adds its own | landed for carry | — |
| Done when: a Soul raises and decks a small frame in a non-Mars world, on video | PC15 (#694) then PC20 (#699) | in review / planned | M63 |

Left over with no PC: `climb_frame` and `beam_walk` (M65). The PC01 manifest assigns them to PC14, but PC14 shipped only
`connect_beam_v1`.

**Recommendation:** close #384 as superseded once PC15, PC16, PC19, PC33 and PC38 land and PC20 proves the non-Mars
frame. Before that, confirm whether `climb_frame`/`beam_walk` belong to a PC; if not, keep #384 narrowed to those two.

### #383: data-driven building kit from the Mars campus assembly

| Primitive or deliverable | PC (issue) | State | Rows |
|---|---|---|---|
| Material definitions as data | PC03 (#682) beam, upright, sheet; PC15 (#694) joists; PC32 (#711) bundles; PC37 (#716) framing; PC39 (#720) solar | PC03 landed; PC15 in review; rest planned | M78–M80, M85 |
| Target blueprints: parts and joints as data | PC12 (#691) typed connectors and god `connect` | landed | M85 |
| Parameterized bay blueprint | PC17 (#696) | planned | M75 |
| Procedure templates | PC17 (#696), on the native sequence runner | planned | M09, M44 |
| Live sessions | PC02 (#681) contract, PC04/PC05 (#683, #684), PC17 bounded sessions | contract and roles landed; PC17 planned | — |
| Persistent project resumed by a different consenting crew | PC18 (#697) | planned | M10 |
| Progress from actual connections and support | PC12 (#691), PC14 (#693) | landed | M60, M62 |
| Floors and stairs usable once installed | PC15 (#694), PC16 (#695) | landed / in review (#1132) | M63, M64 |
| Reversible disassembly keeping identity | PC19 (#698) | planned | M71 |
| Second arrangement and a non-Mars world through the same authoring | PC20 (#699) | planned | M75 |
| Mars campus expressed with the same kit | PC40–PC43 (#721, #724, #725, #726); PC21 (#700) packages the first stock yard and bay | planned | M44, M76 |
| Floors, openings and seats exposed to Souls | Floors PC15/PC16; seats from def geometry (SEATDEF) | partly existing | — |

Left over with no PC: openings (doors, windows) in an assembled kit building's walls exposed to Souls. PC37 installs wall
parts but does not name openings. The campus assembly data (M44) has no named conversion step outside PC40–PC43.

**Recommendation:** fold #383 into PC17, PC18, PC20 and PC40–PC43 and close it as superseded once they land, keeping a
narrowed #383 only for openings in assembled walls if PC37 does not cover them.

### #385: pallet racks and stock items into the general catalogue

| Primitive or deliverable | PC (issue) | State | Rows |
|---|---|---|---|
| Pallet racks placeable in any world, with shelf levels | `core-pallet-rack@1` (before the PCs: a complete rack with a surface and shelf sockets) | exists | M85 |
| Versioned loose uprights (braced two-column frames) | PC03 (#682) `core-rack-upright@1`; PC12 (#691) `@2` | landed | M85 |
| Beams | PC03 `core-rack-beam@2`; PC12 `@3` | landed | M85 |
| Individual plywood sheets | PC03 `core-plywood-sheet@1` | landed | M85 |
| Joists and timber | PC15 (#694) | in review | M78 |
| Counted bundles and stock extraction | PC32 (#711) | planned | M70, M78 |
| Mass, crew limits, grips, handling checks | PC03 handling; PC11 (#690) define-time checks and `core-work-table@1` | PC03 landed; PC11 open (its code is on main) | M85 |
| Sockets and support | PC12 (#691) | landed | M85 |
| Stair, wall, roof, solar accessories | PC16 (#695), PC37 (#716), PC38 (#718), PC39 (#720) | planned | M78–M80 |
| Handling and cutting equipment | PC32 cut (#711), PC26 saw (#705), PC36 forklift (#715) | planned | M70, M74 |
| Fresh clients author, save, reload and use the pack | PC20 (#699), PC21 (#700) | planned | — |
| Mars campus uses the general entries | `mars-two.json` already uses `core/mars-*` defs for furniture and buildings; rack buildings from parts PC40/PC41 | furniture done; racks planned | M86, M104 |

Left over with no PC: rack beam levels as seats (sitting on a rack beam) are not named by any PC; unsure whether
Gene still wants them. Non-construction Mars items (`catalog-items.ts`, M81) are outside #385 and outside the PCs.

**Recommendation:** close #385 as superseded once PC15, PC32 and PC11 land, keeping a narrowed #385 only for rack
seat levels if Gene still wants them.

## Order

The later steps this inventory unblocks, in Gene's order. Each lists the rows it depends on.

1. **#579, world-name branches (Eden and Little Martians included).** Rows: M08, M14, M23, M52–M55, M106, M108,
   M109, M113, M117, M118, M121, M123–M147, M156, M158, M159. Decide the "unsure" ones first: M54, M128, M147, M158,
   M159.
2. **#386, Mars College 2026 as template data.** Rows: M44, M45, M48, M50 (the one export path to keep), M52, M86,
   M104–M107, M114–M116, M125, M135, M136, M153, M154, M157. Starts from `mars-two.json` (M107) and the Eden pattern
   (M108, M155).
3. **#382, move the general engine out of `mars/viewer` into a package named for Souls.** Every **Soul action** row:
   M01–M07, M09–M13, M16–M22, M24–M32, M34, M57, M60–M74, M92, M110–M112, M119, M120, M122, M130, M147. Also the
   **catalogue object** rows still read from the engine at run time: M77–M82 (the `CATALOG` registry and its stock).
4. **#387, retire Mars tooling and delete `mars/`, last.** Every row must have a home first. Blockers: M98, M133 and
   M148 (the character set served from the viewer build), M43 (build and release inputs), and every **retire** row
   with Gene's OK: M33, M36–M43, M46, M47, M49–M51, M58, M59, M87, M88, M90, M91, M93–M97, M99–M101, M103, M149,
   M150, M152, M160, M161.

## Method and limits

- Pinned source: worktree at `origin/main` `9fa4cbea0`. Files listed with `git ls-files mars`, `git ls-files packages/engine-mars`,
  `git ls-files tools`, `git ls-files worlds`; header comments read with `grep`.
- Consumers: `python3 tools/inventory/mars-imports.py --consumers`, aggregated per row to distinct importing files
  outside the row. The scanner is lexical (see the #381 map's limits); it does not see imports inside the Mars viewer
  app or computed paths beyond `load.ts`.
- World-name branches: `git grep` over `apps/server/src` and `apps/web/src` (tests excluded) for world-key literals
  (`mars`, `eden`, `eden-2026`, `eden-camp`, `eden-commons`, `littlemartians`, `little-martians-arium`, `greenfield`),
  `worldKey` comparisons, `base.campus` checks and `LITTLE_MARTIANS`/`EDEN_` names; then reading each hit.
- Issue and PC states: `gh issue view <n> --json state` for #560's children and #382, #383, #384, #385, #386, #387,
  #579; `gh pr view 1122` for PC15.
- Assets: `tools/assets/manifest.json` entries under `mars/` and `worlds/core-assets/mars*`.
- Not verified: runtime reachability (a module imported only by a test or a tool may still be dead), whether
  `mars/viewer/simulation/` is deployed anywhere, which environment media (M99) any world draws, and every
  individual Lab scenario's PC beyond the PC01 manifest. Destinations marked "unsure" are best guesses. Row counts
  of test files are from `git ls-files` at the pin. The spot check of 10 random rows that #1123 asks for is for the PR.
