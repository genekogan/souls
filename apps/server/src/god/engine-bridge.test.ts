// Lane L9 (spec eden4/31 B2/B3): Souls among god-built things, through the real host, sequencer, edge ledger and
// compiler. The god builds a two-floor house (door, stairs, a chair and a table with a bowl upstairs); a Soul born
// through the owner flow enters, climbs, sits; god edits walk residents clear; the Soul picks up the bowl
// (the journal shows the engine's move), puts it on the table, prays; replay from genesis agrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { kernelHash } from '@souls/kernel';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory, seed } from '../../test/native-owner-fixture.ts';
import { WorldHost } from '../world.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const HOUSE_BATCH = (at: [number, number] = [10, 0]) => ({ ops: [
  { op: 'define', def: { schema: 'def/1', name: 'house2', version: 1, description: 'A two-floor house.', tags: ['building'], size: { box: [8, 6, 6] }, make: { kind: 'gen', gen: 'building/1' }, params: { floors: { type: 'int', min: 1, max: 6, default: 2 } }, state: { doors: { type: 'json', default: {} } }, components: { foundation: { kind: 'none' } } } },
  { op: 'place', tmp: '$h', def: 'house2@1', name: 'house', p: at },
  { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$h', slot: 'floor-1' }, p: [-2, 0, 1] },
  { op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', in: { parent: '$h', slot: 'floor-1' }, p: [2, 0, 1] },
  { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } },
] });

async function world(dbFile = ':memory:') {
  const f = fixture(dbFile, factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  return { ...f, god, edge, bridge, settle };
}

async function until(w: Awaited<ReturnType<typeof world>>, pred: () => boolean, n = 4000) {
  for (let i = 0; i < n && !pred(); i++) {
    w.host.tickOnce();
    if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); }
  }
  await w.settle(2);
  return pred();
}

function movedResident(result: any, soul: { soulId: string; entityId: string; name: string }, how?: 'walked' | 'relocated') {
  assert.equal(result.accepted, true, JSON.stringify(result));
  const moved = result.moved?.find((m: any) => m.soulId === soul.soulId);
  assert.ok(moved, `resident movement in receipt: ${JSON.stringify(result)}`);
  assert.equal(moved.body, soul.entityId); assert.equal(moved.name, soul.name);
  assert.ok(['walked', 'relocated'].includes(moved.how));
  if (how) assert.equal(moved.how, how, JSON.stringify(moved));
  assert.equal(moved.from.length, 2); assert.equal(moved.to.length, 2);
  assert.notDeepEqual(moved.to, moved.from, 'the resident leaves the affected footprint');
  assert.match(moved.reason, /god/i); assert.ok(Array.isArray(moved.released));
  assert.ok(result.warnings.some((warning: string) => warning.startsWith(`body.${moved.how === 'walked' ? 'walked-out' : 'relocated'}: ${soul.name} `)), JSON.stringify(result.warnings));
  return moved;
}

test('definition edits and their undo/redo update the native engine physics', async t => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  const definition = (size: [number, number, number]) => ({ schema: 'def/1', name: 'bridge-post', size: { box: size }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, size[1] / 2, 0], size }] } } });
  assert.equal(w.god.act({ ops: [{ op: 'define', def: definition([0.5, 1, 0.5]) }, { op: 'place', def: 'bridge-post@1', name: 'post', p: [0, 0] }] }).accepted, true);
  await w.settle(2);
  const id = w.god.model.get('post')!.id, engine = w.host.engine as any;
  const solids = () => structuredClone(engine.world.entityPhysicsV1.byEntity[id].solids);
  const before = solids();
  assert.equal(w.god.act({ ops: [{ op: 'define', def: definition([2, 3, 2]) }] }).accepted, true);
  await w.settle(2); const changed = solids(); assert.notDeepEqual(changed, before);
  assert.equal(w.god.undo().accepted, true); await w.settle(2); assert.deepEqual(solids(), before);
  assert.equal(w.god.redo().accepted, true); await w.settle(2); assert.deepEqual(solids(), changed);
});

test('Souls among god-built things: enter, climb, sit, carry, pray; god walks them clear; replay agrees', { timeout: 600000 }, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const r = w.god.act(HOUSE_BATCH(), 'two-floor house');
  assert.equal(r.accepted, true, JSON.stringify(r));
  await w.settle(3);
  const E = w.host.engine as any, ids = Object.fromEntries(['house', 'house/chair', 'house/table', 'house/table/bowl'].map((p) => [p, w.god.model.get(p)!.id]));
  const ep = E.world.entityPhysicsV1;
  assert.ok(ep?.byEntity[ids.house]?.solids?.length >= 5, 'walls');
  assert.ok(ep.byEntity[ids.house].surfaces.some((x: any) => x.level === 1), 'an upper floor');
  assert.equal(ep.byEntity[ids.house].links.length, 1, 'its own stairs (L2 building/1)');
  assert.ok(E.world.entities[ids['house/chair']]?.tags.includes('entity-world'), 'chair registered with the same id');
  assert.equal(E.world.entities[ids['house/table/bowl']]?.support?.kind, 'resting-on');
  // reach: from the lawn to the upstairs room, through the door and up the stairs
  const reach = runQuery(w.god.model, { reach: { from: [10, 9], to: 'house:floor-1' } }).reach as any;
  assert.equal(reach.reachable, true, JSON.stringify(reach)); assert.ok(reach.levels.includes(1));

  // a Soul born through the owner flow gets a body entity with the engine's id
  await invite(w, 'ana');
  const row: any = await accept(w.host, w.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await w.settle(3);
  const body = w.god.model.entities.get(row.entity_id);
  assert.ok(body && w.god.model.resolvedDef(body.def)?.components.body, 'body entity in the entity world');
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const caps = w.edge.capabilities(soul);
  for (const id of [`sit:${ids['house/chair']}`, `pick-up:${ids['house/table/bowl']}`, 'pray']) assert.ok(caps.some((c) => c.id === id), `${id} offered: ${caps.map((c) => c.id).slice(0, 30).join(' ')}`);

  const sit: any = await accept(w.host, w.edge.act(soul, { capability: `sit:${ids['house/chair']}`, params: { seconds: 600 } }));
  assert.equal(sit.accepted, true, JSON.stringify(sit));
  assert.ok(await until(w, () => E.world.entities[row.entity_id].human.activity === 'sit'), 'seated');
  assert.equal(E.world.entities[row.entity_id].human.level, 1, 'upstairs');

  // Preview and invalid batches never interrupt a resident's act or move their body.
  assert.deepEqual((runQuery(w.god.model, { entity: 'house/chair' }).entity as any).usedBy, { soul: 'Ana', body: row.entity_id, how: 'occupied', thing: 'house/chair' }, 'query shows who uses it');
  const residentBefore = structuredClone(E.world.entities[row.entity_id]), programBefore = E.programOf(row.entity_id);
  const dry: any = w.god.dryrun({ ops: [{ op: 'remove', id: ids['house/chair'] }] });
  assert.equal(dry.accepted, true, JSON.stringify(dry));
  assert.deepEqual(E.world.entities[row.entity_id], residentBefore); assert.equal(E.programOf(row.entity_id), programBefore);
  assert.ok(w.god.model.entities.has(ids['house/chair']), 'preview leaves the chair intact');
  const invalid: any = w.god.act({ ops: [{ op: 'remove', id: ids['house/chair'] }, { op: 'remove', id: 'missing-thing' }] });
  assert.equal(invalid.accepted, false); assert.equal(invalid.failures[0].code, 'entity.unknown');
  assert.deepEqual(E.world.entities[row.entity_id], residentBefore); assert.equal(E.programOf(row.entity_id), programBefore);
  assert.ok(w.god.model.entities.has(ids['house/chair']), 'failed batch leaves the chair intact');
  // Each batch uses one compiler scratch, including a body-aware preview.
  const model = w.god.model as any, fork = model.fork; let forks = 0; model.fork = function (this: unknown) { forks++; return fork.call(this); };
  try {
    assert.equal((w.god.dryrun({ ops: [{ op: 'remove', id: ids['house/chair'] }] }) as any).accepted, true);
    assert.equal(forks, 1, 'an occupied edit preview is planned once');
    assert.equal((w.god.dryrun({ ops: [{ op: 'place', def: coreRef('bench'), name: 'lawn-bench', p: [10, 14] }] }) as any).accepted, true);
    assert.equal(forks, 2, 'a harmless batch is planned once');
  } finally { model.fork = fork; }
  // pick up the bowl: stand, walk to the table, take it; the journal shows the engine's move into her hands
  const pick: any = await accept(w.host, w.edge.act(soul, { capability: `pick-up:${ids['house/table/bowl']}` }));
  assert.equal(pick.accepted, true, JSON.stringify(pick));
  assert.ok(await until(w, () => E.world.entities[ids['house/table/bowl']].support?.kind === 'in-hand' && w.god.model.entities.get(ids['house/table/bowl'])!.in.parent === row.entity_id), 'carried, written back');
  const journal = w.god.store.edits(10);
  assert.ok(journal.some((e) => e.by === 'engine' && e.ops.some((o: any) => o.op === 'move' && o.id === ids['house/table/bowl'])), 'journaled by the engine');
  const held: any = w.god.act({ ops: [{ op: 'move', id: ids['house/table/bowl'], in: { parent: ids['house/table'], slot: 'top' } }] });
  const released = movedResident(held, soul);
  assert.ok(released.released.includes(ids['house/table/bowl']), 'the held bowl is released');
  assert.notEqual(E.world.entities[ids['house/table/bowl']].support?.kind, 'in-hand', 'release happens in the edit request');
  await w.settle(3);
  assert.equal(w.god.model.entities.get(ids['house/table/bowl'])!.in.parent, ids['house/table']);
  assert.equal(E.world.entities[ids['house/table/bowl']].support?.kind, 'resting-on');
  const pickAgain: any = await accept(w.host, w.edge.act(soul, { capability: `pick-up:${ids['house/table/bowl']}` }));
  assert.equal(pickAgain.accepted, true, JSON.stringify(pickAgain));
  assert.ok(await until(w, () => E.world.entities[ids['house/table/bowl']].support?.kind === 'in-hand' && w.god.model.entities.get(ids['house/table/bowl'])!.in.parent === row.entity_id), 'carried again after the god edit');
  // put it on the table
  const caps2 = w.edge.capabilities(soul);
  assert.ok(caps2.some((c) => c.id === `put-on:${ids['house/table']}`), 'put-on offered');
  const put: any = await accept(w.host, w.edge.act(soul, { capability: `put-on:${ids['house/table']}` }));
  assert.equal(put.accepted, true, JSON.stringify(put));
  assert.ok(await until(w, () => w.god.model.entities.get(ids['house/table/bowl'])!.in.parent === ids['house/table']), 'back on the table in the entity world');
  // pray, and the god answers
  const pray: any = await w.edge.act(soul, { capability: 'pray', params: { text: 'May the house have a garden?' } });
  assert.equal(pray.accepted, true, JSON.stringify(pray));
  const prayer = w.god.store.prayers({ unanswered: true })[0];
  assert.equal(prayer.soul_id, soul.soulId);
  const ans = w.god.act({ ops: [{ op: 'answer', prayer: prayer.id, text: 'Yes; look south tomorrow.' }] });
  assert.equal(ans.accepted, true);
  assert.equal(w.god.prayersFor(soul.soulId)[0].answer, 'Yes; look south tomorrow.');
  // A closed door blocks the lawn's route into the house after residents have been cleared if needed.
  const door = w.god.act({ ops: [{ op: 'set', id: ids.house, state: { doors: { 'front-door': 'closed' } } }] });
  assert.equal(door.accepted, true, JSON.stringify(door));
  await w.settle(3);
  assert.equal((runQuery(w.god.model, { reach: { from: [10, 9], to: 'house:ground' } }).reach as any).reachable, false, 'door closed');
  assert.deepEqual(E.runtime.violations, []);

  // replay from genesis: the engine log alone re-derives the same world (entity physics included)
  w.host.drainInputs(); w.host.saveSnapshot(true);
  const head = { engine: w.host.engine.stateHash(), kernel: kernelHash(w.host.kernel), physics: E.world.entityPhysicsV1.hash };
  w.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.host.worldId);
  const h = new WorldHost(w.db, factory, seed, 1e9, w.host.worldId, { durableClockV1: true });
  assert.equal(h.boot().from, 'genesis');
  if (h.engine.stateHash() !== head.engine) {
    const a = (w.host.engine as any).world, b = (h.engine as any).world;
    for (const id of new Set([...Object.keys(a.entities), ...Object.keys(b.entities)])) if (JSON.stringify(a.entities[id]) !== JSON.stringify(b.entities[id])) console.log('DIFF', id, JSON.stringify(a.entities[id])?.slice(0, 600), '\n   vs', JSON.stringify(b.entities[id])?.slice(0, 600));
    console.log('ticks', a.tick, b.tick, 'programs', JSON.stringify((w.host.engine as any).snapshot().programs).slice(0, 300), JSON.stringify((h.engine as any).snapshot().programs).slice(0, 300));
  }
  assert.deepEqual({ engine: h.engine.stateHash(), kernel: kernelHash(h.kernel), physics: (h.engine as any).world.entityPhysicsV1.hash }, head, 'replay exact');
  h.stop();
});

test('occupied bench removal, move, undo and redo walk the resident clear; body entities stay protected', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  assert.equal(w.god.act({ ops: [{ op: 'place', def: coreRef('bench'), name: 'bench', p: [10, 0] }] }).accepted, true);
  await w.settle(3);
  const bench = w.god.model.get('bench')!.id, E = w.host.engine as any;
  await invite(w, 'dee');
  const row: any = await accept(w.host, w.souls.create('dev:dee', { name: 'Dee', description: 'enjoys benches' }));
  await w.settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const sit = async () => {
    const r = await accept(w.host, w.edge.act(soul, { capability: `sit:${bench}`, params: { seconds: 600 } }));
    assert.equal(r.accepted, true, JSON.stringify(r));
    assert.ok(await until(w, () => E.world.entities[row.entity_id].human.activity === 'sit'), 'seated on the bench');
  };
  const clear = (r: any) => {
    const moved = movedResident(r, soul, 'walked'), b = E.world.entities[row.entity_id];
    assert.ok(moved.released.includes(bench), 'the occupied seat is released');
    assert.equal(b.human.activity, 'idle', 'standing in the edit request');
    assert.equal(b.human.level ?? 0, 0);
    assert.deepEqual([b.pose.p[0], b.pose.p[2]], moved.to, 'the engine reaches the receipt endpoint in the edit request');
    assert.ok(E.clearanceAtV1(moved.to[0], moved.to[1], 0) >= 0.27, 'clear standing point');
    return moved;
  };
  await sit();
  const bodyBefore = structuredClone(E.world.entities[row.entity_id]), entityBefore = structuredClone(w.god.model.entities.get(row.entity_id));
  for (const op of [{ op: 'remove', id: row.entity_id, cascade: true }, { op: 'move', id: row.entity_id, p: [30, 30] }, { op: 'set', id: row.entity_id, name: 'edited-resident' }]) {
    const r: any = w.god.act({ ops: [op] });
    assert.equal(r.accepted, false); assert.equal(r.failures[0].code, 'body.protected');
    assert.deepEqual(E.world.entities[row.entity_id], bodyBefore); assert.deepEqual(w.god.model.entities.get(row.entity_id), entityBefore);
  }
  const request = { clientRef: 'occupied-remove-once', ops: [{ op: 'remove', id: bench }] };
  const beforeFailure = w.god.model.snapshot(), programBefore = E.programOf(row.entity_id), commit = w.god.store.commit;
  const events = () => w.db.events(w.host.worldId, 0, 10000), eventsBefore = events().length;
  try {
    w.god.store.commit = () => { throw Error('injected SQL failure'); };
    assert.throws(() => w.god.act(request), /injected SQL failure/);
  } finally { w.god.store.commit = commit; }
  assert.deepEqual(w.god.model.snapshot(), beforeFailure, 'SQL failure keeps the authored model intact');
  assert.deepEqual(E.world.entities[row.entity_id], bodyBefore, 'SQL failure leaves the resident seated');
  assert.equal(E.programOf(row.entity_id), programBefore); assert.equal(events().length, eventsBefore, 'SQL failure emits no walk-out');
  assert.equal(w.god.store.receipt(request.clientRef), null, 'the failed request has no accepted receipt');
  const removed: any = w.god.act(request);
  const movement = clear(removed);
  assert.equal(removed.moved.length, 1, 'retry moves each resident once');
  const eventsAfter = events().length;
  assert.ok(eventsAfter > eventsBefore, 'the walk-out is durable');
  assert.deepEqual(w.god.act(request), { ...removed, replayed: true }, 'a client retry returns the original movement receipt');
  assert.equal(events().length, eventsAfter, 'a client retry emits no duplicate walk-out');
  assert.equal(w.god.model.entities.has(bench), false, 'the occupied bench is removed');
  assert.ok(JSON.stringify(w.edge.observe(soul, new Set())).includes(movement.reason), 'the next observation explains the walk-out');
  assert.equal(w.god.undo().accepted, true, 'undo restores the bench'); await w.settle(3);
  await sit();
  clear(w.god.act({ ops: [{ op: 'move', id: bench, p: [18, 0] }] })); await w.settle(3);
  await sit();
  clear(w.god.undo()); assert.equal(w.god.model.worldPose(w.god.model.entities.get(bench)!).x, 10); await w.settle(3);
  await sit();
  clear(w.god.redo()); assert.equal(w.god.model.worldPose(w.god.model.entities.get(bench)!).x, 18); await w.settle(3);
  assert.deepEqual(E.runtime.violations, []);
});

test('a redefinition walks a seated resident clear only when it re-makes the seat (and its undo); a cosmetic one moves nobody', { timeout: 300000 }, async t => {
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const seatDef = (width: number, tint = 'wood') => ({ schema: 'def/1', name: 'probe-seat', description: 'A bench for two.', tags: ['furniture', 'seat'], size: { box: [width, 0.45, 0.5] },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.225, 0], size: [width, 0.45, 0.5], tint }] } },
    slots: [{ id: 'seat-1', kind: 'seat', p: [-0.4, 0.45, 0], yaw: 0, accepts: { tags: ['body'] }, capacity: 1 }, { id: 'seat-2', kind: 'seat', p: [0.4, 0.45, 0], yaw: 0, accepts: { tags: ['body'] }, capacity: 1 }], components: { seat: { height: 0.45 } } });
  const placed: any = w.god.act({ ops: [{ op: 'define', def: seatDef(1.6) }, { op: 'place', def: 'probe-seat@1', name: 'seat', p: [10, 0] }] });
  assert.equal(placed.accepted, true, JSON.stringify(placed)); await w.settle(3);
  const seat = w.god.model.get('seat')!.id, E = w.host.engine as any;
  await invite(w, 'gus');
  const row: any = await accept(w.host, w.souls.create('dev:gus', { name: 'Gus', description: 'likes benches' }));
  await w.settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const sit = async () => {
    const r = await accept(w.host, w.edge.act(soul, { capability: `sit:${seat}`, params: { seconds: 600 } }));
    assert.equal(r.accepted, true, JSON.stringify(r));
    assert.ok(await until(w, () => E.world.entities[row.entity_id].human.activity === 'sit'), 'seated on the bench');
  };
  await sit();
  // A cosmetic redefinition (its colour) re-makes nothing anyone sits on: Gus keeps sitting.
  const recoloured: any = w.god.act({ ops: [{ op: 'define', def: seatDef(1.6, 'stone') }] });
  assert.equal(recoloured.accepted, true, JSON.stringify(recoloured)); assert.equal(recoloured.moved, undefined, JSON.stringify(recoloured.moved));
  await w.settle(20); assert.equal(E.world.entities[row.entity_id].human.activity, 'sit', 'still seated after a colour change');
  // A redefinition that re-makes it (twice as wide) walks him clear, in the same request.
  const redefined: any = w.god.act({ ops: [{ op: 'define', def: seatDef(3.2, 'stone') }] });
  const moved = movedResident(redefined, soul, 'walked');
  assert.ok(moved.released.includes(seat)); assert.equal(E.world.entities[row.entity_id].human.activity, 'idle');
  assert.equal(moved.reason, 'The god is rebuilding the seat; you stood up and stepped aside.');
  assert.equal(w.god.model.footprintsOf(seat)[0].half[0], 1.6, 'the definition applies in the same request');
  await w.settle(3); await sit();
  movedResident(w.god.undo(), soul, 'walked');
  assert.equal(w.god.model.footprintsOf(seat)[0].half[0], 0.8, 'undo rebinds the narrower definition');
  await w.settle(3); assert.deepEqual(E.runtime.violations, []);
});

test('raising terrain under a napping resident wakes them and walks them off the affected footprint', { timeout: 300000 }, async t => {
  // Integration with lane walk (E2#10): core beds refuse lie/sleep until they have native berth support, so the
  // resident naps on the ground and the knoll rises where it lies.
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  await invite(w, 'fay');
  const row: any = await accept(w.host, w.souls.create('dev:fay', { name: 'Fay', description: 'takes naps' }));
  await w.settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner }, E = w.host.engine as any;
  const nap: any = await accept(w.host, w.edge.act(soul, { capability: 'nap:here', params: { seconds: 600 } }));
  assert.equal(nap.accepted, true, JSON.stringify(nap));
  assert.ok(await until(w, () => E.world.entities[row.entity_id].human.activity === 'nap'), 'napping on the ground');
  const p = E.world.entities[row.entity_id].pose.p, at: [number, number] = [Math.round(p[0] * 100) / 100, Math.round(p[2] * 100) / 100];
  const r: any = w.god.act({ ops: [{ op: 'place', def: coreRef('knoll'), name: 'mound', p: at, params: { height: 4, radius: 5 } }] });
  const movement = movedResident(r, soul, 'walked'), b = E.world.entities[row.entity_id];
  assert.equal(b.human.activity, 'idle', 'the resident wakes in the edit request'); assert.equal(E.programOf(row.entity_id), null, 'the nap ended');
  assert.match(movement.reason, /you woke/);
  assert.ok(w.god.model.terrain.sample(movement.to[0], movement.to[1]) <= 0.25, 'off the raised ground (it rose by no more than a step where the resident stands)');
  assert.deepEqual([b.pose.p[0], b.pose.p[2]], movement.to);
  await w.settle(4);
  assert.ok(w.god.model.get('mound')); assert.ok(w.god.model.terrain.sample(at[0], at[1]) > 3, 'terrain edit applies');
  assert.deepEqual(E.runtime.violations, []);
});

test('a god edit that would bury a standing Soul lifts it clear, and says so', { timeout: 300000 }, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  await invite(w, 'bo');
  const row: any = await accept(w.host, w.souls.create('dev:bo', { name: 'Bo', description: 'stands still' }));
  await w.settle(3);
  const E = w.host.engine as any, b = E.world.entities[row.entity_id], at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  const r: any = w.god.act({ ops: [{ op: 'place', def: coreRef('wall'), name: 'wall', p: at, params: { w: 4, h: 2.6, d: 0.5 } }] });
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(r.warnings.some((x: string) => /^body\.(walked-out|relocated): Bo /.test(x)), JSON.stringify(r.warnings));
  assert.equal(r.moved?.[0]?.name, 'Bo', 'the receipt lists who moved'); assert.match(r.moved[0].reason, /The god is building the wall/);
  await w.settle(4);
  const p = E.world.entities[row.entity_id].pose.p;
  assert.ok(Math.abs(p[2] - at[1]) > 0.5 || Math.abs(p[0] - at[0]) > 2.2, `Bo stepped clear: ${p} (was ${at})`);
  assert.ok(E.clearanceAtV1(p[0], p[2]) >= 0.27, 'standing on clear ground');
  assert.deepEqual(E.runtime.violations, []);
  // retirement removes the body entity from the entity world
  assert.ok(w.god.model.entities.has(row.entity_id));
  await accept(w.host, w.souls.retire(w.db.soul(row.id)!));
  await w.settle(4);
  assert.equal(w.god.model.entities.has(row.entity_id), false, 'body entity archived');
});

test('L3 shapes in the engine: a garden wall makes Souls go round, a deck is walkable, a far road does not widen the raster', { timeout: 300000 }, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const before = runQuery(w.god.model, { reach: { from: [0, 0], to: [0, 12] } }).reach as any;
  assert.equal(before.reachable, true, JSON.stringify(before));
  const r: any = w.god.act({ ops: [
    { op: 'place', def: coreRef('garden-wall'), name: 'wall', shape: { path: [[-12, 6], [12, 6]] }, params: { gates: 0 } },
    { op: 'place', def: coreRef('deck'), name: 'deck', shape: { area: [[-4, -18], [4, -18], [4, -12], [-4, -12]] } },
    // the deck (0.6 m, rails all round) is a floor of its own: a short flight against its north edge is the way on
    { op: 'define', def: { schema: 'def/1', name: 'deck-steps', version: 1, description: 'Three steps up to a deck.', tags: ['stairs'], form: 'point', size: { box: [1.2, 0.6, 1.2] }, make: { kind: 'gen', gen: 'stairs/1' }, params: { rise: { type: 'number', min: 0.3, max: 12, default: 0.6 }, run: { type: 'number', min: 0.5, max: 20, default: 1.2 }, width: { type: 'number', min: 0.6, max: 6, default: 1.2 } } } },
    { op: 'place', def: 'deck-steps@1', name: 'steps', p: [0, -11.4] },
    { op: 'place', def: coreRef('road'), name: 'far-road', shape: { path: [[200, -100], [200, 100]] } },
  ] });
  if (!r.accepted) { t.diagnostic(JSON.stringify(r).slice(0, 600)); }
  assert.equal(r.accepted, true);
  await w.settle(3);
  const E = w.host.engine as any, ep = E.world.entityPhysicsV1;
  const wall = w.god.model.get('wall')!.id, deck = w.god.model.get('deck')!.id, road = w.god.model.get('far-road')!.id;
  assert.ok(ep.byEntity[wall]?.solids?.length, 'wall solids');
  assert.ok(ep.byEntity[deck]?.surfaces?.length, 'deck floor');
  assert.equal(ep.byEntity[road], undefined, 'a road is ground cover, not engine physics');
  assert.ok(!ep.bounds || ep.bounds.every((v: number) => Math.abs(v) <= 64), `raster bounded: ${ep.bounds}`);
  const after = runQuery(w.god.model, { reach: { from: [0, 0], to: [0, 12] } }).reach as any;
  assert.equal(after.reachable, true, JSON.stringify(after));
  assert.ok(after.length > before.length + 8, `goes round the wall: ${before.length} → ${after.length}`);
  const onDeck = runQuery(w.god.model, { reach: { from: [0, 0], to: 'deck' } }).reach as any;
  assert.equal(onDeck.reachable, true, JSON.stringify(onDeck));
  assert.ok(onDeck.to.level > 0 && onDeck.to.p[1] < -12, `on the deck's own floor: ${JSON.stringify(onDeck.to)}`);
  // a fence across the south field with one gate set closed (a bare gate is an open gap, SEALED): Souls go round it;
  // opening the gate lets them through
  const r2: any = w.god.act({ ops: [
    { op: 'place', def: coreRef('fence'), name: 'fence', shape: { path: [[-40, -22], [40, -22]] }, params: { gates: [{ at: 40, width: 1.6, state: 'closed' }] } },
    { op: 'place', def: coreRef('footbridge'), name: 'span', shape: { path: [[20, -8], [20, 8]] } },
  ] });
  assert.equal(r2.accepted, true, JSON.stringify(r2).slice(0, 600));
  await w.settle(3);
  const fence = w.god.model.get('fence')!.id, span = w.god.model.get('span')!;
  const gate = (E.world.entityPhysicsV1.byEntity[fence]?.solids ?? []).find((x: any) => x.id.endsWith('#door:gate-1'));
  assert.ok(gate, 'closed gate blocks its gap');
  assert.ok(Math.abs(gate.y0 - w.god.model.terrain.sample(0, -22)) < 0.05 && gate.y1 - gate.y0 > 0.8, `gate stands on the ground: ${gate.y0}..${gate.y1}`);
  // the fence runs past both edges of the field, so a closed gate cuts the south strip off
  const shut = runQuery(w.god.model, { reach: { from: [0, -20], to: [0, -26] } }).reach as any;
  assert.equal(shut.reachable, false, `closed gate: ${JSON.stringify(shut).slice(0, 200)}`);
  const r3: any = w.god.act({ ops: [{ op: 'set', id: fence, params: { gates: [{ at: 40, width: 1.6, state: 'open' }] } }] });
  assert.equal(r3.accepted, true, JSON.stringify(r3).slice(0, 400));
  await w.settle(3);
  assert.ok(!(E.world.entityPhysicsV1.byEntity[fence]?.solids ?? []).some((x: any) => x.id.includes('#door:')), 'open gate: no blocker');
  const open = runQuery(w.god.model, { reach: { from: [0, -20], to: [0, -26] } }).reach as any;
  assert.equal(open.reachable, true, JSON.stringify(open));
  assert.ok(open.length < 12, `through the open gate: ${open.length}`);
  // a footbridge: deck quads on level 0 at their own (absolute) heights, rails block, the deck is reachable
  const sp = E.world.entityPhysicsV1.byEntity[span.id];
  t.diagnostic(`footbridge params.at=${JSON.stringify(span.params?.at)} surfaces=${sp?.surfaces?.length} rails=${sp?.solids?.length}`);
  assert.ok(sp?.surfaces?.length >= 2 && sp.surfaces.every((x: any) => x.level === 0), 'deck quads on level 0');
  const onSpan = runQuery(w.god.model, { reach: { from: [20, -12], to: [20, 0] } }).reach as any;
  assert.equal(onSpan.reachable, true, JSON.stringify(onSpan));
});

test('Souls in an L2 cottage: lawn → front door → stairs → bedroom chair; rooms are reach ends', { timeout: 300000}, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const r: any = w.god.act({ ops: [
    { op: 'define', def: { schema: 'def/1', name: 'cottage2', version: 1, description: 'A two-floor cottage.', tags: ['building'], size: { box: [8, 6, 6] }, make: { kind: 'gen', gen: 'building/1' }, params: { floors: { type: 'int', min: 1, max: 6, default: 2 } }, components: { foundation: { kind: 'none' } } } },
    { op: 'place', tmp: '$h', def: 'cottage2@1', name: 'house', p: [10, 0] },
    { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$h', slot: 'floor-1' }, p: [-2, 0, 1] },
  ] });
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600));
  await w.settle(3);
  const E = w.host.engine as any, house = w.god.model.get('house')!.id, chair = w.god.model.get('house/chair')!.id;
  const part = E.world.entityPhysicsV1.byEntity[house];
  t.diagnostic(`cottage: ${part.solids.length} solids, ${part.surfaces.length} floors on levels ${[...new Set(part.surfaces.map((x: any) => x.level))]}, ${part.links?.length ?? 0} links; levels ${JSON.stringify(E.world.entityPhysicsV1.levels)}`);
  assert.ok(part.links?.length >= 1, 'stairs link');
  assert.ok(part.surfaces.some((x: any) => x.level === 1), 'upper floor');
  for (const l of part.links) { const a = l.from.p, z = l.to.p; t.diagnostic(`link ${l.id} ${l.from.level}→${l.to.level} bottom ${a} clear0=${E.clearanceAtV1(a[0], a[1], l.from.level).toFixed(2)} top ${z} clear1=${E.clearanceAtV1(z[0], z[1], l.to.level).toFixed(2)}; mid-landing clear1=${E.clearanceAtV1(10, -1.35, 1).toFixed(2)} bedroom=${E.clearanceAtV1(8.08, 1, 1).toFixed(2)} approach=${JSON.stringify(l.approach)} ${l.approach?.from ? `a0=${E.clearanceAtV1(l.approach.from[0], l.approach.from[1], 0).toFixed(2)}` : ""} ${l.approach?.to ? `a1=${E.clearanceAtV1(l.approach.to[0], l.approach.to[1], 1).toFixed(2)}` : ""} heading=${l.heading}`); }
  // a three-storey house: two flights, the second turning back over the first
  const r3: any = w.god.act({ ops: [{ op: 'place', def: 'cottage2@1', name: 'tall', p: [-12, 14], params: { floors: 3 } }] });
  assert.equal(r3.accepted, true, JSON.stringify(r3).slice(0, 400));
  await w.settle(3);
  for (const to of ['house:living', 'house:bedroom', 'house:bedroom-2', 'house:floor-1', 'tall:floor-2']) {
    const q = runQuery(w.god.model, { reach: { from: [10, 10], to } }).reach as any;
    t.diagnostic(`reach ${to}: ${JSON.stringify(q).slice(0, 220)}`);
    assert.equal(q.reachable, true, `${to}: ${JSON.stringify(q)}`);
  }
  await invite(w, 'cy');
  const row: any = await accept(w.host, w.souls.create('dev:cy', { name: 'Cy', description: 'sits upstairs' }));
  await w.settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const sit: any = await accept(w.host, w.edge.act(soul, { capability: `sit:${chair}`, params: { seconds: 600 } }));
  assert.equal(sit.accepted, true, JSON.stringify(sit));
  assert.ok(await until(w, () => E.world.entities[row.entity_id].human.activity === 'sit'), `seated: ${JSON.stringify(E.world.entities[row.entity_id].human).slice(0, 300)}`);
  assert.equal(E.world.entities[row.entity_id].human.level, 1, 'upstairs');
  await invite(w, 'eli');
  const ground: any = await accept(w.host, w.souls.create('dev:eli', { name: 'Eli', description: 'visits downstairs' }));
  await w.settle(3);
  const guest = { soulId: ground.id, entityId: ground.entity_id, name: ground.name, owner: ground.owner };
  await accept(w.host, w.host.enqueue('edge-relocate', 'test:ground-occupant', { soulId: guest.soulId, entityId: guest.entityId, to: [10, 0], why: 'downstairs resident fixture' }));
  const movedHouse: any = w.god.act({ ops: [{ op: 'move', id: house, p: [28, 0] }] });
  assert.equal(movedHouse.moved?.length, 2, JSON.stringify(movedHouse));
  for (const resident of [soul, guest]) {
    const moved = movedResident(movedHouse, resident, 'walked'), b = E.world.entities[resident.entityId];
    assert.equal(b.human.activity, 'idle'); assert.equal(b.human.level ?? 0, 0, 'upstairs residents descend the stairs');
    assert.deepEqual([b.pose.p[0], b.pose.p[2]], moved.to, 'walk-out completes in the edit request');
    assert.ok(Math.abs(moved.to[0] - 10) > 4.3 || Math.abs(moved.to[1]) > 3.3, 'outside the original building');
    assert.ok(Math.abs(moved.to[0] - 28) > 4.3 || Math.abs(moved.to[1]) > 3.3, 'outside the moved building');
    assert.ok(E.clearanceAtV1(moved.to[0], moved.to[1], 0) >= 0.27);
  }
  await w.settle(3);
  assert.equal(w.god.model.worldPose(w.god.model.entities.get(house)!).x, 28);
  assert.deepEqual(E.runtime.violations, []);
});

test('E2: furniture on the ground floor of a house on raised ground is logged on the ground (level-0 seats); upstairs is not', { timeout: 300000 }, async t => {
  // Eden 2026's alpine station stands on its pad 43.9 m up: its benches took the floor level nearest their height (an upper
  // floor elsewhere) and no resident could reach them. Upstairs furniture keeps its floor.
  const w = await world(); w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const terrace: any = w.god.act({ ops: [{ op: 'place', def: coreRef('terrace'), name: 'shelf', shape: { area: [[0, -9], [20, -9], [20, 9], [0, 9]] }, params: { level: 3, edge: 1 } }] });
  assert.equal(terrace.accepted, true, JSON.stringify(terrace));
  const batch = HOUSE_BATCH(); batch.ops.push({ op: 'place', def: coreRef('chair'), name: 'hall-chair', in: { parent: '$h', slot: 'ground' }, p: [-2, 0, 1] } as any);
  const r: any = w.god.act(batch, 'house on the shelf');
  assert.equal(r.accepted, true, JSON.stringify(r));
  await w.settle(3);
  const E = w.host.engine as any, id = (p: string) => w.god.model.get(p)!.id;
  assert.ok(Math.abs(w.god.model.worldPose(w.god.model.get('house')!).y - 3) < 0.2, 'the house stands on the shelf');
  assert.equal(E.world.entities[id('house/hall-chair')]?.support?.kind, 'ground', 'ground-floor chair: on the ground');
  assert.notEqual(E.world.entities[id('house/chair')]?.support?.kind, 'ground', 'upstairs chair: on its floor');
  // lane LEVELS: an upstairs fixture names its floor's level (its seat is on that level, not the one nearest its height)
  const lvl = E.world.entities[id('house/chair')]?.level;
  assert.ok(lvl > 0 && E.world.entityPhysicsV1.byEntity[id('house')].surfaces.some((s: any) => s.level === lvl), `upstairs chair on level ${lvl}`);
  assert.equal(E.world.entities[id('house/hall-chair')]?.level, undefined, 'ground-floor chair: no level');
});
