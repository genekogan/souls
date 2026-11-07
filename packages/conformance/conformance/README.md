# Library conformance

`@souls/conformance` sweeps the core definition library. It catches a change to a def revision, a generator, the
compiler, furnishing or gallery geometry that makes any core def fail to bake, place or furnish, or exceed its
triangle/draw/material budget, at any sampled point. (The shared catalogue registry this package once belonged to is
archived and gone.)

For every library revision it samples defaults, each numeric min and max, every enum and boolean value, both scale
endpoints and K seeded joint samples. Each point gets an isolated world (with a water fixture when needed); the sweep
bakes and attempts placement, runs the real furnishing planner for room-bearing buildings, and builds every gallery mesh
to check finite vertices and budgets. It needs no service or network.

```sh
node packages/conformance/bin/conformance.mjs --k 32 --out /tmp/conformance.json
```

- `--shard i/n` splits the library; `--filter <text>` keeps defs whose ref contains the text.
- `--seed NAME` (default `EF4`) is reproducible independently of sharding.
- Findings exit 1; `--report-only` writes the report anyway. No report turns a failing sweep into a pass.

Geometry checks are not GPU rendering evidence. Semantic and prefab defs, async GLB assets, browser-only text, expanded
children/shared surfaces and terrain drawn by shared ground are reported as explicit `qualificationGaps`. Qualify those
in the gallery (`tools/god-skill/scripts/gallery.mjs`, see `tools/god-skill/scripts/gallery-contract.md`).

## The gate and its pins

`src/conformance.test.ts` runs a K=2 sweep. Every finding must match a documented tuple (exact def hash, field, stage,
code and detail) in one of the records in this folder, and the list of rendering gaps must equal the one in
`known-20261015.json`. Nothing else is accepted.

**A changed def revision gets a new hash, so its known findings no longer match.** Add a new supplement here in the same
change, with a `note` giving its reason, and load it in `src/conformance.test.ts`. Never edit older supplements; never
relax budgets, samples or gap checks to make a sweep pass.

| record | what it pins |
| --- | --- |
| `known-20261015.json` | the base K=32 sweep: findings, counts and the rendering-gap list |
| `integration-3baa4c51.json` | additional K=2 findings from new boolean building parameters |
| `trunk-r3-20261016.json` | re-pins for six animals' new revisions and an excavator draw overrun |
| `trunk-r32-20261017.json` | smaller glass-roof triangle overruns (no ceiling slab under glass) |
| `w2-effects-20261019.json` | kit smoke shapes no longer drawn as geometry |
| `z2-catalogue-20261020.json` | re-pins after `make.lod1` and placement-fix revisions; larger building-kit overruns |
| `bsgen-20261021.json` | re-pins for apartment block, office block and hospital revisions |
| `seatdef-20261022.json` | re-pins for seat heights taken from model geometry |
| `office-desk-20261028.json` | `core-office-desk@2` (no baked scenery chairs): one construction-view draw overrun |
| `soul-actions-20261101.json` | Soul Actions 1-44 defs over a gallery triangle or draw budget, pinned to their 2026-11-01 revisions |
| `library-budgets-music-20261105.json` | in-budget music revisions (drum kit, mic stand, jukebox @2); pins nothing |
| `library-budgets-water-20261105.json` | in-budget water and garden revisions (garden fountain @2, watering can @3); pins nothing |
| `openings-20261105.json` | `core-tent@2` and `core-field-gate@1` (openings worked by hand); pins nothing |
| `chalk-20261105.json` | `core-chalk-square@1` (pavement chalk on the painting faculty); pins nothing |
| `record-player-20261105.json` | the new record player (#431, 368 triangles); pins nothing |
| `repair-20261105.json` | `core-bench@2`, `core-cart@2` (a state-drawn break), `core-hammer@1`, `core-tyre-pump@1` (#442); pins nothing |
| `swap-shelf-20261105.json` | `core-swap-shelf@1` (an open shelf on the container faculty, no door, a `leftBy` record); pins nothing |
| `pantry-20261105.json` | `core-pantry@1`, `core-apple@1` and `core-bun@1` (a doorless container, food eaten from the hand); pins nothing |
| `guestbook-20261105.json` | `core-guestbook@1` (a visitors' book on the sign-up faculty); pins nothing |
| `lost-and-found-20261105.json` | `core-lost-and-found@1` (the swap shelf's form with an owner claim, `claim: "owner"`); pins nothing |
| `hiding-places-20261105.json` | `core-hollow-stump@1` and `core-wall-niche@1` (doorless containers with `hidden: true`); pins nothing |
| `litter-20261106.json` | `core-bin@2`, `core-wheelie-bin@2` (bins open at the top on the container faculty) and `core-wrapper@1` (litter); pins nothing |
| `deck-20261106.json` | `core-rack-beam@4` (step-ledge joist seats), `core-deck-joist@1` and `core-plywood-sheet@2` (bearing connectors, a floor) (#694); pins nothing |
| `stairs-20261106.json` | `core-rack-beam@5` (ledge seats take a stair hook), `core-deck-stair@1` and `core-deck-stair-tread@1` (stair hook, tread seats) (#695); pins nothing |

Known findings are documented, not fixed: published revisions are immutable so existing worlds keep their geometry.
Repair a range or budget in a new revision and pin what remains.
