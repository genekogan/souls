import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import type { BodyPort } from './edge/ledger/body-rule.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import type { Thing } from './god/nav.ts';

function fixture(t: TestContext, active: boolean) {
  const db = new Db(':memory:'), host = new WorldHost(db, toyFactory, 'body-places', 1e9, 'body-places');
  host.boot(); host.drainInputs();
  // Exercise served scheduling without starting timers or making an HTTP listener.
  Object.defineProperty(host, 'running', { get: () => true });
  const now = 1e12, ledger = new EdgeLedger(host, db, undefined, { now: () => now });
  const god = new GodMode(db, { worldId: host.worldId, ownerId: 'owner', tick: () => host.engine.world.tick, emit() {} });
  const errors: string[] = [];
  const bridge = installEngineBridge({ host, god, edge: ledger, worldClock: false, worldLore: false, log: m => errors.push(m) });
  const state = bridge as unknown as { reconciled: boolean; navWarm: boolean; navPending: boolean;
    flush(): void; writeBack(): void; perceiveStep(): void; spotsStep(): void; flushMapNotices(): void;
    navStep(): void; evacuateSites(): void; rescueTrapped(): void };
  state.reconciled = true; state.navWarm = true; state.navPending = false;
  for (const name of ['flush', 'writeBack', 'perceiveStep', 'spotsStep', 'flushMapNotices', 'navStep', 'evacuateSites', 'rescueTrapped'] as const)
    t.mock.method(state, name, () => {});
  t.mock.method(god.builds, 'sweep', () => {}); t.mock.method(god.builds, 'hasClosure', () => false);
  t.mock.method(bridge.layers, 'active', () => active);
  t.mock.method(bridge.layers, 'dayKey', () => active ? 'day' : '');
  t.mock.method(bridge.layers, 'step', () => ({ changed: 0, posted: 0 }));
  // An open doorway is geometrically clear. Only enclosed membership can prohibit crossing it.
  const room: Thing = { id: 'house', ref: 'house/room', name: 'room', kind: 'room', what: 'room', words: [],
    at: [0, 0], level: 0, poly: [[-1, -1], [1, -1], [1, 1], [-1, 1]] };
  let fail = false;
  t.mock.method(bridge.nav, 'thingsGen', function* () {
    for (let n = 0; n < 40; n++) yield;
    if (fail) { fail = false; throw new Error('place fixture failure'); }
    return [room];
  });
  const step = bridge.places.syncStep.bind(bridge.places);
  t.mock.method(bridge.places, 'syncStep', () => step(0));
  let listen: (id: string) => void = () => {};
  const rule = ledger.attachPresence({ soulPresence: () => ({ listening: false, at: now - 200_000 }), onSoulListen: f => { listen = f; } })!;
  assert.ok(rule);
  const port = (rule as unknown as { port: BodyPort }).port;
  const soul = { soulId: 's_test', entityId: 'body', name: 'Resident', owner: 'owner' };
  const at = { x: 0, z: 0, level: 0 }, decisions: { option: string; steps: Parameters<BodyPort['decide']>[3] }[] = [];
  t.mock.method(port, 'souls', () => [soul]); t.mock.method(port, 'createdAt', () => now - 200_000);
  t.mock.method(port, 'pose', () => at); t.mock.method(port, 'posture', () => 'standing');
  t.mock.method(port, 'agentBusy', () => false); t.mock.method(port, 'running', () => false);
  t.mock.method(port, 'dry', () => true); t.mock.method(port, 'clear', () => true);
  const decide: BodyPort['decide'] = (_s, option, _label, steps) => { decisions.push({ option, steps }); };
  t.mock.method(port, 'decide', decide);
  // The actual ledger readiness/place closures are deliberately not mocked.
  rule.sweep();
  function due(state = 'zombie') {
    db.db.prepare('UPDATE edge_body_v1 SET state=?, doing=?, since=?, next_at=0, n=0, anchor_x=?, anchor_z=?, last_act=0, woke_at=0 WHERE world_id=? AND soul_id=?')
      .run(state, state === 'asleep' ? 'dozing' : 'drifting', now - 1000, at.x, at.z, host.worldId, soul.soulId);
  }
  due();
  const row = () => db.db.prepare('SELECT next_at,n FROM edge_body_v1 WHERE world_id=? AND soul_id=?').get(host.worldId, soul.soulId);
  let migrations = 0;
  t.mock.method(ledger as unknown as { migrateGone(): void }, 'migrateGone', () => { migrations++; });
  t.after(() => { host.stop(); db.close(); });
  return { host, ledger, bridge, rule, port, at, decisions, errors, due, row, listen: () => listen(soul.soulId),
    migrations: () => migrations, failNext: () => { fail = true; },
    finish() { for (let n = 0; !bridge.places.hasPublished(); n++) { assert.ok(n < 180, 'initial places must make bounded progress'); host.tickOnce(); } } };
}

for (const active of [true, false]) test(`LINK waits for complete initial rooms with calendar layers ${active ? 'on' : 'off'}`, t => {
  const f = fixture(t, active), due = f.row();
  assert.equal(f.ledger.bodyPlacesReady(), false);
  for (let n = 0; n < 25; n++) f.host.tickOnce();
  assert.equal(f.bridge.places.hasPublished(), false, 'the real place generator is still pending after the first body sweep');
  assert.equal(f.ledger.places.byId.has('g-house.room'), false, 'no partial room publication');
  assert.deepEqual([...f.decisions], []); assert.deepEqual(f.row(), due, 'do not consume the due reflex or random sequence');
  assert.equal(f.migrations(), 0, 'one-time gone migration must not consult provisional places');
  f.finish(); assert.equal(f.ledger.bodyPlacesReady(), true);
  assert.equal(f.ledger.places.byId.get('g-house.room')?.enclosed, true);
  f.rule.sweep();
  assert.deepEqual([...f.decisions], [], 'all 2–6 m candidates leave this room through geometrically clear space and are refused');
  f.at.x = 20; f.due(); f.rule.sweep();
  assert.equal(f.decisions.length, 1, 'ordinary same-place reflex resumes after publication');
  assert.equal(f.decisions[0].option, 'body:zombie-shuffle');
  assert.equal(f.decisions[0].steps[0].params.pace, 'shuffle');
  for (let n = 0; n < 40; n++) f.host.tickOnce();
  assert.equal(f.migrations(), 1, 'migration runs exactly once after readiness');
  assert.deepEqual(f.errors, []);
});

test('LINK wake, accepted actions and asleep posture remain immediate while initial places are pending', t => {
  const f = fixture(t, true);
  f.due('asleep'); f.rule.sweep();
  assert.equal(f.decisions.at(-1)?.option, 'body:asleep');
  f.listen(); assert.equal(f.rule.view('s_test')?.state, 'awake');
  f.due(); f.rule.touch('s_test'); assert.equal(f.rule.view('s_test')?.state, 'awake');
  assert.equal(f.ledger.bodyPlacesReady(), false);
});

test('a due idle reflex also waits without consuming its random choice', t => {
  const f = fixture(t, true);
  t.mock.method(f.port, 'presence', () => ({ listening: true, at: null }));
  f.due('idle'); const due = f.row(); f.rule.sweep();
  assert.deepEqual(f.row(), due); assert.deepEqual(f.decisions, []);
  assert.equal(f.rule.view('s_test')?.state, 'idle');
});

test('a failed initial place pass cannot unlock LINK spatial reflexes or consume migration', t => {
  const f = fixture(t, false); f.failNext();
  for (let n = 0; n < 48; n++) f.host.tickOnce();
  assert.ok(f.errors.some(e => e.includes('place fixture failure')));
  assert.equal(f.ledger.bodyPlacesReady(), false); assert.equal(f.migrations(), 0); assert.deepEqual(f.decisions, []);
  f.finish(); assert.equal(f.ledger.bodyPlacesReady(), true);
});
