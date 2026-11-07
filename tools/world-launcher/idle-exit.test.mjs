// node --test tools/world-launcher/idle-exit.test.mjs (lane SLEEP; fake worlds on a free block of ports)
// A world asleep (frozen) for exitMs more exits to give its memory back, and its next request cold-boots it from the same
// data, never while the old process still holds it (FAKE_LOCK: the edge server's single-writer lock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildPool } from './children.mjs';
import { idleExitMs } from './launcher.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(9);

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pools = [];
const pool = (range, o = {}) => {
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), DATA_DIR: w.dataDir, FAKE_LOCK: '1', FAKE_STOP_MS: '150' } });
  const p = new ChildPool({ root: process.cwd(), range, logDir: mkdtempSync(join(tmpdir(), 't4-sleep-')), command, healthPath: (s) => `/w/${s}/healthz`, sleepMs: 5_000, exitMs: 10_000, ...o });
  pools.push(p); return p;
};
const world = (slug, extra = {}) => ({ slug, dataDir: mkdtempSync(join(tmpdir(), `t4-sleep-${slug}-`)), ...extra });
const later = (ms) => Date.now() + ms;
test.after(async () => { for (const p of pools) await p.closeAll(); });

test('the exit time: SIM_WORLD_IDLE_EXIT_MIN minutes, default 60, 0 = never', () => {
  assert.equal(idleExitMs({}), 3_600_000);
  assert.equal(idleExitMs({ SIM_WORLD_IDLE_EXIT_MIN: '2' }), 120_000);
  assert.equal(idleExitMs({ SIM_WORLD_IDLE_EXIT_MIN: '0' }), 0);
  assert.equal(idleExitMs({ SIM_WORLD_IDLE_EXIT_MIN: 'soon' }), 3_600_000);
});

test('a world asleep for exitMs more exits, frees its slot, and its next request cold-boots it; a busy one stays', async () => {
  const held = new Set(['busy']);
  const p = pool([P0, P0 + 2], { maxRunning: 2, busy: (s) => held.has(s) });
  const a = world('idle'), b = world('busy');
  await p.ensure(a); await p.ensure(b);
  const pid = p.state('idle').child.pid, used = p.state('idle').lastUsed;
  assert.deepEqual(p.freezeIdle(later(5_000)), ['idle'], 'the idle world falls asleep; the busy one does not');
  assert.deepEqual(await p.releaseIdle(later(9_000)), [], 'asleep, but not yet for exitMs');
  assert.deepEqual(await p.releaseIdle(later(15_000)), ['idle']);
  assert.equal(alive(pid), false, 'its process is gone');
  assert.equal(p.status('idle').status, 'asleep'); assert.equal(p.status('idle').frozen, undefined);
  assert.equal(p.state('idle').lastUsed, used, 'giving memory back is not a use');
  assert.equal(p.running(), 1, 'only the busy world holds a slot');
  assert.equal(p.status('busy').status, 'running'); assert.equal(p.state('busy').frozen, undefined);
  assert.deepEqual(await p.releaseIdle(later(60_000)), [], 'a busy world never exits');
  // a third world fits now without evicting anything
  await p.ensure(world('third'));
  assert.equal(p.running(), 2);
  await p.stop('third');
  // the next visit wakes it: a cold boot on the same data
  await p.ensure(a);
  const again = p.state('idle').child.pid;
  assert.notEqual(again, pid); assert.ok(alive(again));
  assert.equal(p.status('idle').status, 'running');
});

test('a request that arrives while the world is exiting waits for the old process, then boots it (one writer)', async () => {
  const p = pool([P0 + 3, P0 + 4]);
  const a = world('racer');
  await p.ensure(a);
  const pid = p.state('racer').child.pid;
  p.freezeIdle(later(5_000));
  const releasing = p.releaseIdle(later(15_000));
  await new Promise((r) => setTimeout(r, 20));   // SIGTERM sent; the fake takes 150 ms to exit
  assert.ok(p.state('racer').stopping, 'mid-exit');
  const port = await p.ensure(a);   // FAKE_LOCK: a second process while the first lives would exit 7 and this would reject
  assert.deepEqual(await releasing, ['racer']);
  assert.equal(alive(pid), false);
  assert.ok(port > 0); assert.equal(p.status('racer').status, 'running'); assert.notEqual(p.state('racer').child.pid, pid);
});

test('a world booted only for a passive read sleeps and exits again at once, its last use unchanged', async () => {
  const p = pool([P0 + 5, P0 + 5]);
  const a = world('watched');
  await p.ensure(a);
  const used = p.state('watched').lastUsed;
  p.freezeIdle(later(5_000)); await p.releaseIdle(later(15_000));
  await p.ensure(a, { passive: true });
  assert.equal(p.status('watched').status, 'running');
  assert.equal(p.state('watched').lastUsed, used);
  assert.deepEqual(p.freezeIdle(later(15_000)), ['watched']);
  assert.deepEqual(await p.releaseIdle(later(15_000)), ['watched']);
});

test('old-engine forks stay frozen unless exitForks', async () => {
  const p = pool([P0 + 6, P0 + 6]);
  const f = world('oldy', { fork: true });
  await p.ensure(f);
  p.freezeIdle(later(5_000));
  assert.deepEqual(await p.releaseIdle(later(60_000)), []);
  assert.equal(p.state('oldy').frozen, true);
  const q = pool([P0 + 7, P0 + 7], { exitForks: true });
  const g = world('oldz', { fork: true });
  await q.ensure(g);
  q.freezeIdle(later(5_000));
  assert.deepEqual(await q.releaseIdle(later(15_000)), ['oldz']);
});

test('exitMs 0 (or no sleep) never exits a world', async () => {
  const p = pool([P0 + 8, P0 + 8], { exitMs: 0 });
  const a = world('stay');
  await p.ensure(a);
  p.freezeIdle(later(5_000));
  assert.deepEqual(await p.releaseIdle(later(10_000_000)), []);
  assert.equal(p.state('stay').frozen, true);
});
