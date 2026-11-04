// CW3 (#737) slice: sim_world_elu, sim_world_gc_seconds_total and sim_world_ticks_late_total were mapped by the launcher's
// /__sim/metrics but never written into live.json. They are now, from the existing monitor and tick seams.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {liveOf, newSharedLoad, S} from './load/shared.ts';
// @ts-expect-error untyped launcher module (plain .mjs)
import {metricsText, readLive} from '../../../tools/world-launcher/metrics.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const val = (text: string, name: string) => { const l = text.split('\n').find((x) => x.startsWith(`${name}{`)); return l === undefined ? undefined : Number(l.split(' ').at(-1)); };
const serving = () => { const a = newSharedLoad(); a[S.boot] = 4; return a; };   // boot phase index 4 = serving (boot-progress.ts)

test('liveOf: ELU only once a window has closed; GC seconds and late ticks are cumulative counters', () => {
  const a = serving();
  const before = liveOf(a, 1, 1000);
  assert.equal(before.loop.elu, undefined, 'no ELU before the first 5 s window closes: absent, never 0');
  a[S.elu] = 0.4567; a[S.gcMsTotal] = 1234.5; a[S.ticksLateTotal] = 7;
  const after = liveOf(a, 1, 1000);
  assert.equal(after.loop.elu, 0.457);
  assert.equal(after.heap.gcSecondsTotal, 1.235);
  if (after.phase === 'serving') assert.equal(after.tick?.lateTotal, 7);
  const t = metricsText({now: 1000, worlds: [{slug: 'w', status: 'running', live: after}]});
  assert.equal(val(t, 'sim_world_elu'), 0.457);
  assert.equal(val(t, 'sim_world_gc_seconds_total'), 1.235);
});

async function freePort() { return await new Promise<number>((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as {port: number}).port; s.close(() => res(p)); }); }); }

test('a fake-mind world writes all three series and /__sim/metrics shows them', {timeout: 120_000}, async (t) => {
  mkdirSync(join(ROOT, '.local'), {recursive: true});
  const dir = mkdtempSync(join(ROOT, '.local', 'live-series-')), port = await freePort();
  let child: ChildProcess | undefined, out = '';
  t.after(() => { try { child?.kill('SIGKILL'); } catch { /* gone */ } rmSync(dir, {recursive: true, force: true}); });
  const env = {PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOST: '127.0.0.1', PORT: String(port), WORLD_KEY: 'live-series', WORLD_PATH: '/w/live-series',
    PUBLIC_URL: `http://127.0.0.1:${port}/w/live-series`, DATA_DIR: dir, DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', TYPESAFE_API_KEY: ''};
  child = spawn(process.execPath, ['apps/server/src/main.ts'], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout!.on('data', (b) => { out = (out + b).slice(-4000); }); child.stderr!.on('data', (b) => { out = (out + b).slice(-4000); });
  // ELU appears when the first 5 s loop window after the warm-up closes; the watchdog writes live.json every 2 s
  let live: ReturnType<typeof readLive> = null;
  for (let i = 0; i < 90 && !(live?.loop?.elu !== undefined && live?.tick); i++) {
    if (child.exitCode !== null) throw new Error(`world exited: ${out}`);
    await new Promise((r) => setTimeout(r, 1000)); live = readLive(dir);
  }
  assert.ok(live?.tick, `live.json never reached serving: ${JSON.stringify(live)}`);
  assert.ok(typeof live.loop.elu === 'number' && live.loop.elu >= 0 && live.loop.elu <= 1, `elu ${live.loop.elu}`);
  assert.ok(typeof live.heap.gcSecondsTotal === 'number' && live.heap.gcSecondsTotal >= 0);
  assert.ok(Number.isInteger(live.tick.lateTotal) && live.tick.lateTotal >= 0);
  const text = metricsText({now: Date.now(), worlds: [{slug: 'live-series', status: 'running', live}]});
  for (const name of ['sim_world_elu', 'sim_world_gc_seconds_total', 'sim_world_ticks_late_total']) assert.notEqual(val(text, name), undefined, `${name} missing from /__sim/metrics`);
});
