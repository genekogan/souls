import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { toyFactory } from '@souls/engine-toy';
import type { Engine, EngineFactory } from '@souls/engine-contract';
import { Db } from './db.ts';
import { WorldHost } from './world.ts';
import { faultFacts, glitchLine, THROWN_RULE } from './glitch.ts';
import { LoadMonitor } from './load/monitor.ts';
import { liveOf, newSharedLoad } from './load/shared.ts';
import { rowsOf } from '../test/glitch-rows.ts';

// #1150 slice 4: every recovery and halt is reported, and reporting changes nothing else. Faults are forced at the host, so
// this is about the report; the real collision is in edge-hotfix-fault.test.ts.
const worldId = 'glitch', collision = [{ code: 'collision.human-load', subjects: ['body-b', 'body-a', 'body-b'], message: 'body-a inside a load' }, { code: 'motion.overspeed', subjects: ['body-a'], message: 'fast' }];
type Priv = { recoverFault(error: unknown, card?: string): void; haltOnFault(error: unknown, why: string): void; failCheckpoint(error: unknown): void };

function fixture(t: TestContext, snapshots = true) {
  const db = new Db(':memory:'), control = { fault: null as Error | null };
  const wrap = (engine: Engine) => {
    const step = engine.step.bind(engine);
    engine.step = () => { const fault = control.fault; control.fault = null; if (fault) throw fault; return step(); };
    engine.canSnapshot = () => snapshots;
    return engine;
  };
  const factory: EngineFactory = { ...toyFactory, create: w => wrap(toyFactory.create(w)), restore: s => wrap(toyFactory.restore(s)) };
  const host = new WorldHost(db, factory, worldId, 1e9, worldId, { durableClockV1: true });
  host.boot(); host.drainInputs();
  const lines: string[] = [], keep = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  t.mock.method(console, 'error', keep); t.mock.method(console, 'warn', keep);
  t.after(() => { host.stop(); db.close(); });
  return { db, host, control, lines, factory, priv: host as unknown as Priv };
}

test('a recovery: one record with rung, rule, bodies, tick and evidence; a count; one log line; the event log holds only the recovery it always held', t => {
  const f = fixture(t); f.host.tickOnce(); f.host.saveSnapshot(true);
  const tick = f.host.engine.world.tick, seq = f.db.lastSeq(worldId);
  f.priv.recoverFault(new Error(JSON.stringify(collision)), 'fixture-card');
  const rows = rowsOf(f.db);
  assert.equal(rows.length, 1);
  assert.deepEqual({ rung: rows[0].rung, rule: rows[0].rule, bodies: rows[0].bodies, tick: rows[0].tick }, { rung: 'recovery', rule: 'collision.human-load', bodies: ['body-a', 'body-b'], tick });
  assert.equal(rows[0].evidence.seq, seq + 1, 'names the logged recovery'); assert.equal(rows[0].evidence.plan, 1);
  assert.match(String(rows[0].evidence.reason), /collision\.human-load/); assert.deepEqual(rows[0].evidence.rules, ['collision.human-load', 'motion.overspeed']);
  assert.deepEqual(f.host.glitches, { total: 1, byRule: { 'collision.human-load': { recovery: 1 } } }, 'one record per recovery, under the first rule the tick broke');
  assert.deepEqual(f.lines.filter(l => l.startsWith('[world] glitch')), [`[world] glitch rung=recovery rule=collision.human-load tick=${tick} seq=${seq + 1} bodies=body-a,body-b`]);
  assert.deepEqual(f.db.events(worldId, seq).map(e => e.author), ['world:recovery']);
});

test('the count survives a restart, and replaying a logged recovery adds no record', t => {
  const f = fixture(t); f.host.tickOnce(); f.host.saveSnapshot(true);
  f.priv.recoverFault(new Error(JSON.stringify(collision)), 'fixture-card');
  f.host.tickOnce(); f.host.drainInputs(); f.host.stop();
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);   // a boot from genesis replays the recovery
  const again = new WorldHost(f.db, f.factory, worldId, 1e9, worldId, { durableClockV1: true });
  t.after(() => again.stop());
  assert.equal(again.boot().from, 'genesis');
  assert.deepEqual(again.glitches, { total: 1, byRule: { 'collision.human-load': { recovery: 1 } } });
  assert.equal(rowsOf(f.db).length, 1);
});

test('a halt with no baseline: a record at the fault\'s tick; the event log stays frozen', t => {
  const f = fixture(t, false); f.host.recoveryForEdge = true;
  f.host.tickOnce(); f.host.tickOnce();
  const seq = f.db.lastSeq(worldId), tick = f.host.engine.world.tick;
  f.control.fault = new Error(JSON.stringify(collision));
  f.host.tickOnce();
  assert.equal(f.host.clockAvailable, false);
  const rows = rowsOf(f.db);
  assert.equal(rows.length, 1);
  assert.deepEqual({ rung: rows[0].rung, rule: rows[0].rule, bodies: rows[0].bodies, tick: rows[0].tick }, { rung: 'halt', rule: 'collision.human-load', bodies: ['body-a', 'body-b'], tick });
  assert.equal(f.db.lastSeq(worldId), seq, 'nothing appended to the event log (#1120)');
  assert.ok(f.lines.some(l => l.startsWith('[world] glitch rung=halt rule=collision.human-load')));
});

test('a halt after a failed replay: the record names the fault that started it, keeps the replay\'s failure as evidence, and says the fault\'s tick', t => {
  const f = fixture(t); f.host.recoveryForEdge = true; f.host.tickOnce(); f.host.saveSnapshot(true);
  const tick = f.host.engine.world.tick;
  (f.host as unknown as { restoreRecovery(): void }).restoreRecovery = () => { f.host.engine.step(); throw new Error('recovery replay still violates the engine: fixture'); };
  f.priv.recoverFault(new Error(JSON.stringify(collision)), 'fixture-card');
  assert.match(f.host.engineFault!, /recovery replay still violates/, 'the paused world keeps naming the replay, as before');
  const [row] = rowsOf(f.db);
  assert.deepEqual({ rung: row.rung, rule: row.rule, tick: row.tick, why: row.evidence.why }, { rung: 'halt', rule: 'collision.human-load', tick, why: 'recovery replay still faults' });
  assert.match(String(row.evidence.last), /recovery replay still violates/); assert.match(String(row.evidence.reason), /collision\.human-load/);
});

test('durability failures are halts, named as such', t => {
  const f = fixture(t);
  f.priv.failCheckpoint(new Error('disk full at /some/private/place'));
  assert.deepEqual(f.host.glitches, { total: 1, byRule: { 'durability.checkpoint': { halt: 1 } } });
  assert.match(String(rowsOf(f.db)[0].evidence.reason), /disk full/, 'the evidence keeps the text');
});

test('a broken clock frontier write is a halt under its own name', t => {
  const f = fixture(t);
  f.db.db.exec('DROP TABLE clock_frontiers_v1');
  assert.throws(() => { f.host.tickOnce(); f.host.drainInputs(); f.host.saveSnapshot(true); });
  assert.equal(f.host.clockAvailable, false);
  assert.deepEqual(f.host.glitches.byRule['durability.clock-frontier'], { halt: 1 });
});

test('a thrown error never becomes a public rule name', () => {
  for (const fault of [new Error('fixture.unrepairable'), new Error('s_soul123.token is bad'), new Error('[1,2]'), 'not an error', new Error(JSON.stringify([{ code: 'Bearer abc', subjects: ['x'] }]))])
    assert.equal(faultFacts(fault).rule, THROWN_RULE, String(fault));
  assert.deepEqual(faultFacts(new Error(JSON.stringify([{ code: 'collision.human-human', subjects: ['b', 'a'] }]))), { rule: 'collision.human-human', rules: ['collision.human-human'], bodies: ['a', 'b'] });
  assert.equal(glitchLine({ rung: 'halt', rule: THROWN_RULE, bodies: [], tick: 3, at: 1, evidence: {} }), '[world] glitch rung=halt rule=engine.thrown tick=3 bodies=-');
});

test('a reporting failure changes nothing: the recovery and the halt go on, the line and the count still come out', t => {
  const f = fixture(t); f.host.tickOnce(); f.host.saveSnapshot(true);
  f.db.db.exec('DROP TABLE glitches_v1');
  const tick = f.host.engine.world.tick;
  f.priv.recoverFault(new Error(JSON.stringify(collision)), 'fixture-card');
  assert.equal(f.host.clockAvailable, true); assert.equal(f.host.engine.world.tick, tick);
  assert.deepEqual(f.host.glitches, { total: 1, byRule: { 'collision.human-load': { recovery: 1 } } });
  assert.ok(f.lines.some(l => l.startsWith('[world] glitch record not written:')));
  assert.ok(f.lines.some(l => l.startsWith('[world] glitch rung=recovery')));
  f.priv.haltOnFault(new Error('fixture.unrepairable'), 'no resumable recovery baseline');
  assert.equal(f.host.clockAvailable, false); assert.deepEqual((f.host.glitches.byRule as Record<string, unknown>)[THROWN_RULE], { halt: 1 });
});

test('the load monitor publishes a stopped clock to live.json, and only then', () => {
  const host = { engine: { world: { tick: 0 } }, tickMs: [], paused: false, pace: 1, baseRate: 1, running: true, clockAvailable: true };
  const shared = newSharedLoad(), m = new LoadMonitor({ host, now: () => 5000, shared });
  m.sample(); assert.equal(liveOf(shared, 1, 5000).halted, undefined, 'live.json is unchanged while the clock runs');
  host.clockAvailable = false;
  m.sample(); assert.equal(liveOf(shared, 1, 5000).halted, true);
  m.stop();
});
