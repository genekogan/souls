// node --test tools/world-launcher/continuous-worlds.test.mjs (CW6, #740; fake worlds on ports 6460-6469)
// With the continuous setting, current-engine worlds keep their full clock whoever is there: no attention pace in the
// child, never frozen, released or evicted, started without a visitor; what cannot run is a named problem, never silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildPool, defaultCommand } from './children.mjs';
import { continuousWorlds, openLauncher } from './launcher.mjs';

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const pools = [];
const pool = (range, o = {}) => {
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), DATA_DIR: w.dataDir, FAKE_LOCK: '1', FAKE_STOP_MS: '50' } });
  const p = new ChildPool({ root: process.cwd(), range, logDir: mkdtempSync(join(tmpdir(), 'cw6-')), command, healthPath: (s) => `/w/${s}/healthz`, sleepMs: 5_000, exitMs: 10_000, ...o });
  pools.push(p); return p;
};
const world = (slug, extra = {}) => ({ slug, dataDir: mkdtempSync(join(tmpdir(), `cw6-${slug}-`)), ...extra });
const later = (ms) => Date.now() + ms;
const settle = async (p, slugs) => { for (let i = 0; i < 100 && !slugs.every((s) => p.status(s)?.status === 'running'); i++) await new Promise((r) => setTimeout(r, 50)); };
test.after(async () => { for (const p of pools) await p.closeAll(); });

test('the setting: SIM_CONTINUOUS_WORLDS=1 only; off by default', () => {
  assert.equal(continuousWorlds({}), false);
  assert.equal(continuousWorlds({ SIM_CONTINUOUS_WORLDS: '1' }), true);
  assert.equal(continuousWorlds({ SIM_CONTINUOUS_WORLDS: 'yes' }), false);
});

test('the child environment: no attention pace with the setting; the 0.25 default without it', () => {
  const w = { slug: 'calm', dataDir: '/data/calm' }, o = { publicOrigin: 'http://example.test' };
  assert.equal(defaultCommand(w, 7000, o).env.SIM_UNWATCHED_PACE, '0.25', 'off: unchanged');
  assert.equal('SIM_UNWATCHED_PACE' in defaultCommand(w, 7000, { ...o, continuous: true }).env, false, 'on: no Attention, no ClockCatchUp in the world');
});

test('continuous: never frozen, released or evicted; a capacity shortfall is a named problem, not an eviction', async () => {
  const p = pool([6460, 6462], { continuous: true, maxRunning: 2, idleMs: 0 });
  const a = world('steady'), b = world('second'), fork = world('oldone', { fork: { root: '/nowhere' } });
  await p.ensure(a); await p.ensure(b);
  const pid = p.state('steady').child.pid;
  assert.deepEqual(p.freezeIdle(later(60_000)), [], 'no continuous world is frozen, however long unused');
  assert.deepEqual(await p.releaseIdle(later(3_600_000)), [], 'nor released');
  assert.equal(await p.evictIdle(), null, 'nor evicted for room');
  assert.equal(p.state('steady').child.pid, pid, 'the same process throughout');
  const third = world('third');
  await assert.rejects(p.ensure(third), (e) => e.code === 'capacity', 'a boot past the cap is refused, not made room for');
  assert.deepEqual(p.keepRunning([a, b, third, fork]), ['third'], 'the sweep tries the one not running (forks are not started)');
  await new Promise((r) => setTimeout(r, 300));
  const codes = Object.fromEntries(p.problems().map((x) => [x.slug, x.code]));
  assert.equal(codes.third, 'continuousDown', 'visible to the operator');
  assert.match(p.problems().find((x) => x.slug === 'third').text, /capacity|slots/);
  assert.equal(codes.oldone, undefined, 'a fork is configuration, not a host fault (problems() turns hostOk false)');
  assert.deepEqual(p.continuousStatus().unsupported, ['oldone'], 'an old-engine fork is an explicit unmet prerequisite, reported apart');
  assert.deepEqual(p.keepRunning([a, b, third, fork]), [], 'a world already down is not announced again every sweep');
  assert.equal(codes.steady, undefined);
  // capacity freed (an operator archives `second`: it leaves the registry): the next sweep starts `third`
  await p.stop('second');
  p.keepRunning([a, third, fork]);
  await settle(p, ['third']);
  assert.equal(p.status('third').status, 'running');
  assert.deepEqual(p.problems(), [], 'nothing left down; second (unregistered) is not noted');
});

test('continuous: a never-visited world starts from the sweep without a visitor; held and booting ones are left alone', async () => {
  const p = pool([6463, 6465], { continuous: true });
  const fresh = world('never-visited'), held = world('resting');
  assert.deepEqual(p.keepRunning([fresh]), ['never-visited']);
  assert.deepEqual(p.keepRunning([fresh]), [], 'already booting: not started twice');
  await settle(p, ['never-visited']);
  assert.equal(p.status('never-visited').status, 'running');
  await p.ensure(held); p.state('resting').held = { at: Date.now(), failures: 5, reason: 'exit' }; await p.stop('resting');
  assert.deepEqual(p.keepRunning([fresh, held]), [], 'held stays held until an operator resumes it');
  assert.equal(p.problems().find((x) => x.slug === 'resting')?.code, 'held');
});

test('off: the idle policy is unchanged (frozen, released, evicted; the sweep does nothing)', async () => {
  const p = pool([6466, 6467], { maxRunning: 1, idleMs: 0 });
  const a = world('sleepy');
  await p.ensure(a);
  assert.deepEqual(p.keepRunning([a, world('other')]), [], 'no sweep without the setting');
  assert.deepEqual(p.freezeIdle(later(5_000)), ['sleepy']);
  assert.deepEqual(await p.releaseIdle(later(15_000)), ['sleepy']);
  await p.ensure(a);
  assert.equal(await p.evictIdle(), 'sleepy', 'an idle world is still evicted for room');
});

test('continuous: a crash whose restart is refused for capacity is continuousDown, not silent', async () => {
  let low = false;
  const p = pool([6468, 6469], { continuous: true, minFreeMb: 1, unitRoom: () => (low ? 0 : 1e9), unitFloorMb: 100, guard: { backoffBaseMs: 50, backoffCapMs: 100 } });
  const a = world('crashy');
  await p.ensure(a);
  low = true;   // the unit is now full: a boot is refused for capacity
  p.state('crashy').child.kill('SIGKILL');
  for (let i = 0; i < 60 && !(p.state('crashy').timer && p.state('crashy').restartReason === 'capacity'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(p.state('crashy').restartReason, 'capacity', 'its restart waits for room');
  p.keepRunning([a]);
  const down = p.problems().find((x) => x.slug === 'crashy');
  assert.equal(down?.code, 'continuousDown'); assert.match(down.text, /capacity/);
  low = false;
  for (let i = 0; i < 100 && p.status('crashy').status !== 'running'; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(p.status('crashy').status, 'running', 'it restarts once room frees');
  p.keepRunning([a]);
  assert.deepEqual(p.problems(), [], 'and is no longer down');
});

test('launcher: a handover starts nothing before takeOverAll (no second writer of a world the previous launcher runs)', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'cw6-launcher-')), webDir = join(dir, 'web'), templatesDir = join(dir, 'templates');
  mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Sim</title>'); mkdirSync(templatesDir);
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port) } });
  const base = { dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, continuous: true, continuousSweepMs: 50, sleepMs: 0, log: () => {} };
  const L1 = await openLauncher({ ...base, port: 6450, range: [6451, 6453] });
  let L2;
  try {
    for (const name of ['Here', 'Other']) assert.equal((await fetch('http://127.0.0.1:6450/__sim/worlds', { method: 'POST', body: JSON.stringify({ name }) })).status, 201);
    for (let i = 0; i < 100 && !['here', 'other'].every((s) => L1.pool.status(s).status === 'running'); i++) await new Promise((r) => setTimeout(r, 50));
    const here = L1.pool.state('here');
    // the next launcher adopts only `here`; `other` still runs under L1 and must not be started a second time
    L2 = await openLauncher({ ...base, port: 6454, range: [6455, 6457], adopt: [{ slug: 'here', port: here.port, pid: here.child.pid }] });
    await new Promise((r) => setTimeout(r, 400));   // eight sweeps
    assert.equal(L2.pool.state('other'), null, 'no second writer: nothing booted before takeOverAll');
    assert.deepEqual(L2.pool.continuousStatus().down, []);
  } finally { await L2?.close?.(); await L1.close(); }
});
