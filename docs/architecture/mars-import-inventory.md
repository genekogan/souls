# Mars dependency inventory

Snapshot at `90e5266c24f8156d66a041f12c48763723c7fd45` for [#381](https://github.com/genekogan/souls/issues/381).
This is a dependency map, not authorization to move files. Destinations and classifications are **proposals**,
not package names or decisions; directory-level classification can hide mixed content and requires review at each move.
In particular, `engine/world`, `api`, and viewer features can mix generic behavior with authored data. Preserve
Lab, construction recovery sources and fixtures (#560, #561) until their replacement and tests are proven.

## Method and limits

Run `python3 tools/inventory/mars-imports.py` at the repository root to regenerate the table from tracked source; add `--consumers` to list the files behind each row.
Each number is a literal import or re-export **site**, including type and literal dynamic imports, not a runtime
invocation count or distinct consumer count. `apps` excludes web tests; `web tests` recognizes `.test.` and `.spec.`
files under `apps/web`; `engine tests` covers `mars/viewer/engine/test`; `packages` and `tools` include their tests.
`loader` counts literal `at('…')` calls in `packages/engine-mars/src/load.ts`, whose computed URL otherwise escapes
literal import searches. Direct test-to-test and fixture imports appear when they resolve under `mars/`.
The scanner is lexical, not a TypeScript parser; comments, unusual syntax, aliases, computed specifiers and generated
code may require manual review. It does not recursively enumerate the internal engine dependency graph. Re-run and
review the diff at the source commit before using it to plan a move.

## Boundaries and contracts to preserve

- `mars/viewer` is itself a private pnpm workspace (`pnpm-workspace.yaml`, `mars/viewer/package.json`). Imports in the
  table are mostly relative deep imports, not stable package exports. `packages/engine-mars/src/load.ts` loads engine
  files by path and adapts them into the `Mars` interface; `packages/engine-contract` supplies the host-facing
  `Engine`/`EngineFactory` seam. Keep deterministic stepping, snapshots, replay hashes, rules versions and take wire
  formats compatible across any move; see [map](map.md#3-the-engine-seam) and [engine contract](engine-contract.md).
- Viewer modules are browser-facing and should remain separate from engine execution. The general feature destination
  means an appropriate viewer or feature boundary, not necessarily one package. Authored scenarios and content need
  their data, fixture and asset references retained; the table's content category does not mean disposable.
- The table excludes non-module file paths and package-resolution anchors. `createRequire` calls targeting
  `mars/viewer/package.json` resolve browser tooling; `tools/capability-stall/preload.mjs` uses a computed `imp` for
  `engine/spatial/tiled.ts`. `tools/assets/mars-web.mjs` builds `mars/viewer/dist/client` from viewer inputs and checks
  generated character assets; root `build` calls it and `apps/server/src/mars-static.ts` serves the resulting static
  surface. Media is pulled separately (`tools/assets/pull.mjs`); do not treat generated output as source.
- `mars/` currently falls through to all jobs in `.github/scripts/ci-scope.mjs`; changing paths can change CI coverage.
  Release uses a clean `git archive HEAD` and a Mars web overlay (see [release](../release.md)); a move must update both
  build and release inputs and verify the archived build. This inventory does not certify those future changes.

## Direct module sites

Classes: **general engine** = engine/shared implementation; **general feature to rescue** = feature, viewer or test
behavior to preserve; **Mars content** = authored world-specific data or presentation. These are conservative
path-based first-pass labels, and each row's destination is a boundary rather than a final pathname.

| Module | Class | Proposed destination | apps | packages | tools | engine tests | web tests | loader |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `mars/viewer/app/engine-view/activity-poses.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 1 | 0 | 6 | 0 |
| `mars/viewer/app/engine-view/body-rig.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/character-wire.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/engine-view/components.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/courtyard-house-proposal/house.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/decorative-motion.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-computers/index.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-districts/index.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-event-kit/index.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/activity-clusters.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/country-lookout.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/craft-performance.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/dome-quarter.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-artist-row.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-house-windows.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-landmarks.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-street-details.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-village-features.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/entrance-lanterns.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/garden-fountain.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/gardens-yard.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/house-three-roof-access.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/interior-deepen.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/lake-dock.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/library-ground-contract.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/neighborhood.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/public-quarter.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/river-crossing.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/roof-planters.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/rural-variants.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/terrace-furniture.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-expansion-assets/venue.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-facades/index.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-facades/plan.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-imports/animal-plan.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-imports/animals.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-imports/assets.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-imports/groundcover.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-imports/index.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-imports/interior-plan.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-interiors/buildings.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-interiors/existing.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-interiors/explore.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-interiors/index.ts` | Mars content | world content / fixtures | 3 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-interiors/kit.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-interiors/places.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/buildings.ts` | Mars content | world content / fixtures | 3 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/coast-surf.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/explore.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/hotel-core.ts` | Mars content | world content / fixtures | 0 | 0 | 1 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/index.ts` | Mars content | world content / fixtures | 4 | 0 | 0 | 0 | 3 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/kit.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 5 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/places.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/resort-lake.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/south.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 4 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-regions/trees.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-sports-kit/index.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-street-props/index.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-street-props/kit.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-street-props/placements.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-street-props/shadows.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-street-props/signs.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-wayfinding/index.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/eden-window-interiors.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/native-social-kit-actual/social.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/office-building-proposal/stair-guards.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/pavilion-vines.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/provisional-commons-rest/markers.mjs` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/public-library-proposal/library.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/assets/room-furnishing-kit.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/assets/transport-prop-family/transport.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/details/eden-expansion-wind/wind.mjs` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/details/eden-factory-comparison/new-landscape-entry.mjs` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/details/human-presets/finish.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/details/human-presets/presets.mjs` | Mars content | world content / fixtures | 3 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/environment/captured-shore.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/commons-meadow.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/commons-paths.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/commons.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/connected-native-shore.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/engine-view/content/environment/current-provisions-understory/current.mjs` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/environment/current-social-dressing/dressing.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/lake-dock-tuple.json` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/landscape.mjs` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/layout.mjs` | Mars content | world content / fixtures | 4 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/planting.mjs` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/eden-expansion-outlook/outlook.mjs` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/eden-expansion-roof-garden/roof-garden.mjs` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/eden-water-readability/daylight.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/content/environment/native-shore-terrain.ts` | Mars content | world content / fixtures | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/native-social-paths/paths.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/content/environment/scene-fog.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/fixtures.ts` | general feature to rescue | viewer or feature package | 3 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/engine-view/floaters.ts` | general feature to rescue | viewer or feature package | 2 | 0 | 1 | 0 | 3 | 0 |
| `mars/viewer/app/engine-view/human-appearance.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/humans.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 10 | 0 |
| `mars/viewer/app/engine-view/paint.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/engine-view/people-light.ts` | general feature to rescue | viewer or feature package | 2 | 0 | 0 | 0 | 5 | 0 |
| `mars/viewer/app/engine-view/people.ts` | general feature to rescue | viewer or feature package | 8 | 0 | 1 | 0 | 14 | 0 |
| `mars/viewer/app/engine-view/piano-score.ts` | general feature to rescue | viewer or feature package | 3 | 0 | 0 | 0 | 3 | 0 |
| `mars/viewer/app/engine-view/poster-sheet.ts` | general feature to rescue | viewer or feature package | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/posture.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/engine-view/recorded-body.ts` | general feature to rescue | viewer or feature package | 2 | 0 | 0 | 0 | 3 | 0 |
| `mars/viewer/app/engine-view/recorded-gait-continuity.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/recorded-games.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 1 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/recorded-platforms.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/recorded-shore.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/rig.ts` | general feature to rescue | viewer or feature package | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/rowing-punt.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/shore-preview.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/sleep.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/engine-view/stair-frame.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/stair-gait.ts` | general feature to rescue | viewer or feature package | 0 | 2 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/stair-mesh-profile.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 1 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/stair-mesh-profiles.json` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/app/engine-view/station-depiction.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/take-replay.ts` | general feature to rescue | viewer or feature package | 3 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/app/engine-view/vegetation.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/app/engine-view/walk-ease.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 0 | 2 | 0 |
| `mars/viewer/app/lab/body.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/lab/build-bay.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/app/lab/campfire-evening.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/lab/scenarios.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 11 | 0 | 0 |
| `mars/viewer/app/lab/sim.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 6 | 0 | 0 |
| `mars/viewer/app/lab/world-snapshots.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/lab/year-build.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/studio/direct-camera-client.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/app/studio/direct-camera-compile.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/app/studio/direct-camera.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/cinematography/camera.test.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/cinematography/director.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/cinematography/types.ts` | general feature to rescue | viewer or feature package | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/deploy/scenario-contracts.mjs` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/actions/types.ts` | general engine | engine or shared library | 0 | 3 | 0 | 66 | 0 | 0 |
| `mars/viewer/engine/activities/art-sharing.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/classroom.ts` | general feature to rescue | viewer or feature package | 0 | 1 | 0 | 6 | 0 | 0 |
| `mars/viewer/engine/activities/communal-supper.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/computer-music.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/activities/computer-workshop.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/gallery-tour.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/activities/garden-circuit.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/gathering-continuation.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/activities/group-warmup.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/index.ts` | general feature to rescue | viewer or feature package | 0 | 1 | 0 | 8 | 0 | 0 |
| `mars/viewer/engine/activities/library-reading.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/living-intention.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/activities/music-gathering.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/activities/open-jam.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/paired-walk.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/prepare-food.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/activities/purposeful-routine.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 8 | 0 | 0 |
| `mars/viewer/engine/activities/reading-circle.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/activities/room-preparation.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/room-setup.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/seed-planting.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/activities/shared-food-break.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/activities/sleep.ts` | general feature to rescue | viewer or feature package | 0 | 2 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/activities/table-cleanup.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/activities/turns.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/api/camera-vocab.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/api/controller.ts` | general engine | engine or shared library | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/api/edit.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/api/index.ts` | general engine | engine or shared library | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/api/registry.ts` | general engine | engine or shared library | 0 | 2 | 0 | 42 | 0 | 1 |
| `mars/viewer/engine/api/seeds.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 1 |
| `mars/viewer/engine/bodies/body.ts` | general engine | engine or shared library | 2 | 1 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/bodies/creatures.ts` | general engine | engine or shared library | 3 | 1 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/bodies/humanoid.ts` | general engine | engine or shared library | 5 | 1 | 0 | 1 | 1 | 0 |
| `mars/viewer/engine/bodies/index.ts` | general engine | engine or shared library | 0 | 1 | 0 | 1 | 2 | 0 |
| `mars/viewer/engine/bodies/models.ts` | general engine | engine or shared library | 1 | 0 | 1 | 0 | 0 | 0 |
| `mars/viewer/engine/bodies/navigation.ts` | general engine | engine or shared library | 2 | 2 | 1 | 1 | 0 | 0 |
| `mars/viewer/engine/bodies/policy.ts` | general engine | engine or shared library | 0 | 0 | 0 | 0 | 0 | 1 |
| `mars/viewer/engine/body/model.ts` | general engine | engine or shared library | 1 | 1 | 0 | 5 | 1 | 0 |
| `mars/viewer/engine/camera/chapter-shots.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/camera/correct.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/camera/direct.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 9 | 0 | 0 |
| `mars/viewer/engine/camera/geom.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 10 | 0 | 0 |
| `mars/viewer/engine/camera/occluders.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/camera/parse.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/camera/plan.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/camera/quality.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 6 | 0 | 0 |
| `mars/viewer/engine/camera/samplers.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/camera/shotlist.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/camera/shots.ts` | general feature to rescue | viewer or feature package | 2 | 0 | 0 | 11 | 0 | 0 |
| `mars/viewer/engine/camera/solve.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/camera/synth.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 11 | 0 | 0 |
| `mars/viewer/engine/camera/take-sampler.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/camera/track.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 6 | 0 | 0 |
| `mars/viewer/engine/campus/assembly.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/campus/bom.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 6 | 0 | 0 |
| `mars/viewer/engine/campus/extract.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/campus/geom.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/campus/history-extract.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/campus/history-node.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 16 | 0 | 0 |
| `mars/viewer/engine/campus/history.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 16 | 0 | 0 |
| `mars/viewer/engine/campus/load.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 7 | 0 | 0 |
| `mars/viewer/engine/campus/node.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 7 | 0 | 0 |
| `mars/viewer/engine/campus/regions.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/campus/sequence.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/campus/types.ts` | Mars content | world content / fixtures | 0 | 1 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/campus/world.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 7 | 0 | 0 |
| `mars/viewer/engine/carry/actions.ts` | general engine | engine or shared library | 0 | 0 | 0 | 14 | 0 | 0 |
| `mars/viewer/engine/carry/climb.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/carry/fixture.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/carry/formation.ts` | general engine | engine or shared library | 1 | 2 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/carry/fragile.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/carry/invariants.ts` | general engine | engine or shared library | 0 | 0 | 0 | 16 | 0 | 0 |
| `mars/viewer/engine/carry/scenes.ts` | general engine | engine or shared library | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/construction/access.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 8 | 0 | 0 |
| `mars/viewer/engine/construction/bundle.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/construction/contributor.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/construction/cut.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/construction/deck.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/construction/disassembly.ts` | general feature to rescue | viewer or feature package | 0 | 3 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/construction/frame.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/construction/framemove.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/construction/framing.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/construction/handup.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/construction/index.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 6 | 0 | 0 |
| `mars/viewer/engine/construction/invariants.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/construction/liftcrew.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/construction/lying.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/construction/raise-lower.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/construction/raise.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/construction/rules.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 10 | 0 | 0 |
| `mars/viewer/engine/construction/setpart.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/construction/solar.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/construction/stance.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/core/hash.ts` | general engine | engine or shared library | 2 | 10 | 0 | 60 | 0 | 1 |
| `mars/viewer/engine/core/math.ts` | general engine | engine or shared library | 8 | 11 | 0 | 69 | 0 | 0 |
| `mars/viewer/engine/core/order.ts` | general engine | engine or shared library | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/core/rng.ts` | general engine | engine or shared library | 0 | 0 | 0 | 8 | 0 | 1 |
| `mars/viewer/engine/env/daylight.ts` | general engine | engine or shared library | 2 | 0 | 0 | 1 | 1 | 0 |
| `mars/viewer/engine/env/sun.ts` | general engine | engine or shared library | 4 | 0 | 0 | 5 | 4 | 0 |
| `mars/viewer/engine/games/chess-rules.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/history/store.ts` | general engine | engine or shared library | 0 | 0 | 0 | 22 | 0 | 0 |
| `mars/viewer/engine/items/actions.ts` | general engine | engine or shared library | 1 | 1 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/items/body.ts` | general engine | engine or shared library | 0 | 1 | 0 | 6 | 0 | 0 |
| `mars/viewer/engine/items/cup.ts` | general engine | engine or shared library | 1 | 0 | 1 | 0 | 0 | 0 |
| `mars/viewer/engine/items/drink.ts` | general engine | engine or shared library | 0 | 2 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/items/handover.ts` | general engine | engine or shared library | 1 | 0 | 1 | 0 | 0 | 0 |
| `mars/viewer/engine/items/model.ts` | general engine | engine or shared library | 0 | 7 | 0 | 34 | 0 | 0 |
| `mars/viewer/engine/items/presentation.ts` | general engine | engine or shared library | 0 | 0 | 1 | 0 | 1 | 0 |
| `mars/viewer/engine/items/watering.ts` | general engine | engine or shared library | 2 | 0 | 1 | 0 | 0 | 0 |
| `mars/viewer/engine/locomotion/connected-shore.ts` | general engine | engine or shared library | 1 | 2 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/locomotion/shore.ts` | general engine | engine or shared library | 1 | 8 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/locomotion/spline.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/locomotion/swim.ts` | general engine | engine or shared library | 1 | 1 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/locomotion/walk.ts` | general engine | engine or shared library | 0 | 2 | 0 | 57 | 0 | 1 |
| `mars/viewer/engine/objects/chess.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/objects/classroom.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/objects/drawing.ts` | general engine | engine or shared library | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/objects/garden.ts` | general engine | engine or shared library | 0 | 0 | 0 | 8 | 0 | 0 |
| `mars/viewer/engine/objects/planting.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/objects/reading.ts` | general engine | engine or shared library | 0 | 0 | 0 | 9 | 0 | 0 |
| `mars/viewer/engine/objects/workstation.ts` | general engine | engine or shared library | 0 | 0 | 0 | 16 | 0 | 0 |
| `mars/viewer/engine/rehearsal/rehearse.ts` | general feature to rescue | viewer or feature package | 0 | 0 | 0 | 19 | 0 | 0 |
| `mars/viewer/engine/runtime/codec.ts` | general engine | engine or shared library | 1 | 11 | 0 | 7 | 0 | 0 |
| `mars/viewer/engine/runtime/compact.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 1 |
| `mars/viewer/engine/runtime/invariants.ts` | general engine | engine or shared library | 0 | 10 | 0 | 66 | 0 | 0 |
| `mars/viewer/engine/runtime/runtime.ts` | general engine | engine or shared library | 1 | 24 | 0 | 141 | 0 | 1 |
| `mars/viewer/engine/runtime/snapshot.ts` | general engine | engine or shared library | 2 | 19 | 0 | 14 | 0 | 1 |
| `mars/viewer/engine/runtime/waits.ts` | general engine | engine or shared library | 0 | 1 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/scenarios/art-sharing.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/build-bay-v2.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/build-bay-v3.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/build-bay.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 7 | 0 | 0 |
| `mars/viewer/engine/scenarios/chess.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/classroom.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 15 | 0 | 0 |
| `mars/viewer/engine/scenarios/communal-supper.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/computer-music.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/computer-workshop.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/creative-afternoon.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/design-studio.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/scenarios/drawing-work.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/scenarios/eden-camp.ts` | Mars content | world content / fixtures | 6 | 6 | 0 | 1 | 1 | 1 |
| `mars/viewer/engine/scenarios/eden-commons.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 0 | 1 |
| `mars/viewer/engine/scenarios/gallery-tour.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/scenarios/garden-afternoon.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/garden-care.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/scenarios/garden-circuit.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/greenfield.ts` | Mars content | world content / fixtures | 0 | 1 | 0 | 0 | 1 | 1 |
| `mars/viewer/engine/scenarios/group-warmup.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/library-reading.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/littlemartians.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 0 | 0 | 1 |
| `mars/viewer/engine/scenarios/living-day.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/scenarios/meal.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 4 | 0 | 1 |
| `mars/viewer/engine/scenarios/music-gathering.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/open-jam.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/paired-meal-walk.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/scenarios/preparation.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/scenarios/prepared-day.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/reading-circle.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/scenarios/reading.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 9 | 0 | 0 |
| `mars/viewer/engine/scenarios/room-preparation.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/seed-planting.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/scenarios/sleep.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 6 | 0 | 0 |
| `mars/viewer/engine/scenarios/table-cleanup.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/scenarios/work-break.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 9 | 0 | 0 |
| `mars/viewer/engine/scenarios/year-build.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/scenes/proving-ground.ts` | Mars content | world content / fixtures | 1 | 0 | 0 | 48 | 0 | 0 |
| `mars/viewer/engine/sequence/bind.ts` | general engine | engine or shared library | 0 | 0 | 0 | 15 | 0 | 0 |
| `mars/viewer/engine/sequence/blocked-tails.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/sequence/runner.ts` | general engine | engine or shared library | 0 | 0 | 0 | 10 | 0 | 0 |
| `mars/viewer/engine/sequence/types.ts` | general engine | engine or shared library | 0 | 0 | 0 | 7 | 0 | 0 |
| `mars/viewer/engine/social/actions.ts` | general engine | engine or shared library | 0 | 1 | 0 | 13 | 0 | 0 |
| `mars/viewer/engine/social/frisbee-clearance.ts` | general engine | engine or shared library | 1 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/social/hand-actuator.ts` | general engine | engine or shared library | 6 | 0 | 5 | 3 | 4 | 0 |
| `mars/viewer/engine/social/hand-hold.ts` | general engine | engine or shared library | 1 | 0 | 0 | 1 | 1 | 1 |
| `mars/viewer/engine/social/pose.ts` | general engine | engine or shared library | 2 | 1 | 0 | 8 | 0 | 1 |
| `mars/viewer/engine/social/rps.ts` | general engine | engine or shared library | 1 | 0 | 0 | 1 | 1 | 0 |
| `mars/viewer/engine/social/slots.ts` | general engine | engine or shared library | 3 | 7 | 0 | 20 | 0 | 0 |
| `mars/viewer/engine/spatial/connectivity.ts` | general engine | engine or shared library | 4 | 2 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/spatial/edits.ts` | general engine | engine or shared library | 3 | 4 | 0 | 2 | 0 | 1 |
| `mars/viewer/engine/spatial/grid.ts` | general engine | engine or shared library | 3 | 8 | 0 | 26 | 0 | 0 |
| `mars/viewer/engine/spatial/ground.ts` | general engine | engine or shared library | 1 | 5 | 0 | 5 | 0 | 0 |
| `mars/viewer/engine/spatial/nav-trust.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/spatial/path.ts` | general engine | engine or shared library | 5 | 1 | 0 | 12 | 0 | 0 |
| `mars/viewer/engine/spatial/service.ts` | general engine | engine or shared library | 7 | 11 | 0 | 102 | 0 | 0 |
| `mars/viewer/engine/spatial/tiled.ts` | general engine | engine or shared library | 2 | 3 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/spatial/types.ts` | general engine | engine or shared library | 15 | 15 | 0 | 79 | 1 | 0 |
| `mars/viewer/engine/take/chapters.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/take/metrics.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/take/recorder.ts` | general engine | engine or shared library | 7 | 13 | 1 | 12 | 0 | 1 |
| `mars/viewer/engine/take/replay.ts` | general engine | engine or shared library | 17 | 9 | 1 | 17 | 11 | 0 |
| `mars/viewer/engine/take/store.ts` | general engine | engine or shared library | 0 | 0 | 0 | 3 | 0 | 0 |
| `mars/viewer/engine/take/types.ts` | general engine | engine or shared library | 14 | 3 | 0 | 10 | 3 | 0 |
| `mars/viewer/engine/test/camera-direct-fixtures.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 10 | 0 | 0 |
| `mars/viewer/engine/test/camera-source-era-fixture.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/test/camera-studio-fixtures.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/test/frame-fixtures.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 18 | 0 | 0 |
| `mars/viewer/engine/test/hands-check.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/test/install-cancel-assertions.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/test/path-reference.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/test/raise-cancel-fixtures.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/test/sequence-fixtures.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 9 | 0 | 0 |
| `mars/viewer/engine/test/stress-work.ts` | general feature to rescue | corresponding tests / tooling | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/vehicles/actions.ts` | general engine | engine or shared library | 0 | 0 | 0 | 2 | 0 | 0 |
| `mars/viewer/engine/vehicles/boat.ts` | general engine | engine or shared library | 0 | 6 | 0 | 0 | 0 | 0 |
| `mars/viewer/engine/vehicles/carrier.ts` | general engine | engine or shared library | 6 | 10 | 0 | 1 | 1 | 1 |
| `mars/viewer/engine/vehicles/forklift.ts` | general engine | engine or shared library | 0 | 0 | 0 | 4 | 0 | 0 |
| `mars/viewer/engine/vehicles/index.ts` | general engine | engine or shared library | 0 | 0 | 0 | 7 | 0 | 0 |
| `mars/viewer/engine/vehicles/traffic.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/work/paint.ts` | general engine | engine or shared library | 1 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/world/catalog-drawing.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/world/catalog-framing.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/world/catalog-items.ts` | general engine | engine or shared library | 0 | 1 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/world/catalog-phase-b.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/world/catalog-solar.ts` | general engine | engine or shared library | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/world/catalog.ts` | general engine | engine or shared library | 23 | 17 | 2 | 35 | 0 | 0 |
| `mars/viewer/engine/world/entity-list.ts` | general engine | engine or shared library | 0 | 5 | 0 | 1 | 0 | 0 |
| `mars/viewer/engine/world/factory.ts` | general engine | engine or shared library | 4 | 4 | 0 | 114 | 0 | 1 |
| `mars/viewer/engine/world/types.ts` | general engine | engine or shared library | 52 | 35 | 0 | 42 | 5 | 0 |
| `mars/viewer/lib/authored-boundaries.ts` | general engine | engine or shared library | 3 | 0 | 0 | 0 | 3 | 0 |
| `mars/viewer/lib/depth-fit.ts` | general engine | engine or shared library | 2 | 0 | 0 | 0 | 0 | 0 |
| `mars/viewer/lib/ground-triangles.ts` | general engine | engine or shared library | 0 | 0 | 0 | 0 | 3 | 0 |
| `mars/viewer/lib/office-stair-guards.ts` | general engine | engine or shared library | 4 | 1 | 0 | 1 | 2 | 0 |
| `mars/viewer/lib/platform-floor.ts` | general engine | engine or shared library | 5 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/lib/retry.ts` | general engine | engine or shared library | 2 | 0 | 0 | 0 | 1 | 0 |
| `mars/viewer/lib/three-resources.ts` | general engine | engine or shared library | 2 | 0 | 1 | 0 | 2 | 0 |
| `mars/viewer/simulation/control.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/simulation/engine-room.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 14 | 0 | 0 |
| `mars/viewer/simulation/engine-tools.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/simulation/legacy.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/simulation/storage-bytes.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
| `mars/viewer/simulation/workload.ts` | Mars content | world content / fixtures | 0 | 0 | 0 | 1 | 0 | 0 |
