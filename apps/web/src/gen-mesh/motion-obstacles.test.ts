// Creatures share one solid-footprint scan per synchronous task (lane L3e: at arrival every creature refreshed its own
// scan of every entity's footprint, ~2.8 s of Eden 2026's 4x-phone arrival). Each creature must still get exactly the
// boxes the original per-creature loop built, and an edit must be seen at once.
//   node --test apps/web/src/gen-mesh/motion-obstacles.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type DefInput, type Entity, type StoredDef } from '@souls/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { solidFootprints, surroundings } from './motion.ts';

function world() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'obstacles' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  return w;
}
const add = (w: WorldModel, ops: unknown[]) => { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };

/** The scan as it was before L3e: every creature walks every entity's footprint itself. */
function original(w: WorldModel, cx: number, cz: number, reach: number, skip: Set<string>) {
  const out: unknown[] = [];
  for (const e of w.entities.values()) {
    if (skip.has(e.id)) continue;
    const d = w.resolvedDef(e.def); if (!d || d.layer !== 'solid' || d.make.kind === 'none') continue;
    let fp; try { fp = w.footprint(e, d); } catch { continue; }
    for (const b of fp) if (Math.hypot(b.c[0] - cx, b.c[1] - cz) < reach + Math.hypot(b.half[0], b.half[1]) && b.y1 - b.y0 > 0.12) out.push(b);
  }
  return out;
}

test('every creature gets the boxes its own scan built; one scan is shared; an edit is seen at once', () => {
  const w = world();
  const ops: unknown[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) ops.push({ op: 'place', def: 'core/bench@1', name: `bench-${i}-${j}`, p: [i * 7 - 18, j * 7 - 18], yaw: (i * 37 + j * 11) % 360 });
  ops.push({ op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[30, 30], [60, 30], [60, 60], [30, 60]] } });
  add(w, ops);
  const homes: [number, number, string][] = [[0, 0, 'bench-2-2'], [-18, -18, 'bench-0-0'], [17, 3, 'bench-5-3'], [45, 45, 'wood'], [-40, 10, '']];
  let footprints = 0; const fp = w.footprint.bind(w); w.footprint = ((...a: Parameters<typeof fp>) => { footprints++; return fp(...a); }) as typeof w.footprint;
  const want = homes.map(([x, z, id]) => JSON.stringify(original(w, x, z, 16, new Set(id ? [w.get(id)!.id] : []))));
  const perCreature = footprints; footprints = 0;
  const got = homes.map(([x, z, id]) => JSON.stringify(surroundings(w, [x, z], 12, 'land', new Set(id ? [w.get(id)!.id] : [])).obstacles.list(0)));
  assert.deepEqual(got, want, 'each creature sees exactly the original boxes');
  assert.ok(want.some((s) => s !== '[]') && want.some((s) => s === '[]'), 'the homes cover near and far solids');
  assert.ok(footprints <= w.entities.size && perCreature >= (homes.length - 1) * footprints, `all the creatures in one task share a single scan (${footprints} vs ${perCreature})`);
  const before = solidFootprints(w);
  add(w, [{ op: 'place', def: 'core/bench@1', name: 'bench-new', p: [-40, 10] }]);
  assert.notEqual(solidFootprints(w), before, 'an edit in the same task drops the shared scan');
  const skip = new Set<string>();
  assert.equal(JSON.stringify(surroundings(w, [-40, 10], 12, 'land', skip).obstacles.list(0)), JSON.stringify(original(w, -40, 10, 16, skip)));
  assert.ok(surroundings(w, [-40, 10], 12, 'land', skip).obstacles.list(0).length > 0, 'the new bench is an obstacle');
});

test('PERF-PASSES: the shared scan outlives the task for up to 2 s while nothing changed; a move or edit drops it at once', async () => {
  const w = world();
  add(w, [{ op: 'place', def: 'core/bench@1', name: 'a', p: [0, 0] }, { op: 'place', def: 'core/bench@1', name: 'b', p: [5, 0] }]);
  const first = solidFootprints(w);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(solidFootprints(w), first, 'a later task (a creature refreshing on another frame) reuses the scan');
  add(w, [{ op: 'move', id: w.get('a')!.id, p: [9, 9] }]);
  const moved = solidFootprints(w);
  assert.notEqual(moved, first, 'a move is a new entity record: the revision changes and the scan is rebuilt');
  const a = moved.find((s) => s.id === w.get('a')!.id)!;
  assert.ok(a.fp.every((b) => Math.hypot(b.c[0] - 9, b.c[1] - 9) < 2), 'the rebuilt scan has the bench where it now stands');
  const realNow = performance.now.bind(performance); let shift = 0;
  (performance as { now: () => number }).now = () => realNow() + shift;
  try { shift = 2500; assert.notEqual(solidFootprints(w), moved, 'after 2 s it is rebuilt (terrain edited in place)'); }
  finally { (performance as { now: () => number }).now = realNow; }
});


const put = (w: WorldModel, id: string, extra: Partial<Entity>): Entity => {
  const e = { id, def: 'core/bench@1', in: { parent: 'world' }, params: {}, seed: 1, ...extra } as Entity;
  w.insert(e); return e;
};
const exactNear = (w: WorldModel, x: number, z: number) => {
  const expected = original(w, x, z, 16, new Set());
  assert.ok(expected.length > 0, 'the fixture has a real obstacle at the queried location');
  assert.deepEqual(surroundings(w, [x, z], 12, 'land', new Set()).obstacles.list(0), expected);
};

test('a scaled building keeps colliders more than 64 m from its root', () => {
  const w = world(), e = put(w, 'scaled', { def: 'core-townhouse@1', p: [900, 0, 0], s: 40 });
  const boxes = w.footprint(e), distant = boxes.reduce((a, b) => Math.hypot(...a.c.map((v, i) => v - [900, 0][i])) > Math.hypot(...b.c.map((v, i) => v - [900, 0][i])) ? a : b);
  assert.ok(Math.hypot(distant.c[0] - 900, distant.c[1]) > 80, 'outside the old root + obstacle reach');
  exactNear(w, ...distant.c);
});

test('children can be far from their root after parent scale, yaw and a slot offset', () => {
  const w = world(), base = w.resolvedDef('core/bench@1')!;
  const parentDef = { ...base, ref: 'fixture-parent@1', hash: 'fixture-parent', slots: [{ id: 'remote', kind: 'stand', p: [180, 0, 0], yaw: 0, accepts: {}, capacity: 1 }] } as StoredDef;
  w.defs.set(parentDef.ref, parentDef);
  put(w, 'parent', { def: parentDef.ref, p: [900, 0, 900], r: Math.PI / 2, s: 3 });
  const child = put(w, 'child', { in: { parent: 'parent', slot: 'remote' }, p: [40, 0, 0] });
  const pose = w.worldPose(child);
  assert.ok(Math.hypot(pose.x - 900, pose.z - 900) > 600);
  exactNear(w, pose.x, pose.z);
});

test('world-frame solid shapes with no stored pose remain obstacles', () => {
  const w = world();
  const wall = put(w, 'wall', { def: 'core-garden-wall@1', shape: { path: [[200, 200], [240, 200]] } });
  assert.equal(wall.p, undefined);
  const box = w.footprint(wall)[0]; assert.ok(box);
  exactNear(w, ...box.c);
});

test('certified mesh bounds include arbitrary scale and 2-D poses while avoiding definitely distant footprints', () => {
  const w = world(), base = w.resolvedDef('core/bench@1')!;
  const def = { ...base, ref: 'fixture-box@1', hash: 'fixture-box', form: 'point', params: {}, size: { box: [4, 3, 2], scale: [1, 100] }, make: { kind: 'mesh', asset: 'a'.repeat(64) } } as StoredDef;
  w.defs.set(def.ref, def);
  put(w, 'large', { def: def.ref, p: [300, 0, 0], s: 100 });
  put(w, 'two-d', { def: def.ref, p: [10, 250] });
  put(w, 'far', { def: def.ref, p: [900, 0, 900] });
  exactNear(w, 100, 0); exactNear(w, 10, 250);
  // A fresh revision drops cached footprints before observing calls.
  put(w, 'far-2', { def: def.ref, p: [800, 0, 800] });
  const called: string[] = [], footprint = w.footprint.bind(w);
  w.footprint = (e, d) => { called.push(e.id); return footprint(e, d); };
  solidFootprints(w, [100, 0, 16]);
  assert.deepEqual(called, ['large']);
});
