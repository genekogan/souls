import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORE_KIT, WorldModel, coreRef, type Entity, type Op } from '@souls/world-compiler';
import { toyFactory } from '@souls/engine-toy';
import { Db } from '../db.ts';
import { WorldHost } from '../world.ts';
import { GodMode } from './god.ts';
import { EngineBridge, installEngineBridge } from './engine-bridge.ts';

type Move = { op: 'move'; id: string; p?: number[]; r?: number; in?: Entity['in']; mode?: string };
type EngineEntity = { kind: string; tags?: string[]; pose: { p: number[]; yaw: number }; support?: { kind: string; by?: string; on?: string; slot?: string }; human?: { speed: number; activity: string } };
function entity(id: string, body = false): Entity {
  return { id, name: id, def: coreRef(body ? 'humanoid' : 'bowl'), in: { parent: 'world' }, p: [0, 0, 0], r: 0, anchor: body ? 'center' : 'base', state: {}, by: 'engine', born: 0, v: 1 } as Entity;
}
function fixture(t: TestContext) {
  const model = new WorldModel({ constants: { ground: 'land', extent: 400 }, seed: 'writeback-slices' });
  for (const d of CORE_KIT) model.defineDef(d, 'core', 0);
  const entities: Record<string, EngineEntity> = {}, attempts: Move[] = [], logs: string[] = [];
  let clock = 0, refuse = (_op: Move) => false;
  t.mock.method(performance, 'now', () => clock);
  const bridge = Object.assign(Object.create(EngineBridge.prototype), {
    host: { engine: { world: { entities } } }, god: { model }, writeBackBusy: false, writeBackQuiet: null,
    writeBackPass: null, refusedPose: new Set(), stats: { writeBacks: 0 }, log: (s: string) => logs.push(s),
    engineAct(ops: Op[]) {
      assert.equal(ops.length, 1, 'writeback keeps the existing separate transactions');
      const op = structuredClone(ops[0]) as Move; attempts.push(op); clock += 10;
      if (refuse(op)) return { accepted: false, failures: [{ code: 'controlled-refusal' }] };
      const old = model.entities.get(op.id)!;
      model.delete(op.id); model.insert({ ...old, ...(op.p ? { p: op.p as Entity['p'] } : {}), ...(op.r !== undefined ? { r: op.r } : {}), ...(op.in ? { in: op.in } : {}) });
      return { accepted: true };
    },
  }) as EngineBridge;
  const add = (id: string, x: number, support: EngineEntity['support'] = { kind: 'ground' }, body = false) => {
    model.insert(entity(id, body));
    entities[id] = { kind: body ? 'human' : 'component', tags: ['entity-world'], pose: { p: [x, 0, 0], yaw: 0 }, ...(body ? { human: { speed: 0, activity: 'idle' } } : { support }) };
  };
  return { bridge, model, entities, attempts, logs, add, refuse(fn: (op: Move) => boolean) { refuse = fn; } };
}

test('a budget cut keeps body strict/nudge and carry transfer in one complete unit', t => {
  const f = fixture(t);
  f.add('body', 10, undefined, true); f.add('item', 20, { kind: 'in-hand', by: 'body' }); f.add('tail', 30);
  f.refuse(op => op.id === 'body' && op.mode === 'strict');
  assert.equal(f.bridge.writeBack(8), false);
  assert.deepEqual(f.attempts.map(o => [o.id, o.mode]), [['body', 'strict'], ['body', 'nudge'], ['item', 'strict']]);
  assert.deepEqual(f.model.entities.get('item')!.in, { parent: 'body', slot: 'carry' });
  assert.deepEqual(f.model.entities.get('tail')!.p, [0, 0, 0]);
  assert.equal(f.bridge.writeBack(8), true);
  assert.equal(f.attempts.at(-1)!.id, 'tail');
});

test('a refused first item and continuously moving prefix cannot starve the ordered tail', t => {
  const f = fixture(t); f.add('first', 10); f.add('second', 20); f.add('third', 30);
  f.refuse(op => op.id === 'first');
  assert.equal(f.bridge.writeBack(8), false);
  f.entities.first.pose.p[0] = 40;
  assert.equal(f.bridge.writeBack(8), false);
  f.entities.first.pose.p[0] = 50; f.entities.second.pose.p[0] = 60;
  assert.equal(f.bridge.writeBack(8), true);
  assert.deepEqual(f.attempts.map(o => o.id), ['first', 'second', 'third']);
  assert.deepEqual(f.model.entities.get('third')!.p, [30, 0]);
  assert.equal(f.logs.length, 1);
  f.bridge.writeBack();
  assert.deepEqual(f.attempts.slice(3).map(o => o.id), ['first', 'second'], 'the next pass picks up newer prefix poses');
});

test('an accepted moving prefix also advances; pending units use fresh poses and skip deleted work', t => {
  const f = fixture(t); f.add('first', 10); f.add('second', 20); f.add('deleted', 30); f.add('tail', 40);
  assert.equal(f.bridge.writeBack(8), false);
  f.entities.first.pose.p[0] = 100; f.entities.second.pose.p[0] = 200;
  f.model.delete('deleted'); delete f.entities.deleted;
  assert.equal(f.bridge.writeBack(8), false);
  f.entities.first.pose.p[0] = 101;
  assert.equal(f.bridge.writeBack(8), true);
  assert.deepEqual(f.attempts.map(o => [o.id, o.p]), [['first', [10, 0]], ['second', [200, 0]], ['tail', [40, 0]]]);
});

test('carry prerequisites are refreshed between slices, and a refused body does not strand its item', t => {
  const f = fixture(t); f.add('body', 10, undefined, true);
  f.add('one', 20, { kind: 'in-hand', by: 'body' }); f.add('two', 30, { kind: 'in-hand', by: 'body' });
  f.refuse(op => op.id === 'body');
  assert.equal(f.bridge.writeBack(8), false);
  f.entities.body.pose.p[0] = 12;
  assert.equal(f.bridge.writeBack(8), true);
  assert.deepEqual(f.attempts.map(o => [o.id, o.p]), [['body', [10, 0, 0]], ['body', [10, 0, 0]], ['one', [0, 0, 0]], ['body', [12, 0, 0]], ['body', [12, 0, 0]], ['two', [0, 0, 0]]]);
  assert.deepEqual(f.model.entities.get('two')!.in, { parent: 'body', slot: 'carry' });
});

test('an intervening model body move invalidates prerequisite dedup even at the same engine pose', t => {
  const f = fixture(t); f.add('body', 10, undefined, true);
  f.add('one', 20, { kind: 'in-hand', by: 'body' }); f.add('two', 30, { kind: 'in-hand', by: 'body' });
  assert.equal(f.bridge.writeBack(8), false);
  const body = f.model.entities.get('body')!;
  f.model.delete('body'); f.model.insert({ ...body, p: [90, 0, 0] });
  assert.equal(f.bridge.writeBack(8), true);
  assert.deepEqual(f.attempts.map(o => o.id), ['body', 'one', 'body', 'two']);
  assert.deepEqual(f.model.entities.get('body')!.p, [10, 0, 0]);
});

test('a static full drain and bounded drain preserve exact op order and final model', t => {
  const full = fixture(t), sliced = fixture(t);
  for (const f of [full, sliced]) {
    f.add('body', 10, undefined, true); f.add('one', 20, { kind: 'in-hand', by: 'body' });
    f.add('two', 30, { kind: 'in-hand', by: 'body' }); f.add('ground', 40); f.add('stopped', 50, undefined, true);
  }
  assert.equal(full.bridge.writeBack(), true);
  // The second fixture owns the shared fake clock; no real time thresholds are involved.
  let slices = 0; while (!sliced.bridge.writeBack(8)) assert.ok(++slices < 10);
  assert.deepEqual(full.attempts.map(o => o.id), ['body', 'one', 'two', 'ground', 'stopped']);
  assert.deepEqual(sliced.attempts, full.attempts);
  assert.deepEqual(sliced.model.snapshot(), full.model.snapshot());
});

test('zero budget does no work; an explicit synchronous drain replaces a pending pass', t => {
  const f = fixture(t); f.add('first', 10); f.add('second', 20);
  assert.equal(f.bridge.writeBack(0), false); assert.equal(f.attempts.length, 0);
  assert.equal(f.bridge.writeBack(8), false);
  assert.equal(f.bridge.writeBack(), true);
  assert.deepEqual(f.attempts.map(o => o.id), ['first', 'second']);
  assert.equal((f.bridge as unknown as { writeBackPass: unknown }).writeBackPass, null);
});

test('a discovered pass plans only each selected support, without enumerating the world again', t => {
  const f = fixture(t); f.add('first', 10);
  f.model.insert(entity('parentone')); f.model.insert(entity('parenttwo'));
  f.add('second', 20, { kind: 'resting-on', on: 'parentone', slot: 'missing' });
  f.add('third', 30, { kind: 'resting-on', on: 'parenttwo', slot: 'missing' });
  let enumerations = 0;
  const indexed = new Proxy(f.entities, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  (f.bridge.host.engine.world as unknown as { entities: typeof indexed }).entities = indexed;
  const poses: string[] = [], worldPose = f.model.worldPose.bind(f.model);
  t.mock.method(f.model, 'worldPose', (e: Entity) => { poses.push(e.id); return worldPose(e); });
  assert.equal(f.bridge.writeBack(8), false);
  assert.equal(enumerations, 1, 'one discovery scan establishes the ordered work roster');
  assert.deepEqual(poses, ['parentone', 'parenttwo']); poses.length = 0;
  // A support moves while the pass is parked. The selected item must use its new frame.
  const parent = f.model.entities.get('parentone')!;
  f.model.delete(parent.id); f.model.insert({ ...parent, p: [5, 0, 0] });
  assert.equal(f.bridge.writeBack(100), true, 'two remaining units run in this slice');
  assert.equal(enumerations, 1, 'resuming and committing a unit never repeat world discovery');
  assert.deepEqual(poses, ['parentone', 'parenttwo'], 'each remaining item resolves only its own live support once');
  assert.deepEqual(f.attempts.map(o => [o.id, o.p]), [['first', [10, 0]], ['second', [15, 0, 0]], ['third', [30, 0, 0]]]);
});

test('a body that changes holder role while pending waits for the next ordered pass', t => {
  const f = fixture(t); f.add('first', 10); f.add('body', 20, undefined, true); f.add('item', 0);
  assert.equal(f.bridge.writeBack(8), false);
  const item = f.model.entities.get('item')!;
  f.model.delete(item.id); f.model.insert({ ...item, in: { parent: 'body', slot: 'carry' } });
  f.entities.item.support = { kind: 'in-hand', by: 'body' };
  assert.equal(f.bridge.writeBack(8), true);
  assert.deepEqual(f.attempts.map(o => o.id), ['first'], 'an ordinary stopped-body unit does not silently become a holder unit');
  f.bridge.writeBack();
  assert.deepEqual(f.attempts.map(o => o.id), ['first', 'body']);
});

test('a budgeted carry unit retains separate durable commits and reloads as a completed transfer', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const god = new GodMode(db, { worldId: 'writeback-durable', ownerId: 'owner', tick: () => 10, emit() {}, assetDir: join(tmpdir(), 'writeback-test-assets') });
  const body = { ...entity('body', true), id: 'h_body' }, item = { ...entity('item'), id: 'e_item', p: [30, 0] } as Entity, tail = { ...entity('tail'), id: 'e_tail', p: [50, 0] } as Entity;
  const seed = god.engineAct([body, item, tail].map(entity => ({ op: 'restore', entity } as Op)), 'fixture');
  assert.equal(seed.accepted, true, JSON.stringify(seed));
  assert.ok(seed.accepted); // Narrow the successful durable receipt, not the entity-ID counter.
  const start = seed.seq;
  assert.equal(god.model.editSeq, start);
  const pendingTail = structuredClone(god.model.entities.get('e_tail'));
  const entities = {
    h_body: { kind: 'human', human: { speed: 0, activity: 'idle' }, pose: { p: [10, 0, 0], yaw: 0 } },
    e_item: { kind: 'component', tags: ['entity-world'], pose: { p: [10, 1, 0], yaw: 0 }, support: { kind: 'in-hand', by: 'h_body' } },
    e_tail: { kind: 'component', tags: ['entity-world'], pose: { p: [60, 0, 0], yaw: 0 }, support: { kind: 'ground' } },
  };
  let clock = 0; t.mock.method(performance, 'now', () => clock);
  const bridge = Object.assign(Object.create(EngineBridge.prototype), { god, host: { engine: { world: { entities } } }, version: 0,
    writeBackBusy: false, writeBackQuiet: null, writeBackPass: null, refusedPose: new Set(), stats: { writeBacks: 0 }, noteSent() {}, log() {} }) as EngineBridge;
  const act = bridge.engineAct.bind(bridge);
  t.mock.method(bridge, 'engineAct', (ops: Op[], note: string) => { const r = act(ops, note); clock += 10; assert.equal(r.accepted, true, JSON.stringify(r)); return r; });
  assert.equal(bridge.writeBack(8), false);
  const rows = db.db.prepare('SELECT seq,kind,ops FROM world_edits_v1 WHERE world_id=? AND seq>? ORDER BY seq').all(god.opts.worldId, start) as { seq: number; kind: string; ops: string }[];
  assert.deepEqual(rows.map(r => [r.seq, r.kind, JSON.parse(r.ops).map((o: Move) => o.id)]), [[start + 1, 'engine', ['h_body']], [start + 2, 'engine', ['e_item']]]);
  assert.equal(god.model.editSeq, start + 2);
  const restored = new GodMode(db, { ...god.opts, emit() {} });
  assert.equal(restored.model.editSeq, start + 2, 'both separate commits survive reload');
  assert.deepEqual(restored.model.entities.get('h_body')!.p, [10, 0, 0]);
  assert.deepEqual(restored.model.entities.get('e_item')!.in, { parent: 'h_body', slot: 'carry' });
  assert.deepEqual(god.model.entities.get('e_tail'), pendingTail, 'the next unit remains pending in memory');
  assert.deepEqual(restored.model.entities.get('e_tail'), pendingTail, 'the next unit remains pending in durable state');
});

test('the installed scheduler starts every ten ticks and continues a pending pass on each completed tick', t => {
  const db = new Db(':memory:'), host = new WorldHost(db, toyFactory, 'writeback-cadence', 1e9, 'writeback-cadence');
  host.boot(); host.drainInputs();
  t.after(() => { host.stop(); db.close(); });
  const god = new GodMode(db, { worldId: host.worldId, ownerId: 'owner', tick: () => host.engine.world.tick, emit() {} });
  const bridge = installEngineBridge({ host, god, log() {}, worldClock: false, worldLore: false });
  const state = bridge as unknown as { reconciled: boolean; writeBackPass: unknown; [key: string]: any };
  state.reconciled = true;
  for (const name of ['flush', 'perceiveStep', 'spotsStep', 'layersStep', 'flushMapNotices', 'navStep', 'evacuateSites', 'rescueTrapped']) t.mock.method(state, name, () => {});
  const ticks: number[] = [];
  t.mock.method(bridge, 'writeBack', (budget: number) => {
    assert.equal(budget, 8); assert.equal(host.kernel.tick, host.engine.world.tick);
    ticks.push(host.engine.world.tick); state.writeBackPass = ticks.length < 3 ? {} : null; return !state.writeBackPass;
  });
  for (let i = 0; i < 20; i++) host.tickOnce();
  assert.deepEqual(ticks, [10, 11, 12, 20]);
});
