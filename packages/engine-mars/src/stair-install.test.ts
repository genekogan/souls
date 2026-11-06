// PC16 (#695): install_flight_v1 and install_tread_v1 on the bare runtime. PC15's bay (two uprights raised and held,
// step beams seated between them so the frames stand), here with its step beams at seat 4 (36 in) and five joists and a
// sheet already on their ledges (the deck's top at 1.03 m); a stair flight standing beside it is hung on the outer
// beam's ledge and five treads go into it; refusals; a snapshot in every phase; the stair invariant.
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
import { beamBays, connectBeamV1, framesStand } from './beam-connect.ts';
import { decksBear, installJoistV1, laySheetV1 } from './deck-install.ts';
import { flightBays, installFlightV1, installTreadV1, missingTreads, stairsBear, treadTarget, treadsPhrase } from './stair-install.ts';
import { worldPoint } from './beam-connect.ts';

// the library's loose upright, step beam, deck joist and sheet with their connectors (core-kit/authoring/work.mjs), as test defs
const IN = 0.0254, L = 3.6576, T = 0.0762, W = 1.2192, COL = 3 * IN, BL = 2.7432, BH = 0.1016, BD = 0.0508, SPAN = 24 * IN;
const JL = W - COL - BD, JH = 3.5 * IN, LEDGE = BH - 1.625 * IN;
const seats: { id: string; kind: string; local: [number, number, number] }[] = [];
for (const [face, y] of [['front', T], ['back', 0]] as const) for (const [side, z] of [['l', -(W / 2 - COL / 2)], ['r', W / 2 - COL / 2]] as const)
  for (let i = 0; 12 * IN + 6 * IN * i < L - 3 * IN; i++) seats.push({ id: `${face}-${side}-${i}`, kind: 'beam-seat', local: [-L / 2 + 12 * IN + 6 * IN * i, y, z] });
CATALOG['test-pc15-upright'] = { id: 'test-pc15-upright', label: 'loose upright', category: 'item', size: [L, T, W], massKg: 38, sockets: seats,
  handling: { carryCrew: [2, 4], carryPose: 'flat', carryHeight: 0.8, grips: { 0: [-1, 1].map((s) => ({ id: s > 0 ? 'column-pos' : 'column-neg', local: [0, T / 2, s * W / 2], span: [L, 0, 0] })) } } } as never;
CATALOG['test-pc15-beam'] = { id: 'test-pc15-beam', label: 'step beam', category: 'item', size: [BL, BH, BD], massKg: 19,
  sockets: [...[-1, 1].map((s) => ({ id: s < 0 ? 'end-l' : 'end-r', kind: 'beam-end', local: [s * BL / 2, BH / 2, 0] })),
    ...(['a', 'b'] as const).flatMap((f) => [0, 1, 2, 3, 4].map((i) => ({ id: `joist-${f}-${i}`, kind: 'joist-seat', local: [(i - 2) * SPAN, LEDGE, f === 'a' ? -BD / 2 : BD / 2] })))],
  handling: { carryCrew: [1, 2], carryPose: 'edge', carryHeight: 0.85, grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-1.097, 0, 0] }, { id: 'g1', local: [1.097, 0, 0] }] } } } as never;
CATALOG['test-pc15-joist'] = { id: 'test-pc15-joist', label: 'deck joist', category: 'item', size: [JL, JH, 1.5 * IN], massKg: 1.6,
  sockets: [...[-1, 1].map((s) => ({ id: s < 0 ? 'end-l' : 'end-r', kind: 'joist-end', local: [s * JL / 2, 0, 0] })), { id: 'top', kind: 'sheet-seat', local: [0, JH, 0] }],
  handling: { carryCrew: [1, 2], carryPose: 'edge', carryHeight: 0.8, grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-0.45, 0, 0] }, { id: 'g1', local: [0.45, 0, 0] }] } } } as never;
CATALOG['test-pc15-sheet'] = { id: 'test-pc15-sheet', label: 'plywood sheet', category: 'item', size: [2.4384, 0.75 * IN, 1.2192], massKg: 27,
  sockets: [0, 1, 2, 3, 4].map((i) => ({ id: `on-${i}`, kind: 'sheet-bearing', local: [(i - 2) * SPAN, 0, 0] })),
  handling: { carryCrew: [1, 2], carryPose: 'edge', carryHeight: 0.75, grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-1, 0, 0] }, { id: 'g1', local: [1, 0, 0] }] } } } as never;

// the library's stair flight and tread (work.mjs STAIRS): 5 treads, 0.27 m going, hook at the step ledge's height on seat 4
const RUN = 1.35, SW = 0.9144, TT = 1.5 * IN, HOOK = 0.3048 + 4 * 0.1524 - BH / 2 + LEDGE, RISE = HOOK + JH + 0.75 * IN, RISER = RISE / 6;
CATALOG['test-pc16-flight'] = { id: 'test-pc16-flight', label: 'stair flight', category: 'item', size: [RUN, 1.0117, SW], massKg: 16,
  sockets: [{ id: 'hook', kind: 'stair-hook', local: [RUN / 2, HOOK, 0] }, ...[1, 2, 3, 4, 5].map((i) => ({ id: `tread-${i}`, kind: 'tread-seat', local: [-RUN / 2 + (i - 0.5) * 0.27, i * RISER - TT, 0] }))],
  handling: { carryCrew: [2, 2], carryPose: 'flat', carryHeight: 0.8, grips: { 2: [{ id: 'g0', local: [-0.5, 0, 0] }, { id: 'g1', local: [0.5, 0, 0] }] } } } as never;
CATALOG['test-pc16-tread'] = { id: 'test-pc16-tread', label: 'stair tread', category: 'item', size: [SW - 2 * TT, TT, 9.25 * IN], massKg: 2.3,
  sockets: [{ id: 'seat', kind: 'tread-bearing', local: [0, 0, 0] }],
  handling: { carryCrew: [1, 2], carryPose: 'flat', carryHeight: 0.8, grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-0.3, 0, 0] }, { id: 'g1', local: [0.3, 0, 0] }] } } } as never;
const base = { bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] } as never;
const invariants = [...DEFAULT_INVARIANTS, looseFramesHeld as never, framesStand as never, decksBear as never, stairsBear as never];
const registry = () => new Map([[walkTo.verb, walkTo as never], [raiseHold.verb, raiseHold as never], [connectBeamV1.verb, connectBeamV1 as never], [installJoistV1.verb, installJoistV1 as never], [laySheetV1.verb, laySheetV1 as never], [installFlightV1.verb, installFlightV1 as never], [installTreadV1.verb, installTreadV1 as never]]);
/** The bay as PC15's, its step beams at seat 4 and the upper ones at seat 11; then the deck on the low beams as a god
 *  builds it (joists and sheet joined in place); a flight standing beside the bay's +z side, five treads lying by it. */
const D = BL + 2 * T, XM = D / 2;
const runTo = (rt: Runtime, r: ActionRecord, phase: string, extra = 4) => {
  for (let i = 0; i < 6000 && r.phase !== phase && rt.isActive(r.id); i++) rt.step();
  assert.equal(r.phase, phase, JSON.stringify([r.status, r.diagnostic, rt.tick, rt.violations])); for (let i = 0; i < extra; i++) rt.step();
};
const done = (rt: Runtime, r: ActionRecord) => { assert.notEqual(r.status, 'failed', JSON.stringify(r.diagnostic)); rt.runUntilIdle(6000, [r.id]); assert.equal(r.status, 'completed', JSON.stringify([r.diagnostic, r.phase])); };
function site() {
  const lying = (id: string, x: number) => ({ id, kind: 'item', def: 'test-pc15-upright', pose: { p: [x, 0, 0], yaw: 0 }, support: { kind: 'ground' }, phase: 'staged' });
  const item = (id: string, def: string, x: number, z: number, yaw = 0) => ({ id, kind: 'item', def, pose: { p: [x, 0, z], yaw }, support: { kind: 'ground' }, phase: 'staged' });
  const people = [human('a1', 0.6, -1.6), human('a2', 0.6, 1.6), human('b1', D - 0.6, -1.6), human('b2', D - 0.6, 1.6), human('i1', XM, -2.0), human('i2', XM - 0.8, 3.0)];
  const world = addAll(emptyWorld('deck-install', base), lying('A', -L / 2) as never, lying('B', D + L / 2) as never, item('bl', 'test-pc15-beam', XM, -0.42) as never, item('br', 'test-pc15-beam', XM, 0.42) as never,
    item('ul', 'test-pc15-beam', XM, -0.85) as never, item('ur', 'test-pc15-beam', XM, 0.85) as never,
    ...[0, 1, 2, 3, 4].map((k) => item(`j${k}`, 'test-pc15-joist', XM + (k - 2) * SPAN, 0, Math.PI / 2) as never), item('S', 'test-pc15-sheet', XM, -2.6) as never,
    item('F', 'test-pc16-flight', XM + 1.7, 2.4, -Math.PI / 2) as never, ...[1, 2, 3, 4, 5].map((i) => item(`t${i}`, 'test-pc16-tread', XM - 1.3, 1.5 + 0.35 * i) as never), ...people);
  const rt = new Runtime(world, registry(), { spatial: new Spatial(base) }, invariants);
  const ra = rt.submit('raise_hold_v1', { crew: ['a1', 'a2'], item: 'A' }), rb = rt.submit('raise_hold_v1', { crew: ['b1', 'b2'], item: 'B' });
  runTo(rt, ra, 'hold', 0); runTo(rt, rb, 'hold', 4);
  for (const [beam, column, height] of [['bl', 'l', 0.9144], ['br', 'r', 0.9144], ['ul', 'l', 1.9812], ['ur', 'r', 1.9812]] as const) {
    const b = beamBays(rt.world, beam).find((x) => x.column === column && Math.abs(x.height - height) < 0.01)!;
    assert.ok(b, `${beam}: ${JSON.stringify(beamBays(rt.world, beam))}`);
    done(rt, rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam, a: b.a, b: b.b, seats: b.seats }));
  }
  for (const r of [ra, rb]) { rt.cancel(r.id); assert.equal(r.status, 'cancelled', JSON.stringify(r.diagnostic)); }
  for (const [c, x] of [['a1', -2.5], ['a2', -2.5], ['b1', D + 2.5], ['b2', D + 2.5]] as const) done(rt, rt.submit('walk_to', { actor: c, x, z: rt.world.entities[c]!.pose.p[2] }));
  // the deck, joined in place: joist k across the low beams' ledges (bl's face b, br's face a), the sheet on their tops
  const w = rt.world, join = (a: string, sa: string, b: string, sb: string) => { (w.entities[a]!.connections ??= []).push({ socket: sa, to: b, toSocket: sb }); (w.entities[b]!.connections ??= []).push({ socket: sb, to: a, toSocket: sa }); };
  const seatAt = (b: string, s: string) => worldPoint(w.entities[b]!, (CATALOG[w.entities[b]!.def] as never as { sockets: { id: string; local: number[] }[] }).sockets.find((x) => x.id === s)!.local);
  for (const k of [0, 1, 2, 3, 4]) {
    const q0 = seatAt('bl', `joist-b-${k}`), q1 = seatAt('br', `joist-a-${k}`), j = w.entities[`j${k}`]!;
    Object.assign(j, { pose: { p: [(q0[0] + q1[0]) / 2, q0[1], (q0[2] + q1[2]) / 2], yaw: Math.PI / 2 }, phase: 'installed', support: { kind: 'connected', to: ['bl', 'br'] } });
    join(`j${k}`, 'end-l', 'bl', `joist-b-${k}`); join(`j${k}`, 'end-r', 'br', `joist-a-${k}`);
  }
  Object.assign(w.entities.S!, { pose: { p: [XM, w.entities.j2!.pose.p[1] + JH, 0], yaw: 0 }, phase: 'installed', support: { kind: 'connected', to: ['j0', 'j1', 'j2', 'j3', 'j4'] } });
  for (const k of [0, 1, 2, 3, 4]) join('S', `on-${k}`, `j${k}`, 'top');
  rt.step(); assert.deepEqual(rt.violations ?? [], []);
  return { rt, ra, rb };
}
const flight = (rt: Runtime, crew = ['a1', 'a2']) => {
  const b = flightBays(rt.world, 'F').find((x) => x.beam === 'br' && x.at === 0)!; assert.ok(b, JSON.stringify(flightBays(rt.world, 'F')));
  return rt.submit('install_flight_v1', { crew, flight: 'F', beam: b.beam, seat: b.seat });
};
/** The flight's crew, done, walks clear of the treads' worker (they stand either side of it). */
const hung = (rt: Runtime) => { done(rt, flight(rt)); for (const c of ['a1', 'a2']) done(rt, rt.submit('walk_to', { actor: c, x: -2.5, z: rt.world.entities[c]!.pose.p[2] })); };
const tread = (rt: Runtime, i: number, crew = ['b1']) => { const t = treadTarget(rt.world, `t${i}`)!; assert.ok(t, `t${i}`); return rt.submit('install_tread_v1', { crew, tread: `t${i}`, ...t }); };

test('a flight hung on the outer beam\'s ledge, its foot on the ground, then five treads bottom up: every joint both ways, nothing fires', () => {
  const { rt } = site(), w = rt.world;
  // offered only on the deck's outer face (br's face b), every free ledge seat there
  assert.deepEqual(flightBays(w, 'F').map((b) => [b.beam, b.seat]), [0, 1, 2, 3, 4].map((i) => ['br', `joist-b-${i}`]));
  assert.equal(treadTarget(w, 't1'), null, 'no tread offered before the flight is in');
  hung(rt);
  const F = w.entities.F!;
  assert.equal(F.phase, 'installed'); assert.deepEqual(F.support, { kind: 'connected', to: ['br'] });
  assert.ok(Math.abs(F.pose.p[1]) < 1e-6, `its foot on the ground: ${F.pose.p[1]}`);
  assert.ok(Math.abs(F.pose.p[2] - (w.entities.br!.pose.p[2] + BD / 2 + RUN / 2)) < 1e-6, `square to the beam, outside it: ${JSON.stringify(F.pose)}`);
  assert.ok(w.entities.br!.connections!.some((c) => c.to === 'F' && c.socket === 'joist-b-2' && c.toSocket === 'hook'));
  assert.deepEqual(missingTreads(w, F), [1, 2, 3, 4, 5]); assert.equal(treadsPhrase(missingTreads(w, F)), 'treads 1–5 missing');
  for (const i of [1, 2, 3, 4, 5]) {
    assert.deepEqual(treadTarget(w, `t${i}`), { flight: 'F', index: i });
    done(rt, tread(rt, i));
    const t = w.entities[`t${i}`]!; assert.equal(t.phase, 'installed'); assert.deepEqual(t.support, { kind: 'connected', to: ['F'] });
    assert.ok(Math.abs(t.pose.p[1] + TT - i * RISER) < 1e-6, `tread ${i} top at ${i} risers: ${t.pose.p[1]}`);
  }
  assert.deepEqual(missingTreads(w, F), []);
  assert.deepEqual(rt.violations ?? [], []);
});

test('refused before motion, named: a seat taken, a beam whose frames are not held up, a ledge the hook does not fit, someone where it goes, a tread already in', () => {
  const { rt } = site(), w = rt.world, b = flightBays(w, 'F')[2]!, plan = (verb: string, p: object) => rt.registry.get(verb)!.plan(rt, p as never) as { ok: boolean; diagnostic?: { code: string; message: string } };
  const code = (verb: string, p: object) => { const r = plan(verb, p); assert.equal(r.ok, false, JSON.stringify(r)); return r.diagnostic!.code; };
  assert.equal(code('install_flight_v1', { crew: ['a1', 'a2'], flight: 'F', beam: 'br', seat: 'joist-a-2' }), 'stair.occupied');
  assert.equal(code('install_flight_v1', { crew: ['a1', 'a2'], flight: 'F', beam: 'ur', seat: 'joist-b-2' }), 'stair.rise');
  assert.equal(code('install_flight_v1', { crew: ['a1'], flight: 'F', beam: b.beam, seat: b.seat }), 'stair.crew');
  w.entities.i1!.pose.p = [XM, 0, 1.3];
  assert.equal(code('install_flight_v1', { crew: ['a1', 'a2'], flight: 'F', beam: b.beam, seat: b.seat }), 'stair.site-occupied');
  w.entities.i1!.pose.p = [XM, 0, -2.0];
  assert.equal(code('install_tread_v1', { crew: ['b1'], tread: 't1', flight: 'F', index: 1 }), 'tread.no-stair');
  hung(rt);
  done(rt, tread(rt, 1));
  assert.equal(code('install_tread_v1', { crew: ['b1'], tread: 't2', flight: 'F', index: 1 }), 'tread.already-installed');
  assert.equal(code('install_tread_v1', { crew: ['b1'], tread: 't2', flight: 'F', index: 6 }), 'tread.index');
  // the frames no longer stand on their own (an upper beam gone): the beam cannot carry a flight, nor the flight a tread
  const ul = w.entities.ul!; for (const c of ul.connections!) w.entities[c.to]!.connections = w.entities[c.to]!.connections!.filter((x) => x.to !== 'ul');
  Object.assign(ul, { connections: [], phase: 'staged', support: { kind: 'ground' }, pose: { p: [XM, 0, -3.5], yaw: 0 } });
  assert.equal(code('install_tread_v1', { crew: ['b1'], tread: 't2', flight: 'F', index: 2 }), 'tread.no-stair');
});

test('stopped in the air, the flight comes back down to exactly where it stood; a saved world resumes in every phase', () => {
  for (const [verb, phase] of [['flight', 'approach'], ['flight', 'lift'], ['flight', 'lower'], ['flight', 'installed'], ['tread', 'lift'], ['tread', 'lower'], ['tread', 'installed']] as const) {
    const a = site();
    if (verb === 'tread') hung(a.rt);
    const what = verb === 'flight' ? 'F' : 't1', start = structuredClone(a.rt.world.entities[what]!.pose);
    const r = verb === 'flight' ? flight(a.rt) : tread(a.rt, 1);
    if (phase === 'installed') a.rt.runUntilIdle(6000, [r.id]);
    else if (phase === 'lower') { runTo(a.rt, r, 'lift', 15); a.rt.cancel(r.id); a.rt.step(); a.rt.step(); }
    else runTo(a.rt, r, phase, 3);
    const snap = a.rt.snapshot(), b = Runtime.restore(structuredClone(snap), a.rt.registry, { spatial: new Spatial(base) }, invariants);
    assert.deepEqual(snap.dropped ?? [], [], `${verb} ${phase}: nothing dropped`);
    for (const rt of [a.rt, b]) rt.runUntilIdle(6000, [r.id]);
    assert.equal(b.stateHash(), a.rt.stateHash(), `${verb} ${phase}: same state`);
    assert.equal(r.status, phase === 'lower' ? 'cancelled' : 'completed', `${verb} ${phase}: ${JSON.stringify(r.diagnostic)}`);
    if (phase === 'lower') { const e = a.rt.world.entities[what]!; assert.deepEqual(e.pose, start, `${verb}: back where it was`); assert.equal(e.phase, 'staged'); assert.ok(!e.connections?.length); }
    assert.deepEqual(a.rt.violations ?? [], [], `${verb} ${phase}`);
  }
});

test('the invariant notices a flight hanging on nothing and a tread in a flight that does not hold it', () => {
  const { rt } = site(), w = rt.world;
  hung(rt); done(rt, tread(rt, 1));
  assert.deepEqual(stairsBear(rt), []);
  w.entities.br!.connections = w.entities.br!.connections!.filter((c) => c.to !== 'F');
  assert.deepEqual(stairsBear(rt).map((d) => [d.code, d.subjects]), [['stair.unsupported', ['F']]]);
  w.entities.F!.connections = w.entities.F!.connections!.filter((c) => c.to !== 't1');
  assert.ok(stairsBear(rt).some((d) => d.subjects?.[0] === 't1'));
});
