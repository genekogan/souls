// Coordinated-carry regressions (spec §11, §28 "Long load around corner",
// "Reservation conflict", "Graceful cancellation"). Geometry is re-checked
// here independently of the planner: exact OBB tests of the carried load
// against every wall, every tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { entityFootprint, Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { carryCorridors } from '../carry/scenes.ts';
import { entityFrame, formationFor, laidPose, REACH } from '../carry/formation.ts';
import { dcos, dsin, obbOverlap, rot2, sub2, type OBB2, type Vec2, hypot } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

const REG = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
function setup(base: SpatialScene, ...es: Entity[]) {
  const w = addAll(emptyWorld('carry-test', base), ...es);
  return new Runtime(w, REG, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
}
const upright19 = (id: string, x: number, z: number, th = 0) => {
  const pose = laidPose(formationFor('upright-19ft', 4), { x, z, th }, 0);
  return component(id, 'upright-19ft', pose.p, pose.yaw, { pose });
};
/** Distance from a point to an OBB (0 inside). */
function distObb(p: Vec2, o: OBB2) {
  const l = rot2(sub2(p, o.c), -o.yaw);
  const dx = Math.max(0, Math.abs(l[0]) - o.half[0]), dz = Math.max(0, Math.abs(l[1]) - o.half[1]);
  return hypot(dx, dz);
}

/** Independent per-tick audit: load vs walls (exact SAT), carriers vs walls, carriers at reach from the load edge. */
function audit(rt: Runtime, item: string, crew: string[]) {
  const walls = rt.services.spatial.base.obstacles.filter((o: any) => o.kind === 'wall');
  const s = { samples: 0, overlaps: [] as string[], carrierWall: 0, reachErr: 0, maxX: -Infinity, headings: [] as number[] };
  rt.observers.push({
    onTick() {
      const e = rt.world.entities[item];
      if (e.phase !== 'carried') return;
      s.samples++;
      const fp = entityFootprint(e).obb;
      for (const w of walls) if (obbOverlap(fp, w.obb)) s.overlaps.push(`${w.id}@${rt.tick}`);
      for (const c of crew) {
        const h = rt.world.entities[c];
        const p: Vec2 = [h.pose.p[0], h.pose.p[2]];
        for (const w of walls) s.carrierWall = Math.max(s.carrierWall, 0.28 - distObb(p, w.obb));
        if (h.human!.activity === 'carry') s.reachErr = Math.max(s.reachErr, Math.abs(distObb(p, fp) - REACH));
      }
    },
  });
  return s;
}

function cornerRun(extra: { holdCutV1?: true } = {}) {
  const rt = setup(carryCorridors(), component('b1', 'beam-12ft', [4, 0, 4], 0), human('p1', 2, 6.5), human('p2', 6, 1.5));
  const t0 = performance.now();
  const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 }, ...extra });
  const planMs = performance.now() - t0;
  return { rt, a, planMs };
}

test('carry: 2 people carry a 12 ft beam around the L corner of the 2.5 m corridor', () => {
  const { rt, a, planMs } = cornerRun();
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  console.log(`  12 ft beam / 2.5 m L corridor: plan+validate ${planMs.toFixed(0)} ms`);
  assert.ok(planMs < 2000, `planning took ${planMs} ms`);
  const s = audit(rt, 'b1', ['p1', 'p2']);
  assert.ok(rt.runUntilIdle(20 * 180));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  assert.ok(s.samples > 100, `audited ${s.samples} carried ticks`);
  assert.deepEqual(s.overlaps, [], 'load never overlaps a wall');
  assert.ok(s.carrierWall <= 0.03, `carrier body penetration ${s.carrierWall}`);
  assert.ok(s.reachErr <= 0.05, `carriers drifted from their grips by ${s.reachErr}`);
  const b = rt.world.entities.b1;
  assert.equal(b.phase, 'staged');
  assert.deepEqual(b.support, { kind: 'ground' });
  const fp = entityFootprint(b).obb;
  assert.ok(hypot(fp.c[0] - 18, fp.c[1] - 11) < 0.02, `set down at ${fp.c}`);
  assert.ok(Math.abs(dsin(fp.yaw - Math.PI / 2)) < 0.02 || Math.abs(dcos(fp.yaw)) < 0.02);
  for (const c of ['p1', 'p2']) {
    assert.equal(rt.world.entities[c].human!.activity, 'idle');
    assert.equal(rt.world.entities[c].human!.grip, undefined);
  }
  const phases = new Set(a.history.map((h) => h.phase));
  for (const ph of ['gather', 'lift', 'move', 'set-down', 'release']) assert.ok(phases.has(ph), `phase ${ph}`);
  assert.ok((a.outputs!.rotation as number) > 1.4, 'the formation actually turned the corner');
});

test('carry: 19 ft upright with 4 people cannot use the 1.5 m corridor, though the 4 people can walk it', () => {
  const crew = ['q1', 'q2', 'q3', 'q4'];
  const rt = setup(carryCorridors(), upright19('u1', 4, 22), human('q1', 1.5, 19.5), human('q2', 6.5, 19.5), human('q3', 1.5, 24.5), human('q4', 6.5, 24.5));
  const before = rt.stateHash();
  const a = rt.submit('carry', { crew, item: 'u1', to: { x: 18, z: 36, yaw: Math.PI / 2 } });
  assert.equal(a.status, 'failed');
  assert.ok(['carry.clearance', 'carry.no-route'].includes(a.diagnostic!.code), a.diagnostic!.code);
  assert.equal(a.diagnostic!.code, 'carry.clearance', 'humans fit individually → clearance');
  assert.match(a.diagnostic!.message, /19 ft upright/);
  assert.match(a.diagnostic!.message, /corridor B|yard B/);
  assert.equal(rt.stateHash(), before, 'rejected before anything moved');
  console.log(`  rejected: ${a.diagnostic!.message}`);
  // each person individually walks the same corridor to the target yard (one after another)
  const goals: [number, number][] = [[16, 34], [20, 34], [16, 38], [20, 38]];
  crew.forEach((c, i) => {
    const w = rt.submit('walk_to', { actor: c, x: goals[i][0], z: goals[i][1] });
    assert.equal(w.status, 'executing', w.diagnostic?.message);
    assert.ok(rt.runUntilIdle(20 * 120));
    assert.equal(w.status, 'completed', w.diagnostic?.message);
  });
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('carry: 19 ft upright goes straight down the 2.5 m corridor but cannot turn its corner', () => {
  const crew = ['q1', 'q2', 'q3', 'q4'];
  const rt = setup(carryCorridors(), upright19('u1', 4, 4), human('q1', 1, 1), human('q2', 7, 1), human('q3', 1, 7), human('q4', 7, 7));
  const straight = rt.submit('carry', { crew, item: 'u1', to: { x: 13, z: 4, yaw: 0 } });
  assert.equal(straight.status, 'executing', straight.diagnostic?.message);
  rt.cancel(straight.id);
  const rt2 = setup(carryCorridors(), upright19('u1', 4, 4), human('q1', 1, 1), human('q2', 7, 1), human('q3', 1, 7), human('q4', 7, 7));
  const turn = rt2.submit('carry', { crew, item: 'u1', to: { x: 18, z: 11, yaw: Math.PI / 2 } });
  assert.equal(turn.status, 'failed');
  assert.equal(turn.diagnostic!.code, 'carry.clearance');
  assert.match(turn.diagnostic!.message, /corridor A/);
  console.log(`  rejected: ${turn.diagnostic!.message}`);
});

test('carry: crew too small / too large for the load is rejected with the reason', () => {
  const rt = setup(provingGround(), upright19('u3', 0, 0), component('b1', 'beam-12ft', [0, 0, 5], 0), human('p1', -1, -1.5), human('p2', 1, -1.5), human('p3', 0, 3));
  const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'u3', to: { x: 5, z: -3, yaw: 0 } });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic!.code, 'carry.crew-too-small');
  assert.match(a.diagnostic!.message, /19 ft upright \(61 kg, 5\.8 m\) needs at least 3 carriers.*2 assigned/);
  const b = rt.submit('carry', { crew: ['p1', 'p2', 'p3'], item: 'b1', to: { x: 5, z: 5, yaw: 0 } });
  assert.equal(b.diagnostic?.code, 'carry.crew-too-large');
  const c = rt.submit('carry', { crew: ['p1'], item: 'b1', to: { x: 5, z: 5, yaw: 0 } });
  assert.equal(c.diagnostic?.code, 'carry.crew-too-small');
  const d = rt.submit('carry', { crew: ['p1', 'p1'], item: 'b1', to: { x: 5, z: 5, yaw: 0 } });
  assert.equal(d.diagnostic?.code, 'action.invalid-params');
});

test('carry: a second carry using a busy person fails with reservation.conflict', () => {
  const rt = setup(provingGround(), component('b1', 'beam-12ft', [0, 0, 0], 0), component('b2', 'beam-12ft', [0, 0, 6], 0), human('p1', -1.5, -1), human('p2', 1.5, 1), human('p3', 0, 8));
  const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 6, z: -4, yaw: 0 } });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const b = rt.submit('carry', { crew: ['p2', 'p3'], item: 'b2', to: { x: 6, z: 3, yaw: 0 } });
  assert.equal(b.status, 'failed');
  assert.equal(b.diagnostic!.code, 'reservation.conflict');
  assert.match(b.diagnostic!.message, /actor:p2/);
  const c = rt.submit('walk_to', { actor: 'p1', x: 3, z: 3 });
  assert.equal(c.diagnostic?.code, 'reservation.conflict');
  assert.ok(rt.runUntilIdle(20 * 120));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

/** Corridor A with a stack of 2x4s lying across the route: the carried beam passes over it, but cannot be laid on it. */
function stackRun() {
  const rt = setup(
    carryCorridors(),
    component('b1', 'beam-12ft', [4, 0, 4], 0),
    component('stack', '2x4-8ft', [12, 0, 4], 0, { label: 'stack of 2x4s' }),
    human('p1', 2, 6.5),
    human('p2', 6, 1.5),
  );
  const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 } });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  return { rt, a };
}
const centre = (rt: Runtime) => entityFootprint(rt.world.entities.b1).obb.c;
function stepUntil(rt: Runtime, pred: () => boolean, max = 20 * 120) {
  for (let i = 0; i < max && !pred(); i++) rt.step();
  assert.ok(pred(), 'condition reached');
}

test('carry: cancel mid-move performs a controlled set-down where the ground is clear', () => {
  const { rt, a } = stackRun();
  const s = audit(rt, 'b1', ['p1', 'p2']);
  stepUntil(rt, () => a.phase === 'move' && centre(rt)[0] > 7.5);
  const y0 = rt.world.entities.b1.pose.p[1];
  assert.ok(y0 > 0.5, 'load is up in the air');
  const r = rt.cancel(a.id);
  assert.notEqual(r.status, 'cancelled', 'not dropped instantly: set-down takes time');
  const heights: number[] = [];
  rt.observers.push({ onTick: () => heights.push(rt.world.entities.b1.pose.p[1]) });
  assert.ok(rt.runUntilIdle(20 * 10));
  assert.equal(a.status, 'cancelled');
  const b = rt.world.entities.b1;
  assert.deepEqual(b.support, { kind: 'ground' });
  assert.equal(b.phase, 'staged');
  assert.ok(Math.abs(entityFrame(b).bottom) < 1e-6, 'resting on the ground');
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i - 1] - heights[i] < 0.06, 'lowered gradually, never dropped');
  assert.ok(Math.abs(centre(rt)[0] - 7.5) < 0.2, 'set down where it was cancelled');
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  assert.deepEqual(s.overlaps, []);
  for (const c of ['p1', 'p2']) assert.equal(rt.world.entities[c].human!.grip, undefined);
});

test('carry: cancel over an obstruction is refused (carry.cancel-unsafe) and the carry continues', () => {
  const { rt, a } = stackRun();
  stepUntil(rt, () => a.phase === 'move' && centre(rt)[0] > 12);
  const r = rt.cancel(a.id);
  assert.equal(r.status, 'executing');
  assert.equal(r.diagnostic?.code, 'carry.cancel-unsafe');
  assert.match(r.diagnostic!.message, /stack of 2x4s/);
  assert.equal(rt.world.entities.b1.phase, 'carried');
  assert.ok(rt.runUntilIdle(20 * 120));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('carry: cancel during gather releases the crew immediately; target on an obstruction is rejected', () => {
  const { rt, a } = stackRun();
  rt.step();
  rt.cancel(a.id);
  assert.equal(a.status, 'cancelled');
  assert.equal(rt.world.entities.b1.reservedBy, undefined);
  assert.equal(rt.world.entities.p1.human!.task, undefined);
  const b = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 12, z: 4, yaw: 0 } });
  assert.equal(b.diagnostic?.code, 'carry.target-blocked');
  assert.match(b.diagnostic!.message, /stack of 2x4s/);
});

test('carry: a construction cut with no other way holds the load; the cut is searched once per scene change (PC07, holdCutV1)', () => {
  const { rt, a } = cornerRun({ holdCutV1: true });
  const s = audit(rt, 'b1', ['p1', 'p2']);
  stepUntil(rt, () => a.phase === 'move' && centre(rt)[0] > 5);
  // three wall blocks across corridor A's east arm, ahead of the load: the only way to the target is cut
  for (const [i, z] of [3, 4, 5].entries()) rt.world.entities[`cut${i}`] = component(`cut${i}`, 'test-wall', [12, 0, z], 0, { phase: 'staged', label: 'cut block' });
  stepUntil(rt, () => a.status === 'blocked', 40);
  const d1 = a.diagnostic!;
  assert.equal(d1.code, 'carry.route-blocked');
  assert.match(d1.message, /blocked near \([\d.]+, [\d.]+\) by 'cut block' and no alternative exists/, d1.message);
  assert.equal(d1.details?.cutLabel, 'cut block', 'the obstacle at the cut pose is named');
  assert.equal(d1.details?.exhausted, false, 'a small search: proven');
  assert.ok((d1.details?.expanded as number) <= (d1.details?.budget as number));
  const held = centre(rt);
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(a.status, 'blocked');
  assert.equal(a.diagnostic, d1, 'the same scene: held on the answer already found, without searching again');
  // an unrelated edit elsewhere changes the scene: the cut is searched once more, then held on that answer
  rt.world.entities.far = component('far', 'test-wall', [2, 0, 20], 0, { phase: 'staged' });
  rt.step();
  const d2 = a.diagnostic!;
  assert.notEqual(d2, d1, 'a new scene epoch: rechecked');
  assert.equal(d2.code, 'carry.route-blocked');
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(a.diagnostic, d2, 'held on the new answer');
  assert.equal(rt.world.entities.b1.phase, 'carried', 'the load stays held');
  assert.ok(hypot(centre(rt)[0] - held[0], centre(rt)[1] - held[1]) < 1e-6, 'held where it was');
  // the cut cleared: the carry rechecks the changed scene and completes
  for (const i of [0, 1, 2]) delete rt.world.entities[`cut${i}`];
  assert.ok(rt.runUntilIdle(20 * 180));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  assert.deepEqual(s.overlaps, [], 'load never overlaps a wall');
});

test('carry: without holdCutV1 a cut is reported as before PC07 (no named cut, no details, searched every tick)', () => {
  const { rt, a } = cornerRun();
  stepUntil(rt, () => a.phase === 'move' && centre(rt)[0] > 5);
  for (const [i, z] of [3, 4, 5].entries()) rt.world.entities[`cut${i}`] = component(`cut${i}`, 'test-wall', [12, 0, z], 0, { phase: 'staged', label: 'cut block' });
  stepUntil(rt, () => a.status === 'blocked', 40);
  const d1 = a.diagnostic!;
  assert.equal(d1.code, 'carry.route-blocked');
  assert.match(d1.message, /^the carry route of b1 is now blocked near \([\d.]+, [\d.]+\) and no alternative exists: /, d1.message);
  assert.equal(d1.details, undefined, 'no PC07 details');
  rt.step(); rt.step();
  assert.notEqual(a.diagnostic, d1, 'searched again on the next tick, as before');
  assert.equal(a.status, 'blocked');
  for (const i of [0, 1, 2]) delete rt.world.entities[`cut${i}`];
  assert.ok(rt.runUntilIdle(20 * 180));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
});

test('carry: determinism — same inputs give the same final state hash', () => {
  const run = () => {
    const { rt, a } = cornerRun();
    rt.runUntilIdle(20 * 180);
    assert.equal(a.status, 'completed');
    return rt.stateHash();
  };
  assert.equal(run(), run());
});

test('carry invariant: detects grip drift, a load inside a wall, and a wrong holder', () => {
  const { rt, a } = cornerRun();
  stepUntil(rt, () => a.phase === 'move' && centre(rt)[0] > 10);
  assert.deepEqual(rt.violations, []);
  const inv = CARRY_INVARIANTS[0];
  const p1 = rt.world.entities.p1;
  p1.pose.p[0] += 0.2;
  assert.deepEqual(inv(rt).map((d) => d.code), ['carry.grip-drift']);
  p1.pose.p[0] -= 0.2;
  const b = rt.world.entities.b1;
  const saved = structuredClone(b.pose);
  b.pose.p[2] += 1.2; // shove the load sideways into the corridor wall
  assert.ok(inv(rt).some((d) => d.code === 'carry.load-static'));
  b.pose = saved;
  b.support = { kind: 'held', by: ['p1'] };
  assert.deepEqual(inv(rt).map((d) => d.code), ['carry.support']);
});

test('carry past walkers stopping beside / on its path: 0 human-human violations over 42 stop positions, everyone arrives', () => {
  // A 2-person 12 ft beam carry on open ground (proving ground, (-7,-4) → (9,-4), carriers 0.4 m either
  // side of the centreline). A walker w walks from 3–4 m away to a stop point beside or on the route,
  // released at different times so it arrives before, during or just ahead of the formation. Before
  // the fix: walkers stopped 0.46 m from a braking carrier (they saw only the carriers' current bodies),
  // and a walker whose goal lay on the route deadlocked with the crew (each waiting for the other).
  const layouts: { stop: Vec2; start: Vec2; delay: number }[] = [
    { stop: [-4, -3.4], start: [-7, -0.4], delay: 120 }, // regressions found by the sweep
    { stop: [1, -3.25], start: [-2, -0.25], delay: 240 },
  ];
  const lats = [-1.1, -0.9, -0.75, -0.6, 0.6, 0.75, 0.9, 1.1];
  const xs = [-4, -2, 0, 2, 4];
  let k = 0;
  for (const x of xs) for (const lat of lats) {
    const side = k % 2 ? 1 : -1;
    layouts.push({ stop: [x, -4 + lat], start: [x + 3 * side, -4 + lat + 3 * Math.sign(lat)], delay: [60, 120, 180, 240][k % 4] });
    k++;
  }
  assert.ok(layouts.length >= 40);
  const bad: string[] = [];
  for (const { stop, start, delay } of layouts) {
    const base = provingGround();
    const rt = setup(base, component('b1', 'beam-12ft', [-7, 0, -4], 0), human('p1', -9, -2), human('p2', -5, -6.5), human('w', start[0], start[1]));
    const c = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 9, z: -4, yaw: 0 } });
    assert.equal(c.status, 'executing', c.diagnostic?.message);
    for (let t = 0; t < delay; t++) rt.step();
    const w = rt.submit('walk_to', { actor: 'w', x: stop[0], z: stop[1] });
    rt.runUntilIdle(20 * 150);
    const tag = `stop (${stop}) from (${start}) at tick ${delay}`;
    if (rt.violations.length) bad.push(`${tag}: ${rt.violations[0].message}`);
    if ((c.status as string) !== 'completed') bad.push(`${tag}: carry ${c.status} ${c.diagnostic?.message ?? ''}`);
    // w's own walk arrives at its stop point (an idle w may afterwards be asked to make way: also completed)
    if (w.status !== 'completed' || w.outputs?.snapped !== 0) bad.push(`${tag}: walk ${w.status} ${w.diagnostic?.message ?? ''}`);
    for (const r of rt.records.values()) if (r.verb === 'walk_to' && r.status !== 'completed') bad.push(`${tag}: ${r.id} ${r.status}`);
  }
  assert.deepEqual(bad, []);
});
