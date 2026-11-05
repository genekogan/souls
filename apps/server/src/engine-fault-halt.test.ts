// #447: an edge world whose engine fault recovery cannot repair. Before the fix it paused for good: the process stayed
// up, healthz answered `paused: true`, the clock was frozen and the launcher saw a live world. The log did not name the
// violation. `seq` was left behind the log when the failed replay set aside the last events, so the next append
// collided ("UNIQUE constraint failed: events.world_id, events.seq"). The shutdown snapshot then made the failed replay
// the head. Now the halt names the original violation, keeps `seq` at the log head, never snapshots the failed state
// and hands off to the process owner (main.ts exits 76 for a restart). A restart from the last good snapshot replays
// the log with no diffs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {toyFactory} from '@sim/engine-toy';
import type {Engine, EngineFactory} from '@sim/engine-contract';
import {Db} from './db.ts';
import {WorldHost, faultSummaryV1, replayFromGenesis, type WorldHaltV1} from './world.ts';
import {liveOf, newSharedLoad, S} from './load/shared.ts';
import {LoadMonitor} from './load/monitor.ts';

/** A world fault every replay of this process reproduces (as a logged release standing a body in geometry did): from
 *  `at` on, each step reports a static overlap for h_A while `armed`. A new process (the restart) is not armed. */
function faulting(state: {armed: boolean; at: number}): EngineFactory {
  const wrap = (e: Engine) => { const step = e.step.bind(e);
    e.step = () => { const out = step(); if (state.armed && e.world.tick >= state.at) e.runtime.violations.push({code: 'collision.human-static', message: 'h_A body overlaps static geometry (fixture)', subjects: ['h_A'], tick: e.world.tick} as never); return out; };
    return e; };
  return {...toyFactory, create: w => wrap(toyFactory.create(w)), restore: s => wrap(toyFactory.restore(s))};
}
const maxSeq = (db: Db, id: string) => (db.db.prepare('SELECT MAX(seq) AS m FROM events WHERE world_id=?').get(id) as {m: number}).m;

test('an unrecoverable edge fault halts with its original violation named, seq at the log head, no snapshot of the failed state; a restart replays with 0 diffs', () => {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'sim-halt-')), 'sim.db')), state = {armed: false, at: 0}, factory = faulting(state);
  const h = new WorldHost(db, factory, 'halt', 1e9); h.boot(); h.recoveryForEdge = true;
  const halts: WorldHaltV1[] = []; h.onEngineHalt = x => halts.push(x);
  void h.enqueue('birth', 'test', {soulId: 's_A', entityId: 'h_A', name: 'A', description: 'quiet', owner: 'test-owner'}); h.tickOnce();
  for (let i = 0; i < 20; i++) h.tickOnce();
  h.saveSnapshot(); const good = db.latestSnapshot(h.worldId)!;
  for (let i = 0; i < 20; i++) h.tickOnce();
  // the last logged event is the edge decision recovery sets aside: the failed replay ends one seq short of the log
  void h.enqueue('decision', 'edge:s_A', {soulId: 's_A', entityId: 'h_A', option: 'rest', label: 'rest', steps: [{verb: 'rest', params: {seconds: 60}}], reevalTicks: 1e9, fallback: false, trigger: 'edge-test'});
  h.tickOnce(); const head = maxSeq(db, h.worldId);
  state.armed = true; state.at = h.engine.world.tick + 1;
  const errors: string[] = [], ce = console.error; console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try { h.tickOnce(); } finally { console.error = ce; }
  // A2: named, and published for healthz / live.json / the launcher
  assert.equal(halts.length, 1, 'the process owner is told once');
  assert.equal(halts[0].kind, 'engine-fault'); assert.equal(halts[0].why, 'recovery replay still faults');
  assert.deepEqual(halts[0].original, {code: 'collision.human-static', subjects: ['h_A'], tick: state.at, message: 'h_A body overlaps static geometry (fixture)'});
  assert.match(halts[0].replay!, /^Error: recovery replay still violates the engine: collision\.human-static \[h_A\]/);
  assert.deepEqual(h.halted(), halts[0]); assert.equal(h.paused, true);
  assert.ok(errors.some(l => l.includes(`original collision.human-static [h_A] at tick ${state.at}: h_A body overlaps static geometry`)), errors.join('\n'));
  // A1b: seq is the log head, so the next append does not collide
  assert.equal(h.seq, head);
  void h.enqueue('admin', 'test', {action: 'note'}); assert.doesNotThrow(() => h.drainInputs()); assert.equal(maxSeq(db, h.worldId), head + 1);
  // A1c: the failed replay is never made the head
  assert.throws(() => h.saveSnapshot(), /snapshot\.engine-fault/); assert.equal(h.requestSnapshot('stop', {now: true}), null);
  assert.equal(db.latestSnapshot(h.worldId)!.tick, good.tick, 'the last good snapshot stays the head');
  h.stop();
  // A4: the restart (a new process: the transient fault is gone) boots the last good snapshot and replays the log exactly
  state.armed = false;
  const next = new WorldHost(db, factory, 'halt', 1e9); const boot = next.boot(); next.recoveryForEdge = true;
  assert.equal(boot.from, 'snapshot'); assert.equal(next.seq, head + 1);
  const events = db.events(next.worldId), clean = replayFromGenesis(factory, 'halt', events, next.engine.world.tick);
  assert.equal(next.engine.stateHash(), clean.engine.stateHash(), '0 replay diffs');
  const t0 = next.engine.world.tick; for (let i = 0; i < 100; i++) next.tickOnce();
  assert.equal(next.engine.world.tick, t0 + 100); assert.equal(next.halted(), null); assert.deepEqual(next.engine.runtime.violations, []);
  assert.equal(db.events(next.worldId).filter(e => e.payload?.recovery).length, 0);
  next.stop(); db.close();
});

test('the fault summary reads a violation list or falls back to the error text', () => {
  assert.deepEqual(faultSummaryV1(new Error(JSON.stringify([{code: 'collision.human-static', subjects: ['h_x'], tick: 21720, message: 'm'}]))), {code: 'collision.human-static', subjects: ['h_x'], tick: 21720, message: 'm'});
  assert.deepEqual(faultSummaryV1('Error: [{"code":"collision.human-human","subjects":["a","b"]}]'), {code: 'collision.human-human', subjects: ['a', 'b'], tick: null});
  assert.deepEqual(faultSummaryV1(new Error('fixture.bad-card')), {code: 'error', subjects: [], tick: null, message: 'fixture.bad-card'});
});

test('live.json carries a halt (and only a halt, not an operator pause) from the monitor', () => {
  let halt: {kind: 'engine-fault' | 'clock'; tick: number} | null = null;
  const host = {engine: {world: {tick: 13777}}, tickMs: [5], paused: true, pace: 1, baseRate: 1, running: true, clockAvailable: true, halted: () => halt};
  const a = newSharedLoad(), m = new LoadMonitor({host, now: () => 1000, shared: a});
  m.sample(); assert.equal(liveOf(a, 1, 1000).halted, undefined, 'paused by an operator: no halt');
  halt = {kind: 'engine-fault', tick: 13777}; m.sample(); assert.deepEqual(liveOf(a, 1, 1000).halted, {reason: 'engine-fault', tick: 13777});
  halt = {kind: 'clock', tick: 9}; m.sample(); assert.deepEqual(liveOf(a, 1, 1000).halted, {reason: 'clock', tick: 9});
  assert.equal(S.size, 31);
});
