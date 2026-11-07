// Lane SLEEP: when somebody comes back to a world nobody watched (slow clock, frozen, or its process gone), its time of
// day jumps to now with one logged rules event; nothing is simulated and the tick count is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clockAt } from '@souls/brain';
import { ClockCatchUp, catchUpMinMs, catchUpPayload } from './clock-catchup.ts';
import { PAUSED_DAY_TICKS } from './god/world-clock.ts';

type Ev = { kind: string; author: string; payload: { dayConfig: { origin: number; dayTicks: number; customs: string[]; anchor?: number }; why: string } };
function fakeHost(tick = 1000, living: Record<string, unknown> | undefined = { origin: 0, dayTicks: 72000, customs: [], lastDay: -1, event: 'x', quiet: false }) {
  const events: Ev[] = [];
  const host = { worldId: 'w-1', engine: { world: { tick } }, baseRate: 1, paused: false, living, enqueue: (kind: string, author: string, payload: Ev['payload']) => { events.push({ kind, author, payload }); return Promise.resolve(); } };
  return { host, events };
}

test('minimum jump: SIM_CLOCK_CATCHUP_MIN_S seconds, default 60', () => {
  assert.equal(catchUpMinMs({}), 60_000);
  assert.equal(catchUpMinMs({ SIM_CLOCK_CATCHUP_MIN_S: '0' }), 0);
  assert.equal(catchUpMinMs({ SIM_CLOCK_CATCHUP_MIN_S: '5' }), 5_000);
});

test('the payload moves the day clock origin back by the ticks behind, keeping its length, customs and god anchor', () => {
  const p = catchUpPayload({ origin: 500, dayTicks: 72000, customs: ['a'], lastDay: 0, event: '', quiet: false, anchor: 3 } as never, 36000, 1_800_000)!;
  assert.deepEqual(p.dayConfig, { origin: -35500, dayTicks: 72000, customs: ['a'], anchor: 3 });
  assert.match(p.why, /caught up 1800 s/);
  // 36000 ticks = half a day at 72000: the clock reads 12 h later at the same tick
  assert.equal(clockAt(40000, -35500).hour, (clockAt(40000, 500).hour + 12) % 24);
  assert.equal(catchUpPayload(undefined, 100, 1), null, 'no day clock');
  assert.equal(catchUpPayload({ origin: 0, dayTicks: PAUSED_DAY_TICKS, customs: [] } as never, 100, 1), null, 'the god paused time');
});

test('unwatched for an hour at a quarter pace: the clock jumps the three quarters it missed, once', async () => {
  let now = 1_000_000;
  const { host, events } = fakeHost(1000);
  const c = new ClockCatchUp(host as never, mkdtempSync(join(tmpdir(), 'catchup-')), { now: () => now, minMs: 60_000 });
  c.unwatched();
  now += 3_600_000; host.engine.world.tick += 18_000;   // 5 ticks/s for an hour
  await c.watched();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'rules');
  assert.equal(events[0].payload.dayConfig.origin, -54_000, '72000 expected - 18000 run = 54000 behind');
  assert.equal(c.watched(), null, 'nothing more to catch up');
});

test('a short absence (under the minimum) and a paused world do not jump', async () => {
  let now = 0;
  const { host, events } = fakeHost();
  const c = new ClockCatchUp(host as never, mkdtempSync(join(tmpdir(), 'catchup-')), { now: () => now, minMs: 60_000 });
  c.unwatched(); now += 70_000; host.engine.world.tick += 400; await c.watched();   // 70 s, ~50 s behind
  assert.equal(events.length, 0);
  host.paused = true; c.unwatched(); now += 3_600_000; await c.watched();
  assert.equal(events.length, 0);
});

test('the moment nobody was here survives the process: a cold boot hours later jumps the clock to now', async () => {
  let now = 5_000_000;
  const dir = mkdtempSync(join(tmpdir(), 'catchup-'));
  const a = fakeHost(2000);
  new ClockCatchUp(a.host as never, dir, { now: () => now }).unwatched();
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'clock-wall.json'), 'utf8')), { worldId: 'w-1', wall: 5_000_000, tick: 2000 });
  // the world ran slow 10 min, slept, and exited at tick 5000; it boots 2 h later
  now += 2 * 3_600_000;
  const b = fakeHost(5000);
  const c = new ClockCatchUp(b.host as never, dir, { now: () => now });
  await c.watched();
  assert.equal(b.events.length, 1);
  assert.equal(b.events[0].payload.dayConfig.origin, -(144_000 - 3000));
  assert.equal(JSON.parse(readFileSync(join(dir, 'clock-wall.json'), 'utf8')), null, 'used once');
  // another world's file (a copied data dir) is ignored
  const other = fakeHost(5000); (other.host as { worldId: string }).worldId = 'w-2';
  new ClockCatchUp(a.host as never, dir, { now: () => now }).unwatched();
  await new ClockCatchUp(other.host as never, dir, { now: () => now + 3_600_000 }).watched();
  assert.equal(other.events.length, 0);
});
