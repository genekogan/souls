// PC13 (#692): raise_hold_v1 on the bare runtime: raise, hold, lower, cancel in every phase, refusals before motion, and a
// snapshot in every phase. The native raise's own regression (mars/viewer/engine/test/raise-cancel.test.ts) stays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, DT } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { Spatial, entityCorners } from '../../../mars/viewer/engine/spatial/service.ts';
import { emptyWorld, human, addAll } from '../../../mars/viewer/engine/world/factory.ts';
import { walkTo } from '../../../mars/viewer/engine/locomotion/walk.ts';
import { CATALOG } from '../../../mars/viewer/engine/world/catalog.ts';
import type { ActionRecord } from '../../../mars/viewer/engine/actions/types.ts';
import { raiseHold, looseFramesHeld } from './raise-hold.ts';

const L = 3.6576, T = 0.08, W = 1.0668;
CATALOG['test-loose-upright'] = { id: 'test-loose-upright', label: 'loose upright', category: 'item', size: [L, T, W], massKg: 38,
  handling: { carryCrew: [2, 4], carryPose: 'flat', carryHeight: 0.8, grips: { 0: [-1, 1].map((s) => ({ id: s > 0 ? 'column-pos' : 'column-neg', local: [0, T / 2, s * W / 2], span: [L, 0, 0] })) } } } as never;
const base = { bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] } as never;
function fixture(count = 2, yaw = 0.4, obstacles: unknown[] = []) {
  const crew = Array.from({ length: count }, (_, i) => `p${i + 1}`), scene = obstacles.length ? { ...(base as object), obstacles } as never : base;
  const frame = { id: 'frame', kind: 'item', def: 'test-loose-upright', pose: { p: [1, 0, 2], yaw }, support: { kind: 'ground' }, phase: 'staged' };
  const world = addAll(emptyWorld('raise-hold', scene), frame as never, ...crew.map((c, i) => human(c, -3 + i, -3 - i * 0.2)));
  const rt = new Runtime(world, new Map([[walkTo.verb, walkTo as never], [raiseHold.verb, raiseHold as never]]), { spatial: new Spatial(scene) }, [...DEFAULT_INVARIANTS, looseFramesHeld as never]);
  return { rt, crew, start: structuredClone(frame.pose) };
}
const runTo = (rt: Runtime, r: ActionRecord, phase: string, extra = 4) => {
  for (let i = 0; i < 4000 && r.phase !== phase && rt.isActive(r.id); i++) rt.step();
  assert.equal(r.phase, phase, JSON.stringify([r.status, r.diagnostic, rt.world.entities.frame!.pose, rt.tick, rt.violations])); for (let i = 0; i < extra; i++) rt.step();
};
const top = (rt: Runtime) => Math.max(...entityCorners(rt.world.entities.frame!).map((c) => c[1]));
const clean = (rt: Runtime) => assert.deepEqual(rt.violations ?? [], [], 'no invariant fired');

for (const count of [2, 3, 4]) test(`a crew of ${count} raises it to the standing pose, holds it, and lowers it to exactly where it lay`, () => {
  const { rt, crew, start } = fixture(count), f = rt.world.entities.frame!;
  const r = rt.submit('raise_hold_v1', { crew, item: 'frame' }); assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  runTo(rt, r, 'hold', 200);
  assert.equal(rt.isActive(r.id), true, 'holding is not an end'); assert.deepEqual(f.support, { kind: 'held', by: crew });
  assert.ok(Math.abs(Math.abs(f.pose.roll!) - Math.PI / 2) < 1e-9, `standing: roll ${f.pose.roll}`); assert.ok(Math.abs(f.pose.p[1] - L / 2) < 1e-9);
  assert.ok(Math.abs(top(rt) - L) < 1e-6, `its top is ${L} m up`); assert.equal(Math.min(...entityCorners(f).map((c) => c[1])) > -1e-6, true, 'nothing below the ground');
  for (const c of crew) assert.match(rt.world.entities[c]!.human!.grip!.slot, /^column-/);
  rt.cancel(r.id); assert.equal(r.diagnostic, undefined); assert.equal(rt.isActive(r.id), true, 'the cancel is the lowering, not a release');
  rt.runUntilIdle(4000, [r.id]);
  assert.equal(r.status, 'cancelled');
  assert.deepEqual(f.pose, start); assert.deepEqual(f.support, { kind: 'ground' }); assert.equal(f.phase, 'staged'); assert.equal(f.reservedBy, undefined);
  for (const c of crew) {const h = rt.world.entities[c]!.human!; assert.equal(h.grip, undefined); assert.equal(h.task, undefined);}
  clean(rt);
});

test('a stop in every phase ends with it lying where it was, and never moves it faster than the crew can walk', () => {
  for (const phase of ['approach', 'grip', 'raise', 'step', 'set']) {
    const { rt, crew, start } = fixture(4), f = rt.world.entities.frame!;
    const r = rt.submit('raise_hold_v1', { crew, item: 'frame' }); runTo(rt, r, phase, 6);
    let last = structuredClone(f.pose.p), fastest = 0;
    rt.cancel(r.id); assert.equal(r.diagnostic, undefined, phase);
    for (let i = 0; i < 4000 && rt.isActive(r.id); i++) {rt.step(); fastest = Math.max(fastest, Math.hypot(f.pose.p[0] - last[0], f.pose.p[1] - last[1], f.pose.p[2] - last[2]) / DT); last = structuredClone(f.pose.p);}
    assert.deepEqual(f.pose, start, phase); assert.deepEqual(f.support, { kind: 'ground' }, phase); assert.ok(fastest < 3, `${phase}: ${fastest} m/s`); clean(rt);
  }
});

test('refusals before anything moves', () => {
  const few = fixture(1), one = few.rt.submit('raise_hold_v1', { crew: few.crew, item: 'frame' }); assert.equal(one.diagnostic?.code, 'raise.crew-too-small');
  const low = fixture(2, 0.4, [{ id: 'roof', label: 'a low roof', level: 0, y0: 2.2, y1: 2.5, obb: { c: [1, 2], half: [3, 3], yaw: 0 } }]), r = low.rt.submit('raise_hold_v1', { crew: low.crew, item: 'frame' });
  assert.equal(r.diagnostic?.code, 'raise.arc-blocked', JSON.stringify(r.diagnostic)); assert.deepEqual(low.rt.world.entities.frame!.pose, low.start);
  const up = fixture(2); up.rt.world.entities.frame!.pose.roll = Math.PI / 2; assert.equal(up.rt.submit('raise_hold_v1', { crew: up.crew, item: 'frame' }).diagnostic?.code, 'raise.not-lying');
  const twice = fixture(2), a = twice.rt.submit('raise_hold_v1', { crew: twice.crew, item: 'frame' }); assert.notEqual(a.status, 'failed');
  assert.ok(['reservation.conflict', 'raise.not-lying'].includes(twice.rt.submit('raise_hold_v1', { crew: twice.crew, item: 'frame' }).diagnostic?.code ?? ''), 'a second raise on a reserved part is refused');
});

test('what stands in the way of lowering keeps it held and is named, and it comes down once clear', () => {
  const { rt, crew, start } = fixture(2), f = rt.world.entities.frame!, r = rt.submit('raise_hold_v1', { crew, item: 'frame' }); runTo(rt, r, 'hold');
  const by = human('by', start.p[0], start.p[2]); rt.world.entities.by = by as never;   // someone walked under it
  rt.cancel(r.id); const refused = r.diagnostic as { code: string; message: string } | undefined; assert.equal(refused?.code, 'raise.cancel-unsafe'); assert.match(refused!.message, /by/);
  for (let i = 0; i < 100; i++) rt.step();
  assert.ok(Math.abs(Math.abs(f.pose.roll!) - Math.PI / 2) < 1e-9, 'still standing'); assert.deepEqual(f.support, { kind: 'held', by: crew });
  delete rt.world.entities.by;
  rt.cancel(r.id); assert.equal(rt.isActive(r.id), true); rt.runUntilIdle(4000, [r.id]); assert.deepEqual(f.pose, start);
});

test('a saved world resumes in every phase, to the same state as one never saved', () => {
  for (const phase of ['approach', 'grip', 'raise', 'step', 'set', 'hold']) {
    const a = fixture(4), ra = a.rt.submit('raise_hold_v1', { crew: a.crew, item: 'frame' }); runTo(a.rt, ra, phase, 3);
    const snap = a.rt.snapshot(), b = Runtime.restore(structuredClone(snap), a.rt.registry, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, looseFramesHeld as never]);
    assert.deepEqual(snap.dropped ?? [], [], `${phase}: nothing dropped`);
    for (const rt of [a.rt, b]) {for (let i = 0; i < 40; i++) rt.step();}
    assert.equal(b.stateHash(), a.rt.stateHash(), `${phase}: same state`);
    for (const rt of [a.rt, b]) {rt.cancel(ra.id); rt.runUntilIdle(4000, [ra.id]);}
    assert.equal(b.stateHash(), a.rt.stateHash(), `${phase}: same after lowering`);
  }
});

test('the invariant notices a frame left standing unheld', () => {
  const { rt, crew } = fixture(2), r = rt.submit('raise_hold_v1', { crew, item: 'frame' }); runTo(rt, r, 'hold');
  assert.deepEqual(looseFramesHeld(rt), []);
  rt.world.entities.frame!.support = { kind: 'ground' };
  assert.equal(looseFramesHeld(rt)[0]?.code, 'raise.frame-unheld');
});

test('PC17: a named base decides which end stands, whichever end the crew is at', () => {
  const near = fixture(2), f = near.rt.world.entities.frame!, L = 3.6576, t: [number, number] = [Math.cos(f.pose.yaw), Math.sin(f.pose.yaw)];
  const ends = ([1, -1] as const).map((s) => [f.pose.p[0] - t[0] * s * L / 2, f.pose.p[2] - t[1] * s * L / 2] as [number, number]);
  for (const [i, base] of ends.entries()) {
    const { rt, crew } = fixture(2), r = rt.submit('raise_hold_v1', { crew, item: 'frame', baseV1: base }); assert.notEqual(r.status, 'failed', r.diagnostic?.message);
    runTo(rt, r, 'hold'); const u = rt.world.entities.frame!;
    assert.ok(Math.hypot(u.pose.p[0] - base[0], u.pose.p[2] - base[1]) < 0.2, `end ${i} stands at ${base}: ${u.pose.p}`);
  }
});
