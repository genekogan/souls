// srv-load: load levels with hysteresis (LOAD-CONTRACT §1), live.json from the shared numbers (§4).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_CAP_MS, LevelState, LoadMonitor, QUIET_TICK_ALPHA, QuietBaseline, QuietTick, STEP_DOWN_MS, type Signals} from './load/monitor.ts';
import {liveOf, newSharedLoad, S} from './load/shared.ts';
import {attachBootSlots, bootPhase, bootSlots, bootTick} from './load/boot-progress.ts';

const calm: Signals = {service: 1, loopP99Ms: 5, heapFrac: 0.2, gcFrac: 0.01, oldestMs: 0};
const at = (s: Partial<Signals>) => ({...calm, ...s});

test('levels: enter on any condition, at once and straight to the highest that holds', () => {
  const l = new LevelState();
  assert.equal(l.update(calm, 0), 'green');
  assert.equal(l.update(at({loopP99Ms: 250}), 1), 'amber');
  assert.equal(new LevelState().update(at({heapFrac: 0.86}), 0), 'red');
  assert.equal(new LevelState().update(at({oldestMs: 6500}), 0), 'amber', 'queue age alone is amber (the hint), never red');
  assert.equal(new LevelState().update(at({service: 0.79}), 0), 'amber');
  assert.equal(new LevelState().update(at({heapFrac: 0.93, gcFrac: 0.41}), 0), 'black');
  assert.equal(new LevelState().update(at({heapFrac: 0.93, gcFrac: 0.2}), 0), 'red', 'a full heap alone is red, not black');
});

test('levels: a queue red itself starves cannot hold red (the red lock): service 1.0 with a 6 s queue steps down in 30 s', () => {
  const l = new LevelState(); let t = 0;
  l.update(at({service: 0.3}), t); assert.equal(l.level, 'red', 'a real stall enters red');
  l.update(at({oldestMs: 6100}), t += 1000); assert.equal(l.level, 'red', 'the queue left behind is not yet 30 s calm');
  l.update(at({oldestMs: 6100}), t += STEP_DOWN_MS); assert.equal(l.level, 'amber', 'service/loop/heap calm: down one step despite the queue');
  l.update(at({oldestMs: 2500}), t += 1000); assert.equal(l.level, 'amber', 'a 2.5 s queue is between the amber bands: calm starts');
  l.update(at({oldestMs: 2500}), t += STEP_DOWN_MS); assert.equal(l.level, 'green', 'and the queue cannot hold amber either');
  assert.equal(new LevelState().update(at({oldestMs: 2500}), 0), 'amber', 'a 2 s queue still raises the hint');
});

test('levels: black on tick service < 0.2 only after 30 s of it', () => {
  const l = new LevelState();
  assert.equal(l.update(at({service: 0.1}), 0), 'red');
  assert.equal(l.update(at({service: 0.1}), 29_000), 'red');
  assert.equal(l.update(at({service: 0.1}), 30_000), 'black');
  const m = new LevelState(); m.update(at({service: 0.1}), 0); m.update(at({service: 0.3}), 10_000);
  assert.equal(m.update(at({service: 0.1}), 31_000), 'red', 'the 30 s restart after a better sample');
});

test('levels: leave one step at a time after 30 s below the lower band; a signal between bands holds the level', () => {
  const l = new LevelState(); let t = 0;
  l.update(at({loopP99Ms: 1500}), t); assert.equal(l.level, 'red');
  l.update(at({loopP99Ms: 500}), t += 1000); assert.equal(l.level, 'red', 'between red bands (400..1000)');
  l.update(at({loopP99Ms: 500}), t += STEP_DOWN_MS + 1000); assert.equal(l.level, 'red', 'never below the red band: stays');
  l.update(at({loopP99Ms: 150}), t += 1000); assert.equal(l.level, 'red');
  l.update(at({loopP99Ms: 150}), t += STEP_DOWN_MS - 1); assert.equal(l.level, 'red');
  l.update(at({loopP99Ms: 150}), t += 1); assert.equal(l.level, 'amber', 'one step down');
  l.update(at({loopP99Ms: 150}), t += STEP_DOWN_MS + 5000); assert.equal(l.level, 'amber', '150 ms is not below the amber band (100)');
  l.update(calm, t += 1000); l.update(at({loopP99Ms: 120}), t += 20_000); l.update(calm, t += 1000);
  l.update(calm, t += STEP_DOWN_MS - 2000); assert.equal(l.level, 'amber', 'a sample above the band restarts the 30 s');
  l.update(calm, t += 2000); assert.equal(l.level, 'green');
});

test('levels: loop bands are relative to the quiet baseline (a 170 ms-quiet world returns to green)', () => {
  const l = new LevelState(); l.baselineMs = 170; let t = 0;
  assert.equal(l.update(at({loopP99Ms: 190}), t), 'green', 'its own quiet ticks are not load (amber enters at 2 × 170)');
  assert.equal(l.update(at({loopP99Ms: 330}), t += 250), 'green');
  assert.equal(l.update(at({loopP99Ms: 350}), t += 250), 'amber', 'above 2 × baseline');
  l.update(at({loopP99Ms: 180}), t += 1000); l.update(at({loopP99Ms: 180}), t += STEP_DOWN_MS);
  assert.equal(l.level, 'green', 'leaves below 1.2 × baseline (204 ms), where the fixed 100 ms band never would');
  const fixed = new LevelState(); fixed.update(at({loopP99Ms: 350}), 0); fixed.update(at({loopP99Ms: 180}), 1000); fixed.update(at({loopP99Ms: 180}), 1000 + STEP_DOWN_MS);
  assert.equal(fixed.level, 'amber', 'the absolute bands (no baseline) hold it at amber: the defect');
  const small = new LevelState(); small.baselineMs = 20;
  assert.equal(small.update(at({loopP99Ms: 210}), 0), 'amber', 'a small world keeps the absolute floor');
  const red = new LevelState(); red.baselineMs = BASELINE_CAP_MS;
  assert.equal(red.update(at({loopP99Ms: 900}), 0), 'amber', 'a capped baseline keeps amber below red');
  assert.equal(red.update(at({loopP99Ms: 1100}), 1), 'red');
});

test('quiet baseline: a decaying peak of quiet windows (the live Eden pattern: ~30 ms, a 150 ms window every 10-15 s)', () => {
  const b = new QuietBaseline();
  const quietEden = [25, 32, 159, 32, 145, 25, 32, 31, 25, 26, 150, 24];
  for (const x of quietEden) b.window(x, true);
  assert.ok(b.value > 140 && b.value <= 159, `holds the quiet peaks: ${b.value}`);
  const l = new LevelState(); l.baselineMs = b.value; let t = 0;
  l.update(at({loopP99Ms: 600}), t); assert.equal(l.level, 'amber');
  for (const x of [159, 159, 32, 145, 145, 32, 150, 150]) l.update(at({loopP99Ms: x}), t += 5000);   // max of two windows
  assert.equal(l.level, 'green', 'max-of-two-windows signal of a quiet Eden stays under 1.2 × the peak: green after 30 s');
  const before = b.value; for (let i = 0; i < 50; i++) b.window(5000, false);
  assert.equal(b.value, before, 'load neither teaches it nor decays it');
  for (let i = 0; i < 70; i++) b.window(20, true);
  assert.ok(b.value < 50, `decays to a lighter world in ~6 min: ${b.value}`);
  const capped = new QuietBaseline(); capped.window(3000, true); assert.equal(capped.value, BASELINE_CAP_MS);
  const pin = new QuietBaseline(120); pin.window(10, true); assert.equal(pin.value, 120, 'pinned: never learned');
  assert.equal(new QuietBaseline(Number.NaN).pinned, undefined, 'a bad pin is ignored');
});

test('monitor: a synthetic 170 ms quiet tick (real event-loop histogram) is learned as the baseline; load is not', async () => {
  const host = {engine: {world: {tick: 0}}, tickMs: [...Array(97).fill(5), 170, 170, 170], paused: false, pace: 1, baseRate: 1, running: false, clockAvailable: true};
  let reqMs = 0, depth = 0;
  const m = new LoadMonitor({host, shared: newSharedLoad(), sampleMs: 50, windowMs: 600, requestMs: () => reqMs, queue: () => ({depth, oldestMs: 0})});
  const block = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { /* a 170 ms tick */ } };
  const ticker = setInterval(() => block(170), 300);
  try {
    m.start();
    await new Promise(r => setTimeout(r, 3200));   // ~5 quiet windows
    const learned = m.state.baselineMs;
    assert.ok(learned >= 150 && learned <= 260, `quiet loop p99 ~170 ms learned: ${learned}`);
    assert.equal(m.level, 'green', 'its own quiet ticks keep it green (the fixed 200 ms band would be close to the edge)');
    depth = 3; reqMs += 10_000;   // loaded windows
    await new Promise(r => setTimeout(r, 1400));
    assert.ok(Math.abs(m.state.baselineMs - learned) < 1e-9, 'loaded windows do not move it');
    assert.equal(m.health().loopBaselineMs, Math.round(learned));
  } finally { clearInterval(ticker); m.stop(); }
});

test('monitor: un-admitted main-thread work in a quiet window is bounded by the world\'s own tick p99', () => {
  const host = {engine: {world: {tick: 0}}, tickMs: [...Array(97).fill(5), 170, 170, 170], paused: false, pace: 1, baseRate: 1, running: false, clockAvailable: true};
  const m = new LoadMonitor({host, now: () => 5000, shared: newSharedLoad()});
  m.sample();   // tick stats: p99 170
  m.windowDone(2500, 5000);   // an account creation blocked the loop for 2.5 s; nothing was queued
  assert.equal(m.state.baselineMs, 1.25 * 170 + 10);
});

test('monitor: tick service counts dilation and slow frames as missed, a paused or stopped clock as served', () => {
  let now = 0; const host = {engine: {world: {tick: 0}}, tickMs: [10, 20, 30], paused: false, pace: 1, baseRate: 1, running: true, clockAvailable: true};
  const shared = newSharedLoad(), m = new LoadMonitor({host, now: () => now, shared});
  m.sample();
  for (let i = 0; i < 20; i++) { now += 250; host.engine.world.tick += 2; m.sample(); }   // 8 ticks/s of 20 owed
  assert.ok(Math.abs(m.signals.service - 0.4) < 0.01, String(m.signals.service));
  assert.equal(m.level, 'red');
  host.paused = true; for (let i = 0; i < 25; i++) { now += 250; m.sample(); }
  assert.equal(m.signals.service, 1, 'nothing owed while paused');
  assert.equal(shared[S.worldTick], 40); assert.equal(m.tickStats.avg, 20); assert.equal(m.tickStats.max, 30);
  assert.equal(m.health().level, 'red');
});

test('monitor: dials hear the level at once and on every change; black for the limit asks for the planned restart', () => {
  let now = 0, restarts = 0; const heard: string[] = [];
  const host = {engine: {world: {tick: 0}}, tickMs: [], paused: false, pace: 1, baseRate: 1, running: true, clockAvailable: true};
  const m = new LoadMonitor({host, now: () => now, shared: newSharedLoad(), blackLimitMs: 60_000, onBlackTooLong: () => restarts++, queue: () => ({depth: 1, oldestMs: 0})});
  m.register('test', l => heard.push(l));
  assert.deepEqual(heard, ['green']);
  m.sample(); for (let i = 0; i < 4 * 95; i++) { now += 250; m.sample(); }   // no ticks at all for 95 s
  assert.deepEqual(heard, ['green', 'red', 'black']);
  assert.equal(restarts, 1, 'black from 30 s, restart at 90 s');
});

test('live.json: phases, boot progress through the absorbed L5 slots, and the turn age of a stuck thread', () => {
  const a = newSharedLoad(), before = bootSlots();
  attachBootSlots(a, S.boot);
  try {
    bootPhase('boot:replay', 100, 900); bootTick(128);
    a[S.lastTurnAt] = 0;
    let live = liveOf(a, 42, Date.now());
    assert.equal(live.phase, 'boot:replay'); assert.deepEqual(live.boot, {stage: 'replay', tick: 128, target: 900});
    assert.ok(live.loop.lastTurnAgeMs < 1000, 'the replay tick stamps the turn');
    assert.equal(live.tick, undefined); assert.equal(live.queue, undefined);
    bootPhase('serving', 900); a[S.worldTick] = 901; a[S.level] = 2; a[S.queueDepth] = 3;
    live = liveOf(a, 42, Date.now() + 40_000);
    assert.equal(live.phase, 'serving'); assert.equal(live.boot, undefined); assert.equal(live.level, 'red');
    assert.deepEqual(live.queue, {depth: 3, oldestMs: 0}); assert.equal(live.tick!.world, 901);
    assert.ok(live.loop.lastTurnAgeMs >= 40_000, 'a thread that stopped turning shows its age');
    assert.equal(live.v, 1); assert.equal(live.pid, 42);
  } finally { attachBootSlots(before.view as Float64Array, before.offset); }
});

test('quiet tick (srv-admission-calib): an EWMA over quiet windows; a provisional seed until the first quiet window', () => {
  const q = new QuietTick();
  assert.equal(q.window(30, false, true), 30, 'never quiet yet: a served window seeds it provisionally');
  assert.equal(q.window(40, false, false), 30, 'an unserved, loaded window teaches nothing');
  assert.equal(q.window(12, true, true), 12, 'the first quiet window replaces the provisional seed');
  assert.equal(q.window(50, false, true), 12, 'after that, loaded windows teach nothing');
  assert.ok(Math.abs(q.window(22, true, true) - (12 + QUIET_TICK_ALPHA * 10)) < 1e-9, 'quiet windows move it by alpha');
  assert.equal(q.window(Number.NaN, true, true), 13);
});

test('monitor: the quiet tick is the window\'s own tick average, learned only in quiet windows, and published', () => {
  let now = 0, reqMs = 0;
  const host = {engine: {world: {tick: 0}}, tickMs: [] as number[], paused: false, pace: 1, baseRate: 1, running: true, clockAvailable: true};
  const shared = newSharedLoad(), m = new LoadMonitor({host, now: () => now, shared, requestMs: () => reqMs, windowMs: 5000});
  m.start(); m.stop();   // opens the first window at now = 0 (no histogram needed: windowDone is driven by hand)
  const run = (ms: number, n = 100) => { for (let i = 0; i < n; i++) { host.engine.world.tick++; host.tickMs.push(ms); if (host.tickMs.length > 400) host.tickMs.splice(0, 200); } };
  run(3); now = 5000; m.sample(); m.windowDone(10, now);   // the serving warm-up window: not learned
  assert.equal(m.quietTick.value, 0);
  run(12); now = 10_000; m.sample(); m.windowDone(10, now);
  assert.equal(m.quietTick.value, 12, 'the window\'s own 100 ticks, not the 20 s ring (which still holds the warm-up 3 ms ticks)');
  assert.equal(shared[S.quietTickMs], 12);
  reqMs += 2000; run(35); now = 15_000; m.sample(); m.windowDone(10, now);
  assert.equal(m.quietTick.value, 12, 'a loaded window (requests 40 % of it) teaches nothing');
  run(14); now = 20_000; m.sample(); m.windowDone(10, now);
  assert.ok(Math.abs(m.quietTick.value - 12.2) < 1e-9, String(m.quietTick.value));
  m.sample();
  assert.equal(m.health().quietTickMs, 12.2); assert.equal(m.health().frameBudgetMs, 22.7, 'green: 0.6 × (50 − 12.2)');
  const before = bootSlots(); attachBootSlots(shared, S.boot);
  try { bootPhase('serving', 0); assert.equal(liveOf(shared, 1, now).tick!.quietAvgMs, 12.2, 'live.json carries it for the launcher and the bench'); }
  finally { attachBootSlots(before.view as Float64Array, before.offset); }
});


test('monitor: deliberate process suspension is not missed service, and resume retains an existing overload', () => {
  let now = 0;
  const host = {engine: {world: {tick: 0}}, tickMs: [1], paused: false, pace: .25, baseRate: 1, running: true, clockAvailable: true};
  const m = new LoadMonitor({host, now: () => now, shared: newSharedLoad()});
  m.start();
  try {
    for (let i = 0; i < 20; i++) { now += 1000; host.engine.world.tick += 5; m.sample(); }
    assert.equal(m.level, 'green');
    now += 10_000; // launcher SIGSTOP: no ticks, monitor callbacks or requests run
    process.emit('SIGCONT');
    host.engine.world.tick++; // first tick of the resumed frame; remaining ticks yield between turns
    m.sample();
    assert.equal(m.level, 'green', 'suspended wall time is not starvation');
    assert.equal(m.health().service5s, 1);
    for (let i = 0; i < 25; i++) { now += 250; m.sample(); } // genuinely stalled after resume
    assert.equal(m.level, 'red', 'a running but stalled clock still enters red');
    now += 10_000; process.emit('SIGCONT'); m.sample();
    assert.equal(m.level, 'red', 'resume does not clear a pre-existing overload');
  } finally { m.stop(); }
});


test('monitor: overdue sample waits for SIGCONT delivery and stop cancels the queued sample', t => {
  let now = 0, timerCallback = () => {}, pending: (() => void) | undefined, cancelled = false;
  t.mock.method(globalThis, 'setInterval', (fn: () => void) => { timerCallback = fn; return {unref() {}} as NodeJS.Timeout; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'setImmediate', (fn: () => void) => { pending = fn; return {} as NodeJS.Immediate; });
  t.mock.method(globalThis, 'clearImmediate', () => { cancelled = true; pending = undefined; });
  const host = {engine: {world: {tick: 0}}, tickMs: [1], paused: false, pace: .25, baseRate: 1, running: true, clockAvailable: true};
  const m = new LoadMonitor({host, now: () => now, shared: newSharedLoad()});
  const listeners = process.listenerCount('SIGCONT');
  m.start();
  try {
    now = 1000; host.engine.world.tick = 5; m.sample();
    now += 10_000; host.engine.world.tick++;
    timerCallback(); // overdue timers phase precedes signal delivery on a real thaw
    assert.equal(m.level, 'green');
    process.emit('SIGCONT');
    assert.ok(pending); pending();
    assert.equal(m.level, 'green');
    timerCallback(); m.stop();
    assert.equal(cancelled, true);
    assert.equal(process.listenerCount('SIGCONT'), listeners);
  } finally { m.stop(); }
});
