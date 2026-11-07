// node --test tools/world-launcher/handover-race.test.mjs (lane t4-mem; fake worlds on a free block of ports)
// A release hands a world to the next launcher only once its previous process is gone: while that pid lives it holds the
// data dir (edge-server.mjs's lock) and the next process refuses to open it ("fork refused", 3.53 legacy activate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildPool } from './children.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(4);

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pools = [];
const pool = (range, env = {}, o = {}) => {
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), DATA_DIR: w.dataDir, FAKE_LOCK: '1', ...env } });
  const p = new ChildPool({ root: process.cwd(), range, logDir: mkdtempSync(join(tmpdir(), 't4-race-')), command, healthPath: (s) => `/w/${s}/healthz`, ...o });
  pools.push(p); return p;
};
const world = (slug) => ({ slug, dataDir: mkdtempSync(join(tmpdir(), `t4-race-${slug}-`)) });
test.after(async () => { for (const p of pools) await p.closeAll(); });

test('stop() returns only once a world that ignored SIGTERM is gone (SIGKILL, then its exit)', async () => {
  const a = pool([P0, P0 + 1], { FAKE_STOP_MS: 'never' }, { stopGraceMs: 300 });
  await a.ensure(world('stubborn'));
  const pid = a.state('stubborn').child.pid;
  await a.stop('stubborn');
  assert.equal(alive(pid), false, 'the SIGKILLed process is gone when stop() resolves');
});

test('takeOver waits for the released process to exit before the standby opens the data', async () => {
  const w = world('slow');
  const a = pool([P0, P0 + 1], { FAKE_STOP_MS: '700' });
  await a.ensure(w);
  const { port, child: { pid } } = a.state('slow');
  const b = pool([P0 + 2, P0 + 3], {}, { prewarm: true });
  b.adopt(w, { port, pid, script: fake });
  // a release that answers before the process has exited (as stop() did after its SIGKILL)
  const release = async () => { a.stop('slow'); };
  const t0 = Date.now();
  assert.equal(await b.takeOver('slow', release), port);
  assert.ok(Date.now() - t0 >= 600, 'it waited for the exit');
  assert.equal(alive(pid), false);
  const k = b.state('slow');
  assert.equal(k.status, 'running');
  assert.notEqual(k.child.pid, pid);
  const r = await fetch(`http://127.0.0.1:${port}/w/slow/healthz`).then((x) => x.json());
  assert.equal(r.pid, k.child.pid, 'the new process serves, it was not refused by the lock');
});

test('a released process that never exits fails the takeover clearly and the standby is stopped', async () => {
  const w = world('stuck');
  const a = pool([P0, P0 + 1], { FAKE_STOP_MS: 'never' });
  await a.ensure(w);
  const { port, child: { pid } } = a.state('stuck');
  const b = pool([P0 + 2, P0 + 3], {}, { prewarm: true });
  b.adopt(w, { port, pid, script: fake });
  let stopping = null;
  const release = async () => { stopping = a.stop('stuck'); };
  await assert.rejects(b.takeOver('stuck', release, { goneMs: 400 }), /previous process of stuck \(pid \d+\) still running 0 s after its release/);
  assert.equal(b.state('stuck').status, 'failed');
  assert.ok(b.state('stuck').adopted, 'still recorded as the previous launcher\'s process');
  assert.ok(alive(pid), 'the old process is untouched');
  const standby = Number(/\[standby\] ready pid (\d+)/.exec(readFileSync(join(b.o.logDir, 'stuck.log'), 'utf8'))?.[1]);
  assert.ok(standby > 0);
  for (let i = 0; i < 40 && alive(standby); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(alive(standby), false, 'the standby process was stopped');
  process.kill(pid, 'SIGKILL'); await stopping;
  assert.equal(alive(pid), false);
});

// R389/R390: a world stuck booting held prepareHandover (pool.settled) for its whole 90 s boot timeout, past the keeper's
// 60 s prepare. Now the stuck boot is abandoned after waitMs: its process is killed and seen gone, the healthy world is
// handed over, and the stuck one is reported; it is never handed over while its process may still hold the data.
const stuckPool = () => {
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), DATA_DIR: w.dataDir, FAKE_LOCK: '1', ...(w.slug === 'wedged' ? { FAKE_BOOT_MS: '600000' } : {}) } });
  const p = new ChildPool({ root: process.cwd(), range: [P0, P0 + 3], logDir: mkdtempSync(join(tmpdir(), 't4-race-')), command, healthPath: (s) => `/w/${s}/healthz` });
  pools.push(p); return p;
};
const bootPid = async (p, slug) => { for (let i = 0; i < 200 && !p.state(slug)?.child; i++) await new Promise((r) => setTimeout(r, 10)); return p.state(slug).child.pid; };

test('a world stuck booting cannot starve prepare: its boot is stopped (process gone), the healthy world is handed over', async () => {
  const a = stuckPool();
  await a.ensure(world('fine'));
  const booting = a.ensure(world('wedged'), { timeoutMs: 60_000 }); booting.catch(() => {});
  const pid = await bootPid(a, 'wedged');
  a.pause();
  const t0 = Date.now();
  const abandoned = await a.settled({ waitMs: 400, goneMs: 3_000 });
  assert.ok(Date.now() - t0 < 2_500, `prepare answered in ${Date.now() - t0} ms, not after the boot timeout`);
  assert.deepEqual(abandoned.map((b) => [b.slug, b.pid]), [['wedged', pid]]);
  assert.match(abandoned[0].error, /abandoned: still booting after 0.4 s/);
  assert.equal(alive(pid), false, 'the stuck boot\'s process is gone before prepare answers (one writer)');
  await assert.rejects(booting);
  assert.deepEqual(a.handoverList().map((c) => c.slug), ['fine'], 'only the healthy world is handed over');
  assert.equal(a.state('wedged').child, null);
  const { port } = a.state('fine');
  assert.equal((await fetch(`http://127.0.0.1:${port}/w/fine/healthz`)).status, 200, 'the healthy world still serves');
  a.unpause();
});

test('prepare fails (no handover) when a stuck boot cannot be proven gone in time', async () => {
  const a = stuckPool();
  const booting = a.ensure(world('wedged'), { timeoutMs: 60_000 }); booting.catch(() => {});
  await bootPid(a, 'wedged');
  a.pause();
  await assert.rejects(a.settled({ waitMs: 200, goneMs: 0 }), /boot\(s\) of wedged still running 0 s after being stopped/);
  await assert.rejects(booting);
  a.unpause();
});
