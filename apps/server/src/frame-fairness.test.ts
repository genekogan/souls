import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { toyFactory } from '@souls/engine-toy';
import { kernelHash } from '@souls/kernel';
import { Db } from './db.ts';
import { ClockFrontiers } from './clock-frontier.ts';
import { WorldHost, replayFromGenesis } from './world.ts';

type Timer = { run: () => void; active: boolean; ms?: number };
type LoopState = { last: number; carry: number; overruns: number; calm: number; frameBatch: { remaining: number } | null };
const state = (h: WorldHost) => h as unknown as LoopState;
function fixture(t: TestContext, durable = false) {
  const db = new Db(':memory:'), host = new WorldHost(db, toyFactory, 'frame-fairness', 1e9, 'frame-fairness', { durableClockV1: durable });
  host.boot(); host.drainInputs();
  t.after(() => { host.stop(); db.close(); });
  return { db, host };
}
/** Drive wall time and callbacks independently; explicitly invoking cancelled callbacks tests generation guards. */
function scheduler(t: TestContext, fakeImmediates = true) {
  let now = 0;
  const intervals: Timer[] = [], immediates: Timer[] = [];
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (run: () => void, ms: number) => {
    const timer = { run, ms, active: true }; intervals.push(timer); return timer as unknown as NodeJS.Timeout;
  });
  t.mock.method(globalThis, 'clearInterval', (timer: Timer) => { timer.active = false; });
  if (fakeImmediates) {
    t.mock.method(globalThis, 'setImmediate', (run: () => void) => {
      const timer = { run, active: true }; immediates.push(timer); return timer as unknown as NodeJS.Immediate;
    });
    t.mock.method(globalThis, 'clearImmediate', (timer: Timer) => { timer.active = false; });
  }
  const next = () => { const timer = immediates.find(x => x.active); if (!timer) return false; timer.active = false; timer.run(); return true; };
  return { intervals, immediates, at(ms: number) { now = ms; },
    frame() { const timer = [...intervals].reverse().find(x => x.active); assert.ok(timer); timer.run(); }, next,
    drain() { let n = 0; while (next()) assert.ok(++n < 100, 'one bounded batch'); },
    pending() { return immediates.filter(x => x.active).length; } };
}

test('one catch-up batch yields complete ticks and accounts elapsed/carry only once', t => {
  const { host } = fixture(t), s = scheduler(t); host.start();
  state(host).carry = .375; s.at(10_000); s.frame();
  assert.equal(host.engine.world.tick, 1, 'only one complete tick runs synchronously');
  assert.equal(host.kernel.tick, 1); assert.equal(host.tickMs.length, 1);
  assert.equal(state(host).frameBatch!.remaining, 19, 'elapsed is still capped at one second');
  assert.equal(state(host).carry, .375); assert.equal(s.pending(), 1);
  s.at(10_100); s.frame(); s.frame();
  assert.equal(host.engine.world.tick, 1); assert.equal(state(host).last, 10_000);
  assert.equal(s.pending(), 1, 'intervals cannot create overlapping continuations');
  s.drain(); assert.equal(host.engine.world.tick, 20); assert.equal(state(host).frameBatch, null);
  s.frame(); s.drain(); assert.equal(host.engine.world.tick, 22); assert.equal(state(host).carry, .375);
});

test('held batches park without spinning and retain their remaining ticks and held wall time', t => {
  const { host } = fixture(t), s = scheduler(t); let held = false; host.holdClock = () => held;
  host.start(); s.at(250); s.frame(); assert.equal(host.engine.world.tick, 1);
  held = true; s.next(); assert.equal(s.pending(), 0);
  s.at(450); s.frame(); s.frame(); assert.equal(host.engine.world.tick, 1);
  assert.equal(state(host).frameBatch!.remaining, 4); assert.equal(state(host).last, 250);
  held = false; s.at(650); s.frame(); s.drain();
  assert.equal(host.engine.world.tick, 5, 'resume finishes exactly the original batch');
  s.frame(); s.drain(); assert.equal(host.engine.world.tick, 13, 'the held 400 ms is accounted in the next batch');
});

test('pace changes during a batch account wall time at the old pace and do not duplicate due ticks', t => {
  const { host } = fixture(t), s = scheduler(t); host.start(); s.at(250); s.frame();
  const oldTimer = s.intervals[0];
  s.at(350); host.setPace(.25);
  assert.equal(state(host).last, 350); assert.equal(state(host).carry, 2);
  assert.equal(s.intervals.at(-1)!.ms, 200); assert.equal(s.pending(), 1);
  s.drain(); assert.equal(host.engine.world.tick, 5);
  s.at(550); oldTimer.run(); assert.equal(host.engine.world.tick, 5, 'a replaced pace timer cannot run');
  s.frame(); s.drain(); assert.equal(host.engine.world.tick, 8);
  assert.equal(state(host).carry, 0);
});

test('stop/start cancels backlog and stale callbacks, start is idempotent, and queued inputs survive', async t => {
  const { host, db } = fixture(t), s = scheduler(t); host.start(); host.start();
  assert.equal(s.intervals.length, 1);
  s.at(250); s.frame(); const oldTimer = s.intervals[0], oldImmediate = s.immediates[0];
  const accepted = host.enqueue('admin', 'fixture', { action: 'queued before stop' });
  host.stop(); assert.equal(s.pending(), 0); assert.equal(state(host).frameBatch, null);
  s.at(1000); host.start(); oldTimer.run(); oldImmediate.run();
  assert.equal(host.engine.world.tick, 1, 'cancelled backlog never leaks into the new clock generation');
  s.at(1050); s.frame(); await accepted;
  assert.equal(host.engine.world.tick, 2); assert.equal(db.events(host.worldId).at(-1)!.payload.action, 'queued before stop');
  host.stop(); host.tickOnce(); assert.equal(host.engine.world.tick, 3, 'manual stepping remains synchronous');
});

test('pause/resume cancels the batch while preserving the explicit pause acceptance tick', t => {
  const { host, db } = fixture(t), s = scheduler(t); host.start(); s.at(250); s.frame();
  const oldImmediate = s.immediates[0];
  host.setPaused(true, 'fixture');
  assert.equal(host.engine.world.tick, 2); assert.equal(host.paused, true); assert.equal(s.pending(), 0);
  assert.equal(db.events(host.worldId).at(-1)!.payload.action, 'pause');
  s.at(1000); s.frame(); oldImmediate.run(); assert.equal(host.engine.world.tick, 2);
  host.setPaused(false, 'fixture'); assert.equal(state(host).carry, 0);
  s.at(1050); s.frame(); oldImmediate.run(); s.drain();
  assert.equal(host.engine.world.tick, 3); assert.equal(db.events(host.worldId).at(-1)!.payload.action, 'resume');
});

test('dilation and recovery are decided once per batch, not once per yielded tick', t => {
  const { host, db } = fixture(t), s = scheduler(t); host.clockRate = host.baseRate = 3; host.start();
  for (let batch = 1; batch <= 3; batch++) {
    s.at(batch * 1000); s.frame();
    assert.equal(state(host).frameBatch!.remaining, 39);
    for (let i = 0; i < 3; i++) { s.frame(); s.next(); }
    assert.equal(state(host).overruns, batch === 3 ? 0 : batch);
    s.drain(); assert.equal(host.engine.world.tick, batch * 40);
  }
  assert.equal(host.clockRate, 1.5); assert.equal(state(host).carry, 0);
  assert.equal(db.events(host.worldId).filter(e => e.payload.why === 'dilation').length, 1);
  state(host).calm = 199; s.at(3050); s.frame(); s.drain();
  assert.equal(host.clockRate, 3); assert.equal(state(host).calm, 0);
  assert.equal(db.events(host.worldId).filter(e => e.payload.why === 'recovered').length, 1);
});

test('a direct fault pause or thrown tick cannot leave a continuation pumping', t => {
  const { host } = fixture(t), s = scheduler(t); host.start();
  const pause = { afterTick() { host.paused = true; } }; host.listeners.push(pause);
  s.at(250); s.frame(); assert.equal(host.engine.world.tick, 1); assert.equal(s.pending(), 0);
  assert.equal(state(host).frameBatch, null);
  host.listeners.splice(host.listeners.indexOf(pause), 1); host.setPaused(false, 'fixture');
  host.listeners.push({ afterTick() { throw new Error('fixture tick failed'); } });
  s.at(500); assert.throws(() => s.frame(), /fixture tick failed/);
  assert.equal(state(host).frameBatch, null); assert.equal(s.pending(), 0);
});

test('a frontier write failure cancels pending work before publishing the failed tick', t => {
  const { host, db } = fixture(t, true), s = scheduler(t); let published = 0;
  host.listeners.push({ afterTick() { published++; } }); host.start(); s.at(250); s.frame();
  const frontier = new ClockFrontiers(db).read(host.worldId)!;
  db.db.exec("CREATE TEMP TRIGGER refuse_clock BEFORE UPDATE ON clock_frontiers_v1 BEGIN SELECT RAISE(ABORT,'fixture frontier refusal'); END");
  assert.throws(() => s.next(), /fixture frontier refusal/);
  assert.equal(host.running, false); assert.equal(host.paused, true); assert.equal(host.clockAvailable, false);
  assert.equal(state(host).frameBatch, null); assert.equal(s.pending(), 0); assert.equal(published, 1);
  assert.deepEqual(new ClockFrontiers(db).read(host.worldId), frontier);
  const restored = new WorldHost(db, toyFactory, host.seed, 1e9, host.worldId, { durableClockV1: true });
  restored.boot(); assert.equal(restored.engine.world.tick, frontier.tick); assert.equal(restored.engine.stateHash(), frontier.engineHash);
});

test('pipelined HTTP observes a complete tick before catch-up ends; admitted inputs remain FIFO and replay exactly', { timeout: 10_000 }, async t => {
  const { host, db } = fixture(t, true), s = scheduler(t, false);
  let healthTick = -1, complete!: () => void, examined!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const healthDone = new Promise<void>(resolve => { examined = resolve; });
  host.listeners.push({ afterTick(tick) { if (tick === 20) { host.stop(); complete(); } } });
  const accepted: { seq: number; tick: number; id: string }[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/arm') { host.start(); s.at(1000); s.frame(); res.end('armed'); }
    else if (req.url === '/health') {
      healthTick = host.engine.world.tick;
      assert.equal(host.kernel.tick, healthTick); assert.equal(host.tickMs.length, healthTick);
      assert.equal(new ClockFrontiers(db).read(host.worldId)!.tick, healthTick, 'frontier is durable before HTTP observes the tick');
      res.end(`tick:${healthTick}`); examined();
    } else {
      const id = req.url === '/birth-a' ? 'A' : 'B';
      void host.enqueue('birth', 'http', { soulId: `s_${id}`, entityId: `h_${id}`, name: id, description: 'fixture', owner: 'fixture' }).then(event => {
        accepted.push({ seq: event.seq, tick: event.tick, id }); res.end(`accepted:${id}`);
      });
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const socket = connect((server.address() as { port: number }).port, '127.0.0.1');
  t.after(() => { socket.destroy(); server.close(); });
  socket.resume(); await once(socket, 'connect');
  const ended = once(socket, 'end');
  // One TCP write makes both reads and both input requests available in the same parser turn.
  socket.write(['/arm', '/health', '/birth-a', '/birth-b'].map((path, i) => `GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: ${i === 3 ? 'close' : 'keep-alive'}\r\n\r\n`).join(''));
  await healthDone;
  assert.ok(healthTick > 0 && healthTick < 20, `HTTP handled at tick ${healthTick}, before the catch-up batch ends`);
  await Promise.all([ended, done]);
  assert.deepEqual(accepted.map(x => x.id), ['A', 'B']); assert.ok(accepted[0].seq < accepted[1].seq);
  assert.equal(accepted[0].tick, accepted[1].tick);
  const events = db.events(host.worldId), replay = replayFromGenesis(toyFactory, host.seed, events, host.engine.world.tick);
  assert.equal(replay.engine.stateHash(), host.engine.stateHash()); assert.equal(kernelHash(replay.kernel), kernelHash(host.kernel));
  const restored = new WorldHost(db, toyFactory, host.seed, 1e9, host.worldId, { durableClockV1: true });
  restored.boot(); assert.equal(restored.engine.stateHash(), host.engine.stateHash()); assert.equal(kernelHash(restored.kernel), kernelHash(host.kernel));
});
