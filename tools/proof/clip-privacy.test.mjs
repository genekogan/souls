import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipPrivacyHits, hitSummary, pageTextHits, watchTake } from './clip-privacy.mjs';

const app = (file) => readFileSync(new URL(`../../apps/web/src/${file}`, import.meta.url), 'utf8');

test('the wording watched for is the app\'s own: a copy change fails here, not in a published clip', () => {
  const ask = /ask:`(Reconnect to [^`]*)`/.exec(app('soul-state.ts'))[1];
  assert.deepEqual(pageTextHits(ask, ''), ['reconnect-box']);
  const prompt = /return `(Read \$\{base\}[^`]*)`/.exec(app('AgentMessageBox.tsx'))[1];
  assert.deepEqual(pageTextHits(prompt, ''), ['start-prompt']);
});

test('pageTextHits: the page\'s own host on any port, in any case; never another page\'s, and never the live site\'s', () => {
  assert.deepEqual(pageTextHits('read http://LocalHost:4710/w/a/skill.md', 'localhost'), ['page-host']);
  assert.deepEqual(pageTextHits('on 127.0.0.1:9999 now', '127.0.0.1'), ['page-host']);
  assert.deepEqual(pageTextHits('Ada is sitting on the bench', '127.0.0.1'), []);
  assert.deepEqual(pageTextHits('welcome to soul.game', 'soul.game'), []);
  assert.deepEqual(pageTextHits('welcome to soul.game', 'preview.soul.game'), []);
  assert.deepEqual(pageTextHits('Reconnect to Ada by prompting your agent:', 'soul.game'), ['reconnect-box'], 'the wording counts on the live site too');
  assert.deepEqual(pageTextHits('anything', ''), [], 'about:blank has no host');
});

/** A watcher over a list of page reads; `Error` entries throw. The clock moves one second per read. */
function fakeTake(reads) {
  let sec = 0, i = 0;
  const read = async () => { const r = reads[Math.min(i++, reads.length - 1)]; if (r instanceof Error) throw r; return r; };
  return { watch: watchTake({ read, sinceSec: () => sec++, everyMs: 1 }), wait: () => new Promise(r => setTimeout(r, 30)) };
}
const page = (text) => ({ text, hostname: '127.0.0.1' });

test('watchTake: one record per kind with its first and last second; a clean take has none', async () => {
  const box = 'Reconnect to Ada by prompting your agent:\nRead http://127.0.0.1:4710/skill.md';
  const { watch, wait } = fakeTake([page('hello'), page(box), page(box), page('hello')]);
  await wait();
  const r = await watch.stop();
  assert.deepEqual(r.hits.map(h => [h.kind, h.firstSec, h.lastSec, h.polls]), [['reconnect-box', 1, 2, 2], ['page-host', 1, 2, 2]]);
  assert.ok(r.polls >= 4); assert.equal(r.missed, 0); assert.equal(r.maxGapSec, 1);
  assert.doesNotMatch(JSON.stringify(r), /127\.0\.0\.1|Ada/, 'the record never holds the text');
  assert.equal(hitSummary(r.hits), 'reconnect-box at 1-2 s, page-host at 1-2 s');
  const clean = fakeTake([page('hello')]);
  await clean.wait();
  assert.deepEqual((await clean.watch.stop()).hits, []);
});

test('watchTake: the last read happens at stop, so a box in the final frames counts', async () => {
  const reads = [page('hello')], { watch } = fakeTake(reads);
  reads.push(page('Reconnect to Ada by prompting your agent:'));
  assert.deepEqual((await watch.stop()).hits.map(h => h.kind), ['reconnect-box']);
});

test('watchTake: a failed read is counted and the watch goes on; a take never read at all fails as not-watched', async () => {
  const some = fakeTake([new Error('navigating'), page('hello')]);
  await some.wait();
  const r = await some.watch.stop();
  assert.equal(r.missed, 1); assert.deepEqual(r.hits, []);
  const none = fakeTake([new Error('page gone')]);
  await none.wait();
  assert.deepEqual((await none.watch.stop()).hits.map(h => h.kind), ['not-watched']);
});

test('watchTake: a stalled page cannot hang the recorder, and counts as not read', async () => {
  const w = watchTake({ read: () => new Promise(() => {}), sinceSec: () => 1, stopTimeoutMs: 5 });
  assert.deepEqual((await w.stop()).hits.map(h => h.kind), ['not-watched']);
});

test('clipPrivacyHits: nothing for a clip with no sidecar, or one from before the watcher', () => {
  assert.deepEqual(clipPrivacyHits(null), []);
  assert.deepEqual(clipPrivacyHits({ viewport: 'desktop' }), []);
  assert.equal(clipPrivacyHits({ privacy: { hits: [{ kind: 'page-host' }] } }).length, 1);
});

test('steps.example.mjs: a listen that ends is started again, and the last one stops with the recorder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hold-listen-')), eden = join(dir, 'eden.mjs'), log = join(dir, 'log');
  // the first listen ends at once, as it does when the owner writes; the next one stays open
  writeFileSync(eden, `import {appendFileSync, readFileSync} from 'node:fs';
const log=${JSON.stringify(log)};let n=0;try{n=readFileSync(log,'utf8').split('\\n').length-1;}catch{}
appendFileSync(log,process.pid+'\\n');if(n>0)setInterval(()=>{},1000);`);
  const example = new URL('../../.claude/skills/proof/steps.example.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(example)}); setTimeout(() => {}, 2500);`],
    { env: { ...process.env, SOUL_DIR: dir, EDEN: eden }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, 'the recorder reaches its own exit');
  const pids = readFileSync(log, 'utf8').trim().split('\n').map(Number);
  assert.equal(pids.length, 2);
  const alive = () => { try { return process.kill(pids[1], 0); } catch { return false; } };
  for (let i = 0; i < 100 && alive(); i++) await new Promise(r => setTimeout(r, 20));   // SIGTERM lands a moment after the exit
  assert.equal(alive(), false, 'nothing is left listening');
});
