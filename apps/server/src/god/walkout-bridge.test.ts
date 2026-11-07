// G1 "god rules" review fixes, through the real host, sequencer, edge ledger, compiler and native engine (fake minds):
// a held thing the god removes leaves the engine too and an undo never puts things back into a resident's hands; the
// god cannot place things into hands; a wide raise over seated/napping residents moves them; an upstairs resident steps
// aside on its own floor; dry runs show who would move; native minds hear and wake; an engine-refused landing is named
// in the durable receipt; replay agrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { kernelHash } from '@souls/kernel';
import { coreRef } from '@souls/world-compiler';
import { meter, type Work } from '@souls/world-compiler/work-meter';
import { fixture, invite, accept, factory, seed } from '../../test/native-owner-fixture.ts';
import { WorldHost } from '../world.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** engine-bridge.test.ts's two-floor house (not imported: importing a test file runs its tests). */
const HOUSE_BATCH = (at: [number, number] = [10, 0]) => ({ ops: [
  { op: 'define', def: { schema: 'def/1', name: 'house2', version: 1, description: 'A two-floor house.', tags: ['building'], size: { box: [8, 6, 6] }, make: { kind: 'gen', gen: 'building/1' }, params: { floors: { type: 'int', min: 1, max: 6, default: 2 } }, state: { doors: { type: 'json', default: {} } }, components: { foundation: { kind: 'none' } } } },
  { op: 'place', tmp: '$h', def: 'house2@1', name: 'house', p: at },
  { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$h', slot: 'floor-1' }, p: [-2, 0, 1] },
  { op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', in: { parent: '$h', slot: 'floor-1' }, p: [2, 0, 1] },
  { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } },
] });
async function world() {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  const until = async (pred: () => boolean, n = 4000) => { for (let i = 0; i < n && !pred(); i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); } } await settle(2); return pred(); };
  const soul = async (owner: string, name: string) => {
    await invite(f, owner);
    const row: any = await accept(f.host, f.souls.create(`dev:${owner}`, { name, description: 'a resident' }));
    await settle(3);
    return { soulId: row.id as string, entityId: row.entity_id as string, name: row.name as string, owner: row.owner as string };
  };
  const E = f.host.engine as any;
  const doing = async (s: { soulId: string; entityId: string }, capability: string, done: () => boolean, params?: unknown) => {
    const r: any = await accept(f.host, edge.act(s as never, { capability, ...(params ? { params } : {}) }));
    assert.equal(r.accepted, true, JSON.stringify(r));
    assert.ok(await until(done), `${capability}: ${JSON.stringify(E.world.entities[s.entityId]?.human).slice(0, 200)}`);
  };
  return { ...f, god, edge, bridge, settle, until, soul, E, doing };
}
type W = Awaited<ReturnType<typeof world>>;
const cleanup = (w: W) => () => { w.brain.quiesce(); w.host.stop(); w.db.close(); };
function replayAgrees(w: W) {
  w.host.drainInputs(); w.host.saveSnapshot(true);
  const head = { engine: w.host.engine.stateHash(), kernel: kernelHash(w.host.kernel), physics: w.E.world.entityPhysicsV1.hash };
  w.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.host.worldId);
  const h = new WorldHost(w.db, factory, seed, 1e9, w.host.worldId, { durableClockV1: true });
  try {
    assert.equal(h.boot().from, 'genesis');
    assert.deepEqual({ engine: h.engine.stateHash(), kernel: kernelHash(h.kernel), physics: (h.engine as any).world.entityPhysicsV1.hash }, head, 'replay exact');
  } finally { h.stop(); }
}

test('a held thing the god removes leaves the engine too; undo of a take sets things down at the feet, never in hands; replay agrees', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  const placed = w.god.act({ ops: [{ op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', p: [10, 0] }, { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed)); await w.settle(3);
  const table = w.god.model.get('table')!.id, bowl = w.god.model.get('table/bowl')!.id, E = w.E;
  const ana = await w.soul('ana', 'Ana');
  const holding = () => E.world.entities[bowl]?.support?.kind === 'in-hand' && w.god.model.entities.get(bowl)?.in.parent === ana.entityId;
  await w.doing(ana, `pick-up:${bowl}`, holding);
  // 1. The god removes the bowl in her hands: she lets go and steps aside, and the bowl leaves the engine as well.
  const removed: any = w.god.act({ ops: [{ op: 'remove', id: bowl }] });
  assert.equal(removed.accepted, true, JSON.stringify(removed));
  assert.ok(removed.moved?.[0]?.released.includes(bowl), JSON.stringify(removed.moved));
  await w.settle(3);
  assert.ok(!(bowl in E.world.entities), 'no ghost bowl left in the engine');
  assert.ok(!(bowl in E.world.entityPhysicsV1.byEntity));
  assert.ok(!w.edge.capabilities(ana as never).some(c => c.id === `pick-up:${bowl}`), 'nothing removed is offered to pick up');
  // 2. Undo restores it at her feet, on the ground: the undo never puts it back into her hands.
  const undone: any = w.god.undo();
  assert.equal(undone.accepted, true, JSON.stringify(undone));
  assert.ok(undone.warnings.some((x: string) => x.startsWith('held.set-down: ') && x.includes('Ana')), JSON.stringify(undone.warnings));
  assert.equal(w.god.model.entities.get(bowl)!.in.parent, 'world');
  await w.settle(3);
  assert.equal(E.world.entities[bowl]?.support?.kind, 'ground', 'the engine has it on the ground');
  const feet = E.world.entities[ana.entityId].pose.p;
  assert.ok(Math.hypot(E.world.entities[bowl].pose.p[0] - feet[0], E.world.entities[bowl].pose.p[2] - feet[2]) < .2, 'at her feet');
  // 3. She picks it up again; the god moves it to the table and undoes that: it is set down at her feet, and the
  //    write-back does not quietly put it back on the table.
  await w.doing(ana, `pick-up:${bowl}`, holding);
  const toTable: any = w.god.act({ ops: [{ op: 'move', id: bowl, in: { parent: table, slot: 'top' } }] });
  assert.equal(toTable.accepted, true, JSON.stringify(toTable)); await w.settle(3);
  assert.equal(E.world.entities[bowl].support?.kind, 'resting-on');
  const back: any = w.god.undo();
  assert.equal(back.accepted, true, JSON.stringify(back));
  assert.ok(back.warnings.some((x: string) => x.startsWith('held.set-down: ')), JSON.stringify(back.warnings));
  await w.settle(30);
  assert.equal(w.god.model.entities.get(bowl)!.in.parent, 'world', 'the undo stands');
  assert.equal(E.world.entities[bowl].support?.kind, 'ground');
  assert.deepEqual(E.runtime.violations, []);
  replayAgrees(w);
});

test('the god cannot put a thing into a resident\'s hands (place or move); removing what a Soul holds walks it out instead', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  assert.equal(w.god.act({ ops: [{ op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', p: [10, 0] }, { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } }] }).accepted, true);
  await w.settle(3);
  const ana = await w.soul('ana', 'Ana'), bo = await w.soul('bo', 'Bo'), bowl = w.god.model.get('table/bowl')!.id;
  for (const batch of [{ ops: [{ op: 'place', def: coreRef('bowl'), name: 'gift', in: { parent: ana.entityId, slot: 'carry' } }] }, { ops: [{ op: 'move', id: bowl, in: { parent: ana.entityId, slot: 'carry' } }] }]) {
    for (const r of [w.god.dryrun(batch), w.god.act(batch)] as any[]) {
      assert.equal(r.accepted, false, JSON.stringify(r)); assert.equal(r.failures[0].code, 'body.protected'); assert.match(r.failures[0].detail, /Ana's hands are theirs/);
    }
  }
  await w.doing(ana, `pick-up:${bowl}`, () => w.E.world.entities[bowl]?.support?.kind === 'in-hand' && w.god.model.entities.get(bowl)?.in.parent === ana.entityId);
  const handOver: any = w.god.act({ ops: [{ op: 'move', id: bowl, in: { parent: bo.entityId, slot: 'carry' } }] });
  assert.equal(handOver.accepted, false); assert.equal(handOver.failures[0].code, 'body.protected'); assert.match(handOver.failures[0].detail, /Bo's hands are theirs/);
  assert.equal(w.god.model.entities.get(bowl)!.in.parent, ana.entityId, 'refused: she still holds it');
});

test('a wide raise over seated and napping residents moves them (walked or relocated), never leaves them inside the ground', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [10, 0] }, { op: 'place', def: coreRef('bed'), name: 'bed', p: [16, 6] }] }).accepted, true);
  await w.settle(3);
  const E = w.E, bench = w.god.model.get('bench')!.id;
  const dee = await w.soul('dee', 'Dee'), fay = await w.soul('fay', 'Fay');
  await w.doing(dee, `sit:${bench}`, () => E.world.entities[dee.entityId].human.activity === 'sit', { seconds: 600 });
  // lane walk (E2#10): core beds refuse sleep, so Fay naps on the ground (the raise covers the whole world)
  await w.doing(fay, 'nap:here', () => E.world.entities[fay.entityId].human.activity === 'nap', { seconds: 600 });
  const [x0, z0, x1, z1] = w.god.model.ground().extent, area = [[Math.max(x0 + 2, -90), Math.max(z0 + 2, -90)], [Math.min(x1 - 2, 110), Math.max(z0 + 2, -90)], [Math.min(x1 - 2, 110), Math.min(z1 - 2, 90)], [Math.max(x0 + 2, -90), Math.min(z1 - 2, 90)]];
  const r: any = w.god.act({ ops: [{ op: 'place', def: coreRef('plateau'), name: 'terrace', shape: { area }, params: { height: 6, edge: 4 } }] });
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(w.god.model.terrain.sample(10, 0) > 5, 'the ground rose');
  for (const s of [dee, fay]) {
    const m = r.moved?.find((x: any) => x.soulId === s.soulId);
    assert.ok(m, `${s.name} is in the receipt: ${JSON.stringify(r.moved)}`); assert.ok(['walked', 'relocated'].includes(m.how));
    const b = E.world.entities[s.entityId];
    assert.equal(b.human.activity, 'idle', `${s.name} is up`); assert.equal(E.programOf(s.entityId), null);
    assert.deepEqual([b.pose.p[0], b.pose.p[2]], m.to, 'the engine has it at its exit');
  }
  assert.ok(!r.warnings.some((x: string) => x.startsWith('body.stuck')), JSON.stringify(r.warnings));
  await w.settle(4); assert.deepEqual(E.runtime.violations, []);
});

test('an upstairs resident whose chair is moved steps aside on its own floor, not down to the ground', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  assert.equal(w.god.act(HOUSE_BATCH(), 'two-floor house').accepted, true); await w.settle(3);
  const E = w.E, chair = w.god.model.get('house/chair')!.id, cy = await w.soul('cy', 'Cy');
  await w.doing(cy, `sit:${chair}`, () => E.world.entities[cy.entityId].human.activity === 'sit', { seconds: 600 });
  assert.equal(E.world.entities[cy.entityId].human.level, 1, 'seated upstairs');
  const r: any = w.god.act({ ops: [{ op: 'move', id: chair, p: [-0.4, 0, 1] }] });
  assert.equal(r.accepted, true, JSON.stringify(r));
  const m = r.moved?.[0]; assert.ok(m, JSON.stringify(r)); assert.equal(m.how, 'walked'); assert.equal(m.level, 1, JSON.stringify(m));
  assert.equal(m.reason, 'The god is moving the chair; you stood up and stepped aside.');
  const b = E.world.entities[cy.entityId];
  assert.equal(b.human.level, 1, 'still upstairs'); assert.equal(b.human.activity, 'idle'); assert.deepEqual([b.pose.p[0], b.pose.p[2]], m.to);
  await w.settle(4); assert.deepEqual(E.runtime.violations, []);
  replayAgrees(w);
});

test('a resident still walking to a bench the god moves stops where it is (its body stays) and is told why', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [10, 0] }] }).accepted, true); await w.settle(3);
  const E = w.E, bench = w.god.model.get('bench')!.id, dee = await w.soul('dee', 'Dee');
  await accept(w.host, w.host.enqueue('edge-relocate', 'test:approach', { soulId: dee.soulId, entityId: dee.entityId, to: [-6, 8], why: 'approach fixture' })); await w.settle(2);
  const sit: any = await accept(w.host, w.edge.act(dee as never, { capability: `sit:${bench}`, params: { seconds: 600 } }));
  assert.equal(sit.accepted, true, JSON.stringify(sit));
  const approaching = () => E.bodyUsesV1(bench)?.body === dee.entityId && E.world.entities[dee.entityId].human.activity !== 'sit' && Math.hypot(E.world.entities[dee.entityId].pose.p[0] - 10, E.world.entities[dee.entityId].pose.p[2]) > 3;
  for (let i = 0; i < 400 && !approaching(); i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } }
  assert.ok(approaching(), `on the way with the seat claimed: ${JSON.stringify(E.world.entities[dee.entityId].human).slice(0, 200)}`);
  const r: any = w.god.act({ ops: [{ op: 'move', id: bench, p: [12, 0] }] });
  assert.equal(r.accepted, true, JSON.stringify(r));
  const m = r.moved?.[0]; assert.equal(m?.how, 'stopped', JSON.stringify(r.moved)); assert.equal(m.reason, 'The god is moving the bench you were heading for; you stopped.');
  assert.ok(r.warnings.some((x: string) => x.startsWith('body.stopped: Dee')), JSON.stringify(r.warnings));
  await w.settle(3);
  const p = E.world.entities[dee.entityId].pose.p;
  assert.ok(Math.hypot(p[0] - m.from[0], p[2] - m.from[1]) < .6, `the body stays about where it was: ${p} vs ${m.from}`);
  assert.equal(E.programOf(dee.entityId), null, 'its act ended'); assert.equal(E.bodyUsesV1(bench), null, 'the seat is free');
  await w.settle(4); assert.deepEqual(E.runtime.violations, []);
});

test('dry runs and previews show who would be walked out and move nobody; native minds hear notices and wake', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [10, 0] }] }).accepted, true); await w.settle(3);
  const E = w.E, bench = w.god.model.get('bench')!.id, dee = await w.soul('dee', 'Dee');
  await w.doing(dee, `sit:${bench}`, () => E.world.entities[dee.entityId].human.activity === 'sit', { seconds: 600 });
  const before = structuredClone(E.world.entities[dee.entityId]);
  for (const r of [w.god.dryrun({ ops: [{ op: 'remove', id: bench }] }), w.god.preview({ ops: [{ op: 'remove', id: bench }] })] as any[]) {
    assert.equal(r.accepted, true, JSON.stringify(r));
    assert.deepEqual(r.wouldMove?.map((m: any) => [m.name, m.how]), [['Dee', 'walked']]); assert.match(r.wouldMove[0].reason, /^The god is removing the bench; you stood up/);
  }
  assert.deepEqual(E.world.entities[dee.entityId], before, 'nobody moved'); assert.ok(w.god.model.entities.has(bench));
  // The walk-out itself wakes the resident's mind (it re-thinks next tick) and is in its memory.
  const tick = E.world.tick, r: any = w.god.act({ ops: [{ op: 'remove', id: bench }] }), mind = w.host.minds.get(dee.soulId)!;
  assert.equal(r.accepted, true);
  assert.ok(mind.nextEvalTick <= tick + 1, `woken: ${mind.nextEvalTick} vs ${tick}`); assert.equal(mind.evalTrigger, 'god-change');
  assert.ok(mind.recent.includes(r.moved[0].reason));
  // R8: a plain notice (nobody moved) reaches a native mind through the log when asked, and its next observation.
  mind.nextEvalTick = tick + 1000;
  w.bridge.notices.notify(dee.soulId, { text: 'The god planted a garden near you.', tick: E.world.tick, place: 'garden', native: true });
  await w.settle(2);
  assert.ok(mind.recent.includes('The god planted a garden near you.')); assert.ok(mind.nextEvalTick <= E.world.tick + 1);
  assert.equal((w.edge.observe(dee as never, new Set()) as any).notices[0].text, 'The god planted a garden near you.');
  replayAgrees(w);
});

test('a walk-out the engine refuses at fold time is named in the durable receipt and told truthfully', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [10, 0] }] }).accepted, true); await w.settle(3);
  const E = w.E, bench = w.god.model.get('bench')!.id, dee = await w.soul('dee', 'Dee');
  await w.doing(dee, `sit:${bench}`, () => E.world.entities[dee.entityId].human.activity === 'sit', { seconds: 600 });
  const walkout = E.godWalkoutV1; E.godWalkoutV1 = () => false;
  let r: any;
  try { r = w.god.act({ clientRef: 'refused-landing', ops: [{ op: 'remove', id: bench }] }); } finally { E.godWalkoutV1 = walkout; }
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(r.warnings.some((x: string) => x.startsWith('body.stuck: Dee')), JSON.stringify(r.warnings));
  assert.ok(w.god.store.receipt('refused-landing')!.result.warnings.some((x: string) => x.startsWith('body.stuck: Dee')), 'the durable receipt names it too');
  assert.deepEqual(w.god.act({ clientRef: 'refused-landing', ops: [{ op: 'remove', id: bench }] }), { ...r, replayed: true });
  assert.match((w.edge.observe(dee as never, new Set()) as any).notices[0].text, /you could not step clear, so you stayed where you were\.$/);
});

// Z3: work budgets, not milliseconds (see @souls/world-compiler/work-meter): the same answer on any CPU, so it runs in the gate.
// Measured 2026-10-20, identical on every run: moving the hut (16 residents among 1,217 entities) 223,022 in all, planning
// 134,023, moves 60,237; moving it back over 7 of them 104,160. Budgets are 1.5x of the larger edit (the real engine
// leaves a little run-to-run slack: 222,067 when the whole file runs first).
const BRIDGE_WORK = { edit: 335_000, prepare: 200_000, apply: 90_000 };
test('bench: a real-engine walk-out of 16 residents among many entities', { timeout: 600000 }, async t => {
  const w = await world(); w.brain.quiesce(); t.after(cleanup(w));
  await w.settle(2);
  const filler: unknown[] = [];
  for (let i = 0; i < 1200; i++) filler.push({ op: 'place', def: coreRef(i % 3 ? 'bench' : 'lamp-post'), p: [-60 + (i % 40) * 3, 20 + Math.floor(i / 40) * 3.2] });
  for (let i = 0; i < filler.length; i += 200) assert.equal(w.god.act({ ops: filler.slice(i, i + 200) }).accepted, true);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('cottage'), name: 'hut', p: [0, -20], params: { w: 14, d: 10 } }] }).accepted, true);
  await w.settle(3);
  const residents = [];
  for (let i = 0; i < 16; i++) residents.push(await w.soul(`r${i}`, `R${i}`));
  for (const [i, s] of residents.entries()) await accept(w.host, w.host.enqueue('edge-relocate', 'test:bench', { soulId: s.soulId, entityId: s.entityId, to: [-4.5 + (i % 4) * 2.5, -23 + Math.floor(i / 4) * 2], why: 'bench fixture' }));
  await w.settle(3);
  // Count the planning (prepare) and the moves (apply) apart from the rest of the edit.
  const bodies = w.god.bodies!, spent = { prepare: 0, apply: 0 }, metered = <T>(key: keyof typeof spent, fn: () => T) => { const { value, work } = meter(fn); spent[key] += work.total; return value; };
  w.god.bodies = { ...bodies, prepare: (...a) => metered('prepare', () => bodies.prepare!(...a)), apply: (m) => metered('apply', () => bodies.apply!(m)) };
  for (const [label, ops] of [['moved hut', [{ op: 'move', id: 'hut', p: [30, -20] }]], ['moved back over them', [{ op: 'move', id: 'hut', p: [2, -21] }]]] as const) {
    spent.prepare = spent.apply = 0;
    const t0 = performance.now(), { value: r, work: total }: { value: any; work: Work } = meter(() => w.god.act({ ops })), ms = performance.now() - t0;
    console.log(`${label}: ${r.moved?.length ?? 0} residents moved among ${w.god.model.entities.size} entities in ${ms.toFixed(0)} ms; work ${total.total} (planning ${spent.prepare}, moves ${spent.apply}) ${JSON.stringify(total)}`);
    assert.equal(r.accepted, true); assert.ok(r.moved?.length > 0, 'residents were moved');
    assert.ok(total.total <= BRIDGE_WORK.edit, `edit work ${total.total}`); assert.ok(spent.prepare <= BRIDGE_WORK.prepare, `planning work ${spent.prepare}`); assert.ok(spent.apply <= BRIDGE_WORK.apply, `moves work ${spent.apply}`);
    await w.settle(3);
  }
});
