// srv-load: black for the limit → planned restart: the snapshot is saved and the process exits 75 (LOAD-CONTRACT §1, §4).
import test from 'node:test'; import assert from 'node:assert/strict'; import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'; import {tmpdir} from 'node:os'; import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

test('a world held at black for the limit saves its snapshot and exits 75; live.json said black and stopping', {timeout: 60_000}, async t => {
  const data = mkdtempSync(join(tmpdir(), 'load-restart-')), port = TEST_PORT, base = `http://127.0.0.1:${port}`, logs: string[] = [];
  const child = spawn(process.execPath, [new URL('./main.ts', import.meta.url).pathname], {env: {PATH: process.env.PATH, DATA_DIR: data, WORLD_ID: 'load-restart-fixture', WORLD_KEY: 'eden', ENGINE: 'toy', SEED_NATIVES: '0', BRAIN_MODE: 'fake', BRAIN_BUDGET_USD_PER_DAY: '0', ARCHIVE_TAKES: '0', PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: base,
    SIM_LOAD_DRILL_LEVEL: 'black', SIM_LOAD_BLACK_MS: '3000'}, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout!.on('data', d => logs.push(String(d))); child.stderr!.on('data', d => logs.push(String(d)));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); rmSync(data, {recursive: true, force: true}); });
  let sawBlack = false;
  const code = await new Promise<number | null>(resolve => { child.once('exit', c => resolve(c)); void (async () => {
    while (child.exitCode === null) { try { const r = await fetch(`${base}/healthz`, {signal: AbortSignal.timeout(1000)}); if (r.ok) { const h = await r.json() as {load?: {level: string}}; if (h.load?.level === 'black') sawBlack = true; } } catch { /* booting or gone */ } await delay(100); }
  })(); });
  const log = logs.join('');
  assert.equal(code, 75, log.slice(-2000));
  assert.ok(sawBlack, '/healthz said black'); assert.match(log, /black for 3 s: planned restart \(snapshot, exit 75\)/);
  assert.match(log, /load:black: snapshot saved/);
  assert.ok(existsSync(join(data, 'live.json')));
  assert.equal(JSON.parse(readFileSync(join(data, 'live.json'), 'utf8')).phase, 'stopping');
});
