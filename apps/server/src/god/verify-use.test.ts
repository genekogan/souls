import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {Hono} from 'hono';
import {coreRef} from '@souls/world-compiler';
import {fixture, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {ApiError} from '../souls.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {VerifyUse} from './verify-use.ts';
import {mountGodRoutes} from './routes.ts';
import {PROBE_OWNER, isVerificationProbe} from '../verification-probe.ts';
import {installBirthLooks} from './birth-look.ts';
import {seatProviders} from './query.ts';
import {GroundHost} from './ground-host.ts';

function world(t: TestContext, options: {durableClockV1?: boolean; district?: boolean; beforeVerify?: (w: ReturnType<typeof fixture>) => void} = {}) {
  const w = fixture(':memory:', factory, {durableClockV1: options.durableClockV1 ?? true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}, ...(options.district ? {genesis: JSON.parse(fs.readFileSync(new URL('../../../../worlds/templates/eden-district.json', import.meta.url), 'utf8'))} : {})});
  if (options.district) new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  options.beforeVerify?.(w);
  const verify = new VerifyUse(w.host, w.souls, god, edge);
  const app = new Hono(), token = god.mintFor({id: 'owner', role: 'user'}, 'test');
  mountGodRoutes(app, {god, worldName: 'Probe fixture', requireUser: async () => {throw new ApiError(401, 'unauthorized', 'test');}, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5360', limitIp() {}, verifyUse: verify});
  app.onError((e, c) => c.json({code: (e as ApiError).code ?? 'internal', message: e.message}, ((e as ApiError).status ?? 500) as 400));
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close();});
  const settle = async (n = 3) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  const build = async (seat = true, blocked = false) => {
    const r = god.act({ops: [
      {op: 'define', def: {schema: 'def/1', name: 'verify-house', version: 1, tags: ['building'], size: {box: [8, 3, 6]}, make: {kind: 'gen', gen: 'building/1', args: {style: 'shed'}}, params: {floors: {type: 'int', min: 1, max: 6, default: 1}}, components: {foundation: {kind: 'none'}}}},
      {op: 'place', tmp: '$h', def: 'verify-house@1', name: 'house', p: [10, 0]},
      ...(seat ? [{op: 'place', def: coreRef('chair'), name: 'chair', in: {parent: '$h', slot: 'ground'}, p: [-2, 0, -1]}] : []),
      ...(blocked ? [{op: 'place', def: coreRef('wall'), name: 'door-blocker', p: [10, 3.75], params: {w: 5, h: 3, d: 1}}] : []),
    ]});
    if (blocked) {
      // New construction must fail admission (buildsafe/1 cannot move a wall for the god, so the refusal stands).
      // Keep the verifier's negative coverage by explicitly seeding a legacy sealed world (no production bypass).
      assert.equal(r.accepted, false); if (!r.accepted) assert.equal(r.failures[0].code, 'architecture.sealed');
      await build(seat, false);
      const e = { id: 'e_legacywall', def: coreRef('wall'), name: 'door-blocker', in: { parent: 'world' }, p: [10, 0, 3.75] as [number, number, number], params: { w: 5, h: 3, d: 1 }, by: 'legacy-fixture', born: 0, v: 1 };
      god.model.insert(e); god.model.index(e.id, god.model.footprint(e)); bridge.reconcile();
    } else assert.equal(r.accepted, true, JSON.stringify(r));
    await settle();
  };
  const drive = async <T>(work: Promise<T>): Promise<T> => {
    let done = false; void work.then(() => {done = true;}, () => {done = true;});
    const deadline = performance.now() + 15_000;
    while (!done && performance.now() < deadline) {for (let i = 0; i < 4; i++) w.host.tickOnce(); await new Promise(r => setTimeout(r, 1));}
    assert.ok(done, 'bounded native fixture drive'); return work;
  };
  const request = (body: unknown, auth = true) => app.request('/v1/god/verify-use', {method: 'POST', headers: {'content-type': 'application/json', ...(auth ? {authorization: `Bearer ${token}`} : {})}, body: JSON.stringify(body)});
  const removed = () => {
    assert.equal([...w.host.minds.keys()].some(isVerificationProbe), false);
    assert.equal(Object.keys(w.host.engine.world.entities).some(id => id.startsWith('h_vp')), false);
    assert.equal([...god.model.entities.keys()].some(id => id.startsWith('h_vp')), false);
    const rows = w.db.db.prepare('SELECT * FROM souls WHERE owner=?').all(PROBE_OWNER) as {retired_at: number | null; token_hash: string | null}[];
    for (const row of rows) {assert.notEqual(row.retired_at, null); assert.equal(row.token_hash, null);}
    return rows;
  };
  return {...w, god, edge, bridge, verify, settle, build, drive, request, app, removed};
}

test('real probe enters through a door, sits in a seat slot, retires; authored world stays unchanged', {timeout: 30_000}, async t => {
  const w = world(t); await w.build();
  const before = structuredClone([...w.god.model.entities.values()]);
  const response = await w.drive(Promise.resolve(w.request({target: 'house', timeoutMs: 12_000})));
  assert.equal(response.status, 200); const r = await response.json() as any;
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.probe.removed, true);
  const enter = r.uses.find((x: any) => x.use === 'enter'), sit = r.uses.find((x: any) => x.use === 'sit');
  assert.equal(enter.ok, true); assert.ok(enter.crossing); assert.match(enter.door, /door/); assert.ok(enter.crossing.distToDoor < 1);
  assert.equal(sit.ok, true); assert.equal(sit.seat, 'house/chair'); assert.match(sit.occupant, /^verifier probe /); assert.ok(sit.distanceToSlot <= 0.6);
  assert.equal(w.removed().length, 1); assert.deepEqual([...w.god.model.entities.values()], before);
  assert.deepEqual(w.host.engine.runtime.violations, []);
  assert.equal(w.god.store.prayers({unanswered: false}).length, 0);
  const log = w.db.events(w.host.worldId, 0, 1000), birth = log.find(e => e.kind === 'birth' && isVerificationProbe(e.payload.soulId));
  assert.ok(birth); assert.match(birth.author, /^verify-use:/);
  assert.ok(log.some(e => e.kind === 'retire' && e.payload.soulId === birth.payload.soulId));
  assert.equal(log.filter(e => /^brain:/.test(e.author)).length, 0);
});

test('solid thing across the only doorway cannot produce a successful entry', {timeout: 30_000}, async t => {
  const w = world(t); await w.build(true, true);
  const r = await w.drive(w.verify.run({target: 'house', uses: ['enter'], timeoutMs: 2000}));
  assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.uses[0].ok, false); assert.ok(r.uses[0].reason); assert.equal(r.probe.removed, true); w.removed();
});

test('a built-over arrival point births the probe on the nearest clear ground and still proves the walk', {timeout: 30_000}, async t => {
  const w = world(t); await w.build();
  // Legacy solid blocks (as harvest identity worlds have: a water tower on the arrival) over arrival (0,0) and
  // reference (2,0): x -7..5, z -6..6, wider than the original 4.5 m arrival search.
  for (let i = 0; i < 6; i++) {
    const e = {id: `e_arrivalblock${i}`, def: coreRef('wall'), name: `arrival-block-${i}`, in: {parent: 'world'}, p: [-1, 0, -5 + i * 2] as [number, number, number], params: {w: 12, h: 3, d: 2}, by: 'legacy-fixture', born: 0, v: 1};
    w.god.model.insert(e); w.god.model.index(e.id, w.god.model.footprint(e));
  }
  w.bridge.reconcile(); await w.settle();
  const engine = w.host.engine as unknown as {spawnHuman(a: {id: string; label: string; soul: string}): string; stateHash(): string};
  const before = engine.stateHash();
  assert.throws(() => engine.spawnHuman({id: 'h_plainbirth', label: 'Plain', soul: 's_plainbirth'}), /no free standing room at the arrival point/, 'an ordinary birth is still refused here');
  assert.equal(engine.stateHash(), before);
  const r = await w.drive(w.verify.run({target: 'house', timeoutMs: 12_000}));
  assert.equal(r.ok, true, JSON.stringify(r));
  const enter = r.uses.find(x => x.use === 'enter')!, sit = r.uses.find(x => x.use === 'sit')!;
  assert.equal(enter.ok, true); assert.ok(enter.crossing); assert.equal(enter.proof?.kind, 'room'); assert.equal(sit.ok, true); assert.ok(sit.distanceToSlot! <= 0.6);
  const birth = w.db.events(w.host.worldId, 0, 1000).find(e => e.kind === 'birth' && isVerificationProbe(e.payload.soulId))!;
  assert.ok(Array.isArray(birth.payload.near?.at) && birth.payload.near.first === undefined, JSON.stringify(birth.payload));
  w.removed();
  // An explicit start is searched first and the walk is still physical from there.
  const from = await w.drive(w.verify.run({target: 'house', uses: ['enter'], from: [10, 7], timeoutMs: 12_000}));
  assert.equal(from.ok, true, JSON.stringify(from)); w.removed();
  const second = w.db.events(w.host.worldId, 0, 1000).filter(e => e.kind === 'birth' && isVerificationProbe(e.payload.soulId)).at(-1)!;
  assert.deepEqual(second.payload.near, {at: [10, 7], first: true});
});

test('the probe sits on a seat a resident can reach, not the nearest boxed-in one; an explicit boxed seat names its blocker', {timeout: 30_000}, async t => {
  const w = world(t); await w.build();
  const far = w.god.act({ops: [{op: 'place', def: coreRef('chair'), name: 'far-chair', in: {parent: w.god.model.get('house')!.id, slot: 'ground'}, p: [2.5, 0, -2]}]});
  assert.equal(far.accepted, true, JSON.stringify(far));
  // Legacy blocks from 0.3 m around house/chair (world 8,-1) out past its farthest approach gap (1.5 m): no standing
  // room in front, behind or beside it.
  const box: [number, number, number, number][] = [[8, -2, 1.2, 1.4], [8, 0, 1.2, 1.4], [6.95, -1, 1.5, 2], [9.05, -1, 1.5, 2]];
  box.forEach(([x, z, bw, bd], i) => {
    const e = {id: `e_seatbox${i}`, def: coreRef('wall'), name: `seat-box-${i}`, in: {parent: 'world'}, p: [x, 0, z] as [number, number, number], params: {w: bw, h: 1.2, d: bd}, by: 'legacy-fixture', born: 0, v: 1};
    w.god.model.insert(e); w.god.model.index(e.id, w.god.model.footprint(e));
  });
  w.bridge.reconcile(); await w.settle();
  const engine = w.host.engine as unknown as {freeSeatSlotsV1(id: string): {id: string; p: [number, number]; approach?: [number, number]}[]};
  const boxed = engine.freeSeatSlotsV1(w.god.model.get('house/chair')!.id), open = engine.freeSeatSlotsV1(w.god.model.get('house/far-chair')!.id);
  assert.equal(boxed.length, 1); assert.equal(boxed[0].approach, undefined, 'the boxed chair has no standing approach');
  assert.ok(open[0]?.approach, 'the far chair has one');
  const r = await w.drive(w.verify.run({target: 'house', timeoutMs: 12_000}));
  assert.equal(r.ok, true, JSON.stringify(r));
  const enter = r.uses.find(x => x.use === 'enter')!, sit = r.uses.find(x => x.use === 'sit')!;
  const at = enter.proof!.at, d = (p: [number, number]) => Math.hypot(p[0] - at[0], p[1] - at[1]);
  assert.ok(d(boxed[0].p) < d(open[0].p), 'the boxed chair is the nearer one, so nearest-first would have picked it');
  assert.equal(sit.seat, 'house/far-chair'); w.removed();
  // Asked for the boxed chair explicitly: still refused, with the engine's own words on what blocks it.
  const refused = await w.drive(w.verify.run({target: 'house', uses: ['sit'], seat: 'house/chair', timeoutMs: 5_000}));
  assert.equal(refused.ok, false); assert.equal(refused.uses[0].reason?.engineCode, 'slot.unreachable');
  assert.match(refused.uses[0].reason!.message, /cannot be sat on: no standing room .*blocked by/); w.removed();
});

test('seatless target returns verify.no-seat', async t => {
  const w = world(t); await w.build(false);
  const r = await w.drive(w.verify.run({target: 'house', uses: ['sit'], timeoutMs: 1000}));
  assert.equal(r.uses[0].reason?.code, 'verify.no-seat'); assert.equal(r.probe.removed, true); w.removed();
});

test('explicit seat and coordinate start work; a foreign seat is refused', async t => {
  const w = world(t); await w.build();
  const r = await w.drive(w.verify.run({target: 'house', seat: 'house/chair', from: [10, 7], timeoutMs: 10_000}));
  assert.equal(r.ok, true, JSON.stringify(r)); w.removed();
  const other = w.god.act({ops: [{op: 'place', def: coreRef('chair'), name: 'foreign-chair', p: [20, 0]}]}); assert.equal(other.accepted, true); await w.settle();
  const refused = await w.drive(w.verify.run({target: 'house', uses: ['sit'], seat: 'foreign-chair'}));
  assert.equal(refused.uses[0].reason?.code, 'verify.no-seat'); assert.equal(refused.probe.removed, true); w.removed();
  const absent = await w.verify.run({target: 'house', from: 'unknown-start'}); assert.equal(absent.reason?.code, 'verify.no-target');
});

test('reserved probes never enter any model work even when Brain mode is live', async t => {
  const w = world(t), brain = w.brain as any;
  installBirthLooks(w.host, w.edge);
  brain.quiescing = false; brain.mode = 'live';
  let attempts = 0;
  for (const work of ['attuneWork', 'evaluateWork', 'reflectWork', 'compileWork', 'translateWork', 'shotForWork', 'speakWork']) t.mock.method(brain, work, async () => {attempts++; throw Error('probe must never call model work');});
  const created = w.souls.createVerificationProbe(); w.host.drainInputs(); await created.ready;
  const m = w.host.minds.get(created.soul.id)!;
  await brain.evaluate(m, 'birth'); await brain.attune(m); await brain.reflect(m, 1); await brain.compile(m, 'think'); await brain.translate(m, 'think'); await brain.shotFor(m); await brain.speak(m.soulId, m.soulId, 'chat');
  for (let i = 0; i < 80; i++) w.host.tickOnce();
  assert.equal(attempts, 0); assert.deepEqual(w.souls.ownedRows('owner'), []);
  assert.equal(brain.tickerCandidates.some((e: any) => e.text.includes('verifier probe')), false);
  assert.equal(brain.shotCandidates().some((c: any) => c.spec.subject === m.entityId), false);
  assert.equal(w.db.events(w.host.worldId, 0, 1000).some(e => e.kind === 'body-assignment-v1'), false);
  assert.throws(() => w.souls.pairCode(created.soul, 'http://127.0.0.1:5360'), /not currently admitted and ready/);
  const retired = w.souls.retire(created.soul); w.host.drainInputs(); await retired; await w.settle(); w.removed();
});

test('a roomless area uses its actual footprint and supports a reference start', async t => {
  const w = world(t);
  const r = w.god.act({ops: [
    {op: 'place', def: coreRef('plaza'), name: 'court', shape: {area: [[-16, -8], [-8, -8], [-8, 0], [-16, 0]]}},
    {op: 'place', def: coreRef('flag'), name: 'start', p: [-4, 4]},
  ]}); assert.equal(r.accepted, true, JSON.stringify(r)); await w.settle();
  const result = await w.drive(w.verify.run({target: 'court', from: 'start', uses: ['enter'], timeoutMs: 10_000}));
  assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(result.uses[0].crossing); assert.equal(result.uses[0].door, undefined); assert.equal(result.probe.removed, true); w.removed();
  const fallback = await w.drive(w.verify.run({target: 'court', uses: ['enter'], timeoutMs: 10_000}));
  assert.equal(fallback.ok, true, JSON.stringify(fallback)); w.removed();
});

// A bespoke structural kit: no rooms, no place component, real posts, roof and
// seat geometry. Its usual walk goal is a seat approach, not an entrance.
async function gazebo(w: ReturnType<typeof world>) {
  const r = w.god.act({ops: [
    {op: 'define', def: {schema: 'def/1', name: 'verify-gazebo', size: {box: [6, 3.2, 6]},
      make: {kind: 'gen', gen: 'kit/2', args: {shapes: [
        ...[-2.8, 2.8].flatMap(x => [-2.8, 2.8].map(z => ({kind: 'box', at: [x, 1.5, z], size: [0.2, 3, 0.2]}))),
        {kind: 'box', at: [0, 3.1, 0], size: [6, 0.2, 6]},
        {kind: 'box', at: [0, 0.25, 0], size: [1.5, 0.5, 0.6]},
      ]}}, components: {seat: {height: 0.5}}, slots: [{id: 'bench', kind: 'seat', p: [0, 0.5, 0], yaw: 0, height: 0.5, accepts: {tags: ['body']}, capacity: 1}]}},
    {op: 'place', def: 'verify-gazebo@1', name: 'gazebo', p: [10, 0]},
  ]});
  assert.equal(r.accepted, true, JSON.stringify(r)); await w.settle();
}

function timings(r: Awaited<ReturnType<VerifyUse['run']>>) {
  assert.deepEqual(Object.keys(r.timings).sort(), ['birth', 'enter', 'retire', 'sit', 'start']);
  for (const ms of Object.values(r.timings)) assert.ok(Number.isFinite(ms) && ms >= 0, JSON.stringify(r.timings));
  assert.ok(r.timings.enter > 0); assert.ok(r.timings.sit > 0);
}

test('room-less bespoke kit enters via an engine footprint position and physically sits', async t => {
  const w = world(t); await gazebo(w);
  assert.equal(w.bridge.nav.thing('gazebo')?.rooms, undefined);
  const r = await w.drive(w.verify.run({target: 'gazebo', timeoutMs: 8000}));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.uses[0].proof?.kind, 'footprint');
  assert.equal(r.uses[0].proof?.seat, 'gazebo'); assert.match(r.uses[0].occupant!, /^verifier probe /);
  const proof = r.uses[0].proof!;
  assert.ok(proof.at[0] > 7.15 && proof.at[0] < 12.85 && Math.abs(proof.at[1]) < 2.85);
  assert.ok(proof.tick > 0 && proof.ms > 0 && proof.ms <= r.ms);
  assert.equal(r.uses[1].ok, true); assert.ok(r.uses[1].distanceToSlot! <= 0.6);
  timings(r); w.removed();
});

test('entry needs no walk capability, named place, or GodNav entry', async t => {
  const w = world(t); await gazebo(w);
  const act = w.edge.act.bind(w.edge);
  t.mock.method(w.edge, 'act', async (soul: Parameters<EdgeLedger['act']>[0], input: Parameters<EdgeLedger['act']>[1]) => {
    assert.ok(!String(input.capability).startsWith('walk:'), 'no walk capability may be requested');
    return act(soul, input);
  });
  t.mock.method(w.edge, 'capabilities', () => []);
  t.mock.method(w.bridge.nav, 'thing', () => undefined);
  const r = await w.drive(w.verify.run({target: 'gazebo', timeoutMs: 8000}));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.uses[0].proof?.kind, 'footprint'); w.removed();
  // The house exercises the explicit point-walk; the large fixture can use a physical seat proof.
  const h = world(t); await h.build(false);
  t.mock.method(h.bridge.nav, 'capabilities', () => {});
  t.mock.method(h.edge, 'act', async () => {throw Error('entry must not ask for an edge capability');});
  const entered = await h.drive(h.verify.run({target: 'house', uses: ['enter'], timeoutMs: 8000}));
  assert.equal(entered.ok, true, JSON.stringify(entered));
  const decisions = h.db.events(h.host.worldId, 0, 1000).filter(e => e.kind === 'decision' && e.payload.trigger === 'verify-use:enter');
  assert.equal(decisions.length, 1); assert.equal(decisions[0].payload.steps[0].verb, 'walk_to');
  assert.ok(Array.isArray(decisions[0].payload.steps[0].params.to));
});

test('library church enters and sits with phase timings', async t => {
  const w = world(t), r = w.god.act({ops: [{op: 'place', def: coreRef('church'), name: 'church', p: [15, 0]}]});
  assert.equal(r.accepted, true, JSON.stringify(r)); await w.settle();
  const checked = await w.drive(w.verify.run({target: 'church', timeoutMs: 8000}));
  assert.equal(checked.ok, true, JSON.stringify(checked)); assert.equal(checked.uses[0].proof?.kind, 'room');
  assert.equal(checked.uses[1].ok, true); timings(checked); w.removed();
});

test('far interior seat reports the engine route before relocation and walks the final metres', async t => {
  const w = world(t);
  const built = w.god.act({ops: [
    {op: 'define', def: {schema: 'def/1', name: 'verify-long-hall', version: 1, size: {box: [8, 3, 30]}, make: {kind: 'gen', gen: 'building/1', args: {style: 'shed'}}, params: {w: {type: 'number', default: 8}, d: {type: 'number', default: 30}, floors: {type: 'int', min: 1, max: 6, default: 1}}, components: {foundation: {kind: 'none'}}}},
    {op: 'place', tmp: '$h', def: 'verify-long-hall@1', name: 'hall', p: [10, 0]},
    {op: 'place', def: coreRef('chair'), name: 'far-chair', in: {parent: '$h', slot: 'ground'}, p: [0, 0, -11]},
  ]}); assert.equal(built.accepted, true, JSON.stringify(built)); await w.settle();
  const r = await w.drive(w.verify.run({target: 'hall', timeoutMs: 8000}));
  assert.equal(r.ok, true, JSON.stringify(r));
  const route = r.uses[1].interiorRoute;
  assert.equal(route?.reach.ok, true); assert.ok(route!.reach.ok && route!.reach.length > 10);
  assert.ok(route?.relocatedTo); assert.equal(route.finalApproach, 'physical');
  const log = w.db.events(w.host.worldId, 0, 1000), relocation = log.find(e => e.kind === 'edge-relocate' && /interior route/.test(e.payload.why));
  assert.ok(relocation); assert.ok(relocation.tick >= r.uses[0].proof!.tick);
  assert.ok(r.uses[1].occupant); assert.ok(r.uses[1].distanceToSlot! <= 0.6); w.removed();
  const full = await w.drive(w.verify.run({target: 'hall', from: [10, 17], timeoutMs: 8000}));
  assert.equal(full.ok, true, JSON.stringify(full)); assert.equal(full.uses[1].interiorRoute, undefined);
  assert.ok(full.notes.some(n => /full physical walk.*slower/.test(n))); w.removed();
});

test('district church and gazebos finish within 10 s with the real tick loop and back-to-back requests', {timeout: 35_000}, async t => {
  // Match main.ts's ordinary sequencer (no durable-clock extra draining) and
  // enough authored destinations to expose the former multi-second bind cost.
  const w = world(t, {durableClockV1: false, district: true}); await gazebo(w);
  const built = w.god.act({ops: [
    {op: 'place', def: coreRef('church'), name: 'church', p: [100, 19], r: -1.57},
    {op: 'place', def: coreRef('gazebo'), name: 'library-gazebo', p: [69, 5]},
  ]});
  assert.equal(built.accepted, true, JSON.stringify(built)); await w.settle();
  // Exact-seat verification must not ask to bind other destinations at all.
  t.mock.method(w.bridge.nav, 'capabilities', () => {throw Error('unrelated navigation discovery');});
  t.mock.method(w.edge as any, 'binds', () => {throw Error('unrelated capability discovery');});
  w.host.start();
  let previous: any;
  for (const target of ['church', 'library-gazebo', 'gazebo']) {
    const response = await w.request({target, timeoutMs: 10_000}), r = await response.json() as any;
    t.diagnostic(JSON.stringify({target, ok: r.ok, ms: r.ms, timings: r.timings, actions: r.actions, previousRemovalWaitMs: r.previousRemovalWaitMs}));
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.ms <= 10_000); timings(r);
    assert.equal(r.probe.created, true);
    const action = r.actions[0];
    assert.ok(action.accepted.ms - action.requested.ms < 1000, 'selected-seat admission is prompt');
    assert.ok(action.arrived.ms <= action.seated.ms && action.seated.ms <= action.predicateTrue.ms);
    assert.ok(action.seated.tick > action.programStarted.tick, 'native physical ticks still occur');
    assert.ok(r.uses[1].occupant && r.uses[1].distanceToSlot <= 0.6);
    if (previous?.probe.removal === 'pending') assert.ok(r.previousRemovalWaitMs > 0 && r.previousRemovalWaitMs <= 3000);
    const live = w.db.db.prepare('SELECT COUNT(*) AS n FROM souls WHERE owner=? AND retired_at IS NULL').get(PROBE_OWNER) as {n: number};
    assert.equal(live.n, 0); // the just-returned probe has accepted retirement
    previous = r;
  }
  const until = performance.now() + 3000;
  while (Object.keys(w.host.engine.world.entities).some(id => id.startsWith('h_vp')) && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  w.removed(); assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('exact-seat launch is server-probe-only and retains native slot refusal', async t => {
  const w = world(t); await w.build();
  const chair = w.god.model.get('house/chair')!;
  const refused = await w.edge.actVerificationSit({soulId: 's_other', entityId: 'h_other', name: 'ordinary resident', owner: 'owner'}, chair.id, chair.id + '#seat');
  assert.equal(refused.accepted, false); assert.equal((refused as any).code, 'soul.not-probe');
  const created = w.souls.createVerificationProbe(); w.host.drainInputs(); await created.ready;
  const soul = {soulId: created.soul.id, entityId: created.soul.entity_id, name: created.soul.name, owner: created.soul.owner};
  const noSlot = await w.edge.actVerificationSit(soul, chair.id, chair.id + '#nonexistent');
  assert.equal(noSlot.accepted, false); assert.equal((noSlot as any).code, 'slot.unknown');
  const foreignSlot = await w.edge.actVerificationSit(soul, chair.id, 'another#seat');
  assert.equal(foreignSlot.accepted, false); assert.equal((foreignSlot as any).code, 'slot.unknown');
  const retired = w.souls.retire(created.soul); w.host.drainInputs(); await retired; await w.settle(); w.removed();
});

test('entry retains a proved ENGINE footprint position when the same walk finishes outside', async t => {
  const w = world(t);
  const built = w.god.act({ops: [{op: 'place', def: coreRef('plaza'), name: 'court', shape: {area: [[-16, -8], [-8, -8], [-8, 0], [-16, 0]]}}]});
  assert.equal(built.accepted, true, JSON.stringify(built)); await w.settle();
  // Real native walk crosses the entire area; only the explicit goal is beyond
  // its far edge. Endpoint-only containment would falsely refuse this proof.
  t.mock.method(w.verify as any, 'entry', () => ({start: [-18, -4], goal: {p: [-6, -4], level: 0}}));
  const r = await w.drive(w.verify.run({target: 'court', uses: ['enter'], timeoutMs: 8000}));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.uses[0].proof?.kind, 'footprint');
  assert.ok(r.uses[0].proof!.at[0] < -8 && r.uses[0].proof!.at[0] > -16); w.removed();
});

test('a changed target refuses a stale geometric receipt and still removes the probe', async t => {
  const w = world(t); await w.build(); let edited = false;
  w.host.listeners.push({afterTick: () => {
    if (edited || ![...w.host.minds.values()].some(m => isVerificationProbe(m.soulId) && (w.host.engine.world.entities[m.entityId] as any)?.human?.activity === 'walk')) return;
    edited = true; assert.equal(w.god.act({ops: [{op: 'set', id: 'house', name: 'house-renamed'}]}).accepted, true);
  }});
  const r = await w.drive(w.verify.run({target: 'house', uses: ['enter'], timeoutMs: 10_000}));
  assert.equal(edited, true); assert.equal(r.ok, false); assert.equal(r.uses[0].reason?.engineCode, 'revision.stale'); assert.equal(r.probe.removed, true); w.removed();
});

test('kit PNG route preserves binary bytes and returns 404 when absent', async t => {
  const w = world(t), realRead = fs.readFileSync;
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 254]);
  let missing = false;
  const mock = t.mock.method(fs, 'readFileSync', ((file: any, ...args: any[]) => {
    if (String(file).endsWith('/reference/kit-primitives.png')) { if (missing) throw Error('ENOENT'); return bytes; }
    return (realRead as any)(file, ...args);
  }) as typeof fs.readFileSync);
  syncBuiltinESMExports(); t.after(() => {mock.mock.restore(); syncBuiltinESMExports();});
  const response = await w.app.request('/god/kit-primitives.png');
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  missing = true; assert.equal((await w.app.request('/god/kit-primitives.png')).status, 404);
});

test('paused clock times out, retires even a queued action, and releases busy lock', async t => {
  const w = world(t); await w.build();
  const first = w.verify.run({target: 'house', timeoutMs: 35});
  const busy = await new VerifyUse(w.host, w.souls, w.god, w.edge).run({target: 'house'});
  assert.equal(busy.reason?.code, 'verify.busy'); assert.equal(w.db.db.prepare('SELECT COUNT(*) AS n FROM souls WHERE owner=?').get(PROBE_OWNER)?.n, 1);
  const r = await first; assert.equal(r.ok, false); assert.equal(r.uses[0].reason?.code, 'verify.timeout'); assert.equal(r.probe.removed, true); w.removed();
  await w.settle(3); w.removed();
  const next = await w.verify.run({target: 'missing'}); assert.equal(next.reason?.code, 'verify.no-target');
});

test('a sit label without the probe occupant cannot pass; paused native cleanup stays busy until resumed', {timeout: 12_000}, async t => {
  const w = world(t); await w.build();
  const occupants = seatProviders.get(w.god.model)!;
  // Native engine still sits normally. Falsify only the public occupant read:
  // the receipt must refuse rather than accept the engine's sit label alone.
  seatProviders.set(w.god.model, id => occupants(id).map(o => ({...o, soul: 'another resident'})));
  const pending = w.verify.run({target: 'house', uses: ['sit'], timeoutMs: 1000});
  let seated = false;
  const deadline = performance.now() + 800;
  while (!seated && performance.now() < deadline) {
    await w.settle(4);
    seated = [...w.host.minds.values()].some(m => isVerificationProbe(m.soulId) && (w.host.engine.world.entities[m.entityId] as any)?.human?.activity === 'sit');
  }
  assert.equal(seated, true, 'the actual native body sat before the proof deadline');
  // Stop advancing the fixture clock while its normal sit-release is owed.
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.uses[0].reason?.code, 'verify.timeout'); assert.equal(result.probe.removed, false);
  const busy = await w.verify.run({target: 'house'}); assert.equal(busy.reason?.code, 'verify.busy');
  assert.equal(busy.probe.created, false); assert.ok(busy.previousRemovalWaitMs! >= 2900 && busy.previousRemovalWaitMs! < 3500);
  seatProviders.set(w.god.model, occupants);
  await w.settle(80); w.removed();
  const next = await w.verify.run({target: 'missing'}); assert.equal(next.reason?.code, 'verify.no-target');
});

test('god auth, malformed input and schema are handled without internal errors', async t => {
  const w = world(t);
  assert.equal((await w.request({target: 'house'}, false)).status, 401);
  for (const input of [null, {}, {target: 'house', timeoutMs: 180001}, {target: 'house', uses: ['fly']}]) {
    const res = await w.request(input); assert.equal(res.status, 200); const r = await res.json() as any; assert.equal(r.reason.code, 'verify.refused');
  }
  const res = await w.app.request('/v1/god/schema'), schema = await res.json() as any;
  assert.ok(schema.endpoints.god.includes('POST /v1/god/verify-use')); assert.ok(schema.refusals.includes('verify.busy'));
  assert.equal(w.removed().length, 0);
});

test('boot retires a probe planted in the DB through the journal and verification runs', async t => {
  const id = 's_vpbootstale', entityId = 'h_vpbootstale';
  const w = world(t, {beforeVerify: fixture => {
    fixture.db.createSoul({id, worldId: fixture.host.worldId, owner: PROBE_OWNER, entityId, name: 'stale verifier', description: 'crashed before birth', native: false});
    fixture.db.createSoul({id: 'ordinary-probe-owner', worldId: fixture.host.worldId, owner: PROBE_OWNER, entityId: 'h_ordinary', name: 'nonprobe', description: '', native: false});
    fixture.db.createSoul({id: 's_vpforeignowner', worldId: fixture.host.worldId, owner: 'ordinary-owner', entityId: 'h_vpforeignowner', name: 'wrong owner', description: '', native: false});
    fixture.db.createSoul({id: 's_vpotherworld', worldId: 'another-world', owner: PROBE_OWNER, entityId: 'h_vpotherworld', name: 'other world', description: '', native: false});
  }});
  await w.build();
  const r = await w.drive(w.verify.run({target: 'house', timeoutMs: 8000}));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.notEqual(w.db.soul(id)?.retired_at, null);
  assert.equal(w.db.soul('ordinary-probe-owner')?.retired_at, null);
  assert.equal(w.db.soul('s_vpforeignowner')?.retired_at, null);
  assert.equal(w.db.soul('s_vpotherworld')?.retired_at, null);
  assert.ok(w.db.events(w.host.worldId, 0, 1000).some(e => e.kind === 'retire' && e.payload.soulId === id));
});

test('boot sweeps a loaded probe mind and body, including an already SQL-retired probe', async t => {
  let stale = '';
  const w = world(t, {beforeVerify: fixture => {
    const born = fixture.souls.createVerificationProbe(); stale = born.soul.id;
    fixture.host.drainInputs(); assert.ok(fixture.host.minds.has(stale));
    fixture.db.retireSoul(stale); // crash after SQL revocation, before journal/native retirement
  }});
  await w.build();
  const r = await w.drive(w.verify.run({target: 'house', timeoutMs: 8000}));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(w.host.minds.has(stale), false); w.removed();
});

test('boot retires an orphaned native probe body after its SQL row and mind were retired', async t => {
  let stale = '';
  const w = world(t, {beforeVerify: fixture => {
    const born = fixture.souls.createVerificationProbe(); stale = born.soul.id;
    fixture.host.drainInputs(); fixture.db.retireSoul(stale); fixture.host.minds.delete(stale);
    assert.ok(fixture.host.engine.world.entities[born.soul.entity_id]);
  }});
  await w.build();
  const r = await w.drive(w.verify.run({target: 'house', timeoutMs: 8000}));
  assert.equal(r.ok, true, JSON.stringify(r)); w.removed();
  assert.ok(w.db.events(w.host.worldId, 0, 1000).some(e => e.kind === 'retire' && e.payload.soulId === stale));
});
