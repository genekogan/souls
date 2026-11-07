// RT (2026-10-20): every building a god places is enterable through its front door at any yaw, on any slope.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { GroundHost } from './ground-host.ts';
import { runQuery } from './query.ts';
import structures from '../../../../packages/world-compiler/src/core-kit/structures.json' with { type: 'json' };
import vocabW3 from '../../../../packages/world-compiler/src/core-kit/vocab-w3.json' with { type: 'json' };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
function world(t: TestContext, maxLevel?: number) {
  const w = fixture(':memory:', factory, { durableClockV1: true });
  w.brain.quiesce();
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {} });
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false, maxLevel });
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  const act = (ops: any[]) => { const r = god.act({ ops }) as any; assert.equal(r.accepted, true, JSON.stringify(r)); return r; };
  const E = w.host.engine as any;
  return { ...w, god, bridge, settle, act, E };
}

const COTTAGE = { w: 8, d: 6, floors: 1, floorHeight: 2.8, style: 'cottage', roof: 'gable', roofPitch: 32, material: 'plaster', front: 's', porch: 0, balcony: false, windows: 0.6, wallThickness: 0.22 };

test('bench-hamlet: the cottage on the knoll is enterable from the arrival point', { timeout: 300_000 }, async (t) => {
  const w = world(t); await w.settle(2);
  w.act([
    { op: 'place', def: coreRef('knoll'), name: 'knoll', p: [40, 10], params: { height: 4, radius: 22, peak: 1, edge: 8 } },
  ]);
  await w.settle(2);
  for (const [label, r, onKnoll] of [['yaw0-flat', 0, false], ['yaw-1.07-flat', -1.0685826404927201, false], ['yaw0-knoll', 0, true], ['yaw-1.07-knoll', -1.0685826404927201, true]] as const) {
    const p: Vec2 = onKnoll ? [44, 10] : [-30, -30];
    w.act([{ op: 'place', def: coreRef('cottage'), name: 'cottage', p, r, params: COTTAGE }]);
    await w.settle(4);
    const e = w.god.model.get('cottage')!;
    const start: Vec2 = onKnoll ? [0, 3.5] : [-30, -20];
    const out: string[] = [label, `y=${e.p?.[1]?.toFixed(3)}`];
    for (const room of ['cottage', 'cottage/living', 'cottage/bedroom', 'cottage/kitchen']) {
      const th = w.bridge.nav.thing(room);
      const goal = th ? w.bridge.nav.goal(th, start) : null;
      const r2 = goal ? w.E.reachV1({ p: start, level: 0 }, goal) : null;
      out.push(`${room}:${goal ? (r2.ok ? 'ok' : r2.code) : 'no-goal'}`);
    }
    console.log(out.join(' '));
    assert.deepEqual(out.slice(2).filter((x) => !x.endsWith(':ok')), [], out.join(' '));
    w.act([{ op: 'remove', id: 'cottage' }]);
    await w.settle(2);
  }
});

test('bench-hamlet: an old pad/1 cottage pad is re-cut at boot and the cottage becomes enterable', { timeout: 300_000 }, async (t) => {
  const w = fixture(':memory:', factory, { durableClockV1: true });
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  const opts = { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {} };
  const first = new GodMode(w.db, opts);
  const r = first.act({ ops: [
    { op: 'place', def: coreRef('knoll'), name: 'knoll', p: [40, 10], params: { height: 4, radius: 22, peak: 1, edge: 8 } },
    { op: 'place', def: coreRef('cottage'), name: 'cottage', p: [44, 10], r: -1.0685826404927201, params: COTTAGE },
  ] }) as any;
  assert.equal(r.accepted, true, JSON.stringify(r));
  const id = first.model.get('cottage')!.id;
  // what a world built before pad/2 stored: the same flat at the same level, a 1.5 m blend, no grade, no landings
  const row = w.db.db.prepare('SELECT body FROM world_meta_v1 WHERE world_id=?').get(w.host.worldId) as { body: string };
  const meta = JSON.parse(row.body);
  const pad = meta.ground.landforms.find((l: any) => l.id === `${id}:pad`);
  assert.ok(pad?.grade, 'a new placement gets a graded pad');
  delete pad.grade; delete pad.aprons; pad.edge = 1.5;
  w.db.db.prepare('UPDATE world_meta_v1 SET body=? WHERE world_id=?').run(JSON.stringify(meta), w.host.worldId);
  const god = new GodMode(w.db, opts);
  assert.deepEqual(god.regraded, [id]);
  const after = god.model.ground().landforms.find((l) => l.id === `${id}:pad`) as any;
  assert.equal(after.grade, 0.45); assert.ok(after.aprons?.length >= 1);
  assert.equal(after.level, pad.level);
  assert.deepEqual(god.model.get('cottage')!.p, first.model.get('cottage')!.p, 'the cottage stays where it stood');
  assert.deepEqual(new GodMode(w.db, opts).regraded, [], 'a graded pad is left alone at the next boot');
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  t.after(() => edge.comms?.close());
  for (let i = 0; i < 6; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); }
  const start: Vec2 = [0, 3.5];
  for (const room of ['cottage', 'cottage/living', 'cottage/bedroom']) {
    const th = bridge.nav.thing(room), goal = th ? bridge.nav.goal(th, start) : null;
    const reach = goal ? (w.host.engine as any).reachV1({ p: start, level: 0 }, goal) : null;
    assert.equal(reach?.ok, true, `${room}: ${goal ? reach?.code : 'no goal'}`);
  }
});

test('levels: a removed building\'s storeys free their level ids, so a world that rebuilt on a hill keeps room for new floors', { timeout: 300_000 }, async (t) => {
  // lane STACK (2026-10-21): engine level ids (1..20) are per floor height and were never freed, so after a few multi-storey
  // buildings came and went on a slope a new upper floor shared a level at another height and its rooms had no standing room.
  // Lane LEVELS raised the id space to MAX_LEVEL_ID (255); the bridge is capped at the old 20 here to keep the reuse path tested.
  const w = world(t, 20); await w.settle(2);
  w.act([{ op: 'place', def: coreRef('knoll'), name: 'hill', p: [0, 0], params: { height: 12, radius: 60, peak: 1, edge: 8 } }]);
  await w.settle(2);
  const levels = () => (w.bridge as any).levels as { id: number; y: number }[];
  for (const [def, dist, deg] of [['house', 40, 0], ['house', 25, 90], ['house', 40, 180], ['house', 25, 270], ['lighthouse', 200, 0], ['lighthouse', 40, 90], ['lighthouse', 25, 180], ['lighthouse', 40, 270], ['lighthouse', 25, 0], ['lighthouse', 32, 45], ['lighthouse', 48, 135], ['lighthouse', 36, 225], ['lighthouse', 28, 315], ['lighthouse', 44, 60]] as const) {
    w.act([{ op: 'place', def: coreRef(def), name: 'b', p: [dist, 0], r: deg * Math.PI / 180 }]);
    await w.settle(2);
    w.act([{ op: 'remove', id: 'b' }]);
    await w.settle(1);
  }
  assert.equal(levels().length, 20, `the removed storeys used up every level id (${levels().length})`);
  w.act([{ op: 'place', def: coreRef('apartment-block'), name: 'b', p: [25, 0], r: Math.PI / 2 }]);
  await w.settle(3);
  const e = w.god.model.get('b')!, baked = w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape) as any;
  const start: Vec2 = [25 + Math.hypot(baked.box[0], baked.box[2]) / 2 + 5, 0];
  const bad: string[] = [];
  for (const rm of baked.rooms ?? []) {
    const th = w.bridge.nav.thing(`b/${rm.id}`), goal = th ? w.bridge.nav.goal(th, start) : null;
    const r = goal ? w.E.reachV1({ p: start, level: 0 }, goal) : null;
    if (!r?.ok) bad.push(`${rm.id}:${goal ? r.code : 'no-goal'}`);
  }
  assert.ok((baked.rooms ?? []).length >= 10, 'the apartment block has its rooms');
  assert.deepEqual(bad, [], 'every room of the new building has standing room its front door reaches');
  assert.ok(levels().length <= 20);
});

test('levels: a world with more than 20 floor heights gives each its own level, and the rooms up there have reachable goals', { timeout: 300_000 }, async (t) => {
  // lane LEVELS (2026-10-21): level ids were capped at 20 (walk_to's schema); Eden 2026 has 51 floor heights, so upper
  // floors past the 20th shared a level at another height: their rooms had no goal (no standing room) or none reachable
  const w = world(t); await w.settle(2);
  w.act([{ op: 'place', def: coreRef('knoll'), name: 'hill', p: [0, 0], params: { height: 12, radius: 60, peak: 1, edge: 8 } }]);
  await w.settle(2);
  const placed: { name: string; p: Vec2 }[] = [];
  for (let k = 0; k < 14; k++) {
    const r = 16 + 3 * k, a = (k * 137.5 * Math.PI) / 180, p: Vec2 = [Math.round(r * Math.cos(a) * 10) / 10, Math.round(r * Math.sin(a) * 10) / 10];
    w.act([{ op: 'place', def: coreRef(k % 2 ? 'lighthouse' : 'house'), name: `b${k}`, p, r: a }]);
    placed.push({ name: `b${k}`, p });
  }
  await w.settle(3);
  const levels = (w.bridge as any).levels as { id: number; y: number }[];
  assert.ok(levels.length > 20, `more than 20 floor heights (${levels.length})`);
  const bad: string[] = []; let high = 0;
  for (const b of placed) {
    const e = w.god.model.get(b.name)!, baked = w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape) as any;
    for (const rm of baked.rooms ?? []) {
      const th = w.bridge.nav.thing(`${b.name}/${rm.id}`), goal = th ? w.bridge.nav.goal(th, th.at) : null;
      if (!goal) { bad.push(`${b.name}/${rm.id}:no-goal`); continue; }
      if (goal.level <= 20) continue;
      high++;
      const d = Math.hypot(...b.p) || 1, out: Vec2 = [b.p[0] + (b.p[0] / d) * (Math.hypot(baked.box[0], baked.box[2]) / 2 + 5), b.p[1] + (b.p[1] / d) * (Math.hypot(baked.box[0], baked.box[2]) / 2 + 5)];
      const r = w.E.reachV1({ p: out, level: 0 }, goal);
      if (!r.ok) bad.push(`${b.name}/${rm.id}:${r.code}`);
    }
  }
  assert.ok(high > 0, 'some rooms stand on levels above 20');
  assert.deepEqual(bad, [], 'every room has a goal, and those above level 20 are reached from outside');
});

/** Every building/1 type in the catalogue (structures.json + vocab-w3.json: 40 types). */
const BUILDING_TYPES = [...structures, ...vocabW3].filter((d: any) => d?.make?.gen === 'building/1').map((d: any) => coreRef(String(d.name).replace(/^core-/, '')));
const YAWS = Array.from({ length: 48 }, (_, i) => i * 7.5);
/**
 * Door sweep: each building placed on flat ground and on two slopes of a knoll (h 12, r 60: ~0.24 at 40 m, ~0.34 at 25 m
 * out), and a Soul 5 m outside reaches the building's goal inside through its front door. The gate runs a fixed subset
 * (every type once per terrain, at a yaw that differs by type and terrain: 120 placements); the full sweep (40 types x 48
 * yaws x 3 terrains = 5,760, ~20 min) is `RT_SWEEP=full node --test --test-name-pattern="door sweep" src/god/door-reach.test.ts`
 * (RT_TYPES=a,b / RT_STEP / RT_DISTS narrow it; RT_ROOMS=1 also lists unreachable rooms, reported but not asserted).
 */
test('door sweep: every catalogue building is enterable through its front door at any yaw and slope', { timeout: 3_600_000 }, async (t) => {
  const w = world(t); await w.settle(2);
  const KNOLL: Vec2 = [0, 0];
  w.act([{ op: 'place', def: coreRef('knoll'), name: 'hill', p: KNOLL, params: { height: 12, radius: 60, peak: 1, edge: 8 } }]);
  await w.settle(2);
  const full = process.env.RT_SWEEP === 'full' || !!process.env.RT_TYPES;
  const defs: string[] = process.env.RT_TYPES ? process.env.RT_TYPES.split(',').map((x) => x.includes('@') ? x : coreRef(x)) : BUILDING_TYPES;
  assert.equal(BUILDING_TYPES.length, 40, 'the catalogue has 40 building/1 types');
  const yaws = process.env.RT_STEP ? Array.from({ length: Math.ceil(360 / Number(process.env.RT_STEP)) }, (_, i) => i * Number(process.env.RT_STEP)) : YAWS;
  const dists = (process.env.RT_DISTS ?? '200,40,25').split(',').map(Number);
  const cases: [string, number, number][] = [];
  defs.forEach((def, i) => dists.forEach((dist, j) => { if (full) for (const deg of yaws) cases.push([def, dist, deg]); else cases.push([def, dist, YAWS[(i * 7 + j * 17 + 3) % YAWS.length]]); }));
  const fails: string[] = [], refused: string[] = [], roomFails: string[] = []; let n = 0;
  const table = new Map<string, { n: number; fail: number; refused: number }>();
  const row = (dist: number) => { const k = dist >= 100 ? 'flat' : `knoll d${dist}`; if (!table.has(k)) table.set(k, { n: 0, fail: 0, refused: 0 }); return table.get(k)!; };
  for (const [def, dist, deg] of cases) {
    const at: Vec2 = [KNOLL[0] + dist, KNOLL[1]];
    const slope = w.god.model.terrain.slope(at[0], at[1]);
    const r: any = w.god.act({ ops: [{ op: 'place', def, name: 'b', p: at, r: deg * Math.PI / 180 }] });
    if (!r.accepted) { refused.push(`${def} d${dist} ${deg}: refused ${r.failures?.[0]?.code ?? JSON.stringify(r).slice(0, 120)}`); row(dist).refused++; continue; }
    await w.settle(3);
    const e = w.god.model.get('b')!, box = w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape).box;
    const start: Vec2 = [at[0] + Math.hypot(box[0], box[2]) / 2 + 5, at[1]];
    const th = w.bridge.nav.thing('b'), goal = th ? w.bridge.nav.goal(th, start) : null;
    const reach = goal ? w.E.reachV1({ p: start, level: 0 }, goal) : null;
    n++; row(dist).n++;
    if (!reach?.ok) { fails.push(`${def} d${dist} s${slope.toFixed(2)} ${deg}: ${goal ? reach.code : 'no-goal'}`); row(dist).fail++; }
    else if (process.env.RT_ROOMS) {
      const rooms = (w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape) as any).rooms ?? [];
      const bad: string[] = [];
      for (const rm of rooms) { const t2 = w.bridge.nav.thing(`b/${rm.id}`), g2 = t2 ? w.bridge.nav.goal(t2, start) : null; const r2 = g2 ? w.E.reachV1({ p: start, level: 0 }, g2) : null; if (!r2?.ok) bad.push(`${rm.id}:${g2 ? r2.code : 'no-goal'}`); }
      if (bad.length) roomFails.push(`${def} d${dist} s${slope.toFixed(2)} ${deg}: ${bad.length}/${rooms.length} rooms ${bad.join(' ')}`);
    }
    w.act([{ op: 'remove', id: 'b' }]);
    await w.settle(1);
  }
  console.log(`door sweep (${full ? 'full' : 'gate subset'}): ${n} placements, ${fails.length} front-door failures, ${refused.length} refused placements`);
  for (const [k, v] of table) console.log(`  ${k}: ${v.n} placed, ${v.fail} failed, ${v.refused} refused`);
  for (const f of [...fails, ...refused]) console.log('  ' + f);
  if (process.env.RT_ROOMS) { console.log(`rooms: ${roomFails.length} placements with an unreachable room`); for (const f of roomFails) console.log('  ' + f); }
  assert.deepEqual(fails, [], 'every placed building is enterable through its front door');
  assert.ok(n >= cases.length * 0.9, `most placements are accepted (${n}/${cases.length})`);
});

/**
 * Steep-hill sweep (lane RT2, 2026-10-21): every catalogue building with its front door facing straight uphill, on a knoll
 * side as steep as the steepest real house site on walkable ground (eden-2026's packed hillside homes stand on ~0.52
 * rise/run; team/scratch/t4/rt2/slope.ts) and at the pad grade (0.45). The landing is cut into the hill and the bank
 * above it must stay walkable: a Soul uphill of the door and one downhill of the building both reach the goal inside.
 */
test('steep-hill sweep: every catalogue building is enterable with its front door facing uphill, up to the steepest real site', { timeout: 1_800_000 }, async (t) => {
  const w = world(t); await w.settle(2);
  w.act([{ op: 'place', def: coreRef('knoll'), name: 'hill', p: [0, 0], params: { height: 15, radius: 45, peak: 1, edge: 8 } }]);
  await w.settle(2);
  const terrain = w.god.model.terrain;
  const siteAt = (target: number) => {
    let best = 0, bs = Infinity;
    // the outer flank, so the slope above the door rises on to the summit
    for (let d = 20; d <= 60; d += 0.5) { const s = terrain.slope(d, 0); if (Math.abs(s - target) < Math.abs(bs - target)) { best = d; bs = s; } }
    assert.ok(Math.abs(bs - target) < 0.03, `the knoll has a ${target} site (best ${bs.toFixed(3)} at ${best} m)`);
    return best;
  };
  const sites = [0.45, 0.52].map((s) => [s, siteAt(s)] as const);
  const defs: string[] = process.env.RT_TYPES ? process.env.RT_TYPES.split(',').map((x) => x.includes('@') ? x : coreRef(x)) : BUILDING_TYPES;
  const fails: string[] = [], refused: string[] = []; let n = 0;
  for (const def of defs) for (const [slope, dist] of sites) {
    const at: Vec2 = [dist, 0];
    // the front door's yaw in the def frame (the first exterior ground-floor door, as padGrading lists them)
    const rd = w.god.model.resolvedDef(def)!, baked = w.god.model.bake(rd, {}, 0) as any;
    const door = (baked.openings ?? []).find((o: any) => o.exterior && o.kind !== 'window' && !o.level && o.to !== 'balcony');
    if (!door) { refused.push(`${def}: no exterior door`); continue; }
    const r = -Math.PI / 2 - door.yaw;   // world out = (sin(door.yaw + r), cos(door.yaw + r)) = (-1, 0): towards the summit
    const res: any = w.god.act({ ops: [{ op: 'place', def, name: 'b', p: at, r }] });
    if (!res.accepted) { refused.push(`${def} s${slope}: refused ${res.failures?.[0]?.code ?? JSON.stringify(res).slice(0, 120)}`); continue; }
    await w.settle(3);
    const e = w.god.model.get('b')!, box = w.god.model.bake(w.god.model.resolvedDef(e.def)!, e.params ?? {}, e.seed ?? 0, e.shape).box;
    const pad = w.god.model.ground().landforms.find((l: any) => l.id === `${e.id}:pad`) as any;
    const up = (pad?.aprons ?? []).some((a: Vec2[]) => (a[2][0] + a[3][0]) - (a[0][0] + a[1][0]) < -0.9 * 2 * Math.hypot(a[2][0] - a[1][0], a[2][1] - a[1][1]));
    assert.ok(up, `${def}: a door landing faces uphill`);
    const reach = Math.hypot(box[0], box[2]) / 2 + 5;
    const th = w.bridge.nav.thing('b');
    for (const [side, start] of [['uphill', [at[0] - reach, at[1]]], ['downhill', [at[0] + reach, at[1]]]] as const) {
      const goal = th ? w.bridge.nav.goal(th, start as Vec2) : null;
      const rr = goal ? w.E.reachV1({ p: start, level: 0 }, goal) : null;
      if (!rr?.ok) fails.push(`${def} s${slope} from ${side} (ground ${terrain.slope(start[0], start[1]).toFixed(2)}): ${goal ? rr.code : 'no-goal'}`);
    }
    n++;
    w.act([{ op: 'remove', id: 'b' }]);
    await w.settle(1);
  }
  console.log(`steep-hill sweep: ${n} placements (sites ${sites.map(([s, d]) => `${s}@${d}m`).join(', ')}), ${fails.length} failures, ${refused.length} refused`);
  for (const f of [...fails, ...refused]) console.log('  ' + f);
  assert.deepEqual(fails, [], 'every building is enterable with its front door facing uphill');
  assert.ok(n >= defs.length * 2 * 0.9, `most placements are accepted (${n}/${defs.length * 2})`);
});
