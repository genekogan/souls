// Souls on the ground (lane L8, spec <eden4>/31 B1): an entity world's terrain in the Mars engine.
// Route up a knoll (y follows the slope), refuse a cliff, wade the pond edge, swim the lake, and
// snapshot/restore agree; a world without the fact behaves as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './engine.ts';
import { groundFact, groundField } from './ground-bridge.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';
import { emptyGround, type Ground } from '../../ground/src/index.ts';
import type { Engine } from '@souls/engine-contract';

const factory = await marsFactory(GREEN_FIELD_WORLD);
const pondArea: [number, number][] = [[-30, -10], [-20, -10], [-20, 0], [-30, 0]];
const lakeArea: [number, number][] = [[-90, -40], [-50, -40], [-50, 0], [-90, 0]];
function terrain(): Ground {
  const g = emptyGround(1000);
  g.landforms.push({ id: 'knoll', kind: 'bump', c: [30, 0], r: 25, h: 5, peak: 1 });
  g.landforms.push({ id: 'mesa', kind: 'plateau', area: [[-10, 40], [10, 40], [10, 60], [-10, 60]], h: 8, edge: 1 });
  g.landforms.push({ id: 'pond', kind: 'carve', area: pondArea, bed: -0.2, edge: 1 });
  g.landforms.push({ id: 'lake', kind: 'carve', area: lakeArea, bed: -3, edge: 6 });
  g.waters.push({ id: 'pond', area: pondArea, level: 0 }, { id: 'lake', area: lakeArea, level: 0 });
  return g;
}
// ground-paged.test.ts runs this whole file again on paged navigation (lane NAV)
const fact = groundFact(terrain(), 4, { paged: process.env.GROUND_PAGED === '1' });
const field = groundField(fact.recipeHash);

function world(seed = 'ground'): Engine & { installGroundV1(f: unknown): { installed: boolean; settled: string[] } } {
  const e = factory.create(factory.genesis(seed)) as never as Engine & { installGroundV1(f: unknown): { installed: boolean; settled: string[] } };
  e.installGroundV1(fact);
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  return e;
}
type Body = { pose: { p: [number, number, number] }; human: { activity: string } };
const body = (e: Engine, id = 'h_ada') => e.world.entities[id] as unknown as Body;
/** Run a program to its end; returns the program's last event and every distinct activity seen, with the y track. */
function run(e: Engine, steps: { verb: string; params: Record<string, unknown> }[], maxTicks = 20 * 240) {
  const adm = e.perform({ actor: 'h_ada', label: 'test', steps });
  if (!adm.ok) return { adm, end: { kind: 'failed', ...adm.diagnostic }, acts: new Set<string>(), ys: [] };
  const acts = new Set<string>(), ys: { x: number; z: number; y: number }[] = [];
  let end: { kind: string; code?: string; message?: string } | undefined;
  for (let i = 0; i < maxTicks && !end; i++) {
    const out = e.step();
    const b = body(e); acts.add(b.human.activity); ys.push({ x: b.pose.p[0], z: b.pose.p[2], y: b.pose.p[1] });
    end = out.programs.find((p) => p.id === adm.id && (p.kind === 'completed' || p.kind === 'failed' || p.kind === 'cancelled'));
  }
  return { adm, end, acts, ys };
}

test('a Soul is born standing on the ground and walks up the knoll; its y follows the slope', () => {
  const e = world();
  const b = body(e);
  assert.equal(b.pose.p[1], field.height(b.pose.p[0], b.pose.p[2]), 'born on the tiles');
  const r = run(e, [{ verb: 'walk_to', params: { to: [30, 0] } }]);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  const top = body(e).pose.p;
  assert.ok(Math.hypot(top[0] - 30, top[2]) < 0.5, `at the top: ${top}`);
  assert.ok(top[1] > 4.9, `y at the top ${top[1]}`);
  // every sample of the climb stands on the tiles
  for (const s of r.ys) assert.ok(Math.abs(s.y - field.height(s.x, s.z)) < 1e-9, `y off the ground at ${s.x},${s.z}`);
  const rising = r.ys.filter((s, i) => i > 0 && s.y > r.ys[i - 1].y).length;
  assert.ok(rising > 50, 'climbs gradually');
  assert.deepEqual(e.runtime.violations, []);
});

// Keep the published TAP identity. Its historical water-refusal clause is superseded by
// the composed walk/wade/swim/return and bridge-water assertions below; cliff/edge refusals remain.
test('a cliff is refused with a precise code; deep water refuses walking; the edge of the world is refused', () => {
  const e = world();
  const cliff = e.canPerform({ actor: 'h_ada', label: 'mesa', steps: [{ verb: 'walk_to', params: { to: [0, 50] } }] }) ?? run(e, [{ verb: 'walk_to', params: { to: [0, 50] } }]).end;
  assert.match(String((cliff as { code?: string })?.code), /ground\.cliff/, JSON.stringify(cliff));
  // Only destination journeys compose media; the explicitly requested native foot action stays foot-only.
  const footOnly = e.canPerform({ actor: 'h_ada', label: 'foot-only lake walk', steps: [{ verb: 'mars:walk_to', params: { x: -70, z: -20 } }] });
  assert.equal(footOnly?.code, 'ground.deep-water', JSON.stringify(footOnly));
  // the old 384 m window refuses a walk to the far edge ('ground.too-far'); paged navigation (lane NAV) plans it
  if (process.env.GROUND_PAGED === '1') assert.equal(e.canPerform({ actor: 'h_ada', label: 'far', steps: [{ verb: 'walk_to', params: { to: [499, 0] } }] }), null);
  else { const far = run(e, [{ verb: 'walk_to', params: { to: [499, 0] } }]).end; assert.ok(far?.kind === 'failed' && /^ground\./.test(far.code ?? ''), JSON.stringify(far)); }
});

test('wading the pond edge: the walker crosses shallow water, standing on the bed, activity wade', () => {
  const e = world();
  const r = run(e, [{ verb: 'walk_to', params: { to: [-25, -5] } }]);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  assert.ok(r.acts.has('wade'), [...r.acts].join(','));
  const p = body(e).pose.p;
  assert.ok(p[1] < -0.1, `on the pond bed: ${p[1]}`);
  assert.deepEqual(e.runtime.violations, []);
});

test('swimming the lake: swim_to crosses deep water at the swimmer root, then walking out swims to the shore first', () => {
  const e = world();
  // the lake is 50 m off: swimming from here is refused (dry ground between), so walk to its shore first
  assert.equal(run(e, [{ verb: 'mars:swim_to', params: { x: -70, z: -20 } }]).end?.code, 'swim.not-connected');
  assert.equal(run(e, [{ verb: 'walk_to', params: { to: [-49, -20] } }]).end?.kind, 'completed');
  const r = run(e, [{ verb: 'mars:swim_to', params: { x: -70, z: -20 } }], 20 * 400);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  assert.ok(r.acts.has('swim'), [...r.acts].join(','));
  const b = body(e);
  assert.equal(b.human.activity, 'tread');
  assert.ok(Math.abs(b.pose.p[1] - -1.2) < 1e-9, `root 1.2 m under the surface: ${b.pose.p[1]}`);
  // walking somewhere from the water: swim to the shore, then walk
  const out = run(e, [{ verb: 'walk_to', params: { to: [0, -5] } }], 20 * 400);
  assert.equal(out.end?.kind, 'completed', JSON.stringify(out.end));
  assert.ok(out.acts.has('swim') && out.acts.has('walk'), [...out.acts].join(','));
  assert.deepEqual(e.runtime.violations, []);
  // a dry destination is not a swim
  const dry = run(e, [{ verb: 'mars:swim_to', params: { x: 30, z: 0 } }]).end;
  assert.equal(dry?.code, 'swim.not-water', JSON.stringify(dry));
});

test('snapshot mid-climb restores on the same ground and continues identically', () => {
  const a = world('snap');
  a.perform({ actor: 'h_ada', label: 'climb', steps: [{ verb: 'walk_to', params: { to: [30, 0] } }] });
  for (let i = 0; i < 100; i++) a.step();
  const snap = a.snapshot();
  const b = factory.restore(snap);
  for (let i = 0; i < 200; i++) { a.step(); b.step(); }
  assert.deepEqual(body(b).pose.p, body(a).pose.p);
  assert.equal(b.stateHash(), a.stateHash());
  assert.ok(body(b).pose.p[1] > 0.5);
});

test('reinstalling a changed ground lifts standing bodies onto it; same recipe is a no-op', () => {
  const e = world('lift');
  const before = body(e).pose.p[1];
  assert.equal(e.installGroundV1(fact).installed, false);
  const g = terrain(); const p = body(e).pose.p;
  g.landforms.push({ id: 'raise', kind: 'bump', c: [p[0], p[2]], r: 10, h: 2, peak: 1 });
  const r = e.installGroundV1(groundFact(g, 5));
  assert.equal(r.installed, true);
  assert.deepEqual(r.settled, ['h_ada']);
  assert.ok(body(e).pose.p[1] > before + 1.9);
});

test('a world without the ground fact keeps flat level-0 behaviour (no ground mode)', () => {
  const e = factory.create(factory.genesis('flat'));
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  assert.equal((e.world as { groundV1?: unknown }).groundV1, undefined);
  const r = run(e, [{ verb: 'walk_to', params: { to: [10, 0] } }]);
  assert.equal(r.end?.kind, 'completed');
  assert.ok(r.ys.every((s) => s.y === 0));
  assert.ok(!e.describeVerbs().some((v) => v.verb === 'mars:swim_to'));
});

test('tiled ground Spatial: a large solid is routed round (coarse + fine agree), a floor slab raises the standing height, tiles are cached', async () => {
  const { Spatial } = await import('../../../mars/viewer/engine/spatial/service.ts');
  const { GREEN_FIELD_SCENE, greenFieldWorld } = await import('../../../mars/viewer/engine/scenarios/greenfield.ts');
  const { HUMAN_PROFILE } = await import('../../../mars/viewer/engine/spatial/types.ts');
  const wall = { id: 'big-block', obb: { c: [0, 0] as [number, number], half: [12, 3] as [number, number], yaw: 0 }, y0: -1, y1: 4, kind: 'solid' as const };
  const slab = { id: 'deck', level: 0, y: 0.3, obb: { c: [20, 20] as [number, number], half: [3, 3] as [number, number], yaw: 0 } };
  const sp = new Spatial({ ...GREEN_FIELD_SCENE, obstacles: [wall], surfaces: [...GREEN_FIELD_SCENE.surfaces, slab] }, { source: { scene: GREEN_FIELD_SCENE, id: 'green-field' } });
  const w = greenFieldWorld('tiles') as never;
  sp.setGround(field, w, [[0, 0]]);
  const r = sp.route(w, HUMAN_PROFILE, { level: 0, p: [0, -8] }, { level: 0, p: [0, 8] });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.diagnostic));
  assert.ok(r.ok && r.route.length > 24, 'goes round the 24 m block');
  assert.equal(sp.ground!.coarseSolid(0, 0), true);
  assert.ok(Math.abs(sp.ground!.standY(20, 20) - 0.3) < 1e-9, 'on the deck');
  assert.equal(sp.ground!.standY(30, 30), field.height(30, 30), 'off the deck: the ground');
  const builds = sp.ground!.stats.fineBuilds;
  sp.route(w, HUMAN_PROFILE, { level: 0, p: [0, -8] }, { level: 0, p: [5, 9] });
  assert.equal(sp.ground!.stats.fineBuilds, builds, 'no tile rebuilt for a second route');
});

test('two Souls on the knoll flank: a walker passes one standing in its way on the slope without overlap', () => {
  const e = world('pass');
  e.spawnHuman({ id: 'h_bob', label: 'Bob', soul: 's_bob' });
  const bob = e.perform({ actor: 'h_bob', label: 'stand', steps: [{ verb: 'walk_to', params: { to: [20, 0.2] } }] });
  for (let i = 0; i < 20 * 40; i++) { const o = e.step(); if (o.programs.some((p) => p.id === bob.id && p.kind !== 'step')) break; }
  const b = body(e, 'h_bob').pose.p;
  assert.ok(Math.hypot(b[0] - 20, b[2] - 0.2) < 0.6 && b[1] > 1, `Bob stands on the flank: ${b}`);
  const r = run(e, [{ verb: 'walk_to', params: { to: [30, 0] } }]);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  assert.deepEqual(e.runtime.violations, []);
});

test('an L3 cliff (core/cliff): its face cannot be climbed, so the Soul walks round its end and up the back slope (hierarchical hops)', () => {
  const g = terrain();
  g.landforms.push({ id: 'escarpment', kind: 'cliff', path: [[40, -20], [40, 20]], h: 6, side: -1, face: 1, w: 20, back: 40, steps: 1 } as never);
  const e = factory.create(factory.genesis('cliff')) as never as Engine & { installGroundV1(f: unknown): unknown };
  const f2 = groundFact(g, 9); e.installGroundV1(f2);
  e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' });
  const fld = groundField(f2.recipeHash);
  assert.equal(fld.medium(40, 0), 3, 'the face is steep');
  assert.ok(fld.height(50, 0) > 5.9, 'the top is up');
  const r = run(e, [{ verb: 'walk_to', params: { to: [50, 0] } }], 20 * 600);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  const p = body(e).pose.p;
  assert.ok(Math.hypot(p[0] - 50, p[2]) < 0.6 && p[1] > 5.9, `on top: ${p}`);
  let walked = 0; for (let i = 1; i < r.ys.length; i++) walked += Math.hypot(r.ys[i].x - r.ys[i - 1].x, r.ys[i].z - r.ys[i - 1].z);
  assert.ok(walked > 100, `went round (walked ${walked.toFixed(0)} m for a 50 m crow-fly)`);
  assert.ok(r.ys.every((s) => fld.medium(s.x, s.z) !== 3), 'never set foot on the face');
  assert.deepEqual(e.runtime.violations, []);
});

test('a floater body glides up the knoll: its root follows the tiles (the picture adds its hover)', () => {
  const e = world('floater');
  (e.world.entities.h_ada as unknown as { body: unknown }).body = { family: 'floater', model: 'verdelis', radius: 0.35, hoverHeight: 1.45 };
  const r = run(e, [{ verb: 'walk_to', params: { to: [30, 0] } }]);
  assert.equal(r.end?.kind, 'completed', JSON.stringify(r.end));
  for (const s of r.ys) assert.ok(Math.abs(s.y - field.height(s.x, s.z)) < 1e-9);
  assert.ok(body(e).pose.p[1] > 4.9);
  assert.deepEqual(e.runtime.violations, []);
});

test('snapshot mid-swim restores (the ground verbs come back with the snapshot) and continues identically', () => {
  const a = world('swim-snap');
  assert.equal(run(a, [{ verb: 'walk_to', params: { to: [-49, -20] } }]).end?.kind, 'completed');
  a.perform({ actor: 'h_ada', label: 'swim', steps: [{ verb: 'mars:swim_to', params: { x: -70, z: -20 } }] });
  for (let i = 0; i < 160; i++) a.step();
  assert.equal(body(a).human.activity, 'swim');
  const snap = a.snapshot() as { groundV1?: boolean };
  assert.equal(snap.groundV1, true);
  const b = factory.restore(snap as never);
  for (let i = 0; i < 200; i++) { a.step(); b.step(); }
  assert.deepEqual(body(b).pose.p, body(a).pose.p);
  assert.equal(b.stateHash(), a.stateHash());
  assert.deepEqual(b.runtime.violations, []);
});

// L9's entity physics (world-edit/1) on a ground world: a god-built house with an upper floor stands on flat ground
// beside the knoll. Its walls, door gap and stairs reach the tiled ground Spatial through the same scene composition.
test('world-edit/1 on a ground world: the house walls are routed round, its stairs planned, and the knoll still followed', () => {
  const e = world('ground-house') as never as Engine & { applyWorldEditV1(ev: WorldEditV1): { hash: string; trapped: string[] }; reachV1(a: unknown, b: unknown): { ok: boolean; length?: number; levels?: number[]; code?: string } };
  const [cx, cz] = [-5, 22];
  const wall = (id: string, c: [number, number], half: [number, number]) => ({ id, obb: { c, half, yaw: 0 }, y0: 0, y1: 5.6, kind: 'fixture' as const, label: 'house wall' });
  const set: WorldEditV1['set'] = { e_house1: {
    surfaces: [{ id: 'house:ground', level: 0, y: 0, obb: { c: [cx, cz], half: [3.9, 2.9], yaw: 0 } }, { id: 'house:floor-1', level: 1, y: 2.85, obb: { c: [cx, cz], half: [3.9, 2.9], yaw: 0 } }],
    solids: [wall('house:n', [cx, cz - 3], [4, 0.11]), wall('house:e', [cx + 4, cz], [0.11, 3]), wall('house:w', [cx - 4, cz], [0.11, 3]), wall('house:s1', [cx - 2.275, cz + 3], [1.725, 0.11]), wall('house:s2', [cx + 2.275, cz + 3], [1.725, 0.11])],
    links: [{ id: 'house:stairs', kind: 'stairs', from: { level: 0, p: [cx + 3.2, cz + 1.6], y: 0 }, to: { level: 1, p: [cx + 3.2, cz - 1.6], y: 2.85 }, width: 1.1, heading: -Math.PI / 2, path: Array.from({ length: 17 }, (_, i) => [cx + 3.2, (2.85 * i) / 16, cz + 1.6 - (3.2 * i) / 16] as [number, number, number]), usable: true }],
  } };
  const ev: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [{ id: 1, y: 2.85, label: 'floor at 2.85 m' }], set, assets: {} };
  ev.hash = nextEntityPhysics(undefined, ev).hash;
  const r = e.applyWorldEditV1(ev);
  assert.equal(r.hash, ev.hash); assert.deepEqual(r.trapped, []);
  assert.ok((e as never as { rt: { services: { spatial: { ground?: unknown } } } }).rt.services.spatial.ground, 'still in ground mode after the edit');
  const up = e.reachV1({ p: [cx, cz + 8] }, { p: [cx - 2, cz - 1], level: 1 });
  assert.equal(up.ok, true, JSON.stringify(up)); assert.ok(up.levels?.includes(1));
  // from behind the house into its ground-floor room: round the walls to the door (a straight line would be 8 m)
  const round = e.reachV1({ p: [cx, cz - 8] }, { p: [cx, cz] });
  assert.equal(round.ok, true, JSON.stringify(round)); assert.ok((round.length ?? 0) > 13, `round the walls: ${round.length}`);
  const into = run(e, [{ verb: 'walk_to', params: { to: [cx, cz] } }]);
  assert.equal(into.end?.kind, 'completed', JSON.stringify(into.end));
  for (const s of into.ys) assert.ok(!(Math.abs(s.z - (cz - 3)) < 0.3 && Math.abs(s.x - cx) < 4), `through the north wall at ${s.x},${s.z}`);
  // (the body verb walk_to takes no level for bare coordinates; the climb itself is covered by reachV1 above)
  const hill = run(e, [{ verb: 'walk_to', params: { to: [30, 0] } }]);
  assert.equal(hill.end?.kind, 'completed', JSON.stringify(hill.end));
  assert.ok(body(e).pose.p[1] > 4.9, `on the knoll top: ${body(e).pose.p}`);
  for (const s of hill.ys) if (Math.hypot(s.x - cx, s.z - cz) > 6) assert.ok(Math.abs(s.y - field.height(s.x, s.z)) < 1e-9, `y off the ground at ${s.x},${s.z}`);
  assert.deepEqual(e.runtime.violations, []);
});

test('a footbridge deck over a deep river is walkable in ground mode (decks: height, medium, rails); without it the river refuses', () => {
  // a channel 6 m wide and 2 m deep across the whole world (no way round), banks at 0, water at 0
  const g = emptyGround(1000);
  const river: [number, number][] = [[-3, -500], [3, -500], [3, 500], [-3, 500]];
  g.landforms.push({ id: 'river', kind: 'carve', area: river, bed: -2, edge: 1 });
  g.waters.push({ id: 'river', area: river, level: 0 });
  const rf = groundFact(g, 1), rfield = groundField(rf.recipeHash);
  const make = () => { const e = factory.create(factory.genesis('deck')) as never as Engine & { installGroundV1(f: unknown): unknown; applyWorldEditV1(ev: WorldEditV1): { hash: string } }; e.installGroundV1(rf); e.spawnHuman({ id: 'h_ada', label: 'Ada', soul: 's_ada' }); return e; };
  const a = make();
  a.world.entities.h_ada && ((a.world.entities.h_ada as unknown as Body).pose.p = [-10, 0, 0]);
  const blocked = run(a, [{ verb: 'walk_to', params: { to: [10, 0] } }]);
  assert.equal(blocked.end?.kind, 'failed', JSON.stringify(blocked.end));
  assert.equal(blocked.end?.code, 'ground.deep-water');
  // the god's bridge: a deck 0.6 m above the banks from x -6 to 6, 2.4 m wide, rails along both sides over the water
  const e = make(); (e.world.entities.h_ada as unknown as Body).pose.p = [-10, 0, 0];
  const rail = (id: string, z: number) => ({ id, obb: { c: [0, z] as [number, number], half: [3.2, 0.06] as [number, number], yaw: 0 }, y0: 0.6, y1: 1.6, kind: 'fixture' as const, label: 'bridge rail' });
  const ev: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: {}, set: { e_bridge1: {
    surfaces: [{ id: 'bridge:deck', level: 0, y: 0.6, obb: { c: [0, 0], half: [6, 1.2], yaw: 0 } }],
    solids: [rail('bridge:rail-n', -1.25), rail('bridge:rail-s', 1.25)], links: [],
  } } };
  ev.hash = nextEntityPhysics(undefined, ev).hash;
  e.applyWorldEditV1(ev);
  const across = run(e, [{ verb: 'walk_to', params: { to: [10, 0] } }]);
  assert.equal(across.end?.kind, 'completed', JSON.stringify(across.end));
  const mid = across.ys.filter((s) => Math.abs(s.x) < 2.5);
  assert.ok(mid.length > 3, 'crossed the middle');
  for (const s of mid) assert.ok(Math.abs(s.y - 0.6) < 1e-9 && Math.abs(s.z) < 1.2, `on the deck at ${s.x},${s.y},${s.z}`);
  assert.ok(!across.acts.has('swim') && !across.acts.has('wade'), [...across.acts].join());
  assert.ok(Math.abs(body(e).pose.p[1] - rfield.height(10, 0)) < 1e-9, 'off the far end on the bank');
  // The river beside the bridge is deep: an ordinary journey now walks to its bank and swims.
  const into = run(e, [{ verb: 'walk_to', params: { to: [0, 8] } }]);
  assert.equal(into.end?.kind, 'completed', JSON.stringify(into.end));
  assert.ok(into.acts.has('swim'));
  assert.equal(body(e).human.activity, 'tread');
  assert.deepEqual(e.runtime.violations, []);
});

test('a pier over the lake: a swimmer heading for its end lands at the real shore and walks out on the deck; no swimming off it', () => {
  const e = world('pier') as never as Engine & { applyWorldEditV1(ev: WorldEditV1): { hash: string } };
  // the god's pier: from the east shore (x -46) out to x -62 at z -20, deck 0.7 m above the water, a 4 m end platform
  const ev: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: {}, set: { e_pier1: {
    surfaces: [{ id: 'pier:deck', level: 0, y: 0.7, obb: { c: [-54, -20], half: [8, 1.2], yaw: 0 } }, { id: 'pier:end', level: 0, y: 0.7, obb: { c: [-64, -20], half: [2, 2], yaw: 0 } }],
    solids: [], links: [],
  } } };
  ev.hash = nextEntityPhysics(undefined, ev).hash;
  e.applyWorldEditV1(ev);
  // Classify the just-installed target using the effective deck field, before any
  // unrelated movement has warmed spatial state. A pier is not water below it.
  const onto = run(e, [{verb: 'walk_to', params: {to: [-64, -20]}}], 20 * 400);
  assert.equal(onto.end?.kind, 'completed', JSON.stringify(onto.end));
  assert.ok(!onto.acts.has('swim'), [...onto.acts].join(',')); // a shallow pond on the land approach may be waded
  assert.ok(Math.abs(body(e).pose.p[1] - .7) < 1e-9);
  assert.equal(run(e, [{ verb: 'walk_to', params: { to: [-49, -26] } }]).end?.kind, 'completed');
  const sw = run(e, [{ verb: 'mars:swim_to', params: { x: -72, z: -16 } }], 20 * 400);
  assert.equal(sw.end?.kind, 'completed', JSON.stringify(sw.end));
  const out = run(e, [{ verb: 'walk_to', params: { to: [-64, -20] } }], 20 * 600);
  assert.equal(out.end?.kind, 'completed', JSON.stringify(out.end));
  assert.ok(out.acts.has('swim') && out.acts.has('walk'), [...out.acts].join(','));
  // she climbed out where the lake bed meets the bank and walked onto the deck from there, never up onto it from below
  for (let i = 1; i < out.ys.length; i++) assert.ok(Math.abs(out.ys[i].y - out.ys[i - 1].y) < 0.15, `no jump at ${JSON.stringify(out.ys[i])}`);
  const firstOnDeck = out.ys.findIndex((s) => Math.abs(s.y - 0.7) < 1e-6);
  assert.ok(firstOnDeck > 0 && out.ys[firstOnDeck].x > -50, `stepped onto the deck at its landward end: ${JSON.stringify(out.ys[firstOnDeck])}`);
  assert.ok(Math.abs(body(e).pose.p[1] - 0.7) < 1e-9, `on the pier's end: ${body(e).pose.p}`);
  assert.equal(body(e).human.activity, 'idle');
  // from the deck she cannot swim (step off at the shore first)
  assert.equal(run(e, [{ verb: 'mars:swim_to', params: { x: -72, z: -16 } }]).end?.code, 'swim.on-deck');
  assert.deepEqual(e.runtime.violations, []);
});

test('fault recovery restores a body to its last valid pose on the ground; from deep water, to the nearest standable shore', () => {
  const e = world() as unknown as Engine & { restoreHumanPoseV1(id: string, pose: { p: [number, number, number]; yaw?: number; level?: number }): boolean };
  // on the knoll's flank: exactly there, standing on the tiles (not y = 0)
  assert.equal(e.restoreHumanPoseV1('h_ada', { p: [24, field.height(24, 3), 3], yaw: 1.2, level: 0 }), true);
  let p = body(e).pose.p;
  assert.deepEqual([p[0], p[2]], [24, 3]); assert.ok(Math.abs(p[1] - field.height(24, 3)) < 1e-3 && p[1] > 1, `y ${p[1]}`);
  for (let i = 0; i < 5; i++) e.step();
  assert.deepEqual(e.runtime.violations, [], 'no teleport fault: the relocation is acknowledged');
  // in the deep lake: the nearest dry or wadable point, never the water and never the origin
  assert.equal(e.restoreHumanPoseV1('h_ada', { p: [-52, -1.2, -20], level: 0 }), true);
  p = body(e).pose.p;
  assert.ok(field.medium(p[0], p[2]) <= 1, `standable: medium ${field.medium(p[0], p[2])} at ${p}`);
  assert.ok(Math.hypot(p[0] + 52, p[2] + 20) < 8 && Math.hypot(p[0], p[2]) > 20, `near the lake edge ${p}`);
  assert.equal(body(e).human.activity, 'idle');
  for (let i = 0; i < 5; i++) e.step();
  assert.deepEqual(e.runtime.violations, []);
  // a body running a programme is not moved
  const adm = e.perform({ actor: 'h_ada', label: 'walk', steps: [{ verb: 'walk_to', params: { to: [0, 0] } }] }); assert.ok(adm.ok);
  e.step();
  assert.equal(e.restoreHumanPoseV1('h_ada', { p: [24, 0, 3], level: 0 }), false);
});

test('one ordinary destination journey walks to the bank, wades, swims, then returns to dry ground', () => {
  const e = world('land-water-journey');
  const into = run(e, [{verb: 'walk_to', params: {to: [-70, -20]}}], 20 * 400);
  assert.equal(into.end?.kind, 'completed', JSON.stringify(into.end));
  assert.ok(into.acts.has('walk') && into.acts.has('wade') && into.acts.has('swim'), [...into.acts].join(','));
  assert.equal(body(e).human.activity, 'tread');
  assert.ok(Math.hypot(body(e).pose.p[0] + 70, body(e).pose.p[2] + 20) < .1);
  const out = run(e, [{verb: 'walk_to', params: {to: [0, -5]}}], 20 * 400);
  assert.equal(out.end?.kind, 'completed', JSON.stringify(out.end));
  assert.equal(body(e).human.activity, 'idle');
  assert.deepEqual(e.runtime.violations, []);
});

test('a composed land-to-water journey restores during its walk and during its swim', () => {
  for (const at of ['walk', 'swim']) {
    const a = world(`journey-snap-${at}`);
    a.perform({actor: 'h_ada', label: 'lake', steps: [{verb: 'walk_to', params: {to: [-70, -20]}}]});
    for (let n = 0; n < 6000 && (n < 40 || body(a).human.activity !== at); n++) a.step();
    assert.equal(body(a).human.activity, at);
    const b = factory.restore(a.snapshot());
    for (let n = 0; n < 100; n++) { a.step(); b.step(); }
    assert.equal(a.stateHash(), b.stateHash());
    assert.deepEqual(a.runtime.violations, []);
  }
});

test('stopping a composed journey on land or in water releases its child without moving again', () => {
  for (const at of ['walk', 'swim']) {
    const e = world(`journey-stop-${at}`);
    const admitted = e.perform({actor: 'h_ada', label: 'lake', steps: [{verb: 'walk_to', params: {to: [-70, -20]}}]});
    assert.equal(admitted.ok, true); if (!admitted.ok) continue;
    for (let n = 0; n < 6000 && (n < 40 || body(e).human.activity !== at); n++) e.step();
    assert.equal(body(e).human.activity, at);
    e.stop(admitted.id);
    let cancelled = false;
    for (let n = 0; n < 100; n++) cancelled ||= e.step().programs.some(p => p.id === admitted.id && p.kind === 'cancelled');
    assert.ok(cancelled);
    const stopped = [...body(e).pose.p];
    for (let n = 0; n < 40; n++) e.step();
    assert.deepEqual(body(e).pose.p, stopped);
    assert.equal(body(e).human.activity, at === 'swim' ? 'tread' : 'idle');
    assert.deepEqual(e.runtime.violations, []);
  }
});

test('a thin barrier added mid-swim fails truthfully before any crossing', () => {
  const e = world('journey-barrier') as ReturnType<typeof world> & {applyWorldEditV1(ev: WorldEditV1): unknown};
  const admitted = e.perform({actor: 'h_ada', label: 'lake', steps: [{verb: 'walk_to', params: {to: [-70, -20]}}]});
  assert.equal(admitted.ok, true); if (!admitted.ok) return;
  for (let n = 0; n < 6000 && body(e).human.activity !== 'swim'; n++) e.step();
  assert.equal(body(e).human.activity, 'swim');
  const [x,,z] = body(e).pose.p;
  const edit: WorldEditV1 = {contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: {}, set: {barrier: {solids: [{id: 'thin-water-wall', obb: {c: [x - 2, z], half: [.05, 8], yaw: 0}, y0: -4, y1: 2, kind: 'fixture', label: 'new water barrier'}]}}};
  edit.hash = nextEntityPhysics(undefined, edit).hash; e.applyWorldEditV1(edit);
  let failed: {kind: string; code?: string} | undefined;
  for (let n = 0; n < 200 && !failed; n++) failed = e.step().programs.find(p => p.id === admitted.id && p.kind === 'failed');
  assert.equal(failed?.code, 'swim.blocked');
  assert.ok(body(e).pose.p[0] > x - 1, 'never crosses the new wall');
  assert.equal(body(e).human.activity, 'tread');
  assert.deepEqual(e.runtime.violations, []);
});
