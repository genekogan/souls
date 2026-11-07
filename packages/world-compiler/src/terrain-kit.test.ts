// L3 terrain kit through the compiler: defs from core-kit/terrain.json, prepare steps (skill-side
// with prepareFor, or the compiler hook when L1 has applied it), graded ground, river water with
// per-point levels, floating on a river, walls refusing a crossing, undo restoring the ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareFor, queryOf } from '@souls/generators';
import terrainKit from './core-kit/terrain.json' with { type: 'json' };
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Accepted, type DefInput, type Refused } from './index.ts';

function fresh() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'terrain' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  return w;
}
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r.result as Accepted; };
const gen = (w: WorldModel, ref: string) => { const d = w.resolvedDef(ref)!; return d.make.kind === 'gen' ? d.make.gen : ''; };
/** What the skill does before sending a place: freeze grade/flow/heights from the world it sees. */
function prepared(w: WorldModel, def: string, shape: { path?: [number, number][]; area?: [number, number][] }, params: Record<string, unknown> = {}) {
  const p = prepareFor(gen(w, def), queryOf(w), shape, params as never);
  return { shape: p?.path ? { ...shape, path: p.path } : shape, params: { ...params, ...(p?.params ?? {}) } };
}

test('every terrain kit def is valid and its generator is registered', () => {
  const w = fresh();
  for (const d of terrainKit as { name: string }[]) assert.ok(w.def(`${d.name}@1`) && gen(w, `${d.name}@1`), d.name);
});

test('a graded road over a hill: the ground along it stays under 8 %, undo restores the hill', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('hill'), name: 'hill', p: [0, 0], params: { height: 14, radius: 45 } }] }, 'god', 1));
  const path: [number, number][] = [[-70, 4], [-20, 0], [20, 2], [70, -3]];
  const before = w.terrain.sample(0, 1);
  const pr = prepared(w, coreRef('road'), { path }, { width: 6 });
  const r = applyBatch(w, { ops: [{ op: 'place', def: coreRef('road'), name: 'road', shape: pr.shape, params: pr.params as never }] }, 'god', 2); ok(r);
  assert.ok(w.terrain.sample(0, 1) < before - 3, 'the crest is cut');
  let worst = 0; for (let x = -60; x < 60; x += 2) worst = Math.max(worst, Math.abs(w.terrain.sample(x + 2, 1) - w.terrain.sample(x, 1)) / 2);
  assert.ok(worst < 0.1, `slope along the road ${worst.toFixed(3)}`);
  ok(applyBatch(w, { ops: r.inverse! }, 'god', 3, { trusted: true }));
  assert.equal(w.terrain.sample(0, 1), before);
});

test('a river from a lake to a pond: water levels per point, a duck floats on it, the road bridges it', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [
    { op: 'place', def: coreRef('lake'), name: 'lake', shape: { area: [[-120, -20], [-80, -20], [-80, 20], [-120, 20]] }, params: { level: 1.5, depth: 3 } },
    { op: 'place', def: coreRef('plateau'), name: 'shelf', shape: { area: [[-200, -100], [-10, -100], [-10, 100], [-200, 100]] }, params: { height: 2, edge: 30 } },
    { op: 'place', def: coreRef('pond'), name: 'pond', shape: { area: [[80, -10], [100, -10], [100, 10], [80, 10]] } },
  ] }, 'god', 1));
  const pr = prepared(w, coreRef('river'), { path: [[-72, 0], [0, 5], [72, 0]] }, { width: 6 });
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('river'), name: 'river', shape: pr.shape, params: pr.params as never }] }, 'god', 2));
  const water = w.ground().waters.find((x) => x.path);
  assert.ok(water, 'path water');
  if (water!.levels) {
    // the compiler passes per-point levels through (L1 patch applied)
    assert.equal(water!.levels[0], 1.5);
    assert.ok(water!.levels[water!.levels.length - 1] <= -0.2 + 1e-9);
  }
  const duck = { schema: 'def/1', name: 'duck', version: 1, layer: 'decor', anchor: 'float', size: { box: [0.4, 0.35, 0.25] }, make: { kind: 'gen', gen: 'box/1' } } as const;
  ok(applyBatch(w, { ops: [{ op: 'define', def: duck as never }, { op: 'place', def: 'duck@1', name: 'duck', p: [0, 5] }] }, 'god', 3));
  assert.ok(Math.abs(w.get('duck')!.p![1] - w.ground().waters.find((x) => x.path)!.level) < 3, 'floats on the river');
  const road = prepared(w, coreRef('road'), { path: [[0, -40], [2, 0], [0, 40]] }, { width: 5 });
  const g = road.params.grade as { spans?: unknown[] };
  assert.equal(g.spans?.length, 1, 'one bridge span over the river');
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('road'), name: 'bridge-road', shape: road.shape, params: road.params as never }] }, 'god', 4));
});

test('a garden wall is a solid: a cottage across it is refused; its gate is an opening', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('garden-wall'), name: 'wall', shape: { path: [[-20, 0], [20, 0]] }, params: { gates: [{ at: 20, width: 2 }] as never } }] }, 'god', 1));
  const r = applyBatch(w, { ops: [{ op: 'place', def: coreRef('cottage'), name: 'c', p: [8, 0] }] }, 'god', 2);
  assert.equal(r.result.accepted, false); assert.equal((r.result as Refused).failures[0].code, 'overlap.solid');
  const e = w.get('wall')!; const b = w.bake(w.resolvedDef(e.def)!, e.params ?? {}, 0, e.shape);
  assert.equal(b.openings!.length, 1);
});

test('compiler hook (when applied by L1): placing a road with no grade freezes one', (t) => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('hill'), name: 'hill', p: [0, 0], params: { height: 14, radius: 45 } }, { op: 'place', def: coreRef('road'), name: 'road', shape: { path: [[-70, 0], [70, 0]] } }] }, 'god', 1));
  if (!w.get('road')!.params?.grade) { t.skip('compile.ts prepare hook not applied on this branch (patch requested of L1)'); return; }
  assert.ok((w.get('road')!.params!.grade as { h: number[] }).h.length > 10);
});

test('an explicit deck-supported bench does not build a seabed pad or move nearby fixtures', () => {
  const w=fresh();
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('pond'),name:'water',shape:{area:[[0,140],[40,140],[40,185],[0,185]]},params:{depth:4}}]},'god',0));
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('pier'),name:'pier',shape:{path:[[10,139],[10,167]]},params:{width:3,height:4,platform:5,rails:true}}]},'god',1));
  const pier=w.get('pier')!,baked=w.bake(w.resolvedDef(pier.def)!,pier.params??{},0,pier.shape),y=baked.surfaces!.at(-1)!.y;
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('lamp-post'),name:'lamp',p:[10,0,166.5]}]},'god',2));
  const lamp=structuredClone(w.get('lamp')),ground=structuredClone(w.ground());
  const r=applyBatch(w,{ops:[{op:'place',def:coreRef('bench'),name:'on-deck',p:[10,y,170]}]},'god',3);ok(r);
  assert.deepEqual(w.ground(),ground,'deck support needs no fill underneath');
  assert.deepEqual(w.get('lamp'),lamp,'nearby existing geometry stays unchanged');
  assert.deepEqual(r.diff!.tiles,[]);
  // Explicit height alone is insufficient: a bench off the deck still needs its
  // normal foundation, preventing this from becoming a general floating bypass.
  ok(applyBatch(w,{ops:[{op:'place',def:coreRef('bench'),name:'off-deck',p:[25,y,170]}]},'god',4));
  assert.ok(w.ground().landforms.some(l=>l.id===`${w.get('off-deck')!.id}:pad`));
});
