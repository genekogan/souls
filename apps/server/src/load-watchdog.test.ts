// srv-load: the watchdog thread keeps live.json and its own /healthz honest while the main thread is stuck (LOAD-CONTRACT §4).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const here = new URL('.', import.meta.url).pathname;

test('a main thread busy for 4 s: live.json keeps being rewritten and the worker /healthz answers, showing the stuck turn', {timeout: 30_000}, async t => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'souls-watchdog-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  const script = `
    import {startWatchdog} from ${JSON.stringify(join(here, 'load/watchdog.ts'))};
    import {bootPhase} from ${JSON.stringify(join(here, 'load/boot-progress.ts'))};
    bootPhase('serving', 7);
    startWatchdog({dataDir: ${JSON.stringify(dir)}, port: 0, everyMs: 200, onListening: port => {
      console.log('PORT ' + port);
      setTimeout(() => { console.log('BUSY'); const end = Date.now() + 4000; while (Date.now() < end) {} console.log('FREE'); setTimeout(() => process.exit(0), 300); }, 300);
    }});
    setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {stdio: ['ignore', 'pipe', 'inherit']});
  t.after(() => child.kill('SIGKILL'));
  let out = ''; const seen = (s: string) => new Promise<void>(r => { const f = () => { if (out.includes(s)) { child.stdout!.off('data', g); r(); } }; const g = (b: Buffer) => { out += b; f(); }; child.stdout!.on('data', g); f(); });
  await seen('PORT '); const port = Number(/PORT (\d+)/.exec(out)![1]);
  await seen('BUSY');
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 2500));
  const live = JSON.parse(readFileSync(join(dir, 'live.json'), 'utf8'));
  assert.ok(live.at >= t0 + 1500, 'rewritten while the main thread is stuck');
  assert.ok(live.loop.lastTurnAgeMs >= 1500, `the stuck turn shows: ${live.loop.lastTurnAgeMs}`);
  assert.equal(live.phase, 'serving'); assert.equal(live.v, 1); assert.equal(live.pid, child.pid);
  const a = performance.now(), r = await fetch(`http://127.0.0.1:${port}/healthz`, {signal: AbortSignal.timeout(1000)});
  assert.ok(performance.now() - a < 1000, 'answered within 1 s');
  assert.equal(r.status, 200); const h = await r.json() as {ok: boolean; loop: {lastTurnAgeMs: number}};
  assert.equal(h.ok, true); assert.ok(h.loop.lastTurnAgeMs >= 2000);
  assert.ok(!out.includes('FREE'), 'all of this while the main thread was still busy');
});
