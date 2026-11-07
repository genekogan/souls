// W4 ground cover recipe: where tall grass, tufts and wildflowers grow, from the world's own ground recipe.
//   node --test apps/web/src/gen-mesh/ground-cover-recipe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { blockCellsOf, BLOCK_CELL } from './ecology.mesh.ts';
import { COVER_CELL, REC, cellKind, cellSites, coverIndex, prefix, siteAt } from './ground-cover-recipe.ts';

function world(palette: string, ops: unknown[] = []) {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'cover' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  const r = applyBatch(w, { ops: [{ op: 'world', state: { ground: { palette } } }, ...ops] } as never, 'god', 0) as { result: { accepted: boolean } };
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  return coverIndex(w, blockCellsOf(w), BLOCK_CELL);
}
const sq = (x0: number, z0: number, x1: number, z1: number) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/** Instances of one kind (0 tall, 1 tuft, 2 flower) dealt over a block of cells, as [x, z] points. */
function deal(ix: ReturnType<typeof world>, k: number, x0: number, z0: number, x1: number, z1: number) {
  const pts: [number, number][] = [];
  for (let cj = Math.floor(z0 / COVER_CELL); cj < Math.ceil(z1 / COVER_CELL); cj++) for (let ci = Math.floor(x0 / COVER_CELL); ci < Math.ceil(x1 / COVER_CELL); ci++) {
    const rec = cellKind(ix, ci, cj, k, cellSites(ix, ci, cj));
    for (let o = 0; o < rec.length; o += REC) if (rec[o] >= x0 && rec[o] < x1 && rec[o + 2] >= z0 && rec[o + 2] < z1) pts.push([rec[o], rec[o + 2]]);
  }
  return pts;
}

test('open meadow ground grows tall grass, tufts and some flowers; cells are deterministic and rank-sorted', () => {
  const ix = world('meadow'), area = 48 * 48;
  const tall = deal(ix, 0, 0, 0, 48, 48), tuft = deal(ix, 1, 0, 0, 48, 48), flower = deal(ix, 2, 0, 0, 48, 48);
  assert.ok(tall.length / area > 0.15 && tall.length / area < 1, `tall ${tall.length / area}/m²`);
  assert.ok(tuft.length / area > 3, `tuft ${tuft.length / area}/m²`);
  assert.ok(flower.length > 20 && flower.length < tuft.length / 4, `flowers ${flower.length}`);
  const a = cellKind(ix, 2, 3, 0, cellSites(ix, 2, 3)), b = cellKind(ix, 2, 3, 0, cellSites(ix, 2, 3));
  assert.deepEqual(a, b, 'the same blade is always in the same place');
  for (let o = REC; o < a.length; o += REC) assert.ok(a[o + 9] >= a[o - REC + 9], 'records sorted by rank');
  const n = a.length / REC; assert.equal(prefix(a, 0), 0); assert.equal(prefix(a, 1), n);
  assert.ok(prefix(a, 0.3) < prefix(a, 0.7) && prefix(a, 0.7) < n);
});

test('a wildflower meadow area is thick with flowers and long grass', () => {
  const ix = world('meadow', [{ op: 'place', def: 'core/wildflowers@1', name: 'wf', shape: { area: sq(100, 0, 148, 48) } }]);
  const open = deal(ix, 2, 0, 0, 48, 48).length, wild = deal(ix, 2, 100, 0, 148, 48).length;
  assert.ok(wild > open * 2, `flowers: meadow area ${wild} vs open ${open}`);
  assert.ok(deal(ix, 0, 100, 0, 148, 48).length > deal(ix, 0, 0, 0, 48, 48).length, 'longer grass in the meadow');
});

test('a mown lawn grows only short tufts and a few daisies inside; its rim is left long', () => {
  const ix = world('meadow', [{ op: 'place', def: 'core/lawn@1', name: 'lawn', shape: { area: sq(-40, -40, 40, 40) }, params: { stripes: true } }]);
  const inner = deal(ix, 0, -24, -24, 24, 24).length, tufts = deal(ix, 1, -24, -24, 24, 24).length, flowers = deal(ix, 2, -24, -24, 24, 24).length;
  assert.equal(inner, 0, 'no tall grass inside the mown lawn');
  assert.ok(tufts > 48 * 48 * 0.8, `tufts ${tufts}`);
  assert.ok(flowers > 0 && flowers < 48 * 48 * 0.1, `daisies ${flowers}`);
  const s = siteAt(ix, -39.6, 0, false); assert.ok(s && s.tall > 0.2, `rim tall ${s?.tall}`);
});

test('paths stay clear; their verges grow longer grass and flowers', () => {
  const ix = world('meadow', [{ op: 'place', def: 'core/footpath@1', name: 'path', shape: { path: [[-60, 4], [60, 4]] }, params: { width: 2 } }]);
  for (const k of [0, 1, 2]) for (const [, z] of deal(ix, k, -40, -4, 40, 12)) assert.ok(Math.abs(z - 4) > 1, `kind ${k} at z ${z} on the path`);
  const verge = siteAt(ix, 0, 6.4, true)!, open = siteAt(ix, 0, 30, false)!;
  assert.ok(verge.flower >= 0.16 && verge.tall >= 0.45, JSON.stringify(verge));
  assert.ok(open.flower < verge.flower);
});

test('desert ground grows nothing unless an explicit meadow is placed', () => {
  const desert = world('desert');
  assert.equal(deal(desert, 0, 0, 0, 32, 32).length + deal(desert, 1, 0, 0, 32, 32).length + deal(desert, 2, 0, 0, 32, 32).length, 0);
  const oasis = world('desert', [{ op: 'place', def: 'core/wildflowers@1', name: 'wf', shape: { area: sq(0, 0, 32, 32) } }]);
  assert.ok(deal(oasis, 2, 0, 0, 32, 32).length > 30);
  assert.equal(siteAt(oasis, 9999, 0, false), null, 'outside the world');
});

test('cover is on for desktop, ?cover=0|1 overrides', async () => {
  const { coverSetting, PETALS } = await import('./ground-cover.ts');
  assert.match(PETALS, /coverPetal/, 'three\'s color_vertex chunk still has the instance-colour line the petals patch');
  assert.equal(coverSetting('').enabled, true);
  assert.deepEqual(coverSetting('?cover=0'), { enabled: false, reason: '?cover=0' });
  const phone = { tier: 'phone', reason: 'touch screen' };
  assert.equal(coverSetting('', phone).enabled, false);
  assert.equal(coverSetting('?cover=1', phone).enabled, true);
});
