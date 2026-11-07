// doorblock (harvest fix 2026-10-18): library doors and gates block walking when shut and pass when open, wherever they
// stand in a wall gap — a plain gap left in the wall's path, or the gap of a garden wall's own `gates` option — and a
// walk check right after the change already answers for the new state. Real host, sequencer, god compiler and engine
// bridge, as in engine-bridge.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, factory, invite, accept } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { engineSettled, runQuery } from './query.ts';
import { freeDoorOpening, isDoorDef, isShut } from './doors.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function world() {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  return { ...f, god, edge, settle };
}
const ok = (r: any) => { assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); return r; };
// a closed square of garden wall north of z=0, its only way in at (cx, 0): `gap` leaves the path open there, else the
// wall's own `gates` option makes the gap (a closed loop, gate at 4 m along)
const ring = (name: string, cx: number, gap: 'path' | 'gates', width = 1.2) => gap === 'path'
  ? { op: 'place', def: coreRef('garden-wall'), name, shape: { path: [[cx - width / 2, 0], [cx - 4, 0], [cx - 4, 6], [cx + 4, 6], [cx + 4, 0], [cx + width / 2, 0]] } }
  : { op: 'place', def: coreRef('garden-wall'), name, shape: { path: [[cx - 4, 0], [cx + 4, 0], [cx + 4, 6], [cx - 4, 6], [cx - 4, 0]] }, params: { gates: [{ at: 4, width }] } };

test('doorblock: core door and gate block shut, pass open, block shut again — in a path gap and in a garden wall gate', { timeout: 300000 }, async (t) => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  ok(w.god.act({ ops: [
    ring('ring-a', 0, 'path'), { op: 'place', def: coreRef('door'), name: 'door-a', p: [0, 0] },
    ring('ring-b', -12, 'path', 1.5), { op: 'place', def: coreRef('gate'), name: 'gate-b', p: [-12, 0] },
    ring('ring-c', 12, 'gates'), { op: 'place', def: coreRef('door'), name: 'door-c', p: [12, 0] },
  ] }, 'three walled yards with a door or gate in the gap'));
  await w.settle();
  const reach = (cx: number) => (runQuery(w.god.model, { reach: { from: [cx, -3], to: [cx, 3] } }).reach as any);
  const set = async (ref: string, open: boolean) => { ok(w.god.act({ ops: [{ op: 'set', id: w.god.model.get(ref)!.id, state: { open } }] })); await w.settle(); };
  for (const [ref, cx] of [['door-a', 0], ['gate-b', -12], ['door-c', 12]] as const) {
    // placed with the def's default state (open: false): shut
    assert.equal(reach(cx).code, 'route.unreachable', `${ref} as placed (shut) blocks: ${JSON.stringify(reach(cx)).slice(0, 200)}`);
    await set(ref, true);
    const r = reach(cx);
    assert.equal(r.reachable, true, `${ref} open passes: ${JSON.stringify(r).slice(0, 200)}`);
    assert.ok(r.length < 8, `${ref}: straight through the gap, not round: ${r.length}`);
    await set(ref, false);
    assert.equal(reach(cx).code, 'route.unreachable', `${ref} shut again blocks`);
  }
  // the garden wall's own gate takes over again when the door leaves its gap: a bare gate is an open gap (SEALED), one
  // set state 'closed' blocks
  await set('door-c', false);
  assert.equal(reach(12).code, 'route.unreachable', 'shut door in the gap blocks');
  ok(w.god.act({ ops: [{ op: 'move', id: w.god.model.get('door-c')!.id, p: [12, -7] }] })); await w.settle();
  assert.equal(reach(12).reachable, true, 'door moved out: the bare wall gate is an open gap');
  ok(w.god.act({ ops: [{ op: 'move', id: w.god.model.get('door-c')!.id, p: [12, 0] }] })); await w.settle();
  assert.equal(reach(12).code, 'route.unreachable', 'shut door back in the gap blocks');
  ok(w.god.act({ ops: [{ op: 'remove', id: w.god.model.get('door-c')!.id }] })); await w.settle();
  assert.equal(reach(12).reachable, true, 'door removed: the bare wall gate passes');
  const ringC = w.god.model.get('ring-c')!.id;
  ok(w.god.act({ ops: [{ op: 'set', id: ringC, params: { gates: [{ at: 4, width: 1.2, state: 'closed' }] } }] })); await w.settle();
  assert.equal(reach(12).code, 'route.unreachable', "a wall gate set state 'closed' blocks its gap");
});

// SEALED (2026-10-21): doorblock made a bare wall/fence gate 'closed' by default, so a god's walled garden trapped whoever
// was inside. A god builds a walled garden with a gate (no state given) and a bench inside; a Soul born outside walks in
// through the gate and sits.
test('a walled garden with a bare gate: a Soul walks in through the gate and sits on the bench inside', { timeout: 300000 }, async (t) => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  // a closed 12 x 10 m square of 1.8 m stone wall north of z=4, its one gate (1.4 m) in the south side at x=0
  ok(w.god.act({ ops: [
    { op: 'place', def: coreRef('garden-wall'), name: 'walled-garden', shape: { path: [[-6, 4], [6, 4], [6, 14], [-6, 14], [-6, 4]] }, params: { gates: [{ at: 6, width: 1.4 }] } },
    { op: 'place', def: coreRef('bench'), name: 'garden-bench', p: [0, 11], r: Math.PI },
  ] }, 'a walled garden with a gate and a bench'));
  await w.settle();
  const E = w.host.engine as any, wall = w.god.model.get('walled-garden')!.id, bench = w.god.model.get('garden-bench')!.id;
  assert.ok(!(E.world.entityPhysicsV1.byEntity[wall]?.solids ?? []).some((x: any) => x.id.includes('#door:')), 'a bare gate has no blocker');
  const r = runQuery(w.god.model, { reach: { from: [0, -4], to: [0, 9] } }).reach as any;
  assert.equal(r.reachable, true, JSON.stringify(r).slice(0, 300));
  assert.ok(r.length < 16, `straight in through the gate, not round: ${r.length}`);
  await invite(w, 'gia');
  const row: any = await accept(w.host, w.souls.create('dev:gia', { name: 'Gia', description: 'sits in the garden' }));
  await w.settle(3);
  await accept(w.host, w.host.enqueue('edge-relocate', 'test:outside', { soulId: row.id, entityId: row.entity_id, to: [0, -6], why: 'start outside the garden' }));
  await w.settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const sit: any = await accept(w.host, w.edge.act(soul, { capability: `sit:${bench}`, params: { seconds: 600 } }));
  assert.equal(sit.accepted, true, JSON.stringify(sit).slice(0, 400));
  let throughGate = false;
  for (let i = 0; i < 4000 && E.world.entities[row.entity_id].human.activity !== 'sit'; i++) {
    w.host.tickOnce();
    const p = E.world.entities[row.entity_id].pose.p;
    if (Math.abs(p[0]) < 0.8 && Math.abs(p[2] - 4) < 0.4) throughGate = true;
    if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); }
  }
  const b = E.world.entities[row.entity_id];
  assert.equal(b.human.activity, 'sit', `seated: ${JSON.stringify(b.human).slice(0, 300)}`);
  assert.ok(b.pose.p[2] > 4.5 && Math.abs(b.pose.p[0]) < 5.5, `inside the garden: ${b.pose.p}`);
  assert.ok(throughGate, 'walked through the gate');
});

test('doorblock: a walk check right after a door is opened waits for the engine to take the edit in', { timeout: 300000 }, async (t) => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  ok(w.god.act({ ops: [ring('ring', 0, 'path'), { op: 'place', def: coreRef('door'), name: 'door', p: [0, 0] }] }));
  await w.settle();
  ok(w.god.act({ ops: [{ op: 'set', id: w.god.model.get('door')!.id, state: { open: true } }] }));
  // no tick yet: the engine still has the shut door, and says so
  assert.equal(await engineSettled(w.god.model, 30), false, 'engine not yet current');
  const settled = engineSettled(w.god.model, 3000);
  await w.settle(2);
  assert.equal(await settled, true);
  assert.equal((runQuery(w.god.model, { reach: { from: [0, -3], to: [0, 3] } }).reach as any).reachable, true);
});

test('doorblock: which defs are doors; shut by state or by the def default; a window stays out of the walk graph', async () => {
  const w = await world();
  try {
    const door = w.god.model.resolvedDef(coreRef('door'))!, gate = w.god.model.resolvedDef(coreRef('gate'))!, win = w.god.model.resolvedDef(coreRef('window'))!;
    assert.equal(isDoorDef(door), true); assert.equal(isDoorDef(gate), true); assert.equal(isDoorDef(win), false);
    const e = (state?: Record<string, unknown>) => ({ id: 'x', def: coreRef('door'), ...(state ? { state } : {}) }) as any;
    assert.equal(isShut(e(), door), true, 'default open:false');
    assert.equal(isShut(e({ open: true }), door), false);
    assert.equal(isShut(e({ open: false }), door), true);
    const fo = freeDoorOpening(door, w.god.model.bake(door, {}, 0))!;
    assert.ok(fo && fo.width >= 1.1 && fo.height >= 2, `free door blocks its frame width: ${JSON.stringify(fo)}`);
    assert.equal(freeDoorOpening(win, w.god.model.bake(win, {}, 0)), null);
  } finally { w.host.stop(); w.db.close(); }
});
