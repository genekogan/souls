// PC15 (#694): install_joist_v1 and lay_sheet_v1 on the bare runtime. Two loose uprights raised and held by their crews
// (PC13), four beams seated between them so the frames stand and the crews let go (PC14), five deck joists set onto the beams' step ledges and a sheet laid
// across them through PC12's connectors; a snapshot in every phase; the deck invariant.
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
import { decksBear, installJoistV1, joistBays, laySheetV1, sheetBays } from './deck-install.ts';

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

const base = { bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] } as never;
const invariants = [...DEFAULT_INVARIANTS, looseFramesHeld as never, framesStand as never, decksBear as never];
const registry = () => new Map([[walkTo.verb, walkTo as never], [raiseHold.verb, raiseHold as never], [connectBeamV1.verb, connectBeamV1 as never], [installJoistV1.verb, installJoistV1 as never], [laySheetV1.verb, laySheetV1 as never]]);
/** The bay as PC14's: a lies toward −x with its base at x = 0, b toward +x; four step beams lie in it; five joists across
 *  it under their seats; a sheet beside it (+z). The crews raise and hold the uprights, the beams go in at seat 0 and seat
 *  8 on both columns (two heights: a 12 ft frame then stands on its own), the holders let go and walk clear, as a deck goes
 *  onto a bay that stands (a holder at a column would stand where the sheet's crew stands at its corner). */
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
    ...[0, 1, 2, 3, 4].map((k) => item(`j${k}`, 'test-pc15-joist', XM + (k - 2) * SPAN, 0, Math.PI / 2) as never), item('S', 'test-pc15-sheet', XM, 1.7) as never, ...people);
  const rt = new Runtime(world, registry(), { spatial: new Spatial(base) }, invariants);
  const ra = rt.submit('raise_hold_v1', { crew: ['a1', 'a2'], item: 'A' }), rb = rt.submit('raise_hold_v1', { crew: ['b1', 'b2'], item: 'B' });
  runTo(rt, ra, 'hold', 0); runTo(rt, rb, 'hold', 4);
  for (const [beam, column, height] of [['bl', 'l', 0.3048], ['br', 'r', 0.3048], ['ul', 'l', 1.524], ['ur', 'r', 1.524]] as const) {
    const b = beamBays(rt.world, beam).find((x) => x.column === column && Math.abs(x.height - height) < 0.01)!;
    assert.ok(b, `${beam}: ${JSON.stringify(beamBays(rt.world, beam))}`);
    done(rt, rt.submit('connect_beam_v1', { crew: ['i1', 'i2'], beam, a: b.a, b: b.b, seats: b.seats }));
  }
  for (const r of [ra, rb]) { rt.cancel(r.id); assert.equal(r.status, 'cancelled', JSON.stringify(r.diagnostic)); }
  for (const [c, x] of [['a1', -2.5], ['a2', -2.5], ['b1', D + 2.5], ['b2', D + 2.5]] as const) done(rt, rt.submit('walk_to', { actor: c, x, z: rt.world.entities[c]!.pose.p[2] }));
  return { rt, ra, rb };
}
const joist = (rt: Runtime, k: number) => { const b = joistBays(rt.world, `j${k}`).find((x) => Math.abs(x.at - (k - 2) * SPAN) < 0.01)!; assert.ok(b, `j${k}: ${JSON.stringify(joistBays(rt.world, `j${k}`))}`); return rt.submit('install_joist_v1', { crew: ['i1', 'i2'], joist: `j${k}`, beams: b.beams, seats: b.seats }); };

test('five joists onto the standing frames\' beams, a sheet across them: every connector joined both ways, nothing fires', () => {
  const { rt } = site(), w = rt.world;
  for (const k of [0, 1, 2, 3, 4]) done(rt, joist(rt, k));
  for (const k of [0, 1, 2, 3, 4]) {
    const j = w.entities[`j${k}`]!; assert.equal(j.phase, 'installed'); assert.equal(j.connections!.length, 2);
    assert.ok(Math.abs(j.pose.p[1] - (0.3048 - BH / 2 + LEDGE)) < 1e-6, `on the ledges: ${j.pose.p[1]}`);
    for (const c of j.connections!) assert.ok(w.entities[c.to]!.connections!.some((x) => x.to === j.id && x.socket === c.toSocket && x.toSocket === c.socket));
  }
  const rows = sheetBays(w, 'S'); assert.equal(rows.length, 1); assert.deepEqual([...rows[0]!].sort(), ['j0', 'j1', 'j2', 'j3', 'j4']);
  done(rt, rt.submit('lay_sheet_v1', { crew: ['i1', 'i2'], sheet: 'S', joists: rows[0]! }));
  const S = w.entities.S!; assert.equal(S.phase, 'installed'); assert.equal(S.connections!.length, 5); assert.deepEqual(S.support, { kind: 'connected', to: ['j0', 'j1', 'j2', 'j3', 'j4'] });
  assert.deepEqual(rt.violations ?? [], []);
});

test('a saved world resumes in every phase, to the same state as one never saved', () => {
  for (const [verb, phase] of [['joist', 'approach'], ['joist', 'lift'], ['joist', 'lower'], ['joist', 'installed'], ['sheet', 'lift'], ['sheet', 'installed']] as const) {
    const a = site();
    if (verb === 'sheet') for (const k of [0, 1, 2, 3, 4]) done(a.rt, joist(a.rt, k));
    const r = verb === 'joist' ? joist(a.rt, 2) : a.rt.submit('lay_sheet_v1', { crew: ['i1', 'i2'], sheet: 'S', joists: sheetBays(a.rt.world, 'S')[0]! });
    if (phase === 'installed') a.rt.runUntilIdle(6000, [r.id]);
    else if (phase === 'lower') { runTo(a.rt, r, 'lift', 15); a.rt.cancel(r.id); a.rt.step(); a.rt.step(); }
    else runTo(a.rt, r, phase, 3);
    const snap = a.rt.snapshot(), b = Runtime.restore(structuredClone(snap), a.rt.registry, { spatial: new Spatial(base) }, invariants);
    assert.deepEqual(snap.dropped ?? [], [], `${verb} ${phase}: nothing dropped`);
    for (const rt of [a.rt, b]) rt.runUntilIdle(6000, [r.id]);
    assert.equal(b.stateHash(), a.rt.stateHash(), `${verb} ${phase}: same state`);
    assert.equal(r.status, phase === 'lower' ? 'cancelled' : 'completed', `${verb} ${phase}: ${JSON.stringify(r.diagnostic)}`);
  }
});

test('the invariant notices a joist on one beam and a sheet with a bearing connector joined to nothing', () => {
  const { rt } = site(), w = rt.world;
  for (const k of [0, 1, 2, 3, 4]) done(rt, joist(rt, k));
  done(rt, rt.submit('lay_sheet_v1', { crew: ['i1', 'i2'], sheet: 'S', joists: sheetBays(w, 'S')[0]! }));
  assert.deepEqual(decksBear(rt), []);
  w.entities.S!.connections = w.entities.S!.connections!.slice(0, 4);
  assert.deepEqual(decksBear(rt).map((d) => [d.code, d.subjects]), [['deck.unsupported', ['S']]]);
  w.entities.j0!.connections = w.entities.j0!.connections!.slice(0, 1);
  assert.ok(decksBear(rt).some((d) => d.subjects?.[0] === 'j0'));
});
