// beds/1: a god-built bed an adult fits on is lain on through its native berths (catalog-adapter berthSlots → the
// engine's take_slot): the body walks to the bed's side, lies down on the mattress, rests, and gets up again. A bed
// nobody can lie on (a crib) is not offered, and a pose beside a bed is never accepted as using it. In-process CPU checks.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory, seed } from '../../test/native-owner-fixture.ts';
import { WorldHost } from '../world.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

async function setup(t: TestContext, names = ['Rowan', 'Mina']) {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle();
  const souls = [];
  for (const name of names) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create('dev:' + name.toLowerCase(), { name, description: 'native bed admission control' }));
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
  }
  await settle();
  const placed = god.act({ ops: [
    { op: 'place', def: coreRef('bed'), name: 'guest-bed', p: [5, 5] },
    { op: 'place', def: coreRef('crib'), name: 'crib', p: [9, 5] },
    { op: 'place', def: coreRef('chair'), name: 'chair', p: [-5, 5] },
  ] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  await settle();
  const bed = god.model.get('guest-bed')!.id, crib = god.model.get('crib')!.id, chair = god.model.get('chair')!.id;
  const body = (s: { entityId: string }) => f.host.engine.world.entities[s.entityId];
  const until = async (ok: () => boolean, max = 1500) => { for (let i = 0; i < max && !ok(); i++) await settle(1); return ok(); };
  return { ...f, god, edge, bridge, souls, settle, until, body, bed, crib, chair };
}
type W = Awaited<ReturnType<typeof setup>>;
// the engine body state lane beds/1 adds (berth, mattress seatHeight)
const hs = (e: { human?: unknown }) => e.human as { activity: string; berth?: string; seatHeight?: number };
const berthPoints = (w: W) => {
  const e = w.host.engine.world.entities[w.bed], c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
  // the engine asset's berths (local x, z → world), from catalog-adapter berthSlots
  const slots = ((w.bridge as unknown as { physics?: { assets: Record<string, { slots?: { id: string; kind: string; local: [number, number]; height?: number }[] }> } }).physics?.assets[e.def]?.slots ?? []).filter((q) => q.kind === 'berth');
  return slots.map((q) => ({ id: q.id, height: q.height, p: [e.pose.p[0] + q.local[0] * c - q.local[1] * s, e.pose.p[2] + q.local[0] * s + q.local[1] * c] as [number, number] }));
};
const near = (a: number[], b: number[], tol = 0.05) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
const lie = async (w: W, s: W['souls'][number], verb: 'lie' | 'sleep', seconds: number) => {
  const out = await accept(w.host, w.edge.act(s, { capability: `${verb}:${w.bed}`, params: { seconds } }));
  assert.equal(out.accepted, true, JSON.stringify(out));
  return (out as { receipt: { id: string } }).receipt.id;
};
const lying = (w: W, s: W['souls'][number]) => { const h = hs(w.body(s)); return (h.activity === 'lie' || h.activity === 'nap') && !!h.berth; };

test('a resident lies down on a god-built double bed, rests on the mattress and gets up again', async t => {
  const w = await setup(t), [soul] = w.souls;
  const berths = berthPoints(w);
  assert.deepEqual(berths.map((b) => [b.id, b.height]), [['bed-l', 0.5], ['bed-r', 0.5]], 'core-bed has two adult berths at its mattress top');
  for (const verb of ['lie', 'sleep']) {
    const c = w.edge.capabilities(soul).find((q) => q.id === `${verb}:${w.bed}`)!;
    assert.ok(c, `${verb} is offered on the bed`);
    assert.equal(c.available, true, JSON.stringify(c));
  }
  const receipt = await lie(w, soul, 'lie', 3);
  assert.ok(await w.until(() => lying(w, soul)), 'the body reaches the berth');
  const h = hs(w.body(soul)), at = [w.body(soul).pose.p[0], w.body(soul).pose.p[2]];
  assert.equal(h.activity, 'lie');
  assert.equal(h.seatHeight, 0.5);
  const on = berths.find((b) => near(at, b.p))!;
  assert.ok(on, `the body lies on a berth point (at ${at}, berths ${JSON.stringify(berths)})`);
  assert.equal(h.berth, `${w.bed}#${on.id}`);
  assert.equal(w.edge.capabilities(soul).find((q) => q.id === `lie:${w.bed}`)?.blocked?.code, 'bed.yours');
  assert.ok(await w.until(() => w.edge.receipt(soul.soulId, receipt)?.phase === 'completed'), JSON.stringify(w.edge.receipt(soul.soulId, receipt)));
  const after = hs(w.body(soul)), there = [w.body(soul).pose.p[0], w.body(soul).pose.p[2]];
  assert.equal(after.activity, 'idle');
  assert.equal(after.berth, undefined);
  assert.equal(after.seatHeight, undefined);
  assert.ok(Math.hypot(there[0] - on.p[0], there[1] - on.p[1]) > 0.5, 'got up off the bed, beside it');
  assert.deepEqual(w.host.engine.runtime.violations, []);
  assert.equal(w.db.paidCost(), 0);
});

test('two residents share a double bed; a third finds it taken; a crib is never offered', async t => {
  const w = await setup(t, ['Rowan', 'Mina', 'Ines']), [a, b, c] = w.souls;
  await lie(w, a, 'sleep', 60);
  assert.ok(await w.until(() => lying(w, a)));
  assert.equal(hs(w.body(a)).activity, 'nap');
  await lie(w, b, 'lie', 60);
  assert.ok(await w.until(() => lying(w, b)));
  assert.notEqual(hs(w.body(a)).berth, hs(w.body(b)).berth, 'each on their own berth');
  const third = w.edge.capabilities(c).find((q) => q.id === `lie:${w.bed}`)!;
  assert.equal(third.available, false);
  assert.equal(third.blocked?.code, 'bed.taken', JSON.stringify(third));
  const refused = await w.edge.act(c, { capability: `lie:${w.bed}`, params: { seconds: 5 } });
  assert.equal(refused.accepted, false);
  for (const verb of ['lie', 'sleep']) assert.equal(w.edge.capabilities(c).some((q) => q.id === `${verb}:${w.crib}`), false, 'a crib no adult fits is not offered');
  const crib = await w.edge.act(c, { capability: `lie:${w.crib}` });
  assert.equal(crib.accepted, false);
  assert.ok(['capability.unknown', 'bed.attachment-unavailable'].includes((crib as { code?: string }).code!), JSON.stringify(crib));
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('a resident asleep on the bed is interrupted by a new act: gets up first, then goes', async t => {
  const w = await setup(t), [soul] = w.souls;
  const receipt = await lie(w, soul, 'sleep', 600);
  assert.ok(await w.until(() => lying(w, soul)));
  const out = await accept(w.host, w.edge.act(soul, { capability: 'wander:here', params: { seconds: 5 } }));
  assert.equal(out.accepted, true, JSON.stringify(out));
  assert.ok(await w.until(() => !hs(w.body(soul)).berth && hs(w.body(soul)).activity !== 'stand-up', 400), 'stood up off the bed');
  assert.notEqual(w.edge.receipt(soul.soulId, receipt)?.phase, 'started');
  assert.deepEqual((w.host.engine as unknown as { seatOccupantsV1: (id: string, kind: string) => unknown[] }).seatOccupantsV1(w.bed, 'berth'), [], 'berth released');
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('a pose beside the bed is never accepted as using it; ordinary floor lying stays available', async t => {
  const w = await setup(t), [soul] = w.souls, engine = w.host.engine;
  const steps = [{ verb: 'mars:pose_v1', params: { activity: 'lie', seconds: 2, seatHeight: 0.5, seatTogether: true, face: [6, 5] } }];
  const before = JSON.stringify(engine.world.entities[soul.entityId]);
  const out = await accept(w.host, w.edge.performBodies(soul, `lie:${w.bed}`, 'Lie in guest-bed', steps));
  assert.equal(out.accepted, false, JSON.stringify(out));
  assert.equal((out as { code?: string }).code, 'bed.native-berth-required');
  assert.equal(JSON.stringify(engine.world.entities[soul.entityId]), before);
  const generic = await accept(w.host, w.edge.performBodies(soul, 'lie:here', 'Lie on open ground', [{ verb: 'mars:pose_v1', params: { activity: 'lie', seconds: 1 } }]));
  assert.equal(generic.accepted, true, JSON.stringify(generic));
  if (!generic.accepted) return;
  assert.ok(await w.until(() => w.edge.receipt(soul.soulId, generic.receipt.id)?.phase === 'completed', 100));
  assert.deepEqual(engine.runtime.violations, []);
});

test('bed move/undo and cold reopen keep identity and berths; chair and walk plans survive', async t => {
  const w = await setup(t), [soul] = w.souls;
  const moved = w.god.act({ ops: [{ op: 'move', id: w.bed, p: [6, 5], yaw: Math.PI / 2 }] });
  assert.equal(moved.accepted, true, JSON.stringify(moved));
  await w.settle();
  assert.equal(w.god.undo().accepted, true);
  await w.settle();
  assert.equal(w.god.model.get('guest-bed')!.id, w.bed);
  assert.equal(w.edge.capabilities(soul).find(c => c.id === `sit:${w.chair}`)?.available, true);
  assert.ok(w.edge.capabilities(soul).some(c => c.verb === 'walk' && c.available));
  w.host.drainInputs();
  w.host.saveSnapshot(true);
  const head = w.host.engine.stateHash();
  w.host.stop();
  const cold = new WorldHost(w.db, factory, seed, 1e9, w.host.worldId, { durableClockV1: true });
  t.after(() => cold.stop());
  assert.equal(cold.boot().from, 'snapshot');
  assert.equal(cold.engine.stateHash(), head);
  const god = new GodMode(w.db, { worldId: cold.worldId, ownerId: 'dev:admin', tick: () => cold.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(cold, w.db);
  installEngineBridge({ host: cold, god, edge, log: () => {} });
  assert.equal(god.model.get('guest-bed')!.id, w.bed);
  for (let i = 0; i < 3; i++) { cold.tickOnce(); await setImmediate(); cold.drainInputs(); }
  for (const verb of ['lie', 'sleep']) assert.equal(edge.capabilities(soul).find(c => c.id === `${verb}:${w.bed}`)?.available, true);
});
