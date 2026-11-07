// G1 "god rules": the walk-out planner on real compiler worlds with a scripted engine. Redefinitions (an instance
// re-made by its definition, a landform raised by its definition) walk residents out instead of being refused; a
// resident with no walking route is relocated; edits that change nothing anyone stands in move nobody.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, coreRef, type DefInput, type ResidentMove, type Result } from '@souls/world-compiler';
import { meter } from '@souls/world-compiler/work-meter';
import { mediumAt } from '@souls/ground';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { planWalkouts, walkoutReason, stuckWarning, type WalkoutEngine } from './walkout.ts';
import { inSite } from './builds.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Body = { p: [number, number, number]; human: Record<string, unknown> };
const post = (size: [number, number, number]): DefInput => ({ schema: 'def/1', name: 'probe-post', size: { box: size }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, size[1] / 2, 0], size }] } } });
const mound = (h: number): DefInput => ({ schema: 'def/1', name: 'mound', layer: 'volume', make: { kind: 'none' }, size: { box: [10, 1, 10] }, components: { landform: { kind: 'bump', c: [0, 0], r: 5, h, peak: 1 } } });
const ada = { soulId: 's_ada', entityId: 'h_ada', name: 'Ada' };

/** A scripted engine: Ada's body, who uses what, every point standable, and walking routes open or not. */
function engine(body: Body, uses: Record<string, { body: string; how: 'occupied' | 'held' }> = {}, route = true): WalkoutEngine & { routes: number } {
  const e = {
    routes: 0,
    world: { entities: { [ada.entityId]: { id: ada.entityId, pose: { p: body.p }, human: body.human } } as Record<string, any> },
    bodyUsesV1: (id: string) => uses[id] ?? null,
    seatOccupantsV1: (id: string) => uses[id]?.how === 'occupied' ? [{ body: uses[id].body }] : [],
    standableNearV1: (at: [number, number]) => at,
    godWalkoutRouteV1: () => { e.routes++; return route; },
  };
  return e;
}
function fixture(t: TestContext, eng: () => WalkoutEngine) {
  const db = new Db(':memory:'), applied: ResidentMove[] = [];
  const god = new GodMode(db, { worldId: 'walkout', ownerId: 'owner', tick: () => 100, emit: () => {} });
  god.bodies = { uses: () => null, prepare: (before, after, diff) => ({ ...planWalkouts(eng(), before, after, diff, [ada]), warnings: [], touched: [] }), apply: moved => { applied.push(...moved); } };
  t.after(() => db.close());
  return { god, applied };
}
const ok = (r: Result) => { assert.equal(r.accepted, true, JSON.stringify(r)); if (!r.accepted) throw Error('refused'); return r; };

test('a redefinition that re-makes a seat a resident sits on walks it out of the new footprint (never refused)', t => {
  let eng: WalkoutEngine & { routes: number };
  const f = fixture(t, () => eng);
  eng = engine({ p: [0, 0, 1.5], human: { activity: 'idle' } });
  ok(f.god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }] }));
  assert.deepEqual(f.applied, [], 'nobody stands in the small post');
  const id = f.god.model.get('post')!.id;
  eng = engine({ p: [0, 0, 0.6], human: { activity: 'sit' } }, { [id]: { body: ada.entityId, how: 'occupied' } });
  const r = ok(f.god.act({ clientRef: 'grow', ops: [{ op: 'define', def: post([6, 6, 6]) }] }));
  assert.equal(r.moved?.length, 1); const m = r.moved![0];
  assert.equal(m.how, 'walked'); assert.deepEqual(m.released, [id]); assert.equal(m.place, 'post');
  assert.equal(m.reason, 'The god is rebuilding the post; you stood up and stepped aside.');
  assert.ok(!inSite({ at: [0, 0], size: [6, 6], yaw: 0 }, m.to, .35), `outside the re-made post: ${m.to}`);
  assert.deepEqual(f.applied, r.moved, 'applied once after the commit');
  assert.equal(f.god.model.footprintsOf(id)[0].half[0], 3, 'the definition applies in the same request');
  assert.deepEqual(f.god.act({ clientRef: 'grow', ops: [{ op: 'define', def: post([6, 6, 6]) }] }), { ...r, replayed: true }); assert.equal(f.applied.length, 1);
  // Undo of the redefinition is a god edit too: Ada sat down again and is walked out again.
  const undo = ok(f.god.undo()); assert.equal(undo.moved?.[0]?.name, 'Ada'); assert.equal(f.applied.length, 2);
  assert.equal(f.god.model.footprintsOf(id)[0].half[0], .25);
});

test('a terrain definition raising ground over a resident walks it off the raised ground; no route relocates it', t => {
  let eng: WalkoutEngine & { routes: number };
  const f = fixture(t, () => eng);
  eng = engine({ p: [0, 0, 0], human: { activity: 'idle' } });
  ok(f.god.act({ ops: [{ op: 'define', def: mound(0) }, { op: 'place', def: 'mound@1', name: 'mound', p: [0, 0] }] }));
  assert.deepEqual(f.applied, []);
  const r = ok(f.god.act({ ops: [{ op: 'world', state: { constitution: 'hills' } }, { op: 'define', def: mound(4) }] }));
  const m = r.moved![0]; assert.equal(m.how, 'walked'); assert.equal(m.reason, 'The god is rebuilding the mound; you stepped aside.');
  assert.ok(f.god.model.terrain.sample(m.to[0], m.to[1]) <= .25, `off the raised ground: ${m.to}`); assert.ok(f.god.model.terrain.sample(0, 0) > 3);
  // The same edit with every walking route closed: relocated to the same kind of point, and told so.
  eng = engine({ p: [0, 0, 0], human: { activity: 'nap' } }, {}, false);
  const redo = ok(f.god.undo()); assert.equal(redo.moved, undefined, 'lowering the ground buries nobody');
  const again = ok(f.god.redo()); const n = again.moved![0];
  assert.equal(n.how, 'relocated'); assert.ok(eng.routes > 0, 'routes were tried first');
  assert.equal(n.reason, 'The god is rebuilding the mound; you woke; no walking route was open, so you were moved safely aside.');
});

test('edits that change nothing a resident stands in, sits on or holds move nobody', t => {
  let eng: WalkoutEngine & { routes: number };
  const f = fixture(t, () => eng);
  eng = engine({ p: [10, 0, 10], human: { activity: 'idle' } });
  ok(f.god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }] }));
  const id = f.god.model.get('post')!.id;
  eng = engine({ p: [0, 0, 0.6], human: { activity: 'sit' } }, { [id]: { body: ada.entityId, how: 'occupied' } });
  for (const ops of [[{ op: 'set', id: 'post', name: 'pillar' }], [{ op: 'world', state: { constitution: 'quiet' } }], [{ op: 'define', def: post([0.5, 1, 0.5]) }]]) {
    const r = ok(f.god.act({ ops })); assert.equal(r.moved, undefined, JSON.stringify(ops));
  }
  // Standing right beside a plain solid the god removes is not being in its way; a new solid placed there is.
  eng = engine({ p: [0, 0, 0.5], human: { activity: 'idle' } });
  assert.equal(ok(f.god.act({ ops: [{ op: 'remove', id }] })).moved, undefined);
  assert.deepEqual(f.applied, []);
  const placed = ok(f.god.act({ ops: [{ op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0.3] }] }));
  assert.equal(placed.moved?.[0]?.reason, 'The god is building the post; you stepped aside.');
});

test('held things are let go of at the feet, and the reason names what was set down', t => {
  let eng: WalkoutEngine & { routes: number };
  const f = fixture(t, () => eng);
  eng = engine({ p: [20, 0, 0], human: { activity: 'idle' } });
  ok(f.god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }] }));
  const id = f.god.model.get('post')!.id;
  eng = engine({ p: [1.5, 0, 0], human: { activity: 'idle' } }, { [id]: { body: ada.entityId, how: 'held' } });
  eng.world.entities[id] = { id, support: { kind: 'in-hand', by: ada.entityId }, pose: { p: [1.5, 1, 0] } };
  const r = ok(f.god.act({ ops: [{ op: 'remove', id }] })), m = r.moved![0];
  assert.deepEqual(m.released, [id]); assert.deepEqual(m.dropAt, [1.5, 0, 0], 'set down at its feet');
  assert.equal(m.reason, 'The god is removing the post; you set down the post and stepped aside.');
});

test('reason wording: buildings, construction sites, several things set down, no route', () => {
  assert.equal(walkoutReason({ verb: 'moving', subject: 'the church', how: 'walked', outside: true, seated: true }), 'The god is moving the church; you stood up and stepped outside.');
  assert.equal(walkoutReason({ verb: '', subject: 'Stone church', how: 'walked', outside: false, site: true, asleep: true }), 'The god started building Stone church here; you woke and stepped off the site.');
  assert.equal(walkoutReason({ verb: 'removing', subject: 'the table', how: 'walked', outside: false, setDown: ['bowl', 'cup', 'book'] }), 'The god is removing the table; you set down the bowl, the cup and the book and stepped aside.');
  assert.equal(walkoutReason({ verb: 'reshaping', subject: 'the ground here', how: 'relocated', outside: false, lying: true }), 'The god is reshaping the ground here; you got up; no walking route was open, so you were moved safely aside.');
});

// ---- review fixes (G1 findings) ----

/** A scripted engine for many residents: each body by id, routes open or not, every point standable unless `standable` says no. */
function crowd(bodies: Record<string, Body>, o: { route?: boolean; standable?: (at: [number, number]) => boolean; uses?: Record<string, { body: string; how: 'occupied' | 'held' }> } = {}) {
  const e = {
    routes: 0,
    world: { entities: Object.fromEntries(Object.entries(bodies).map(([id, b]) => [id, { id, pose: { p: b.p }, human: b.human }])) as Record<string, any> },
    bodyUsesV1: (id: string) => o.uses?.[id] ?? null,
    seatOccupantsV1: (id: string) => o.uses?.[id]?.how === 'occupied' ? [{ body: o.uses[id].body }] : [],
    standableNearV1: (at: [number, number]) => (o.standable ?? (() => true))(at) ? at : null,
    godWalkoutRouteV1: () => { e.routes++; return o.route ?? true; },
  };
  return e;
}
function godWorld(t: TestContext) {
  const db = new Db(':memory:'), god = new GodMode(db, { worldId: 'walkout-review', ownerId: 'owner', tick: () => 100, emit: () => {} });
  t.after(() => db.close());
  return god;
}
/** Plan an edit's walk-outs without committing it, on the compiler's would-be world (returned as `after`). */
function planEdit(god: GodMode, eng: WalkoutEngine, ops: unknown[], minds = [ada]) {
  const after = god.model.fork(), r = applyBatch(after, { ops }, 'god', 100, {});
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  return { ...planWalkouts(eng, god.model, after, r.diff!, minds), after };
}

test('a cosmetic param edit of an occupied building moves nobody; a param that re-makes it walks residents out', async t => {
  const god = godWorld(t);
  ok(god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'hut', p: [0, 0] }] }));
  const eng = crowd({ [ada.entityId]: { p: [0, 0, 0], human: { activity: 'idle' } } });
  assert.deepEqual((planEdit(god, eng, [{ op: 'set', id: 'hut', params: { wall: '#cc3333' } }])).moved, [], 'a wall colour changes nothing anyone stands in');
  assert.deepEqual((planEdit(god, eng, [{ op: 'set', id: 'hut', params: { trim: '#112233', roofColor: '#445566' } }])).moved, []);
  const rebuilt = (planEdit(god, eng, [{ op: 'set', id: 'hut', params: { floors: 2 } }])).moved;
  assert.equal(rebuilt.length, 1); assert.equal(rebuilt[0].reason, 'The god is rebuilding the hut; you stepped outside.');
});

test('a new lake around a resident, or ground dropping away under one, walks it to dry ground', async t => {
  const god = godWorld(t);
  const eng = crowd({ [ada.entityId]: { p: [20, 0, 20], human: { activity: 'idle' } } });
  const { moved: lake, after } = planEdit(god, eng, [{ op: 'place', def: coreRef('lake'), name: 'lake', shape: { area: [[10, 10], [30, 10], [30, 30], [10, 30]] }, params: { depth: 4 } }]);
  assert.equal(lake.length, 1, 'standing in what becomes a lake is being in the way');
  assert.equal(mediumAt(after.terrain, 20, 20), 'swim', 'deep water where Ada stood');
  assert.ok(['walk', 'wade'].includes(mediumAt(after.terrain, lake[0].to[0], lake[0].to[1])), `exit on dry ground: ${lake[0].to}`);
  assert.equal(lake[0].reason, 'The god is building the lake; you stepped aside.');
  // A mound Ada stands on (her body 4 m up) lowered back to flat ground: she is not left standing on air.
  ok(god.act({ ops: [{ op: 'define', def: mound(4) }, { op: 'place', def: 'mound@1', name: 'mound', p: [0, 0] }] }));
  const onTop = crowd({ [ada.entityId]: { p: [0, god.model.terrain.sample(0, 0), 0], human: { activity: 'sit' } } });
  const lowered = (planEdit(god, onTop, [{ op: 'define', def: mound(0) }])).moved;
  assert.equal(lowered.length, 1); assert.equal(lowered[0].reason, 'The god is rebuilding the mound; you stood up and stepped aside.');
  assert.ok(Math.abs(god.model.terrain.sample(lowered[0].to[0], lowered[0].to[1])) < .3 || dist2(lowered[0].to, [0, 0]) > 4.5, `off the changed ground or onto stable ground: ${lowered[0].to}`);
});
const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('a plateau far wider than the near search, over a seated or napping resident, never skips it silently', async t => {
  const god = godWorld(t);
  const [x0, z0, x1, z1] = god.model.ground().extent, area = [[Math.max(x0 + 2, -90), Math.max(z0 + 2, -90)], [Math.min(x1 - 2, 110), Math.max(z0 + 2, -90)], [Math.min(x1 - 2, 110), Math.min(z1 - 2, 90)], [Math.max(x0 + 2, -90), Math.min(z1 - 2, 90)]];
  for (const human of [{ activity: 'sit', baseActivity: 'sit' }, { activity: 'nap', sleepPose: {} }]) {
    const eng = crowd({ [ada.entityId]: { p: [10, 0, 0], human } });
    const plan = planEdit(god, eng, [{ op: 'place', def: coreRef('plateau'), name: 'terrace', shape: { area }, params: { height: 6, edge: 4 } }]);
    assert.equal(plan.stuck.length, 0); assert.equal(plan.moved.length, 1, JSON.stringify(human));
    assert.match(plan.moved[0].reason, human.activity === 'nap' ? /^The god is building the terrace; you woke/ : /^The god is building the terrace; you stood up/);
  }
  // With no standable ground anywhere, the resident is named as stuck (the bridge warns `body.stuck`), never skipped.
  const nowhere = crowd({ [ada.entityId]: { p: [10, 0, 0], human: { activity: 'sit' } } }, { standable: () => false });
  const none = planEdit(god, nowhere, [{ op: 'place', def: coreRef('plateau'), name: 'terrace', shape: { area }, params: { height: 6 } }]);
  assert.deepEqual(none.moved, []); assert.equal(none.stuck.length, 1);
  assert.equal(none.stuck[0].reason, 'The god is building the terrace; there was no clear ground to step to, so you stayed where you were.');
  assert.match(stuckWarning(none.stuck[0]), /^body\.stuck: Ada \(h_ada\) is in the edit's way/);
});

test('a resident only on its way to a seat the edit moves stops where it is (its body stays); one seated is walked out', async t => {
  const god = godWorld(t);
  ok(god.act({ ops: [{ op: 'define', def: post([0.5, 1, 0.5]) }, { op: 'place', def: 'probe-post@1', name: 'post', p: [0, 0] }] }));
  const id = god.model.get('post')!.id, uses = { [id]: { body: ada.entityId, how: 'occupied' as const } };
  const walking = crowd({ [ada.entityId]: { p: [6, 0, 0], human: { activity: 'walk', speed: 1.2 } } }, { uses });
  const stop = (planEdit(god, walking, [{ op: 'move', id: 'post', p: [2, 0] }])).moved;
  assert.equal(stop.length, 1); assert.equal(stop[0].how, 'stopped'); assert.deepEqual(stop[0].to, stop[0].from); assert.deepEqual(stop[0].released, [id]);
  assert.equal(stop[0].reason, 'The god is moving the post you were heading for; you stopped.');
  assert.equal(walking.routes, 0, 'no exit is planned for a body that stays');
  const seated = crowd({ [ada.entityId]: { p: [0, 0, .6], human: { activity: 'sit' } } }, { uses });
  assert.equal((planEdit(god, seated, [{ op: 'move', id: 'post', p: [2, 0] }])).moved[0].how, 'walked');
});

test('held things are set down beside the exit when the feet are inside the new geometry; a shared carry is let go of too', async t => {
  const god = godWorld(t);
  const eng = crowd({ [ada.entityId]: { p: [0, 0, 0], human: { activity: 'idle' } }, h_bob: { p: [1, 0, 0], human: { activity: 'carry' } } });
  eng.world.entities.e_load = { id: 'e_load', label: 'Crate', support: { kind: 'held', by: [ada.entityId, 'h_bob'] }, pose: { p: [.5, 1, 0] } };
  const m = (planEdit(god, eng, [{ op: 'place', def: coreRef('wall'), name: 'wall', p: [0, 0], params: { w: 4, h: 2.6, d: .5 } }])).moved[0];
  assert.ok(m.released.includes('e_load'), 'the shared load is released (both carriers let go)');
  assert.deepEqual([m.dropAt![0], m.dropAt![2]], m.to, 'set down beside the exit, not inside the new wall');
  assert.match(m.reason, /you set down the crate/);
});

test('route checks share one budget per edit: residents past it are relocated, not each tried sixteen times', async t => {
  const god = godWorld(t);
  ok(god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'hut', p: [0, 0], params: { w: 16, d: 12 } }] }));
  const bodies: Record<string, Body> = {}, minds = [];
  for (let i = 0; i < 24; i++) { const id = `h_res${i}`; bodies[id] = { p: [-6 + (i % 6) * 2.2, 0, -4 + Math.floor(i / 6) * 2.2], human: { activity: 'idle' } }; minds.push({ soulId: `s_res${i}`, entityId: id, name: `R${i}` }); }
  const eng = crowd(bodies, { route: false });
  const t0 = performance.now(), plan = planEdit(god, eng, [{ op: 'move', id: 'hut', p: [30, 0] }], minds), ms = performance.now() - t0;
  assert.equal(plan.moved.length, 24); assert.ok(plan.moved.every(m => m.how === 'relocated'));
  assert.ok(eng.routes <= 64, `route checks ${eng.routes}`);
  const exits = plan.moved.map(m => m.to);
  for (const [i, a] of exits.entries()) for (const b of exits.slice(i + 1)) assert.ok(dist2(a, b) >= .85, 'exits keep residents apart');
  if (process.env.GOD_WALKOUT_BENCH === '1') console.log(`walk-out plan: 24 residents, no routes: ${ms.toFixed(1)} ms`);
});

// Z3: work budgets, not milliseconds (see @souls/world-compiler/work-meter): the same answer on any CPU, so it runs in the gate.
// Measured 2026-10-20, identical on every run: planning 40 residents among 1,501 entities 358,325 (routes open) and
// 361,596 (closed, 64 route checks: the shared per-edit budget). The work budget is about 2x; routes keep the edit's 64.
const WALKOUT_WORK = { plan: 720_000, routes: 64 };
test('bench: walk-out planning for N residents among M entities stays fast', async t => {
  const god = godWorld(t), ops: unknown[] = [];
  for (let i = 0; i < 1500; i++) ops.push({ op: 'place', def: coreRef(i % 3 ? 'bench' : 'lamp-post'), p: [-60 + (i % 40) * 3, -60 + Math.floor(i / 40) * 3.2] });
  for (let i = 0; i < ops.length; i += 250) ok(god.act({ ops: ops.slice(i, i + 250) }));
  ok(god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'hut', p: [70, 70], params: { w: 16, d: 12 } }] }));
  const bodies: Record<string, Body> = {}, minds: { soulId: string; entityId: string; name: string }[] = [];
  for (let i = 0; i < 40; i++) { const id = `h_res${i}`; bodies[id] = { p: [64 + (i % 8) * 1.5, 0, 66 + Math.floor(i / 8) * 1.6], human: { activity: 'idle' } }; minds.push({ soulId: `s_res${i}`, entityId: id, name: `R${i}` }); }
  for (const route of [true, false]) {
    const eng = crowd(bodies, { route }), t0 = performance.now();
    const { value: plan, work: w } = meter(() => planEdit(god, eng, [{ op: 'move', id: 'hut', p: [40, 70] }], minds)), ms = performance.now() - t0;
    console.log(`walk-out plan: ${plan.moved.length} of 40 residents, ${god.model.entities.size} entities, routes ${route ? 'open' : 'closed'}: ${ms.toFixed(0)} ms (${eng.routes} route checks) work=${JSON.stringify(w)}`);
    assert.ok(w.total <= WALKOUT_WORK.plan, `walk-out plan work ${w.total}`); assert.ok(eng.routes <= WALKOUT_WORK.routes, `route checks ${eng.routes}`);
  }
});
