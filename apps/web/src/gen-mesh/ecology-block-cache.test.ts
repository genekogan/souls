// The blocked-ground index a scatter avoids is built once per world state, not once per scatter (Eden 2026: ~240
// woodlands each rebuilt it over ~3,800 entities, first frame 25 s -> 6 s), and it still sees every edit.
//   node --test apps/web/src/gen-mesh/ecology-block-cache.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { blockedBy } from './ecology.mesh.ts';

function world() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'block' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  return w;
}

test('scatters share one blocked-ground index per world state; an edit rebuilds it', () => {
  const w = world();
  const add = (ops: unknown[]) => { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  add([{ op: 'place', def: 'core/bench@1', name: 'bench', p: [10, 10] },
    { op: 'place', def: 'core/woodland@1', name: 'wood-a', shape: { area: [[0, 0], [40, 0], [40, 40], [0, 40]] } },
    { op: 'place', def: 'core/woodland@1', name: 'wood-b', shape: { area: [[0, 0], [40, 0], [40, 40], [0, 40]] } }]);
  let footprints = 0; const fp = w.footprint.bind(w); w.footprint = ((...a: Parameters<typeof fp>) => { footprints++; return fp(...a); }) as typeof w.footprint;
  const a = blockedBy(w, w.get('wood-a')!), first = footprints, b = blockedBy(w, w.get('wood-b')!);
  assert.ok(first > 0, 'the first scatter builds the index');
  assert.equal(footprints, first, 'the second scatter reuses it');
  assert.equal(a(9.3, 10), true, 'a bench leg (+0.6 m pad) blocks'); assert.equal(b(9.3, 10), true); assert.equal(a(29.3, 30), false);
  add([{ op: 'place', def: 'core/bench@1', name: 'bench-2', p: [30, 30] }]);
  assert.equal(blockedBy(w, w.get('wood-a')!)(29.3, 30), true, 'a new solid is seen after the edit');
});

test('the desert-scrub worker scatter (cloned block cells + blockTest) equals the viewer-thread scatter', async () => {
  const { scrubPoints } = await import('@souls/generators');
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const w = world();
  const ops = [{ op: 'place', def: 'core/bench@1', name: 'bench', p: [10, 10] }, { op: 'place', def: 'core/bench@1', name: 'bench-2', p: [-40, 25] },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[-60, -60], [60, -60], [60, 60], [-60, 60]] } }];
  const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true);
  const e = w.get('wood')!, area: [number, number][] = [[-80, -70], [90, -60], [70, 80], [-75, 60]], params = { density: 0.02, grass: 3 } as never;
  const here = scrubPoints(area, params, 4, blockedBy(w, e));
  const there = scrubPoints(area, params, 4, blockTest(structuredClone(blockCellsOf(w)), BLOCK_CELL, e.id));   // what postMessage delivers
  assert.ok(here.length > 50, `${here.length}`);
  assert.deepEqual(there, here);
});

// P7: a scatter builds the index only around itself (the phone's near-first build pays for nearby things only); its test
// answers exactly as the whole-world index does inside its area
test('a scatter adds only the things that can reach its area, and blocks as the whole index does there', async () => {
  const { blockCellsOf, BLOCK_CELL, BLOCK_REACH } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const ops = [{ op: 'place', def: 'core/bench@1', name: 'near', p: [12, 8] }, { op: 'place', def: 'core/bench@1', name: 'edge', p: [-3, 20] },
    { op: 'place', def: 'core/bench@1', name: 'far', p: [400, 400] }, { op: 'place', def: 'core/bench@1', name: 'far-2', p: [-420, 300] },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[0, 0], [30, 0], [30, 30], [0, 30]] } }];
  const a = world(), b = world();
  for (const w of [a, b]) { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true); }
  const seen: string[] = []; const fp = a.footprint.bind(a); a.footprint = ((e: { name?: string }, ...r: unknown[]) => { seen.push(e.name ?? ''); return (fp as (...x: unknown[]) => never)(e, ...r); }) as typeof a.footprint;
  const regional = blockedBy(a, a.get('wood')!), whole = blockTest(blockCellsOf(b), BLOCK_CELL, b.get('wood')!.id);
  assert.ok(seen.includes('near') && seen.includes('edge') && !seen.includes('far') && !seen.includes('far-2'), seen.join());
  assert.ok(BLOCK_REACH >= 64);
  for (let x = -2; x <= 32; x += 0.25) for (let z = -2; z <= 32; z += 0.25) assert.equal(regional(x, z), whole(x, z), `${x},${z}`);
});

// t4-phone: a building reaches about its own size (twice its diagonal + 12 m), a kit thing three times its declared box
// + 8 m, not BLOCK_REACH, so a phone's first trees in
// a town bake no footprints of the houses well beyond them; one that does reach the scatter (a big hall) still blocks
test('a building or kit thing is added only within its own reach of a scatter, and blocks as the whole index does', async () => {
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const ops = [{ op: 'place', def: 'core/house@1', name: 'next-door', p: [32, 12], params: { w: 9, d: 8 } },
    { op: 'place', def: 'core/house@1', name: 'down-the-road', p: [100, 12], params: { w: 9, d: 8 } },
    { op: 'place', def: 'core/house@1', name: 'hall', p: [-60, 15], params: { w: 30, d: 24 } },
    { op: 'place', def: 'core/bench@1', name: 'bench-by', p: [31, 20] }, { op: 'place', def: 'core/bench@1', name: 'bench-over', p: [55, 20] },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[0, 0], [30, 0], [30, 30], [0, 30]] } }];
  const a = world(), b = world();
  for (const w of [a, b]) { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result)); }
  const seen: string[] = []; const fp = a.footprint.bind(a); a.footprint = ((e: { name?: string }, ...r: unknown[]) => { seen.push(e.name ?? ''); return (fp as (...x: unknown[]) => never)(e, ...r); }) as never;
  const regional = blockedBy(a, a.get('wood')!), whole = blockTest(blockCellsOf(b), BLOCK_CELL, b.get('wood')!.id);
  assert.ok(seen.includes('next-door') && seen.includes('hall') && seen.includes('bench-by') && !seen.includes('down-the-road') && !seen.includes('bench-over'), seen.join());
  for (let x = -2; x <= 32; x += 0.25) for (let z = -2; z <= 32; z += 0.25) assert.equal(regional(x, z), whole(x, z), `${x},${z}`);
});

// t4-phone: furniture in a house's rooms is inside the floor plan the house blocks whole: no pose or bake of its own, and the
// index blocks exactly the same ground
test('things in a building room add no blocks of their own; the building still blocks them', async () => {
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const ops = [{ op: 'place', def: 'core/house@1', name: 'house', p: [15, 15], params: { w: 9, d: 8, style: 'cottage' } },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[0, 0], [30, 0], [30, 30], [0, 30]] } }];
  const w = world(); const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const house = w.get('house')!, room = w.slotsOf(house).find((s) => s.kind === 'room');
  assert.ok(room, 'the cottage has rooms');
  const r2 = applyBatch(w, { ops: [{ op: 'place', def: 'core/chair@1', name: 'chair', in: { parent: house.id, slot: room.id } }] } as never, 'god', 0) as { result: { accepted: boolean } };
  assert.equal(r2.result.accepted, true, JSON.stringify(r2.result));
  const seen: string[] = []; const fp = w.footprint.bind(w); w.footprint = ((e: { name?: string }, ...x: unknown[]) => { seen.push(e.name ?? ''); return (fp as (...y: unknown[]) => never)(e, ...x); }) as never;
  const test = blockTest(blockCellsOf(w), BLOCK_CELL, w.get('wood')!.id);
  assert.ok(seen.includes('house') && !seen.includes('chair'), seen.join());
  assert.equal(test(15, 15), true);
});

// #870: a footprinted kit's ground rooms are walkable floor, not colliders; ground cover and scatters must not grow there
test('a footprinted kit blocks its ground rooms in world pose; a kit without rooms blocks only its colliders', async () => {
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const posts = [-2.8, 2.8].flatMap((x) => [-2.8, 2.8].map((z) => ({ kind: 'box', at: [x, 1.5, z], size: [0.2, 3, 0.2] })));
  const kit = (name: string, footprint?: unknown) => ({ op: 'define', def: { schema: 'def/1', name, size: { box: [6, 3.2, 6], scale: [0.1, 3] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [...posts, { kind: 'box', at: [0, 3.1, 0], size: [6, 0.2, 6] }], ...(footprint ? { footprint } : {}) } } } });
  const w = world(), yaw = Math.PI / 5, s = 1.5;
  const r = applyBatch(w, { ops: [kit('pavilion', 'open'), kit('canopy'),
    { op: 'place', def: 'pavilion@1', name: 'studio', p: [40, -20], r: yaw, s },
    { op: 'place', def: 'canopy@1', name: 'shade', p: [-40, 20] }] } as never, 'god', 0) as { result: { accepted: boolean } };
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const bakes = (w as unknown as { bakes: Map<string, unknown> }).bakes, before = bakes.size;
  const cells = blockCellsOf(w), test = blockTest(cells, BLOCK_CELL, '\u0000cover');
  assert.equal(bakes.size, before, 'A6: the room pass reads the memoised bake, no new one');
  // the kit's local frame, checked against its own post colliders (footprint() is the world-pose reference)
  const at = (e: string, lx: number, lz: number): [number, number] => { const p = w.worldPose(w.get(e)!), c = Math.cos(p.yaw), si = Math.sin(p.yaw); return [p.x + (lx * c + lz * si) * p.s, p.z + (-lx * si + lz * c) * p.s]; };
  const post = w.footprint(w.get('studio')!).map((o) => o.c).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const mine = [[-2.8, -2.8], [-2.8, 2.8], [2.8, -2.8], [2.8, 2.8]].map(([x, z]) => at('studio', x, z)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [i, c] of mine.entries()) { assert.ok(Math.abs(c[0] - post[i][0]) < 1e-6 && Math.abs(c[1] - post[i][1]) < 1e-6, `post ${i}`); }
  // A1: the room floor is blocked everywhere inside, under the yawed, scaled pose
  for (let lx = -2.9; lx <= 2.9; lx += 0.29) for (let lz = -2.9; lz <= 2.9; lz += 0.29) assert.equal(test(...at('studio', lx, lz)), true, `inside ${lx},${lz}`);
  // A2: open ground beyond the room and the posts' pad stays open
  for (const [lx, lz] of [[0, 3.1], [0, -3.1], [3.1, 0], [-3.1, 0], [0, 3.8], [3.4, 3.4]]) assert.equal(test(...at('studio', lx, lz)), false, `outside ${lx},${lz}`);
  // A3: a kit without a footprint has no rooms: only its post colliders block, its middle stays meadow as before
  assert.equal(test(-40, 20), false, 'no-room kit middle'); assert.equal(test(-40 + 2.8, 20 + 2.8), true, 'no-room kit post');
  const polys = (id: string) => [...cells.values()].flat().filter((b) => b.id === id && b.kind === 'poly').length;
  assert.ok(polys(w.get('studio')!.id) > 0); assert.equal(polys(w.get('shade')!.id), 0, 'A6: no room shapes for a kit without rooms');
});

test('a mesh with a footprint sidecar blocks its ground rooms, not its upper floors', async () => {
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const { footprintToBaked } = await import('@souls/generators');
  const glb = 'a'.repeat(64), side = 'b'.repeat(64);
  const baked = footprintToBaked({ schema: 'lm-building-footprint/1', bounds: { min: [-5, 0, -3], max: [5, 6, 3] },
    rooms: [{ id: 'hall', level: 0, y0: 0, y1: 3, polygon: [[-5, -3], [0, -3], [0, 3], [-5, 3]] }, { id: 'loft', level: 1, y0: 3, y1: 6, polygon: [[0, -3], [5, -3], [5, 3], [0, 3]] }],
    obstacles: [{ id: 'party-wall', kind: 'wall', obb: { c: [0, 0], half: [0.1, 3], yaw: 0 }, y0: 0, y1: 6 }] });
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'block', assets: (h) => h === side ? { baked } as never : h === glb ? { tris: 10 } as never : undefined });
  w.defineDef({ schema: 'def/1', name: 'hut', size: { box: [10, 6, 6] }, make: { kind: 'mesh', asset: glb, footprint: side } } as never, 'god', 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'hut@1', name: 'hut', p: [0, 0], r: Math.PI / 2 }] } as never, 'god', 0) as { result: { accepted: boolean } };
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const test = blockTest(blockCellsOf(w), BLOCK_CELL, '\u0000cover'), p = w.worldPose(w.get('hut')!);
  const at = (lx: number, lz: number): [number, number] => [p.x + lx * Math.cos(p.yaw) + lz * Math.sin(p.yaw), p.z - lx * Math.sin(p.yaw) + lz * Math.cos(p.yaw)];
  assert.equal(test(...at(-2.5, 0)), true, 'the ground hall is blocked');
  assert.equal(test(...at(2.5, 0)), false, 'a floor-1 loft is not ground');
  assert.equal(test(...at(-2.5, 4)), false, 'open ground beside the hall');
});
