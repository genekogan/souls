// PC14 (#693): connect_beam_v1 on the bare runtime. Two loose uprights raised and held by their crews (PC13), beams
// seated between them through PC12's connectors, support released only once the frame stands on its own, a stop in
// every phase, refusals before motion, and a snapshot in every phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { emptyWorld, human, addAll } from '../../../mars/viewer/engine/world/factory.ts';
import { walkTo } from '../../../mars/viewer/engine/locomotion/walk.ts';
import { CATALOG } from '../../../mars/viewer/engine/world/catalog.ts';
import type { ActionRecord } from '../../../mars/viewer/engine/actions/types.ts';
import { raiseHold, looseFramesHeld } from './raise-hold.ts';
import { beamBays, connectBeamV1, frameStability, framesStand, worldPoint } from './beam-connect.ts';

// the library's loose 12 ft upright and 9 ft beam with PC12's connectors (core-kit/authoring/work.mjs), as test defs
const IN = 0.0254, L = 3.6576, T = 0.0762, W = 1.2192, COL = 3 * IN, BL = 2.7432, BH = 0.1016;
const seats: { id: string; kind: string; local: [number, number, number] }[] = [];
for (const [face, y] of [['front', T], ['back', 0]] as const) for (const [side, z] of [['l', -(W / 2 - COL / 2)], ['r', W / 2 - COL / 2]] as const)
  for (let i = 0; 12 * IN + 6 * IN * i < L - 3 * IN; i++) seats.push({ id: `${face}-${side}-${i}`, kind: 'beam-seat', local: [-L / 2 + 12 * IN + 6 * IN * i, y, z] });
CATALOG['test-pc14-upright'] = { id: 'test-pc14-upright', label: 'loose upright', category: 'item', size: [L, T, W], massKg: 38, sockets: seats,
  handling: { carryCrew: [2, 4], carryPose: 'flat', carryHeight: 0.8, grips: { 0: [-1, 1].map((s) => ({ id: s > 0 ? 'column-pos' : 'column-neg', local: [0, T / 2, s * W / 2], span: [L, 0, 0] })) } } } as never;
CATALOG['test-pc14-beam'] = { id: 'test-pc14-beam', label: 'rack beam', category: 'item', size: [BL, BH, 0.0508], massKg: 19,
  sockets: [-1, 1].map((s) => ({ id: s < 0 ? 'end-l' : 'end-r', kind: 'beam-end', local: [s * BL / 2, BH / 2, 0] })),
  handling: { carryCrew: [1, 2], carryPose: 'edge', carryHeight: 0.85, grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-1.097, 0, 0] }, { id: 'g1', local: [1.097, 0, 0] }] } } } as never;

const base = { bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] } as never;
const invariants = [...DEFAULT_INVARIANTS, looseFramesHeld as never, framesStand as never];
/** The bay: a lies toward −x with its base at x = 0, b toward +x with its base at x = D, so that standing, their front faces
 *  are a beam's span apart. Beams lie in the bay, two under each column. */
const D = BL + 2 * T;
function fixture(beams = 4) {
  const lying = (id: string, x: number) => ({ id, kind: 'item', def: 'test-pc14-upright', pose: { p: [x, 0, 0], yaw: 0 }, support: { kind: 'ground' }, phase: 'staged' });
  const beam = (id: string, z: number) => ({ id, kind: 'item', def: 'test-pc14-beam', pose: { p: [D / 2, 0, z], yaw: 0 }, support: { kind: 'ground' }, phase: 'staged' });
  const zs = [-0.42, 0.42, -0.2, 0.2].slice(0, beams);
  const people = [human('a1', 0.6, -1.6), human('a2', 0.6, 1.6), human('b1', D - 0.6, -1.6), human('b2', D - 0.6, 1.6), human('i1', D / 2 - 0.4, -2.6), human('i2', D / 2 + 0.4, -2.6)];
  const world = addAll(emptyWorld('beam-connect', base), lying('A', -L / 2) as never, lying('B', D + L / 2) as never, ...zs.map((z, i) => beam(`beam${i + 1}`, z) as never), ...people);
  const rt = new Runtime(world, new Map([[walkTo.verb, walkTo as never], [raiseHold.verb, raiseHold as never], [connectBeamV1.verb, connectBeamV1 as never]]), { spatial: new Spatial(base) }, invariants);
  return { rt };
}
const runTo = (rt: Runtime, r: ActionRecord, phase: string, extra = 4) => {
  for (let i = 0; i < 6000 && r.phase !== phase && rt.isActive(r.id); i++) rt.step();
  assert.equal(r.phase, phase, JSON.stringify([r.status, r.diagnostic, rt.tick, rt.violations])); for (let i = 0; i < extra; i++) rt.step();
};
const clean = (rt: Runtime) => assert.deepEqual(rt.violations ?? [], [], 'no invariant fired');
/** Both frames raised and held. */
function raised(beams = 4) {
  const { rt } = fixture(beams);
  const ra = rt.submit('raise_hold_v1', { crew: ['a1', 'a2'], item: 'A' }), rb = rt.submit('raise_hold_v1', { crew: ['b1', 'b2'], item: 'B' });
  for (const r of [ra, rb]) assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  runTo(rt, ra, 'hold', 0); runTo(rt, rb, 'hold', 4);
  return { rt, ra, rb };
}
const bay = (rt: Runtime, beam: string, column: 'l' | 'r', height: number) => {
  const all = beamBays(rt.world, beam), b = all.find((x) => x.column === column && Math.abs(x.height - height) < 0.05);
  assert.ok(b, `${beam}: no ${column} seat at ${height} m among ${JSON.stringify(all.map((x) => [x.column, x.height]))}`);
  return b!;
};
function seat(rt: Runtime, beam: string, column: 'l' | 'r', height: number) {
  const b = bay(rt, beam, column, height), r = rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam, a: b.a, b: b.b, seats: b.seats });
  assert.notEqual(r.status, 'failed', JSON.stringify(r.diagnostic));
  rt.runUntilIdle(6000, [r.id]); assert.equal(r.status, 'completed', JSON.stringify([r.diagnostic, r.phase]));
  return { r, b };
}

test('two held frames take a beam at a seat height both have; its ends join both seats, both halves', () => {
  const { rt } = raised(1), w = rt.world;
  const bays = beamBays(w, 'beam1');
  assert.ok(bays.length >= 2 * 10, `seat pairs within reach on both columns: ${bays.length}`);
  assert.ok(bays.every((b) => b.height <= 2.07), 'none above standing reach');
  const { b } = seat(rt, 'beam1', 'l', 0.76), beam = w.entities.beam1!;
  assert.equal(beam.phase, 'installed'); assert.deepEqual(beam.support, { kind: 'connected', to: ['A', 'B'] });
  for (const [u, s] of [[w.entities.A!, b.seats[0]], [w.entities.B!, b.seats[1]]] as const) {
    const c = beam.connections!.find((x) => x.to === u.id)!;
    assert.equal(c.toSocket, s); assert.deepEqual(u.connections, [{ socket: s, to: 'beam1', toSocket: c.socket }]);
    // the beam's end is where the seat is
    const end = worldPoint(beam, (CATALOG['test-pc14-beam']!.sockets!.find((x) => x.id === c.socket)!.local)), at = worldPoint(u, CATALOG['test-pc14-upright']!.sockets!.find((x) => x.id === s)!.local);
    assert.ok(Math.hypot(end[0] - at[0], end[1] - at[1], end[2] - at[2]) < 1e-6, `${c.socket} meets ${s}`);
  }
  for (const c of ['i1', 'i2']) assert.equal(w.entities[c]!.human!.grip, undefined);
  assert.deepEqual(w.entities.A!.support, { kind: 'held', by: ['a1', 'a2'] }, 'its crew still holds it');
  clean(rt);
});

test('support is released only once the frame stands on its own; until then the stop is refused and the crew holds', () => {
  const { rt, ra, rb } = raised(4), w = rt.world;
  seat(rt, 'beam1', 'l', 0.76);
  rt.cancel(ra.id);
  assert.equal(ra.diagnostic?.code, 'support.release-premature'); assert.match(ra.diagnostic!.message, /needs beams on its r column at 2 heights \(has 0\)/);
  assert.equal(rt.isActive(ra.id), true); assert.deepEqual(w.entities.A!.support, { kind: 'held', by: ['a1', 'a2'] });
  const before = structuredClone(w.entities.A!.pose); for (let i = 0; i < 50; i++) rt.step(); assert.deepEqual(w.entities.A!.pose, before, 'a joined frame is never lowered');
  seat(rt, 'beam2', 'r', 0.76); seat(rt, 'beam3', 'l', 1.37);
  assert.equal(frameStability(w, w.entities.A!).stable, false);
  rt.cancel(ra.id); assert.equal(ra.diagnostic?.code, 'support.release-premature');
  seat(rt, 'beam4', 'r', 1.37);
  // b is still held by its crew: it carries itself, so a is judged on its own beams, and they are enough
  assert.deepEqual(frameStability(w, w.entities.A!), { stable: true, group: ['A', 'B'], missing: [] });
  rt.cancel(ra.id); assert.equal(ra.status, 'cancelled', JSON.stringify(ra.diagnostic));
  assert.deepEqual(w.entities.A!.support, { kind: 'ground' }); assert.equal(w.entities.A!.phase, 'installed');
  assert.ok(Math.abs(Math.abs(w.entities.A!.pose.roll!) - Math.PI / 2) < 1e-9, 'standing where it was held');
  for (const c of ['a1', 'a2']) assert.equal(w.entities[c]!.human!.grip, undefined);
  rt.cancel(rb.id); assert.equal(rb.status, 'cancelled', JSON.stringify(rb.diagnostic));
  for (let i = 0; i < 20; i++) rt.step();
  clean(rt);
});

test('refusals before anything moves', () => {
  const { rt } = raised(2), w = rt.world, b = bay(rt, 'beam1', 'l', 0.76), go = (p: object) => rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam: 'beam1', a: b.a, b: b.b, seats: b.seats, ...p });
  const start = structuredClone(w.entities.beam1!.pose), code = (p: object) => go(p).diagnostic?.code;
  assert.equal(code({ crew: ['i1'] }), 'beam.crew');
  assert.equal(code({ crew: ['a1', 'i1'] }), 'actor.holding', 'a hand on an upright is not free for the beam');
  assert.equal(code({ seats: [b.seats[0], b.seats[0].replace(/-\d+$/, '-0')] }), 'beam.misaligned');
  assert.equal(code({ seats: [b.seats[0], b.seats[1].replace('front', 'back')] }), 'beam.misaligned', 'the face away from the bay');
  assert.equal(code({ seats: ['front-l-3', 'front-l-17'] }), 'reach.too-high', 'a seat pair both frames have, at 2.9 m');
  assert.ok(!beamBays(w, 'beam1').some((x) => x.height > 2.07), 'and it is not offered');
  // the beam not staged under the bay
  w.entities.beam2!.pose = { p: [D / 2, 0, 3], yaw: 0 };
  assert.equal(rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam: 'beam2', a: b.a, b: b.b, seats: b.seats }).diagnostic?.code, 'beam.not-staged');
  // a frame nobody holds is not supported
  const solo = fixture(1);
  solo.rt.world.entities.A!.pose = { p: [0, L / 2, 0], yaw: 0, roll: -Math.PI / 2 }; solo.rt.world.entities.B!.pose = { p: [D, L / 2, 0], yaw: 0, roll: Math.PI / 2 };
  assert.equal(beamBays(solo.rt.world, 'beam1').length, 0, 'nothing is offered between frames nobody holds');
  assert.equal(solo.rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam: 'beam1', a: 'A', b: 'B', seats: b.seats }).diagnostic?.code, 'beam.upright-unsupported');
  assert.deepEqual(w.entities.beam1!.pose, start, 'nothing moved');
  // a seat already taken
  seat(rt, 'beam1', 'l', 0.76);
  w.entities.beam2!.pose = { p: [D / 2, 0, 0.42], yaw: 0 };
  assert.equal(rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam: 'beam2', a: b.a, b: b.b, seats: b.seats }).diagnostic?.code, 'beam.seat-taken');
  assert.ok(!beamBays(w, 'beam2').some((x) => x.seats[0] === b.seats[0]), 'a taken seat is not offered');
  clean(rt);
});

test('a stop before the lift lets go where it lies; during the lift it comes back down to exactly where it lay', () => {
  for (const phase of ['approach', 'lift']) {
    const { rt } = raised(1), w = rt.world, b = bay(rt, 'beam1', 'l', 1.37), start = structuredClone(w.entities.beam1!.pose);
    const r = rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam: 'beam1', a: b.a, b: b.b, seats: b.seats });
    runTo(rt, r, phase, phase === 'lift' ? 25 : 3);
    if (phase === 'lift') assert.ok(w.entities.beam1!.pose.p[1] > 0.05, 'it is off the ground');
    rt.cancel(r.id); rt.runUntilIdle(6000, [r.id]);
    assert.equal(r.status, 'cancelled', phase);
    assert.deepEqual(w.entities.beam1!.pose, start, phase); assert.deepEqual(w.entities.beam1!.support, { kind: 'ground' }); assert.equal(w.entities.beam1!.phase, 'staged');
    assert.equal(w.entities.beam1!.reservedBy, undefined); assert.equal(w.entities.beam1!.connections, undefined);
    for (const c of ['i1', 'i2']) assert.equal(w.entities[c]!.human!.grip, undefined, phase);
    assert.equal(w.entities.A!.connections, undefined, `${phase}: no half joint left`);
    clean(rt);
  }
});

test('both ends are checked again at the lift: a seat taken or a frame let down meanwhile fails it, and the beam stays', () => {
  for (const what of ['taken', 'lowered']) {
    const { rt, ra } = raised(1), w = rt.world, b = bay(rt, 'beam1', 'l', 0.76), start = structuredClone(w.entities.beam1!.pose);
    const r = rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam: 'beam1', a: b.a, b: b.b, seats: b.seats });
    rt.step();
    if (what === 'taken') (w.entities.B!.connections ??= []).push({ socket: b.seats[1], to: 'other', toSocket: 'end-l' });   // as another crew would
    else rt.cancel(ra.id);   // a's crew lowers it (nothing joins it yet)
    rt.runUntilIdle(6000, [r.id]);
    assert.equal(r.status, 'failed', what);
    assert.match(r.diagnostic!.code, what === 'taken' ? /^beam\.seat-taken$/ : /^(beam\.upright-|route\.)/, JSON.stringify(r.diagnostic));
    assert.deepEqual(w.entities.beam1!.pose, start, what); assert.equal(w.entities.beam1!.phase, 'staged'); assert.equal(w.entities.beam1!.reservedBy, undefined);
    for (const c of ['i1', 'i2']) assert.equal(w.entities[c]!.human!.grip, undefined, what);
  }
});

test('a saved world resumes in every phase, to the same state as one never saved', () => {
  for (const phase of ['approach', 'lift', 'lower', 'seated']) {
    const a = raised(1), b0 = bay(a.rt, 'beam1', 'l', 0.76), r = a.rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam: 'beam1', a: b0.a, b: b0.b, seats: b0.seats });
    if (phase === 'seated') a.rt.runUntilIdle(6000, [r.id]);
    else if (phase === 'lower') { runTo(a.rt, r, 'lift', 25); a.rt.cancel(r.id); a.rt.step(); a.rt.step(); }
    else runTo(a.rt, r, phase, 3);
    const snap = a.rt.snapshot(), b = Runtime.restore(structuredClone(snap), a.rt.registry, { spatial: new Spatial(base) }, invariants);
    assert.deepEqual(snap.dropped ?? [], [], `${phase}: nothing dropped`);
    for (const rt of [a.rt, b]) rt.runUntilIdle(6000, [r.id]);
    assert.equal(b.stateHash(), a.rt.stateHash(), `${phase}: same state`);
    for (const rt of [a.rt, b]) { rt.cancel(a.ra.id); rt.cancel(a.rb.id); for (let i = 0; i < 30; i++) rt.step(); }
    assert.equal(b.stateHash(), a.rt.stateHash(), `${phase}: same after the stops`);
  }
});

test('the invariant notices a beam seated at one end, and a joined frame let go before it stands', () => {
  const { rt, ra } = raised(1), w = rt.world;
  seat(rt, 'beam1', 'l', 0.76);
  assert.deepEqual(framesStand(rt), []);
  const A = w.entities.A!; A.support = { kind: 'ground' }; A.phase = 'installed';
  for (const c of ['a1', 'a2']) w.entities[c]!.human!.grip = undefined;
  assert.equal(framesStand(rt)[0]?.code, 'support.frame-unstable');
  w.entities.beam1!.connections = w.entities.beam1!.connections!.slice(0, 1);
  assert.ok(framesStand(rt).some((d) => d.code === 'beam.unseated'));
  void ra;
});
