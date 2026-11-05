# Library conformance

`@sim/conformance` sweeps the core definition library. It catches a change to a def revision, a generator, the
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

Known findings are documented, not fixed: published revisions are immutable so existing worlds keep their geometry.
Repair a range or budget in a new revision and pin what remains.
